import { getPrivilegedUserIds, isRoleAdmin } from '../../../auth_utils';
import {
  DEFAULT_GROUP_OWNERS_ATTRIBUTE,
  GroupOwnershipRecord,
  ResolvedGroupOwner
} from '../../../group_ownership';

export interface SubgroupInfo {
  group_id: string;
  group_name: string;
  depth: number;
  parent_group_ids: string[];
  role_ids: string[];
}

export interface DeepSubgroupWarning {
  group_id: string;
  group_name: string;
  attribute_name: string;
  max_depth: number;
  deep_subgroups: SubgroupInfo[];
}

export interface PrivilegedScopeMemberWarning {
  user_id: string;
  user_name: string;
  user_email: string;
  is_admin: boolean;
  is_service_account: boolean;
  group_id: string;
  group_name: string;
  attribute_name: string;
  triggering_workflows: Array<{ id: string; label: string; template: string }>;
}

export interface LateralEscalationWarning {
  group_id: string;
  group_name: string;
  scope_attribute_name: string;
  ownership_attribute_name: string;
  owner_count: number;
  owners: ResolvedGroupOwner[];
  group_owners_workflows: Array<{ id: string; label: string }>;
  mutating_workflows: Array<{ id: string; label: string; template: string }>;
}

export interface UnsafeScopeModeWarning {
  workflow_id: string;
  workflow_label: string;
  template: string;
  configured_mode: string;
  recommended_mode: string;
}

export interface RoleBearingSubgroupWarning {
  scope_group_id: string;
  scope_group_name: string;
  attribute_name: string;
  subgroup_id: string;
  subgroup_name: string;
  depth: number;
  has_admin_role: boolean;
  roles: Array<{ id: string; name: string; is_admin: boolean }>;
}

export function findUserMutatingWorkflows(workflows: any[]): Array<{ id: string; label: string; template: string }> {
  const mutating: Array<{ id: string; label: string; template: string }> = [];

  for (const wf of workflows || []) {
    if (wf.template === 'user-management') {
      mutating.push({
        id: wf.id,
        label: wf.label || wf.id,
        template: wf.template
      });
      continue;
    }

    if (wf.template === 'crud' && wf.parameters?.target_object === 'users') {
      const ops = Array.isArray(wf.parameters?.supported_operations) ? wf.parameters.supported_operations : [];
      const hasMutation = ops.some((op: any) => {
        const opName = typeof op === 'string' ? op : op?.name;
        return opName === 'create' || opName === 'update' || opName === 'delete';
      });
      if (hasMutation) {
        mutating.push({
          id: wf.id,
          label: wf.label || wf.id,
          template: wf.template
        });
      }
    }
  }

  return mutating;
}

export async function inspectGroupHierarchyForScopeGroups(
  sdk: any,
  activeScopeGroups: Array<{ group_id: string; group_name: string; attribute_name: string }>,
  groupsMap: Map<string, any>
): Promise<{
  hierarchyByGroupId: Map<string, { max_depth: number; subgroups: SubgroupInfo[] }>;
  deepSubgroupWarnings: DeepSubgroupWarning[];
  groupRoleIdsMap: Map<string, string[]>;
}> {
  const hierarchyByGroupId = new Map<string, { max_depth: number; subgroups: SubgroupInfo[] }>();
  const deepSubgroupWarnings: DeepSubgroupWarning[] = [];
  const groupRoleIdsMap = new Map<string, string[]>();

  let hierarchyItems: any[] = [];
  if (typeof sdk.search_groups_with_hierarchy === 'function') {
    try {
      hierarchyItems = await sdk.ok(sdk.search_groups_with_hierarchy({}));
    } catch (err) {
      hierarchyItems = [];
    }
  }

  const childrenByParentId = new Map<string, any[]>();
  for (const item of hierarchyItems || []) {
    const childId = String(item.id);
    const roleIds = Array.isArray(item.role_ids) ? item.role_ids.map((r: any) => String(r)) : [];
    groupRoleIdsMap.set(childId, roleIds);

    const parentIds = Array.isArray(item.parent_group_ids) ? item.parent_group_ids.map((p: any) => String(p)) : [];
    for (const parentId of parentIds) {
      if (!childrenByParentId.has(parentId)) {
        childrenByParentId.set(parentId, []);
      }
      childrenByParentId.get(parentId)!.push({
        id: childId,
        name: item.name || groupsMap.get(childId)?.name || `Group ${childId}`,
        parent_group_ids: parentIds,
        role_ids: roleIds
      });
    }
  }

  for (const scopeGroup of activeScopeGroups) {
    const rootId = String(scopeGroup.group_id);
    const visited = new Set<string>([rootId]);
    const queue: Array<{ id: string; depth: number }> = [{ id: rootId, depth: 0 }];
    const subgroups: SubgroupInfo[] = [];
    let maxDepth = 0;

    while (queue.length > 0) {
      const current = queue.shift()!;
      const children = childrenByParentId.get(current.id) || [];

      for (const child of children) {
        const nextDepth = current.depth + 1;
        if (nextDepth > maxDepth) {
          maxDepth = nextDepth;
        }
        if (!visited.has(child.id)) {
          visited.add(child.id);
          subgroups.push({
            group_id: child.id,
            group_name: child.name,
            depth: nextDepth,
            parent_group_ids: child.parent_group_ids,
            role_ids: child.role_ids
          });
          queue.push({ id: child.id, depth: nextDepth });
        }
      }
    }

    hierarchyByGroupId.set(rootId, { max_depth: maxDepth, subgroups });

    if (maxDepth > 1) {
      deepSubgroupWarnings.push({
        group_id: rootId,
        group_name: scopeGroup.group_name,
        attribute_name: scopeGroup.attribute_name,
        max_depth: maxDepth,
        deep_subgroups: subgroups.filter((sg) => sg.depth > 1)
      });
    }
  }

  return { hierarchyByGroupId, deepSubgroupWarnings, groupRoleIdsMap };
}

export async function inspectPrivilegedScopeGroupMembers(
  sdk: any,
  workflows: any[],
  activeScopeGroupsWithUsers: Array<{
    group_id: string;
    group_name: string;
    attribute_name: string;
    users: Array<{ id: string; name: string; email: string }>;
  }>,
  usersMap: Map<string, any>
): Promise<{
  userMutationWorkflows: Array<{ id: string; label: string; template: string }>;
  privilegedScopeMembers: PrivilegedScopeMemberWarning[];
}> {
  const userMutationWorkflows = findUserMutatingWorkflows(workflows);
  if (userMutationWorkflows.length === 0 || activeScopeGroupsWithUsers.length === 0) {
    return { userMutationWorkflows, privilegedScopeMembers: [] };
  }

  const adminRoleIds = new Set<string>();
  if (typeof sdk.all_roles === 'function') {
    try {
      const allRoles = await sdk.ok(sdk.all_roles({}));
      for (const r of allRoles || []) {
        if (isRoleAdmin(r) && r.id !== undefined && r.id !== null) {
          adminRoleIds.add(String(r.id));
        }
      }
    } catch (err) {
      // Ignore role lookup failure
    }
  }

  let sdkPrivilegedIds = new Set<string>();
  if (typeof sdk.all_users === 'function' && typeof sdk.all_roles === 'function') {
    try {
      sdkPrivilegedIds = await getPrivilegedUserIds(sdk);
    } catch (err) {
      // Fallback to usersMap + adminRoleIds if full SDK lookup fails during audit
    }
  }

  const privilegedScopeMembers: PrivilegedScopeMemberWarning[] = [];

  for (const sg of activeScopeGroupsWithUsers) {
    for (const member of sg.users || []) {
      const uid = String(member.id);
      const fullUser = usersMap.get(uid) || {};
      const isServiceAccount = Boolean(fullUser.is_service_account);

      const userRoleIds: string[] = Array.isArray(fullUser.role_ids)
        ? fullUser.role_ids.map((id: any) => String(id))
        : [];
      const isAdmin =
        userRoleIds.some((rid) => adminRoleIds.has(rid)) ||
        Boolean(fullUser.is_admin) ||
        (!isServiceAccount && sdkPrivilegedIds.has(uid));

      if (isAdmin || isServiceAccount) {
        privilegedScopeMembers.push({
          user_id: String(member.id),
          user_name: member.name,
          user_email: member.email,
          is_admin: isAdmin,
          is_service_account: isServiceAccount,
          group_id: sg.group_id,
          group_name: sg.group_name,
          attribute_name: sg.attribute_name,
          triggering_workflows: userMutationWorkflows
        });
      }
    }
  }

  return { userMutationWorkflows, privilegedScopeMembers };
}

/**
 * Detects lateral escalation risk when a Looker group has Group Owners configured
 * (with an active group-owners workflow in index.md) AND is also an active Scope Group
 * (or child subgroup of an active Scope Group) for a user-mutating workflow.
 */
export function inspectGroupOwnersScopeOverlapWarnings(
  workflows: any[],
  ownershipByAttrAndGroup: Map<string, Map<string, GroupOwnershipRecord>>,
  activeScopeGroupsFlat: Array<{
    group_id: string;
    group_name: string;
    attribute_name: string;
  }>,
  hierarchyByGroupId: Map<string, { max_depth: number; subgroups: SubgroupInfo[] }>
): LateralEscalationWarning[] {
  const groupOwnersWorkflows = (workflows || []).filter((wf: any) => wf.template === 'group-owners');
  const userMutationWorkflows = findUserMutatingWorkflows(workflows);

  if (groupOwnersWorkflows.length === 0 || userMutationWorkflows.length === 0) {
    return [];
  }

  const warnings: LateralEscalationWarning[] = [];

  for (const sg of activeScopeGroupsFlat) {
    const scopeGroupId = String(sg.group_id);
    const hInfo = hierarchyByGroupId.get(scopeGroupId);
    const scopeHierarchyIds = new Set<string>([
      scopeGroupId,
      ...(hInfo?.subgroups || []).map((sub) => String(sub.group_id))
    ]);

    for (const goWf of groupOwnersWorkflows) {
      const ownerAttr = String(
        goWf.parameters?.ownership_attribute_name || DEFAULT_GROUP_OWNERS_ATTRIBUTE
      ).trim();
      const ownershipMap = ownershipByAttrAndGroup.get(ownerAttr);
      if (!ownershipMap) continue;

      for (const candidateGroupId of scopeHierarchyIds) {
        const ownRecord = ownershipMap.get(candidateGroupId);
        if (ownRecord && ownRecord.owner_count > 0) {
          const alreadyAdded = warnings.some(
            (w) =>
              w.group_id === candidateGroupId &&
              w.scope_attribute_name === sg.attribute_name &&
              w.ownership_attribute_name === ownerAttr
          );
          if (!alreadyAdded) {
            warnings.push({
              group_id: candidateGroupId,
              group_name:
                candidateGroupId === scopeGroupId
                  ? sg.group_name
                  : hInfo?.subgroups.find((s) => s.group_id === candidateGroupId)?.group_name ||
                    `Group ${candidateGroupId}`,
              scope_attribute_name: sg.attribute_name,
              ownership_attribute_name: ownerAttr,
              owner_count: ownRecord.owner_count,
              owners: ownRecord.owners,
              group_owners_workflows: groupOwnersWorkflows
                .filter(
                  (w: any) =>
                    String(w.parameters?.ownership_attribute_name || DEFAULT_GROUP_OWNERS_ATTRIBUTE).trim() ===
                    ownerAttr
                )
                .map((w: any) => ({ id: w.id, label: w.label || w.id })),
              mutating_workflows: userMutationWorkflows
            });
          }
        }
      }
    }
  }

  return warnings;
}

/**
 * Flags any descendant subgroup under an active Scope Group that carries Looker roles
 * (directly or via parent groups), which can cause privilege escalation or blocked
 * group assignments in user-management workflows.
 */
export function inspectRoleBearingSubgroups(
  activeScopeGroups: Array<{ group_id: string; group_name: string; attribute_name: string }>,
  hierarchyByGroupId: Map<string, { max_depth: number; subgroups: SubgroupInfo[] }>,
  allRoles: any[],
  groupRoleIdsMap: Map<string, string[]>
): RoleBearingSubgroupWarning[] {
  const rolesById = new Map<string, any>();
  for (const r of allRoles || []) {
    if (r?.id !== undefined && r?.id !== null) {
      rolesById.set(String(r.id), r);
    }
  }

  const warnings: RoleBearingSubgroupWarning[] = [];

  for (const sg of activeScopeGroups || []) {
    const hierarchy = hierarchyByGroupId.get(String(sg.group_id));
    if (!hierarchy) continue;

    for (const sub of hierarchy.subgroups) {
      const effectiveRoleIds = new Set<string>(sub.role_ids || []);
      for (const pid of sub.parent_group_ids || []) {
        (groupRoleIdsMap.get(String(pid)) || []).forEach((rid) => effectiveRoleIds.add(rid));
      }

      if (effectiveRoleIds.size === 0) continue;

      const resolvedRoles = Array.from(effectiveRoleIds).map((rid) => {
        const role = rolesById.get(rid);
        const roleName = String(role?.name || `Role ${rid}`);
        return { id: rid, name: roleName, is_admin: isRoleAdmin(role) };
      });

      warnings.push({
        scope_group_id: String(sg.group_id),
        scope_group_name: sg.group_name,
        attribute_name: sg.attribute_name,
        subgroup_id: sub.group_id,
        subgroup_name: sub.group_name,
        depth: sub.depth,
        has_admin_role: resolvedRoles.some((r) => r.is_admin),
        roles: resolvedRoles
      });
    }
  }

  return warnings;
}

/**
 * Flags any user-management workflow in index.md that explicitly configures
 * mode: 'scope_groups' or mode: 'none' instead of 'scope_groups_minus_privileged'.
 */
export function inspectUnfilteredUserManagementModeWarnings(
  workflows: any[]
): UnsafeScopeModeWarning[] {
  const warnings: UnsafeScopeModeWarning[] = [];

  for (const wf of workflows || []) {
    if (wf.template !== 'user-management') continue;
    const rawMode = wf.parameters?.user_id_limitation?.mode;
    if (rawMode === 'scope_groups' || rawMode === 'none') {
      warnings.push({
        workflow_id: wf.id,
        workflow_label: wf.label || wf.id,
        template: wf.template,
        configured_mode: rawMode,
        recommended_mode: 'scope_groups_minus_privileged'
      });
    }
  }

  return warnings;
}
