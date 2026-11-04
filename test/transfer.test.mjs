import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProfiles } from '../lib/profiles.ts';
import { buildExport, importBundle, parseExportArguments, previewBundle, readBundle, restoreGuide, splitArguments, validateBundle, writeBundle } from '../lib/transfer.ts';

function fixture(callback) {
  const home = mkdtempSync(join(tmpdir(), 'pi-transfer-test-'));
  try {
    const source = join(home, '.pi/agent');
    mkdirSync(source, { recursive: true });
    const service = createProfiles(home, source, join(home, 'extension'));
    const save = (path, contents) => {
      const full = join(source, path);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, contents, { mode: 0o600 });
      return full;
    };
    save('settings.json', JSON.stringify({ theme: 'system/system', editorPaddingX: 1, deviceId: 'PRIVATE_DEVICE', sessionDir: '/PRIVATE_SESSION', httpProxy: 'PRIVATE_PROXY', shellCommandPrefix: 'PRIVATE_COMMAND', packages: ['npm:@example/tools@1.0.0', 'git:github.com/example/tools@v1', 'https://user:PRIVATE_PASSWORD@example.com/repo'], skills: ['/outside/skills'] }));
    save('auth.json', 'PRIVATE_AUTH');
    save('mcp.json', JSON.stringify({ mcpServers: { docs: { url: 'https://PRIVATE_ENDPOINT', headers: { Authorization: 'PRIVATE_BEARER' }, env: { API_KEY: 'PRIVATE_KEY' }, args: ['PRIVATE_ARGUMENT'] } } }));
    save('prompts/explain.md', 'Explain in plain language.');
    save('skills/example/SKILL.md', 'A local skill.');
    save('themes/custom.json', '{"name":"custom"}');
    callback({ home, source, service, save });
  } finally { rmSync(home, { recursive: true, force: true }); }
}

test('export includes local text resources and portable preferences, not credentials/config', () => fixture(({ source }) => {
  const bundle = buildExport({ directory: source });
  assert.deepEqual(bundle.settings, { theme: 'system/system', editorPaddingX: 1 });
  assert.equal(bundle.files.length, 3);
  assert.deepEqual(bundle.mcps, ['docs']);
  assert.equal(bundle.packages.length, 2);
  assert.ok(!JSON.stringify(bundle).includes('PRIVATE_'));
  assert.match(bundle.notes.join('\n'), /\/outside\/skills/);
  assert.match(previewBundle(bundle), /prompts\/explain.md/);
}));

test('report symlinks and executable resources without reading them', () => fixture(({ home, source, save }) => {
  const outside = join(home, 'outside');
  writeFileSync(outside, 'OUTSIDE_SECRET');
  symlinkSync(outside, join(source, 'prompts/linked.md'));
  chmodSync(save('skills/example/run.md', 'EXECUTABLE_SECRET'), 0o700);
  const bundle = buildExport({ directory: source });
  assert.ok(!JSON.stringify(bundle).includes('OUTSIDE_SECRET'));
  assert.ok(!JSON.stringify(bundle).includes('EXECUTABLE_SECRET'));
  assert.match(bundle.notes.join('\n'), /Symlink not followed/);
  assert.match(bundle.notes.join('\n'), /executable/);
}));

test('round trip creates a new profile and never installs packages or copies auth', () => fixture(({ home, source, service }) => {
  const bundle = buildExport({ directory: source });
  const file = join(home, 'bundle.json');
  writeBundle(file, bundle);
  const before = readFileSync(join(source, 'settings.json'), 'utf8');
  const imported = importBundle(service, readBundle(file), 'restored');
  assert.equal(readFileSync(join(imported.directory, 'prompts/explain.md'), 'utf8'), 'Explain in plain language.');
  assert.deepEqual(JSON.parse(readFileSync(join(imported.directory, 'settings.json'), 'utf8')), bundle.settings);
  assert.ok(!existsSync(join(imported.directory, 'auth.json')));
  assert.ok(!existsSync(join(imported.directory, 'mcp.json')));
  assert.ok(!existsSync(join(imported.directory, 'node_modules')));
  assert.match(readFileSync(join(imported.directory, 'RESTORE.txt'), 'utf8'), /install 'npm:@example\/tools@1.0.0'/);
  assert.equal(readFileSync(join(source, 'settings.json'), 'utf8'), before);
  assert.throws(() => importBundle(service, bundle, 'main'), /already exists/);
  assert.throws(() => importBundle(service, bundle, 'restored'), /already exists/);
  assert.throws(() => writeBundle(file, bundle), /EEXIST/);
}));

test('reject traversal, executable and credential paths, duplicate paths, unsafe settings', () => fixture(({ source }) => {
  const bundle = buildExport({ directory: source });
  for (const path of ['../auth.json', '/tmp/escape.md', 'prompts/../../auth.json', 'prompts\\escape.md', 'extensions/code.ts', 'auth.json', 'skills/x/run.sh', 'skills/.hidden/SKILL.md']) {
    assert.throws(() => validateBundle({ ...bundle, files: [{ path, content: 'bad' }] }), /unsafe resource/);
  }
  assert.throws(() => validateBundle({ ...bundle, files: [bundle.files[0], bundle.files[0]] }), /duplicate/);
  assert.throws(() => validateBundle({ ...bundle, settings: { packages: ['npm:bad'] } }), /Unsupported/);
  assert.throws(() => validateBundle({ ...bundle, settings: { shellCommandPrefix: 'bad' } }), /Unsupported/);
  assert.throws(() => validateBundle({ ...bundle, version: 999 }), /unsupported/);
  assert.throws(() => validateBundle({ ...bundle, packages: ['npm:foo;bad'] }), /checklist/);
}));

test('malformed input and oversized bundles do not create a profile', () => fixture(({ home, source, service }) => {
  const file = join(home, 'bad.json');
  writeFileSync(file, '{');
  assert.throws(() => readBundle(file));
  const bundle = buildExport({ directory: source });
  assert.throws(() => importBundle(service, { ...bundle, files: [{ path: '../escape', content: '' }] }, 'bad'));
  assert.ok(!existsSync(join(home, '.pi/profiles/bad')));
  assert.throws(() => validateBundle({ ...bundle, files: Array(1001).fill(bundle.files[0]) }), /exceeds/);
  assert.throws(() => validateBundle({ ...bundle, files: [{ path: 'prompts/big.md', content: 'x'.repeat(11 * 1024 * 1024) }] }), /exceeds/);
}));

test('restoration guide contains only generated commands and supports quoted file arguments', () => fixture(({ source }) => {
  const bundle = buildExport({ directory: source });
  const guide = restoreGuide(bundle, '/new/profile');
  assert.match(guide, /MCP docs/);
  assert.match(guide, /mcp add --help/);
  assert.ok(!guide.includes('PRIVATE_'));
  assert.deepEqual(splitArguments('import "/path with spaces/bundle.json" restored --dry-run'), ['import', '/path with spaces/bundle.json', 'restored', '--dry-run']);
  assert.throws(() => splitArguments('import "unfinished'), /Unclosed/);
}));

test('export path option supports either order, equals syntax, and positional compatibility', () => {
  assert.deepEqual(parseExportArguments(['main']), { name: 'main', output: undefined });
  for (const args of [['main', '--path', '/tmp/export.json'], ['--path', '/tmp/export.json', 'main'], ['main', '--path=/tmp/export.json'], ['main', '/tmp/export.json']]) {
    assert.deepEqual(parseExportArguments(args), { name: 'main', output: '/tmp/export.json' });
  }
  assert.deepEqual(parseExportArguments(splitArguments('main --path "/path with spaces"')), { name: 'main', output: '/path with spaces' });
  for (const args of [[], ['main', '--path'], ['main', '--path='], ['main', '--path', '--unknown'], ['main', '--unknown'], ['main', 'file', '--path', 'other'], ['main', '--path', 'one', '--path', 'two']]) {
    assert.throws(() => parseExportArguments(args));
  }
});
