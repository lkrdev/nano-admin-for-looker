import yaml from 'js-yaml';

let cachedPages: any = null;
let cacheExpiration = 0;

export function parseYaml(yamlStr: string): any {
  try {
    return yaml.load(yamlStr) || {};
  } catch (e) {
    console.error('Error parsing YAML configuration:', e);
    return {};
  }
}

export async function getAdminPages(sdk: any): Promise<any> {
  const cacheDurationMs = parseInt(process.env.ADMIN_PAGES_CACHE_DURATION_MS || '0', 10);
  const now = Date.now();

  if (cachedPages && now < cacheExpiration) {
    return cachedPages;
  }

  console.log('Fetching index.md from project nano_admin...');
  const fileObj = await sdk.ok(sdk.project_file('nano_admin', 'index.md', 'id,path,title,type,text'));
  if (!fileObj || !fileObj.text) {
    throw new Error('File index.md returned but text content was empty');
  }

  const parsed = parseYaml(fileObj.text);
  cachedPages = parsed;
  cacheExpiration = now + cacheDurationMs;
  return parsed;
}

export async function getWorkflows(sdk: any): Promise<any> {
  return getAdminPages(sdk);
}

export async function getUserGroups(sdk: any, userId: string): Promise<string[]> {
  console.log(`Fetching group memberships for user ID: ${userId}`);
  const userDetails = await sdk.ok(sdk.user(userId, 'id,group_ids'));
  return (userDetails?.group_ids || []).map((g: any) => String(g));
}

export async function isUserAuthorized(sdk: any, userId: string, identifier: string): Promise<boolean> {
  const configData = await getWorkflows(sdk);
  // Support both new workflows (by ID or route) and legacy admin pages
  const workflow = (configData.workflows || []).find((w: any) => w.id === identifier || w.route === identifier);
  const page = (configData.adminPages || []).find((p: any) => p.route === identifier);
  const item = workflow || page;

  if (!item) return false;
  if (!item.authorized_groups || item.authorized_groups.length === 0) return true;

  const userGroups = await getUserGroups(sdk, userId);
  return item.authorized_groups.some((groupId: string) => userGroups.includes(groupId));
}
