# Font Coverage Profiles

YouHaveCode uses [../../data/compatibility_profiles.json](../../data/compatibility_profiles.json) for fast per-glyph compatibility feedback. The `fontCoverage` section is the authoritative app artifact for platform system-font support:

```json
{
  "fontCoverage": {
    "windows": {
      "11-24H2": {
        "source": "system-font-cmap-scan",
        "coverageMode": "includes-generic-fallbacks",
        "fontCount": 0,
        "codepointCount": 0,
        "ranges": ["0020..007E", "203D"]
      }
    }
  }
}
```

Ranges are sorted uppercase hex scalars, compacted as `START..END` or `POINT`. Surrogates are excluded. Generic fallback fonts count by default because this profile answers “will the platform render something for this scalar?” Use `--exclude-fallbacks` only for a stricter “specific non-fallback glyph” profile.

Until a platform has a pinned cmap scan, its `current` profile should be a clearly marked provisional full-scalar range (`0000..D7FF`, `E000..10FFFF`). That keeps YouHaveCode from treating missing evidence as incompatibility noise while still allowing pinned older versions or scanned profiles to report concrete misses.

## Collection

Use [../../scripts/export_font_coverage.py](../../scripts/export_font_coverage.py) against a pinned reference image for each platform/version. Do not hand-maintain ranges from marketing docs; use docs only to verify the expected font files or packages are present.

macOS:

```bash
.venv/bin/python scripts/export_font_coverage.py --target macos --version current
```

Windows:

1. Start a clean Windows reference VM for the target release, for example Windows 11 24H2.
2. Copy or mount this repo in the VM with Python and `fonttools` available.
3. Run:

```powershell
py scripts/export_font_coverage.py --target windows --version 11-24H2 --font-dir C:\Windows\Fonts
```

Microsoft publishes the Windows font inventory at <https://learn.microsoft.com/en-us/typography/fonts/windows_11_font_list>. That page is useful for checking whether the VM matches a baseline, but the cmap scan is the source of truth.

Ubuntu:

1. Start a clean Ubuntu desktop image for the target release, for example 24.04.
2. Ensure the intended desktop/meta packages are installed.
3. Run:

```bash
.venv/bin/python scripts/export_font_coverage.py --target ubuntu --version 24.04 --font-dir /usr/share/fonts --font-dir /usr/local/share/fonts
```

Ubuntu package manifests identify the baseline font packages. For Noble desktop, the relevant dependency/recommendation set includes `fonts-dejavu-core`, `fonts-liberation`, `fonts-noto-core`, `fonts-noto-cjk`, `fonts-noto-color-emoji`, and `fonts-ubuntu`.

Android AOSP:

1. Use a pinned emulator system image or extracted AOSP system image.
2. Pull the system font directory:

```bash
adb pull /system/fonts ./tmp/android-system-fonts
.venv/bin/python scripts/export_font_coverage.py --target android-aosp --version 15 --font-dir ./tmp/android-system-fonts
```

Android documents that apps should use `android.graphics.fonts.SystemFonts#getAvailableFonts` or `ASystemFontIterator_open` for actual installed fonts. AOSP `fonts.xml`/`font_fallback.xml` is useful for auditing expected files, but OEM devices can differ, so profiles should be named for the exact image they came from.

## Runtime Behavior

Inline glyph completions check `fontCoverage[target][version].ranges` first. Missing scalars produce compact badges like `(!Wi)` and detailed text like `Windows 11-24H2 missing font`. If a configured target/version has no font coverage profile, YouHaveCode falls back to known emoji-version evidence and finally to unknown-evidence policy.
