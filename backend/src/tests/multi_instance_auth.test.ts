process.env.GCF_HMAC_SECRET = process.env.GCF_HMAC_SECRET || 'test_secret_for_tests_12345678901234567890';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAuthorizedGroups, isUserAuthorized, clearWorkflowCache, setCachedWorkflows } from '../auth_utils';
import { isHostAllowed, authenticateRequest } from '../auth';
import { getChallengeAttributeId, refreshChallenge, clearChallengeAttributeIdCache } from '../challenge';
import { validateWorkflowsSchema } from '../actions/validate_dev_index';
import { formatHostForLog, wrapLookerSDKWithLogging } from '../looker_logging_sdk';
import {
  inspectGroupHierarchyForScopeGroups,
  inspectPrivilegedScopeGroupMembers
} from '../workflow-templates/workflow-groups-manager/backend/audit_warnings';
// @ts-ignore
const { resolveAllowedInstances, sanitizeHostForSecret: gcpSanitizeHostForSecret } = require('../../../scripts/lib/gcp');

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

test('getChallengeAttributeId & refreshChallenge — caches user attribute ID per instanceHost without cross-instance pollution', async () => {
  clearChallengeAttributeIdCache();

  const updatedCalls: Array<{ host: string; userId: string; attrId: string; value: string }> = [];

  function createMockSdk(host: string, attrId: string) {
    let lookupCount = 0;
    return {
      getLookupCount: () => lookupCount,
      ok: async (val: any) => await val,
      all_user_attributes: async () => {
        lookupCount++;
        return [{ id: attrId, name: 'nano_admin_admin_extension_nano_admin_challenge' }];
      },
      user_attribute: async (id: string) => ({
        id,
        name: 'nano_admin_admin_extension_nano_admin_challenge',
        value_is_hidden: true,
        hidden_value_domain_whitelist: 'https://backend.example.run.app'
      }),
      set_user_attribute_user_value: async (userId: string, id: string, body: { value: string }) => {
        updatedCalls.push({ host, userId, attrId: id, value: body.value });
        return {};
      }
    };
  }

  const sdkLatam = createMockSdk('demolatam.cloud.looker.com', '20');
  const sdkEmea = createMockSdk('demoemea.cloud.looker.com', '27');

  // 1. First request on demolatam resolves and sets attribute ID 20
  await refreshChallenge(sdkLatam, 'demolatam.cloud.looker.com', '1762');
  assert.equal(sdkLatam.getLookupCount(), 1);
  assert.equal(updatedCalls.length, 1);
  assert.equal(updatedCalls[0].host, 'demolatam.cloud.looker.com');
  assert.equal(updatedCalls[0].attrId, '20');

  // 2. Subsequent request on demoemea resolves and sets its own attribute ID 27 (not 20)
  await refreshChallenge(sdkEmea, 'demoemea.cloud.looker.com', '2016');
  assert.equal(sdkEmea.getLookupCount(), 1);
  assert.equal(updatedCalls.length, 2);
  assert.equal(updatedCalls[1].host, 'demoemea.cloud.looker.com');
  assert.equal(updatedCalls[1].attrId, '27');

  // 3. Second call on demolatam uses cached ID 20 without re-querying all_user_attributes
  const cachedLatamId = await getChallengeAttributeId(sdkLatam, 'DEMOLATAM.CLOUD.LOOKER.COM');
  assert.equal(cachedLatamId, '20');
  assert.equal(sdkLatam.getLookupCount(), 1);

  // 4. Second call on demoemea uses cached ID 27 without re-querying all_user_attributes
  const cachedEmeaId = await getChallengeAttributeId(sdkEmea, 'demoemea.cloud.looker.com');
  assert.equal(cachedEmeaId, '27');
  assert.equal(sdkEmea.getLookupCount(), 1);
});

test('LookerBackendSDK wrapper — blocks update_session and /session mutations at runtime', async () => {
  const rawMockSdk: any = {
    ok: async (val: any) => await val,
    me: async () => ({ id: '1' }),
    update_session: async () => ({ workspace_id: 'dev' }),
    patch: async (path: string) => ({ path }),
    put: async (path: string) => ({ path })
  };

  const wrappedSdk: any = wrapLookerSDKWithLogging(rawMockSdk, {
    instanceHost: 'demoemea.cloud.looker.com',
    userId: '2016',
    action: 'test_action'
  });

  // Safe methods continue to work
  const meRes = await wrappedSdk.ok(wrappedSdk.me());
  assert.equal(meRes.id, '1');

  // Calling update_session throws immediately
  assert.throws(
    () => wrappedSdk.update_session({ workspace_id: 'dev' }),
    /Security Violation: Calling update_session or switching the backend Looker SDK session to the "dev" workspace is strictly forbidden/
  );

  // Calling patch or put targeting /session throws immediately
  assert.throws(
    () => wrappedSdk.patch('/session', { workspace_id: 'dev' }),
    /Security Violation: Mutating the backend Looker SDK session workspace is strictly forbidden/
  );
  assert.throws(
    () => wrappedSdk.put('/api/4.0/session', { workspace_id: 'dev' }),
    /Security Violation: Mutating the backend Looker SDK session workspace is strictly forbidden/
  );
});

test('formatHostForLog — limits logged hostnames to max 16 chars (12 leading + 4 hex hash when longer)', () => {
  // <= 16 chars returned as-is (lowercased/trimmed)
  assert.equal(formatHostForLog('short.host.com'), 'short.host.com');
  assert.equal(formatHostForLog('1234567890123456'), '1234567890123456');
  assert.equal(formatHostForLog('1234567890123456').length, 16);

  // > 16 chars truncated to 12 leading + 4 hex hash = 16 chars
  const longHost1 = 'demoemea.cloud.looker.com';
  const formatted1 = formatHostForLog(longHost1);
  assert.equal(formatted1.length, 16);
  assert.ok(formatted1.startsWith('demoemea.clo'));
  assert.match(formatted1.slice(12), /^[0-9a-f]{4}$/);

  const longHost2 = 'demowest.cloud.looker.com';
  const formatted2 = formatHostForLog(longHost2);
  assert.equal(formatted2.length, 16);
  assert.ok(formatted2.startsWith('demowest.clo'));
  assert.notEqual(formatted1, formatted2);

  // Two long hosts with identical 12-char prefixes still differ in their 4-char hash suffix
  const prefixA = '3ad6a770-cb93-1111.looker.app';
  const prefixB = '3ad6a770-cb93-2222.looker.app';
  assert.equal(formatHostForLog(prefixA).slice(0, 12), formatHostForLog(prefixB).slice(0, 12));
  assert.notEqual(formatHostForLog(prefixA), formatHostForLog(prefixB));
});

test('gcp.sanitizeHostForSecret — consistently strips port for secret lookup', () => {
  assert.equal(gcpSanitizeHostForSecret('custom.looker.app:8443'), 'custom_looker_app');
  assert.equal(gcpSanitizeHostForSecret('custom.looker.app'), 'custom_looker_app');
});

test('getChallengeAttributeId — enforces value_is_hidden: true and auto-remediates or throws if unhideable', async () => {
  clearChallengeAttributeIdCache();
  let updatedHiddenFlag = false;

  const sdkAutoRemediate: any = {
    ok: async (val: any) => await val,
    all_user_attributes: async () => [{ id: '88', name: 'nano_admin_challenge' }],
    user_attribute: async () => ({
      id: '88',
      name: 'nano_admin_challenge',
      value_is_hidden: false,
      hidden_value_domain_whitelist: 'https://backend.example.run.app'
    }),
    update_user_attribute: async (_id: string, body: any) => {
      if (body.value_is_hidden === true) {
        updatedHiddenFlag = true;
      }
      return { id: '88', name: 'nano_admin_challenge', value_is_hidden: true };
    }
  };

  const resolvedId = await getChallengeAttributeId(sdkAutoRemediate, 'unhidden.looker.app');
  assert.equal(resolvedId, '88');
  assert.equal(updatedHiddenFlag, true);

  // If update_user_attribute fails to set value_is_hidden: true, must refuse to proceed
  clearChallengeAttributeIdCache();
  const sdkCannotHide: any = {
    ok: async (val: any) => await val,
    all_user_attributes: async () => [{ id: '89', name: 'nano_admin_challenge' }],
    user_attribute: async () => ({
      id: '89',
      name: 'nano_admin_challenge',
      value_is_hidden: false
    }),
    update_user_attribute: async () => ({
      id: '89',
      name: 'nano_admin_challenge',
      value_is_hidden: false
    })
  };

  await assert.rejects(
    async () => await getChallengeAttributeId(sdkCannotHide, 'failhide.looker.app'),
    /Security error: Failed to enforce value_is_hidden=true/i
  );
});

test('workflow-groups-manager audit_warnings — detects deep (>1 level) subgroup hierarchy and privileged accounts in Scope Groups', async () => {
  const mockSdk: any = {
    ok: async (val: any) => await val,
    search_groups_with_hierarchy: async () => [
      { id: '10', name: 'Scope Group A', parent_group_ids: [] },
      { id: '11', name: 'Child L1', parent_group_ids: ['10'] },
      { id: '12', name: 'Grandchild L2', parent_group_ids: ['11'] }
    ],
    all_roles: async () => [
      {
        id: 'r_admin',
        name: 'Admin',
        permission_set: { id: 'ps1', name: 'Admin', all_access: true, permissions: ['administer'] }
      },
      {
        id: 'r_user',
        name: 'Standard User',
        permission_set: { id: 'ps2', name: 'User', all_access: false, permissions: ['access_data'] }
      }
    ]
  };

  const groupsMap = new Map<string, any>([
    ['10', { id: '10', name: 'Scope Group A' }],
    ['11', { id: '11', name: 'Child L1' }],
    ['12', { id: '12', name: 'Grandchild L2' }]
  ]);

  const activeScopeGroups = [
    { group_id: '10', group_name: 'Scope Group A', attribute_name: 'nano_admin_is_workflow_scope_group' }
  ];

  const hierarchyRes = await inspectGroupHierarchyForScopeGroups(mockSdk, activeScopeGroups, groupsMap);
  assert.equal(hierarchyRes.deepSubgroupWarnings.length, 1);
  assert.equal(hierarchyRes.deepSubgroupWarnings[0].group_id, '10');
  assert.equal(hierarchyRes.deepSubgroupWarnings[0].max_depth, 2);

  const workflows = [
    { id: 'um-wf', label: 'User Mgmt', template: 'user-management', parameters: {} }
  ];
  const activeScopeGroupsWithUsers = [
    {
      group_id: '10',
      group_name: 'Scope Group A',
      attribute_name: 'nano_admin_is_workflow_scope_group',
      users: [
        { id: '1', name: 'Super Admin', email: 'admin@example.com' },
        { id: '2', name: 'Automation Bot', email: 'bot@example.com' }
      ]
    }
  ];
  const usersMap = new Map<string, any>([
    ['1', { id: '1', role_ids: ['r_admin'], is_service_account: false }],
    ['2', { id: '2', role_ids: ['r_user'], is_service_account: true }]
  ]);

  const privRes = await inspectPrivilegedScopeGroupMembers(
    mockSdk,
    workflows,
    activeScopeGroupsWithUsers,
    usersMap
  );
  assert.equal(privRes.userMutationWorkflows.length, 1);
  assert.equal(privRes.privilegedScopeMembers.length, 2);
  assert.ok(privRes.privilegedScopeMembers.some((m) => m.user_id === '1' && m.is_admin));
  assert.ok(privRes.privilegedScopeMembers.some((m) => m.user_id === '2' && m.is_service_account));
});

