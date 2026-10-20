import * as ff from '@google-cloud/functions-framework';
import * as crypto from 'crypto';
import * as https from 'https';
import { URL, URLSearchParams } from 'url';
import { isHostAllowed } from './auth';

export type InstanceAuthMode = 'server_proxy' | 'oauth';

interface CachedOAuthUser {
  userId: string;
  expiresAt: number;
}

const OAUTH_TOKEN_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const oauthTokenCache = new Map<string, CachedOAuthUser>();

export function clearOAuthTokenCache(): void {
  oauthTokenCache.clear();
}

export function normalizeAuthMode(rawMode?: string): InstanceAuthMode {
  const cleaned = (rawMode || '').trim().toLowerCase();
  if (cleaned === 'oauth' || cleaned === 'private' || cleaned === 'hybrid') {
    return 'oauth';
  }
  return 'server_proxy';
}

export function resolveInstanceAuthMode(host: string, authModesEnv?: string): InstanceAuthMode {
  const cleanHost = sanitizeLookerHost(host);
  if (!cleanHost) return 'server_proxy';

  const rawEnv = (
    authModesEnv !== undefined
      ? authModesEnv
      : (process.env.LOOKER_INSTANCE_AUTH_MODES || process.env.INSTANCE_AUTH_MODES || '')
  ).trim();

  if (!rawEnv) return 'server_proxy';

  // Support JSON map format: {"instance.looker.com":"oauth"}
  if (rawEnv.startsWith('{')) {
    try {
      const parsed = JSON.parse(rawEnv);
      if (parsed && typeof parsed === 'object') {
        const directMatch = parsed[cleanHost];
        if (directMatch) return normalizeAuthMode(String(directMatch));
        const matchingKey = Object.keys(parsed).find(
          (k) => sanitizeLookerHost(k) === cleanHost
        );
        if (matchingKey) return normalizeAuthMode(String(parsed[matchingKey]));
      }
    } catch {
      // Fall through to key=value parsing
    }
  }

  // Support comma- or semicolon-separated format: host1=oauth;host2=server_proxy
  const entries = rawEnv.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
  for (const entry of entries) {
    const [entryHost, entryMode] = entry.split('=').map((s) => s.trim());
    if (sanitizeLookerHost(entryHost) === cleanHost) {
      return normalizeAuthMode(entryMode);
    }
  }

  return 'server_proxy';
}

export function sanitizeLookerHost(rawHost: string): string {
  if (!rawHost) return '';
  let cleaned = rawHost.trim().toLowerCase();
  cleaned = cleaned.replace(/^https?:\/\//, '');
  cleaned = cleaned.replace(/\/.*$/, '');
  return cleaned;
}

export function extractTargetHostFromRedirectUri(redirectUri: string): { host: string | null; error?: string } {
  if (!redirectUri || typeof redirectUri !== 'string') {
    return { host: null, error: 'Missing required parameter: redirect_uri' };
  }
  try {
    const parsed = new URL(redirectUri);
    const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (parsed.protocol !== 'https:' && !(isLocalhost && parsed.protocol === 'http:')) {
      return { host: null, error: 'Invalid redirect_uri protocol; https is required.' };
    }
    if (!parsed.pathname.endsWith('/extensions/oauth2_redirect')) {
      return { host: null, error: 'Invalid redirect_uri path; must end with /extensions/oauth2_redirect.' };
    }
    return { host: parsed.host.toLowerCase() };
  } catch {
    return { host: null, error: 'Malformed redirect_uri URL.' };
  }
}

/**
 * Handles GET/POST /oauth/authorize
 * Validates the target Looker host from redirect_uri against LOOKER_ALLOWED_INSTANCES
 * and 302 redirects the popup browser to https://<looker-host>/auth?<params>.
 */
export function handleOAuthAuthorize(req: ff.Request, res: ff.Response): void {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const combinedParams: Record<string, string> = {};
  if (req.query && typeof req.query === 'object') {
    for (const [k, v] of Object.entries(req.query)) {
      if (v !== undefined && v !== null) {
        combinedParams[k] = String(v);
      }
    }
  }
  if (req.body && typeof req.body === 'object') {
    for (const [k, v] of Object.entries(req.body)) {
      if (v !== undefined && v !== null) {
        combinedParams[k] = String(v);
      }
    }
  }

  const redirectUri = combinedParams.redirect_uri || '';
  const { host, error } = extractTargetHostFromRedirectUri(redirectUri);
  if (!host) {
    res.status(400).json({
      error: 'invalid_request',
      error_description: error || 'Invalid redirect_uri'
    });
    return;
  }

  if (!isHostAllowed(host, process.env.LOOKER_ALLOWED_INSTANCES)) {
    console.warn(`[OAuth] Authorize rejected: Host "${host}" is not in LOOKER_ALLOWED_INSTANCES.`);
    res.status(403).json({
      error: 'forbidden',
      error_description: `Looker instance host "${host}" is not permitted by this service.`
    });
    return;
  }

  const searchParams = new URLSearchParams(combinedParams);
  const targetAuthUrl = `https://${host}/auth?${searchParams.toString()}`;
  console.log(`[OAuth] Redirecting authorization request to Looker instance: ${host}`);
  res.redirect(302, targetAuthUrl);
}

export type HttpFormPostFn = (
  urlStr: string,
  formBody: string
) => Promise<{ statusCode: number; body: string }>;

export type FetchLookerUserFn = (
  host: string,
  accessToken: string
) => Promise<{ statusCode: number; body: string }>;

/**
 * Handles POST /oauth/token
 * Proxies the OAuth2 PKCE code exchange (or refresh_token exchange) server-to-server
 * to https://<looker-host>/api/token so the extension avoids Looker's same-origin block.
 */
export async function handleOAuthTokenExchange(
  req: ff.Request,
  res: ff.Response,
  httpPostFn: HttpFormPostFn = defaultHttpFormPost
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const bodyParams: Record<string, string> = {};
  if (req.body && typeof req.body === 'object') {
    for (const [k, v] of Object.entries(req.body)) {
      if (v !== undefined && v !== null) {
        bodyParams[k] = String(v);
      }
    }
  } else if (typeof req.body === 'string') {
    const parsed = new URLSearchParams(req.body);
    parsed.forEach((v, k) => {
      bodyParams[k] = v;
    });
  }

  let targetHost: string | null = null;
  if (bodyParams.redirect_uri) {
    const extracted = extractTargetHostFromRedirectUri(bodyParams.redirect_uri);
    if (extracted.error) {
      res.status(400).json({
        error: 'invalid_request',
        error_description: extracted.error
      });
      return;
    }
    targetHost = extracted.host;
  } else {
    const rawFallbackHost = String(
      req.query?.instance_host ||
      req.headers['x-looker-instance-host'] ||
      req.headers['x-looker-host'] ||
      ''
    );
    targetHost = sanitizeLookerHost(rawFallbackHost) || null;
  }

  if (!targetHost) {
    res.status(400).json({
      error: 'invalid_request',
      error_description: 'Could not determine target Looker instance host from redirect_uri or instance_host.'
    });
    return;
  }

  if (!isHostAllowed(targetHost, process.env.LOOKER_ALLOWED_INSTANCES)) {
    console.warn(`[OAuth] Token exchange rejected: Host "${targetHost}" is not in LOOKER_ALLOWED_INSTANCES.`);
    res.status(403).json({
      error: 'forbidden',
      error_description: `Looker instance host "${targetHost}" is not permitted by this service.`
    });
    return;
  }

  const formParams = new URLSearchParams();
  for (const [k, v] of Object.entries(bodyParams)) {
    formParams.set(k, v);
  }

  const tokenEndpoint = `https://${targetHost}/api/token`;
  console.log(`[OAuth] Proxying token exchange (${bodyParams.grant_type || 'unknown'}) to ${targetHost}`);

  try {
    const upstream = await httpPostFn(tokenEndpoint, formParams.toString());
    let parsedBody: any = upstream.body;
    try {
      parsedBody = JSON.parse(upstream.body);
    } catch {
      // Keep raw string if not valid JSON
    }
    res.status(upstream.statusCode).json(parsedBody);
  } catch (err: any) {
    console.error(`[OAuth] Token exchange failed for ${targetHost}:`, err);
    res.status(502).json({
      error: 'bad_gateway',
      error_description: `Failed to reach Looker token endpoint on ${targetHost}: ${err.message || String(err)}`
    });
  }
}

/**
 * Verifies a Looker OAuth 2.0 Bearer access_token against the target Looker instance's
 * /api/4.0/user?fields=id endpoint, with an in-memory SHA-256 token cache.
 */
export async function verifyLookerOAuthToken(
  instanceHost: string,
  accessToken: string,
  expectedUserId?: string,
  fetchUserFn: FetchLookerUserFn = defaultFetchLookerUser
): Promise<{ status: 'valid' | 'invalid'; userId: string }> {
  const cleanHost = sanitizeLookerHost(instanceHost);
  const cleanToken = (accessToken || '').trim();
  const cleanExpectedUser = (expectedUserId || '').trim();

  if (!cleanHost || !cleanToken) {
    return { status: 'invalid', userId: cleanExpectedUser };
  }

  const tokenHash = crypto.createHash('sha256').update(`${cleanHost}:${cleanToken}`).digest('hex');
  const now = Date.now();
  const cached = oauthTokenCache.get(tokenHash);

  if (cached && now < cached.expiresAt) {
    if (cleanExpectedUser && cached.userId !== cleanExpectedUser) {
      console.warn(`[OAuth] Cached token user mismatch: token belongs to ${cached.userId}, header claimed ${cleanExpectedUser}`);
      return { status: 'invalid', userId: cleanExpectedUser };
    }
    return { status: 'valid', userId: cached.userId };
  }

  try {
    const response = await fetchUserFn(cleanHost, cleanToken);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      oauthTokenCache.delete(tokenHash);
      return { status: 'invalid', userId: cleanExpectedUser };
    }

    const userObj = JSON.parse(response.body);
    const verifiedUserId = userObj && userObj.id !== undefined && userObj.id !== null
      ? String(userObj.id).trim()
      : '';

    if (!verifiedUserId) {
      return { status: 'invalid', userId: cleanExpectedUser };
    }

    if (cleanExpectedUser && verifiedUserId !== cleanExpectedUser) {
      console.warn(`[OAuth] Verified Looker user ID (${verifiedUserId}) does not match X-Looker-User-ID header (${cleanExpectedUser}).`);
      return { status: 'invalid', userId: cleanExpectedUser };
    }

    oauthTokenCache.set(tokenHash, {
      userId: verifiedUserId,
      expiresAt: now + OAUTH_TOKEN_CACHE_TTL_MS
    });

    return { status: 'valid', userId: verifiedUserId };
  } catch (err: any) {
    console.error(`[OAuth] Error verifying Bearer token against ${cleanHost}:`, err.message || err);
    return { status: 'invalid', userId: cleanExpectedUser };
  }
}

function defaultHttpFormPost(urlStr: string, formBody: string): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const bodyBuffer = Buffer.from(formBody, 'utf8');
    const options: https.RequestOptions = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'Accept': 'application/json',
        'Content-Length': bodyBuffer.byteLength
      },
      rejectUnauthorized: true
    };

    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 500,
          body: data
        });
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.write(bodyBuffer);
    req.end();
  });
}

function defaultFetchLookerUser(host: string, accessToken: string): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(`https://${host}/api/4.0/user?fields=id`);
    const options: https.RequestOptions = {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      },
      rejectUnauthorized: true
    };

    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 500,
          body: data
        });
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.end();
  });
}
