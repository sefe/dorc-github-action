import { fetchAccessToken, isTokenExpired, resolveTokenUrl } from '../src/auth'

const mockFetch = jest.fn()
global.fetch = mockFetch

beforeEach(() => {
  mockFetch.mockReset()
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

    const config = {
      tokenUrl: 'https://ids.example.com/connect/token',
      clientSecret: 'secret123'
    }

    const result = await fetchAccessToken(config)
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
