import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = resolve(root, 'RELEASE_INTEGRITY.json');
const command = process.argv[2] ?? 'generate';
const requiredFiles = [
 'package.json', 'package-lock.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md', 'CHANGELOG.md',
 'DELEGATE_SECURITY.md', 'COMPATIBILITY_COVERAGE.md', 'RELEASE_CHECKLIST.md', 'scripts/release-integrity.mjs',
 'dist/extension.js', 'data/unicode_compact.csv', 'data/unicode_property_aliases.csv', 'data/emoji_rgi.tsv', 'data/compatibility_profiles.json',
];

const digest = async path => createHash('sha256').update(await readFile(path)).digest('hex');

async function nativeBinaries(directory) {
 const files = [];
 for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
  const path = resolve(directory, entry.name);
  if (entry.isDirectory()) { files.push(...await nativeBinaries(path)); }
  else if (entry.name.endsWith('.node')) { files.push(relative(root, path)); }
 }
 return files;
}

async function fileRecord(path) {
 const absolute = resolve(root, path);
 return { path, bytes: (await stat(absolute)).size, sha256: await digest(absolute) };
}

if (command === 'generate') {
 const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
 const files = [...requiredFiles, ...await nativeBinaries(resolve(root, 'node_modules', '@napi-rs'))].sort();
 const manifest = {
  schemaVersion: 1,
  package: packageJson.name,
  version: packageJson.version,
  generatedAt: new Date().toISOString(),
  algorithm: 'sha256',
  dataProvenance: {
   unicode: { license: 'Unicode License v3', notice: 'THIRD_PARTY_NOTICES.md' },
   emoji: { version: '17.0', source: 'https://www.unicode.org/Public/emoji/17.0/emoji-test.txt', license: 'Unicode License v3' },
  },
  files: await Promise.all(files.map(fileRecord)),
 };
 await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
 console.log(`Wrote ${basename(manifestPath)} with ${manifest.files.length} SHA-256 records.`);
} else if (command === 'verify') {
 const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
 const failures = [];
 for (const expected of manifest.files) {
  const actual = await fileRecord(expected.path).catch(() => undefined);
  if (!actual) { failures.push(`${expected.path}: missing`); }
  else if (actual.sha256 !== expected.sha256 || actual.bytes !== expected.bytes) { failures.push(`${expected.path}: changed`); }
 }
 if (failures.length) { throw new Error(`Integrity verification failed:\n${failures.join('\n')}`); }
 console.log(`Verified ${manifest.files.length} files for ${manifest.package}@${manifest.version}.`);
} else if (command === 'artifact') {
 const artifact = resolve(process.argv[3] ?? '');
 if (!process.argv[3]) { throw new Error('Usage: npm run integrity:artifact -- path/to/package.vsix'); }
 const checksum = await digest(artifact);
 const sidecar = `${artifact}.sha256`;
 await writeFile(sidecar, `${checksum}  ${basename(artifact)}\n`);
 console.log(`Wrote ${basename(sidecar)}.`);
} else {
 throw new Error(`Unknown command: ${command}`);
}