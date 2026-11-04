import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProfiles } from '../lib/profiles.ts';

function fixture(callback) {
  const home = mkdtempSync(join(tmpdir(), 'pi-profiles-safety-'));
  try {
    const main = join(home, '.pi/agent');
    mkdirSync(main, { recursive: true });
    writeFileSync(join(main, 'settings.json'), '{}');
    const registry = join(home, '.pi/profiles.json');
    const configure = (profiles) => writeFileSync(registry, JSON.stringify({ profiles }));
    const service = createProfiles(home, main, join(home, 'extension-source'));
    callback({ home, main, registry, configure, service });
  } finally { rmSync(home, { recursive: true, force: true }); }
}

test('refuse home, filesystem root, ancestor directories and extension source deletion', () => {
  fixture(({ home, main, configure, service }) => {
    const source = join(home, 'extension-source');
    mkdirSync(source);
    writeFileSync(join(source, 'settings.json'), '{}');
    configure({ house: home, filesystem: '/', parent: join(home, '.pi'), source });
    for (const name of ['house', 'filesystem', 'parent', 'source']) {
      assert.throws(() => service.remove(service.find(name)), /protected/);
    }
    assert.ok(existsSync(main));
  });
});

test('refuse directories containing another profile and unrecognized directories', () => {
  fixture(({ home, configure, service }) => {
    const parent = join(home, 'nested');
    const child = join(parent, 'child');
    mkdirSync(child, { recursive: true });
    writeFileSync(join(parent, 'settings.json'), '{}');
    configure({ parent, child });
    assert.throws(() => service.remove(service.find('parent')), /containing another profile/);
    assert.throws(() => service.remove(service.find('child')), /regular settings/);
    assert.ok(existsSync(child));
  });
});

test('reject malformed registries and invalid mappings', () => {
  fixture(({ registry, configure, service }) => {
    for (const contents of ['{', 'null', '[]', '{"profiles": []}']) {
      writeFileSync(registry, contents);
      assert.throws(() => service.list());
    }
    for (const mapping of [{ work: '../relative' }, { '../escape': '/tmp' }, { main: '/tmp' }, { work: 42 }]) {
      configure(mapping);
      assert.throws(() => service.list());
    }
  });
});

test('refuse source symlinks and dangling destination settings symlinks', () => {
  fixture(({ home, main, service }) => {
    const target = service.create('target');
    const dest = join(target.directory, 'settings.json');
    rmSync(dest);
    symlinkSync(join(home, 'missing'), dest);
    assert.throws(() => service.sync(service.find('main'), target, false), /symlinked settings/);
    assert.ok(!existsSync(join(home, 'missing')));
    rmSync(dest);
    writeFileSync(dest, '{}');
    rmSync(join(main, 'settings.json'));
    symlinkSync(dest, join(main, 'settings.json'));
    assert.throws(() => service.sync(service.find('main'), target, false), /non-symlink/);
    assert.equal(readFileSync(dest, 'utf8'), '{}');
  });
});

test('revalidate registry mappings before deleting', () => {
  fixture(({ home, configure, service }) => {
    const original = service.create('original');
    const entry = { ...original, name: 'alias' };
    configure({ alias: original.directory });
    const other = join(home, 'other');
    mkdirSync(other);
    writeFileSync(join(other, 'settings.json'), '{}');
    configure({ alias: other });
    assert.throws(() => service.remove(entry), /mapping changed/);
    assert.ok(existsSync(original.directory));
    assert.ok(existsSync(other));
  });
});

test('reject symlinked named-profile root', () => {
  fixture(({ home, service }) => {
    const outside = join(home, 'outside');
    mkdirSync(outside);
    symlinkSync(outside, join(home, '.pi/profiles'));
    assert.throws(() => service.create('work'), /symlinked named-profile root/);
    assert.ok(!existsSync(join(outside, 'work')));
  });
});
