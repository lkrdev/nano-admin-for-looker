import path from 'path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveTemplateBackendPath } from '../actions/execute_workflow';

test('resolveTemplateBackendPath — rejects path traversal and invalid template IDs with 400', () => {
  const invalidTemplates: unknown[] = [
    '',
    null,
    undefined,
    123,
    '../../../tmp/malicious',
    '../auth_utils',
    'crud/../../evil',
    'Invalid_Caps',
    'has.dot',
    'has_underscore',
    'a'.repeat(51)
  ];

  for (const badTemplate of invalidTemplates) {
    assert.throws(
      () => resolveTemplateBackendPath(badTemplate, 'wf_1'),
      (err: any) => err?.status === 400 && /invalid template identifier/i.test(err?.message || '')
    );
  }
});

test('resolveTemplateBackendPath — accepts valid template IDs up to 50 chars within workflow-templates', () => {
  const validTemplates = [
    'crud',
    'user-management',
    'group-owners',
    'workflow-groups-manager',
    'kill-queries',
    'limited-system-activity',
    'a'.repeat(50)
  ];

  for (const templateId of validTemplates) {
    const resolved = resolveTemplateBackendPath(templateId, 'wf_1');
    assert.ok(resolved.endsWith(path.join('workflow-templates', templateId, 'backend')));
  }
});
