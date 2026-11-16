import {
  NormalizedUserManagementParameters,
  ResolvedScopeContext,
  WorkflowContext
} from '../types';
import { assertTargetUserInScope, isScopeGroupsLimitationMode } from '../scope';

export async function getUserGroupsAction(
  context: WorkflowContext,
  params: NormalizedUserManagementParameters,
  scope: ResolvedScopeContext,
  payload: any
): Promise<any> {
  if (!params.groups.allow_view) {
    throw new Error('Viewing group memberships is not permitted for this workflow.');
  }

  const targetUserId = String(payload?.user_id || '').trim();
  assertTargetUserInScope(targetUserId, scope);

  const user = await context.sdk.ok(context.sdk.user(targetUserId, 'id,group_ids'));
  const userGroupIds = new Set<string>((user?.group_ids || []).map((g: any) => String(g)));

  const allGroupsMap = await fetchAllGroupsMap(context.sdk);
  const currentScopeGroupMemberships = scope.adminActiveScopeGroupIds.filter((gid) =>
    userGroupIds.has(gid)
  );
  const currentManageableMemberships = scope.manageableGroups.filter((g) =>
    userGroupIds.has(g.id)
  );

  const manageableGroups = scope.manageableGroups.map((g) => {
    const isMember = userGroupIds.has(g.id);
    const wouldLeaveZeroScope =
      isScopeGroupsLimitationMode(scope.limitation.mode) &&
      isMember &&
      ((g.is_scope_group &&
        currentScopeGroupMemberships.length === 1 &&
        currentScopeGroupMemberships[0] === g.id) ||
        (currentManageableMemberships.length === 1 &&
          currentManageableMemberships[0].id === g.id));

    return {
      ...g,
      is_member: isMember,
      editable: params.groups.allow_edit,
      would_remove_from_final_scope: wouldLeaveZeroScope
    };
  });

  const externalGroups = Array.from(userGroupIds)
    .filter((gid) => !scope.manageableGroupIdsSet.has(gid))
    .map((gid) => ({
      id: gid,
      name: allGroupsMap.get(gid) || `Group ${gid}`,
      is_member: true,
      editable: false
    }));

  return {
    user_id: targetUserId,
    allow_edit: params.groups.allow_edit,
    manageable_groups: manageableGroups,
    external_groups: externalGroups
  };
}

export async function addUserToGroupAction(
  context: WorkflowContext,
  params: NormalizedUserManagementParameters,
  scope: ResolvedScopeContext,
  payload: any
): Promise<any> {
  if (!params.groups.allow_edit) {
    throw new Error('403 Forbidden: Editing group memberships is not permitted for this workflow.');
  }

  const targetUserId = String(payload?.user_id || '').trim();
  const groupId = String(payload?.group_id || '').trim();
  assertTargetUserInScope(targetUserId, scope);

  if (!groupId) {
    throw new Error('group_id is required.');
  }
  if (!scope.manageableGroupIdsSet.has(groupId)) {
    throw new Error(
      `403 Forbidden: Group "${groupId}" is not a member of the invoking admin's Scope Group hierarchy.`
    );
  }

  await context.sdk.ok(context.sdk.add_group_user(groupId, { user_id: targetUserId }));
  return {
    success: true,
    user_id: targetUserId,
    group_id: groupId,
    message: `Added user ${targetUserId} to group ${groupId}.`
  };
}

export async function removeUserFromGroupAction(
  context: WorkflowContext,
  params: NormalizedUserManagementParameters,
  scope: ResolvedScopeContext,
  payload: any
): Promise<any> {
  if (!params.groups.allow_edit) {
    throw new Error('403 Forbidden: Editing group memberships is not permitted for this workflow.');
  }

  const targetUserId = String(payload?.user_id || '').trim();
  const groupId = String(payload?.group_id || '').trim();
  assertTargetUserInScope(targetUserId, scope);

  if (!groupId) {
    throw new Error('group_id is required.');
  }
  if (!scope.manageableGroupIdsSet.has(groupId)) {
    throw new Error(
      `403 Forbidden: Group "${groupId}" is not a member of the invoking admin's Scope Group hierarchy.`
    );
  }

  const user = await context.sdk.ok(context.sdk.user(targetUserId, 'id,group_ids'));
  const userGroupIds: string[] = (user?.group_ids || []).map((g: any) => String(g));
  const remainingManageable = userGroupIds.filter(
    (gid) => gid !== groupId && scope.manageableGroupIdsSet.has(gid)
  );
  const remainingActiveScopeGroups = userGroupIds.filter(
    (gid) => gid !== groupId && scope.adminActiveScopeGroupIds.includes(gid)
  );
  const isRemovingActiveScopeGroup = scope.adminActiveScopeGroupIds.includes(groupId);
  const removedFromFinalScope =
    isScopeGroupsLimitationMode(scope.limitation.mode) &&
    (remainingManageable.length === 0 ||
      (isRemovingActiveScopeGroup && remainingActiveScopeGroups.length === 0));

  await context.sdk.ok(context.sdk.delete_group_user(groupId, targetUserId));

  return {
    success: true,
    user_id: targetUserId,
    group_id: groupId,
    removed_from_final_scope_group: removedFromFinalScope,
    warning: removedFromFinalScope
      ? `User ${targetUserId} has been removed from their final shared Scope Group and will no longer be visible in this scope.`
      : null,
    message: `Removed user ${targetUserId} from group ${groupId}.`
  };
}

// --- Hoisted Pure Helpers ---

async function fetchAllGroupsMap(sdk: any): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (typeof sdk.all_groups !== 'function') {
    return map;
  }
  try {
    const groups = await sdk.ok(sdk.all_groups({ fields: 'id,name' }));
    for (const g of groups || []) {
      map.set(String(g.id), g.name || `Group ${g.id}`);
    }
  } catch (err) {
    // Ignore
  }
  return map;
}
