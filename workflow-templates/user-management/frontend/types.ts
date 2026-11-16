export interface WorkflowComponentProps {
  workflowId: string;
  label: string;
  parameters: Record<string, any>;
  subRoute?: string;
  onNavigateSubRoute?: (subPath: string) => void;
  coreSDK: any;
  extensionSDK: any;
  addLog: (msg: string) => void;
  callBackend: (action: string, payload?: any) => Promise<any>;
}

export interface DirectoryUser {
  id: string;
  first_name: string;
  last_name: string;
  display_name: string;
  email: string;
  is_disabled: boolean;
  group_ids: string[];
  role_ids: string[];
  shared_scope_group_ids: string[];
  manageable_groups: Array<{ id: string; name: string; is_scope_group: boolean }>;
  direct_roles: Array<{ id: string; name: string }>;
}

export type DetailTabId =
  | 'profile'
  | 'groups'
  | 'roles'
  | 'attributes'
  | 'folders'
  | 'telemetry';
