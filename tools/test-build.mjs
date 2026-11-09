#!/usr/bin/env node
// Shared live-test slot for parallel worktrees. Chrome loads ONE unpacked extension from
// <main checkout>/.testbuild/extension, so only the lock holder may replace it.
//
//   node tools/test-build.mjs status
//   node tools/test-build.mjs acquire <owner>   # fails if someone else holds a fresh lock
//   node tools/test-build.mjs build <owner>     # debug build of THIS worktree into the slot
//   node tools/test-build.mjs release <owner>
//
// After `build`, reload from a page in the test tab group:
//   window.postMessage({ source: 'jz-dev', type: 'reload' }, '*')
// then reload the tab and confirm JSON.parse(document.documentElement.dataset.jzDebug).build.
import { execFileSync, execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync, closeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const STALE_MS = 30 * 60 * 1000;
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const worktree = git('rev-parse', '--show-toplevel');
const mainRoot = dirname(resolve(worktree, git('rev-parse', '--git-common-dir')));
const slot = join(mainRoot, '.testbuild');
const lockPath = join(slot, 'lock.json');
const extDir = join(slot, 'extension');
const [cmd, owner] = process.argv.slice(2);

const readLock = () => {
  try { return JSON.parse(readFileSync(lockPath, 'utf8')); } catch { return null; }
};
const isStale = lock => !lock || Date.now() - lock.at > STALE_MS;
const fail = msg => { console.error(msg); process.exit(1); };
const needOwner = () => { if (!owner) fail(`usage: test-build.mjs ${cmd} <owner>`); };

mkdirSync(slot, { recursive: true });

if (cmd === 'status') {
  const lock = readLock();
  console.log(JSON.stringify({ slot: extDir, lock, stale: lock ? isStale(lock) : null }, null, 2));
} else if (cmd === 'acquire') {
  needOwner();
  const lock = readLock();
  if (lock && lock.owner !== owner && !isStale(lock)) fail(`BUSY: held by ${lock.owner} since ${new Date(lock.at).toISOString()}`);
  if (lock && lock.owner !== owner) rmSync(lockPath, { force: true });
  try {
    if (!lock || lock.owner !== owner) closeSync(openSync(lockPath, 'wx'));
  } catch { fail('BUSY: lock was taken concurrently, retry later'); }
  writeFileSync(lockPath, JSON.stringify({ owner, worktree, at: Date.now() }));
  console.log(`ACQUIRED by ${owner}`);
} else if (cmd === 'build') {
  needOwner();
  const lock = readLock();
  if (!lock || lock.owner !== owner) fail(`Not holding the lock (holder: ${lock?.owner ?? 'none'}). Run acquire first.`);
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  const sha = git('rev-parse', '--short', 'HEAD');
  const dirty = git('status', '--porcelain').length > 0 ? '+dirty' : '';
  const buildId = `${owner}:${branch}@${sha}${dirty}:${new Date().toISOString().slice(11, 19)}`;
  const outDir = join(worktree, '.output-test');
  execSync(`npx wxt build`, {
    cwd: worktree, stdio: 'inherit',
    env: { ...process.env, JZ_DEBUG: '1', JZ_BUILD_ID: buildId, JZ_OUT_DIR: outDir },
  });
  const built = join(outDir, 'chrome-mv3');
  if (!existsSync(built)) fail(`Build output missing: ${built}`);
  // Chrome only remembers the path, so replacing the folder wholesale is safe.
  rmSync(extDir, { recursive: true, force: true });
  cpSync(built, extDir, { recursive: true });
  writeFileSync(lockPath, JSON.stringify({ ...lock, at: Date.now(), build: buildId }));
  console.log(`BUILT ${buildId}\n-> ${extDir}`);
} else if (cmd === 'release') {
  needOwner();
  const lock = readLock();
  if (lock && lock.owner !== owner) fail(`Lock held by ${lock.owner}, not ${owner}`);
  rmSync(lockPath, { force: true });
  console.log('RELEASED');
} else {
  fail('usage: test-build.mjs <status|acquire|build|release> [owner]');
}
