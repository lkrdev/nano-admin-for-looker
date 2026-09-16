import * as crypto from 'crypto';

const HMAC_SECRET = process.env.GCF_HMAC_SECRET || 'default_secret_for_nano_admin_challenges';

export type ChallengeVerificationResult = 'valid' | 'expired' | 'invalid' | 'missing';

const refreshLimits = new Map<string, { count: number; resetTime: number }>();

export function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const limit = refreshLimits.get(userId);

  if (!limit || now > limit.resetTime) {
    // Limit: 10 refreshes per 10 seconds
    refreshLimits.set(userId, { count: 1, resetTime: now + 10000 });
    return true;
  }

  if (limit.count >= 10) {
    return false;
  }

  limit.count++;
  return true;
}

export function generateChallengeToken(instanceHost: string, userId: string): string {
  const timestamp = Date.now();
  const random = crypto.randomBytes(8).toString('hex');
  const payload = `${instanceHost}|${userId}|${timestamp}|${random}`;
  const hmac = crypto.createHmac('sha256', HMAC_SECRET);
  hmac.update(payload);
  const signature = hmac.digest('hex');
  return `${payload}|${signature}`;
}

export interface VerifyTokenResponse {
  status: ChallengeVerificationResult;
  tokenAgeMs?: number;
}

export function verifyChallengeToken(instanceHost: string, userId: string, token: string): VerifyTokenResponse {
  if (!token) {
    console.log(`[DEBUG] verifyChallengeToken: Token is missing for user ${userId} on ${instanceHost}`);
    return { status: 'missing' };
  }

  console.log(`[DEBUG] verifyChallengeToken: Received token for user ${userId} on ${instanceHost}. SHA256: ${hashForLog(token)}`);

  try {
    const parts = token.split('|');
    let tokenHost = '';
    let tokenUserId = '';
    let tokenTimestampStr = '';
    let random = '';
    let signature = '';

    if (parts.length === 5) {
      [tokenHost, tokenUserId, tokenTimestampStr, random, signature] = parts;
    } else if (parts.length === 4) {
      // Legacy 4-part fallback format (userId|timestamp|random|signature)
      [tokenUserId, tokenTimestampStr, random, signature] = parts;
      tokenHost = instanceHost;
    } else {
      console.log(`[DEBUG] verifyChallengeToken: Invalid token format (split parts: ${parts.length})`);
      return { status: 'invalid' };
    }

    if (tokenHost !== instanceHost || tokenUserId !== userId) {
      console.log(`[DEBUG] verifyChallengeToken: Host or User ID mismatch. Host expected: ${instanceHost}, got: ${tokenHost}. User expected: ${userId}, got: ${tokenUserId}`);
      return { status: 'invalid' };
    }

    // Verify signature
    const payload = parts.length === 5
      ? `${tokenHost}|${tokenUserId}|${tokenTimestampStr}|${random}`
      : `${tokenUserId}|${tokenTimestampStr}|${random}`;
    const hmac = crypto.createHmac('sha256', HMAC_SECRET);
    hmac.update(payload);
    const expectedSignature = hmac.digest('hex');

    const signatureValid = crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );

    if (!signatureValid) return { status: 'invalid' };

    // Verify timestamp (default TTL: 8 hours = 28,800,000 ms)
    const tokenTimestamp = parseInt(tokenTimestampStr, 10);
    const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
    if (isNaN(tokenTimestamp)) {
      return { status: 'invalid' };
    }

    const tokenAgeMs = Date.now() - tokenTimestamp;
    if (tokenAgeMs > DEFAULT_TTL_MS) {
      console.log(`[DEBUG] verifyChallengeToken: Token expired (age: ${Math.round(tokenAgeMs / 1000)}s > ${DEFAULT_TTL_MS / 1000}s)`);
      return { status: 'expired', tokenAgeMs };
    }

    return { status: 'valid', tokenAgeMs };
  } catch (err) {
    console.error('Error verifying challenge token:', err);
    return { status: 'invalid' };
  }
}

let challengeAttributeId: string | null = null;

export async function getChallengeAttributeId(sdk: any): Promise<string | null> {
  if (challengeAttributeId) return challengeAttributeId;
  if (!sdk) return null;
  try {
    const attrs = await sdk.ok(sdk.all_user_attributes({ fields: 'id,name' }));
    const attr = attrs.find(
      (a: any) =>
        a.name === 'nano_admin_challenge' ||
        a.name === 'nano_admin_admin_extension_nano_admin_challenge'
    );
    if (attr) {
      // Pull attribute's domain whitelist and value_is_hidden to verify security
      try {
        const fullAttr = await sdk.ok(sdk.user_attribute(attr.id));
        if (!fullAttr.value_is_hidden) {
          console.warn(`⚠️ Security warning: Looker User Attribute "${fullAttr.name}" is NOT marked as hidden!`);
        }
        if (!fullAttr.hidden_value_domain_whitelist) {
          console.warn(`⚠️ Security warning: Looker User Attribute "${fullAttr.name}" does NOT have a domain whitelist configured!`);
        } else {
          console.log(`ℹ️ Looker User Attribute "${fullAttr.name}" is configured with domain whitelist: ${fullAttr.hidden_value_domain_whitelist}`);
        }
      } catch (err) {
        console.warn('Failed to verify user attribute security properties:', err);
      }

      challengeAttributeId = String(attr.id);
      return challengeAttributeId;
    }
  } catch (err) {
    console.error('Failed to find user attribute ID by name:', err);
  }
  return null;
}

export async function refreshChallenge(sdk: any, instanceHost: string, userId: string): Promise<string> {
  const newChallenge = generateChallengeToken(instanceHost, userId);
  console.log(`[DEBUG] refreshChallenge: Generated new challenge for user ${userId} on ${instanceHost}. SHA256: ${hashForLog(newChallenge)}`);
  if (sdk) {
    const attrId = await getChallengeAttributeId(sdk);
    if (attrId) {
      console.log(`[DEBUG] refreshChallenge: Setting nano_admin_challenge attribute (ID: ${attrId}) for user ${userId} on ${instanceHost}.`);
      await sdk.ok(sdk.set_user_attribute_user_value(userId, attrId, { value: newChallenge }));
    } else {
      console.error('nano_admin_challenge user attribute ID not found on Looker instance.');
    }
  }
  return newChallenge;
}

function hashForLog(value: string): string {
  if (!value) return 'none';
  return crypto.createHash('sha256').update(value).digest('hex').substring(0, 16) + '...';
}
