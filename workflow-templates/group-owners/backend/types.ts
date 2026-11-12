import {
  UserIdLimitation,
  UserIdLimitationMode,
  UserIdLimitationResult
} from '../../../auth_utils';
import {
  DEFAULT_GROUP_OWNERS_ATTRIBUTE,
  OwnedGroupNode
} from '../../../group_ownership';
import { LookerBackendSDK } from '../../../looker_logging_sdk';

export { UserIdLimitation, UserIdLimitationMode, UserIdLimitationResult, OwnedGroupNode };

export interface MembershipsParameters {
  allow_add_users: boolean;
  allow_remove_users: boolean;
  allow_edit_owners: boolean;
  allow_add_existing_groups: boolean;
  allow_remove_child_groups: boolean;
  allow_create_subgroups: boolean;
}

export interface NormalizedGroupOwnersParameters {
  ownership_attribute_name: string;
  include_subgroups: boolean;
  user_id_limitation: {
    mode: UserIdLimitationMode;
    attribute_name: string;
  };
  memberships: MembershipsParameters;
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

export interface ResolvedGroupOwnersContext {
  limitation: UserIdLimitationResult;
  ownershipAttributeName: string;
  attributeExists: boolean;
  includeSubgroups: boolean;
  directOwnedGroupIds: string[];
  allManageableGroupIdsSet: Set<string>;
  ownedGroupsById: Map<string, OwnedGroupNode>;
  rootOwnedGroups: OwnedGroupNode[];
}

export function normalizeGroupOwnersParameters(
  rawParams: Record<string, any> = {}
): NormalizedGroupOwnersParameters {
  const ownershipAttributeName = String(
    rawParams.ownership_attribute_name || DEFAULT_GROUP_OWNERS_ATTRIBUTE
  ).trim();
  const includeSubgroups =
    rawParams.include_subgroups !== undefined ? Boolean(rawParams.include_subgroups) : true;

  const rawLimitation = rawParams.user_id_limitation || {};
  const rawMode = rawLimitation.mode || 'exclude_privileged';
  const normalizedMode: UserIdLimitationMode =
    rawMode === 'none' ||
    rawMode === 'self' ||
    rawMode === 'scope_groups' ||
    rawMode === 'scope_groups_minus_privileged' ||
    rawMode === 'exclude_privileged'
      ? rawMode
      : 'exclude_privileged';
  const attributeName = String(
    rawLimitation.attribute_name || 'nano_admin_is_workflow_scope_group'
  ).trim();

  const rawMemberships = rawParams.memberships || {};
  const memberships: MembershipsParameters = {
    allow_add_users:
      rawMemberships.allow_add_users !== undefined
        ? Boolean(rawMemberships.allow_add_users)
        : true,
    allow_remove_users:
      rawMemberships.allow_remove_users !== undefined
        ? Boolean(rawMemberships.allow_remove_users)
        : true,
    allow_edit_owners:
      rawMemberships.allow_edit_owners !== undefined
        ? Boolean(rawMemberships.allow_edit_owners)
        : true,
    allow_add_existing_groups: Boolean(rawMemberships.allow_add_existing_groups),
    allow_remove_child_groups: Boolean(rawMemberships.allow_remove_child_groups),
    allow_create_subgroups: Boolean(rawMemberships.allow_create_subgroups)
  };

  return {
    ownership_attribute_name: ownershipAttributeName,
    include_subgroups: includeSubgroups,
    user_id_limitation: {
      mode: normalizedMode,
      attribute_name: attributeName
    },
    memberships
  };
}
