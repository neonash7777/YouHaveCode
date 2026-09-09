# Changelog

All notable changes to the YouHaveCode VS Code extension are documented here.

## [Unreleased]

- Polish release packaging, integrity metadata, and marketplace copy before the first public VSIX.
- Refresh marketplace wording, search keywords, and support-development links.
- Clarify proprietary licensing, generated output rights, and compatibility-profile provenance.
- Expand screenshot capture scenarios for sidebar, Unicode Table, Pretty Print settings, and compatibility warnings.

## [0.0.1] - First Preview

### Added

- Inline Unicode search with `u:`, `\u`, `\u:`, `\u#`, `\u&`, `::`, bounded `:query:`, and reusable `:::` workflows.
- Ranked glyph completions from Unicode name words, code points, custom tags, recent glyphs, and frequent glyphs.
- Text output formats for glyphs, Unicode escapes, code points, names, details, full details, HTML numeric entities, and language-native escapes.
- Emoji presentation controls for auto, color, text, and deconstructed variation-selector output.
- Custom tag authoring, assignment, restrictions, defaults, and sidebar management.
- Unicode property filters for category, bidi class, combining class, decomposition type, language/script family, block, and emoji presentation.
- Persistent default filters and search terms with sidebar toggles.
- Native Activity Bar sidebar with Recent, Frequent, Tags, Properties, Unicode Table, Pretty Print, Default Filters, and Tools sections.
- Unicode Table browser: block -> 256-codepoint page -> 16-codepoint row -> glyph.
- Pretty Print for selected text with Braille, Block Elements, solid square, Emoji Art, binary, and hex output.
- Pretty Print Image workflow for converting selected images or dropped files into bitmap text output.
- Pretty Print controls for size, wrapping, spacing, glyph mapping, flow direction, wrap direction, D4 transforms, and font precedence.
- Developer/debug Pretty Print sweeps for font precedence, sizes, transforms, and output types.
- Canvas-based glyph rasterization using explicit system font probing and Pretty Print font precedence.
- Compact platform compatibility badges in inline glyph completions, backed by bundled `compatibility_profiles.json` font coverage data and emoji-version evidence.
- Release integrity tooling and third-party notices for Unicode data and native canvas dependencies.

### Changed

- Pretty Print defaults use Baseline glyph mapping.
- Inline output-format selections update the persisted output setting.
- Compatibility unknowns are platform-coded when a profile is missing, and provisional current profiles avoid warning on every glyph before pinned scans exist.
- Pretty Print normal menus hide Custom Art; advanced/custom art settings remain configuration-backed.

### Known Gaps

- Windows, Ubuntu, Android AOSP, and iOS current font coverage profiles are provisional full-scalar assumptions until scanned from pinned reference images.
- Exact glyph rendering depends on local fonts, VS Code/Electron rendering, and platform emoji behavior.
- `scripts/export_emoji_rgi.py` at the repository root is currently whitespace-only; do not claim end-to-end emoji export reproducibility until restored.
