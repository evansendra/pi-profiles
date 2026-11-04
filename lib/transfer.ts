import { lstatSync, readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { TextDecoder } from 'node:util';

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 1000;
const ownPackage = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).name;
const decoder = new TextDecoder('utf-8', { fatal: true });
const booleanKeys = new Set(['hideThinkingBlock', 'showCacheMissNotices', 'showHardwareCursor', 'fullscreenCopyOnSelect', 'collapseChangelog', 'enableSkillCommands']);
const numberKeys = { editorPaddingX: [0, 3], outputPad: [0, 1], autocompleteMaxVisible: [3, 20], fullscreenWheelScrollLines: [1, 100] };
const enums = {
  theme: null, defaultProvider: null, defaultModel: null,
  defaultThinkingLevel: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
  steeringMode: ['all', 'one-at-a-time'], followUpMode: ['all', 'one-at-a-time'],
  doubleEscapeAction: ['tree', 'fork', 'none'], tuiMode: ['regular', 'fullscreen'],
  fullscreenExitOutput: ['transcript', 'resume-hint'], fullscreenScrollbar: ['auto', 'always', 'hidden'],
};
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const stat = (path) => { try { return lstatSync(path); } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; } };
const text = (value, max = 1000) => typeof value === 'string' && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
const portableSetting = (key, value) => booleanKeys.has(key) ? typeof value === 'boolean'
  : Object.hasOwn(numberKeys, key) ? Number.isInteger(value) && value >= numberKeys[key][0] && value <= numberKeys[key][1]
  : Object.hasOwn(enums, key) && text(value, 200) && (enums[key] ? enums[key].includes(value) : /^[a-zA-Z0-9_.:/-]+$/.test(value) && !value.startsWith('/') && !value.startsWith('~'));
const resourcePath = (path) => typeof path === 'string' && path.length < 500 && path.split('/').every((part) => /^[a-zA-Z0-9_ .@()-]+$/.test(part) && !['.', '..', ''].includes(part) && !part.startsWith('.'))
  && (/^prompts\/[^/]+\.md$/.test(path) || /^themes\/[^/]+\.json$/.test(path) || /^skills\/.+\.(md|txt|json)$/.test(path));
const packageSource = (source) => typeof source === 'string' && ( /^npm:(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+(?:@[a-zA-Z0-9.*^~+-]+)?$/.test(source)
  || /^git:github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+(?:@[a-zA-Z0-9_./-]+)?$/.test(source));
const mcpName = (name) => typeof name === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(name);
function readText(path) {
  const info = stat(path);
  if (!info?.isFile() || info.size > MAX_BYTES) throw new Error(`Expected a regular file no larger than 10 MiB: ${path}`);
  return decoder.decode(readFileSync(path));
}
function readObject(path) {
  const value = JSON.parse(readText(path));
  if (!object(value)) throw new Error(`Expected a JSON object: ${path}`);
  return value;
}

export function buildExport(entry) {
  if (!stat(entry.directory)?.isDirectory()) throw new Error('Export requires a regular, non-symlink profile directory.');
  const settings = stat(join(entry.directory, 'settings.json')) ? readObject(join(entry.directory, 'settings.json')) : {};
  const notes = ['Review all bundled text before sharing. Prompts and skills can contain private information or instructions to execute code. No automatic secret detection is performed.'];
  const portable = Object.fromEntries(Object.entries(settings).filter(([key, value]) => portableSetting(key, value)));
  const skipped = Object.keys(settings).filter((key) => !Object.hasOwn(portable, key));
  if (skipped.length) notes.push(`Settings not copied: ${skipped.join(', ')}`);
  const files = [];
  let bytes = 0;
  function walk(relative, depth = 0) {
    const path = join(entry.directory, relative);
    const info = stat(path);
    if (!info) return;
    if (info.isSymbolicLink()) { notes.push(`Symlink not followed: ${relative}`); return; }
    if (info.isDirectory()) {
      if (depth > 16) throw new Error('Resource nesting exceeds 16 levels.');
      for (const name of readdirSync(path).sort()) {
        if (name.startsWith('.') || name === 'node_modules') notes.push(`Hidden or dependency path not bundled: ${relative}/${name}`);
        else walk(`${relative}/${name}`, depth + 1);
      }
    } else if (info.isFile() && resourcePath(relative) && !(info.mode & 0o111)) {
      const content = readText(path);
      bytes += Buffer.byteLength(content);
      if (files.length >= MAX_FILES || bytes > MAX_BYTES) throw new Error('Export exceeds 1000 files or 10 MiB.');
      files.push({ path: relative, content });
    } else { notes.push(`Not bundled (unsupported or executable): ${relative}`); }
  }
  for (const root of ['prompts', 'skills', 'themes']) walk(root);
  const packages = [];
  for (const entry of Array.isArray(settings.packages) ? settings.packages : []) {
    const source = typeof entry === 'string' ? entry : entry?.source;
    if (source === `npm:${ownPackage}` || source?.startsWith?.(`npm:${ownPackage}@`)) {
      notes.push('The profile manager itself is already linked into the imported profile; no second installation is needed.');
    } else if (packageSource(source)) {
      packages.push(source);
      if (object(entry)) notes.push(`Package resource filters need manual recreation: ${source}`);
    } else if (typeof source === 'string' && /^(?:\/|~\/|[A-Za-z]:[\\/])/.test(source)) {
      notes.push(`Local package path not copied: ${JSON.stringify(source)}`);
    } else notes.push('A local or unsupported package source was omitted; review packages on the original machine.');
  }
  for (const key of ['extensions', 'skills', 'prompts', 'themes']) {
    for (const value of Array.isArray(settings[key]) ? settings[key] : []) {
      if (typeof value === 'string' && /^(?:[!+-])?(?:\/|~\/|[A-Za-z]:[\\/])/.test(value)) notes.push(`External path not copied (${key}): ${JSON.stringify(value)}`);
      else notes.push(`A ${key} resource declaration needs manual recreation; its value was not exported.`);
    }
  }
  const extensionRoot = join(entry.directory, 'extensions');
  if (stat(extensionRoot)) notes.push('Local extensions were not bundled. Reinstall or copy them manually after reviewing their code.');
  const mcps = [];
  const mcpPath = join(entry.directory, 'mcp.json');
  if (stat(mcpPath)?.isSymbolicLink()) notes.push('Symlink not followed: mcp.json; recreate MCP servers manually.');
  else if (stat(mcpPath)) {
    const servers = readObject(mcpPath).mcpServers;
    if (object(servers)) for (const name of Object.keys(servers)) {
      if (mcpName(name)) mcps.push(name);
      else notes.push('An MCP with an unsupported name was omitted.');
    }
  }
  for (const file of ['models.json', 'keybindings.json', 'AGENTS.md', 'SYSTEM.md', 'APPEND_SYSTEM.md']) {
    if (stat(join(entry.directory, file))) notes.push(`${file} was not bundled; review and restore manually if needed.`);
  }
  return validateBundle({ format: 'pi-profiles', version: 1, settings: portable, files, packages: [...new Set(packages)], mcps, notes });
}

export function validateBundle(bundle) {
  if (!object(bundle) || bundle.format !== 'pi-profiles' || bundle.version !== 1 || !object(bundle.settings)
    || !Array.isArray(bundle.files) || !Array.isArray(bundle.packages) || !Array.isArray(bundle.mcps) || !Array.isArray(bundle.notes)) throw new Error('Invalid or unsupported profile bundle.');
  if (Buffer.byteLength(JSON.stringify(bundle)) > MAX_BYTES || bundle.files.length > MAX_FILES) throw new Error('Bundle exceeds 1000 files or 10 MiB.');
  for (const [key, value] of Object.entries(bundle.settings)) if (!portableSetting(key, value)) throw new Error(`Unsupported portable setting: ${key}`);
  const paths = new Set();
  for (const file of bundle.files) {
    if (!object(file) || !resourcePath(file.path) || typeof file.content !== 'string' || file.content.includes('\0')) throw new Error('Bundle contains an unsafe resource path or content.');
    const key = file.path.toLowerCase();
    if (paths.has(key)) throw new Error('Bundle contains duplicate resource paths.');
    paths.add(key);
    if (file.path.startsWith('themes/')) {
      if (!object(JSON.parse(file.content))) throw new Error('Theme must be a JSON object.');
    }
  }
  if (!bundle.packages.every(packageSource) || !bundle.mcps.every(mcpName) || !bundle.notes.every((note) => text(note, 10000))) throw new Error('Invalid restoration checklist.');
  // Drop unknown fields; import never uses commands or config supplied by a bundle.
  return { format: bundle.format, version: bundle.version, settings: { ...bundle.settings }, files: bundle.files.map(({ path, content }) => ({ path, content })), packages: [...bundle.packages], mcps: [...bundle.mcps], notes: [...bundle.notes] };
}
export const readBundle = (path) => validateBundle(readObject(path));
export function writeBundle(path, bundle) {
  writeFileSync(path, JSON.stringify(validateBundle(bundle), null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}
export function previewBundle(bundle) {
  return `Portable settings:\n${JSON.stringify(bundle.settings, null, 2)}\nFiles (${bundle.files.length}):\n${bundle.files.map((file) => `  ${file.path}`).join('\n') || '  (none)'}\nPackages to reinstall: ${bundle.packages.join(', ') || '(none)'}\nMCPs to recreate: ${bundle.mcps.join(', ') || '(none)'}\nNotes:\n${bundle.notes.map((note) => `- ${note}`).join('\n')}`;
}
export function restoreGuide(bundle, directory) {
  const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
  const prefix = `PI_CODING_AGENT_DIR=${quote(directory)} pi`;
  return [
    'Review these steps before running them. Nothing below was executed automatically.',
    ...bundle.packages.map((source) => `${prefix} install ${quote(source)}`),
    ...bundle.mcps.map((name) => `MCP ${name}: use its provider's setup instructions to choose the executable or URL, then configure it with pi mcp add. Credentials, arguments, and endpoints were deliberately not exported.`),
    ...(bundle.mcps.length ? [`${prefix} mcp add --help`, `${prefix} mcp list`] : []),
    `Launch: ${prefix}`, 'Inside Pi: /login, then authenticate each MCP as required.',
    'Manual restoration notes:', ...bundle.notes,
  ].join('\n');
}
export function importBundle(service, value, name) {
  const bundle = validateBundle(value);
  if (service.find(name)) throw new Error(`Profile '${name}' already exists; choose a new name.`);
  const entry = service.create(name);
  if (!entry.created) throw new Error('Import requires a new profile.');
  try {
    for (const file of bundle.files) {
      const path = join(entry.directory, file.path);
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      writeFileSync(path, file.content, { flag: 'wx', mode: 0o600 });
    }
    writeFileSync(join(entry.directory, 'settings.json'), JSON.stringify(bundle.settings, null, 2) + '\n', { mode: 0o600 });
    writeFileSync(join(entry.directory, 'RESTORE.txt'), restoreGuide(bundle, entry.directory), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    rmSync(entry.directory, { recursive: true, force: true });
    throw error;
  }
  return entry;
}

export function parseExportArguments(args) {
  const positional = [];
  let output;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--path' || arg.startsWith('--path=')) {
      if (output !== undefined) throw new Error('Specify --path only once.');
      output = arg === '--path' ? args[++index] : arg.slice('--path='.length);
      if (!output || output.startsWith('--')) throw new Error('--path requires a filename or existing directory.');
    } else if (arg.startsWith('--')) throw new Error(`Unknown export option: ${arg}`);
    else positional.push(arg);
  }
  if (positional.length < 1 || positional.length > 2) throw new Error('Usage: /profiles export NAME [--path FILE_OR_DIRECTORY] [--dry-run]');
  if (positional.length === 2 && output !== undefined) throw new Error('Use either a positional filename or --path, not both.');
  return { name: positional[0], output: output ?? positional[1] };
}

// Shell-like quoting for file paths, without expansions or command execution.
export function splitArguments(input) {
  const words = [];
  let word = '', quote = '', started = false;
  for (const char of input) {
    if (quote) { if (char === quote) quote = ''; else word += char; started = true; }
    else if (char === '"' || char === "'") { quote = char; started = true; }
    else if (/\s/.test(char)) { if (started) words.push(word); word = ''; started = false; }
    else { word += char; started = true; }
  }
  if (quote) throw new Error('Unclosed quote in arguments.');
  if (started) words.push(word);
  return words;
}
