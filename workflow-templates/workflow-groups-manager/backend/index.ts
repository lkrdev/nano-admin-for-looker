import { getWorkflows } from '../../../auth_utils';

export interface WorkflowContext {
  sdk: any;
  userId: string;
  workflowId: string;
  parameters: {
    default_attribute_name?: string;
  };
}

export const handler = async (
  context: WorkflowContext,
  action: string,
  payload: any
): Promise<any> => {
  const sdk = context.sdk;
  const defaultAttr = context.parameters?.default_attribute_name || 'nano_admin_is_workflow_scope_group';

  if (action === 'get_groups_audit') {
    return await executeGroupsAudit(sdk, defaultAttr);
  }

  if (action === 'create_user_attribute') {
    const attrName = String(payload?.attribute_name || defaultAttr).trim();
    const label = String(payload?.label || 'Nano Admin Workflow Scope Group').trim();
    return await createScopeUserAttribute(sdk, attrName, label);
  }

  if (action === 'create_scope_group') {
    const groupName = String(payload?.group_name || '').trim();
    const attrName = String(payload?.attribute_name || defaultAttr).trim();
    const userIds = Array.isArray(payload?.user_ids) ? payload.user_ids.map((id: any) => String(id)) : [];
    return await createScopeGroup(sdk, groupName, attrName, userIds);
  }

  if (action === 'toggle_group_scope') {
    const groupId = String(payload?.group_id || '').trim();
    const attrName = String(payload?.attribute_name || defaultAttr).trim();
    const enable = Boolean(payload?.enable);
    return await toggleGroupScopeAttribute(sdk, groupId, attrName, enable);
  }

  if (action === 'remove_user_attribute_override') {
    const userId = String(payload?.user_id || '').trim();
    const attributeId = String(payload?.attribute_id || '').trim();
    return await removeUserAttributeOverride(sdk, userId, attributeId);
  }

  if (action === 'manage_group_members') {
    const groupId = String(payload?.group_id || '').trim();
    const userId = String(payload?.user_id || '').trim();
    const op = String(payload?.operation || 'add').trim();
    return await manageGroupMembers(sdk, groupId, userId, op);
  }

  throw new Error(`Unknown or unsupported action "${action}" for workflow-groups-manager template.`);
};

// --- Helper Functions ---

async function executeGroupsAudit(sdk: any, defaultAttributeName: string) {
  // 1. Fetch workflows from index.md
  let workflowsConfig: any = { workflows: [] };
  try {
    workflowsConfig = await getWorkflows(sdk);
  } catch (err) {
    // Fallback if index.md fetch fails
  }

  const workflows: any[] = workflowsConfig?.workflows || [];

  // 2. Introspect index.md for scope attributes & authorized groups
  const scopeAttributeNamesSet = new Set<string>([defaultAttributeName]);
  const compatibleWorkflows: any[] = [];
  const scopeWorkflows: any[] = [];
  const workflowsWithAuthGroups: any[] = [];
  const allReferencedAuthGroupIdsSet = new Set<string>();

  for (const wf of workflows) {
    if (wf.template === 'limited-system-activity' || wf.parameters?.user_id_limitation) {
      compatibleWorkflows.push(wf);
      const limitation = wf.parameters?.user_id_limitation;
      if (limitation?.mode === 'scope_groups' || limitation?.mode === 'tenant_groups') {
        scopeWorkflows.push(wf);
        if (limitation.attribute_name) {
          scopeAttributeNamesSet.add(limitation.attribute_name.trim());
        }
      }
    }

    if (Array.isArray(wf.authorized_groups) && wf.authorized_groups.length > 0) {
      workflowsWithAuthGroups.push(wf);
      wf.authorized_groups.forEach((gid: any) => allReferencedAuthGroupIdsSet.add(String(gid)));
    }
  }

  const monitoredAttributeNames = Array.from(scopeAttributeNamesSet);

  // 3. Fetch Looker instance state
  const [allAttributes, allGroups, allUsers] = await Promise.all([
    sdk.ok(sdk.all_user_attributes({})),
    sdk.ok(sdk.all_groups({ fields: 'id,name' })),
    sdk.ok(sdk.all_users({ fields: 'id,first_name,last_name,email,display_name,is_disabled', limit: 1000 }))
  ]);

  const groupsMap = new Map<string, any>();
  (allGroups || []).forEach((g: any) => groupsMap.set(String(g.id), g));

  const usersMap = new Map<string, any>();
  (allUsers || []).forEach((u: any) => usersMap.set(String(u.id), u));

  // 4. Inspect Monitored User Attributes & Group Values
  const scopeAttributeAudits: any[] = [];
  const userMisconfigurations: any[] = [];
  const userScopeGroupMembershipsMap = new Map<string, Set<string>>(); // userId -> Set of scope group labels/IDs

  let totalTaggedGroups = 0;
  let totalYesGroups = 0;

  for (const attrName of monitoredAttributeNames) {
    const targetAttr = (allAttributes || []).find((a: any) => a.name === attrName);

    // Discover which workflows in index.md use this scope attribute
    const usedByWorkflows = workflows.filter((wf: any) => {
      const lim = wf.parameters?.user_id_limitation;
      if (!lim) {
        return attrName === defaultAttributeName && wf.template === 'limited-system-activity';
      }
      const wfAttr = (lim.attribute_name || defaultAttributeName).trim();
      return wfAttr === attrName;
    }).map((wf: any) => ({
      id: wf.id,
      label: wf.label || wf.id,
      template: wf.template
    }));

    if (!targetAttr) {
      scopeAttributeAudits.push({
        attribute_name: attrName,
        attribute_id: null,
        exists: false,
        groups_tagged_count: 0,
        groups_yes_count: 0,
        tagged_groups: [],
        used_by_workflows: usedByWorkflows
      });
      continue;
    }

    let groupValues: any[] = [];
    try {
      groupValues = await sdk.ok(sdk.all_user_attribute_group_values(targetAttr.id));
    } catch (err) {
      // Ignore
    }

    const taggedGroups: any[] = [];
    let attrYesCount = 0;

    for (const gv of groupValues || []) {
      const valStr = String(gv.value || '').trim().toLowerCase();
      const groupId = String(gv.group_id);
      const groupObj = groupsMap.get(groupId);

      if (valStr) {
        totalTaggedGroups++;
      }

      if (valStr === 'yes') {
        attrYesCount++;
        totalYesGroups++;

        // Fetch users in this scope group
        let groupUsers: any[] = [];
        try {
          groupUsers = await sdk.ok(sdk.all_group_users({ group_id: groupId, fields: 'id,first_name,last_name,email,display_name' }));
        } catch (err: any) {
          console.error(`Failed to fetch users for scope group ${groupId}:`, err);
        }

        groupUsers.forEach((u: any) => {
          const uid = String(u.id);
          if (!userScopeGroupMembershipsMap.has(uid)) {
            userScopeGroupMembershipsMap.set(uid, new Set());
          }
          const groupLabel = groupObj?.name ? `${groupObj.name} (${attrName})` : `Group ${groupId} (${attrName})`;
          userScopeGroupMembershipsMap.get(uid)!.add(groupLabel);
        });

        taggedGroups.push({
          group_id: groupId,
          group_name: groupObj?.name || `Group ${groupId}`,
          value: gv.value,
          is_active_scope: true,
          user_count: groupUsers.length,
          users: groupUsers.map((u: any) => ({
            id: String(u.id),
            name: u.display_name || `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email || `User ${u.id}`,
            email: u.email || ''
          }))
        });
      } else {
        taggedGroups.push({
          group_id: groupId,
          group_name: groupObj?.name || `Group ${groupId}`,
          value: gv.value,
          is_active_scope: false,
          user_count: 0,
          users: []
        });
      }
    }

    scopeAttributeAudits.push({
      attribute_name: attrName,
      attribute_id: String(targetAttr.id),
      exists: true,
      groups_tagged_count: groupValues.length,
      groups_yes_count: attrYesCount,
      tagged_groups: taggedGroups,
      used_by_workflows: usedByWorkflows
    });

    // Audit for user-level misconfigurations
    try {
      let userValues: any[] = [];
      if (typeof sdk.all_user_attribute_user_values === 'function') {
        userValues = await sdk.ok(sdk.all_user_attribute_user_values({ user_attribute_id: targetAttr.id }));
      }
      (userValues || []).forEach((uv: any) => {
        if (uv.user_id) {
          const uObj = usersMap.get(String(uv.user_id));
          userMisconfigurations.push({
            user_id: String(uv.user_id),
            user_name: uObj ? (uObj.display_name || `${uObj.first_name || ''} ${uObj.last_name || ''}`.trim() || uObj.email) : `User ${uv.user_id}`,
            user_email: uObj?.email || '',
            attribute_name: attrName,
            attribute_id: String(targetAttr.id),
            value: uv.value
          });
        }
      });
    } catch (err) {
      // Ignore user value audit failure if unsupported
    }
  }

  // 5. Compute User Scope Membership Buckets (0, 1, 2+)
  const activeUsers = (allUsers || []).filter((u: any) => !u.is_disabled);

  const bucket0: any[] = [];
  const bucket1: any[] = [];
  const bucket2Plus: any[] = [];

  activeUsers.forEach((u: any) => {
    const uid = String(u.id);
    const scopeGroupsSet = userScopeGroupMembershipsMap.get(uid);
    const scopeGroupsList = scopeGroupsSet ? Array.from(scopeGroupsSet) : [];
    const count = scopeGroupsList.length;

    const userPayload = {
      id: uid,
      name: u.display_name || `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email || `User ${uid}`,
      email: u.email || '',
      scope_count: count,
      scope_groups: scopeGroupsList
    };

    if (count === 0) {
      bucket0.push(userPayload);
    } else if (count === 1) {
      bucket1.push(userPayload);
    } else {
      bucket2Plus.push(userPayload);
    }
  });

  const totalUsersInScopeGroups = bucket1.length + bucket2Plus.length;

  // 6. Inspect Workflow Access (authorized_groups)
  const uniqueInvalidAuthGroupsMap = new Map<string, any>();
  const uniqueEmptyAuthGroupsMap = new Map<string, any>();
  const workflowAccessMatrix: any[] = [];

  for (const wf of workflows) {
    const authGroupIds: string[] = (wf.authorized_groups || []).map((g: any) => String(g));
    const resolvedGroups: any[] = [];

    for (const gid of authGroupIds) {
      const gObj = groupsMap.get(gid);
      if (!gObj) {
        uniqueInvalidAuthGroupsMap.set(gid, { workflow_id: wf.id, workflow_label: wf.label || wf.id, group_id: gid });
        resolvedGroups.push({ group_id: gid, group_name: `Unknown Group (${gid})`, exists: false, user_count: 0 });
      } else {
        let memberCount = 0;
        try {
          const gUsers = await sdk.ok(sdk.all_group_users({ group_id: gid, fields: 'id' }));
          memberCount = (gUsers || []).length;
        } catch (err: any) {
          console.error(`Failed to fetch members for authorization group ${gid}:`, err);
        }

        if (memberCount === 0) {
          uniqueEmptyAuthGroupsMap.set(gid, { workflow_id: wf.id, workflow_label: wf.label || wf.id, group_id: gid, group_name: gObj.name });
        }

        resolvedGroups.push({ group_id: gid, group_name: gObj.name, exists: true, user_count: memberCount });
      }
    }

    workflowAccessMatrix.push({
      workflow_id: wf.id,
      workflow_label: wf.label || wf.id,
      template: wf.template,
      has_auth_groups: authGroupIds.length > 0,
      authorized_groups: resolvedGroups
    });
  }

  // Sort workflowAccessMatrix: Unrestricted & 0-member / invalid groups FIRST
  workflowAccessMatrix.sort((a: any, b: any) => {
    const aHasIssue = !a.has_auth_groups || a.authorized_groups.some((g: any) => !g.exists || g.user_count === 0);
    const bHasIssue = !b.has_auth_groups || b.authorized_groups.some((g: any) => !g.exists || g.user_count === 0);

    if (aHasIssue && !bHasIssue) return -1;
    if (!aHasIssue && bHasIssue) return 1;

    const aUnrestricted = !a.has_auth_groups;
    const bUnrestricted = !b.has_auth_groups;
    if (aUnrestricted && !bUnrestricted) return -1;
    if (!aUnrestricted && bUnrestricted) return 1;

    return String(a.workflow_label).localeCompare(String(b.workflow_label));
  });

  // 7. Evaluate Scope Group Health Checks Matrix (6 Scope Checks)
  const missingAttributes = scopeAttributeAudits.filter(a => !a.exists).map(a => a.attribute_name);

  const healthChecks = [
    {
      id: 'no_compatible_templates',
      title: 'Compatible Workflows in index.md',
      passed: compatibleWorkflows.length > 0,
      description: compatibleWorkflows.length > 0
        ? `Found ${compatibleWorkflows.length} workflow(s) supporting scope groups.`
        : 'No workflows defined in index.md of a template type that supports scope groups (e.g. limited-system-activity).',
      recommendation: 'Add a workflow of template type "limited-system-activity" to index.md.'
    },
    {
      id: 'no_scope_workflows',
      title: 'Scope Group Workflows Active',
      passed: scopeWorkflows.length > 0,
      description: scopeWorkflows.length > 0
        ? `Found ${scopeWorkflows.length} workflow(s) configured with scope_groups mode.`
        : 'Workflows exist, but none currently have user_id_limitation.mode set to "scope_groups".',
      recommendation: 'Update index.md to enable user_id_limitation mode "scope_groups" for desired workflows.'
    },
    {
      id: 'missing_user_attributes',
      title: 'Scope Group User Attributes Defined',
      passed: missingAttributes.length === 0,
      description: missingAttributes.length === 0
        ? `All monitored scope attributes (${monitoredAttributeNames.join(', ')}) exist in Looker.`
        : `Missing user attribute(s) in Looker: ${missingAttributes.join(', ')}.`,
      recommendation: `Create user attribute "${defaultAttributeName}" in Looker.`,
      actionable_attribute: missingAttributes.includes(defaultAttributeName) ? defaultAttributeName : missingAttributes[0]
    },
    {
      id: 'no_groups_tagged',
      title: 'Looker Groups Tagged with Scope Attribute',
      passed: totalTaggedGroups > 0,
      description: totalTaggedGroups > 0
        ? `${totalTaggedGroups} group assignment(s) exist for scope attributes.`
        : 'Scope user attributes exist, but no Looker groups have any value set.',
      recommendation: 'Tag at least one Looker group with value "yes" for your scope group attribute.'
    },
    {
      id: 'no_groups_yes',
      title: 'Active Scope Groups (Value = "yes")',
      passed: totalYesGroups > 0,
      description: totalYesGroups > 0
        ? `${totalYesGroups} Looker group(s) have scope attribute set to "yes".`
        : 'Scope user attributes are set on groups, but none are currently enabled with value "yes".',
      recommendation: 'Set the group user attribute value to "yes" for your designated scope groups.'
    },
    {
      id: 'no_users_in_scope_groups',
      title: 'Users Assigned to Scope Groups',
      passed: totalUsersInScopeGroups > 0,
      description: totalUsersInScopeGroups > 0
        ? `${totalUsersInScopeGroups} user(s) belong to active scope groups.`
        : 'Active scope groups exist, but zero users are assigned as members.',
      recommendation: 'Add user accounts to your active scope groups.'
    }
  ];

  return {
    monitored_attribute_names: monitoredAttributeNames,
    default_attribute_name: defaultAttributeName,
    health_checks: healthChecks,
    scope_attributes: scopeAttributeAudits,
    user_misconfigurations: userMisconfigurations,
    user_scope_distribution: {
      total_active_users: activeUsers.length,
      unscoped_count: bucket0.length,
      isolated_count: bucket1.length,
      overlapping_count: bucket2Plus.length,
      bucket_0: bucket0,
      bucket_1: bucket1,
      bucket_2plus: bucket2Plus
    },
    workflow_access_matrix: workflowAccessMatrix,
    all_groups: (allGroups || []).map((g: any) => ({ id: String(g.id), name: g.name }))
  };
}

async function createScopeUserAttribute(sdk: any, attributeName: string, label: string) {
  const existingAttrs = await sdk.ok(sdk.all_user_attributes({}));
  const found = (existingAttrs || []).find((a: any) => a.name === attributeName);

  if (found) {
    return { success: true, message: `User attribute "${attributeName}" already exists.` };
  }

  const newAttr = await sdk.ok(
    sdk.create_user_attribute({
      name: attributeName,
      label: label || attributeName,
      type: 'string',
      user_can_edit: false,
      value_is_hidden: false,
      default_value: null
    })
  );

  return { success: true, attribute: newAttr, message: `Successfully created user attribute "${attributeName}".` };
}

async function createScopeGroup(sdk: any, groupName: string, attributeName: string, userIds: string[] = []) {
  if (!groupName) {
    throw new Error('Group name is required.');
  }

  const newGroup = await sdk.ok(sdk.create_group({ name: groupName }));

  if (attributeName) {
    const allAttrs = await sdk.ok(sdk.all_user_attributes({}));
    const attrObj = (allAttrs || []).find((a: any) => a.name === attributeName);
    if (attrObj) {
      await setGroupUserAttributeValue(sdk, String(newGroup.id), String(attrObj.id), 'yes');
    }
  }

  if (Array.isArray(userIds) && userIds.length > 0) {
    for (const uid of userIds) {
      try {
        await sdk.ok(sdk.add_group_user(String(newGroup.id), { user_id: String(uid) }));
      } catch (err: any) {
        console.error(`Failed to add user ${uid} to new scope group ${newGroup.id}:`, err);
      }
    }
  }

  return { success: true, group: newGroup, message: `Successfully created group "${groupName}" with ${userIds.length} assigned member(s).` };
}

async function toggleGroupScopeAttribute(sdk: any, groupId: string, attributeName: string, enable: boolean) {
  const allAttrs = await sdk.ok(sdk.all_user_attributes({}));
  const attrObj = (allAttrs || []).find((a: any) => a.name === attributeName);

  if (!attrObj) {
    throw new Error(`User attribute "${attributeName}" not found in Looker.`);
  }

  if (enable) {
    await setGroupUserAttributeValue(sdk, groupId, String(attrObj.id), 'yes');
  } else {
    await deleteGroupUserAttributeValue(sdk, groupId, String(attrObj.id));
  }

  return { success: true, message: `Updated group ${groupId} attribute "${attributeName}" to ${enable ? 'yes' : 'cleared'}.` };
}

async function setGroupUserAttributeValue(sdk: any, groupId: string, attributeId: string, value: string) {
  if (sdk.update_user_attribute_group_value) {
    return await sdk.ok(sdk.update_user_attribute_group_value(groupId, attributeId, { value }));
  }
  if (sdk.set_user_attribute_group_value) {
    return await sdk.ok(sdk.set_user_attribute_group_value(groupId, attributeId, { value }));
  }
  throw new Error('SDK method to set group user attribute value is unavailable.');
}

async function deleteGroupUserAttributeValue(sdk: any, groupId: string, attributeId: string) {
  if (sdk.delete_user_attribute_group_value) {
    return await sdk.ok(sdk.delete_user_attribute_group_value(groupId, attributeId));
  }
  return await setGroupUserAttributeValue(sdk, groupId, attributeId, '');
}

async function removeUserAttributeOverride(sdk: any, userId: string, attributeId: string) {
  if (sdk.delete_user_attribute_user_value) {
    await sdk.ok(sdk.delete_user_attribute_user_value(userId, attributeId));
  } else if (sdk.set_user_attribute_user_value) {
    await sdk.ok(sdk.set_user_attribute_user_value(userId, attributeId, { value: null }));
  }
  return { success: true, message: `Removed user-level override for user ${userId}.` };
}

async function manageGroupMembers(sdk: any, groupId: string, userId: string, operation: string) {
  if (operation === 'add') {
    await sdk.ok(sdk.add_group_user(groupId, { user_id: userId }));
    return { success: true, message: `Added user ${userId} to group ${groupId}.` };
  } else if (operation === 'remove') {
    await sdk.ok(sdk.delete_group_user(groupId, userId));
    return { success: true, message: `Removed user ${userId} from group ${groupId}.` };
  }
  throw new Error(`Unsupported membership operation "${operation}".`);
}
