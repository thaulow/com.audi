// Audi Connect Authentication
// Multi-stage PKCE OAuth2 flow through VW Group identity services

import * as crypto from 'crypto';
import {
  BFF_DOMAINS,
  CLIENT_IDS,
  IDK_HOST,
  IDK_SCOPES,
  MBB_CLIENT_ID,
  MBB_OAUTH_HOST,
  PKCE_CODE_VERIFIER_LENGTH,
  QMAUTH_SECRET,
  TOKEN_REFRESH_BUFFER,
  USER_AGENT,
  X_APP_NAME,
  X_APP_VERSION,
} from './constants';
import type { AuthTokens, AudiCredentials, MbbTokenSet, Region, TokenSet } from './types';

/**
 * Generates the X-QMAuth header value.
 * Based on HMAC-SHA256 with a 100-second time interval.
 */
export function generateQMAuth(): string {
  const timestamp = Math.floor(Date.now() / 1000 / 100);
  const hmac = crypto.createHmac('sha256', QMAUTH_SECRET);
  hmac.update(timestamp.toString());
  const hex = hmac.digest('hex');
  return `v1:01da27b0:${hex}`;
}

/**
 * Generate PKCE code verifier and challenge
 */
function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(PKCE_CODE_VERIFIER_LENGTH)
    .toString('base64url')
    .slice(0, PKCE_CODE_VERIFIER_LENGTH);

  const challenge = crypto
    .createHash('sha256')
    .update(verifier)
    .digest('base64url');

  return { verifier, challenge };
}

/**
 * Generate a random state string
 */
function generateState(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Parse URL query/fragment parameters
 */
function parseParams(url: string): Record<string, string> {
  const params: Record<string, string> = {};
  const urlObj = new URL(url);

  // Check query params
  urlObj.searchParams.forEach((value, key) => {
    params[key] = value;
  });

  // Check fragment params
  if (urlObj.hash) {
    const fragmentParams = new URLSearchParams(urlObj.hash.slice(1));
    fragmentParams.forEach((value, key) => {
      params[key] = value;
    });
  }

  return params;
}

/**
 * Follow redirects manually to capture intermediate URLs and cookies
 */
async function fetchWithManualRedirects(
  url: string,
  options: RequestInit,
  maxRedirects = 10
): Promise<{ response: Response; redirectChain: string[] }> {
  const redirectChain: string[] = [];
  let currentUrl = url;
  let currentOptions = { ...options };

  for (let i = 0; i < maxRedirects; i++) {
    const response = await fetch(currentUrl, {
      ...currentOptions,
      redirect: 'manual',
    });

    const location = response.headers.get('location');
    if (location && (response.status === 301 || response.status === 302 || response.status === 303)) {
      const nextUrl = location.startsWith('http') ? location : new URL(location, currentUrl).toString();
      redirectChain.push(nextUrl);
      currentUrl = nextUrl;
      // Switch to GET for 303 redirects
      if (response.status === 303) {
        currentOptions = { ...currentOptions, method: 'GET', body: undefined };
      }
      continue;
    }

    return { response, redirectChain };
  }

  throw new Error('Too many redirects');
}

/**
 * Handles the complete Audi Connect authentication flow
 */
export class AudiAuth {
  private credentials: AudiCredentials;
  private tokens: AuthTokens | null = null;
  private openIdConfig: any = null;

  constructor(credentials: AudiCredentials) {
    this.credentials = credentials;
  }

  /**
   * Get current tokens, refreshing if needed
   */
  async getTokens(): Promise<AuthTokens> {
    if (!this.tokens) {
      await this.login();
    }

    const now = Math.floor(Date.now() / 1000);
    if (this.tokens!.idk.expiresAt - TOKEN_REFRESH_BUFFER < now) {
      await this.refreshTokens();
    }

    return this.tokens!;
  }

  /**
   * Get the access token for API calls
   */
  async getAccessToken(): Promise<string> {
    const tokens = await this.getTokens();
    return tokens.idk.accessToken;
  }

  /**
   * Get the MBB access token for legacy VW Group API calls
   */
  async getMbbAccessToken(): Promise<string> {
    const tokens = await this.getTokens();
    return tokens.mbb.accessToken;
  }

  /**
   * Get the BFF domain for the current region
   */
  getBffDomain(): string {
    return BFF_DOMAINS[this.credentials.region];
  }

  /**
   * Full login flow
   */
  async login(): Promise<void> {
    // Step 1: Get OpenID configuration
    await this.fetchOpenIdConfig();

    // Step 2: Get authorization code via PKCE
    const { code, pkceVerifier } = await this.getAuthorizationCode();

    // Step 3: Exchange code for IDK tokens
    const idkTokens = await this.exchangeCodeForTokens(code, pkceVerifier);

    // Step 4: Exchange IDK token for AZS token
    const azsTokens = await this.exchangeForAzsToken(idkTokens.idToken);

    // Step 5: Exchange for MBB token
    const mbbTokens = await this.exchangeForMbbToken(idkTokens.idToken);

    this.tokens = {
      idk: idkTokens,
      azs: azsTokens,
      mbb: mbbTokens,
    };
  }

  /**
   * Fetch OpenID configuration from the identity provider
   */
  private async fetchOpenIdConfig(): Promise<void> {
    const clientId = CLIENT_IDS[this.credentials.region];
    const url = `https://${IDK_HOST}/oidc/v1/${clientId}/.well-known/openid-configuration`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch OpenID config: ${response.status}`);
    }

    this.openIdConfig = await response.json();
  }

  /**
   * Get authorization code through PKCE flow
   */
  private async getAuthorizationCode(): Promise<{ code: string; pkceVerifier: string }> {
    const pkce = generatePKCE();
    const state = generateState();
    const nonce = generateState();
    const clientId = CLIENT_IDS[this.credentials.region];

    const authEndpoint = this.openIdConfig.authorization_endpoint;

    // Build authorization URL
    const authParams = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: 'myaudi:///redirect',
      scope: IDK_SCOPES,
      state: state,
      nonce: nonce,
      code_challenge: pkce.challenge,
      code_challenge_method: 'S256',
      prompt: 'login',
    });

    const authUrl = `${authEndpoint}?${authParams.toString()}`;

    // Step 1: GET the auth page to get the form action URL and cookies
    const authResponse = await fetch(authUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html',
      },
      redirect: 'manual',
    });

    // Follow redirect to login form
    let loginFormUrl: string;
    const location = authResponse.headers.get('location');
    if (location) {
      loginFormUrl = location.startsWith('http') ? location : `https://${IDK_HOST}${location}`;
    } else {
      loginFormUrl = authUrl;
    }

    // Step 2: Submit email/identifier
    const emailFormData = new URLSearchParams({
      email: this.credentials.username,
      relayState: state,
      hmac: '',
    });

    const { response: emailResponse, redirectChain: emailRedirects } = await fetchWithManualRedirects(
      `https://${IDK_HOST}/signin-service/v1/${clientId}/login/identifier`,
      {
        method: 'POST',
        headers: {
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'text/html',
        },
        body: emailFormData.toString(),
      }
    );

    // Step 3: Submit password
    const passwordFormData = new URLSearchParams({
      email: this.credentials.username,
      password: this.credentials.password,
      relayState: state,
      hmac: '',
    });

    const { response: pwResponse, redirectChain: pwRedirects } = await fetchWithManualRedirects(
      `https://${IDK_HOST}/signin-service/v1/${clientId}/login/authenticate`,
      {
        method: 'POST',
        headers: {
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'text/html',
        },
        body: passwordFormData.toString(),
      }
    );

    // Find the redirect with the authorization code
    let code: string | undefined;
    const allRedirects = [...emailRedirects, ...pwRedirects];

    // Also check the final response location
    const finalLocation = pwResponse.headers.get('location');
    if (finalLocation) {
      allRedirects.push(finalLocation);
    }

    for (const redirectUrl of allRedirects) {
      if (redirectUrl.includes('myaudi:///redirect') || redirectUrl.includes('code=')) {
        const params = parseParams(redirectUrl);
        if (params.code) {
          code = params.code;
          break;
        }
      }
    }

    if (!code) {
      // Try to extract from consent flow if needed
      throw new Error('Failed to obtain authorization code. Check credentials.');
    }

    return { code, pkceVerifier: pkce.verifier };
  }

  /**
   * Exchange authorization code for IDK tokens
   */
  private async exchangeCodeForTokens(code: string, verifier: string): Promise<TokenSet> {
    const tokenEndpoint = this.openIdConfig.token_endpoint;
    const clientId = CLIENT_IDS[this.credentials.region];

    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: 'myaudi:///redirect',
      client_id: clientId,
      code_verifier: verifier,
    });

    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'X-QMAuth': generateQMAuth(),
      },
      body: tokenParams.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Token exchange failed: ${response.status} - ${text}`);
    }

    const data = await response.json() as any;
    const now = Math.floor(Date.now() / 1000);

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      idToken: data.id_token,
      expiresAt: now + (data.expires_in || 3600),
    };
  }

  /**
   * Exchange IDK id_token for AZS token
   */
  private async exchangeForAzsToken(idToken: string): Promise<TokenSet> {
    const clientId = CLIENT_IDS[this.credentials.region];

    const params = new URLSearchParams({
      grant_type: 'id_token',
      token: idToken,
      scope: 'sc2:fal',
    });

    const response = await fetch(
      `https://${IDK_HOST}/oidc/v1/${clientId}/token`,
      {
        method: 'POST',
        headers: {
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'X-QMAuth': generateQMAuth(),
        },
        body: params.toString(),
      }
    );

    if (!response.ok) {
      throw new Error(`AZS token exchange failed: ${response.status}`);
    }

    const data = await response.json() as any;
    const now = Math.floor(Date.now() / 1000);

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      idToken: data.id_token || idToken,
      expiresAt: now + (data.expires_in || 3600),
    };
  }

  /**
   * Exchange for MBB OAuth token (for legacy VW Group API)
   */
  private async exchangeForMbbToken(idToken: string): Promise<MbbTokenSet> {
    const params = new URLSearchParams({
      grant_type: 'id_token',
      token: idToken,
      scope: 'sc2:fal',
    });

    const response = await fetch(
      `https://${MBB_OAUTH_HOST}/mbbcoauth/mobile/oauth2/v1/token`,
      {
        method: 'POST',
        headers: {
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'X-Client-ID': MBB_CLIENT_ID,
        },
        body: params.toString(),
      }
    );

    if (!response.ok) {
      throw new Error(`MBB token exchange failed: ${response.status}`);
    }

    const data = await response.json() as any;
    const now = Math.floor(Date.now() / 1000);

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: now + (data.expires_in || 3600),
    };
  }

  /**
   * Refresh tokens when they're about to expire
   */
  async refreshTokens(): Promise<void> {
    if (!this.tokens) {
      await this.login();
      return;
    }

    try {
      // Refresh IDK token
      const tokenEndpoint = this.openIdConfig.token_endpoint;
      const clientId = CLIENT_IDS[this.credentials.region];

      const params = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.tokens.idk.refreshToken,
        client_id: clientId,
      });

      const response = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: {
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'X-QMAuth': generateQMAuth(),
        },
        body: params.toString(),
      });

      if (!response.ok) {
        // Refresh failed, do a full login
        await this.login();
        return;
      }

      const data = await response.json() as any;
      const now = Math.floor(Date.now() / 1000);

      this.tokens.idk = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || this.tokens.idk.refreshToken,
        idToken: data.id_token || this.tokens.idk.idToken,
        expiresAt: now + (data.expires_in || 3600),
      };

      // Refresh AZS token
      const azsTokens = await this.exchangeForAzsToken(this.tokens.idk.idToken);
      this.tokens.azs = azsTokens;

      // Refresh MBB token
      const mbbTokens = await this.exchangeForMbbToken(this.tokens.idk.idToken);
      this.tokens.mbb = mbbTokens;
    } catch (error) {
      // On any refresh error, attempt full login
      await this.login();
    }
  }

  /**
   * Calculate S-PIN hash for secure operations
   */
  async calculateSpinHash(challenge: string): Promise<string> {
    const spinBytes = Buffer.from(this.credentials.spin, 'utf-8');
    const challengeBytes = Buffer.from(challenge, 'hex');
    const combined = Buffer.concat([spinBytes, challengeBytes]);
    const hash = crypto.createHash('sha512').update(combined).digest('hex');
    return hash;
  }
}
