import * as ff from '@google-cloud/functions-framework';
import { LookerNodeSDK } from '@looker/sdk-node';
import cors from 'cors';
import { authenticateRequest } from './auth';
import { checkRateLimit, refreshChallenge } from './challenge';
import { actionRegistry } from './actions/registry';

// Set up CORS configuration
const corsHandler = cors({
  origin: true, // Allow all origins for dev, or configure specifically in production
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Nano-Admin-Challenge', 'X-Looker-User-ID'],
  credentials: true
});

// Initialize the Looker Node SDK
let sdk: any = null;
try {
  sdk = LookerNodeSDK.init40();
  console.log('Looker Node SDK initialized successfully.');
} catch (e) {
  console.error('Fatal: Looker Node SDK failed to initialize.', e);
  process.exit(1); // Since mock logic is removed, SDK initialization failure is fatal.
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
    const { userId, status } = authenticateRequest(req);

    if (status === 'invalid') {
      console.warn(`🚨 Security warning: Invalid challenge signature detected for user: ${userId}`);
      res.status(401).json({
        error: 'invalid_challenge',
        message: 'The provided authentication challenge signature is invalid.'
      });
      return;
    }

    if (status === 'missing' || status === 'expired') {
      const rateLimitKey = userId || req.ip || String(req.headers['x-forwarded-for']) || 'global';
      const allowed = checkRateLimit(rateLimitKey);
      if (!allowed) {
        console.warn(`Rate limit exceeded for client: ${rateLimitKey}`);
        res.status(429).json({ error: 'too_many_requests', message: 'Rate limit exceeded. Please try again later.' });
        return;
      }

      if (!userId) {
        res.status(401).json({
          error: 'missing_user_context',
          message: 'Looker User ID header (X-Looker-User-ID) is missing.'
        });
        return;
      }

      try {
        await refreshChallenge(sdk, userId);
        console.log(`Challenge expired/missing for user ${userId}. Refreshed challenge and redirecting (307)...`);
        res.redirect(307, req.originalUrl || req.url);
      } catch (err) {
        console.error(`Failed to refresh challenge for user ${userId}:`, err);
        res.status(500).json({ error: 'Internal Server Error', details: 'Could not generate authentication challenge' });
      }
      return;
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

    try {
      const result = await handler(sdk, userId, req.body);
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
