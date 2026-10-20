import * as ff from '@google-cloud/functions-framework';
import * as crypto from 'crypto';
import { verifyChallengeToken, ChallengeVerificationResult } from './challenge';
import {
  FetchLookerUserFn,
  InstanceAuthMode,
  resolveInstanceAuthMode,
  verifyLookerOAuthToken
} from './oauth';

export interface AuthenticationResult {
  trustedInstanceHost: string;
  trustedUserId: string;
  userId: string; // Alias for backward compatibility
  status: ChallengeVerificationResult | 'forbidden';
  tokenAgeMs?: number;
  authMode?: InstanceAuthMode;
}

export function isHostAllowed(host: string, allowedInstancesEnv?: string): boolean {
  if (!allowedInstancesEnv || !allowedInstancesEnv.trim()) {
    return true; // No allowlist configured, permissive mode
  }
  const allowedList = allowedInstancesEnv
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (allowedList.length === 0) {
    return true;
  }
  return allowedList.includes((host || '').trim().toLowerCase());
}

function sanitizeHost(rawHost: string): string {
  if (!rawHost) return '';
  let cleaned = rawHost.trim().toLowerCase();
  cleaned = cleaned.replace(/^https?:\/\//, '');
  cleaned = cleaned.replace(/\/.*$/, '');
  return cleaned;
}

function hashForLog(value: string): string {
  if (!value) return 'none';
  return crypto.createHash('sha256').update(value).digest('hex').substring(0, 16) + '...';
}

export function authenticateRequest(req: ff.Request): AuthenticationResult {
  const authHeader = req.headers['authorization'];
  const lookerUserIdHeader = req.headers['x-looker-user-id'];
  const rawInstanceHostHeader = req.headers['x-looker-instance-host'] || req.headers['x-looker-host'];

  console.log(`[DEBUG] authenticateRequest: Incoming headers - Authorization present: ${!!authHeader}, X-Looker-User-ID: "${lookerUserIdHeader}", X-Looker-Instance-Host present: ${!!rawInstanceHostHeader}`);

  const rawHost = String(rawInstanceHostHeader || '').trim();
  const sanitizedHost = sanitizeHost(rawHost);
  const configuredMode = resolveInstanceAuthMode(sanitizedHost);
  const effectiveMode: InstanceAuthMode = authHeader?.startsWith('Bearer ') ? 'oauth' : configuredMode;

  // Validate host against LOOKER_ALLOWED_INSTANCES allowlist
  if (!isHostAllowed(sanitizedHost, process.env.LOOKER_ALLOWED_INSTANCES)) {
    console.warn(`[DEBUG] authenticateRequest: Request rejected. Host "${sanitizedHost}" is not in LOOKER_ALLOWED_INSTANCES.`);
    return { trustedInstanceHost: sanitizedHost, trustedUserId: '', userId: '', status: 'forbidden', authMode: effectiveMode };
  }

  if (!authHeader || !lookerUserIdHeader) {
    console.log('[DEBUG] authenticateRequest: Missing Authorization or X-Looker-User-ID header');
    return { trustedInstanceHost: sanitizedHost, trustedUserId: '', userId: '', status: 'missing', authMode: effectiveMode };
  }

  const userId = String(lookerUserIdHeader).trim();

  if (!authHeader.startsWith('looker-attribute-challenge ')) {
    console.log('[DEBUG] authenticateRequest: Authorization header is not formatted with looker-attribute-challenge prefix');
    return { trustedInstanceHost: sanitizedHost, trustedUserId: userId, userId, status: 'invalid', authMode: effectiveMode };
  }

  const challenge = authHeader.substring('looker-attribute-challenge '.length).trim();
  console.log(`[DEBUG] authenticateRequest: Parsed challenge for user ${userId} on ${sanitizedHost || 'unknown-host'}. SHA256: ${hashForLog(challenge)}`);

  if (!userId || !challenge) {
    console.log('[DEBUG] authenticateRequest: Empty userId or challenge parsed');
    return { trustedInstanceHost: sanitizedHost, trustedUserId: userId, userId, status: 'invalid', authMode: 'server_proxy' };
  }

  const { status, tokenAgeMs } = verifyChallengeToken(sanitizedHost, userId, challenge);
  console.log(`[DEBUG] authenticateRequest: verifyChallengeToken result: ${status}, age: ${tokenAgeMs ? Math.round(tokenAgeMs / 1000) + 's' : 'N/A'}`);
  return { trustedInstanceHost: sanitizedHost, trustedUserId: userId, userId, status, tokenAgeMs, authMode: 'server_proxy' };
}

/**
 * Unified async request authenticator supporting both Looker Server Proxy (user attribute challenge)
 * and Looker OAuth 2.0 (Bearer access token verified against the target Looker instance).
 */
export async function authenticateRequestAsync(
  req: ff.Request,
  fetchUserFn?: FetchLookerUserFn
): Promise<AuthenticationResult> {
  const authHeader = req.headers['authorization'];
  const lookerUserIdHeader = req.headers['x-looker-user-id'];
  const rawInstanceHostHeader = req.headers['x-looker-instance-host'] || req.headers['x-looker-host'];

  const rawHost = String(rawInstanceHostHeader || '').trim();
  const sanitizedHost = sanitizeHost(rawHost);

  if (authHeader && authHeader.startsWith('Bearer ')) {
    if (!isHostAllowed(sanitizedHost, process.env.LOOKER_ALLOWED_INSTANCES)) {
      console.warn(`[DEBUG] authenticateRequestAsync: OAuth request rejected. Host "${sanitizedHost}" is not in LOOKER_ALLOWED_INSTANCES.`);
      return {
        trustedInstanceHost: sanitizedHost,
        trustedUserId: '',
        userId: '',
        status: 'forbidden',
        authMode: 'oauth'
      };
    }

    const claimedUserId = lookerUserIdHeader ? String(lookerUserIdHeader).trim() : '';
    const accessToken = authHeader.substring('Bearer '.length).trim();

    if (!accessToken) {
      return {
        trustedInstanceHost: sanitizedHost,
        trustedUserId: claimedUserId,
        userId: claimedUserId,
        status: 'missing',
        authMode: 'oauth'
      };
    }

    const verification = await verifyLookerOAuthToken(
      sanitizedHost,
      accessToken,
      claimedUserId || undefined,
      fetchUserFn
    );

    return {
      trustedInstanceHost: sanitizedHost,
      trustedUserId: verification.userId,
      userId: verification.userId,
      status: verification.status,
      authMode: 'oauth'
    };
  }

  return authenticateRequest(req);
}
