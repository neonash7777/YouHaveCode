import { watch } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const extensionRoot = resolve(import.meta.dirname, '..');
const delayMs = Number.parseInt(process.env.YOUHAVECODE_BUILD_DELAY_MS ?? '600', 10);
const watchedPaths = ['src', 'scripts', 'resources', 'data', 'package.json', 'tsconfig.json', 'esbuild.js'];
const watchers = [];
let timer;
let running = false;
let rerun = false;

const schedule = changedPath => {
 if (running) { rerun = true; return; }
 clearTimeout(timer);
 timer = setTimeout(build, delayMs);
 console.log(`[build-watch] Change in ${changedPath}; rebuilding after ${delayMs}ms of quiet.`);
};

const build = () => {
 running = true;
 const child = spawn('npm', ['run', 'compile'], { cwd: extensionRoot, stdio: 'inherit' });
 child.once('error', error => console.error(`[build-watch] ERROR: ${error.message}`));
 child.once('close', exitCode => {
  running = false;
  console.log(`[build-watch] Build ${exitCode === 0 ? 'finished' : `failed (exit ${exitCode ?? 'unknown'})`}.`);
  if (rerun) { rerun = false; schedule('changes made during the previous build'); }
 });
};

watchedPaths.forEach(path => watchers.push(watch(resolve(extensionRoot, path), { recursive: true }, (_, filename) => schedule(filename ?? path))));
console.log(`[build-watch] Watching extension sources with a ${delayMs}ms debounce.`);
const stop = () => { clearTimeout(timer); watchers.forEach(watcher => watcher.close()); };
process.once('SIGINT', stop);
process.once('SIGTERM', stop);