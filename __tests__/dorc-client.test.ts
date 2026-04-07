import { DorcClient } from '../src/dorc-client'

// Mock @actions/core
jest.mock('@actions/core', () => ({
  info: jest.fn(),
  debug: jest.fn()
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

      // Second call should be the POST to /Request
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
