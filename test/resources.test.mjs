import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, lstatSync, existsSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createProfiles } from '../lib/profiles.ts';

function fixture(callback) {
  const home = mkdtempSync(join(tmpdir(), 'pi-resource-sync-'));
  try {
    const source = join(home, '.pi/agent'), target = join(home, '.pi-work');
    mkdirSync(source, { recursive: true }); mkdirSync(target);
    writeFileSync(join(home, '.pi/profiles.json'), JSON.stringify({ profiles: { work: target } }));
    writeFileSync(join(source, 'settings.json'), JSON.stringify({ prompts: ['./prompts'], skills: ['./skills'], themes: ['./themes/*.json'], packages: ['../../projects/plugin'] }));
    writeFileSync(join(target, 'settings.json'), '{}');
    const save = (base, path, content, mode = 0o600) => {
      const file = join(base, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, content, { mode }); return file;
    };
    const service = createProfiles(home, source, home);
    const sync = (dryRun = false) => service.sync(service.find('main'), service.find('work'), dryRun);
    callback({ home, source, target, save, sync });
  } finally { rmSync(home, { recursive: true, force: true }); }
}

test('local sync copies resources, overwrites matches, retains extras and skill script permissions', () => fixture(({ source, target, save, sync }) => {
  save(source, 'prompts/explain.md', 'new prompt');
  save(target, 'prompts/explain.md', 'old prompt');
  save(target, 'prompts/target-only.md', 'retain');
  save(source, 'skills/example/SKILL.md', 'skill');
  save(source, 'skills/example/run.sh', '#!/bin/sh\necho hello\n', 0o700);
  save(source, 'themes/example.json', '{}');
  save(target, 'auth.json', 'untouched');
  const preview = sync(true);
  assert.match(preview, /replace prompts\/explain.md/);
  assert.match(preview, /add skills\/example\/SKILL.md/);
  assert.equal(readFileSync(join(target, 'prompts/explain.md'), 'utf8'), 'old prompt');
  assert.ok(!existsSync(join(target, 'skills')));
  sync();
  assert.equal(readFileSync(join(target, 'prompts/explain.md'), 'utf8'), 'new prompt');
  assert.equal(readFileSync(join(target, 'prompts/target-only.md'), 'utf8'), 'retain');
  assert.equal(readFileSync(join(target, 'skills/example/SKILL.md'), 'utf8'), 'skill');
  assert.ok(lstatSync(join(target, 'skills/example/run.sh')).mode & 0o100);
  assert.equal(readFileSync(join(target, 'auth.json'), 'utf8'), 'untouched');
  const settings = JSON.parse(readFileSync(join(target, 'settings.json'), 'utf8'));
  assert.equal(resolve(target, settings.prompts[0]), join(target, 'prompts'));
  assert.equal(resolve(target, settings.skills[0]), join(target, 'skills'));
  assert.equal(resolve(target, settings.themes[0]), join(target, 'themes/*.json'));
  assert.equal(resolve(target, settings.packages[0]), resolve(source, '../../projects/plugin'));
}));

test('keybindings sync adds and replaces the entire file with a write-free preview', () => fixture(({ source, target, save, sync }) => {
  const bindings = JSON.stringify({ 'tui.altScreen.top': 'home', 'tui.altScreen.bottom': 'end' });
  save(source, 'keybindings.json', bindings);
  assert.match(sync(true), /add keybindings\.json/);
  assert.ok(!existsSync(join(target, 'keybindings.json')));
  sync();
  assert.equal(readFileSync(join(target, 'keybindings.json'), 'utf8'), bindings);
  save(target, 'keybindings.json', '{"targetOnly":"ctrl+x"}');
  assert.match(sync(true), /replace keybindings\.json/);
  assert.equal(readFileSync(join(target, 'keybindings.json'), 'utf8'), '{"targetOnly":"ctrl+x"}');
  sync();
  assert.equal(readFileSync(join(target, 'keybindings.json'), 'utf8'), bindings);
}));

test('missing and symlinked source keybindings retain target bindings', () => fixture(({ home, source, target, save, sync }) => {
  save(target, 'keybindings.json', '{}');
  sync();
  assert.equal(readFileSync(join(target, 'keybindings.json'), 'utf8'), '{}');
  const outside = save(home, 'outside.json', '{"external":"ctrl+x"}');
  symlinkSync(outside, join(source, 'keybindings.json'));
  assert.match(sync(true), /Skipped resource paths[^\n]*keybindings\.json/);
  sync();
  assert.equal(readFileSync(join(target, 'keybindings.json'), 'utf8'), '{}');
}));

for (const kind of ['symlink', 'directory']) {
  test(`keybindings destination ${kind} conflicts fail preflight without writes`, () => fixture(({ home, source, target, save, sync }) => {
    save(source, 'keybindings.json', '{}');
    save(source, 'prompts/example.md', 'unchanged');
    const outside = save(home, 'outside.json', '{}');
    if (kind === 'symlink') symlinkSync(outside, join(target, 'keybindings.json'));
    else mkdirSync(join(target, 'keybindings.json'));
    for (const dryRun of [true, false]) assert.throws(() => sync(dryRun), /destination conflict/);
    assert.equal(readFileSync(join(target, 'settings.json'), 'utf8'), '{}');
    assert.equal(readFileSync(outside, 'utf8'), '{}');
    assert.ok(!existsSync(join(target, 'prompts')));
  }));
}

test('source keybindings directory fails before copying resources', () => fixture(({ source, target, save, sync }) => {
  save(source, 'prompts/example.md', 'unchanged');
  mkdirSync(join(source, 'keybindings.json'));
  assert.throws(() => sync(), /keybindings\.json must be a regular file/);
  assert.equal(readFileSync(join(target, 'settings.json'), 'utf8'), '{}');
  assert.ok(!existsSync(join(target, 'prompts')));
}));

test('source symlinks and dependency directories are skipped and reported', () => fixture(({ home, source, target, save, sync }) => {
  const external = save(home, 'external.md', 'do not copy');
  mkdirSync(join(source, 'prompts'));
  symlinkSync(external, join(source, 'prompts/link.md'));
  save(source, 'skills/example/node_modules/dependency.js', 'skip');
  const preview = sync(true);
  assert.match(preview, /prompts\/link.md/);
  assert.match(preview, /node_modules/);
  sync();
  assert.ok(!existsSync(join(target, 'prompts/link.md')));
  assert.ok(!existsSync(join(target, 'skills/example/node_modules')));
}));

test('destination symlink conflicts fail before settings or resource changes', () => fixture(({ home, source, target, save, sync }) => {
  save(source, 'prompts/first.md', 'first');
  save(source, 'themes/example.json', '{}');
  const outside = join(home, 'outside'); mkdirSync(outside);
  symlinkSync(outside, join(target, 'themes'));
  assert.throws(() => sync(), /destination conflict/);
  assert.equal(readFileSync(join(target, 'settings.json'), 'utf8'), '{}');
  assert.ok(!existsSync(join(target, 'prompts')));
  assert.ok(!existsSync(join(outside, 'example.json')));
}));
