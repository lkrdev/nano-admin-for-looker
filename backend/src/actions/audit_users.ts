import { isUserAuthorized } from '../auth_utils';
import { BUILD_HASH } from '../build_hash';

export async function auditUsersHandler(sdk: any, userId: string, payload: any): Promise<any> {
  const authorized = await isUserAuthorized(sdk, userId, '/user-audit');
  if (!authorized) {
    throw { status: 403, message: 'Forbidden: You do not belong to the authorized group for this action.' };
  }

  console.log('Querying users via Looker SDK...');
  const usersData = await sdk.ok(sdk.all_users({
    fields: 'id,first_name,last_name,email,is_disabled,roles'
  }));

  const totalUsers = usersData.length;
  const disabledUsers = usersData.filter((u: any) => u.is_disabled).length;
  const activeUsers = totalUsers - disabledUsers;

  return {
    message: 'User audit completed successfully',
    timestamp: new Date().toISOString(),
    metrics: {
      totalUsers,
      activeUsers,
      disabledUsers
    },
    users: usersData,
    build_hash: BUILD_HASH
  };
}
