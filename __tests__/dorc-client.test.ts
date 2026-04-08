import { DorcClient } from '../src/dorc-client'

jest.mock('@actions/core', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warning: jest.fn()
}))

const originalFetch = global.fetch
const mockFetch = jest.fn()

beforeAll(() => {
  global.fetch = mockFetch
})
afterAll(() => {
  global.fetch = originalFetch
})
beforeEach(() => {
  mockFetch.mockReset()
})

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

describe('DorcClient', () => {
  describe('createRequest', () => {
    it('creates a request and returns the ID', async () => {
      const client = new DorcClient('https://dorc.example.com', TOKEN_CONFIG)

      mockTokenResponse()
      mockApiResponse({ Id: 42, Status: 'Pending' })

      const result = await client.createRequest({
        Project: 'MyProject',
        Environment: 'DEV',
        BuildUrl: null,
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

    it('throws on invalid response shape', async () => {
      const client = new DorcClient('https://dorc.example.com', TOKEN_CONFIG)

      mockTokenResponse()
      mockApiResponse({ error: 'something went wrong' })

      await expect(
        client.createRequest({
          Project: 'P',
          Environment: 'E',
          BuildUrl: null,
          BuildText: null,
          BuildNum: null,
          Pinned: false,
          Components: ['C']
        })
      ).rejects.toThrow('unexpected response')
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

    it('throws on invalid response shape', async () => {
      const client = new DorcClient('https://dorc.example.com', TOKEN_CONFIG)

      mockTokenResponse()
      mockApiResponse({ message: 'not found' })

      await expect(client.getRequestStatus(42)).rejects.toThrow(
        'unexpected response'
      )
    })
  })

  describe('getResultStatuses', () => {
    it('throws when response is not an array', async () => {
      const client = new DorcClient('https://dorc.example.com', TOKEN_CONFIG)

      mockTokenResponse()
      mockApiResponse({ error: 'oops' })

      await expect(client.getResultStatuses(42)).rejects.toThrow(
        'expected array'
      )
    })
  })

  describe('retries on 401', () => {
    it('invalidates token and retries on 401', async () => {
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
      // New token on retry
      mockTokenResponse()
      // Retry succeeds
      mockApiResponse({ Id: 42, Status: 'Pending' })

      const result = await client.getRequestStatus(42)
      expect(result.Id).toBe(42)
    })

    it('handles 401 followed by 503 on retry', async () => {
      const client = new DorcClient('https://dorc.example.com', TOKEN_CONFIG)

      // Initial token
      mockTokenResponse()
      // First call: 401
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized'
      })
      // Retry with new token: 503
      mockTokenResponse()
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable'
      })
      // Third attempt succeeds
      mockApiResponse({ Id: 42, Status: 'Pending' })

      const result = await client.getRequestStatus(42)
      expect(result.Id).toBe(42)
    })
  })

  describe('retries on transient errors', () => {
    it('retries on 503 and succeeds', async () => {
      const client = new DorcClient('https://dorc.example.com', TOKEN_CONFIG)

      mockTokenResponse()
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable'
      })
      mockApiResponse({ Id: 42, Status: 'Pending' })

      const result = await client.getRequestStatus(42)
      expect(result.Id).toBe(42)
    })

    it('retries on network errors', async () => {
      const client = new DorcClient('https://dorc.example.com', TOKEN_CONFIG)

      mockTokenResponse()
      mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'))
      mockApiResponse({ Id: 42, Status: 'Pending' })

      const result = await client.getRequestStatus(42)
      expect(result.Id).toBe(42)
    })
  })

  describe('non-JSON response', () => {
    it('throws a clear error for non-JSON body', async () => {
      const client = new DorcClient('https://dorc.example.com', TOKEN_CONFIG)

      mockTokenResponse()
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => {
          throw new SyntaxError('Unexpected token <')
        }
      })

      await expect(client.getRequestStatus(42)).rejects.toThrow(
        'returned non-JSON response'
      )
    })
  })

  describe('error text handling', () => {
    it('truncates long error bodies', async () => {
      const client = new DorcClient('https://dorc.example.com', TOKEN_CONFIG)

      mockTokenResponse()
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () => 'x'.repeat(1000)
      })

      await expect(client.getRequestStatus(42)).rejects.toThrow(/\.\.\.$/)
    })

    it('handles response.text() throwing', async () => {
      const client = new DorcClient('https://dorc.example.com', TOKEN_CONFIG)

      mockTokenResponse()
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => {
          throw new Error('body stream already read')
        }
      })

      await expect(client.getRequestStatus(42)).rejects.toThrow(
        'Could not read response body'
      )
    })
  })

  describe('pollUntilComplete', () => {
    it('checks status immediately without sleeping first', async () => {
      const client = new DorcClient('https://dorc.example.com', TOKEN_CONFIG)

      mockTokenResponse()
      mockApiResponse({ Id: 1, Status: 'Completed' })

      const start = Date.now()
      const status = await client.pollUntilComplete(1, 60, 1)
      const elapsed = Date.now() - start

      expect(status).toBe('Completed')
      // Should complete in well under 60 seconds (no pre-sleep)
      expect(elapsed).toBeLessThan(5000)
    })

    it('polls through multiple statuses until terminal', async () => {
      const client = new DorcClient('https://dorc.example.com', TOKEN_CONFIG)

      mockTokenResponse()
      mockApiResponse({ Id: 1, Status: 'InProgress' })
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
      for (let i = 0; i < 20; i++) {
        mockApiResponse({ Id: 1, Status: 'InProgress' })
      }

      await expect(client.pollUntilComplete(1, 0.01, 0.001)).rejects.toThrow(
        'Deployment timed out'
      )
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

      expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Comp1'))
      expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Comp2'))
    })

    it('logs a message when no results returned', async () => {
      const core = jest.requireMock('@actions/core')
      const client = new DorcClient('https://dorc.example.com', TOKEN_CONFIG)

      mockTokenResponse()
      mockApiResponse([])

      await client.logComponentResults(1)

      expect(core.info).toHaveBeenCalledWith('No component results returned.')
    })
  })

  describe('isSuccessStatus', () => {
    it('returns true for Completed', () => {
      expect(DorcClient.isSuccessStatus('Completed')).toBe(true)
    })

    it('returns false for Errored', () => {
      expect(DorcClient.isSuccessStatus('Errored')).toBe(false)
    })

    it('returns false for Failed', () => {
      expect(DorcClient.isSuccessStatus('Failed')).toBe(false)
    })
  })
})
