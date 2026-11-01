// Build the desktop installers. OneDrive locks freshly extracted folders and
// breaks electron-builder's renames, so a checkout inside OneDrive packages to
// %LOCALAPPDATA%\OriginalGangster-release instead (override: OG_RELEASE_DIR).
// Windows has no execute bit, so a Linux tar.gz built here comes out with the
// binaries unrunnable; it is repacked from linux-unpacked with ELF files 0755.
// (AppImage cannot be built on Windows: electron-builder ships no mksquashfs.)
// Usage: node scripts/package-desktop.mjs [electron-builder args, e.g. --win, --linux tar.gz]
import { spawnSync } from 'node:child_process';
import { existsSync, openSync, readSync, closeSync, readFileSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';
import { create } from 'tar';

const synced = /onedrive/i.test(process.cwd());
const out = process.env.OG_RELEASE_DIR
  ?? (synced && process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'OriginalGangster-release') : 'release');
console.log(`Packaging to ${path.resolve(out)}`);
const started = Date.now();
const args = ['electron-builder', ...process.argv.slice(2), `-c.directories.output=${out}`];
const run = spawnSync('npx', args, { stdio: 'inherit', shell: process.platform === 'win32' });
if (run.status !== 0) process.exit(run.status ?? 1);

const { name, version } = JSON.parse(readFileSync('package.json', 'utf8'));
const tarball = path.join(out, `${name}-${version}.tar.gz`);
if (process.platform === 'win32' && existsSync(tarball) && statSync(tarball).mtimeMs >= started) {
  const isElf = file => {
    const fd = openSync(file, 'r'), magic = Buffer.alloc(4);
    try { readSync(fd, magic, 0, 4, 0); } finally { closeSync(fd); }
    return magic.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
  };
  const root = `${name}-${version}`;
  const executables = [];
  await create({
    gzip: true, portable: true, cwd: out, file: `${tarball}.tmp`,
    onWriteEntry(entry) {
      entry.path = entry.path.replace(/^linux-unpacked/, root);
      const exec = entry.type === 'Directory' || (entry.type === 'File' && isElf(entry.absolute));
      entry.stat.mode = (entry.stat.mode & ~0o7777) | (exec ? 0o755 : 0o644);
      if (exec && entry.type === 'File') executables.push(path.basename(entry.path));
    },
  }, ['linux-unpacked']);
  renameSync(`${tarball}.tmp`, tarball);
  console.log(`Repacked ${path.basename(tarball)} with Linux permissions (0755: ${executables.join(', ')})`);
}
