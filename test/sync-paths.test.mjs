import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createProfiles, rebaseSettings } from '../lib/profiles.ts';

test('sync rebases package and resource references between different directory depths', () => {
  const home = mkdtempSync(join(tmpdir(), 'pi-sync-paths-'));
  try {
    const main = join(home, '.pi/agent');
    const work = join(home, '.pi-work');
    mkdirSync(main, { recursive: true });
    mkdirSync(work);
    writeFileSync(join(home, '.pi/profiles.json'), JSON.stringify({ profiles: { work } }));
    const original = {
      packages: ['../../projects/plugin', 'npm:@example/plugin', 'git:github.com/example/plugin', { source: './local-package', extensions: ['extensions/*.ts'] }],
      extensions: ['-builtin:mcp', './custom.ts'],
      skills: ['./skills', '!./skills/private/**'],
      prompts: ['~/shared/prompts', '/shared/prompts', '+./prompts'],
      themes: ['./themes/*.json'],
    };
    writeFileSync(join(main, 'settings.json'), JSON.stringify(original));
    writeFileSync(join(work, 'settings.json'), '{}');
    const service = createProfiles(home, main, home);
    const preview = service.sync(service.find('main'), service.find('work'), true);
    assert.match(preview, /\.\.\/projects\/plugin/);
    assert.equal(readFileSync(join(work, 'settings.json'), 'utf8'), '{}');
    service.sync(service.find('main'), service.find('work'), false);
    const copied = JSON.parse(readFileSync(join(work, 'settings.json'), 'utf8'));
    assert.equal(resolve(work, copied.packages[0]), resolve(main, original.packages[0]));
    assert.equal(resolve(work, copied.packages[3].source), resolve(main, original.packages[3].source));
    assert.deepEqual(copied.packages[3].extensions, original.packages[3].extensions);
    assert.equal(copied.packages[1], original.packages[1]);
    assert.equal(copied.packages[2], original.packages[2]);
    assert.equal(copied.extensions[0], '-builtin:mcp');
    assert.equal(resolve(work, copied.extensions[1]), resolve(main, original.extensions[1]));
    assert.equal(resolve(work, copied.skills[1].slice(1)), resolve(main, original.skills[1].slice(1)));
    assert.equal(copied.prompts[0], original.prompts[0]);
    assert.equal(copied.prompts[1], original.prompts[1]);
    assert.equal(resolve(work, copied.prompts[2].slice(1)), resolve(main, original.prompts[2].slice(1)));
    const roundTrip = rebaseSettings(copied, work, main);
    assert.equal(resolve(main, roundTrip.packages[3].source), resolve(main, original.packages[3].source));
    assert.equal(resolve(main, roundTrip.skills[0]), resolve(main, original.skills[0]));
    assert.equal(original.packages[3].source, './local-package');
  } finally { rmSync(home, { recursive: true, force: true }); }
});
