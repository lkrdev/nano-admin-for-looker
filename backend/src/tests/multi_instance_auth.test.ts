process.env.GCF_HMAC_SECRET = process.env.GCF_HMAC_SECRET || 'test_secret_for_tests_12345678901234567890';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAuthorizedGroups, isUserAuthorized, clearWorkflowCache, setCachedWorkflows } from '../auth_utils';
import { isHostAllowed, authenticateRequest } from '../auth';
import { validateWorkflowsSchema } from '../actions/validate_dev_index';
// @ts-ignore
const { resolveAllowedInstances } = require('../../../scripts/lib/gcp');

test('resolveAuthorizedGroups — single-instance array format', () => {
  assert.deepEqual(resolveAuthorizedGroups(['1', '2', '3']), ['1', '2', '3']);
  // Coerces numbers to strings
  assert.deepEqual(resolveAuthorizedGroups([10, 20]), ['10', '20']);
  // Trims whitespace and ignores empty items
  assert.deepEqual(resolveAuthorizedGroups([' 5 ', '']), ['5']);
});

test('resolveAuthorizedGroups — multi-instance dictionary format', () => {
  const config = {
    'dev.looker.app': ['1', '2'],
    'prod.looker.app': ['3', '4'],
    'custom.looker.app:8443': ['5']
  };

  // Resolves dev host
  assert.deepEqual(resolveAuthorizedGroups(config, 'dev.looker.app'), ['1', '2']);
  // Case-insensitive host matching
  assert.deepEqual(resolveAuthorizedGroups(config, 'DEV.LOOKER.APP'), ['1', '2']);
  // Resolves prod host
  assert.deepEqual(resolveAuthorizedGroups(config, 'prod.looker.app'), ['3', '4']);
  // Literal host:port match
  assert.deepEqual(resolveAuthorizedGroups(config, 'custom.looker.app:8443'), ['5']);
  // Unmatched host returns empty array (default-deny)
  assert.deepEqual(resolveAuthorizedGroups(config, 'other.looker.app'), []);
  // Missing instanceHost parameter returns empty array (default-deny)
  assert.deepEqual(resolveAuthorizedGroups(config, undefined), []);
  assert.deepEqual(resolveAuthorizedGroups(config, ''), []);
});

test('resolveAuthorizedGroups — default-deny on missing, null, or invalid input', () => {
  assert.deepEqual(resolveAuthorizedGroups(undefined, 'dev.looker.app'), []);
  assert.deepEqual(resolveAuthorizedGroups(null, 'dev.looker.app'), []);
  assert.deepEqual(resolveAuthorizedGroups([], 'dev.looker.app'), []);
  assert.deepEqual(resolveAuthorizedGroups({}, 'dev.looker.app'), []);
  assert.deepEqual(resolveAuthorizedGroups('invalid-string', 'dev.looker.app'), []);
  assert.deepEqual(resolveAuthorizedGroups(12345, 'dev.looker.app'), []);
});

test('isUserAuthorized — enforces default-deny and multi-instance authorization', async () => {
  const mockSdk = {
    authSession: {
      settings: { base_url: 'https://test.looker.com' },
      authenticate: async () => ({ headers: {} })
    },
    ok: async (promiseOrVal: any) => await promiseOrVal,
    user: async (userId: string) => ({ id: userId, group_ids: ['10', '20'] })
  };

  // Helper to mock SDK index.md loading
  clearWorkflowCache();

  // Test 1: Workflow with single-instance array
  const mockWorkflows = {
    workflows: [
      { id: 'single-wf', authorized_groups: ['10'] },
      { id: 'unauthorized-wf', authorized_groups: ['99'] },
      { id: 'empty-groups-wf', authorized_groups: [] },
      { id: 'missing-groups-wf' },
      {
        id: 'multi-instance-wf',
        authorized_groups: {
          'dev.looker.app': ['10'],
          'prod.looker.app': ['99']
        }
      }
    ],
    indexFileLoaded: true,
    parseError: null
  };

  setCachedWorkflows('dev.looker.app', mockWorkflows);
  setCachedWorkflows('prod.looker.app', mockWorkflows);
  setCachedWorkflows('stage.looker.app', mockWorkflows);

  // Single-wf: group 10 matches user -> true
  const singleResult = await isUserAuthorized(mockSdk, 'user1', 'single-wf', 'dev.looker.app');
  assert.equal(singleResult, true);

  // Unauthorized-wf: group 99 does not match user -> false
  const unauthorizedResult = await isUserAuthorized(mockSdk, 'user1', 'unauthorized-wf', 'dev.looker.app');
  assert.equal(unauthorizedResult, false);

  // Empty-groups-wf: DEFAULT-DENY -> false
  const emptyResult = await isUserAuthorized(mockSdk, 'user1', 'empty-groups-wf', 'dev.looker.app');
  assert.equal(emptyResult, false);

  // Missing-groups-wf: DEFAULT-DENY -> false
  const missingResult = await isUserAuthorized(mockSdk, 'user1', 'missing-groups-wf', 'dev.looker.app');
  assert.equal(missingResult, false);

  // Multi-instance-wf on dev.looker.app: group 10 matches user -> true
  const devResult = await isUserAuthorized(mockSdk, 'user1', 'multi-instance-wf', 'dev.looker.app');
  assert.equal(devResult, true);

  // Multi-instance-wf on prod.looker.app: group 99 does not match user -> false
  const prodResult = await isUserAuthorized(mockSdk, 'user1', 'multi-instance-wf', 'prod.looker.app');
  assert.equal(prodResult, false);

  // Multi-instance-wf on stage.looker.app: host not configured -> DEFAULT-DENY -> false
  const stageResult = await isUserAuthorized(mockSdk, 'user1', 'multi-instance-wf', 'stage.looker.app');
  assert.equal(stageResult, false);
});

test('isHostAllowed — enforces LOOKER_ALLOWED_INSTANCES allowlist', () => {
  // 1. Permissive when env var is not set or empty
  assert.equal(isHostAllowed('any.host.com', undefined), true);
  assert.equal(isHostAllowed('any.host.com', ''), true);
  assert.equal(isHostAllowed('any.host.com', '   '), true);

  // 2. Strict when env var is configured
  const allowlist = 'dev.looker.app, prod.looker.app, custom.looker.app:8443';
  assert.equal(isHostAllowed('dev.looker.app', allowlist), true);
  assert.equal(isHostAllowed('DEV.LOOKER.APP', allowlist), true);
  assert.equal(isHostAllowed('prod.looker.app', allowlist), true);
  assert.equal(isHostAllowed('custom.looker.app:8443', allowlist), true);

  // Disallowed hosts
  assert.equal(isHostAllowed('evil.attacker.com', allowlist), false);
  assert.equal(isHostAllowed('localhost:8080', allowlist), false);
  assert.equal(isHostAllowed('stage.looker.app', allowlist), false);
});

test('validateIndexWorkflows — rejects protocol in authorized_groups host keys', () => {
  // Protocol in key (e.g. https://dev.looker.app) must be rejected
  const invalidWorkflows = [
    {
      id: 'test-wf',
      label: 'Test Workflow',
      template: 'crud',
      authorized_groups: {
        'https://dev.looker.app': ['1']
      }
    }
  ];

  const result = validateWorkflowsSchema({ workflows: invalidWorkflows });
  assert.equal(result.valid, false);
  assert.match(result.error || '', /protocol \(https:\/\/\) is not allowed/i);
});

test('validateWorkflowsSchema — accepts valid multi-instance dictionary without protocol', () => {
  const validWorkflows = [
    {
      id: 'test-wf',
      label: 'Test Workflow',
      template: 'crud',
      authorized_groups: {
        'dev.looker.app': ['1', '2'],
        'prod.looker.app': ['3']
      }
    }
  ];

  const result = validateWorkflowsSchema({ workflows: validWorkflows });
  assert.equal(result.valid, true);
  assert.equal(result.workflows[0].authorized_groups_count, 3);
});

test('resolveAllowedInstances — generates comma-separated list from config', () => {
  // Single instance fallback
  assert.equal(resolveAllowedInstances([], 'single.looker.app', '443'), 'single.looker.app');
  assert.equal(resolveAllowedInstances([], 'single.looker.app', '8443'), 'single.looker.app,single.looker.app:8443');

  // Multiple instances
  const instances = [
    { looker_host: 'dev.looker.app', looker_port: '443' },
    { looker_host: 'prod.looker.app', looker_port: '443' },
    { looker_host: 'custom.looker.app', looker_port: '8443' }
  ];
  const resolved = resolveAllowedInstances(instances, 'fallback.looker.app', '443');
  assert.ok(resolved.includes('dev.looker.app'));
  assert.ok(resolved.includes('prod.looker.app'));
  assert.ok(resolved.includes('custom.looker.app'));
  assert.ok(resolved.includes('custom.looker.app:8443'));
});
