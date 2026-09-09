import { execFile } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const extensionRoot = resolve(import.meta.dirname, '..');
const outputDir = resolve(extensionRoot, 'media', 'screenshots');
const profileRoot = '/tmp/youhavecode-screenshots';
const userDataDir = resolve(profileRoot, 'user-data');
const extensionsDir = resolve(profileRoot, 'extensions');
const workspaceFile = resolve(profileRoot, 'YouHaveCode Showcase.txt');
const port = Number(process.env.YOUHAVECODE_SCREENSHOT_PORT ?? 45_000 + process.pid % 10_000);
const keepOpen = process.argv.includes('--keep-open');
const requested = new Set(process.argv.filter(argument => !argument.startsWith('--')).slice(2));
const shouldCapture = name => !requested.size || requested.has(name);
const scenarioNames = ['root-menu', 'properties-menu', 'output-format-menu', 'custom-tags-menu', 'tag-search-menu', 'sidebar-overview', 'unicode-table-sidebar', 'pretty-print-settings-sidebar', 'compatibility-warning-menu'];

const delay = milliseconds => new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));
const exec = (file, args) => new Promise(resolveExec => execFile(file, args, () => resolveExec()));

await exec('pkill', ['-f', `--user-data-dir=${userDataDir}`]);
await rm(profileRoot, { recursive: true, force: true });
await mkdir(resolve(userDataDir, 'User'), { recursive: true });
await mkdir(extensionsDir, { recursive: true });
await mkdir(outputDir, { recursive: true });
await writeFile(workspaceFile, '::');
await writeFile(resolve(userDataDir, 'User', 'settings.json'), `${JSON.stringify({
 'workbench.colorTheme': 'Default Dark Modern',
 'workbench.startupEditor': 'none',
 'workbench.tips.enabled': false,
 'editor.fontFamily': 'Menlo',
 'editor.fontSize': 18,
 'editor.lineHeight': 28,
 'editor.minimap.enabled': false,
 'editor.suggest.showStatusBar': false,
 'editor.suggest.preview': false,
 'editor.quickSuggestionsDelay': 10,
 'window.commandCenter': false,
 'window.titleBarStyle': 'custom',
 'telemetry.telemetryLevel': 'off',
 'update.mode': 'none',
 'security.workspace.trust.enabled': false,
 'youhavecode.compatibilityTargets': { ios: { version: '17.0', policy: 'warn' } },
}, null, 2)}\n`);

try {
 const response = await fetch(`http://127.0.0.1:${port}/json/version`);
 if (response.ok) { throw new Error(`Debug port ${port} is already in use. Set YOUHAVECODE_SCREENSHOT_PORT to a free port.`); }
} catch (error) {
 if (error instanceof Error && error.message.startsWith('Debug port')) { throw error; }
}

const code = spawn('code', [
 '--new-window',
 `--user-data-dir=${userDataDir}`,
 `--extensions-dir=${extensionsDir}`,
 `--extensionDevelopmentPath=${extensionRoot}`,
 `--remote-debugging-port=${port}`,
 '--disable-workspace-trust',
 '--skip-welcome',
 '--window-size=1280,900',
 workspaceFile,
], { detached: true, stdio: 'ignore' });
code.unref();

async function debuggingEndpoint() {
 for (let attempt = 0; attempt < 100; attempt++) {
  try {
   const response = await fetch(`http://127.0.0.1:${port}/json/version`);
   if (response.ok) { return (await response.json()).webSocketDebuggerUrl; }
  } catch { /* VS Code is still starting. */ }
  await delay(100);
 }
 throw new Error(`VS Code did not expose Chromium debugging on port ${port}.`);
}

const browser = await chromium.connectOverCDP(await debuggingEndpoint());
let page;
for (let attempt = 0; attempt < 100 && !page; attempt++) {
 const pages = browser.contexts().flatMap(context => context.pages());
 page = pages.find(candidate => candidate.url().includes('workbench')) ?? pages[0];
 if (!page) { await delay(100); }
}

try {
 if (!page) { throw new Error('Could not find the VS Code workbench page.'); }
 await page.locator('.monaco-workbench').waitFor({ state: 'visible', timeout: 20_000 });
 const showcaseTab = page.locator('.tab').filter({ hasText: 'YouHaveCode Showcase.txt' }).first();
 await showcaseTab.waitFor({ state: 'visible', timeout: 20_000 });
 await showcaseTab.click();
 const editor = page.locator('.editor-instance .monaco-editor').first();
 await editor.waitFor({ state: 'visible', timeout: 20_000 });

 const setQuery = async query => {
  await editor.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.type(query, { delay: 18 });
    await delay(750);
    await page.keyboard.press('Control+Space');
  await page.locator('.suggest-widget.visible').waitFor({ state: 'visible', timeout: 10_000 });
 };
 const suggestion = text => page.locator('.suggest-widget.visible .monaco-list-row').filter({ hasText: text }).first();
 const choose = async text => {
  const row = suggestion(text);
  await row.waitFor({ state: 'visible', timeout: 10_000 });
  await row.click();
  await page.locator('.suggest-widget.visible').waitFor({ state: 'visible', timeout: 10_000 });
  await delay(250);
 };
 const capture = async name => {
  if (!shouldCapture(name)) { return; }
  const widget = page.locator('.suggest-widget.visible');
  const box = await widget.boundingBox();
  if (!box) { throw new Error(`The ${name} suggest widget has no visible bounds.`); }
  const viewport = page.viewportSize() ?? { width: 1280, height: 900 };
  const margin = 18;
  const queryContext = 56;
  const editorBox = name === 'tag-search-menu' ? await editor.boundingBox() : undefined;
  const x = editorBox?.x ?? Math.max(0, box.x - margin);
  const y = Math.max(0, box.y - queryContext);
  const width = name === 'tag-search-menu' ? Math.min(viewport.width - x, box.x + box.width + margin - x) : Math.min(viewport.width - x, box.width + margin * 2);
  const height = Math.min(viewport.height - y, box.height + queryContext + margin);
  await page.screenshot({ path: resolve(outputDir, `${name}.png`), clip: { x, y, width, height } });
  console.log(`Captured media/screenshots/${name}.png`);
 };
 const captureLocator = async (name, locator, padding = 16) => {
  if (!shouldCapture(name)) { return; }
  await locator.waitFor({ state: 'visible', timeout: 10_000 });
  const box = await locator.boundingBox();
  if (!box) { throw new Error(`The ${name} target has no visible bounds.`); }
  const viewport = page.viewportSize() ?? { width: 1280, height: 900 };
  const x = Math.max(0, box.x - padding);
  const y = Math.max(0, box.y - padding);
  await page.screenshot({ path: resolve(outputDir, `${name}.png`), clip: { x, y, width: Math.min(viewport.width - x, box.width + padding * 2), height: Math.min(viewport.height - y, box.height + padding * 2) } });
  console.log(`Captured media/screenshots/${name}.png`);
 };
 const sidebar = page.locator('.pane-body').filter({ hasText: 'Search and Insert' }).first();
 const expandTreeRow = async text => {
  const row = page.locator('.monaco-list-row').filter({ hasText: text }).first();
  await row.waitFor({ state: 'visible', timeout: 10_000 });
  await row.dblclick();
  await delay(300);
 };
 const acceptGlyph = async (tag, codePoint) => {
  await setQuery(`::(+=${tag})${codePoint}`);
  const row = suggestion(`U+${codePoint.toUpperCase()}`);
  await row.waitFor({ state: 'visible', timeout: 10_000 });
  await row.click();
  await delay(150);
 };

 if (shouldCapture('root-menu')) { await setQuery('::'); await capture('root-menu'); }
 if (shouldCapture('properties-menu')) { await setQuery('::'); await choose('Properties…'); await capture('properties-menu'); }
 if (shouldCapture('output-format-menu')) { await setQuery('::'); await choose('Output Format…'); await capture('output-format-menu'); }

 if (shouldCapture('custom-tags-menu')) {
  const seededTags = [
   ['popular', '203D'], ['popular', '25CF'], ['popular', '25CB'],
   ['symbols', '2605'], ['symbols', '2606'], ['punctuation', '203D'],
   ['math', '221E'], ['arrows', '2192'], ['stars', '2605'],
  ];
  for (const [tag, codePoint] of seededTags) { await acceptGlyph(tag, codePoint); }
  await setQuery('::');
  await choose('Custom Tags…');
  await capture('custom-tags-menu');
 }
 if (shouldCapture('tag-search-menu')) {
  await acceptGlyph('test', '1F9EA');
  await setQuery('🧪::test');
  await suggestion('U+1F9EA').waitFor({ state: 'visible', timeout: 10_000 });
  await capture('tag-search-menu');
 }
 if (['sidebar-overview', 'unicode-table-sidebar', 'pretty-print-settings-sidebar'].some(shouldCapture)) {
  await vscodeCommand(page, 'youhavecode.unicode.focus');
  await captureLocator('sidebar-overview', sidebar);
  if (shouldCapture('unicode-table-sidebar')) {
   await expandTreeRow('Unicode Table');
   await expandTreeRow('Basic Latin');
   await captureLocator('unicode-table-sidebar', sidebar);
  }
  if (shouldCapture('pretty-print-settings-sidebar')) {
   await expandTreeRow('Pretty Print');
   await expandTreeRow('Pretty Print Settings');
   await captureLocator('pretty-print-settings-sidebar', sidebar);
  }
 }
 if (shouldCapture('compatibility-warning-menu')) {
  await setQuery('::head shaking horizontally');
  await capture('compatibility-warning-menu');
 }

 await writeFile(resolve(outputDir, 'README.md'), `# Generated Screenshots\n\nRun \`npm run screenshots\` from this extension directory to refresh every image. Pass scenario names to refresh a subset, for example \`npm run screenshots -- root-menu output-format-menu\`. Add \`-- --keep-open\` to leave the isolated VS Code window open for inspection.\n\nGenerated scenarios: ${scenarioNames.join(', ')}.\n`);
} finally {
 await browser.close();
 if (!keepOpen) {
  await exec('pkill', ['-f', `--user-data-dir=${userDataDir}`]);
 }
}

async function vscodeCommand(page, command) {
 await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+P' : 'Control+Shift+P');
 await page.keyboard.type(command);
 await page.keyboard.press('Enter');
 await delay(750);
}
