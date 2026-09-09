import { watch } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const extensionRoot = resolve(import.meta.dirname, '..');
const delayMs = Number.parseInt(process.env.YOUHAVECODE_TEST_DELAY_MS ?? '300000', 10);
const once = process.argv.includes('--once');
const watchedPaths = ['src', 'scripts', 'package.json', 'tsconfig.json', '.vscode-test.mjs', 'esbuild.js'];
const statusPath = resolve(extensionRoot, '.test-status.json');
const watchers = [];
let timer;
let running = false;
let rerun = false;

const saveStatus = status => writeFile(statusPath, `${JSON.stringify(status, null, 2)}\n`);
const schedule = changedPath => {
 if (running) { rerun = true; return; }
 clearTimeout(timer);
 timer = setTimeout(runTests, delayMs);
 console.log(`[delayed-tests] Change in ${changedPath}; checking after ${Math.round(delayMs / 1000)} quiet seconds.`);
};
const runTests = () => {
 running = true;
 const startedAt = new Date().toISOString();
 console.log(`[delayed-tests] Running background compile, type, and lint checks at ${startedAt}.`);
 const child = spawn('npm', ['run', 'validate:background'], { cwd: extensionRoot, stdio: 'inherit' });
 child.once('error', async error => {
  await saveStatus({ state: 'error', startedAt, completedAt: new Date().toISOString(), error: error.message });
  console.error(`[delayed-tests] ERROR: ${error.message}`);
  if (once) { process.exitCode = 1; }
 });
 child.once('close', async exitCode => {
  running = false;
  const state = exitCode === 0 ? 'passed' : 'failed';
  await saveStatus({ state, startedAt, completedAt: new Date().toISOString(), exitCode });
  console.log(`[delayed-tests] ${state.toUpperCase()} (exit ${exitCode ?? 'unknown'}).`);
  if (once) { process.exitCode = exitCode ?? 1; return; }
  if (rerun) { rerun = false; schedule('changes made during the previous run'); }
 });
};

if (once) {
 schedule('validation request');
} else {
 watchedPaths.forEach(path => watchers.push(watch(resolve(extensionRoot, path), { recursive: true }, (_, filename) => schedule(filename ?? path))));
 await saveStatus({ state: 'watching', delayMs, startedAt: new Date().toISOString() });
 console.log(`[delayed-tests] Watching for changes with a ${Math.round(delayMs / 60000)} minute grace period; Electron tests require an explicit run.`);
}

const stop = () => { clearTimeout(timer); watchers.forEach(watcher => watcher.close()); };
process.once('SIGINT', stop);
process.once('SIGTERM', stop);