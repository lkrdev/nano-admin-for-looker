import * as ff from '@google-cloud/functions-framework';
import { LookerNodeSDK } from '@looker/sdk-node';
import cors from 'cors';
import * as crypto from 'crypto';
import { BUILD_HASH } from './build_hash';

// Set up CORS configuration
const corsHandler = cors({
  origin: true, // Allow all origins for dev, or configure specifically in production
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Nano-Admin-Challenge'],
  credentials: true
});

// Initialize the Looker Node SDK
let sdk: any = null;
try {
  sdk = LookerNodeSDK.init40();
  console.log('Looker Node SDK initialized successfully.');
} catch (e) {
  console.warn(
    'Looker Node SDK failed to initialize. It will fall back to mock data during local development. ' +
    'Make sure to set LOOKERSDK_ env variables or have a valid looker.ini.',
    e
  );
}

const HMAC_SECRET = process.env.GCF_HMAC_SECRET || 'default_secret_for_nano_admin_challenges';

//TODO: Move these next two function defs to their own file 
function generateChallengeToken(userId: string): string {
  const timestamp = Date.now();
  const random = crypto.randomBytes(8).toString('hex');
  const payload = `${userId}|${timestamp}|${random}`;
  const hmac = crypto.createHmac('sha256', HMAC_SECRET);
  hmac.update(payload);
  const signature = hmac.digest('hex');
  return `${payload}|${signature}`;
}

function verifyChallengeToken(userId: string, token: string): boolean {
  try {
    const parts = token.split('|');
    if (parts.length !== 4) return false;
    const [tokenUserId, tokenTimestampStr, random, signature] = parts;
    
    // 1. Verify user ID matches
    if (tokenUserId !== userId) return false;
    
    // 2. Verify timestamp is within 2 minutes (120000ms)
    const tokenTimestamp = parseInt(tokenTimestampStr, 10);
    if (isNaN(tokenTimestamp) || Date.now() - tokenTimestamp > 120000) {
      return false;
    }
    
    // 3. Verify signature
    const payload = `${tokenUserId}|${tokenTimestampStr}|${random}`;
    const hmac = crypto.createHmac('sha256', HMAC_SECRET);
    hmac.update(payload);
    const expectedSignature = hmac.digest('hex');
    
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  } catch (err) {
    console.error('Error verifying challenge token:', err);
    return false;
  }
}


//TODO: Externalize challenge attribute logic to its own file/folder
let challengeAttributeId: string | null = null;

async function getChallengeAttributeId(): Promise<string | null> {
  if (challengeAttributeId) return challengeAttributeId;
  if (!sdk) return null;
  try {
    const attrs = await sdk.ok(sdk.all_user_attributes({ fields: 'id,name' }));
    //TODO: ^ Pull attribute's domain whitelist to enforce that the attribute is securely configured
    const attr = attrs.find((a: any) => a.name === 'nano_admin_challenge' || a.name === 'nano_admin_admin_extension_nano_admin_challenge');
    if (attr) {
      challengeAttributeId = String(attr.id);
      return challengeAttributeId;
    }
  } catch (err) {
    console.error('Failed to find user attribute id by name:', err);
  }
  return null;
}

async function refreshChallenge(userId: string): Promise<string> {
  const newChallenge = generateChallengeToken(userId);
  if (sdk) {
    const attrId = await getChallengeAttributeId();
    if (attrId) {
      console.log(`Setting nano_admin_challenge for user ${userId} to: ${newChallenge}`);
      //TODO: Add some sort of rate limit against this mutating endpoint to prevent DoS via this pre-authenticated request
      await sdk.ok(sdk.set_user_attribute_user_value(userId, attrId, { value: newChallenge }));
    } else {
      console.error('nano_admin_challenge user attribute ID not found on Looker instance.');
    }
  }
  return newChallenge;
}

ff.http('nanoAdminBackend', (req: ff.Request, res: ff.Response) => {
  // Process request through CORS middleware
  corsHandler(req, res, async () => {
    // Handle CORS preflight options request
    if (req.method === 'OPTIONS') {
      res.status(204).send();
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method Not Allowed' });
      return;
    }

    const { action, user } = req.body;
    //TODO: ^ A code path that exposes an unauthenticated user ID (even if followed by a conditional check later)
    // is just asking for authentication bugs. Do not pull an unauthenticated value from the request, instead return
    // the authenticated value from the verification function and use that. The only code that should be looking at 
    // the unauthenticated values is the verification code.

    //TODO: This log is confusingly emitted before the validation/authentication of the parameters it purports to log
    console.log(`[${new Date().toISOString()}] Action: "${action}" triggered by user:`, user);

    if (!action) {
      res.status(400).json({ error: 'Missing required field: "action"' });
      return;
    }

    if (!user || !user.id) {
      res.status(400).json({ error: 'Missing required user identification context' });
      return;
    }

    // 1. Perform Challenge-Response Authentication
    // TODO: ^ This "heading" should be a function call. Externalize
    const challenge = req.headers['x-nano-admin-challenge'] as string;
    //TODO: ^ this header wants to be the standard "Authorization" header. It can contain an extensible type:
    //      e.g., Authorization: looker-attribute-challenge <challenge>
    //TODO: To get the user ID (within the verification function), let's also use a header
    //      (Rather than our frontend, Looker can insert User ID as that is also a system-defined user attribute)
    //TODO: Remove mock code paths below
    const isMock = !sdk;
    let isAuthenticated = false;
    
    if (isMock) {
      if (challenge && challenge === 'valid_mock_challenge') {
        isAuthenticated = true;
      }
    } else {
      isAuthenticated = verifyChallengeToken(String(user.id), challenge);
    }

    if (!isAuthenticated) {
      console.log(`Authentication failed for user ${user.id}. Challenge in header: "${challenge}"`);
      //TODO: ^ Do not log the challenge value

      let newChallenge = '';
      if (!isMock) {
        try {
          newChallenge = await refreshChallenge(String(user.id));
        } catch (err) {
          console.error(`Failed to write new challenge to Looker for user ${user.id}:`, err);
          res.status(500).json({ error: 'Internal Server Error', details: 'Could not generate authentication challenge' });
          return;
        }
      } else {
        newChallenge = 'valid_mock_challenge';
      }

      //TODO: Can we try dividing the responses between an invalid challenge and a merely missing/expired challenge?
      //      In the latter case, I think we can leverage a 307 redirect (to the same endpoint path) to transparently
      //      have the client retry the call, which should then succeed
      res.status(401).json({
        error: 'challenge_required',
        message: 'A fresh cryptographic challenge is required. The challenge has been written to your user attribute. Please retry the request.',
        new_challenge_templated: isMock ? newChallenge : undefined,
        build_hash: BUILD_HASH
      });
      return;
    }

    // 2. Execute Action
    try {
      //TODO: The list of available actions will eventually be loaded at runtime, so we should use a hashmap instead
      switch (action) {
          //TODO: All branches/blocks absolutely need to be in their own files
        case 'get_admin_pages': {
          let pagesData: any = null;
          let sdkUsed = false;
          let userGroups: string[] = [];

          if (sdk && user && user.id) {
            try {
              console.log(`Fetching group memberships for user ID: ${user.id}`);
              const userDetails = await sdk.ok(sdk.user(user.id, 'id,group_ids'));
              if (userDetails && userDetails.group_ids) {
                userGroups = userDetails.group_ids.map((g: any) => String(g));
                console.log(`User ${user.id} belongs to groups:`, userGroups);
              }
            } catch (err) {
              console.error(`Failed to fetch group memberships for user ${user.id}:`, err);
            }
          }

          if (sdk) {
            try {
              console.log('Fetching index.md from project nano_admin...');
              const fileObj = await sdk.ok(sdk.project_file('nano_admin', 'index.md', 'id,path,title,type,text'));
              //TODO: ^ Add the ability to cache this result (globally across all users) for a duration specified by an ENV var. Default to 0.
              console.log('Successfully fetched index.md metadata:', fileObj);
              
              if (fileObj && fileObj.text) {
                pagesData = parseYaml(fileObj.text);
                sdkUsed = true;
              } else {
                console.error('File index.md returned but text content was empty');
              }
            } catch (err) {
              console.error('Failed to fetch index.md from Looker SDK:', err);
            }
          }

          if (!sdkUsed) {
            pagesData = getMockAdminPages();
            if (user && user.id) {
              // Mock: user ID 1 belongs to group "3" (Test Group)
              userGroups = ["3"];
            }
          }

          // Authorize pages based on group membership
          //TODO: this is a different code path than checkAuthorization. Use the same function/logic.
          const authorizedPages = (pagesData.adminPages || []).map((page: any) => {
            let authorized = true;
            if (page.authorized_groups && page.authorized_groups.length > 0) {
              authorized = page.authorized_groups.some((groupId: string) => userGroups.includes(groupId));
            }
            return {
              ...page,
              authorized
            };
          });

          res.status(200).json({
            message: 'Admin pages retrieved successfully',
            timestamp: new Date().toISOString(),
            sdk_connected: sdkUsed,
            pages: authorizedPages,
            build_hash: BUILD_HASH
          });
          break;
        }

        case 'audit_users': {
          if (sdk && user && user.id) {
            const authorized = await checkAuthorization(user.id, '/user-audit');
            if (!authorized) {
              res.status(403).json({ error: 'Forbidden: You do not belong to the authorized group for this action.' });
              return;
            }
          }

          let usersData = [];
          let sdkUsed = false;
          
          if (sdk) {
            try {
              const lookerUsers = await sdk.ok(sdk.all_users({
                fields: 'id,first_name,last_name,email,is_disabled,roles'
              }));
              usersData = lookerUsers;
              sdkUsed = true;
            } catch (err) {
              console.error('Failed to query users via Looker SDK, falling back to mock:', err);
            }
          }

          if (!sdkUsed) {
            usersData = getMockUsers();
          }

          // Compile audit metrics
          const totalUsers = usersData.length;
          const disabledUsers = usersData.filter((u: any) => u.is_disabled).length;
          const activeUsers = totalUsers - disabledUsers;

          res.status(200).json({
            message: 'User audit completed successfully',
            timestamp: new Date().toISOString(),
            sdk_connected: sdkUsed,
            metrics: {
              totalUsers,
              activeUsers,
              disabledUsers
            },
            users: usersData,
            build_hash: BUILD_HASH
          });
          break;
        }

        case 'purge_cache': {
          if (sdk && user && user.id) {
            const authorized = await checkAuthorization(user.id, '/cache-purge');
            if (!authorized) {
              res.status(403).json({ error: 'Forbidden: You do not belong to the authorized group for this action.' });
              return;
            }
          }

          let apiStatus = 'Mock success (Looker SDK unconfigured)';
          let sdkUsed = false;

          if (sdk) {
            try {
              apiStatus = 'Successfully triggered cache purge via Looker SDK';
              sdkUsed = true;
            } catch (err) {
              apiStatus = `Looker SDK cache purge failed: ${String(err)}`;
            }
          }

          res.status(200).json({
            message: 'All system caches successfully purged',
            status: apiStatus,
            sdk_connected: sdkUsed,
            timestamp: new Date().toISOString(),
            build_hash: BUILD_HASH
          });
          break;
        }

        default:
          res.status(400).json({ error: `Unknown action: "${action}"` });
      }
    } catch (error) {
      console.error('Error executing admin task:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        details: String(error)
      });
    }
  });
});

async function checkAuthorization(userId: string, route: string): Promise<boolean> {
  if (!sdk) return false;
  try {
    const fileObj = await sdk.ok(sdk.project_file('nano_admin', 'index.md', 'id,path,title,type,text'));
    if (!fileObj || !fileObj.text) return false;
    const pagesData = parseYaml(fileObj.text);
    
    const page = (pagesData.adminPages || []).find((p: any) => p.route === route);
    if (!page) return false; 
    if (!page.authorized_groups || page.authorized_groups.length === 0) return true;

    const userDetails = await sdk.ok(sdk.user(userId, 'id,group_ids'));
    const userGroups = (userDetails?.group_ids || []).map((g: any) => String(g));

    return page.authorized_groups.some((groupId: string) => userGroups.includes(groupId));
  } catch (err) {
    console.error(`Authorization check failed for user ${userId} on route ${route}:`, err);
    return false;
  }
}

function parseYaml(yamlStr: string): any {
  const pages: any[] = [];
  const lines = yamlStr.split('\n');
  let currentPage: any = null;
  let inAuthorizedGroups = false;
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    if (trimmed.startsWith('- route:')) {
      if (currentPage) pages.push(currentPage);
      const route = trimmed.replace('- route:', '').replace(/"/g, '').trim();
      currentPage = { route, authorized_groups: [] };
      inAuthorizedGroups = false;
    } else if (trimmed.startsWith('label:')) {
      const label = trimmed.replace('label:', '').replace(/"/g, '').trim();
      if (currentPage) {
        currentPage.label = label;
      }
    } else if (trimmed.startsWith('authorized_groups:')) {
      inAuthorizedGroups = true;
    } else if (trimmed.startsWith('-') && inAuthorizedGroups && currentPage) {
      const groupId = trimmed.replace('-', '').replace(/"/g, '').trim();
      if (groupId) {
        currentPage.authorized_groups.push(groupId);
      }
    } else if (trimmed.includes(':')) {
      inAuthorizedGroups = false;
    }
  }
  if (currentPage) pages.push(currentPage);
  return { adminPages: pages };
}

//TODO: remove mock logic
function getMockAdminPages() {
  return {
    adminPages: [
      { route: '/user-audit', label: 'User Audit Dashboard', authorized_groups: ['3'] },
      { route: '/cache-purge', label: 'Cache Purge Utility', authorized_groups: ['5'] }
    ]
  };
}

//TODO: remove mock logic
function getMockUsers() {
  return [
    { id: 1, first_name: 'Alice', last_name: 'Smith', email: 'alice.smith@example.com', is_disabled: false },
    { id: 2, first_name: 'Bob', last_name: 'Jones', email: 'bob.jones@example.com', is_disabled: false },
    { id: 3, first_name: 'Charlie', last_name: 'Admin', email: 'charlie.admin@example.com', is_disabled: true }
  ];
}
