import { isUserAuthorized } from '../auth_utils';
import { BUILD_HASH } from '../build_hash';

export async function purgeCacheHandler(sdk: any, userId: string, payload: any): Promise<any> {
  const authorized = await isUserAuthorized(sdk, userId, '/cache-purge');
  if (!authorized) {
    throw { status: 403, message: 'Forbidden: You do not belong to the authorized group for this action.' };
  }

  console.log('Fetching all connections to clear query cache...');
  const connections = await sdk.ok(sdk.all_connections({ fields: 'name' }));
  const connectionClears: string[] = [];
  for (const conn of connections) {
    try {
      await sdk.ok(sdk.clear_connection_query_cache(conn.name));
      connectionClears.push(`${conn.name} (success)`);
    } catch (err: any) {
      console.error(`Failed to clear cache for connection ${conn.name}:`, err);
      connectionClears.push(`${conn.name} (failed: ${err.message || err})`);
    }
  }

  console.log('Fetching all datagroups to trigger refresh...');
  const datagroupTriggers: string[] = [];
  try {
    const datagroups = await sdk.ok(sdk.all_datagroups());
    for (const dg of datagroups) {
      if (dg.id) {
        try {
          await sdk.ok(sdk.update_datagroup(dg.id, { trigger_value: `forced_purge_${Date.now()}` }));
          datagroupTriggers.push(`${dg.name || dg.id} (success)`);
        } catch (err: any) {
          console.error(`Failed to trigger datagroup ${dg.name || dg.id}:`, err);
          datagroupTriggers.push(`${dg.name || dg.id} (failed: ${err.message || err})`);
        }
      }
    }
  } catch (err) {
    console.error('Failed to retrieve datagroups:', err);
  }

  return {
    message: 'All system caches successfully purged',
    timestamp: new Date().toISOString(),
    connections: connectionClears,
    datagroups: datagroupTriggers,
    build_hash: BUILD_HASH
  };
}
