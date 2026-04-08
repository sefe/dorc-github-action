import {
  fetchAccessToken,
  isTokenExpired,
  resolveTokenUrl,
  validateHttpUrl
} from '../src/auth'

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

describe('validateHttpUrl', () => {
  it('accepts https URLs', () => {
    expect(() => validateHttpUrl('https://example.com', 'test')).not.toThrow()
  })

  it('accepts http URLs', () => {
    expect(() => validateHttpUrl('http://example.com', 'test')).not.toThrow()
  })

  it('rejects non-URL strings', () => {
    expect(() => validateHttpUrl('not-a-url', 'test')).toThrow(
      'not a valid URL'
    )
  })

  it('rejects javascript: URLs', () => {
    expect(() => validateHttpUrl('javascript:alert(1)', 'test')).toThrow(
      'must use http or https'
    )
  })

  it('rejects file: URLs', () => {
    expect(() => validateHttpUrl('file:///etc/passwd', 'test')).toThrow(
      'must use http or https'
    )
  })

  it('rejects ftp: URLs', () => {
    expect(() => validateHttpUrl('ftp://example.com', 'test')).toThrow(
      'must use http or https'
    )
  })
})

describe('resolveTokenUrl', () => {
  it('returns the token URL from ApiConfig', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ OAuthAuthority: 'https://ids.example.com' })
    })

    const url = await resolveTokenUrl('https://dorc.example.com')
    expect(url).toBe('https://ids.example.com/connect/token')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://dorc.example.com/ApiConfig',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  })

  it('strips trailing slash from baseUrl', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ OAuthAuthority: 'https://ids.example.com' })
    })

    await resolveTokenUrl('https://dorc.example.com/')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://dorc.example.com/ApiConfig',
      expect.anything()
    )
  })

  it('strips trailing slash from OAuthAuthority', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ OAuthAuthority: 'https://ids.example.com/' })
    })

    const url = await resolveTokenUrl('https://dorc.example.com')
    expect(url).toBe('https://ids.example.com/connect/token')
  })

  it('throws on non-OK response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error'
    })

    await expect(resolveTokenUrl('https://dorc.example.com')).rejects.toThrow(
      'Failed to get API config: 500'
    )
  })

  it('throws when OAuthAuthority is missing', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ SomethingElse: 'value' })
    })

    await expect(resolveTokenUrl('https://dorc.example.com')).rejects.toThrow(
      'missing or empty OAuthAuthority'
    )
  })

  it('throws when OAuthAuthority is empty string', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ OAuthAuthority: '' })
    })

    await expect(resolveTokenUrl('https://dorc.example.com')).rejects.toThrow(
      'missing or empty OAuthAuthority'
    )
  })

  it('throws when OAuthAuthority is not a valid URL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ OAuthAuthority: 'not-a-url' })
    })

    await expect(resolveTokenUrl('https://dorc.example.com')).rejects.toThrow(
      'not a valid URL'
    )
  })

  it('rejects non-http/https OAuthAuthority', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ OAuthAuthority: 'ftp://ids.example.com' })
    })

    await expect(resolveTokenUrl('https://dorc.example.com')).rejects.toThrow(
      'must use http or https'
    )
  })

  it('retries on transient network errors', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'))
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ OAuthAuthority: 'https://ids.example.com' })
    })

    const url = await resolveTokenUrl('https://dorc.example.com')
    expect(url).toBe('https://ids.example.com/connect/token')
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('retries on timeout errors', async () => {
    const timeoutError = Object.assign(new Error('signal timed out'), {
      name: 'TimeoutError'
    })
    mockFetch.mockRejectedValueOnce(timeoutError)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ OAuthAuthority: 'https://ids.example.com' })
    })

    const url = await resolveTokenUrl('https://dorc.example.com')
    expect(url).toBe('https://ids.example.com/connect/token')
  })
})

describe('fetchAccessToken', () => {
  it('returns a token with calculated expiry', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'test-token-123',
        expires_in: 3600
      })
    })

    const result = await fetchAccessToken({
      tokenUrl: 'https://ids.example.com/connect/token',
      clientSecret: 'secret123'
    })
    expect(result.accessToken).toBe('test-token-123')
    expect(result.expiresAt).toBeInstanceOf(Date)
    const expectedMs = Date.now() + 3480 * 1000
    expect(result.expiresAt.getTime()).toBeGreaterThan(expectedMs - 5000)
    expect(result.expiresAt.getTime()).toBeLessThan(expectedMs + 5000)
  })

  it('defaults to 3600 if expires_in is missing', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'tok' })
    })

    const result = await fetchAccessToken({
      tokenUrl: 'https://ids.example.com/connect/token',
      clientSecret: 'secret'
    })
    expect(result.accessToken).toBe('tok')
  })

  it('defaults to 3600 if expires_in is a string', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'tok', expires_in: 'never' })
    })

    const result = await fetchAccessToken({
      tokenUrl: 'https://ids.example.com/connect/token',
      clientSecret: 'secret'
    })
    // Should default to 3600, safe expiry = 3600 - 120 = 3480
    const expectedMs = Date.now() + 3480 * 1000
    expect(result.expiresAt.getTime()).toBeGreaterThan(expectedMs - 5000)
    expect(result.expiresAt.getTime()).toBeLessThan(expectedMs + 5000)
  })

  it('floors safeExpiry at 30 seconds for very short expires_in', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'tok', expires_in: 1 })
    })

    const result = await fetchAccessToken({
      tokenUrl: 'https://ids.example.com/connect/token',
      clientSecret: 'secret'
    })
    const expectedMs = Date.now() + 30 * 1000
    expect(result.expiresAt.getTime()).toBeGreaterThan(expectedMs - 5000)
    expect(result.expiresAt.getTime()).toBeLessThan(expectedMs + 5000)
  })

  it('throws on non-OK response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized'
    })

    await expect(
      fetchAccessToken({
        tokenUrl: 'https://ids.example.com/connect/token',
        clientSecret: 'bad-secret'
      })
    ).rejects.toThrow('Failed to obtain access token: 401')
  })

  it('throws when access_token is missing from response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token_type: 'bearer' })
    })

    await expect(
      fetchAccessToken({
        tokenUrl: 'https://ids.example.com/connect/token',
        clientSecret: 'secret'
      })
    ).rejects.toThrow('Invalid token response')
  })
})

describe('isTokenExpired', () => {
  it('returns false for future expiry', () => {
    expect(
      isTokenExpired({
        accessToken: 'tok',
        expiresAt: new Date(Date.now() + 60000)
      })
    ).toBe(false)
  })

  it('returns true for past expiry', () => {
    expect(
      isTokenExpired({
        accessToken: 'tok',
        expiresAt: new Date(Date.now() - 1000)
      })
    ).toBe(true)
  })
})
