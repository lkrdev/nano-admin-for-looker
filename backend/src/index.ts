import * as ff from '@google-cloud/functions-framework';
import { LookerNodeSDK } from '@looker/sdk-node';
import cors from 'cors';
import { authenticateRequestAsync } from './auth';
import { checkRateLimit, refreshChallenge } from './challenge';
import { handleOAuthAuthorize, handleOAuthTokenExchange } from './oauth';
import { actionRegistry } from './actions/registry';
import { wrapLookerSDKWithLogging } from './looker_logging_sdk';

// Set up CORS configuration
const corsHandler = cors({
  origin: true, // Allow all origins for dev, or configure specifically in production
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Nano-Admin-Challenge', 'X-Looker-User-ID', 'X-Looker-Instance-Host', 'X-Looker-Host'],
  credentials: true
});

import { ApiSettings } from '@looker/sdk-rtl';

class CustomNodeSettings extends ApiSettings {
  private configValues: Record<string, string>;

  constructor(customConfig: { base_url: string; client_id: string; client_secret: string }) {
    super({
      base_url: customConfig.base_url,
      verify_ssl: true
    } as any);
    this.configValues = {
      base_url: customConfig.base_url,
      client_id: customConfig.client_id,
      client_secret: customConfig.client_secret,
      verify_ssl: 'true'
    };
  }

  readConfig(): Record<string, string> {
    return this.configValues;
  }
}

// SDK Cache for Multi-Instance Support (host -> Looker SDK instance)
const sdkCache = new Map<string, any>();

import crypto from 'crypto';

export function sanitizeHostForSecret(host: string): string {
  const cleanHost = (host || '').trim().toLowerCase();
  let sanitized = cleanHost.replace(/[^a-z0-9]/g, '_');
  if (sanitized.length > 180) {
    const hash = crypto.createHash('sha256').update(cleanHost).digest('hex').substring(0, 16);
    sanitized = `${sanitized.substring(0, 180)}_${hash}`;
  }
  return sanitized;
}

function getSDKForInstance(trustedHost?: string): any {
  const cleanHost = trustedHost ? trustedHost.trim().toLowerCase() : '';
  if (!cleanHost) {
    throw new Error('Cannot initialize Looker SDK: missing Looker instance host.');
  }
  if (sdkCache.has(cleanHost)) {
    return sdkCache.get(cleanHost);
  }

  const sanitizedHost = sanitizeHostForSecret(cleanHost);
  const perInstClientId = process.env[`NANO_ADMIN_LOOKERSDK_CLIENT_ID_${sanitizedHost}`];
  const perInstClientSecret = process.env[`NANO_ADMIN_LOOKERSDK_CLIENT_SECRET_${sanitizedHost}`];

  if (!perInstClientId || !perInstClientSecret) {
    throw new Error(
      `Looker API credentials are not configured for instance host "${cleanHost}" (expected env vars NANO_ADMIN_LOOKERSDK_CLIENT_ID_${sanitizedHost} and NANO_ADMIN_LOOKERSDK_CLIENT_SECRET_${sanitizedHost}).`
    );
  }

  console.log(`[SDKManager] Initializing Looker SDK with Secret Manager credentials for host: ${cleanHost}`);
  const baseUrl = `https://${cleanHost}`;
  const customSettings = new CustomNodeSettings({
    base_url: baseUrl,
    client_id: perInstClientId,
    client_secret: perInstClientSecret
  });
  const sdkInstance = LookerNodeSDK.init40(customSettings as any);
  sdkCache.set(cleanHost, sdkInstance);
  return sdkInstance;
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

    // Route OAuth 2.0 endpoints before standard RPC action handling
    const requestPath = (req.path || req.url || '').split('?')[0].replace(/\/+$/, '');
    if (requestPath.endsWith('/oauth/authorize')) {
      handleOAuthAuthorize(req, res);
      return;
    }
    if (requestPath.endsWith('/oauth/token')) {
      await handleOAuthTokenExchange(req, res);
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method Not Allowed' });
      return;
    }

    // 1. Perform Authentication
    const { trustedInstanceHost, trustedUserId, status, tokenAgeMs, authMode } = await authenticateRequestAsync(req);
    const userId = trustedUserId;

    if (status === 'forbidden') {
      res.status(403).json({
        error: 'forbidden',
        message: `Looker instance host "${trustedInstanceHost}" is not permitted by this service.`
      });
      return;
    }

    if (!trustedInstanceHost) {
      res.status(400).json({
        error: 'missing_instance_host',
        message: 'Looker instance host header (X-Looker-Instance-Host or X-Looker-Host) is missing.'
      });
      return;
    }

    if (status !== 'valid' && authMode === 'oauth') {
      console.warn(`[DEBUG] OAuth authentication failed for user "${userId}" on "${trustedInstanceHost}" (Status: ${status}). Returning 401 oauth_required.`);
      res.status(401).json({
        error: 'oauth_required',
        message: 'Looker OAuth access token is missing, expired, or invalid.',
        build_hash: process.env.BUILD_HASH || '',
        build_timestamp: process.env.BUILD_TIMESTAMP || ''
      });
      return;
    }

    let targetSdk: any;
    try {
      targetSdk = getSDKForInstance(trustedInstanceHost);
    } catch (sdkErr: any) {
      console.error(`[SDKManager] Failed to initialize Looker SDK for "${trustedInstanceHost}":`, sdkErr);
      res.status(500).json({
        error: 'sdk_configuration_error',
        message: sdkErr.message || `Looker API credentials are not configured for host "${trustedInstanceHost}".`
      });
      return;
    }

    if (status !== 'valid') {
      console.warn(`[DEBUG] Authentication failed for user "${userId}" on "${trustedInstanceHost}" (Status: ${status}). Resetting/refreshing challenge...`);

      if (!userId) {
        res.status(401).json({
          error: 'missing_user_context',
          message: 'Looker User ID header (X-Looker-User-ID) is missing.'
        });
        return;
      }

      const rateLimitKey = (trustedInstanceHost && userId)
        ? `${trustedInstanceHost}_${userId}`
        : (req.ip || 'global');
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
          message: 'Authentication challenge is missing, expired, or invalid. A new challenge has been provisioned.',
          build_hash: process.env.BUILD_HASH || '',
          build_timestamp: process.env.BUILD_TIMESTAMP || ''
        });
      } catch (err) {
        console.error(`Failed to refresh challenge for user ${userId} on ${trustedInstanceHost}:`, err);
        res.status(500).json({ error: 'Internal Server Error', details: 'Could not generate authentication challenge' });
      }
      return;
    }

    // Status is 'valid': Perform asynchronous sliding refresh if challenge token is older than 1 hour
    const SLIDING_REFRESH_THRESHOLD_MS = 1 * 60 * 60 * 1000; // 1 hour
    if (authMode !== 'oauth' && tokenAgeMs !== undefined && tokenAgeMs > SLIDING_REFRESH_THRESHOLD_MS) {
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

    console.log(`[${new Date().toISOString()}] Action: "${action}" triggered by authenticated user: ${userId} on ${trustedInstanceHost} (authMode: ${authMode || 'server_proxy'})`);

    const handler = actionRegistry.get(action);
    if (!handler) {
      res.status(400).json({ error: `Unknown action: "${action}"` });
      return;
    }

    const requestSdk = wrapLookerSDKWithLogging(targetSdk, { userId, action });

    try {
      const actionContext = { instanceHost: trustedInstanceHost };
      const result = await handler(requestSdk, userId, req.body, actionContext);
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
