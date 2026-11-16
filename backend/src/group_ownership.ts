import { getUserGroups } from './auth_utils';

export const DEFAULT_GROUP_OWNERS_ATTRIBUTE = 'nano_admin_group_owners';

export interface GroupOwnerSpecifier {
  type: 'user' | 'group';
  id: string;
}

export interface ResolvedGroupOwner extends GroupOwnerSpecifier {
  name: string;
  email?: string;
  exists: boolean;
}

export interface GroupOwnershipRecord {
  group_id: string;
  attribute_id: string | null;
  attribute_name: string;
  raw_value: string;
  specifiers: GroupOwnerSpecifier[];
  owners: ResolvedGroupOwner[];
  owner_count: number;
}

export interface OwnedGroupNode {
  id: string;
  name: string;
  is_direct_owner: boolean;
  depth: number;
  parent_group_ids: string[];
  role_ids: string[];
  user_count: number;
  owners: ResolvedGroupOwner[];
  owner_count: number;
  subgroups: OwnedGroupNode[];
}

/**
 * Parses a group ownership attribute value in strict canonical format:
 * comma-separated tokens of 'u:<user_id>' and 'g:<group_id>'.
 */
export function parseGroupOwnerSpecifiers(rawValue: string): GroupOwnerSpecifier[] {
  if (!rawValue || typeof rawValue !== 'string') {
    return [];
  }

  const seen = new Set<string>();
  const result: GroupOwnerSpecifier[] = [];

  for (const part of rawValue.split(',')) {
    const token = part.trim();
    if (!token) continue;

    if (token.startsWith('u:')) {
      const uid = token.slice(2).trim();
      if (uid && !seen.has(`u:${uid}`)) {
        seen.add(`u:${uid}`);
        result.push({ type: 'user', id: uid });
      }
    } else if (token.startsWith('g:')) {
      const gid = token.slice(2).trim();
      if (gid && !seen.has(`g:${gid}`)) {
        seen.add(`g:${gid}`);
        result.push({ type: 'group', id: gid });
      }
    }
  }

  return result;
}

/**
 * Formats an array of GroupOwnerSpecifiers into strict canonical 'u:<id>,g:<id>' string.
 */
export function formatGroupOwnerSpecifiers(specifiers: GroupOwnerSpecifier[]): string {
  const seen = new Set<string>();
  const tokens: string[] = [];

  for (const spec of specifiers || []) {
    const cleanId = String(spec.id || '').trim();
    if (!cleanId) continue;
    const prefix = spec.type === 'group' ? 'g' : 'u';
    const key = `${prefix}:${cleanId}`;
    if (!seen.has(key)) {
      seen.add(key);
      tokens.push(key);
    }
  }

  return tokens.join(',');
}

/**
 * Resolves group ownership records across all Looker groups for a given ownership attribute name.
 */
export async function resolveAllGroupsOwnershipMap(
  sdk: any,
  attributeName: string = DEFAULT_GROUP_OWNERS_ATTRIBUTE,
  preloadedUsersMap?: Map<string, any>,
  preloadedGroupsMap?: Map<string, any>,
  preloadedAttributes?: any[]
): Promise<{
  attributeExists: boolean;
  attributeId: string | null;
  ownershipByGroupId: Map<string, GroupOwnershipRecord>;
}> {
  const allAttributes =
    preloadedAttributes ||
    (typeof sdk.all_user_attributes === 'function' ? await sdk.ok(sdk.all_user_attributes({})) : []);

  const targetAttr = (allAttributes || []).find((a: any) => a.name === attributeName);
  const ownershipByGroupId = new Map<string, GroupOwnershipRecord>();

  if (!targetAttr) {
    return {
      attributeExists: false,
      attributeId: null,
      ownershipByGroupId
    };
  }

  const usersMap = preloadedUsersMap || (await buildUsersMap(sdk));
  const groupsMap = preloadedGroupsMap || (await buildGroupsMap(sdk));

  let groupValues: any[] = [];
  try {
    groupValues = await sdk.ok(sdk.all_user_attribute_group_values(targetAttr.id));
  } catch (err) {
    groupValues = [];
  }

  for (const gv of groupValues || []) {
    const groupId = String(gv.group_id);
    const rawValue = String(gv.value || '').trim();
    const specifiers = parseGroupOwnerSpecifiers(rawValue);
    if (specifiers.length === 0) continue;

    const owners: ResolvedGroupOwner[] = specifiers.map((spec) =>
      resolveOwnerMetadata(spec, usersMap, groupsMap)
    );

    ownershipByGroupId.set(groupId, {
      group_id: groupId,
      attribute_id: String(targetAttr.id),
      attribute_name: attributeName,
      raw_value: rawValue,
      specifiers,
      owners,
      owner_count: owners.length
    });
  }

  return {
    attributeExists: true,
    attributeId: String(targetAttr.id),
    ownershipByGroupId
  };
}

/**
 * Resolves the owned group hierarchy for a given invoking user ID.
 */
export async function resolveOwnedGroupHierarchy(
  sdk: any,
  currentUserId: string,
  attributeName: string = DEFAULT_GROUP_OWNERS_ATTRIBUTE,
  includeSubgroups: boolean = true
): Promise<{
  attributeName: string;
  attributeExists: boolean;
  directOwnedGroupIds: string[];
  allManageableGroupIdsSet: Set<string>;
  ownedGroupsById: Map<string, OwnedGroupNode>;
  rootOwnedGroups: OwnedGroupNode[];
}> {
  const cleanUserId = String(currentUserId);
  const userGroupIds = new Set<string>(await getUserGroups(sdk, cleanUserId));
  const usersMap = await buildUsersMap(sdk);
  const groupsMap = await buildGroupsMap(sdk);

  const { attributeExists, ownershipByGroupId } = await resolveAllGroupsOwnershipMap(
    sdk,
    attributeName,
    usersMap,
    groupsMap
  );

  const directOwnedGroupIds: string[] = [];
  for (const [groupId, record] of ownershipByGroupId.entries()) {
    const isOwner = record.specifiers.some(
      (spec) =>
        (spec.type === 'user' && spec.id === cleanUserId) ||
        (spec.type === 'group' && userGroupIds.has(spec.id))
    );
    if (isOwner) {
      directOwnedGroupIds.push(groupId);
    }
  }

  let hierarchyItems: any[] = [];
  if (typeof sdk.search_groups_with_hierarchy === 'function') {
    try {
      hierarchyItems = await sdk.ok(sdk.search_groups_with_hierarchy({}));
    } catch (err) {
      hierarchyItems = [];
    }
  }

  const childrenByParentId = new Map<string, string[]>();
  const hierarchyById = new Map<string, any>();

  for (const item of hierarchyItems || []) {
    const gid = String(item.id);
    hierarchyById.set(gid, item);
    if (item.name && !groupsMap.has(gid)) {
      groupsMap.set(gid, { id: gid, name: String(item.name), user_count: item.user_count || 0 });
    }
    const parentIds: string[] = Array.isArray(item.parent_group_ids)
      ? item.parent_group_ids.map((p: any) => String(p))
      : [];
    for (const pid of parentIds) {
      if (!childrenByParentId.has(pid)) {
        childrenByParentId.set(pid, []);
      }
      childrenByParentId.get(pid)!.push(gid);
    }
  }

  const ownedGroupsById = new Map<string, OwnedGroupNode>();
  const allManageableGroupIdsSet = new Set<string>();

  for (const rootGid of directOwnedGroupIds) {
    const node = createOwnedGroupNode(rootGid, true, 0, groupsMap, hierarchyById, ownershipByGroupId);
    ownedGroupsById.set(rootGid, node);
    allManageableGroupIdsSet.add(rootGid);
  }

  if (includeSubgroups) {
    const queue: Array<{ id: string; depth: number }> = directOwnedGroupIds.map((id) => ({
      id,
      depth: 0
    }));

    while (queue.length > 0) {
      const current = queue.shift()!;
      const parentNode = ownedGroupsById.get(current.id);
      const childIds = childrenByParentId.get(current.id) || [];

      for (const childId of childIds) {
        const nextDepth = current.depth + 1;
        let childNode = ownedGroupsById.get(childId);
        if (!childNode) {
          childNode = createOwnedGroupNode(
            childId,
            directOwnedGroupIds.includes(childId),
            nextDepth,
            groupsMap,
            hierarchyById,
            ownershipByGroupId
          );
          ownedGroupsById.set(childId, childNode);
          allManageableGroupIdsSet.add(childId);
          queue.push({ id: childId, depth: nextDepth });
        }
        if (parentNode && !parentNode.subgroups.some((sg) => sg.id === childId)) {
          parentNode.subgroups.push(childNode);
        }
      }
    }
  }

  const rootOwnedGroups = directOwnedGroupIds
    .map((gid) => ownedGroupsById.get(gid)!)
    .filter(Boolean);

  return {
    attributeName,
    attributeExists,
    directOwnedGroupIds,
    allManageableGroupIdsSet,
    ownedGroupsById,
    rootOwnedGroups
  };
}

/**
 * Adds or removes an owner specifier ('u:<id>' or 'g:<id>') on a target Looker group's ownership attribute.
 */
export async function mutateGroupOwnerSpecifier(
  sdk: any,
  groupId: string,
  attributeName: string = DEFAULT_GROUP_OWNERS_ATTRIBUTE,
  operation: 'add' | 'remove',
  ownerType: 'user' | 'group',
  ownerId: string
): Promise<{
  success: boolean;
  group_id: string;
  attribute_id: string;
  raw_value: string;
  specifiers: GroupOwnerSpecifier[];
}> {
  const cleanGroupId = String(groupId || '').trim();
  const cleanOwnerId = String(ownerId || '').trim();
  if (!cleanGroupId) {
    throw new Error('group_id is required.');
  }
  if (!cleanOwnerId) {
    throw new Error('owner_id is required.');
  }
  if (ownerType !== 'user' && ownerType !== 'group') {
    throw new Error('owner_type must be either "user" or "group".');
  }

  const attrObj = await ensureGroupOwnersAttributeExists(sdk, attributeName);
  const attrId = String(attrObj.id);

  let groupValues: any[] = [];
  try {
    groupValues = await sdk.ok(sdk.all_user_attribute_group_values(attrId));
  } catch (err) {
    groupValues = [];
  }

  const existingEntry = (groupValues || []).find((gv: any) => String(gv.group_id) === cleanGroupId);
  const currentSpecs = parseGroupOwnerSpecifiers(existingEntry ? String(existingEntry.value || '') : '');

  let nextSpecs: GroupOwnerSpecifier[];
  if (operation === 'add') {
    nextSpecs = [...currentSpecs, { type: ownerType, id: cleanOwnerId }];
  } else if (operation === 'remove') {
    nextSpecs = currentSpecs.filter(
      (s) => !(s.type === ownerType && s.id === cleanOwnerId)
    );
  } else {
    throw new Error(`Unsupported group owner operation: "${String(operation)}"`);
  }

  const formattedValue = formatGroupOwnerSpecifiers(nextSpecs);

  if (formattedValue) {
    await writeGroupUserAttributeValue(sdk, cleanGroupId, attrId, formattedValue);
  } else {
    await clearGroupUserAttributeValue(sdk, cleanGroupId, attrId);
  }

  return {
    success: true,
    group_id: cleanGroupId,
    attribute_id: attrId,
    raw_value: formattedValue,
    specifiers: parseGroupOwnerSpecifiers(formattedValue)
  };
}

// --- Hoisted Pure Helpers ---

function resolveOwnerMetadata(
  spec: GroupOwnerSpecifier,
  usersMap: Map<string, any>,
  groupsMap: Map<string, any>
): ResolvedGroupOwner {
  if (spec.type === 'user') {
    const u = usersMap.get(spec.id);
    if (!u) {
      return { type: 'user', id: spec.id, name: `User ${spec.id}`, exists: false };
    }
    const displayName =
      u.display_name ||
      `${u.first_name || ''} ${u.last_name || ''}`.trim() ||
      u.email ||
      `User ${spec.id}`;
    return {
      type: 'user',
      id: spec.id,
      name: displayName,
      email: u.email || '',
      exists: true
    };
  }

  const g = groupsMap.get(spec.id);
  if (!g) {
    return { type: 'group', id: spec.id, name: `Group ${spec.id}`, exists: false };
  }
  return {
    type: 'group',
    id: spec.id,
    name: g.name || `Group ${spec.id}`,
    exists: true
  };
}

function createOwnedGroupNode(
  groupId: string,
  isDirectOwner: boolean,
  depth: number,
  groupsMap: Map<string, any>,
  hierarchyById: Map<string, any>,
  ownershipByGroupId: Map<string, GroupOwnershipRecord>
): OwnedGroupNode {
  const gObj = groupsMap.get(groupId);
  const hItem = hierarchyById.get(groupId);
  const ownRecord = ownershipByGroupId.get(groupId);

  return {
    id: groupId,
    name: gObj?.name || hItem?.name || `Group ${groupId}`,
    is_direct_owner: isDirectOwner,
    depth,
    parent_group_ids: Array.isArray(hItem?.parent_group_ids)
      ? hItem.parent_group_ids.map((p: any) => String(p))
      : [],
    role_ids: Array.isArray(hItem?.role_ids)
      ? hItem.role_ids.map((r: any) => String(r))
      : [],
    user_count: typeof gObj?.user_count === 'number' ? gObj.user_count : 0,
    owners: ownRecord ? ownRecord.owners : [],
    owner_count: ownRecord ? ownRecord.owner_count : 0,
    subgroups: []
  };
}

async function buildUsersMap(sdk: any): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  if (typeof sdk.all_users !== 'function') return map;
  try {
    const users = await sdk.ok(
      sdk.all_users({ fields: 'id,first_name,last_name,display_name,email,is_disabled,is_service_account,role_ids' })
    );
    for (const u of users || []) {
      if (u.id !== undefined && u.id !== null) {
        map.set(String(u.id), u);
      }
    }
  } catch (err) {
    // Ignore
  }
  return map;
}

async function buildGroupsMap(sdk: any): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  if (typeof sdk.all_groups !== 'function') return map;
  try {
    const groups = await sdk.ok(sdk.all_groups({ fields: 'id,name,user_count' }));
    for (const g of groups || []) {
      if (g.id !== undefined && g.id !== null) {
        map.set(String(g.id), g);
      }
    }
  } catch (err) {
    // Ignore
  }
  return map;
}

async function ensureGroupOwnersAttributeExists(sdk: any, attributeName: string): Promise<any> {
  const allAttrs = await sdk.ok(sdk.all_user_attributes({}));
  const existing = (allAttrs || []).find((a: any) => a.name === attributeName);
  if (existing) {
    return existing;
  }

  return await sdk.ok(
    sdk.create_user_attribute({
      name: attributeName,
      label: `Nano Admin Group Owners (${attributeName})`,
      type: 'string',
      user_can_edit: false,
      value_is_hidden: false,
      default_value: null
    })
  );
}

async function writeGroupUserAttributeValue(
  sdk: any,
  groupId: string,
  attributeId: string,
  value: string
): Promise<any> {
  if (typeof sdk.update_user_attribute_group_value === 'function') {
    return await sdk.ok(sdk.update_user_attribute_group_value(groupId, attributeId, { value }));
  }
  if (typeof sdk.set_user_attribute_group_value === 'function') {
    return await sdk.ok(sdk.set_user_attribute_group_value(groupId, attributeId, { value }));
  }
  throw new Error('SDK method to set group user attribute value is unavailable.');
}

async function clearGroupUserAttributeValue(
  sdk: any,
  groupId: string,
  attributeId: string
): Promise<any> {
  if (typeof sdk.delete_user_attribute_group_value === 'function') {
    return await sdk.ok(sdk.delete_user_attribute_group_value(groupId, attributeId));
  }
  return await writeGroupUserAttributeValue(sdk, groupId, attributeId, '');
}
