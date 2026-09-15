import * as ff from '@google-cloud/functions-framework';
import { LookerNodeSDK } from '@looker/sdk-node';
import cors from 'cors';
import { authenticateRequest } from './auth';
import { checkRateLimit, refreshChallenge } from './challenge';
import { actionRegistry } from './actions/registry';
import { wrapLookerSDKWithLogging } from './looker_logging_sdk';

// Set up CORS configuration
const corsHandler = cors({
  origin: true, // Allow all origins for dev, or configure specifically in production
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Nano-Admin-Challenge', 'X-Looker-User-ID'],
  //TODO ^ check whether `X-Nano-Admin-Challenge` still in use? I think we maybe replaced it with the standard Authorization header instead?
  credentials: true
});

// Initialize the Looker Node SDK
let sdk: any = null;
try {
  sdk = LookerNodeSDK.init40();
} catch (e) {
  console.error('Fatal: Looker Node SDK failed to initialize.', e);
  process.exit(1);
}

// Sliding refresh cooldown map (userId -> lastRefreshTimestamp)
const slidingRefreshCooldowns = new Map<string, number>();

function checkSlidingRefreshCooldown(userId: string): boolean {
  const now = Date.now();
  const lastRefresh = slidingRefreshCooldowns.get(userId) || 0;
  if (now - lastRefresh > 5 * 60 * 1000) { // 5-minute cooldown
    slidingRefreshCooldowns.set(userId, now);
    return true;
  }
  return false;
}

ff.http('nanoAdminBackend', (req: ff.Request, res: ff.Response) => {
  // Process request through CORS middleware
  corsHandler(req, res, async () => {
    if (req.method === 'OPTIONS') {
      res.status(204).send();
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method Not Allowed' });
      return;
    }

    // 1. Perform Authentication
    const { userId, status, tokenAgeMs } = authenticateRequest(req);

    if (status !== 'valid') {
      console.warn(`[DEBUG] Authentication failed for user "${userId}" (Status: ${status}). Resetting/refreshing challenge...`);

      if (!userId) {
        res.status(401).json({
          error: 'missing_user_context',
          message: 'Looker User ID header (X-Looker-User-ID) is missing.'
        });
        return;
      }

      const rateLimitKey = userId || req.ip || String(req.headers['x-forwarded-for']) || 'global';
      const allowed = checkRateLimit(rateLimitKey);
      if (!allowed) {
        console.warn(`Rate limit exceeded for client: ${rateLimitKey}`);
        res.status(429).json({ error: 'too_many_requests', message: 'Rate limit exceeded. Please try again later.' });
        return;
      }

      try {
        await refreshChallenge(sdk, userId);
        console.log(`[DEBUG] Successfully refreshed challenge in Looker for user ${userId}. Returning 401 to trigger client retry.`);
        res.status(401).json({
          error: 'challenge_required',
          message: 'Authentication challenge is missing, expired, or invalid. A new challenge has been provisioned.'
        });
      } catch (err) {
        console.error(`Failed to refresh challenge for user ${userId}:`, err);
        res.status(500).json({ error: 'Internal Server Error', details: 'Could not generate authentication challenge' });
      }
      return;
    }

    // Status is 'valid': Perform asynchronous sliding refresh if token is older than 1 hour
    const SLIDING_REFRESH_THRESHOLD_MS = 1 * 60 * 60 * 1000; // 1 hour
    if (tokenAgeMs !== undefined && tokenAgeMs > SLIDING_REFRESH_THRESHOLD_MS) {
      if (checkSlidingRefreshCooldown(userId)) {
        console.log(`[DEBUG] Sliding refresh triggered for user ${userId} (Token age: ${Math.round(tokenAgeMs / 60000)}m > 60m).`);
        refreshChallenge(sdk, userId).catch((err) => {
          console.error(`[Sliding Refresh Error] Failed to asynchronously refresh challenge for user ${userId}:`, err);
        });
      }
    }

    // Status is 'valid'
    const { action } = req.body;
    if (!action) {
      res.status(400).json({ error: 'Missing required field: "action"' });
      return;
    }

    // Confusing log is now placed AFTER validation and authentication!
    console.log(`[${new Date().toISOString()}] Action: "${action}" triggered by authenticated user: ${userId}`);

    const handler = actionRegistry.get(action);
    if (!handler) {
      res.status(400).json({ error: `Unknown action: "${action}"` });
      return;
    }

    const requestSdk = wrapLookerSDKWithLogging(sdk, { userId, action });

    try {
      const result = await handler(requestSdk, userId, req.body);
      res.status(200).json(result);
    } catch (error: any) {
      console.error(`Error executing action "${action}":`, error);
      const statusCode = error.status || 500;
      const errMsg = error.message || String(error);
      res.status(statusCode).json({
        error: statusCode === 403 ? 'Forbidden' : 'Internal Server Error',
        details: errMsg
      });
    }
  });
});
