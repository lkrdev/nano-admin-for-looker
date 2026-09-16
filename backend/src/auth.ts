import * as ff from '@google-cloud/functions-framework';
import * as crypto from 'crypto';
import { verifyChallengeToken, ChallengeVerificationResult } from './challenge';

export interface AuthenticationResult {
  trustedInstanceHost: string;
  trustedUserId: string;
  userId: string; // Alias for backward compatibility
  status: ChallengeVerificationResult;
  tokenAgeMs?: number;
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

  if (!authHeader || !lookerUserIdHeader) {
    console.log('[DEBUG] authenticateRequest: Missing Authorization or X-Looker-User-ID header');
    return { trustedInstanceHost: '', trustedUserId: '', userId: '', status: 'missing' };
  }

  const userId = String(lookerUserIdHeader).trim();
  const rawHost = String(rawInstanceHostHeader || '').trim();
  const sanitizedHost = sanitizeHost(rawHost);

  if (!authHeader.startsWith('looker-attribute-challenge ')) {
    console.log('[DEBUG] authenticateRequest: Authorization header is not formatted with looker-attribute-challenge prefix');
    return { trustedInstanceHost: sanitizedHost, trustedUserId: userId, userId, status: 'invalid' };
  }

  const challenge = authHeader.substring('looker-attribute-challenge '.length).trim();
  console.log(`[DEBUG] authenticateRequest: Parsed challenge for user ${userId} on ${sanitizedHost || 'unknown-host'}. SHA256: ${hashForLog(challenge)}`);

  if (!userId || !challenge) {
    console.log('[DEBUG] authenticateRequest: Empty userId or challenge parsed');
    return { trustedInstanceHost: sanitizedHost, trustedUserId: userId, userId, status: 'invalid' };
  }

  const { status, tokenAgeMs } = verifyChallengeToken(sanitizedHost, userId, challenge);
  console.log(`[DEBUG] authenticateRequest: verifyChallengeToken result: ${status}, age: ${tokenAgeMs ? Math.round(tokenAgeMs / 1000) + 's' : 'N/A'}`);
  return { trustedInstanceHost: sanitizedHost, trustedUserId: userId, userId, status, tokenAgeMs };
}
