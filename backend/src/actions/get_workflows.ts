import fs from 'fs';
import path from 'path';
import { getWorkflows, getUserGroups, resolveAuthorizedGroups } from '../auth_utils';
import { BUILD_HASH, BUILD_TIMESTAMP } from '../build_hash';
import { ActionContext } from './registry';

export async function getWorkflowsHandler(sdk: any, userId: string, payload: any, context?: ActionContext): Promise<any> {
  const instanceHost = context?.instanceHost;
  const configData = await getWorkflows(sdk, instanceHost);
  const userGroups = await getUserGroups(sdk, userId);

  const authorizedWorkflows = (configData.workflows || []).map((wf: any) => {
    const allowedGroupIds = resolveAuthorizedGroups(wf.authorized_groups, instanceHost);
    let authorized = false;
    if (allowedGroupIds.length > 0) {
      authorized = allowedGroupIds.some((groupId: string) => userGroups.includes(groupId));
    }
    const manifest = getTemplateManifest(wf.template);
    const mountType = manifest.mount_type || wf.mount_type || 'page';

    return {
      ...wf,
      mount_type: mountType,
      authorized
    };
  });

  return {
    message: 'Workflows retrieved successfully',
    timestamp: new Date().toISOString(),
    workflows: authorizedWorkflows,
    index_file_loaded: configData.indexFileLoaded !== false,
    parse_error: configData.parseError || null,
    build_hash: BUILD_HASH,
    build_timestamp: BUILD_TIMESTAMP
  };
}

function getTemplateManifest(templateId: string): any {
  try {
    const manifestPath = path.resolve(__dirname, '..', 'workflow-templates', templateId, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      const content = fs.readFileSync(manifestPath, 'utf8');
      return JSON.parse(content);
    }
  } catch (e) {
    console.warn(`Failed to read manifest for template "${templateId}":`, e);
  }
  return {};
}

