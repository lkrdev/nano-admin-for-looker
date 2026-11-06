import { resolveUserIdLimitation } from '../../../auth_utils';
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

  const manageableGroups = await resolveManageableGroupHierarchy(
    sdk,
    adminActiveScopeGroupIds,
    params.user_id_limitation.mode
  );

  const manageableGroupIdsSet = new Set<string>(manageableGroups.map((g) => g.id));

  // If scope_groups mode is active and descendant child groups exist, also include users in those child groups
  if (limitation.active && limitation.mode === 'scope_groups') {
    const expandedUserIds = new Set<string>(limitation.userIds.map((id) => String(id)));
    const childGroups = manageableGroups.filter((g) => !g.is_scope_group);
    for (const childGroup of childGroups) {
      try {
        const groupUsers = await sdk.ok(sdk.all_group_users({ group_id: childGroup.id, fields: 'id' }));
        for (const u of groupUsers || []) {
          if (u.id !== undefined && u.id !== null) {
            expandedUserIds.add(String(u.id));
          }
        }
      } catch (err) {
        // Ignore child group user lookup error
      }
    }
    limitation.userIds = Array.from(expandedUserIds);
  }

  return {
    limitation,
    attributeName,
    adminActiveScopeGroupIds,
    manageableGroups,
    manageableGroupIdsSet
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

// --- Hoisted Pure Helpers ---

async function resolveLimitation(
  context: WorkflowContext,
  params: NormalizedUserManagementParameters
): Promise<UserIdLimitationResult> {
  const limitationConfig = params.user_id_limitation;
  if (context.helpers?.resolveUserIdLimitation) {
    return await context.helpers.resolveUserIdLimitation(limitationConfig);
  }
  const mode = limitationConfig.mode;
  if (mode === 'none') {
    return { active: false, userIds: [], mode: 'none' };
  }
  if (mode === 'self') {
    return { active: true, userIds: [String(context.userId)], mode: 'self' };
  }
  if (context.helpers?.getScopeGroupUserIds) {
    const ids = await context.helpers.getScopeGroupUserIds(limitationConfig.attribute_name);
    return { active: true, userIds: ids, mode: 'scope_groups' };
  }
  return await resolveUserIdLimitation(context.sdk, context.userId, limitationConfig);
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
  mode: 'scope_groups' | 'self' | 'none'
): Promise<ManageableGroupNode[]> {
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

  // If mode is 'none', all groups are manageable
  if (mode === 'none') {
    const allIds = new Set<string>([
      ...Array.from(groupNameMap.keys()),
      ...adminActiveScopeGroupIds
    ]);
    return Array.from(allIds).map((id) => {
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
  }

  if (adminActiveScopeGroupIds.length === 0) {
    return [];
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

  return Array.from(visited.values());
}
