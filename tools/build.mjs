// Packages game/ as the ZIP bundle the Playables Developer Portal expects
// (index.html at the root) and checks the bundle against the size limits in
// the Playables stability requirements.
import { readdirSync, statSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const game = join(root, 'game');
const out = join(root, 'dist', 'draw-road-rush-playables.zip');
const MiB = 1024 * 1024;

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files.push({ path: relative(game, p).replaceAll('\\', '/'), size: statSync(p).size });
  }
})(game);

const total = files.reduce((a, f) => a + f.size, 0);
const problems = [];
const notes = [];
if (!files.some((f) => f.path === 'index.html')) problems.push('index.html must be at the bundle root');
if (files.length > 8000) problems.push(`too many files: ${files.length} (max 8000)`);
if (total >= 30 * MiB) problems.push(`initial bundle ${(total / MiB).toFixed(1)} MiB (MUST be < 30 MiB)`);
else if (total >= 15 * MiB) notes.push(`initial bundle ${(total / MiB).toFixed(1)} MiB (SHOULD be < 15 MiB)`);
for (const f of files) {
  if (f.size >= 30 * MiB) problems.push(`${f.path} is ${(f.size / MiB).toFixed(1)} MiB (MUST be < 30 MiB)`);
  else if (f.size >= 512 * 1024) notes.push(`${f.path} is ${(f.size / 1024).toFixed(0)} KiB (SHOULD be < 512 KiB)`);
}

console.table(files.map((f) => ({ file: f.path, KiB: +(f.size / 1024).toFixed(1) })));
console.log(`${files.length} files, ${(total / 1024).toFixed(0)} KiB total`);
notes.forEach((n) => console.log('note:', n));
if (problems.length) {
  problems.forEach((p) => console.error('ERROR:', p));
  process.exit(1);
}

mkdirSync(join(root, 'dist'), { recursive: true });
if (existsSync(out)) rmSync(out);
// Windows' bundled bsdtar writes forward-slash paths (PowerShell 5's
// Compress-Archive writes backslashes, which break the bundle elsewhere).
if (process.platform === 'win32') {
  const tar = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  execFileSync(tar, ['-a', '-c', '-f', out, ...files.map((f) => f.path)], { cwd: game, stdio: 'inherit' });
} else {
  execFileSync('zip', ['-r', '-q', out, '.'], { cwd: game, stdio: 'inherit' });
}
console.log(`wrote ${relative(root, out)} (${(statSync(out).size / 1024).toFixed(0)} KiB)`);
