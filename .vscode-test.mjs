import { defineConfig } from '@vscode/test-cli';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

export default defineConfig({
	files: 'out/test/**/*.test.js',
	launchArgs: ['--headless', `--user-data-dir=${resolve(tmpdir(), `yhc-test-${process.pid}`)}`],
});
