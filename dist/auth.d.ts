export interface TokenState {
    accessToken: string;
    expiresAt: Date;
}
export interface TokenConfig {
    tokenUrl: string;
    clientSecret: string;
}
export declare function fetchAccessToken(config: TokenConfig): Promise<TokenState>;
export declare function isTokenExpired(state: TokenState): boolean;
export declare function resolveTokenUrl(baseUrl: string): Promise<string>;
