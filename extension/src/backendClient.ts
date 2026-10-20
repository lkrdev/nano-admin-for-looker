import { BACKEND_URL, INSTANCE_AUTH_MODES, OAUTH_CLIENT_ID } from './config';

export type InstanceAuthMode = 'server_proxy' | 'oauth';

export interface StoredOAuthToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

export interface BackendRequestOptions {
  extensionSDK: any;
  userId: string;
  payload: Record<string, any>;
  allowInteractiveOAuth?: boolean;
  onBuildHash?: (data: any) => void;
  addLog?: (msg: string) => void;
}

export interface BackendResponse {
  ok: boolean;
  status: number;
  body: any;
}

const memoryTokenStore = new Map<string, StoredOAuthToken>();

export function getLookerHost(extensionSDK: any): string {
  return (
    (extensionSDK as any)?.lookerHostData?.hostUrl ||
    (extensionSDK as any)?.lookerHostData?.hostOrigin ||
    ''
  );
}

export function sanitizeLookerHost(rawHost: string): string {
  if (!rawHost) return '';
  let cleaned = rawHost.trim().toLowerCase();
  cleaned = cleaned.replace(/^https?:\/\//, '');
  cleaned = cleaned.replace(/\/.*$/, '');
  return cleaned;
}

export function normalizeAuthMode(rawMode?: string): InstanceAuthMode {
  const cleaned = (rawMode || '').trim().toLowerCase();
  if (cleaned === 'oauth' || cleaned === 'private' || cleaned === 'hybrid') {
    return 'oauth';
  }
  return 'server_proxy';
}

export function resolveInstanceAuthMode(
  rawHost: string,
  authModesConfig: string = INSTANCE_AUTH_MODES
): InstanceAuthMode {
  const cleanHost = sanitizeLookerHost(rawHost);
  const rawConfig = (authModesConfig || '').trim();
  if (!rawConfig) return 'server_proxy';

  // Direct single-mode value (e.g., INSTANCE_AUTH_MODES="oauth")
  if (!rawConfig.includes('{') && !rawConfig.includes('=') && !rawConfig.includes(':')) {
    return normalizeAuthMode(rawConfig);
  }

  // JSON map format: {"host.looker.app":"oauth"}
  if (rawConfig.startsWith('{')) {
    try {
      const parsed = JSON.parse(rawConfig);
      if (parsed && typeof parsed === 'object') {
        if (cleanHost && parsed[cleanHost]) {
          return normalizeAuthMode(String(parsed[cleanHost]));
        }
        const matchingKey = Object.keys(parsed).find(
          (k) => sanitizeLookerHost(k) === cleanHost
        );
        if (matchingKey) {
          return normalizeAuthMode(String(parsed[matchingKey]));
        }
        if (parsed['*'] || parsed['default']) {
          return normalizeAuthMode(String(parsed['*'] || parsed['default']));
        }
      }
    } catch {
      // Fall through to key=value parsing
    }
  }

  // Comma-separated format: host1=oauth,host2=server_proxy
  const entries = rawConfig.split(',').map((s) => s.trim()).filter(Boolean);
  for (const entry of entries) {
    const [entryHost, entryMode] = entry.split('=').map((s) => s.trim());
    if (sanitizeLookerHost(entryHost) === cleanHost || entryHost === '*') {
      return normalizeAuthMode(entryMode);
    }
  }

  return 'server_proxy';
}

function getStorageKey(lookerHost: string, userId: string): string {
  const cleanHost = sanitizeLookerHost(lookerHost) || 'default_host';
  const cleanUser = (userId || '').trim() || 'default_user';
  return `nano_admin_oauth_${cleanHost}_${cleanUser}`;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallbackValue: T): Promise<T> {
  let timer: any;
  const timeoutPromise = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallbackValue), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } catch {
    return fallbackValue;
  } finally {
    clearTimeout(timer);
  }
}

export async function getStoredOAuthToken(
  extensionSDK: any,
  lookerHost: string,
  userId: string
): Promise<StoredOAuthToken | null> {
  const key = getStorageKey(lookerHost, userId);
  const memToken = memoryTokenStore.get(key);
  if (memToken) {
    if (!memToken.expiresAt || Date.now() < memToken.expiresAt) {
      return memToken;
    }
  }

  if (extensionSDK && typeof extensionSDK.localStorageGetItem === 'function') {
    const rawStr = await withTimeout<string | null>(
      extensionSDK.localStorageGetItem(key),
      500,
      null
    );
    if (rawStr) {
      try {
        const parsed: StoredOAuthToken = JSON.parse(rawStr);
        if (parsed && parsed.accessToken) {
          if (!parsed.expiresAt || Date.now() < parsed.expiresAt) {
            memoryTokenStore.set(key, parsed);
            return parsed;
          }
        }
      } catch {
        // Ignore malformed local storage entry
      }
    }
  }

  return null;
}

export async function saveStoredOAuthToken(
  extensionSDK: any,
  lookerHost: string,
  userId: string,
  token: StoredOAuthToken
): Promise<void> {
  const key = getStorageKey(lookerHost, userId);
  memoryTokenStore.set(key, token);
  if (extensionSDK && typeof extensionSDK.localStorageSetItem === 'function') {
    await withTimeout(
      extensionSDK.localStorageSetItem(key, JSON.stringify(token)),
      500,
      false
    );
  }
}

export async function clearStoredOAuthToken(
  extensionSDK: any,
  lookerHost: string,
  userId: string
): Promise<void> {
  const key = getStorageKey(lookerHost, userId);
  memoryTokenStore.delete(key);
  if (extensionSDK && typeof extensionSDK.localStorageRemoveItem === 'function') {
    await withTimeout(
      extensionSDK.localStorageRemoveItem(key),
      500,
      false
    );
  }
}

export async function performOAuthLogin(
  extensionSDK: any,
  userId: string,
  addLog?: (msg: string) => void
): Promise<StoredOAuthToken> {
  const lookerHost = getLookerHost(extensionSDK);
  const baseBackendUrl = BACKEND_URL.replace(/\/+$/, '');
  const authorizeUrl = `${baseBackendUrl}/oauth/authorize`;
  const tokenUrl = `${baseBackendUrl}/oauth/token`;

  if (addLog) {
    addLog(`Starting Looker OAuth 2.0 PKCE flow via ${authorizeUrl}...`);
  }

  const authResponse = await extensionSDK.oauth2Authenticate(
    authorizeUrl,
    {
      client_id: OAUTH_CLIENT_ID,
      response_type: 'code',
      scope: 'cors_api',
      code_challenge_method: 'S256'
    },
    'GET'
  );

  const code = authResponse?.code;
  if (!code) {
    throw new Error(`OAuth authorization did not return an authorization code.`);
  }

  if (addLog) {
    addLog(`Authorization code received. Exchanging code for access token via ${tokenUrl}...`);
  }

  const exchangeResponse = await extensionSDK.oauth2ExchangeCodeForToken(tokenUrl, {
    grant_type: 'authorization_code',
    code,
    client_id: OAUTH_CLIENT_ID
  });

  const tokenData = exchangeResponse?.access_token
    ? exchangeResponse
    : exchangeResponse?.body;

  if (!tokenData || !tokenData.access_token) {
    const errDesc = tokenData?.error_description || tokenData?.error || 'Missing access_token in response';
    throw new Error(`OAuth token exchange failed: ${errDesc}`);
  }

  const expiresInSec = Number(tokenData.expires_in) || 3600;
  const storedToken: StoredOAuthToken = {
    accessToken: String(tokenData.access_token),
    refreshToken: tokenData.refresh_token ? String(tokenData.refresh_token) : undefined,
    expiresAt: Date.now() + Math.max(expiresInSec - 60, 60) * 1000
  };

  await saveStoredOAuthToken(extensionSDK, lookerHost, userId, storedToken);
  if (addLog) {
    addLog(`Looker OAuth access token obtained and cached successfully.`);
  }

  return storedToken;
}

export async function sendBackendRequest(options: BackendRequestOptions): Promise<BackendResponse> {
  const {
    extensionSDK,
    userId,
    payload,
    allowInteractiveOAuth = true,
    onBuildHash,
    addLog
  } = options;

  const lookerHost = getLookerHost(extensionSDK);
  const authMode = resolveInstanceAuthMode(lookerHost);

  if (authMode === 'oauth') {
    return sendOAuthBackendRequest({
      extensionSDK,
      lookerHost,
      userId,
      payload,
      allowInteractiveOAuth,
      onBuildHash,
      addLog
    });
  }

  return sendServerProxyBackendRequest({
    extensionSDK,
    lookerHost,
    userId,
    payload,
    onBuildHash,
    addLog
  });
}

async function sendServerProxyBackendRequest(params: {
  extensionSDK: any;
  lookerHost: string;
  userId: string;
  payload: Record<string, any>;
  onBuildHash?: (data: any) => void;
  addLog?: (msg: string) => void;
}): Promise<BackendResponse> {
  const { extensionSDK, lookerHost, userId, payload, onBuildHash, addLog } = params;
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `looker-attribute-challenge ${extensionSDK.createSecretKeyTag('nano_admin_challenge')}`,
    'X-Looker-User-ID': userId || '',
    'X-Looker-Instance-Host': lookerHost
  };

  let response = await extensionSDK.serverProxy(BACKEND_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });

  if (response.status === 401) {
    if (addLog) {
      addLog(`Challenge required or expired. Retrying backend action '${payload.action}'...`);
    }
    if (onBuildHash && response.body) {
      onBuildHash(response.body);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    response = await extensionSDK.serverProxy(BACKEND_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
  }

  return {
    ok: Boolean(response.ok),
    status: response.status,
    body: response.body
  };
}

async function sendOAuthBackendRequest(params: {
  extensionSDK: any;
  lookerHost: string;
  userId: string;
  payload: Record<string, any>;
  allowInteractiveOAuth: boolean;
  onBuildHash?: (data: any) => void;
  addLog?: (msg: string) => void;
}): Promise<BackendResponse> {
  const {
    extensionSDK,
    lookerHost,
    userId,
    payload,
    allowInteractiveOAuth,
    onBuildHash,
    addLog
  } = params;

  let token = await getStoredOAuthToken(extensionSDK, lookerHost, userId);

  if (!token) {
    if (!allowInteractiveOAuth) {
      const err: any = new Error('OAuth authorization required.');
      err.status = 401;
      err.oauthRequired = true;
      throw err;
    }
    token = await performOAuthLogin(extensionSDK, userId, addLog);
  }

  const executeFetch = async (accessToken: string) => {
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
      'X-Looker-User-ID': userId || '',
      'X-Looker-Instance-Host': lookerHost
    };
    return extensionSDK.fetchProxy(BACKEND_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
  };

  let response = await executeFetch(token.accessToken);

  if (response.status === 401) {
    await clearStoredOAuthToken(extensionSDK, lookerHost, userId);
    if (onBuildHash && response.body) {
      onBuildHash(response.body);
    }
    if (!allowInteractiveOAuth) {
      const err: any = new Error('OAuth session expired or invalid.');
      err.status = 401;
      err.oauthRequired = true;
      throw err;
    }
    if (addLog) {
      addLog(`OAuth token expired or invalid. Re-authenticating...`);
    }
    const refreshedToken = await performOAuthLogin(extensionSDK, userId, addLog);
    response = await executeFetch(refreshedToken.accessToken);
  }

  return {
    ok: Boolean(response.ok),
    status: response.status,
    body: response.body
  };
}
