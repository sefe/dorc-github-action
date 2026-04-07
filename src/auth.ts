export interface TokenState {
  accessToken: string
  expiresAt: Date
}

export interface TokenConfig {
  tokenUrl: string
  clientSecret: string
}

const REFRESH_WINDOW_SECONDS = 120

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
    body: body.toString()
  })

  if (!response.ok) {
    throw new Error(
      `Failed to obtain access token: ${response.status} ${response.statusText}`
    )
  }

  const data = (await response.json()) as { access_token: string; expires_in?: number }
  const expiresIn = data.expires_in ?? 3600
  const safeExpiry = Math.max(expiresIn - REFRESH_WINDOW_SECONDS, 30)

  return {
    accessToken: data.access_token,
    expiresAt: new Date(Date.now() + safeExpiry * 1000)
  }
}

export function isTokenExpired(state: TokenState): boolean {
  return new Date() >= state.expiresAt
}

export async function resolveTokenUrl(baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/ApiConfig`)
  if (!response.ok) {
    throw new Error(
      `Failed to get API config: ${response.status} ${response.statusText}`
    )
  }
  const config = (await response.json()) as { OAuthAuthority: string }
  return `${config.OAuthAuthority}/connect/token`
}
