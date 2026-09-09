# Release Checklist

## First-version readiness

- Keep this extension as its own Git repository rooted at `apps/vscode-extension`.
   Track source, docs, data, resources, screenshots, and lockfiles; ignore
   `node_modules`, `out`, `dist`, `.vscode-test`, and VSIX artifacts.
- After creating the hosted repository, add its HTTPS URL to `package.json` as
   `repository` metadata. Until then, package local VSIX artifacts with
   `--allow-missing-repository` if needed.
- Verify the shipped surface is intentional: inline search, sidebar browsing,
   Unicode Table, Pretty Print, Pretty Print Image, tags, defaults, output
   formats, and compatibility badges.
- Run one manual smoke pass in a fresh Extension Development Host: search and
   insert `interrobang`, assign and remove a custom tag, browse Unicode Table to
   a glyph, switch output format inline, Pretty Print selected text, and Pretty
   Print one small image.
- Confirm `README.md`, `CHANGELOG.md`, `COMPATIBILITY_COVERAGE.md`,
   `DELEGATE_SECURITY.md`, `THIRD_PARTY_NOTICES.md`, and screenshots describe
   the current UI. Remove or mark anything experimental that is not visible in
   normal mode.
- Refresh the recommended Marketplace screenshots from `README.md`, inspect
   them visually, and upload only the images that show current high-value flows.
- Add package repository metadata or replace relative README images before
   marketplace packaging, because VS Code diagnostics flag relative image URLs
   without an HTTPS repository in `package.json`.
- Regenerate `RELEASE_INTEGRITY.json` after the final docs/data/build changes;
   it is expected to change whenever `CHANGELOG.md`, `README.md`, bundled data,
   or `dist/extension.js` changes.
- Decide whether version `0.0.1` is the intended first public version or bump to
   `0.1.0` before packaging.

## Legal and provenance

- Confirm the release version and update `CHANGELOG.md`.
- Review `LICENSE` and `THIRD_PARTY_NOTICES.md`; do not remove the Unicode
  License v3 or `@napi-rs/canvas` MIT notice.
- Confirm the Unicode non-endorsement statement remains visible.
- Run `npm ls --omit=dev --all` and review any new production dependency before
  shipping it.
- Regenerate all Unicode artifacts from pinned upstream sources. Do not claim a
  reproducible Emoji 17 export until `scripts/export_emoji_rgi.py` is restored;
  it is currently empty.

## Build and integrity

1. Install from the lockfile with `npm ci` on the target platform.
2. Run `npm run release:prepare`. This builds production output, writes
   `RELEASE_INTEGRITY.json`, and verifies every recorded SHA-256 digest.
3. Review the manifest's version, data provenance, legal files, compiled bundle,
   data files, lockfile, and native binary.
4. Package a platform-specific VSIX, for example:

   ```bash
   npx @vscode/vsce package --target darwin-arm64
   ```

5. Hash the final artifact:

   ```bash
   npm run integrity:artifact -- ./youhavecode-darwin-arm64.vsix
   ```

6. Inspect the VSIX and confirm it contains `LICENSE`,
   `THIRD_PARTY_NOTICES.md`, `RELEASE_INTEGRITY.json`, all bundled data files, and
   only the intended platform's native Canvas binary.
7. Retain the VSIX, its `.sha256` sidecar, and the integrity manifest with the
   release record. Publish the checksum in a trusted release channel or signed
   tag; a checksum stored only beside a compromised artifact does not establish
   authenticity.

Run `npm run integrity:verify` at any later point to detect changes to recorded
release inputs.
