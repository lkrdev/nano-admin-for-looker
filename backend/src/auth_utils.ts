import yaml from 'js-yaml';
import * as https from 'https';
import { URL } from 'url';

let cachedWorkflows: any = null;
let cacheExpiration = 0;

export function parseYaml(yamlStr: string): any {
  try {
    return yaml.load(yamlStr) || {};
  } catch (e) {
    console.error('Error parsing YAML configuration:', e);
    return {};
  }
}

export async function getWorkflows(sdk: any): Promise<any> {
  const cacheDurationMs = parseInt(process.env.ADMIN_PAGES_CACHE_DURATION_MS || '0', 10);
  const now = Date.now();

  if (cachedWorkflows && now < cacheExpiration) {
    return cachedWorkflows;
  }

  console.log('Fetching index.md from project nano_admin...');
  const baseUrl = sdk.authSession.settings.base_url;
  const authProps = await sdk.authSession.authenticate({ headers: {} });
  const authHeaders = authProps.headers;

  try {
    const url = `${baseUrl}/api/4.0/projects/nano_admin/file/content?file_path=index.md`;
    const text = await fetchRawText(url, authHeaders);
    const parsed = parseYaml(text) || {};
    parsed.indexFileLoaded = true;
    cachedWorkflows = parsed;
    cacheExpiration = now + cacheDurationMs;
    return parsed;
  } catch (err: any) {
    console.warn('Failed to load index.md from project nano_admin:', err.message || err);
    const fallback = { workflows: [], indexFileLoaded: false };
    cachedWorkflows = fallback;
    cacheExpiration = now + cacheDurationMs;
    return fallback;
  }
}

export async function getUserGroups(sdk: any, userId: string): Promise<string[]> {
  console.log(`Fetching group memberships for user ID: ${userId}`);
  const userDetails = await sdk.ok(sdk.user(userId, 'id,group_ids'));
  return (userDetails?.group_ids || []).map((g: any) => String(g));
}

export async function isUserAuthorized(sdk: any, userId: string, identifier: string): Promise<boolean> {
  const configData = await getWorkflows(sdk);
  const cleanId = identifier.replace(/^\//, '');
  const workflow = (configData.workflows || []).find((w: any) => w.id === identifier || w.id === cleanId);

  if (!workflow) return false;
  if (!workflow.authorized_groups || workflow.authorized_groups.length === 0) return true;

  const userGroups = await getUserGroups(sdk, userId);
  return workflow.authorized_groups.some((groupId: string) => userGroups.includes(groupId));
}

function fetchRawText(urlStr: string, headers: any): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const options = {
      method: 'GET',
      headers: headers,
      rejectUnauthorized: false
    };

    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP Error ${res.statusCode}: ${data}`));
        } else {
          resolve(data);
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.end();
  });
}
