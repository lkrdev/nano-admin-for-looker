import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import https from 'https';
import { EventEmitter } from 'events';

import { getWorkflowsHandler } from '../actions/get_workflows';

test('getWorkflowsHandler strips authorized_groups and minimizes fields for unauthorized and authorized workflows', async () => {
  const indexMd = `workflows:
  - id: restricted-wf
    label: Restricted Workflow
    description: Admin only workflow
    template: crud
    authorized_groups:
      dev.looker.app: ["99"]
      prod.looker.app: ["1"]
    parameters:
      target_object: connections
      secret_hint: internal-only
    extra_custom_field: should-not-leak
  - id: allowed-wf
    label: Allowed Workflow
    description: User workflow
    template: kill-queries
    authorized_groups:
      dev.looker.app: ["10"]
    parameters:
      user_id_limitation:
        mode: self
    extra_custom_field: should-not-leak`;

  const reqMock = mock.method(https, 'request', (_url: any, _opts: any, cb: any) => {
    const res = new EventEmitter() as any;
    res.statusCode = 200;
    const req = new EventEmitter() as any;
    req.end = () => {
      cb(res);
      res.emit('data', indexMd);
      res.emit('end');
    };
    return req;
  });

  try {
    const mockSdk: any = {
      ok: async (val: any) => await val,
      authSession: {
        settings: { base_url: 'https://dev.looker.app' },
        authenticate: async () => ({ headers: { Authorization: 'Bearer test' } })
      },
      user: async () => ({ id: '100', group_ids: ['10'] })
    };

    const res = await getWorkflowsHandler(mockSdk, '100', {}, { instanceHost: 'dev.looker.app' });
    assert.equal(res.workflows.length, 2);

    const restricted = res.workflows.find((w: any) => w.id === 'restricted-wf');
    assert.deepEqual(restricted, {
      id: 'restricted-wf',
      label: 'Restricted Workflow',
      description: 'Admin only workflow',
      mount_type: 'page',
      authorized: false
    });

    const allowed = res.workflows.find((w: any) => w.id === 'allowed-wf');
    assert.deepEqual(allowed, {
      id: 'allowed-wf',
      label: 'Allowed Workflow',
      description: 'User workflow',
      template: 'kill-queries',
      mount_type: 'page',
      parameters: { user_id_limitation: { mode: 'self' } },
      authorized: true
    });
  } finally {
    reqMock.mock.restore();
  }
});
