import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = resolve(extensionRoot, '..', '..', 'data');
const targetRoot = resolve(extensionRoot, 'data');
const files = ['unicode_compact.csv', 'unicode_property_aliases.csv', 'emoji_rgi.tsv', 'compatibility_profiles.json'];

await mkdir(targetRoot, { recursive: true });
await Promise.all(files.map(file => copyFile(resolve(sourceRoot, file), resolve(targetRoot, file))));
console.log(`Synchronized ${files.length} Unicode data files.`);