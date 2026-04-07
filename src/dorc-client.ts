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
    const token = await this.ensureToken()
    const url = `${this.baseUrl}${path}`
    const options: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }
    if (body) {
      options.body = JSON.stringify(body)
    }

    let response = await fetch(url, options)

    // Retry once on 401 with a fresh token
    if (response.status === 401) {
      core.info('Received 401, refreshing token and retrying...')
      this.tokenState = await fetchAccessToken(this.tokenConfig)
      options.headers = {
        Authorization: `Bearer ${this.tokenState.accessToken}`,
        'Content-Type': 'application/json'
      }
      response = await fetch(url, options)
    }

    if (!response.ok) {
      const text = await response.text()
      throw new Error(
        `DOrc API ${method} ${path} failed: ${response.status} ${response.statusText} - ${text}`
      )
    }

    return (await response.json()) as T
  }

  async createRequest(req: DeployRequest): Promise<RequestStatus> {
    core.info(`Creating DOrc request: ${JSON.stringify(req)}`)
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
    pollIntervalSeconds: number
  ): Promise<string> {
    let lastStatus = ''

    while (true) {
      await new Promise(resolve =>
        setTimeout(resolve, pollIntervalSeconds * 1000)
      )

      const status = await this.getRequestStatus(requestId)

      if (status.Status !== lastStatus) {
        core.info(`Request ${requestId} status changed to: ${status.Status}`)
        lastStatus = status.Status
      }

      if (TERMINAL_STATUSES.includes(lastStatus)) {
        return lastStatus
      }
    }
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
