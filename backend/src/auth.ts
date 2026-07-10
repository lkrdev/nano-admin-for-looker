import * as ff from '@google-cloud/functions-framework';
import { verifyChallengeToken, ChallengeVerificationResult } from './challenge';

export interface AuthenticationResult {
  userId: string;
  status: ChallengeVerificationResult;
}

export function authenticateRequest(req: ff.Request): AuthenticationResult {
  const authHeader = req.headers['authorization'];
  const lookerUserIdHeader = req.headers['x-looker-user-id'];

  if (!authHeader || !lookerUserIdHeader) {
    return { userId: '', status: 'missing' };
  }

  const userId = String(lookerUserIdHeader).trim();
  if (!authHeader.startsWith('looker-attribute-challenge ')) {
    return { userId, status: 'invalid' };
  }

  const challenge = authHeader.substring('looker-attribute-challenge '.length).trim();
  if (!userId || !challenge) {
    return { userId, status: 'invalid' };
  }

  const status = verifyChallengeToken(userId, challenge);
  return { userId, status };
}
