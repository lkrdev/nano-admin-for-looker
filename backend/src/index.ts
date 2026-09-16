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
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Nano-Admin-Challenge', 'X-Looker-User-ID', 'X-Looker-Instance-Host', 'X-Looker-Host'],
  credentials: true
});

import { ApiSettings } from '@looker/sdk-rtl';

class CustomNodeSettings extends ApiSettings {
  private configValues: Record<string, string>;

  constructor(customConfig: { base_url: string; client_id: string; client_secret: string; verify_ssl?: boolean }) {
    super({
      base_url: customConfig.base_url,
      verify_ssl: customConfig.verify_ssl !== false
    } as any);
    this.configValues = {
      base_url: customConfig.base_url,
      client_id: customConfig.client_id,
      client_secret: customConfig.client_secret,
      verify_ssl: String(customConfig.verify_ssl !== false)
    };
  }

  readConfig(): Record<string, string> {
    return this.configValues;
  }
}

// SDK Cache for Multi-Instance Support (host -> Looker SDK instance)
const sdkCache = new Map<string, any>();

function getSDKForInstance(trustedHost?: string): any {
  const cleanHost = trustedHost ? trustedHost.trim().toLowerCase() : '__default__';
  if (sdkCache.has(cleanHost)) {
    return sdkCache.get(cleanHost);
  }

  let hostConfig: { base_url?: string; port?: string | number; verify_ssl?: boolean; client_id?: string; client_secret?: string } | null = null;

  // 1. Check LOOKER_INSTANCES_CONFIG JSON secret map
  const instancesConfigJson = process.env.LOOKER_INSTANCES_CONFIG;
  if (instancesConfigJson) {
    try {
      const instancesConfig = JSON.parse(instancesConfigJson);
      const matchedKey = Object.keys(instancesConfig).find(
        k => k.trim().toLowerCase() === cleanHost || k.trim().toLowerCase().replace(/:.*$/, '') === cleanHost.replace(/:.*$/, '')
      );
      if (matchedKey) {
        hostConfig = instancesConfig[matchedKey];
      }
    } catch (err) {
      console.error(`[SDKManager] Failed to parse LOOKER_INSTANCES_CONFIG:`, err);
    }
  }

  // 2. Single-instance fallback from LOOKERSDK_* env vars if hostConfig not found
  if ((!hostConfig || !hostConfig.client_id) && process.env.LOOKERSDK_CLIENT_ID && process.env.LOOKERSDK_CLIENT_SECRET) {
    console.log(`[SDKManager] Using LOOKERSDK_* environment variables fallback for host ${cleanHost}`);
    hostConfig = {
      base_url: process.env.LOOKERSDK_BASE_URL || (cleanHost !== '__default__' ? `https://${cleanHost}` : ''),
      client_id: process.env.LOOKERSDK_CLIENT_ID,
      client_secret: process.env.LOOKERSDK_CLIENT_SECRET,
      verify_ssl: process.env.LOOKERSDK_VERIFY_SSL !== 'false'
    };
  }

  if (hostConfig && hostConfig.client_id && hostConfig.client_secret) {
    console.log(`[SDKManager] Initializing Looker SDK with CustomNodeSettings for host: ${cleanHost}`);
    const baseUrl = hostConfig.base_url || `https://${cleanHost}:${hostConfig.port || 443}`;
    const customSettings = new CustomNodeSettings({
      base_url: baseUrl,
      client_id: hostConfig.client_id,
      client_secret: hostConfig.client_secret,
      verify_ssl: hostConfig.verify_ssl !== undefined ? hostConfig.verify_ssl : true
    });
    const sdkInstance = LookerNodeSDK.init40(customSettings as any);
    sdkCache.set(cleanHost, sdkInstance);
    return sdkInstance;
  }

  // 3. Fallback to default LookerNodeSDK.init40() reading looker.ini / standard env
  try {
    console.log(`[SDKManager] Initializing default LookerNodeSDK for host: ${cleanHost}`);
    const defaultSdk = LookerNodeSDK.init40();
    sdkCache.set(cleanHost, defaultSdk);
    return defaultSdk;
  } catch (e) {
    console.error(`Fatal: Default Looker Node SDK failed to initialize for host: ${cleanHost}`, e);
    throw e;
  }
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
    const { trustedInstanceHost, trustedUserId, status, tokenAgeMs } = authenticateRequest(req);
    const userId = trustedUserId;
    const targetSdk = getSDKForInstance(trustedInstanceHost);

    if (status !== 'valid') {
      console.warn(`[DEBUG] Authentication failed for user "${userId}" on "${trustedInstanceHost}" (Status: ${status}). Resetting/refreshing challenge...`);

      if (!userId) {
        res.status(401).json({
          error: 'missing_user_context',
          message: 'Looker User ID header (X-Looker-User-ID) is missing.'
        });
        return;
      }

      const rateLimitKey = `${trustedInstanceHost}_${userId}` || req.ip || String(req.headers['x-forwarded-for']) || 'global';
      const allowed = checkRateLimit(rateLimitKey);
      if (!allowed) {
        console.warn(`Rate limit exceeded for client: ${rateLimitKey}`);
        res.status(429).json({ error: 'too_many_requests', message: 'Rate limit exceeded. Please try again later.' });
        return;
      }

      try {
        await refreshChallenge(targetSdk, trustedInstanceHost, userId);
        console.log(`[DEBUG] Successfully refreshed challenge in Looker for user ${userId} on ${trustedInstanceHost}. Returning 401 to trigger client retry.`);
        res.status(401).json({
          error: 'challenge_required',
          message: 'Authentication challenge is missing, expired, or invalid. A new challenge has been provisioned.'
        });
      } catch (err) {
        console.error(`Failed to refresh challenge for user ${userId} on ${trustedInstanceHost}:`, err);
        res.status(500).json({ error: 'Internal Server Error', details: 'Could not generate authentication challenge' });
      }
      return;
    }

    // Status is 'valid': Perform asynchronous sliding refresh if token is older than 1 hour
    const SLIDING_REFRESH_THRESHOLD_MS = 1 * 60 * 60 * 1000; // 1 hour
    if (tokenAgeMs !== undefined && tokenAgeMs > SLIDING_REFRESH_THRESHOLD_MS) {
      if (checkSlidingRefreshCooldown(userId)) {
        console.log(`[DEBUG] Sliding refresh triggered for user ${userId} on ${trustedInstanceHost} (Token age: ${Math.round(tokenAgeMs / 60000)}m > 60m).`);
        refreshChallenge(targetSdk, trustedInstanceHost, userId).catch((err) => {
          console.error(`[Sliding Refresh Error] Failed to asynchronously refresh challenge for user ${userId} on ${trustedInstanceHost}:`, err);
        });
      }
    }

    // Status is 'valid'
    const { action } = req.body;
    if (!action) {
      res.status(400).json({ error: 'Missing required field: "action"' });
      return;
    }

    console.log(`[${new Date().toISOString()}] Action: "${action}" triggered by authenticated user: ${userId} on ${trustedInstanceHost}`);

    const handler = actionRegistry.get(action);
    if (!handler) {
      res.status(400).json({ error: `Unknown action: "${action}"` });
      return;
    }

    const requestSdk = wrapLookerSDKWithLogging(targetSdk, { userId, action });

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
