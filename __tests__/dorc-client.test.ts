import { DorcClient } from '../src/dorc-client'

jest.mock('@actions/core', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warning: jest.fn()
}))

const mockFetch = jest.fn()
global.fetch = mockFetch

const TOKEN_CONFIG = {
  tokenUrl: 'https://ids.example.com/connect/token',
  clientSecret: 'secret123'
}

function mockTokenResponse(): void {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      access_token: 'test-token',
      expires_in: 3600
    })
  })
}

function mockApiResponse<T>(data: T, status = 200): void {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => data,
    text: async () => JSON.stringify(data)
  })
}

beforeEach(() => {
  mockFetch.mockReset()
})

describe('DorcClient', () => {
  describe('createRequest', () => {
    it('creates a request and returns the ID', async () => {
      const client = new DorcClient('https://dorc.example.com', TOKEN_CONFIG)

      mockTokenResponse()
      mockApiResponse({ Id: 42, Status: 'Pending' })

      const result = await client.createRequest({
        Project: 'MyProject',
        Environment: 'DEV',
        BuildUrl: '',
        BuildText: 'MyBuild',
        BuildNum: 'latest',
        Pinned: false,
        Components: ['Component1', 'Component2']
      })

      expect(result.Id).toBe(42)
      expect(result.Status).toBe('Pending')

      const postCall = mockFetch.mock.calls[1]
      expect(postCall[0]).toBe('https://dorc.example.com/Request')
      expect(postCall[1].method).toBe('POST')
    })
  })

  describe('getRequestStatus', () => {
    it('returns the current status', async () => {
      const client = new DorcClient('https://dorc.example.com', TOKEN_CONFIG)

      mockTokenResponse()
      mockApiResponse({ Id: 42, Status: 'InProgress' })

      const status = await client.getRequestStatus(42)
      expect(status.Status).toBe('InProgress')
    })
  })

  describe('retries on 401', () => {
    it('refreshes token and retries on 401', async () => {
      const client = new DorcClient('https://dorc.example.com', TOKEN_CONFIG)

      // Initial token
      mockTokenResponse()
      // First API call returns 401
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({}),
        text: async () => 'Unauthorized'
      })
      // Refresh token
      mockTokenResponse()
      // Retry succeeds
      mockApiResponse({ Id: 42, Status: 'Pending' })

      const result = await client.getRequestStatus(42)
      expect(result.Id).toBe(42)
    })
  })

  describe('retries on transient errors', () => {
    it('retries on 503 and succeeds', async () => {
      const client = new DorcClient('https://dorc.example.com', TOKEN_CONFIG)

      mockTokenResponse()
      // First attempt: 503
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        json: async () => ({}),
        text: async () => 'Service Unavailable'
      })
      // Retry succeeds (needs a fresh ensureToken call since token is still valid)
      mockApiResponse({ Id: 42, Status: 'Pending' })

      const result = await client.getRequestStatus(42)
      expect(result.Id).toBe(42)
    })

    it('retries on network errors', async () => {
      const client = new DorcClient('https://dorc.example.com', TOKEN_CONFIG)

      mockTokenResponse()
      // First attempt: network error
      mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'))
      // Retry succeeds
      mockApiResponse({ Id: 42, Status: 'Pending' })

      const result = await client.getRequestStatus(42)
      expect(result.Id).toBe(42)
    })
  })

  describe('pollUntilComplete', () => {
    it('polls until a terminal status is reached', async () => {
      const client = new DorcClient('https://dorc.example.com', TOKEN_CONFIG)

      mockTokenResponse()
      // First poll: InProgress
      mockApiResponse({ Id: 1, Status: 'InProgress' })
      // Second poll: Completed
      mockApiResponse({ Id: 1, Status: 'Completed' })

      const status = await client.pollUntilComplete(1, 0.01, 1)
      expect(status).toBe('Completed')
    })

    it('returns on failure statuses', async () => {
      const client = new DorcClient('https://dorc.example.com', TOKEN_CONFIG)

      mockTokenResponse()
      mockApiResponse({ Id: 1, Status: 'Errored' })

      const status = await client.pollUntilComplete(1, 0.01, 1)
      expect(status).toBe('Errored')
    })

    it('throws on timeout', async () => {
      const client = new DorcClient('https://dorc.example.com', TOKEN_CONFIG)

      mockTokenResponse()
      // Keep returning InProgress forever
      for (let i = 0; i < 20; i++) {
        mockApiResponse({ Id: 1, Status: 'InProgress' })
      }

      // Timeout after 0.001 minutes (60ms)
      await expect(
        client.pollUntilComplete(1, 0.01, 0.001)
      ).rejects.toThrow('Deployment timed out')
    })
  })

  describe('logComponentResults', () => {
    it('logs component results', async () => {
      const core = jest.requireMock('@actions/core')
      const client = new DorcClient('https://dorc.example.com', TOKEN_CONFIG)

      mockTokenResponse()
      mockApiResponse([
        { ComponentName: 'Comp1', Status: 'Completed', Log: 'Done' },
        { ComponentName: 'Comp2', Status: 'Errored', Log: 'Failed' }
      ])

      await client.logComponentResults(1)

      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('Comp1')
      )
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('Comp2')
      )
    })
  })

  describe('isSuccessStatus', () => {
    it('returns true for Completed', () => {
      const client = new DorcClient('https://dorc.example.com', TOKEN_CONFIG)
      expect(client.isSuccessStatus('Completed')).toBe(true)
    })

    it('returns false for Errored', () => {
      const client = new DorcClient('https://dorc.example.com', TOKEN_CONFIG)
      expect(client.isSuccessStatus('Errored')).toBe(false)
    })

    it('returns false for Failed', () => {
      const client = new DorcClient('https://dorc.example.com', TOKEN_CONFIG)
      expect(client.isSuccessStatus('Failed')).toBe(false)
    })
  })
})
