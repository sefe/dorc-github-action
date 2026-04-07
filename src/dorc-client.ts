import * as core from '@actions/core'
import {
  TokenConfig,
  TokenState,
  fetchAccessToken,
  isTokenExpired
} from './auth'

export interface DeployRequest {
  Project: string
  Environment: string
  BuildUrl: string
  BuildText: string
  BuildNum: string
  Pinned: boolean
  Components: string[]
}

export interface RequestStatus {
  Id: number
  Status: string
}

export interface ComponentResult {
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

function isRetryableError(error: unknown): boolean {
  if (error instanceof Error && error.name === 'TimeoutError') return true
  if (error instanceof TypeError) return true // network failures
  return false
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
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
      const token = await this.ensureToken()
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
          const delay =
            RETRY_BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 1000
          core.warning(
            `Request to ${path} failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}): ${error}. Retrying in ${Math.round(delay)}ms...`
          )
          await sleep(delay)
          continue
        }
        throw error
      }

      // Retry once on 401 with a fresh token
      if (response.status === 401) {
        core.info('Received 401, refreshing token and retrying...')
        this.tokenState = await fetchAccessToken(this.tokenConfig)
        const retryOptions: RequestInit = {
          method,
          headers: {
            Authorization: `Bearer ${this.tokenState.accessToken}`,
            'Content-Type': 'application/json'
          },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
        }
        if (body) {
          retryOptions.body = JSON.stringify(body)
        }
        response = await fetch(url, retryOptions)
      }

      // Retry on transient server errors
      if (
        RETRYABLE_STATUS_CODES.includes(response.status) &&
        attempt < MAX_RETRIES
      ) {
        const delay =
          RETRY_BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 1000
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
        } catch {
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
        throw new Error(
          `DOrc API ${method} ${path} returned non-JSON response`
        )
      }
      return json as T
    }

    throw new Error(`DOrc API ${method} ${path} failed after ${MAX_RETRIES + 1} attempts`)
  }

  async createRequest(req: DeployRequest): Promise<RequestStatus> {
    core.debug(`Creating DOrc request: ${JSON.stringify(req)}`)
    return this.request<RequestStatus>('POST', '/Request', req)
  }

  async getRequestStatus(requestId: number): Promise<RequestStatus> {
    return this.request<RequestStatus>('GET', `/Request?id=${requestId}`)
  }

  async getResultStatuses(requestId: number): Promise<ComponentResult[]> {
    return this.request<ComponentResult[]>(
      'GET',
      `/ResultStatuses?requestId=${requestId}`
    )
  }

  async pollUntilComplete(
    requestId: number,
    pollIntervalSeconds: number,
    timeoutMinutes: number
  ): Promise<string> {
    let lastStatus = ''
    const deadline = Date.now() + timeoutMinutes * 60 * 1000

    while (Date.now() <= deadline) {
      await sleep(pollIntervalSeconds * 1000)

      const status = await this.getRequestStatus(requestId)

      if (status.Status !== lastStatus) {
        core.info(`Request ${requestId} status changed to: ${status.Status}`)
        lastStatus = status.Status
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
    for (const cmp of results) {
      core.info('='.repeat(75))
      core.info(`  ${cmp.ComponentName} — ${cmp.Status}`)
      core.info('='.repeat(75))
      core.info(cmp.Log)
    }
  }

  isSuccessStatus(status: string): boolean {
    return GOOD_STATUSES.includes(status)
  }
}
