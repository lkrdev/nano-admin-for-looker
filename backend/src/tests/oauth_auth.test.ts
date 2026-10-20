process.env.GCF_HMAC_SECRET = process.env.GCF_HMAC_SECRET || 'test_secret_for_tests_12345678901234567890';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveInstanceAuthMode,
  extractTargetHostFromRedirectUri,
  verifyLookerOAuthToken,
  clearOAuthTokenCache,
  handleOAuthAuthorize,
  handleOAuthTokenExchange
} from '../oauth';
import { authenticateRequestAsync } from '../auth';
import { generateChallengeToken } from '../challenge';
// @ts-ignore
const { resolveInstanceAuthModesEnv } = require('../../../scripts/lib/gcp');

test('resolveInstanceAuthMode — supports JSON map, comma-separated, and semicolon-separated formats', () => {
  const jsonConfig = JSON.stringify({
    'private.looker.app': 'oauth',
    'public.looker.app': 'server_proxy'
  });
  assert.equal(resolveInstanceAuthMode('private.looker.app', jsonConfig), 'oauth');
  assert.equal(resolveInstanceAuthMode('PRIVATE.LOOKER.APP', jsonConfig), 'oauth');
  assert.equal(resolveInstanceAuthMode('public.looker.app', jsonConfig), 'server_proxy');
  assert.equal(resolveInstanceAuthMode('unknown.looker.app', jsonConfig), 'server_proxy');

  const semicolonConfig = 'hybrid.looker.app=oauth;pub.looker.app=server_proxy';
  assert.equal(resolveInstanceAuthMode('hybrid.looker.app', semicolonConfig), 'oauth');
  assert.equal(resolveInstanceAuthMode('pub.looker.app', semicolonConfig), 'server_proxy');

  const commaConfig = 'hybrid.looker.app=oauth,pub.looker.app=server_proxy';
  assert.equal(resolveInstanceAuthMode('hybrid.looker.app', commaConfig), 'oauth');
});

test('extractTargetHostFromRedirectUri — validates HTTPS and /extensions/oauth2_redirect suffix', () => {
  const valid = extractTargetHostFromRedirectUri('https://3ad6a770-cb93-42dc-b76d-b83ee5fa874a.looker.app/extensions/oauth2_redirect');
  assert.equal(valid.host, '3ad6a770-cb93-42dc-b76d-b83ee5fa874a.looker.app');

  const invalidPath = extractTargetHostFromRedirectUri('https://3ad6a770-cb93-42dc-b76d-b83ee5fa874a.looker.app/evil/callback');
  assert.equal(invalidPath.host, null);
  assert.match(invalidPath.error || '', /must end with \/extensions\/oauth2_redirect/i);

  const invalidProto = extractTargetHostFromRedirectUri('http://3ad6a770-cb93-42dc-b76d-b83ee5fa874a.looker.app/extensions/oauth2_redirect');
  assert.equal(invalidProto.host, null);
  assert.match(invalidProto.error || '', /https is required/i);
});

test('verifyLookerOAuthToken — verifies user ID and caches verified tokens', async () => {
  clearOAuthTokenCache();
  let fetchCalls = 0;
  const mockFetchUser = async (_host: string, token: string) => {
    fetchCalls++;
    if (token === 'valid_access_token') {
      return { statusCode: 200, body: JSON.stringify({ id: 42 }) };
    }
    return { statusCode: 401, body: JSON.stringify({ message: 'Unauthorized' }) };
  };

  // 1. Valid token matching expectedUserId
  const res1 = await verifyLookerOAuthToken('private.looker.app', 'valid_access_token', '42', mockFetchUser);
  assert.equal(res1.status, 'valid');
  assert.equal(res1.userId, '42');
  assert.equal(fetchCalls, 1);

  // 2. Subsequent verification uses cache (no extra network call)
  const res2 = await verifyLookerOAuthToken('private.looker.app', 'valid_access_token', '42', mockFetchUser);
  assert.equal(res2.status, 'valid');
  assert.equal(fetchCalls, 1);

  // 3. Mismatched user ID is rejected even when token is cached
  const mismatch = await verifyLookerOAuthToken('private.looker.app', 'valid_access_token', '99', mockFetchUser);
  assert.equal(mismatch.status, 'invalid');

  // 4. Invalid token fails
  const invalid = await verifyLookerOAuthToken('private.looker.app', 'bad_token', '42', mockFetchUser);
  assert.equal(invalid.status, 'invalid');
});

test('authenticateRequestAsync — supports both OAuth Bearer and Server Proxy challenge modes', async () => {
  clearOAuthTokenCache();
  const prevAllowed = process.env.LOOKER_ALLOWED_INSTANCES;
  const prevModes = process.env.LOOKER_INSTANCE_AUTH_MODES;
  process.env.LOOKER_ALLOWED_INSTANCES = 'private.looker.app,public.looker.app';
  process.env.LOOKER_INSTANCE_AUTH_MODES = 'private.looker.app=oauth;public.looker.app=server_proxy';

  try {
    const mockFetchUser = async (_host: string, token: string) => {
      if (token === 'oauth_token_user_7') {
        return { statusCode: 200, body: JSON.stringify({ id: 7 }) };
      }
      return { statusCode: 401, body: JSON.stringify({ message: 'Invalid token' }) };
    };

    // 1. OAuth Bearer success
    const oauthReq: any = {
      headers: {
        authorization: 'Bearer oauth_token_user_7',
        'x-looker-user-id': '7',
        'x-looker-host': 'private.looker.app'
      },
      body: {}
    };
    const oauthRes = await authenticateRequestAsync(oauthReq, mockFetchUser);
    assert.equal(oauthRes.status, 'valid');
    assert.equal(oauthRes.userId, '7');
    assert.equal(oauthRes.authMode, 'oauth');

    // 2. OAuth missing token on OAuth-configured instance returns authMode: 'oauth'
    const unauthOAuthReq: any = {
      headers: {
        'x-looker-user-id': '7',
        'x-looker-host': 'private.looker.app'
      },
      body: {}
    };
    const unauthOAuthRes = await authenticateRequestAsync(unauthOAuthReq, mockFetchUser);
    assert.equal(unauthOAuthRes.status, 'missing');
    assert.equal(unauthOAuthRes.authMode, 'oauth');

    // 3. Server Proxy challenge success
    const challengeToken = generateChallengeToken('public.looker.app', '15');
    const proxyReq: any = {
      headers: {
        authorization: `looker-attribute-challenge ${challengeToken}`,
        'x-looker-user-id': '15',
        'x-looker-host': 'public.looker.app'
      },
      body: {}
    };
    const proxyRes = await authenticateRequestAsync(proxyReq, mockFetchUser);
    assert.equal(proxyRes.status, 'valid');
    assert.equal(proxyRes.userId, '15');
    assert.equal(proxyRes.authMode, 'server_proxy');
  } finally {
    process.env.LOOKER_ALLOWED_INSTANCES = prevAllowed;
    process.env.LOOKER_INSTANCE_AUTH_MODES = prevModes;
  }
});

test('handleOAuthAuthorize & handleOAuthTokenExchange — validate allowlist and route OAuth requests', async () => {
  const prevAllowed = process.env.LOOKER_ALLOWED_INSTANCES;
  process.env.LOOKER_ALLOWED_INSTANCES = 'private.looker.app';

  try {
    let redirectedUrl = '';
    let statusSent = 0;
    let jsonPayload: any = null;
    const mockReq: any = {
      method: 'GET',
      query: {
        response_type: 'code',
        client_id: 'nano_admin_oauth_client',
        redirect_uri: 'https://private.looker.app/extensions/oauth2_redirect',
        scope: 'cors_api',
        state: 'xyz123',
        code_challenge: 'challenge_abc',
        code_challenge_method: 'S256'
      },
      body: {}
    };
    const mockRes: any = {
      status(code: number) {
        statusSent = code;
        return this;
      },
      json(payload: any) {
        jsonPayload = payload;
        return this;
      },
      redirect(code: number, url: string) {
        statusSent = code;
        redirectedUrl = url;
      }
    };

    handleOAuthAuthorize(mockReq, mockRes);
    assert.equal(statusSent, 302);
    assert.ok(redirectedUrl.startsWith('https://private.looker.app/auth?'));
    assert.ok(redirectedUrl.includes('client_id=nano_admin_oauth_client'));
    assert.ok(redirectedUrl.includes('code_challenge=challenge_abc'));

    // Disallowed host is rejected with 403
    const disallowedReq: any = {
      method: 'GET',
      query: {
        redirect_uri: 'https://untrusted.looker.app/extensions/oauth2_redirect'
      },
      body: {}
    };
    handleOAuthAuthorize(disallowedReq, mockRes);
    assert.equal(statusSent, 403);

    // Token exchange proxies POST body to https://<host>/api/token
    let postedUrl = '';
    let postedForm = '';
    const tokenReq: any = {
      method: 'POST',
      headers: {},
      query: {},
      body: {
        grant_type: 'authorization_code',
        client_id: 'nano_admin_oauth_client',
        redirect_uri: 'https://private.looker.app/extensions/oauth2_redirect',
        code: 'auth_code_123',
        code_verifier: 'verifier_456'
      }
    };
    await handleOAuthTokenExchange(tokenReq, mockRes, async (urlStr, formBody) => {
      postedUrl = urlStr;
      postedForm = formBody;
      return {
        statusCode: 200,
        body: JSON.stringify({ access_token: 'tok_abc', token_type: 'Bearer', expires_in: 3600 })
      };
    });
    assert.equal(statusSent, 200);
    assert.equal(postedUrl, 'https://private.looker.app/api/token');
    assert.ok(postedForm.includes('code=auth_code_123'));
    assert.equal(jsonPayload?.access_token, 'tok_abc');
  } finally {
    process.env.LOOKER_ALLOWED_INSTANCES = prevAllowed;
  }
});

test('resolveInstanceAuthModesEnv — generates semicolon-separated host=mode string', () => {
  const instances = [
    { looker_host: 'private.looker.app', looker_port: '443', auth_mode: 'oauth' },
    { looker_host: 'public.looker.app', looker_port: '443', auth_mode: 'server_proxy' }
  ];
  const envStr = resolveInstanceAuthModesEnv(instances, 'fallback.looker.app', '443', 'server_proxy');
  assert.equal(envStr, 'private.looker.app=oauth;public.looker.app=server_proxy');
});
