import * as core from '@actions/core'
import { TokenConfig, fetchAccessToken, isTokenExpired } from './auth'
import type { TokenState } from './auth'

export interface DeployRequest {
  Project: string
  Environment: string
  BuildUrl: string | null
  BuildText: string | null
  BuildNum: string | null
  Pinned: boolean
  Components: string[]
}

export interface RequestStatus {
  Id: number
  Status: string
}

export interface ComponentResult {
  Id?: number
  ComponentName: string
  Status: string
  Log: string
}

const GOOD_STATUSES = ['Completed']
const BAD_STATUSES = ['Errored', 'Cancelled', 'Failed']
const TERMINAL_STATUSES = [...GOOD_STATUSES, ...BAD_STATUSES]
const FETCH_TIMEOUT_MS = 60_000
const RETRYABLE_STATUS_CODES = [502, 503, 504]
const MAX_RETRIES = 3
const RETRY_BASE_DELAY_MS = 1000
const MAX_COMPONENT_LOG_LENGTH = 50_000

function isRetryableError(error: unknown): boolean {
  if (error instanceof Error && error.name === 'TimeoutError') return true
  if (error instanceof TypeError) return true // network failures
  return false
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function isValidRequestStatus(value: unknown): value is RequestStatus {
  return (
    typeof value === 'object' &&
    value !== null &&
    'Id' in value &&
    Number.isInteger((value as Record<string, unknown>).Id) &&
    'Status' in value &&
    typeof (value as Record<string, unknown>).Status === 'string'
  )
}

function isValidComponentResult(value: unknown): value is ComponentResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).ComponentName === 'string' &&
    typeof (value as Record<string, unknown>).Status === 'string' &&
    typeof (value as Record<string, unknown>).Log === 'string'
  )
}

export class DorcClient {
  private tokenState: TokenState | null = null

  constructor(
    private baseUrl: string,
    private tokenConfig: TokenConfig
  ) {}

  private async ensureToken(): Promise<string> {
    if (!this.tokenState || isTokenExpired(this.tokenState)) {
      core.info('Refreshing DOrc access token...')
      this.tokenState = await fetchAccessToken(this.tokenConfig)
      core.setSecret(this.tokenState.accessToken)
    }
    return this.tokenState.accessToken
  }

  private async request<T>(
    method: string,
    path: string,
    body?: object
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      let token: string
      try {
        token = await this.ensureToken()
      } catch (error) {
        if (attempt < MAX_RETRIES && isRetryableError(error)) {
          const delay = retryDelay(attempt)
          core.warning(
            `Token refresh failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}): ${error}. Retrying in ${Math.round(delay)}ms...`
          )
          this.tokenState = null
          await sleep(delay)
          continue
        }
        throw error
      }

      const options: RequestInit = {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
      }
      if (body) {
        options.body = JSON.stringify(body)
      }

      let response: Response
      try {
        response = await fetch(url, options)
      } catch (error) {
        if (attempt < MAX_RETRIES && isRetryableError(error)) {
          const delay = retryDelay(attempt)
          core.warning(
            `Request to ${path} failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}): ${error}. Retrying in ${Math.round(delay)}ms...`
          )
          await sleep(delay)
          continue
        }
        throw error
      }

      // On 401, invalidate token so ensureToken() fetches a fresh one next iteration
      if (response.status === 401 && attempt < MAX_RETRIES) {
        core.info(
          `Received 401 for ${path}, invalidating token and retrying...`
        )
        this.tokenState = null
        await sleep(retryDelay(attempt))
        continue
      }

      // Retry on transient server errors
      if (
        RETRYABLE_STATUS_CODES.includes(response.status) &&
        attempt < MAX_RETRIES
      ) {
        const delay = retryDelay(attempt)
        core.warning(
          `DOrc API returned ${response.status} for ${path} (attempt ${attempt + 1}/${MAX_RETRIES + 1}). Retrying in ${Math.round(delay)}ms...`
        )
        await sleep(delay)
        continue
      }

      if (!response.ok) {
        let errorText = 'No error details'
        try {
          errorText = await response.text()
          if (errorText.length > 500) {
            errorText = errorText.substring(0, 500) + '...'
          }
        } catch (textError) {
          core.debug(`Failed to read response body: ${textError}`)
          errorText = 'Could not read response body'
        }
        throw new Error(
          `DOrc API ${method} ${path} failed: ${response.status} ${response.statusText} - ${errorText}`
        )
      }

      let json: unknown
      try {
        json = await response.json()
      } catch {
        throw new Error(`DOrc API ${method} ${path} returned non-JSON response`)
      }
      return json as T
    }

    // Unreachable in practice: on the final attempt all branches either
    // return or throw. Kept as a TypeScript exhaustiveness safeguard.
    throw new Error(
      `DOrc API ${method} ${path} failed after ${MAX_RETRIES + 1} attempts`
    )
  }

  async createRequest(req: DeployRequest): Promise<RequestStatus> {
    core.debug(`Creating DOrc request: ${JSON.stringify(req)}`)
    const result = await this.request<unknown>('POST', '/Request', req)
    if (!isValidRequestStatus(result)) {
      throw new Error(
        `DOrc API returned unexpected response for POST /Request: ${JSON.stringify(result)}`
      )
    }
    return result
  }

  async getRequestStatus(requestId: number): Promise<RequestStatus> {
    const result = await this.request<unknown>(
      'GET',
      `/Request?id=${requestId}`
    )
    if (!isValidRequestStatus(result)) {
      throw new Error(
        `DOrc API returned unexpected response for GET /Request?id=${requestId}: ${JSON.stringify(result)}`
      )
    }
    return result
  }

  async getResultStatuses(requestId: number): Promise<ComponentResult[]> {
    const result = await this.request<unknown>(
      'GET',
      `/ResultStatuses?requestId=${requestId}`
    )
    if (!Array.isArray(result)) {
      throw new Error(
        'DOrc API returned unexpected response for GET /ResultStatuses: expected array'
      )
    }
    for (const item of result) {
      if (!isValidComponentResult(item)) {
        throw new Error(
          'DOrc API returned malformed component result: missing ComponentName, Status, or Log'
        )
      }
    }
    return result
  }

  async getComponentLog(
    requestId: number,
    resultId: number
  ): Promise<string | null> {
    try {
      const result = await this.request<unknown>(
        'GET',
        `/ResultStatuses/Log?requestId=${requestId}&resultId=${resultId}`
      )
      return typeof result === 'string' ? result : JSON.stringify(result)
    } catch (error) {
      // 404 means no full log available — fall back to preview
      if (error instanceof Error && error.message.includes('404')) {
        return null
      }
      core.warning(
        `Failed to fetch full log for resultId ${resultId}: ${error instanceof Error ? error.message : error}`
      )
      return null
    }
  }

  async pollUntilComplete(
    requestId: number,
    pollIntervalSeconds: number,
    timeoutMinutes: number
  ): Promise<string> {
    let lastStatus = ''
    const deadline = Date.now() + timeoutMinutes * 60 * 1000
    const jitterMs = 1000
    const componentStatuses = new Map<string, string>()

    // Check immediately, then sleep between subsequent polls
    let firstPoll = true
    while (Date.now() < deadline) {
      if (!firstPoll) {
        await sleep(pollIntervalSeconds * 1000 + Math.random() * jitterMs)
      }
      firstPoll = false

      const status = await this.getRequestStatus(requestId)

      if (status.Status !== lastStatus) {
        core.info(`Request ${requestId} status changed to: ${status.Status}`)
        lastStatus = status.Status
      }

      // Live component progress — fetch and log status changes
      try {
        const components = await this.getResultStatuses(requestId)
        for (const cmp of components) {
          const prev = componentStatuses.get(cmp.ComponentName)
          if (prev !== cmp.Status) {
            core.info(`  Component '${cmp.ComponentName}': ${cmp.Status}`)
            componentStatuses.set(cmp.ComponentName, cmp.Status)
          }
        }
      } catch {
        // Non-fatal — live progress is best-effort
      }

      if (TERMINAL_STATUSES.includes(lastStatus)) {
        return lastStatus
      }
    }

    throw new Error(
      `Deployment timed out after ${timeoutMinutes} minutes. Last status: ${lastStatus || 'unknown'}`
    )
  }

  async logComponentResults(requestId: number): Promise<void> {
    const results = await this.getResultStatuses(requestId)
    if (results.length === 0) {
      core.info('No component results returned.')
      return
    }
    for (const cmp of results) {
      core.info('='.repeat(75))
      core.info(`  ${cmp.ComponentName} — ${cmp.Status}`)
      core.info('='.repeat(75))

      // Fetch full log from dedicated endpoint, fall back to preview
      let log: string = cmp.Log
      if (cmp.Id != null) {
        const fullLog = await this.getComponentLog(requestId, cmp.Id)
        if (fullLog !== null) {
          log = fullLog
        } else {
          core.debug(`No full log for '${cmp.ComponentName}', using preview.`)
        }
      }

      if (log.length > MAX_COMPONENT_LOG_LENGTH) {
        log =
          log.substring(0, MAX_COMPONENT_LOG_LENGTH) +
          `\n... [truncated ${log.length - MAX_COMPONENT_LOG_LENGTH} chars]`
      }
      core.info(log)
    }
  }

  static isSuccessStatus(status: string): boolean {
    return GOOD_STATUSES.includes(status)
  }
}

function retryDelay(attempt: number): number {
  return RETRY_BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 1000
}
