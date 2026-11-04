import { lstatSync, readdirSync, readFileSync, mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';

export const resourceRoots = ['prompts', 'skills', 'themes'];
const stat = (path) => { try { return lstatSync(path); } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; } };
const inside = (parent, child) => { const path = relative(parent, child); return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith('../')); };

// Snapshot and validate the entire copy plan before changing settings or files.
export function planResources(source, target) {
  const files = [], directories = [], skipped = [];
  let bytes = 0;
  function checkTarget(path, directory) {
    const info = stat(path);
    if (info && (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile()))) throw new Error(`Resource destination conflict (symlink or wrong file type): ${path}`);
  }
  function walk(path, depth = 0) {
    if (depth > 32) throw new Error('Resource nesting exceeds 32 levels.');
    const from = join(source, path), to = join(target, path), info = stat(from);
    if (!info) return;
    if (info.isSymbolicLink()) { skipped.push(path); return; }
    if (info.isDirectory()) {
      checkTarget(to, true);
      if (directories.length >= 5000) throw new Error('Resource sync exceeds 5000 directories.');
      directories.push(path);
      for (const name of readdirSync(from).sort()) {
        if (name === '.git' || name === 'node_modules') skipped.push(`${path}/${name}`);
        else walk(`${path}/${name}`, depth + 1);
      }
    } else if (info.isFile()) {
      checkTarget(to, false);
      bytes += info.size;
      if (files.length >= 5000 || bytes > 50 * 1024 * 1024) throw new Error('Resource sync exceeds 5000 files or 50 MiB.');
      files.push({ path, content: readFileSync(from), mode: info.mode & 0o777, replace: Boolean(stat(to)) });
    } else skipped.push(path);
  }
  for (const root of resourceRoots) {
    const from = resolve(source, root), to = resolve(target, root);
    if (inside(from, resolve(target)) || inside(to, resolve(source))) throw new Error('Resource directories must not contain another profile.');
    const info = stat(from);
    if (info && !info.isDirectory() && !info.isSymbolicLink()) throw new Error(`Resource root must be a directory: ${from}`);
    walk(root);
  }
  return { files, directories, skipped };
}

export function copyResources(plan, target) {
  for (const path of plan.directories) mkdirSync(join(target, path), { recursive: true, mode: 0o700 });
  for (const file of plan.files) {
    const destination = join(target, file.path);
    const temporary = join(dirname(destination), `.pi-sync-${randomUUID()}.tmp`);
    try {
      writeFileSync(temporary, file.content, { mode: file.mode, flag: 'wx' });
      renameSync(temporary, destination);
    } finally { rmSync(temporary, { force: true }); }
  }
}
