export interface TokenState {
  accessToken: string
  expiresAt: Date
}

export interface TokenConfig {
  tokenUrl: string
  clientSecret: string
}

const REFRESH_WINDOW_SECONDS = 120
const FETCH_TIMEOUT_MS = 30_000

export async function fetchAccessToken(
  config: TokenConfig
): Promise<TokenState> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: 'dorc-cli',
    client_secret: config.clientSecret,
    scope: 'dorc-api.manage'
  })

  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  })

  if (!response.ok) {
    throw new Error(
      `Failed to obtain access token: ${response.status} ${response.statusText}`
    )
  }

  const data: unknown = await response.json()
  if (
    typeof data !== 'object' ||
    data === null ||
    !('access_token' in data) ||
    typeof (data as Record<string, unknown>).access_token !== 'string'
  ) {
    throw new Error(
      'Invalid token response: missing or invalid access_token field'
    )
  }

  const tokenData = data as { access_token: string; expires_in?: number }
  const expiresIn = tokenData.expires_in ?? 3600
  const safeExpiry = Math.max(expiresIn - REFRESH_WINDOW_SECONDS, 30)

  return {
    accessToken: tokenData.access_token,
    expiresAt: new Date(Date.now() + safeExpiry * 1000)
  }
}

export function isTokenExpired(state: TokenState): boolean {
  return new Date() >= state.expiresAt
}

export async function resolveTokenUrl(baseUrl: string): Promise<string> {
  const url = `${baseUrl.replace(/\/+$/, '')}/ApiConfig`
  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  })
  if (!response.ok) {
    throw new Error(
      `Failed to get API config: ${response.status} ${response.statusText}`
    )
  }
  const config: unknown = await response.json()
  if (
    typeof config !== 'object' ||
    config === null ||
    !('OAuthAuthority' in config) ||
    typeof (config as Record<string, unknown>).OAuthAuthority !== 'string' ||
    !(config as Record<string, unknown>).OAuthAuthority
  ) {
    throw new Error(
      'DOrc API config response missing or empty OAuthAuthority field'
    )
  }

  const authority = (
    config as { OAuthAuthority: string }
  ).OAuthAuthority.replace(/\/+$/, '')

  try {
    new URL(authority)
  } catch {
    throw new Error(`OAuthAuthority is not a valid URL: ${authority}`)
  }

  return `${authority}/connect/token`
}
