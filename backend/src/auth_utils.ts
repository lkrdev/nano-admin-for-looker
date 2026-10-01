import yaml from 'js-yaml';
import * as https from 'https';
import { URL } from 'url';

import { LookerNodeSDK } from '@looker/sdk-node';

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

export async function getWorkflows(sdk: any, instanceHost?: string): Promise<any> {
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

/**
 * Ephemerally fetches index.md content from the dev workspace using an isolated SDK session.
 * This guarantees the main production SDK session is never mutated.
 */
export async function fetchDevIndexContent(sdk?: any): Promise<{ text: string | null; error: string | null }> {
  console.log('Fetching development index.md using an isolated SDK session...');
  let devSdk: any = null;
  try {
    if (sdk && sdk.authSession && sdk.authSession.settings) {
      devSdk = LookerNodeSDK.init40(sdk.authSession.settings);
    } else {
      devSdk = LookerNodeSDK.init40();
    }
    await devSdk.ok(devSdk.update_session({ workspace_id: 'dev' }));

    const baseUrl = devSdk.authSession.settings.base_url;
    const authProps = await devSdk.authSession.authenticate({ headers: {} });
    const url = `${baseUrl}/api/4.0/projects/nano_admin/file/content?file_path=index.md`;
    const text = await fetchRawText(url, authProps.headers);
    return { text, error: null };
  } catch (err: any) {
    console.error('Failed to fetch development index.md:', err);
    return { text: null, error: err.message || String(err) };
  } finally {
    if (devSdk) {
      try {
        await devSdk.ok(devSdk.update_session({ workspace_id: 'production' }));
      } catch (e) {
        // Ignore cleanup error on ephemeral session
      }
    }
  }
}


export async function getUserGroups(sdk: any, userId: string): Promise<string[]> {
  console.log(`Fetching group memberships for user ID: ${userId}`);
  const userDetails = await sdk.ok(sdk.user(userId, 'id,group_ids'));
  return (userDetails?.group_ids || []).map((g: any) => String(g));
}

export async function isUserAuthorized(
  sdk: any,
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
 * Returns an array of string user IDs.
 */
export async function getScopeGroupUserIds(
  sdk: any,
  userId: string,
  attributeName: string = 'nano_admin_is_workflow_scope_group'
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

  const scopeUserIdSet = new Set<string>();
  for (const groupId of matchingGroupIds) {
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

export interface UserIdLimitation {
  mode?: 'self' | 'scope_groups' | 'none';
  attribute_name?: string;
}

export interface UserIdLimitationResult {
  active: boolean;
  userIds: string[];
  mode: 'self' | 'scope_groups' | 'none' | string;
}

export async function resolveUserIdLimitation(
  sdk: any,
  currentUserId: string,
  limitation?: UserIdLimitation
): Promise<UserIdLimitationResult> {
  const mode = limitation?.mode || 'self';

  if (mode === 'none') {
    return { active: false, userIds: [], mode: 'none' };
  }

  if (mode === 'scope_groups' || (mode as any) === 'tenant_groups') {
    const attributeName = limitation?.attribute_name || 'nano_admin_is_workflow_scope_group';
    const scopeUserIds = await getScopeGroupUserIds(sdk, currentUserId, attributeName);
    return { active: true, userIds: scopeUserIds, mode: 'scope_groups' };
  }

  // Default mode: 'self'
  return { active: true, userIds: [String(currentUserId)], mode: 'self' };
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
