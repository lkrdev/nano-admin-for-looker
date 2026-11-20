import test from 'node:test';
import assert from 'node:assert/strict';

import { wrapLookerSDKWithLogging } from '../looker_logging_sdk';

test('looker_logging_sdk redacts challenge values, passwords, and secrets while preserving IDs and status in response logs', async () => {
  const logs: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args: any[]) => logs.push(args.map(String).join(' '));
  console.error = (...args: any[]) => logs.push(args.map(String).join(' '));

  try {
    const rawSdk = {
      ok: async (p: any) => {
        const r = await p;
        return r.value;
      },
      set_user_attribute_user_value: async () => ({
        ok: true,
        statusCode: 200,
        value: { user_id: '2016', value: 'secret-token' }
      }),
      update_connection: async () => ({
        ok: true,
        statusCode: 200,
        value: { name: 'analytics_warehouse' }
      })
    };

    const sdk = wrapLookerSDKWithLogging(rawSdk, {
      instanceHost: 'demo.looker.com',
      userId: '2016',
      action: 'test'
    });

    await sdk.ok(
      sdk.set_user_attribute_user_value('2016', '42', {
        value: 'demo.looker.com|2016|1731798924000|a1b2c3d4e5f60718|deadbeefhmac'
      })
    );

    await sdk.ok(
      (sdk as any).update_connection('analytics_warehouse', {
        host: 'db.example.com',
        password: 'SuperSecretDbPassword123!',
        certificate: '---CERT---',
        client_secret: 'my-secret'
      })
    );

    const joined = logs.join('\n');
    assert.ok(!joined.includes('deadbeefhmac'), 'challenge HMAC token must not appear in logs');
    assert.ok(!joined.includes('SuperSecretDbPassword123!'), 'connection password must not appear in logs');
    assert.ok(!joined.includes('---CERT---'), 'certificate must not appear in logs');
    assert.ok(!joined.includes('my-secret'), 'client_secret must not appear in logs');
    assert.ok(joined.includes('[REDACTED]'));
    assert.ok(joined.includes('status=200'));
    assert.ok(joined.includes('Object id: "2016"'));
    assert.ok(joined.includes('Object id: "analytics_warehouse"'));
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
});
