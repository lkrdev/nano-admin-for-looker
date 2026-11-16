import path from 'path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveTemplateBackendPath, resolveTemplateSubpath } from '../actions/execute_workflow';
import { getTemplateManifest } from '../actions/get_workflows';

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

test('resolveTemplateSubpath & getTemplateManifest — rejects invalid/traversal template IDs', () => {
  const invalidTemplates: unknown[] = [
    '',
    null,
    undefined,
    '../../../tmp/malicious',
    '..',
    '../..',
    'Invalid_Caps',
    'has.dot',
    'a'.repeat(51)
  ];

  for (const badTemplate of invalidTemplates) {
    assert.throws(
      () => resolveTemplateSubpath(badTemplate, 'manifest.json'),
      (err: any) => err?.status === 400 && /invalid template identifier/i.test(err?.message || '')
    );
    assert.deepEqual(getTemplateManifest(badTemplate), {});
  }

  const validManifestPath = resolveTemplateSubpath('user-management', 'manifest.json');
  assert.ok(validManifestPath.endsWith(path.join('workflow-templates', 'user-management', 'manifest.json')));
});
