import { mkdir, writeFile } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { resolve } from 'node:path';

const accessible = process.argv.includes('--accessible');
const prepareOnly = process.argv.includes('--prepare-only');
const profileName = `youhavecode-vscode-dev${accessible ? '-accessible' : ''}`;
const userDataDir = `/tmp/${profileName}`;
const extensionsDir = `/tmp/${profileName}-extensions`;
const extensionRoot = resolve(import.meta.dirname, '..');

const terminateExistingWindow = () => new Promise((resolveTermination, reject) => {
 if (process.platform === 'win32') { resolveTermination(false); return; }
 const escapedUserDataDir = userDataDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
 execFile('pgrep', ['-f', `/(Code|code) --new-window --user-data-dir=${escapedUserDataDir}( |$)`], (error, stdout) => {
    if (error?.code === 1) { resolveTermination(false); return; }
    if (error) { reject(error); return; }
    const pid = Number(stdout.trim().split('\n')[0]);
    if (!Number.isInteger(pid)) { resolveTermination(false); return; }
    try { process.kill(pid, 'SIGTERM'); resolveTermination(true); }
    catch (killError) {
     if (killError.code === 'ESRCH') { resolveTermination(false); return; }
     reject(killError);
    }
 });
});

await mkdir(`${userDataDir}/User`, { recursive: true });
await mkdir(extensionsDir, { recursive: true });
await writeFile(`${userDataDir}/User/settings.json`, `${JSON.stringify({
 'editor.accessibilitySupport': accessible ? 'on' : 'off',
}, null, 2)}\n`);

if (!prepareOnly) {
 const terminated = await terminateExistingWindow();
 if (terminated) { await new Promise(resolveDelay => setTimeout(resolveDelay, 350)); }
 const child = await new Promise((resolveChild, reject) => {
  const spawned = spawn('code', [
   '--new-window',
   `--user-data-dir=${userDataDir}`,
   `--extensions-dir=${extensionsDir}`,
   `--extensionDevelopmentPath=${extensionRoot}`,
   extensionRoot,
  ], { detached: true, stdio: 'ignore' });
  spawned.once('spawn', () => resolveChild(spawned));
  spawned.once('error', reject);
 });
 child.unref();
 console.log(`Launched independent extension window (PID ${child.pid}).`);
}

console.log(`Prepared ${accessible ? 'accessible' : 'quiet'} development profile at ${userDataDir}`);