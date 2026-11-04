import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProfiles } from '../lib/profiles.ts';
import { importBundle } from '../lib/transfer.ts';

test('failed import removes only its newly created profile', () => {
  const home = mkdtempSync(join(tmpdir(), 'pi-import-rollback-'));
  try {
    const main = join(home, '.pi/agent');
    mkdirSync(main, { recursive: true });
    writeFileSync(join(main, 'settings.json'), '{}');
    const service = createProfiles(home, main, home);
    // Each path is permitted, but the second cannot be created inside a file.
    const bundle = {
      format: 'pi-profiles', version: 1, settings: {}, packages: [], mcps: [], notes: [],
      files: [{ path: 'skills/example.md', content: 'text' }, { path: 'skills/example.md/nested.md', content: 'text' }],
    };
    assert.throws(() => importBundle(service, bundle, 'broken'));
    assert.ok(!existsSync(join(home, '.pi/profiles/broken')));
    assert.ok(existsSync(join(main, 'settings.json')));
  } finally { rmSync(home, { recursive: true, force: true }); }
});
