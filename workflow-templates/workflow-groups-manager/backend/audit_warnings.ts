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

  // Determine which role IDs grant Looker Admin privileges
  const adminRoleIds = new Set<string>();
  if (typeof sdk.all_roles === 'function') {
    try {
      const allRoles = await sdk.ok(sdk.all_roles({}));
      for (const r of allRoles || []) {
        const isAdminRole =
          r.name === 'Admin' ||
          r.permission_set?.all_access === true ||
          r.permission_set?.unlimited === true ||
          (Array.isArray(r.permission_set?.permissions) && r.permission_set.permissions.includes('administer'));
        if (isAdminRole && r.id !== undefined && r.id !== null) {
          adminRoleIds.add(String(r.id));
        }
      }
    } catch (err) {
      // Ignore role lookup failure
    }
  }

  const privilegedScopeMembers: PrivilegedScopeMemberWarning[] = [];

  for (const sg of activeScopeGroupsWithUsers) {
    for (const member of sg.users || []) {
      const fullUser = usersMap.get(String(member.id)) || {};
      const isServiceAccount = Boolean(fullUser.is_service_account);

      const userRoleIds: string[] = Array.isArray(fullUser.role_ids)
        ? fullUser.role_ids.map((id: any) => String(id))
        : [];
      const isAdmin = userRoleIds.some((rid) => adminRoleIds.has(rid)) || Boolean(fullUser.is_admin);

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
