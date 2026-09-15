import fs from 'fs';
import path from 'path';
import { getWorkflows, getUserGroups } from '../auth_utils';
import { BUILD_HASH, BUILD_TIMESTAMP } from '../build_hash';

export async function getWorkflowsHandler(sdk: any, userId: string, payload: any): Promise<any> {
  const configData = await getWorkflows(sdk);
  const userGroups = await getUserGroups(sdk, userId);

  const authorizedWorkflows = (configData.workflows || []).map((wf: any) => {
    let authorized = true;
    if (wf.authorized_groups && wf.authorized_groups.length > 0) {
      authorized = wf.authorized_groups.some((groupId: string) => userGroups.includes(groupId));
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

