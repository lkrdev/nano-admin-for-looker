import {
  resolveUserIdLimitation,
  UserIdLimitationMode
} from '../../../auth_utils';
import {
  AdminCapabilities,
  computeEffectiveCapabilities,
  fetchGroupRolesMap,
  isRoleAdmin,
  isRoleSubsetOfAdmin,
  resolveEffectiveRoleIdsForUser
} from './actions/roles';
import {
  ManageableGroupNode,
  NormalizedUserManagementParameters,
  ResolvedScopeContext,
  UserIdLimitationResult,
  WorkflowContext
} from './types';

export async function resolveScopeContext(
  context: WorkflowContext,
  params: NormalizedUserManagementParameters
): Promise<ResolvedScopeContext> {
  const sdk = context.sdk;
  const attributeName = params.user_id_limitation.attribute_name;
  const limitation = await resolveLimitation(context, params);

  const adminActiveScopeGroupIds = await resolveAdminActiveScopeGroupIds(
    sdk,
    context.userId,
    attributeName
  );

  const { manageableGroups, blockedGroupReasons } = await resolveManageableGroupHierarchy(
    sdk,
    adminActiveScopeGroupIds,
    params.user_id_limitation.mode,
    context.userId,
    params
  );

  const manageableGroupIdsSet = new Set<string>(manageableGroups.map((g) => g.id));

  return {
    limitation,
    attributeName,
    adminActiveScopeGroupIds,
    manageableGroups,
    manageableGroupIdsSet,
    blockedGroupReasons
  };
}

export function assertTargetUserInScope(
  targetUserId: string,
  scope: ResolvedScopeContext
): void {
  const cleanId = String(targetUserId || '').trim();
  if (!cleanId) {
    throw new Error('Target user_id is required.');
  }
  if (scope.limitation.active && !scope.limitation.userIds.includes(cleanId)) {
    throw new Error(`403 Forbidden: Target user "${cleanId}" does not belong to an allowed user scope.`);
  }
}

export function isScopeGroupsLimitationMode(mode: UserIdLimitationMode): boolean {
  return mode === 'scope_groups' || mode === 'scope_groups_minus_privileged';
}

// --- Hoisted Pure Helpers ---

async function resolveLimitation(
  context: WorkflowContext,
  params: NormalizedUserManagementParameters
): Promise<UserIdLimitationResult> {
  const limitationConfig = {
    ...params.user_id_limitation,
    include_subgroups: true
  };
  if (context.helpers?.resolveUserIdLimitation) {
    return await context.helpers.resolveUserIdLimitation(
      limitationConfig,
      'scope_groups_minus_privileged'
    );
  }
  return await resolveUserIdLimitation(
    context.sdk,
    context.userId,
    limitationConfig,
    'scope_groups_minus_privileged'
  );
}

export async function resolveAdminActiveScopeGroupIds(
  sdk: any,
  adminUserId: string,
  attributeName: string
): Promise<string[]> {
  try {
    const adminUser = await sdk.ok(sdk.user(adminUserId, 'id,group_ids'));
    const adminGroupIds: string[] = (adminUser?.group_ids || []).map((g: any) => String(g));
    if (adminGroupIds.length === 0) {
      return [];
    }

    const allAttrs = await sdk.ok(sdk.all_user_attributes({}));
    const targetAttr = (allAttrs || []).find((a: any) => a.name === attributeName);
    if (!targetAttr) {
      return [];
    }

    const groupValues = await sdk.ok(sdk.all_user_attribute_group_values(targetAttr.id));
    return (groupValues || [])
      .filter((gv: any) => String(gv.value || '').trim().toLowerCase() === 'yes')
      .map((gv: any) => String(gv.group_id))
      .filter((gid: string) => adminGroupIds.includes(gid));
  } catch (err) {
    return [];
  }
}

export async function resolveManageableGroupHierarchy(
  sdk: any,
  adminActiveScopeGroupIds: string[],
  mode: UserIdLimitationMode,
  adminUserId?: string,
  params?: NormalizedUserManagementParameters
): Promise<{ manageableGroups: ManageableGroupNode[]; blockedGroupReasons: Map<string, string> }> {
  // In 'self' mode, users can only manage themselves and must not manage Scope Groups or subgroups.
  if (mode === 'self') {
    return { manageableGroups: [], blockedGroupReasons: new Map<string, string>() };
  }

  let allGroups: any[] = [];
  try {
    if (typeof sdk.all_groups === 'function') {
      allGroups = await sdk.ok(sdk.all_groups({ fields: 'id,name' }));
    }
  } catch (err) {
    allGroups = [];
  }

  const groupNameMap = new Map<string, string>();
  for (const g of allGroups || []) {
    groupNameMap.set(String(g.id), g.name || `Group ${g.id}`);
  }

  let hierarchyItems: any[] = [];
  if (typeof sdk.search_groups_with_hierarchy === 'function') {
    try {
      hierarchyItems = await sdk.ok(sdk.search_groups_with_hierarchy({}));
    } catch (err) {
      hierarchyItems = [];
    }
  }

  for (const item of hierarchyItems || []) {
    if (item.id !== undefined && item.name) {
      groupNameMap.set(String(item.id), String(item.name));
    }
  }

  // If mode is 'none' or 'exclude_privileged', start with all groups then filter out role-escalating groups
  if (mode === 'none' || mode === 'exclude_privileged') {
    const allIds = new Set<string>([
      ...Array.from(groupNameMap.keys()),
      ...adminActiveScopeGroupIds
    ]);
    const candidates = Array.from(allIds).map((id) => {
      const hItem = (hierarchyItems || []).find((h: any) => String(h.id) === id);
      return {
        id,
        name: groupNameMap.get(id) || `Group ${id}`,
        is_scope_group: adminActiveScopeGroupIds.includes(id),
        depth: 0,
        parent_group_ids: Array.isArray(hItem?.parent_group_ids)
          ? hItem.parent_group_ids.map((p: any) => String(p))
          : [],
        role_ids: Array.isArray(hItem?.role_ids)
          ? hItem.role_ids.map((r: any) => String(r))
          : []
      };
    });
    return await filterGroupsByAdminCapabilities(sdk, candidates, hierarchyItems, adminUserId, params);
  }

  if (adminActiveScopeGroupIds.length === 0) {
    return { manageableGroups: [], blockedGroupReasons: new Map<string, string>() };
  }

  // Build parent -> child adjacency list from search_groups_with_hierarchy
  const childrenByParentId = new Map<string, any[]>();
  const hierarchyById = new Map<string, any>();

  for (const item of hierarchyItems || []) {
    const childId = String(item.id);
    hierarchyById.set(childId, item);
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

  const visited = new Map<string, ManageableGroupNode>();
  const queue: Array<{ id: string; depth: number }> = [];

  for (const scopeGid of adminActiveScopeGroupIds) {
    const hItem = hierarchyById.get(scopeGid);
    const node: ManageableGroupNode = {
      id: scopeGid,
      name: groupNameMap.get(scopeGid) || `Group ${scopeGid}`,
      is_scope_group: true,
      depth: 0,
      parent_group_ids: Array.isArray(hItem?.parent_group_ids)
        ? hItem.parent_group_ids.map((p: any) => String(p))
        : [],
      role_ids: Array.isArray(hItem?.role_ids)
        ? hItem.role_ids.map((r: any) => String(r))
        : []
    };
    visited.set(scopeGid, node);
    queue.push({ id: scopeGid, depth: 0 });
  }

  // Unlimited-hop BFS over child groups
  while (queue.length > 0) {
    const current = queue.shift()!;
    const childIds = childrenByParentId.get(current.id) || [];

    for (const childId of childIds) {
      const nextDepth = current.depth + 1;
      if (!visited.has(childId)) {
        const hItem = hierarchyById.get(childId);
        visited.set(childId, {
          id: childId,
          name: groupNameMap.get(childId) || `Group ${childId}`,
          is_scope_group: adminActiveScopeGroupIds.includes(childId),
          depth: nextDepth,
          parent_group_ids: Array.isArray(hItem?.parent_group_ids)
            ? hItem.parent_group_ids.map((p: any) => String(p))
            : [current.id],
          role_ids: Array.isArray(hItem?.role_ids)
            ? hItem.role_ids.map((r: any) => String(r))
            : []
        });
        queue.push({ id: childId, depth: nextDepth });
      }
    }
  }

  return await filterGroupsByAdminCapabilities(
    sdk,
    Array.from(visited.values()),
    hierarchyItems,
    adminUserId,
    params
  );
}

async function filterGroupsByAdminCapabilities(
  sdk: any,
  candidateGroups: ManageableGroupNode[],
  hierarchyItems: any[],
  adminUserId?: string,
  params?: NormalizedUserManagementParameters
): Promise<{ manageableGroups: ManageableGroupNode[]; blockedGroupReasons: Map<string, string> }> {
  const blockedGroupReasons = new Map<string, string>();
  if (candidateGroups.length === 0) {
    return { manageableGroups: [], blockedGroupReasons };
  }

  let allRoles: any[] = [];
  if (typeof sdk.all_roles === 'function') {
    try {
      allRoles = await sdk.ok(sdk.all_roles({}));
    } catch {
      allRoles = [];
    }
  }

  const rolesById = new Map<string, any>();
  for (const r of allRoles || []) {
    if (r?.id !== undefined && r?.id !== null) {
      rolesById.set(String(r.id), r);
    }
  }

  const groupRolesInfo = await fetchGroupRolesMap(sdk, allRoles || []);
  const roleIdsByGroupId = new Map<string, Set<string>>();
  for (const [gid, rids] of groupRolesInfo.roleIdsByGroupId.entries()) {
    roleIdsByGroupId.set(gid, new Set(rids));
  }

  const parentGroupIdsById = new Map<string, string[]>();
  for (const item of hierarchyItems || []) {
    const gid = String(item.id);
    if (Array.isArray(item.parent_group_ids)) {
      parentGroupIdsById.set(gid, item.parent_group_ids.map((p: any) => String(p)));
    }
    if (Array.isArray(item.role_ids) && item.role_ids.length > 0) {
      const set = roleIdsByGroupId.get(gid) || new Set<string>();
      item.role_ids.forEach((r: any) => set.add(String(r)));
      roleIdsByGroupId.set(gid, set);
    }
  }
  for (const g of candidateGroups) {
    if (!parentGroupIdsById.has(g.id) && g.parent_group_ids.length > 0) {
      parentGroupIdsById.set(g.id, g.parent_group_ids);
    }
    if (g.role_ids.length > 0) {
      const set = roleIdsByGroupId.get(g.id) || new Set<string>();
      g.role_ids.forEach((r) => set.add(String(r)));
      roleIdsByGroupId.set(g.id, set);
    }
  }

  let adminCapabilities: AdminCapabilities | null = null;
  if (allRoles.length > 0 && adminUserId && typeof sdk.user === 'function') {
    try {
      const adminUser = await sdk.ok(sdk.user(adminUserId, 'id,role_ids,group_ids'));
      const flatRoleIdsMap = new Map<string, string[]>();
      for (const [gid, rset] of roleIdsByGroupId.entries()) {
        flatRoleIdsMap.set(gid, Array.from(rset));
      }
      const adminEffectiveRoleIds = await resolveEffectiveRoleIdsForUser(
        sdk,
        adminUserId,
        adminUser,
        flatRoleIdsMap
      );
      adminCapabilities = computeEffectiveCapabilities(allRoles, adminEffectiveRoleIds);
    } catch {
      adminCapabilities = null;
    }
  }

  const allowedRoleSet = new Set<string>(params?.roles?.allowed_role_ids || []);
  const manageableGroups: ManageableGroupNode[] = [];

  for (const group of candidateGroups) {
    const transitiveRoleIds = collectTransitiveGroupRoleIds(
      group.id,
      roleIdsByGroupId,
      parentGroupIdsById
    );

    if (transitiveRoleIds.length === 0) {
      manageableGroups.push(group);
      continue;
    }

    const blockReason = evaluateGroupRolesEscalation(
      transitiveRoleIds,
      rolesById,
      adminCapabilities,
      allowedRoleSet
    );
    if (blockReason) {
      blockedGroupReasons.set(group.id, blockReason);
    } else {
      manageableGroups.push(group);
    }
  }

  return { manageableGroups, blockedGroupReasons };
}

function collectTransitiveGroupRoleIds(
  groupId: string,
  roleIdsByGroupId: Map<string, Set<string>>,
  parentGroupIdsById: Map<string, string[]>
): string[] {
  const collectedRoles = new Set<string>();
  const visitedGroups = new Set<string>([groupId]);
  const queue: string[] = [groupId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const directRoles = roleIdsByGroupId.get(currentId);
    if (directRoles) {
      directRoles.forEach((rid) => collectedRoles.add(rid));
    }
    const parents = parentGroupIdsById.get(currentId) || [];
    for (const pid of parents) {
      if (!visitedGroups.has(pid)) {
        visitedGroups.add(pid);
        queue.push(pid);
      }
    }
  }

  return Array.from(collectedRoles);
}

function evaluateGroupRolesEscalation(
  transitiveRoleIds: string[],
  rolesById: Map<string, any>,
  adminCapabilities: AdminCapabilities | null,
  allowedRoleSet: Set<string>
): string | null {
  if (rolesById.size === 0 || !adminCapabilities) {
    return 'grants Looker roles that could not be verified against your permissions';
  }

  for (const roleId of transitiveRoleIds) {
    const role = rolesById.get(roleId);
    if (!role) {
      return `grants unrecognized Looker role "${roleId}"`;
    }
    if (isRoleAdmin(role)) {
      return `grants a Looker Admin role ("${role.name || roleId}")`;
    }
    if (allowedRoleSet.size > 0 && !allowedRoleSet.has(roleId)) {
      return `grants role "${role.name || roleId}" outside the workflow's allowed_role_ids`;
    }
    const permissions: string[] = Array.isArray(role.permission_set?.permissions)
      ? role.permission_set.permissions.map((p: any) => String(p))
      : [];
    const models: string[] = Array.isArray(role.model_set?.models)
      ? role.model_set.models.map((m: any) => String(m))
      : [];
    const modelAllAccess = Boolean(role.model_set?.all_access || role.model_set?.unlimited);
    if (!isRoleSubsetOfAdmin(permissions, models, modelAllAccess, adminCapabilities)) {
      return `grants Looker role "${role.name || roleId}" exceeding your permissions or model access`;
    }
  }

  return null;
}
