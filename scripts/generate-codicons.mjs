import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const metadataPath = resolve(extensionRoot, 'node_modules', '@vscode', 'codicons', 'dist', 'metadata.json');
const targetPath = resolve(extensionRoot, 'data', 'codicons.json');

const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
const icons = Object.keys(metadata).sort().map(name => {
 const entry = metadata[name];
 const icon = { name };
 if (entry.description) { icon.description = entry.description; }
 if (entry.tags?.length) { icon.tags = entry.tags; }
 return icon;
});

await writeFile(targetPath, JSON.stringify(icons));
console.log(`Generated ${icons.length} product icons from @vscode/codicons into data/codicons.json.`);
