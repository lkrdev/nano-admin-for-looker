import * as ff from '@google-cloud/functions-framework';
import * as crypto from 'crypto';
import { verifyChallengeToken, ChallengeVerificationResult } from './challenge';

export interface AuthenticationResult {
  userId: string;
  status: ChallengeVerificationResult;
}

function hashForLog(value: string): string {
  if (!value) return 'none';
  return crypto.createHash('sha256').update(value).digest('hex').substring(0, 16) + '...';
}

export function authenticateRequest(req: ff.Request): AuthenticationResult {
  const authHeader = req.headers['authorization'];
  const lookerUserIdHeader = req.headers['x-looker-user-id'];

  console.log(`[DEBUG] authenticateRequest: Incoming headers - Authorization present: ${!!authHeader}, X-Looker-User-ID: "${lookerUserIdHeader}"`);

  if (!authHeader || !lookerUserIdHeader) {
    console.log('[DEBUG] authenticateRequest: Missing Authorization or X-Looker-User-ID header');
    return { userId: '', status: 'missing' };
  }

  const userId = String(lookerUserIdHeader).trim();
  if (!authHeader.startsWith('looker-attribute-challenge ')) {
    console.log('[DEBUG] authenticateRequest: Authorization header is not formatted with looker-attribute-challenge prefix');
    return { userId, status: 'invalid' };
  }

  const challenge = authHeader.substring('looker-attribute-challenge '.length).trim();
  console.log(`[DEBUG] authenticateRequest: Parsed challenge for user ${userId}. SHA256: ${hashForLog(challenge)}`);

  if (!userId || !challenge) {
    console.log('[DEBUG] authenticateRequest: Empty userId or challenge parsed');
    return { userId, status: 'invalid' };
  }

  const status = verifyChallengeToken(userId, challenge);
  console.log(`[DEBUG] authenticateRequest: verifyChallengeToken result: ${status}`);
  return { userId, status };
}
