import yaml from 'js-yaml';
import * as https from 'https';
import { URL } from 'url';

import { LookerBackendSDK } from './looker_logging_sdk';

const cachedWorkflowsByHost = new Map<string, { data: any; expiration: number }>();

export function clearWorkflowCache(): void {
  cachedWorkflowsByHost.clear();
}

export function setCachedWorkflows(instanceHost: string, data: any, durationMs: number = 60000): void {
  const cacheKey = instanceHost ? instanceHost.trim().toLowerCase() : '__default__';
  cachedWorkflowsByHost.set(cacheKey, { data, expiration: Date.now() + durationMs });
}

export interface YamlParseResult {
  data: any;
  parseError: string | null;
}

export function parseYamlWithStatus(yamlStr: string): YamlParseResult {
  try {
    const data = yaml.load(yamlStr) || {};
    return { data, parseError: null };
  } catch (e: any) {
    const errMsg = e?.message || String(e);
    console.error('Error parsing YAML configuration:', errMsg);
    return { data: {}, parseError: errMsg };
  }
}

export function parseYaml(yamlStr: string): any {
  return parseYamlWithStatus(yamlStr).data;
}

/**
 * Resolves the effective authorized Looker group IDs for a given workflow and instance host.
 *
 * Rules:
 * - Missing, null, or empty configurations return [] (Default-Deny).
 * - Array format: Returns all group IDs as strings (unqualified, single-instance).
 * - Dictionary format: Matches against instanceHost (literal string match, case-insensitive).
 *   - If instanceHost matches a key, returns that key's group IDs as strings.
 *   - If instanceHost is missing, empty, or not found in the dictionary, returns [] (Default-Deny).
 */
export function resolveAuthorizedGroups(
  authorizedGroupsConfig: any,
  instanceHost?: string
): string[] {
  if (!authorizedGroupsConfig) {
    return [];
  }

  // 1. Array format: Unqualified IDs for single-instance
  if (Array.isArray(authorizedGroupsConfig)) {
    return authorizedGroupsConfig.map((gid) => String(gid).trim()).filter(Boolean);
  }

  // 2. Dictionary format: host-keyed map
  if (typeof authorizedGroupsConfig === 'object') {
    if (!instanceHost) {
      return [];
    }
    const cleanHost = instanceHost.trim().toLowerCase();

    // Direct lookup or case-insensitive key lookup
    let hostGroups = authorizedGroupsConfig[instanceHost];
    if (!hostGroups) {
      const matchingKey = Object.keys(authorizedGroupsConfig).find(
        (k) => k.trim().toLowerCase() === cleanHost
      );
      if (matchingKey) {
        hostGroups = authorizedGroupsConfig[matchingKey];
      }
    }

    if (Array.isArray(hostGroups)) {
      return hostGroups.map((gid) => String(gid).trim()).filter(Boolean);
    }
    return [];
  }

  return [];
}

export async function getWorkflows(sdk: LookerBackendSDK | any, instanceHost?: string): Promise<any> {
  const cacheDurationMs = parseInt(process.env.ADMIN_PAGES_CACHE_DURATION_MS || '0', 10);
  const now = Date.now();
  const cacheKey = instanceHost
    ? instanceHost.trim().toLowerCase()
    : (sdk?.authSession?.settings?.base_url || '__default__');

  const cached = cachedWorkflowsByHost.get(cacheKey);
  if (cached && now < cached.expiration) {
    return cached.data;
  }

  console.log('Fetching index.md from project nano_admin...');
  const baseUrl = sdk.authSession.settings.base_url;
  const authProps = await sdk.authSession.authenticate({ headers: {} });
  const authHeaders = authProps.headers;

  try {
    const url = `${baseUrl}/api/4.0/projects/nano_admin/file/content?file_path=index.md`;
    const text = await fetchRawText(url, authHeaders);
    const { data, parseError } = parseYamlWithStatus(text);
    const result = {
      ...data,
      indexFileLoaded: true,
      parseError: parseError || null
    };
    cachedWorkflowsByHost.set(cacheKey, { data: result, expiration: now + cacheDurationMs });
    return result;
  } catch (err: any) {
    console.warn('Failed to load index.md from project nano_admin:', err.message || err);
    const fallback = { workflows: [], indexFileLoaded: false, parseError: null };
    cachedWorkflowsByHost.set(cacheKey, { data: fallback, expiration: now + cacheDurationMs });
    return fallback;
  }
}

export async function getUserGroups(sdk: LookerBackendSDK | any, userId: string): Promise<string[]> {
  console.log(`Fetching group memberships for user ID: ${userId}`);
  const userDetails = await sdk.ok(sdk.user(userId, 'id,group_ids'));
  return (userDetails?.group_ids || []).map((g: any) => String(g));
}

export async function isUserAuthorized(
  sdk: LookerBackendSDK | any,
  userId: string,
  identifier: string,
  instanceHost?: string
): Promise<boolean> {
  const configData = await getWorkflows(sdk, instanceHost);
  const cleanId = identifier.replace(/^\//, '');
  const workflow = (configData.workflows || []).find((w: any) => w.id === identifier || w.id === cleanId);

  if (!workflow) return false;

  const allowedGroupIds = resolveAuthorizedGroups(workflow.authorized_groups, instanceHost);
  // DEFAULT-DENY: Workflows without valid group authorization are denied to everyone
  if (allowedGroupIds.length === 0) return false;

  const userGroups = await getUserGroups(sdk, userId);
  return allowedGroupIds.some((groupId: string) => userGroups.includes(groupId));
}

/**
 * Resolves all Looker user IDs for Scope Group(s) that a given user belongs to.
 * Finds groups of the user that have the specified user attribute set to "yes".
 * When includeSubgroups is true, also includes users belonging to descendant child groups.
 * Returns an array of string user IDs.
 */
export async function getScopeGroupUserIds(
  sdk: any,
  userId: string,
  attributeName: string = 'nano_admin_is_workflow_scope_group',
  includeSubgroups: boolean = false
): Promise<string[]> {
  console.log(`Resolving scope group user IDs for user ${userId} with attribute "${attributeName}"...`);

  const userGroupIds = await getUserGroups(sdk, userId);
  if (!userGroupIds || userGroupIds.length === 0) {
    return [];
  }

  const allAttributes = await sdk.ok(sdk.all_user_attributes({}));
  const targetAttr = (allAttributes || []).find((attr: any) => attr.name === attributeName);
  if (!targetAttr) {
    console.warn(`User attribute "${attributeName}" not found in Looker instance.`);
    return [];
  }

  const groupValues = await sdk.ok(sdk.all_user_attribute_group_values(targetAttr.id));

  const matchingGroupIds = (groupValues || [])
    .filter((gv: any) => String(gv.value || '').trim().toLowerCase() === 'yes')
    .map((gv: any) => String(gv.group_id))
    .filter((groupId: string) => userGroupIds.includes(groupId));

  if (matchingGroupIds.length === 0) {
    return [];
  }

  const targetGroupIdSet = new Set<string>(matchingGroupIds);

  if (includeSubgroups && typeof sdk.search_groups_with_hierarchy === 'function') {
    try {
      const hierarchyItems = await sdk.ok(sdk.search_groups_with_hierarchy({}));
      const childrenByParentId = new Map<string, string[]>();
      for (const item of hierarchyItems || []) {
        const childId = String(item.id);
        const parentIds: string[] = Array.isArray(item.parent_group_ids)
          ? item.parent_group_ids.map((p: any) => String(p))
          : [];
        for (const parentId of parentIds) {
          if (!childrenByParentId.has(parentId)) {
            childrenByParentId.set(parentId, []);
          }
          childrenByParentId.get(parentId)!.push(childId);
        }
      }

      const queue = [...matchingGroupIds];
      while (queue.length > 0) {
        const currentGroupId = queue.shift()!;
        const childIds = childrenByParentId.get(currentGroupId) || [];
        for (const cid of childIds) {
          if (!targetGroupIdSet.has(cid)) {
            targetGroupIdSet.add(cid);
            queue.push(cid);
          }
        }
      }
    } catch (err) {
      // Ignore subgroup hierarchy lookup error
    }
  }

  const scopeUserIdSet = new Set<string>();
  for (const groupId of Array.from(targetGroupIdSet)) {
    try {
      const groupUsers = await sdk.ok(sdk.all_group_users({ group_id: groupId, fields: 'id' }));
      (groupUsers || []).forEach((u: any) => {
        if (u.id !== undefined && u.id !== null) {
          scopeUserIdSet.add(String(u.id));
        }
      });
    } catch (err: any) {
      console.error(`Failed to fetch users for scope group ${groupId}:`, err);
    }
  }

  return Array.from(scopeUserIdSet);
}

/**
 * Resolves the set of Looker User IDs that are privileged accounts:
 * - Service Accounts (is_service_account === true)
 * - Looker Admins (holding the 'Admin' role or a role with 'administer', 'all_access', or 'unlimited' permissions)
 */
export async function getPrivilegedUserIds(sdk: any): Promise<Set<string>> {
  const privilegedIds = new Set<string>();
  const adminRoleIds = new Set<string>();

  if (typeof sdk.all_roles === 'function') {
    try {
      const allRoles = await sdk.ok(sdk.all_roles({}));
      for (const r of allRoles || []) {
        const isAdminRole =
          r.name === 'Admin' ||
          r.permission_set?.all_access === true ||
          r.permission_set?.unlimited === true ||
          (Array.isArray(r.permission_set?.permissions) &&
            r.permission_set.permissions.includes('administer'));
        if (isAdminRole && r.id !== undefined && r.id !== null) {
          adminRoleIds.add(String(r.id));
        }
      }
    } catch (err) {
      // Ignore role lookup failure
    }
  }

  if (typeof sdk.all_users === 'function') {
    try {
      const allUsers = await sdk.ok(
        sdk.all_users({
          fields: 'id,is_service_account,role_ids'
        })
      );
      for (const u of allUsers || []) {
        if (u.id === undefined || u.id === null) continue;
        const uid = String(u.id);
        const isServiceAccount = Boolean(u.is_service_account);
        const userRoleIds: string[] = Array.isArray(u.role_ids)
          ? u.role_ids.map((rid: any) => String(rid))
          : [];
        const isAdmin =
          Boolean(u.is_admin) || userRoleIds.some((rid) => adminRoleIds.has(rid));
        if (isServiceAccount || isAdmin) {
          privilegedIds.add(uid);
        }
      }
    } catch (err) {
      // Ignore user lookup failure
    }
  }

  return privilegedIds;
}

export type UserIdLimitationMode =
  | 'self'
  | 'scope_groups'
  | 'scope_groups_minus_privileged'
  | 'exclude_privileged'
  | 'none';

export interface UserIdLimitation {
  mode?: UserIdLimitationMode;
  attribute_name?: string;
  include_subgroups?: boolean;
}

export interface UserIdLimitationResult {
  active: boolean;
  userIds: string[];
  mode: UserIdLimitationMode;
}

export async function resolveUserIdLimitation(
  sdk: any,
  currentUserId: string,
  limitation?: UserIdLimitation,
  defaultMode: UserIdLimitationMode = 'self'
): Promise<UserIdLimitationResult> {
  const mode: UserIdLimitationMode = limitation?.mode || defaultMode;

  if (mode === 'none') {
    return { active: false, userIds: [], mode: 'none' };
  }

  if (mode === 'self') {
    return { active: true, userIds: [String(currentUserId)], mode: 'self' };
  }

  if (mode === 'exclude_privileged') {
    const [allUsers, privilegedIds] = await Promise.all([
      typeof sdk.all_users === 'function'
        ? sdk.ok(sdk.all_users({ fields: 'id,is_service_account,role_ids' }))
        : Promise.resolve([]),
      getPrivilegedUserIds(sdk)
    ]);
    const allowedIds = (allUsers || [])
      .map((u: any) => String(u.id))
      .filter((uid: string) => Boolean(uid) && !privilegedIds.has(uid));
    return { active: true, userIds: allowedIds, mode: 'exclude_privileged' };
  }

  if (mode === 'scope_groups' || mode === 'scope_groups_minus_privileged') {
    const attributeName = limitation?.attribute_name || 'nano_admin_is_workflow_scope_group';
    const includeSubgroups = Boolean(limitation?.include_subgroups);
    const scopeUserIds = await getScopeGroupUserIds(sdk, currentUserId, attributeName, includeSubgroups);

    if (mode === 'scope_groups_minus_privileged') {
      const privilegedIds = await getPrivilegedUserIds(sdk);
      const filteredIds = scopeUserIds.filter((uid) => !privilegedIds.has(String(uid)));
      return {
        active: true,
        userIds: filteredIds,
        mode: 'scope_groups_minus_privileged'
      };
    }

    return { active: true, userIds: scopeUserIds, mode: 'scope_groups' };
  }

  throw new Error(`Unsupported user_id_limitation mode: "${String(mode)}"`);
}



function fetchRawText(urlStr: string, headers: any): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const options = {
      method: 'GET',
      headers: headers,
      rejectUnauthorized: true
    };

    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP Error ${res.statusCode}: ${data}`));
        } else {
          resolve(data);
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.end();
  });
}
