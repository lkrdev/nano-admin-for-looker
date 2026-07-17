import * as crypto from 'crypto';

const HMAC_SECRET = process.env.GCF_HMAC_SECRET || 'default_secret_for_nano_admin_challenges';

export type ChallengeVerificationResult = 'valid' | 'expired' | 'invalid' | 'missing';

const refreshLimits = new Map<string, { count: number; resetTime: number }>();

export function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const limit = refreshLimits.get(userId);

  if (!limit || now > limit.resetTime) {
    // Limit: 5 refreshes per 10 seconds
    refreshLimits.set(userId, { count: 1, resetTime: now + 10000 });
    return true;
  }

  if (limit.count >= 5) {
    return false;
  }

  limit.count++;
  return true;
}

export function generateChallengeToken(userId: string): string {
  const timestamp = Date.now();
  const random = crypto.randomBytes(8).toString('hex');
  const payload = `${userId}|${timestamp}|${random}`;
  const hmac = crypto.createHmac('sha256', HMAC_SECRET);
  hmac.update(payload);
  const signature = hmac.digest('hex');
  return `${payload}|${signature}`;
}

export function verifyChallengeToken(userId: string, token: string): ChallengeVerificationResult {
  if (!token) {
    console.log(`[DEBUG] verifyChallengeToken: Token is missing for user ${userId}`);
    return 'missing';
  }

  console.log(`[DEBUG] verifyChallengeToken: Received token for user ${userId}. SHA256: ${hashForLog(token)}`);

  try {
    const parts = token.split('|');
    if (parts.length !== 4) {
      console.log(`[DEBUG] verifyChallengeToken: Invalid token format (split parts: ${parts.length})`);
      return 'invalid';
    }
    const [tokenUserId, tokenTimestampStr, random, signature] = parts;

    if (tokenUserId !== userId) {
      console.log(`[DEBUG] verifyChallengeToken: User ID mismatch. Expected: ${userId}, Token: ${tokenUserId}`);
      return 'invalid';
    }

    // Verify signature
    const payload = `${tokenUserId}|${tokenTimestampStr}|${random}`;
    const hmac = crypto.createHmac('sha256', HMAC_SECRET);
    hmac.update(payload);
    const expectedSignature = hmac.digest('hex');

    const signatureValid = crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );

    if (!signatureValid) return 'invalid';

    // Verify timestamp (within 2 minutes)
    const tokenTimestamp = parseInt(tokenTimestampStr, 10);
    if (isNaN(tokenTimestamp) || Date.now() - tokenTimestamp > 120000) {
      return 'expired';
    }

    return 'valid';
  } catch (err) {
    console.error('Error verifying challenge token:', err);
    return 'invalid';
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

export async function refreshChallenge(sdk: any, userId: string): Promise<string> {
  const newChallenge = generateChallengeToken(userId);
  console.log(`[DEBUG] refreshChallenge: Generated new challenge for user ${userId}. SHA256: ${hashForLog(newChallenge)}`);
  if (sdk) {
    const attrId = await getChallengeAttributeId(sdk);
    if (attrId) {
      console.log(`[DEBUG] refreshChallenge: Setting nano_admin_challenge attribute (ID: ${attrId}) for user ${userId}.`);
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
