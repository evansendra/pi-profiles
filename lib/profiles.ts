import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { copyResources, planResources, resourceRoots } from './resources.ts';

export const excluded = new Set(['deviceId', 'sessionDir']);
const quote = (text) => `'${text.replaceAll("'", "'\\''")}'`;
export const launchCommand = (directory) => `PI_CODING_AGENT_DIR=${quote(directory)} pi`;
export const canonical = (path) => existsSync(path) ? realpathSync(path) : resolve(path);
export const sameDirectory = (a, b) => canonical(a) === canonical(b);
const stat = (path) => {
  try { return lstatSync(path); } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
};
const contains = (parent, child) => {
  const path = relative(canonical(parent), canonical(child));
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith('../'));
};
const isDirectory = (path) => {
  try { return lstatSync(path).isDirectory(); } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
};

// User resource paths are relative to the settings file, not the shell cwd.
export function rebaseSettings(settings, sourceDirectory, targetDirectory, copiedRoots = []) {
  const rebasePath = (value, resource = false) => {
    if (typeof value !== 'string') return value;
    const modifier = resource && /^[!+-]/.test(value) ? value[0] : '';
    const path = value.slice(modifier.length);
    if (!path || path.startsWith('~') || /^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('git@')) return value;
    const absolute = resolve(sourceDirectory, path);
    const local = relative(sourceDirectory, absolute);
    if (resource && copiedRoots.some((root) => local === root || local.startsWith(root + '/'))) {
      return modifier + relative(sourceDirectory, absolute);
    }
    if (isAbsolute(path)) return value;
    return modifier + (relative(targetDirectory, absolute) || '.');
  };
  const result = { ...settings };
  if (Array.isArray(result.packages)) result.packages = result.packages.map((entry) => typeof entry === 'string'
    ? rebasePath(entry)
    : entry && typeof entry === 'object' && typeof entry.source === 'string' ? { ...entry, source: rebasePath(entry.source) } : entry);
  for (const key of ['extensions', 'skills', 'prompts', 'themes']) {
    if (Array.isArray(result[key])) result[key] = result[key].map((path) => rebasePath(path, true));
  }
  return result;
}

export function createProfiles(home, active, packageRoot) {
  const root = join(home, '.pi', 'profiles');
  const registry = join(home, '.pi', 'profiles.json');
  const mainDirectory = join(home, '.pi', 'agent');
  const valid = (name) => /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name);
  function registered() {
    const known = { main: mainDirectory };
    if (!existsSync(registry)) return known;
    const config = JSON.parse(readFileSync(registry, 'utf8'));
    if (!config || typeof config.profiles !== 'object' || !config.profiles || Array.isArray(config.profiles)) throw new Error(`Expected a profiles object in ${registry}`);
    for (const [name, directory] of Object.entries(config.profiles)) {
      if (!valid(name) || ['current', 'list', 'new', 'remove', 'export', 'import'].includes(name) || typeof directory !== 'string' || !directory.trim()) throw new Error(`Invalid profile mapping in ${registry}`);
      if (name === 'main' && directory !== '~/.pi/agent' && resolve(directory) !== mainDirectory) throw new Error('The main profile must use the default Pi agent directory.');
      const expanded = directory === '~' ? home : directory.startsWith('~/') ? join(home, directory.slice(2)) : directory;
      if (!isAbsolute(expanded)) throw new Error(`Profile '${name}' must use an absolute or ~/ path.`);
      Object.defineProperty(known, name, { value: resolve(expanded), enumerable: true, configurable: true, writable: true });
    }
    return known;
  }
  function list() {
    const entries = new Map(Object.entries(registered()).filter(([, path]) => isDirectory(path)));
    if (stat(root)?.isSymbolicLink()) throw new Error('Refusing to use a symlinked named-profile root.');
    if (existsSync(root)) {
      for (const name of readdirSync(root).sort()) {
        if (valid(name) && !entries.has(name) && !['main', 'current', 'list', 'new', 'remove', 'export', 'import'].includes(name) && isDirectory(join(root, name))) entries.set(name, join(root, name));
      }
    }
    if (![...entries.values()].some((path) => sameDirectory(path, active))) entries.set('current', active);
    return [...entries].map(([name, directory]) => ({ name, directory, current: sameDirectory(directory, active) }))
      .sort((a, b) => Number(b.current) - Number(a.current) || a.name.localeCompare(b.name));
  }
  const find = (name) => list().find((entry) => entry.name === name);
  function create(name) {
    const existing = find(name);
    if (existing) return { ...existing, created: false };
    if (!valid(name) || ['main', 'current', 'list', 'new', 'remove', 'export', 'import'].includes(name)) throw new Error('Use a non-reserved profile name containing letters, numbers, underscores, or hyphens.');
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const directory = join(root, name);
    // Non-recursive creation refuses existing paths, including symlinks.
    mkdirSync(directory, { mode: 0o700 });
    try {
      mkdirSync(join(directory, 'extensions'));
      symlinkSync(packageRoot, join(directory, 'extensions', 'pi-profiles'), 'dir');
      writeFileSync(join(directory, 'settings.json'), '{}\n', { mode: 0o600, flag: 'wx' });
    } catch (error) {
      rmSync(directory, { recursive: true, force: true });
      throw error;
    }
    return { name, directory, created: true };
  }
  function assertRemovable(entry) {
    if (entry.name === 'main' || sameDirectory(entry.directory, mainDirectory)) throw new Error('The main profile cannot be removed.');
    if (sameDirectory(entry.directory, active)) throw new Error('The active profile cannot be removed.');
    if (lstatSync(entry.directory).isSymbolicLink()) throw new Error('Refusing to remove a symlinked profile directory.');
    const protectedPaths = [home, mainDirectory, active, packageRoot, registry, root,
      ...list().filter((profile) => profile.name !== entry.name).map((profile) => profile.directory)];
    if (protectedPaths.some((path) => contains(entry.directory, path))) throw new Error('Refusing to remove a protected directory or a directory containing another profile.');
    if (!stat(join(entry.directory, 'settings.json'))?.isFile()) throw new Error('Refusing removal: profile must contain a regular settings.json file.');
  }
  function remove(entry) {
    const current = find(entry.name);
    if (!current || !sameDirectory(current.directory, entry.directory)) throw new Error('Profile mapping changed; retry removal.');
    assertRemovable(entry);
    rmSync(entry.directory, { recursive: true });
  }
  function sync(source, target, dryRun) {
    if (sameDirectory(source.directory, target.directory)) throw new Error('Choose two different profiles.');
    const load = (path, optional = false) => {
      if (optional && !existsSync(path)) return {};
      const data = JSON.parse(readFileSync(path, 'utf8'));
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`Expected a JSON object in ${path}`);
      return data;
    };
    if (!isDirectory(source.directory) || !isDirectory(target.directory)) throw new Error('Source and destination must be existing, non-symlink profile directories.');
    const sourcePath = join(source.directory, 'settings.json');
    if (!stat(sourcePath)?.isFile()) throw new Error('Source settings must be a regular, non-symlink file.');
    const src = load(sourcePath);
    const dest = join(target.directory, 'settings.json');
    if (stat(dest)?.isSymbolicLink()) throw new Error('Refusing to replace symlinked settings.');
    const previous = load(dest, true);
    const resources = planResources(source.directory, target.directory);
    const copiedRoots = resourceRoots.filter((root) => resources.directories.includes(root));
    const copied = rebaseSettings(Object.fromEntries(Object.entries(src).filter(([key]) => !excluded.has(key))), source.directory, target.directory, copiedRoots);
    const data = { ...copied, ...Object.fromEntries(Object.entries(previous).filter(([key]) => excluded.has(key))) };
    const removed = Object.keys(previous).filter((key) => !Object.hasOwn(data, key)).sort();
    const preview = `Settings to copy (including unchanged values):\n${JSON.stringify(copied, null, 2)}\nSettings to remove: ${removed.join(', ') || '(none)'}\nPreserved in destination: ${[...excluded].join(', ')}\nResource files to copy (${resources.files.length}; target-only files retained):\n${resources.files.map((file) => `  ${file.replace ? 'replace' : 'add'} ${file.path}`).join('\n') || '  (none)'}\nSkipped resource paths (symlinks, dependencies, or special files): ${resources.skipped.join(', ') || '(none)'}`;
    if (dryRun) return `Dry run: ${source.name} → ${target.name}\n${preview}`;
    // Do not create missing profile directories as a side effect of syncing.
    if (!isDirectory(target.directory)) throw new Error('Destination profile no longer exists.');
    copyResources(resources, target.directory);
    const temporary = join(target.directory, `.settings-${randomUUID()}.tmp`);
    try {
      writeFileSync(temporary, JSON.stringify(data, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      renameSync(temporary, dest);
    } finally { rmSync(temporary, { force: true }); }
    return `Synced settings and ${resources.files.length} resource files ${source.name} → ${target.name}. Target-only resource files were retained. Skipped: ${resources.skipped.join(', ') || '(none)'}. Reload or restart the destination profile.`;
  }
  return { list, find, create, assertRemovable, remove, sync };
}
