import { resolveUserIdLimitation } from '../../../../auth_utils';
import {
  mutateGroupOwnerSpecifier,
  resolveAllGroupsOwnershipMap,
  resolveOwnedGroupHierarchy
} from '../../../../group_ownership';
import {
  NormalizedGroupOwnersParameters,
  ResolvedGroupOwnersContext,
  WorkflowContext
} from '../types';

export async function resolveGroupOwnersContext(
  context: WorkflowContext,
  params: NormalizedGroupOwnersParameters
): Promise<ResolvedGroupOwnersContext> {
  const limitation = await resolveLimitationForGroupOwners(context, params);
  const hierarchy = await resolveOwnedGroupHierarchy(
    context.sdk,
    context.userId,
    params.ownership_attribute_name,
    params.include_subgroups
  );

  return {
    limitation,
    ownershipAttributeName: params.ownership_attribute_name,
    attributeExists: hierarchy.attributeExists,
    includeSubgroups: params.include_subgroups,
    directOwnedGroupIds: hierarchy.directOwnedGroupIds,
    allManageableGroupIdsSet: hierarchy.allManageableGroupIdsSet,
    ownedGroupsById: hierarchy.ownedGroupsById,
    rootOwnedGroups: hierarchy.rootOwnedGroups
  };
}

export async function listOwnedGroupsAction(
  context: WorkflowContext,
  params: NormalizedGroupOwnersParameters,
  ownedContext: ResolvedGroupOwnersContext
): Promise<any> {
  const rolesMap = await fetchRolesNameMap(context.sdk);
  const enrichNode = (node: any): any => ({
    ...node,
    roles: (node.role_ids || []).map((rid: string) => ({
      id: rid,
      name: rolesMap.get(rid) || `Role ${rid}`
    })),
    subgroups: (node.subgroups || []).map(enrichNode)
  });

  return {
    ownership_attribute_name: ownedContext.ownershipAttributeName,
    attribute_exists: ownedContext.attributeExists,
    include_subgroups: ownedContext.includeSubgroups,
    capabilities: params,
    direct_owned_count: ownedContext.directOwnedGroupIds.length,
    total_manageable_count: ownedContext.allManageableGroupIdsSet.size,
    groups: ownedContext.rootOwnedGroups.map(enrichNode)
  };
}

export async function getOwnedGroupDetailsAction(
  context: WorkflowContext,
  params: NormalizedGroupOwnersParameters,
  ownedContext: ResolvedGroupOwnersContext,
  payload: any
): Promise<any> {
  const groupId = String(payload?.group_id || '').trim();
  assertGroupIsManageable(groupId, ownedContext);

  const sdk = context.sdk;
  const node = ownedContext.ownedGroupsById.get(groupId)!;

  const [groupUsers, allUsers, allGroups, ownershipData] = await Promise.all([
    typeof sdk.all_group_users === 'function'
      ? sdk.ok(sdk.all_group_users({ group_id: groupId, fields: 'id,first_name,last_name,display_name,email,is_disabled' }))
      : Promise.resolve([]),
    typeof sdk.all_users === 'function'
      ? sdk.ok(sdk.all_users({ fields: 'id,first_name,last_name,display_name,email,is_disabled' }))
      : Promise.resolve([]),
    typeof sdk.all_groups === 'function'
      ? sdk.ok(sdk.all_groups({ fields: 'id,name,user_count' }))
      : Promise.resolve([]),
    resolveAllGroupsOwnershipMap(sdk, params.ownership_attribute_name)
  ]);

  const currentMembers = (groupUsers || []).map(formatBasicUser);
  const currentMemberIds = new Set<string>(currentMembers.map((m: any) => m.id));

  const eligibleUsers = filterUsersByLimitation(allUsers || [], ownedContext.limitation)
    .map(formatBasicUser);

  const addableUsers = eligibleUsers.filter((u: any) => !currentMemberIds.has(u.id));

  const currentSubgroups = node.subgroups || [];
  const currentSubgroupIds = new Set<string>(currentSubgroups.map((sg) => sg.id));

  // Determine which existing groups can be added as a child subgroup without creating a cycle
  const ancestorIds = await resolveAncestorGroupIds(sdk, groupId);
  const addableChildGroups = (allGroups || [])
    .map((g: any) => ({
      id: String(g.id),
      name: g.name || `Group ${g.id}`,
      user_count: typeof g.user_count === 'number' ? g.user_count : 0
    }))
    .filter(
      (g: any) =>
        g.id !== groupId &&
        !currentSubgroupIds.has(g.id) &&
        !ancestorIds.has(g.id) &&
        g.name !== 'All Users'
    );

  const latestOwnRecord = ownershipData.ownershipByGroupId.get(groupId);
  const owners = latestOwnRecord ? latestOwnRecord.owners : node.owners;

  return {
    group: {
      id: node.id,
      name: node.name,
      is_direct_owner: node.is_direct_owner,
      depth: node.depth,
      parent_group_ids: node.parent_group_ids,
      owners,
      owner_count: owners.length
    },
    members: currentMembers,
    subgroups: currentSubgroups.map((sg) => ({
      id: sg.id,
      name: sg.name,
      user_count: sg.user_count,
      owner_count: sg.owner_count,
      depth: sg.depth
    })),
    eligible_users: eligibleUsers,
    addable_users: addableUsers,
    all_groups: (allGroups || []).map((g: any) => ({
      id: String(g.id),
      name: g.name || `Group ${g.id}`
    })),
    addable_child_groups: addableChildGroups,
    capabilities: params
  };
}

export async function addUserToOwnedGroupAction(
  context: WorkflowContext,
  params: NormalizedGroupOwnersParameters,
  ownedContext: ResolvedGroupOwnersContext,
  payload: any
): Promise<any> {
  if (!params.memberships.allow_add_users) {
    throw new Error('403 Forbidden: Adding users to groups is not permitted for this workflow.');
  }

  const groupId = String(payload?.group_id || '').trim();
  const targetUserId = String(payload?.user_id || '').trim();
  assertGroupIsManageable(groupId, ownedContext);
  assertUserAllowedByLimitation(targetUserId, ownedContext);

  await context.sdk.ok(context.sdk.add_group_user(groupId, { user_id: targetUserId }));
  return {
    success: true,
    group_id: groupId,
    user_id: targetUserId,
    message: `Added user ${targetUserId} to group ${groupId}.`
  };
}

export async function removeUserFromOwnedGroupAction(
  context: WorkflowContext,
  params: NormalizedGroupOwnersParameters,
  ownedContext: ResolvedGroupOwnersContext,
  payload: any
): Promise<any> {
  if (!params.memberships.allow_remove_users) {
    throw new Error('403 Forbidden: Removing users from groups is not permitted for this workflow.');
  }

  const groupId = String(payload?.group_id || '').trim();
  const targetUserId = String(payload?.user_id || '').trim();
  assertGroupIsManageable(groupId, ownedContext);
  assertUserAllowedByLimitation(targetUserId, ownedContext);

  await context.sdk.ok(context.sdk.delete_group_user(groupId, targetUserId));
  return {
    success: true,
    group_id: groupId,
    user_id: targetUserId,
    message: `Removed user ${targetUserId} from group ${groupId}.`
  };
}

export async function updateOwnedGroupOwnerAction(
  context: WorkflowContext,
  params: NormalizedGroupOwnersParameters,
  ownedContext: ResolvedGroupOwnersContext,
  payload: any
): Promise<any> {
  if (!params.memberships.allow_edit_owners) {
    throw new Error('403 Forbidden: Editing group owners is not permitted for this workflow.');
  }

  const groupId = String(payload?.group_id || '').trim();
  const operation = String(payload?.operation || 'add').trim() as 'add' | 'remove';
  const ownerType = String(payload?.owner_type || 'user').trim() as 'user' | 'group';
  const ownerId = String(payload?.owner_id || '').trim();

  assertGroupIsManageable(groupId, ownedContext);

  if (operation === 'add' && ownerType === 'user') {
    assertUserAllowedByLimitation(ownerId, ownedContext);
  }

  const res = await mutateGroupOwnerSpecifier(
    context.sdk,
    groupId,
    params.ownership_attribute_name,
    operation,
    ownerType,
    ownerId
  );

  return {
    ...res,
    message: `${operation === 'add' ? 'Added' : 'Removed'} ${ownerType} owner ${ownerId} on group ${groupId}.`
  };
}

export async function addChildGroupAction(
  context: WorkflowContext,
  params: NormalizedGroupOwnersParameters,
  ownedContext: ResolvedGroupOwnersContext,
  payload: any
): Promise<any> {
  if (!params.memberships.allow_add_existing_groups) {
    throw new Error('403 Forbidden: Adding existing child groups is not permitted for this workflow.');
  }

  const parentGroupId = String(payload?.parent_group_id || payload?.group_id || '').trim();
  const childGroupId = String(payload?.child_group_id || '').trim();
  assertGroupIsManageable(parentGroupId, ownedContext);

  if (!childGroupId) {
    throw new Error('child_group_id is required.');
  }
  if (parentGroupId === childGroupId) {
    throw new Error('400 Bad Request: A group cannot be added as a child of itself.');
  }

  const ancestors = await resolveAncestorGroupIds(context.sdk, parentGroupId);
  if (ancestors.has(childGroupId)) {
    throw new Error('400 Bad Request: Cannot add an ancestor group as a child subgroup (cycle detected).');
  }

  await context.sdk.ok(context.sdk.add_group_group(parentGroupId, { group_id: childGroupId }));
  return {
    success: true,
    parent_group_id: parentGroupId,
    child_group_id: childGroupId,
    message: `Added child group ${childGroupId} to parent group ${parentGroupId}.`
  };
}

export async function removeChildGroupAction(
  context: WorkflowContext,
  params: NormalizedGroupOwnersParameters,
  ownedContext: ResolvedGroupOwnersContext,
  payload: any
): Promise<any> {
  if (!params.memberships.allow_remove_child_groups) {
    throw new Error('403 Forbidden: Removing child groups is not permitted for this workflow.');
  }

  const parentGroupId = String(payload?.parent_group_id || payload?.group_id || '').trim();
  const childGroupId = String(payload?.child_group_id || '').trim();
  assertGroupIsManageable(parentGroupId, ownedContext);

  if (!childGroupId) {
    throw new Error('child_group_id is required.');
  }

  await context.sdk.ok(context.sdk.delete_group_from_group(parentGroupId, childGroupId));
  return {
    success: true,
    parent_group_id: parentGroupId,
    child_group_id: childGroupId,
    message: `Removed child group ${childGroupId} from parent group ${parentGroupId}.`
  };
}

export async function createChildGroupAction(
  context: WorkflowContext,
  params: NormalizedGroupOwnersParameters,
  ownedContext: ResolvedGroupOwnersContext,
  payload: any
): Promise<any> {
  if (!params.memberships.allow_create_subgroups) {
    throw new Error('403 Forbidden: Creating new child subgroups is not permitted for this workflow.');
  }

  const parentGroupId = String(payload?.parent_group_id || payload?.group_id || '').trim();
  const groupName = String(payload?.group_name || '').trim();
  assertGroupIsManageable(parentGroupId, ownedContext);

  if (!groupName) {
    throw new Error('group_name is required.');
  }

  const created = await context.sdk.ok(context.sdk.create_group({ name: groupName }));
  const childGroupId = String(created.id);
  await context.sdk.ok(context.sdk.add_group_group(parentGroupId, { group_id: childGroupId }));

  return {
    success: true,
    parent_group_id: parentGroupId,
    group: {
      id: childGroupId,
      name: created.name || groupName
    },
    message: `Created subgroup "${groupName}" (ID: ${childGroupId}) under group ${parentGroupId}.`
  };
}

// --- Hoisted Pure Helpers ---

async function resolveLimitationForGroupOwners(
  context: WorkflowContext,
  params: NormalizedGroupOwnersParameters
) {
  const limitationConfig = params.user_id_limitation;
  if (context.helpers?.resolveUserIdLimitation) {
    return await context.helpers.resolveUserIdLimitation(limitationConfig, 'exclude_privileged');
  }
  return await resolveUserIdLimitation(
    context.sdk,
    context.userId,
    limitationConfig,
    'exclude_privileged'
  );
}

function assertGroupIsManageable(
  groupId: string,
  ownedContext: ResolvedGroupOwnersContext
): void {
  const cleanId = String(groupId || '').trim();
  if (!cleanId) {
    throw new Error('group_id is required.');
  }
  if (!ownedContext.allManageableGroupIdsSet.has(cleanId)) {
    throw new Error(
      `403 Forbidden: Group "${cleanId}" is not in the invoking user's owned group hierarchy.`
    );
  }
}

function assertUserAllowedByLimitation(
  targetUserId: string,
  ownedContext: ResolvedGroupOwnersContext
): void {
  const cleanId = String(targetUserId || '').trim();
  if (!cleanId) {
    throw new Error('user_id is required.');
  }
  if (ownedContext.limitation.active && !ownedContext.limitation.userIds.includes(cleanId)) {
    throw new Error(
      `403 Forbidden: User "${cleanId}" is outside the allowed user_id_limitation (${ownedContext.limitation.mode}).`
    );
  }
}

function filterUsersByLimitation(allUsers: any[], limitation: any): any[] {
  if (!limitation.active) {
    return allUsers;
  }
  const allowedSet = new Set<string>((limitation.userIds || []).map((id: any) => String(id)));
  return (allUsers || []).filter((u: any) => allowedSet.has(String(u.id)));
}

function formatBasicUser(u: any): any {
  const uid = String(u.id);
  return {
    id: uid,
    name:
      u.display_name ||
      `${u.first_name || ''} ${u.last_name || ''}`.trim() ||
      u.email ||
      `User ${uid}`,
    email: u.email || '',
    is_disabled: Boolean(u.is_disabled)
  };
}

async function resolveAncestorGroupIds(sdk: any, groupId: string): Promise<Set<string>> {
  const ancestors = new Set<string>();
  if (typeof sdk.search_groups_with_hierarchy !== 'function') {
    return ancestors;
  }
  try {
    const hierarchy = await sdk.ok(sdk.search_groups_with_hierarchy({}));
    const parentsByChildId = new Map<string, string[]>();
    for (const item of hierarchy || []) {
      const cid = String(item.id);
      const pids: string[] = Array.isArray(item.parent_group_ids)
        ? item.parent_group_ids.map((p: any) => String(p))
        : [];
      parentsByChildId.set(cid, pids);
    }

    const queue = [groupId];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      const parents = parentsByChildId.get(curr) || [];
      for (const pid of parents) {
        if (!ancestors.has(pid)) {
          ancestors.add(pid);
          queue.push(pid);
        }
      }
    }
  } catch (err) {
    // Ignore
  }
  return ancestors;
}

async function fetchRolesNameMap(sdk: any): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (typeof sdk.all_roles !== 'function') return map;
  try {
    const roles = await sdk.ok(sdk.all_roles({ fields: 'id,name' }));
    for (const r of roles || []) {
      map.set(String(r.id), r.name || `Role ${r.id}`);
    }
  } catch (err) {
    // Ignore
  }
  return map;
}
