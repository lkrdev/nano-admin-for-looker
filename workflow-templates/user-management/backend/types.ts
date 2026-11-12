import {
  UserIdLimitation,
  UserIdLimitationMode,
  UserIdLimitationResult
} from '../../../auth_utils';
import { LookerBackendSDK } from '../../../looker_logging_sdk';

export { UserIdLimitation, UserIdLimitationMode, UserIdLimitationResult };

export interface ProfileParameters {
  allow_create: boolean;
  allow_update_name: boolean;
  allow_update_email: boolean;
  allow_disable: boolean;
  allow_delete: boolean;
}

export interface CredentialsParameters {
  allow_email_credentials: boolean;
  allow_password_reset: boolean;
  allow_totp_reset: boolean;
  allow_session_revoke: boolean;
}

export interface GroupsParameters {
  allow_view: boolean;
  allow_edit: boolean;
}

export interface RolesParameters {
  allow_view: boolean;
  allow_edit: boolean;
  allowed_role_ids: string[];
}

export type AttributeValueRuleType = 'any' | 'allowed_values' | 'must_match_admin' | 'must_match_scope_group';

export interface AllowedAttributeRule {
  name: string;
  rule: AttributeValueRuleType;
  values?: string[];
}

export interface UserAttributesParameters {
  allow_view: boolean;
  allow_edit: boolean;
  blocked_attributes: string[];
  allowed_attributes: AllowedAttributeRule[];
  allow_all_non_blocked: boolean;
}

export interface FolderAccessParameters {
  allow_view: boolean;
  allow_edit: boolean;
}

export interface TelemetryParameters {
  allow_view_metrics: boolean;
  allow_manage_schedules: boolean;
}

export interface NormalizedUserManagementParameters {
  user_id_limitation: {
    mode: UserIdLimitationMode;
    attribute_name: string;
  };
  profile: ProfileParameters;
  credentials: CredentialsParameters;
  groups: GroupsParameters;
  roles: RolesParameters;
  user_attributes: UserAttributesParameters;
  folder_access: FolderAccessParameters;
  telemetry: TelemetryParameters;
}

export interface WorkflowContext {
  sdk: LookerBackendSDK | any;
  userId: string;
  workflowId: string;
  instanceHost?: string;
  parameters: Record<string, any>;
  helpers?: {
    getScopeGroupUserIds: (attributeName?: string, includeSubgroups?: boolean) => Promise<string[]>;
    resolveUserIdLimitation: (
      limitationConfig?: UserIdLimitation,
      defaultMode?: UserIdLimitationMode
    ) => Promise<UserIdLimitationResult>;
  };
}

export interface ManageableGroupNode {
  id: string;
  name: string;
  is_scope_group: boolean;
  depth: number;
  parent_group_ids: string[];
  role_ids: string[];
}

export interface ResolvedScopeContext {
  limitation: UserIdLimitationResult;
  attributeName: string;
  adminActiveScopeGroupIds: string[];
  manageableGroups: ManageableGroupNode[];
  manageableGroupIdsSet: Set<string>;
}

export function normalizeParameters(rawParams: Record<string, any> = {}): NormalizedUserManagementParameters {
  const rawLimitation = rawParams.user_id_limitation || {};
  const rawMode = rawLimitation.mode || 'scope_groups_minus_privileged';
  const normalizedMode: UserIdLimitationMode =
    rawMode === 'none' ||
    rawMode === 'self' ||
    rawMode === 'scope_groups' ||
    rawMode === 'exclude_privileged' ||
    rawMode === 'scope_groups_minus_privileged'
      ? rawMode
      : 'scope_groups_minus_privileged';
  const attributeName = String(rawLimitation.attribute_name || 'nano_admin_is_workflow_scope_group').trim();

  const rawProfile = rawParams.profile || {};
  const profile: ProfileParameters = {
    allow_create: Boolean(rawProfile.allow_create),
    allow_update_name: Boolean(rawProfile.allow_update_name),
    allow_update_email: Boolean(rawProfile.allow_update_email),
    allow_disable: Boolean(rawProfile.allow_disable),
    allow_delete: Boolean(rawProfile.allow_delete)
  };

  const rawCreds = rawParams.credentials || {};
  const credentials: CredentialsParameters = {
    allow_email_credentials: Boolean(rawCreds.allow_email_credentials),
    allow_password_reset: Boolean(rawCreds.allow_password_reset),
    allow_totp_reset: Boolean(rawCreds.allow_totp_reset),
    allow_session_revoke: Boolean(rawCreds.allow_session_revoke)
  };

  const rawGroups = rawParams.groups || {};
  const groups: GroupsParameters = {
    allow_view: rawGroups.allow_view !== undefined ? Boolean(rawGroups.allow_view) : true,
    allow_edit: Boolean(rawGroups.allow_edit)
  };

  const rawRoles = rawParams.roles || {};
  const allowedRoleIds = Array.isArray(rawRoles.allowed_role_ids)
    ? rawRoles.allowed_role_ids.map((id: any) => String(id).trim()).filter(Boolean)
    : [];
  const roles: RolesParameters = {
    allow_view: rawRoles.allow_view !== undefined ? Boolean(rawRoles.allow_view) : true,
    allow_edit: Boolean(rawRoles.allow_edit),
    allowed_role_ids: allowedRoleIds
  };

  const rawAttrs = rawParams.user_attributes || {};
  const blockedAttributes = Array.isArray(rawAttrs.blocked_attributes)
    ? rawAttrs.blocked_attributes.map((a: any) => String(a).trim()).filter(Boolean)
    : [];

  const rawAllowedAttrs = Array.isArray(rawAttrs.allowed_attributes) ? rawAttrs.allowed_attributes : [];
  let allowAllNonBlocked = false;
  const parsedAllowedRules: AllowedAttributeRule[] = [];

  for (const entry of rawAllowedAttrs) {
    if (typeof entry === 'string') {
      const trimmed = entry.trim();
      if (trimmed === '*') {
        allowAllNonBlocked = true;
      } else if (trimmed) {
        parsedAllowedRules.push({ name: trimmed, rule: 'any' });
      }
    } else if (entry && typeof entry === 'object' && entry.name) {
      const name = String(entry.name).trim();
      if (name === '*') {
        allowAllNonBlocked = true;
      } else if (name) {
        const rawRule = String(entry.rule || 'any').trim();
        const rule: AttributeValueRuleType =
          rawRule === 'must_match_admin' ||
          rawRule === 'must_match_scope_group' ||
          rawRule === 'allowed_values'
            ? rawRule
            : 'any';
        const values = Array.isArray(entry.values)
          ? entry.values.map((v: any) => String(v))
          : undefined;
        parsedAllowedRules.push({ name, rule, values });
      }
    }
  }

  const user_attributes: UserAttributesParameters = {
    allow_view: rawAttrs.allow_view !== undefined ? Boolean(rawAttrs.allow_view) : true,
    allow_edit: Boolean(rawAttrs.allow_edit),
    blocked_attributes: blockedAttributes,
    allowed_attributes: parsedAllowedRules,
    allow_all_non_blocked: allowAllNonBlocked
  };

  const rawFolder = rawParams.folder_access || {};
  const folder_access: FolderAccessParameters = {
    allow_view: rawFolder.allow_view !== undefined ? Boolean(rawFolder.allow_view) : true,
    allow_edit: Boolean(rawFolder.allow_edit)
  };

  const rawTelemetry = rawParams.telemetry || {};
  const telemetry: TelemetryParameters = {
    allow_view_metrics: rawTelemetry.allow_view_metrics !== undefined ? Boolean(rawTelemetry.allow_view_metrics) : true,
    allow_manage_schedules: Boolean(rawTelemetry.allow_manage_schedules)
  };

  return {
    user_id_limitation: {
      mode: normalizedMode,
      attribute_name: attributeName
    },
    profile,
    credentials,
    groups,
    roles,
    user_attributes,
    folder_access,
    telemetry
  };
}
