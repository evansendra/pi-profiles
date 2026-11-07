import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createJiti } from 'jiti';

test('same-process extension reload refreshes helper code and syncs resources with correct paths', async () => {
  const home = mkdtempSync(join(tmpdir(), 'pi-reload-regression-'));
  const originalHome = process.env.HOME;
  try {
    process.env.HOME = home;
    const source = join(home, '.pi/agent'), target = join(home, '.pi-work');
    const pkg = join(home, 'package');
    for (const directory of [source, target, join(pkg, 'lib'), join(pkg, 'extensions'), join(source, 'prompts')]) mkdirSync(directory, { recursive: true });
    writeFileSync(join(home, '.pi/profiles.json'), JSON.stringify({ profiles: { work: target } }));
    writeFileSync(join(source, 'settings.json'), JSON.stringify({ packages: ['../../projects/plugin'] }));
    writeFileSync(join(target, 'settings.json'), '{}');
    writeFileSync(join(source, 'prompts/example.md'), 'Copy this prompt.');
    writeFileSync(join(source, 'keybindings.json'), '{"tui.altScreen.top":"home","tui.altScreen.bottom":"end"}');
    writeFileSync(join(pkg, 'package.json'), '{"name":"test-profile-package","type":"module"}');
    writeFileSync(join(pkg, 'host.ts'), `export const getAgentDir = () => ${JSON.stringify(source)};`);
    for (const file of ['extensions/profile.ts', 'lib/profiles.ts', 'lib/resources.ts', 'lib/transfer.ts']) {
      writeFileSync(join(pkg, file), readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
    }
    const helper = join(pkg, 'lib/profiles.ts');
    const original = readFileSync(helper, 'utf8');
    const marker = '=> `PI_CODING_AGENT_DIR=';
    assert.ok(original.includes(marker));
    const load = async () => {
      const jiti = createJiti(import.meta.url, { moduleCache: false, alias: { '@earendil-works/pi-coding-agent': join(pkg, 'host.ts') } });
      const factory = await jiti.import(join(pkg, 'extensions/profile.ts'), { default: true });
      let command;
      factory({ registerCommand: (name, value) => { assert.equal(name, 'profiles'); command = value; } });
      return command;
    };
    let message;
    const ctx = { cwd: home, hasUI: true, ui: { notify: (text) => { message = text; } } };
    writeFileSync(helper, original.replace(marker, '=> `BEFORE PI_CODING_AGENT_DIR='));
    const first = await load();
    await first.handler('list', ctx);
    assert.match(message, /BEFORE PI_CODING_AGENT_DIR/);
    writeFileSync(helper, original.replace(marker, '=> `AFTER PI_CODING_AGENT_DIR='));
    const reloaded = await load();
    await reloaded.handler('list', ctx);
    assert.match(message, /AFTER PI_CODING_AGENT_DIR/);
    assert.ok(!message.includes('BEFORE PI_CODING_AGENT_DIR'));
    await reloaded.handler('main work', ctx);
    assert.match(message, /Synced settings and 2 resource files/);
    assert.equal(readFileSync(join(target, 'prompts/example.md'), 'utf8'), 'Copy this prompt.');
    assert.equal(readFileSync(join(target, 'keybindings.json'), 'utf8'), readFileSync(join(source, 'keybindings.json'), 'utf8'));
    const settings = JSON.parse(readFileSync(join(target, 'settings.json'), 'utf8'));
    assert.equal(resolve(target, settings.packages[0]), resolve(source, '../../projects/plugin'));
  } finally {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  }
});
