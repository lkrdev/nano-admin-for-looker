import { getWorkflows } from '../../../../auth_utils';
import {
  AllowedAttributeRule,
  AttributeValueRuleType,
  NormalizedUserManagementParameters,
  ResolvedScopeContext,
  WorkflowContext
} from '../types';
import { assertTargetUserInScope } from '../scope';

const HARD_BLOCKED_ATTRIBUTE_NAMES = new Set<string>([
  'nano_admin_challenge',
  'nano_admin_admin_extension_nano_admin_challenge',
  'nano_admin_is_workflow_scope_group',
  'nano_admin_group_owners'
]);

export interface EvaluatedAttributeMetadata {
  id: string;
  name: string;
  label: string;
  type: string;
  value_is_hidden: boolean;
  is_system: boolean;
  editable: boolean;
  rule: AttributeValueRuleType;
  allowed_values: string[] | null;
  current_value: string | null;
  source: string;
  has_user_override: boolean;
}

export async function getUserAttributesAction(
  context: WorkflowContext,
  params: NormalizedUserManagementParameters,
  scope: ResolvedScopeContext,
  payload: any
): Promise<any> {
  if (!params.user_attributes.allow_view) {
    throw new Error('Viewing user attributes is not permitted for this workflow.');
  }

  const targetUserId = String(payload?.user_id || '').trim();
  assertTargetUserInScope(targetUserId, scope);

  const attributes = await buildEvaluatedUserAttributes(context, params, scope, targetUserId);
  return {
    user_id: targetUserId,
    allow_edit: params.user_attributes.allow_edit,
    attributes
  };
}

export async function setUserAttributeAction(
  context: WorkflowContext,
  params: NormalizedUserManagementParameters,
  scope: ResolvedScopeContext,
  payload: any
): Promise<any> {
  if (!params.user_attributes.allow_edit) {
    throw new Error('Editing user attributes is not permitted for this workflow.');
  }

  const targetUserId = String(payload?.user_id || '').trim();
  assertTargetUserInScope(targetUserId, scope);

  const attributeIdOrName = String(payload?.attribute_id || payload?.attribute_name || '').trim();
  const value = payload?.value !== undefined && payload?.value !== null ? String(payload.value) : '';
  if (!attributeIdOrName) {
    throw new Error('attribute_id or attribute_name is required.');
  }

  const attributes = await buildEvaluatedUserAttributes(context, params, scope, targetUserId);
  const targetMeta = attributes.find(
    (a) => a.id === attributeIdOrName || a.name.toLowerCase() === attributeIdOrName.toLowerCase()
  );

  if (!targetMeta) {
    throw new Error(`User attribute "${attributeIdOrName}" not found or is blocked.`);
  }

  if (!targetMeta.editable) {
    throw new Error(`403 Forbidden: User attribute "${targetMeta.name}" is not editable in this workflow.`);
  }

  validateAttributeValueAgainstRule(targetMeta, value);

  await context.sdk.ok(
    context.sdk.set_user_attribute_user_value(targetUserId, targetMeta.id, { value })
  );

  return {
    success: true,
    user_id: targetUserId,
    attribute_id: targetMeta.id,
    attribute_name: targetMeta.name,
    message: `Updated user attribute "${targetMeta.name}" for user ${targetUserId}.`
  };
}

export async function deleteUserAttributeAction(
  context: WorkflowContext,
  params: NormalizedUserManagementParameters,
  scope: ResolvedScopeContext,
  payload: any
): Promise<any> {
  if (!params.user_attributes.allow_edit) {
    throw new Error('Editing user attributes is not permitted for this workflow.');
  }

  const targetUserId = String(payload?.user_id || '').trim();
  assertTargetUserInScope(targetUserId, scope);

  const attributeIdOrName = String(payload?.attribute_id || payload?.attribute_name || '').trim();
  if (!attributeIdOrName) {
    throw new Error('attribute_id or attribute_name is required.');
  }

  const attributes = await buildEvaluatedUserAttributes(context, params, scope, targetUserId);
  const targetMeta = attributes.find(
    (a) => a.id === attributeIdOrName || a.name.toLowerCase() === attributeIdOrName.toLowerCase()
  );

  if (!targetMeta) {
    throw new Error(`User attribute "${attributeIdOrName}" not found or is blocked.`);
  }

  if (!targetMeta.editable) {
    throw new Error(`403 Forbidden: User attribute "${targetMeta.name}" is not editable in this workflow.`);
  }

  if (targetMeta.rule === 'must_match_admin') {
    throw new Error(`403 Forbidden: User attribute "${targetMeta.name}" requires matching the admin's value and cannot be cleared.`);
  }

  await context.sdk.ok(
    context.sdk.delete_user_attribute_user_value(targetUserId, targetMeta.id)
  );

  return {
    success: true,
    user_id: targetUserId,
    attribute_id: targetMeta.id,
    attribute_name: targetMeta.name,
    message: `Removed user-level override for "${targetMeta.name}" on user ${targetUserId}.`
  };
}

// --- Hoisted Pure Helpers ---

export async function resolveCreationRequiredAttributes(
  context: WorkflowContext,
  params: NormalizedUserManagementParameters,
  scope: ResolvedScopeContext,
  providedAttributes: Record<string, string> = {}
): Promise<Array<{ attribute_id: string; attribute_name: string; value: string }>> {
  const allAttrs = await buildEvaluatedUserAttributes(context, params, scope, context.userId);
  const toApply: Array<{ attribute_id: string; attribute_name: string; value: string }> = [];

  for (const attr of allAttrs) {
    if (!attr.editable) continue;

    const providedVal =
      providedAttributes[attr.name] !== undefined
        ? providedAttributes[attr.name]
        : providedAttributes[attr.id];

    if (attr.rule === 'must_match_admin') {
      const adminVal = attr.allowed_values && attr.allowed_values.length > 0 ? attr.allowed_values[0] : '';
      const effectiveVal = providedVal !== undefined ? String(providedVal) : adminVal;
      validateAttributeValueAgainstRule(attr, effectiveVal);
      if (effectiveVal !== '') {
        toApply.push({
          attribute_id: attr.id,
          attribute_name: attr.name,
          value: effectiveVal
        });
      }
    } else if (providedVal !== undefined && String(providedVal) !== '') {
      const strVal = String(providedVal);
      validateAttributeValueAgainstRule(attr, strVal);
      toApply.push({
        attribute_id: attr.id,
        attribute_name: attr.name,
        value: strVal
      });
    }
  }

  return toApply;
}

export async function buildEvaluatedUserAttributes(
  context: WorkflowContext,
  params: NormalizedUserManagementParameters,
  scope: ResolvedScopeContext,
  targetUserId: string
): Promise<EvaluatedAttributeMetadata[]> {
  const sdk = context.sdk;
  const hardBlockedNames = await collectHardBlockedAttributeNames(sdk, params, context.instanceHost);
  const blockedNamesLower = new Set<string>([
    ...Array.from(hardBlockedNames).map((n) => n.toLowerCase()),
    ...params.user_attributes.blocked_attributes.map((n) => n.toLowerCase())
  ]);

  const allowedRulesByNameLower = new Map<string, AllowedAttributeRule>();
  for (const r of params.user_attributes.allowed_attributes) {
    allowedRulesByNameLower.set(r.name.toLowerCase(), r);
  }

  const allAttributes = await sdk.ok(sdk.all_user_attributes({}));

  let targetUserValues: any[] = [];
  if (typeof sdk.user_attribute_user_values === 'function') {
    try {
      targetUserValues = await sdk.ok(sdk.user_attribute_user_values({ user_id: targetUserId }));
    } catch (err) {
      targetUserValues = [];
    }
  }

  let adminUserValues: any[] = [];
  const needsAdminValues = Array.from(allowedRulesByNameLower.values()).some(
    (r) => r.rule === 'must_match_admin'
  );
  if (needsAdminValues && typeof sdk.user_attribute_user_values === 'function') {
    try {
      adminUserValues = await sdk.ok(sdk.user_attribute_user_values({ user_id: context.userId }));
    } catch (err) {
      adminUserValues = [];
    }
  }

  const targetValByAttrId = new Map<string, any>();
  for (const uv of targetUserValues || []) {
    if (uv.user_attribute_id !== undefined && uv.user_attribute_id !== null) {
      targetValByAttrId.set(String(uv.user_attribute_id), uv);
    }
  }

  const adminValByAttrId = new Map<string, string>();
  for (const uv of adminUserValues || []) {
    if (uv.user_attribute_id !== undefined && uv.user_attribute_id !== null && uv.value !== undefined && uv.value !== null) {
      adminValByAttrId.set(String(uv.user_attribute_id), String(uv.value));
    }
  }

  const results: EvaluatedAttributeMetadata[] = [];

  for (const attr of allAttributes || []) {
    const attrId = String(attr.id);
    const attrName = String(attr.name || '').trim();
    const attrNameLower = attrName.toLowerCase();
    const isSystem = Boolean(attr.is_system);

    // Always exclude hard-blocked Nano-Admin internal/scope attributes and Looker system attributes
    if (isSystem || hardBlockedNames.has(attrNameLower)) {
      continue;
    }

    const isExplicitlyBlocked = blockedNamesLower.has(attrNameLower);
    const matchedRule = allowedRulesByNameLower.get(attrNameLower);
    const isAllowedForEdit =
      params.user_attributes.allow_edit &&
      !isExplicitlyBlocked &&
      (Boolean(matchedRule) || params.user_attributes.allow_all_non_blocked);

    const ruleType: AttributeValueRuleType = matchedRule?.rule || 'any';
    let allowedValues: string[] | null = null;

    if (isAllowedForEdit) {
      if (ruleType === 'allowed_values') {
        allowedValues = matchedRule?.values || [];
      } else if (ruleType === 'must_match_admin') {
        const adminVal = adminValByAttrId.get(attrId);
        allowedValues = adminVal !== undefined ? [adminVal] : [];
      } else if (ruleType === 'must_match_scope_group') {
        allowedValues = await resolveScopeGroupValuesForAttribute(
          sdk,
          attrId,
          scope.adminActiveScopeGroupIds
        );
      }
    }

    const userValObj = targetValByAttrId.get(attrId);
    const isHidden = Boolean(attr.value_is_hidden);
    const source = String(userValObj?.source || 'Default');
    const hasUserOverride = source.toLowerCase().includes('user');

    results.push({
      id: attrId,
      name: attrName,
      label: attr.label || attrName,
      type: attr.type || 'string',
      value_is_hidden: isHidden,
      is_system: isSystem,
      editable: isAllowedForEdit,
      rule: ruleType,
      allowed_values: allowedValues,
      current_value: isHidden ? null : (userValObj?.value ?? attr.default_value ?? null),
      source,
      has_user_override: hasUserOverride
    });
  }

  return results;
}

export function validateAttributeValueAgainstRule(
  attrMeta: EvaluatedAttributeMetadata,
  value: string
): void {
  if (attrMeta.rule === 'any') {
    return;
  }

  const allowed = attrMeta.allowed_values || [];
  if (!allowed.includes(value)) {
    if (attrMeta.rule === 'must_match_admin') {
      throw new Error(
        `403 Forbidden: Value for user attribute "${attrMeta.name}" must match the invoking admin's value.`
      );
    }
    if (attrMeta.rule === 'must_match_scope_group') {
      throw new Error(
        `403 Forbidden: Value "${value}" for user attribute "${attrMeta.name}" must match one of the active Scope Group values (${allowed.join(', ') || 'none'}).`
      );
    }
    throw new Error(
      `403 Forbidden: Value "${value}" is not in the allowed values list for user attribute "${attrMeta.name}" (${allowed.join(', ')}).`
    );
  }
}

async function resolveScopeGroupValuesForAttribute(
  sdk: any,
  attributeId: string,
  adminActiveScopeGroupIds: string[]
): Promise<string[]> {
  if (!adminActiveScopeGroupIds || adminActiveScopeGroupIds.length === 0) {
    return [];
  }
  try {
    const groupValues = await sdk.ok(sdk.all_user_attribute_group_values(attributeId));
    const valuesSet = new Set<string>();
    for (const gv of groupValues || []) {
      const gid = String(gv.group_id);
      if (adminActiveScopeGroupIds.includes(gid) && gv.value !== undefined && gv.value !== null) {
        valuesSet.add(String(gv.value));
      }
    }
    return Array.from(valuesSet);
  } catch (err) {
    return [];
  }
}

async function collectHardBlockedAttributeNames(
  sdk: any,
  params: NormalizedUserManagementParameters,
  instanceHost?: string
): Promise<Set<string>> {
  const blocked = new Set<string>();
  HARD_BLOCKED_ATTRIBUTE_NAMES.forEach((n) => blocked.add(n.toLowerCase()));
  if (params.user_id_limitation.attribute_name) {
    blocked.add(params.user_id_limitation.attribute_name.toLowerCase());
  }

  try {
    const workflowsData = await getWorkflows(sdk, instanceHost);
    for (const wf of workflowsData?.workflows || []) {
      const wfAttr = wf.parameters?.user_id_limitation?.attribute_name;
      if (wfAttr && typeof wfAttr === 'string') {
        blocked.add(wfAttr.trim().toLowerCase());
      }
      const ownerAttr = wf.parameters?.ownership_attribute_name;
      if (ownerAttr && typeof ownerAttr === 'string') {
        blocked.add(ownerAttr.trim().toLowerCase());
      }
    }
  } catch (err) {
    // Ignore workflow fetch error during attribute blocklist resolution
  }

  return blocked;
}
