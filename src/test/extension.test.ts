import * as assert from 'assert';
import * as vscode from 'vscode';
import { applyCustomTagEdits, buildNameWords, countFilterValues, filterValues, glyphPropertyExpansions, glyphPropertyInputLabels, initialEntries, literalNameWords, matchingEntries, matchingWords, optionValues, parseUnicodeQuery, queryOption, shouldRetriggerAfterEdit, topMatchingWords, withDefaultFilters } from '../unicodeCompletions';
import { mergeEmojiEntries, parseCompactUnicode, parseEmojiRgi, parseUnicodePropertyAliases, propertyValueDescription } from '../unicodeData';
import { applyEmojiPresentation, deconstructUnicode, graphemeRangeAt, rasterRowsToBraille, renderCodepointReference, renderHtmlEntity, renderLanguageEscape, renderUnicode, replacementOffsets } from '../unicodeDeconstruction';
import { defaultPrettyPrintFontFamilies, enumerateFontRenderings, glyphIconPng, presentationFontFamilies, rasterizeEmojiArt, rasterizeGlyph, rasterizeGlyphBaseline, rasterizeGlyphBaselineTight, rasterizeGlyphForFamily, rasterizeImage, setPrettyPrintFontFamilies } from '../glyphRaster';
import { bitmapTextDimensions, composeBitmapText, rasterRowsToCustomArt, rasterRowsToText, startBitmapOnNewLine, textToBitmap, transformLayout, transformRaster } from '../unicodeBraille';
import { emptyUsageStats, orderFilterValues, rankCustomTags, rankGlyphHexes, recentFilterValues, recentOutputValue, recordGlyph, recordTokens, recordUsageValue, resetUsageStats } from '../usageRanking';
import { bitmapSizeChoices, selectionOutputChoices } from '../extension';
import { UnicodeSidebarProvider } from '../unicodeSidebar';
import { resolveDelegateProfile } from '../delegateSandbox';
import { compatibilitySummary, compatibilityWarningBadge, compatibilityWarningText, defaultCompatibilityTargets, emojiCompatibilityFindings, fontCoverageFindings, hasEmojiCompatibilityEvidence, parseCompatibilityProfiles, resolveCompatibilityTargets, unknownCompatibilityFindings, unknownCompatibilityWarningBadge, unknownCompatibilityWarningText } from '../compatibilitySettings';

const sampleEntries = parseCompactUnicode([
 '0x,Name,Category,Bidi,Combining,Decomp,Lang,Block',
 '25E,LATIN SMALL LETTER CLOSED REVERSED OPEN E,Ll,L,0,,LATIN,IPA Extensions',
 '25CB,WHITE CIRCLE,So,ON,0,,COMMON,Geometric Shapes',
 '25CF,BLACK CIRCLE,So,ON,0,,COMMON,Geometric Shapes',
 '2B58,HEAVY CIRCLE,So,ON,0,,COMMON,Miscellaneous Symbols and Arrows',
 '1F512,LOCK,So,ON,0,,COMMON,Miscellaneous Symbols and Pictographs',
 '203D,INTERROBANG,Po,ON,0,,COMMON,General Punctuation',
].join('\n')).map(entry => entry.hex === '1F512' ? { ...entry, emoji: true } : entry);

async function waitFor<T>(read: () => T, expected: T): Promise<void> {
 for (let attempt = 0; attempt < 80; attempt++) {
  if (JSON.stringify(read()) === JSON.stringify(expected)) { return; }
  await new Promise(resolve => setTimeout(resolve, 25));
 }
 assert.deepStrictEqual(read(), expected);
}

function configuredDefaultFilters(): Record<string, string> {
 const inspected = vscode.workspace.getConfiguration('youhavecode').inspect<Record<string, string>>('defaultFilters');
 return Object.assign({}, inspected?.defaultValue, inspected?.globalValue, inspected?.workspaceValue, inspected?.workspaceFolderValue,
  inspected?.defaultLanguageValue, inspected?.globalLanguageValue, inspected?.workspaceLanguageValue, inspected?.workspaceFolderLanguageValue);
}

function configuredDisabledDefaults(): string[] {
 return vscode.workspace.getConfiguration('youhavecode').get<string[]>('disabledDefaultItems', []);
}

async function clearDefaultFilterSettings(): Promise<void> {
 const configuration = vscode.workspace.getConfiguration('youhavecode');
 await Promise.all([
  configuration.update('defaultFilters', undefined, vscode.ConfigurationTarget.Global),
  configuration.update('defaultSearchTerms', undefined, vscode.ConfigurationTarget.Global),
  configuration.update('disabledDefaultItems', undefined, vscode.ConfigurationTarget.Global),
 ]);
 await waitFor(configuredDefaultFilters, {});
 await new Promise(resolve => setTimeout(resolve, 100));
}

suite('Unicode data', () => {
 test('parses compact rows with optional decomposition', () => {
  const entries = parseCompactUnicode([
    '0x,Name,Category,Bidi,Combining,Decomp,Lang,Block',
    '30,DIGIT ZERO,Nd,EN,0,,LATIN,Basic Latin',
    'C0,LATIN CAPITAL LETTER A WITH GRAVE,Lu,L,0,0041 0300,LATIN,Latin-1 Supplement',
  ].join('\n'));

  assert.deepStrictEqual(entries[0], {
  hex: '30', character: '0', name: 'DIGIT ZERO', category: 'Nd', bidi: 'EN', combining: 0, language: 'LATIN', block: 'Basic Latin',
  });
  assert.strictEqual(entries[1].character, 'À');
  assert.strictEqual(entries[1].decomposition, '0041 0300');
 });

 test('rejects incompatible data', () => {
  assert.throws(() => parseCompactUnicode('wrong\n30,DIGIT ZERO,Nd,EN,0'), /Unsupported Unicode data header/);
 });

 test('provides friendly descriptions for property aliases and negations', () => {
  const aliases = parseUnicodePropertyAliases([
   'Property,Value,ShortName,Name',
   'Bidi,BN,BN,Boundary_Neutral',
  ].join('\n'));
  assert.strictEqual(propertyValueDescription(aliases, 'bidi', 'BN'), 'Boundary Neutral');
  assert.strictEqual(propertyValueDescription(aliases, 'bidi', '!BN'), 'Not Boundary Neutral');
 });

 test('parses and merges RGI emoji characters and sequences', () => {
  const emoji = parseEmojiRgi([
   'Codepoints\tName\tGroup\tSubgroup\tVersion\tStatus',
   '1F600\tgrinning face\tSmileys & Emotion\tface-smiling\tE1.0\tfully-qualified',
   '1F468 200D 1F4BB\tman technologist\tPeople & Body\tperson-role\tE4.0\tfully-qualified',
  ].join('\n'));
  const merged = mergeEmojiEntries(sampleEntries, emoji);
  assert.strictEqual(emoji[1].character, '👨‍💻');
  assert.strictEqual(emoji[1].hex, '1F468-200D-1F4BB');
  assert.strictEqual(merged.find(entry => entry.character === '😀')?.emojiGroup, 'Smileys & Emotion');
  const words = buildNameWords(emoji).map(word => word.value);
  assert.ok(words.includes('SMILEYS') && words.includes('EMOTION') && words.includes('PERSON') && words.includes('ROLE'));
  assert.ok(!words.includes('S') && !words.includes('E'));
 });
 
 test('enumerates renderable fonts for ordinary ASCII glyphs', () => {
  const renderings = enumerateFontRenderings('a');
  assert.ok(renderings.length > 0);
  assert.ok(renderings.some(rendering => rendering.family === 'Menlo' || rendering.family === 'Helvetica Neue'));
 });
});

suite('Selection output menu', () => {
 test('puts instant, quick, and custom pretty print before direct textual outputs', () => {
  const choices = selectionOutputChoices('braille', { render: 'braille', size: '32x32', wrap: '80', compact: 'on', flow: 'lr', 'wrap-direction': 'ud', d4: 'identity' });
  assert.deepStrictEqual(choices.slice(0, 3), [
   { label: 'Pretty Print', description: 'Use last settings · Braille dots · 32x32 · wrap 80 · lr/ud · on · identity', format: 'lastBitmap' },
   { label: 'Pretty Print…', description: 'Choose only bitmap type and size', format: 'quickBitmap' },
   { label: 'Pretty Print*…', description: 'Customize type, size, wrapping, spacing, flow, and transform', format: 'customBitmap' },
  ]);
  assert.deepStrictEqual(choices.slice(3).map(choice => choice.format), [
    'braille', 'blockElements', 'iphoneBlocks', 'emoji', 'binary', 'hex',
   'symbols', 'components', 'details', 'fullDetails', 'codepoints', 'names', 'jsonEscapes',
  ]);
 });

 test('mixes recent custom bitmap sizes into sorted presets', () => {
  const choices = bitmapSizeChoices(32, [37, 11, 37, 73, 140]);
  assert.deepStrictEqual(choices.slice(0, 2).map(choice => [choice.label, choice.size]), [
   ['Last used (32 × 32)', 32], ['Last custom (37 × 37)', 37],
  ]);
  assert.deepStrictEqual(choices.slice(2, -1).map(choice => choice.size), [8, 11, 12, 16, 24, 32, 37, 48, 64, 73, 96, 128]);
  assert.strictEqual(choices.at(-1)?.custom, true);
 });
});

suite('Compatibility settings', () => {
 test('defaults every known current platform to warn', () => {
  const defaults = defaultCompatibilityTargets();
  assert.deepStrictEqual(Object.values(defaults), Array.from({ length: 5 }, () => ({ version: 'current', policy: 'warn' })));
  assert.strictEqual(compatibilitySummary(defaults, 'warn', 'warn'), '5/5 warn · unknown warn · local warn');
 });

 test('fills omitted target fields from warn defaults', () => {
  const configured = resolveCompatibilityTargets({ ios: { version: '18', policy: 'required' }, windows: { policy: 'permitted' } });
  assert.deepStrictEqual(configured.ios, { version: '18', policy: 'required' });
  assert.deepStrictEqual(configured.windows, { version: 'current', policy: 'permitted' });
  assert.deepStrictEqual(configured['android-aosp'], { version: 'current', policy: 'warn' });
 });

 test('reports platform-specific emoji compatibility warnings for pinned older targets', () => {
  const targets = resolveCompatibilityTargets({ ios: { version: '17.0', policy: 'warn' }, macos: { version: '14.4', policy: 'warn' }, windows: { version: '11-24H2', policy: 'permitted' } });
  const findings = emojiCompatibilityFindings('E15.1', targets);
  const warning = compatibilityWarningText(findings);
  assert.strictEqual(warning, 'iOS 17.0<17.4');
  assert.strictEqual(compatibilityWarningBadge(findings), '(!Ap)');
  assert.strictEqual(hasEmojiCompatibilityEvidence('E15.1'), true);
  assert.strictEqual(hasEmojiCompatibilityEvidence(undefined), false);
  assert.strictEqual(unknownCompatibilityWarningBadge('warn'), '(!?)');
  assert.strictEqual(unknownCompatibilityWarningText('warn'), 'No bundled platform evidence');
 });

 test('reports target-specific unknown compatibility evidence', () => {
  const targets = resolveCompatibilityTargets({ macos: { version: 'current', policy: 'warn' } });
  const profiles = parseCompatibilityProfiles(JSON.stringify({ schemaVersion: 1, emojiPlatformSupport: {}, fontCoverage: { macos: { current: { ranges: ['0000..10FFFF'] } } } }));
  const findings = unknownCompatibilityFindings(targets, profiles, 'warn');
  assert.strictEqual(compatibilityWarningBadge(findings, profiles), '(!ApAnWiLi)');
  assert.strictEqual(compatibilityWarningText(findings), 'iOS current no evidence, Android (AOSP) current no evidence, Windows current no evidence, Ubuntu current no evidence');
 });

 test('parses external compatibility profile documents', () => {
  const profiles = parseCompatibilityProfiles(JSON.stringify({
   schemaVersion: 1,
   badges: { ios: 'Ap' },
   emojiPlatformSupport: { '15.1': [{ target: 'ios', version: '17.4' }] },
    fontCoverage: { ios: { '17.0': { ranges: ['0000..007F', '203D'] } } },
  }));
  assert.deepStrictEqual(profiles.emojiPlatformSupport['15.1'], [{ target: 'ios', version: '17.4' }]);
    assert.deepStrictEqual(profiles.fontCoverage?.ios?.['17.0'].ranges, ['0000..007F', '203D']);
  assert.throws(() => parseCompatibilityProfiles('{"schemaVersion":1,"emojiPlatformSupport":{"15.1":[{"target":"bad","version":"1"}]}}'), /Invalid emoji support evidence/);
 });

   test('reports platform font coverage misses from compact ranges', () => {
    const targets = resolveCompatibilityTargets({ ios: { version: '17.0', policy: 'warn' } });
    const profiles = parseCompatibilityProfiles(JSON.stringify({ schemaVersion: 1, emojiPlatformSupport: {}, fontCoverage: { ios: { '17.0': { ranges: ['0000..007F'] } } } }));
    const findings = fontCoverageFindings([0x41, 0x203D], targets, profiles);
    assert.strictEqual(compatibilityWarningBadge(findings, profiles), '(!Ap)');
    assert.strictEqual(compatibilityWarningText(findings), 'iOS 17.0 missing font');
   });
});

suite('Delegate capability profiles', () => {
 test('resolves presets and granular custom allow and deny rules', () => {
  const restricted = resolveDelegateProfile('restricted');
  assert.deepStrictEqual([...restricted.capabilities], ['unicode.lookup', 'raster.read', 'settings.youhavecode.read']);
  assert.strictEqual(restricted.trusted, false);

  const custom = resolveDelegateProfile('local-writer', {
   'local-writer': { extends: 'workspace-read', allow: ['storage.profile.write'], deny: ['workspace.text.read'], limits: { timeoutMs: 750 } },
  });
  assert.ok(custom.capabilities.has('storage.profile.write'));
  assert.ok(!custom.capabilities.has('workspace.text.read'));
  assert.strictEqual(custom.limits.timeoutMs, 750);

  const full = resolveDelegateProfile('full-access');
  assert.ok(full.capabilities.has('process.spawn'));
  assert.strictEqual(full.trusted, true);
 });
});

suite('Unicode sidebar', () => {
 test('shows every glyph once when a tag has six or fewer assignments', async () => {
  const provider = new UnicodeSidebarProvider({
   entries: async () => sampleEntries, recentHexes: () => [], usage: emptyUsageStats,
   customTags: () => ({
    '25E': ['short', 'six'], '25CB': ['short', 'six'], '25CF': ['short', 'six'],
    '2B58': ['short', 'six'], '1F512': ['six'], '203D': ['six'],
   }),
  });
  const root = await provider.getChildren();
  const tags = await provider.getChildren(root.find(item => item.group === 'tags'));
  assert.strictEqual(tags.find(item => item.label === 'short')?.description, '{ɞ○●⭘} × 4');
  assert.strictEqual(tags.find(item => item.label === 'six')?.description, '{ɞ‽○●⭘🔒} × 6');
  assert.ok(!tags.slice(1).some(item => String(item.description).includes('…')));
 });

   test('counts text and emoji variants separately in tag totals', async () => {
    const usage = recordGlyph(recordGlyph(emptyUsageStats(), '1F512', 'color'), '1F512', 'text');
    const provider = new UnicodeSidebarProvider({ entries: async () => sampleEntries, recentHexes: () => [], usage: () => usage, customTags: () => ({ '1F512': ['favorite'] }) });
    const root = await provider.getChildren();
    const tags = await provider.getChildren(root.find(item => item.group === 'tags'));
    const favorite = tags.find(item => item.tag === 'favorite')!;
    const glyphs = await provider.getChildren(favorite);
    assert.strictEqual(favorite.description, '{🔒} × 2');
    assert.strictEqual(glyphs.length, 2);
   });

   test('browses Unicode Table by block, sub-block, row, and glyph', async () => {
    const provider = new UnicodeSidebarProvider({ entries: async () => sampleEntries, recentHexes: () => [], usage: emptyUsageStats });
    const root = await provider.getChildren();
    const table = root.find(item => item.group === 'unicodeTable')!;
    assert.strictEqual(table.label, 'Unicode Table');
    assert.ok(table.accessibilityInformation?.label.includes('Browse every Unicode entry'));
    const blocks = await provider.getChildren(table);
    const geometric = blocks.find(item => item.label === 'Geometric Shapes')!;
    assert.ok(geometric);
    assert.deepStrictEqual([geometric.group, geometric.description], ['unicodeTableBlock', 'U+25CB..U+25CF · 2 glyphs']);
    const pages = await provider.getChildren(geometric);
    assert.deepStrictEqual(pages.map(item => [item.label, item.group, item.description]), [['U+2500..U+25FF', 'unicodeTableSubBlock', '2 glyphs · WHITE CIRCLE..BLACK CIRCLE']]);
    const rows = await provider.getChildren(pages[0]);
    assert.deepStrictEqual(rows.map(item => [item.label, item.group, item.description]), [['U+25C0..U+25CF', 'unicodeTableRow', '2 glyphs · WHITE CIRCLE..BLACK CIRCLE']]);
    const rowGlyphs = await provider.getChildren(rows[0]);
    assert.deepStrictEqual(rowGlyphs.map(item => [item.label, item.command?.command, item.contextValue, item.hex]), [['○  U+25CB', 'youhavecode.insertGlyphByHex', 'youhavecode.glyph', '25CB'], ['●  U+25CF', 'youhavecode.insertGlyphByHex', 'youhavecode.glyph', '25CF']]);
   });

 test('groups native actions and ranks live glyph history', async () => {
  const usage = recordGlyph(recordGlyph(recordGlyph(emptyUsageStats(), '203D'), '203D'), '25CB');
  const provider = new UnicodeSidebarProvider({
   entries: async () => sampleEntries, recentHexes: () => ['25CB', '203D'], usage: () => usage,
  customTags: () => ({ '25E': ['favorite'], '25CB': ['favorite'], '25CF': ['favorite'], '2B58': ['favorite'], '1F512': ['favorite'], '203D': ['favorite'], '41': ['favorite'], '2605': ['later'] }),
    properties: () => [
     { key: 'category', label: 'Category', description: 'Unicode general category' },
     { key: 'bidi', label: 'Bidirectional class', description: 'Text writing direction behavior' },
    ],
  defaultFilters: () => ({ category: 'Po' }), defaultTerms: () => ['favorite'], disabledDefaults: () => ['property:category'], output: () => 'braille',
  prettyPrintFontFamilies: () => ({ active: ['Apple Symbols'], available: ['Apple Symbols', 'Noto Emoji', '123 Font'] }),
  d4Icon: operation => new vscode.ThemeIcon(`d4-${operation}`),
  directionIcon: (direction, paired) => new vscode.ThemeIcon(`${paired ? 'wrap' : 'flow'}-${direction}`),
   compatibility: () => ({ targets: resolveCompatibilityTargets({ ios: { version: '18', policy: 'required' } }), unknown: 'warn', localFont: 'permitted' }),
  });
  const root = await provider.getChildren();
  assert.deepStrictEqual(root.map(item => item.label), ['Search and Insert', 'Recent', 'Frequent', 'Tags', 'Properties', 'Unicode Table', 'Pretty Print', 'Default Filters', 'Tools']);
  assert.strictEqual(root[0].description, undefined);
  assert.strictEqual(root.find(item => item.group === 'recent')?.contextValue, 'youhavecode.group.recent');

  const recent = await provider.getChildren(root.find(item => item.group === 'recent'));
  const frequent = await provider.getChildren(root.find(item => item.group === 'frequent'));
  assert.strictEqual(recent[0].label, '○  U+25CB');
  assert.strictEqual(frequent[0].label, '‽  U+203D');
  assert.strictEqual(frequent[0].description, '× 2');
  assert.strictEqual(recent[0].description, undefined);
  assert.strictEqual(recent[0].command?.command, 'youhavecode.insertGlyphByHex');
  assert.deepStrictEqual([recent[0].contextValue, recent[0].hex], ['youhavecode.recentGlyph', '25CB']);
  assert.deepStrictEqual([frequent[0].contextValue, frequent[0].hex], ['youhavecode.frequentGlyph', '203D']);

  const tags = await provider.getChildren(root.find(item => item.group === 'tags'));
  const properties = await provider.getChildren(root.find(item => item.group === 'properties'));
  assert.strictEqual(tags[0].command?.command, 'youhavecode.createSidebarTag');
  assert.deepStrictEqual(properties.map(item => [item.label, item.command?.command, item.command?.arguments?.[0]]), [
   ['Category', 'youhavecode.openInlineProperty', 'category'],
   ['Bidirectional class', 'youhavecode.openInlineProperty', 'bidi'],
  ]);
  assert.deepStrictEqual(tags.slice(1).map(item => item.label), ['favorite', 'later']);
  assert.strictEqual(tags[1].description, '{U+41ɞ‽…●⭘🔒} × 7');
  assert.strictEqual(tags[1].command, undefined);
  assert.deepStrictEqual([tags[1].contextValue, tags[1].tag], ['youhavecode.tag', 'favorite']);
  assert.strictEqual(tags[1].collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
  const taggedGlyphs = await provider.getChildren(tags[1]);
  assert.deepStrictEqual(taggedGlyphs.map(item => item.hex), ['25E', '203D', '25CB', '25CF', '2B58', '1F512']);
  assert.ok(taggedGlyphs.every(item => item.contextValue === 'youhavecode.tagGlyph' && item.parentTag === 'favorite'));
  assert.strictEqual(tags[2].description, '{U+2605} × 1');

  const prettyPrint = await provider.getChildren(root.find(item => item.group === 'prettyPrint'));
  assert.deepStrictEqual([prettyPrint[0].label, prettyPrint[0].command?.command], ['Pretty Print', 'youhavecode.prettyPrintWithDefaults']);
  assert.deepStrictEqual([prettyPrint[1].label, prettyPrint[1].command?.command], ['Pretty Print Image…', 'youhavecode.prettyPrintImage']);
  assert.strictEqual(prettyPrint[1].iconPath instanceof vscode.ThemeIcon ? prettyPrint[1].iconPath.id : undefined, 'file-media');
  assert.deepStrictEqual(prettyPrint.slice(2).map(item => [item.label, item.group]), [['Pretty Print Settings', 'prettyPrintSettings']]);
  const settings = await provider.getChildren(prettyPrint[2]);
  assert.deepStrictEqual(settings.slice(0, 9).map(item => [item.label, item.group]), [['Pretty Print Type', 'prettyPrintOutput'], ['Size', 'prettyPrintSize'], ['Line Length', 'prettyPrintWrap'], ['Spacing', 'prettyPrintSpacing'], ['Glyph Mapping', 'prettyPrintMapping'], ['Writing Direction', 'prettyPrintFlow'], ['Wrap Direction', 'prettyPrintWrapDirection'], ['Transform', 'prettyPrintTransform'], ['Font Precedence', 'prettyPrintFontFamilies']]);
  const fontPrecedence = settings.find(item => item.group === 'prettyPrintFontFamilies')!;
  const fontSections = await provider.getChildren(fontPrecedence);
  assert.deepStrictEqual(fontSections.map(item => item.label), ['Active Font Priority', 'Installed Fonts']);
  const activeFonts = await provider.getChildren(fontSections[0]);
  assert.deepStrictEqual(activeFonts.map(item => [item.label, item.iconPath instanceof vscode.ThemeIcon ? item.iconPath.id : undefined, item.command?.command, item.contextValue]), [
  ['Apple Symbols', 'check', 'youhavecode.togglePrettyPrintFontFamily', 'youhavecode.prettyPrintFontFamily.active'],
  ['Reset to Defaults', 'discard', 'youhavecode.resetPrettyPrintFontFamilies', 'youhavecode.action'],
  ]);
  const installedFonts = await provider.getChildren(fontSections[1]);
  assert.deepStrictEqual(installedFonts.map(item => item.label), ['Fonts: #+', 'Fonts: A', 'Fonts: N']);
  const otherFonts = await provider.getChildren(installedFonts[0]);
  assert.deepStrictEqual(otherFonts.map(item => [item.label, item.command?.command, item.contextValue]), [['123 Font', 'youhavecode.togglePrettyPrintFontFamily', 'youhavecode.prettyPrintFontFamily.disabled']]);
  const aBucket = installedFonts.find(item => item.label === 'Fonts: A')!;
  const nBucket = installedFonts.find(item => item.label === 'Fonts: N')!;
  assert.notStrictEqual(aBucket.id, nBucket.id);
  assert.deepStrictEqual((await provider.getChildren(aBucket)).map(item => item.label), ['Apple Symbols']);
  assert.deepStrictEqual((await provider.getChildren(nBucket)).map(item => item.label), ['Noto Emoji']);
  assert.ok(!settings.some(item => item.label === 'Print With Font Precedence'));
  const spacing = settings.find(item => item.group === 'prettyPrintSpacing');
  const spacingChoices = await provider.getChildren(spacing!);
  assert.strictEqual(spacing?.label, 'Spacing');
  assert.strictEqual(spacing?.description, 'Compact');
  assert.strictEqual(spacingChoices.find(item => item.label === 'Compact')?.description, 'selected');
  assert.strictEqual(spacingChoices.find(item => item.label === 'Padded')?.description, undefined);
  const prettyPrintType = await provider.getChildren(settings[0]);
  assert.strictEqual(settings[0].description, 'Braille Art');
  assert.ok(settings[7].iconPath instanceof vscode.ThemeIcon);
  assert.strictEqual(settings[7].iconPath.id, 'd4-identity');
  assert.deepStrictEqual(prettyPrintType.map(item => [item.label, item.command?.command, item.command?.arguments?.[0]]), [['Braille Art', 'youhavecode.setSidebarPrettyPrintSetting', 'output'], ['Block Elements Art', 'youhavecode.setSidebarPrettyPrintSetting', 'output'], ['Solid Square Art', 'youhavecode.setSidebarPrettyPrintSetting', 'output'], ['Emoji Art', 'youhavecode.setSidebarPrettyPrintSetting', 'output'], ['Binary Art', 'youhavecode.setSidebarPrettyPrintSetting', 'output'], ['Hex Art', 'youhavecode.setSidebarPrettyPrintSetting', 'output']]);
  assert.deepStrictEqual(prettyPrintType.map(item => [item.contextValue, item.prettyPrintOutput]), [['youhavecode.prettyPrintOutputChoice', 'braille'], ['youhavecode.prettyPrintOutputChoice', 'block-elements'], ['youhavecode.prettyPrintOutputChoice', 'iphone-blocks'], ['youhavecode.prettyPrintOutputChoice', 'emoji'], ['youhavecode.prettyPrintOutputChoice', 'binary'], ['youhavecode.prettyPrintOutputChoice', 'hex']]);
  const sizes = await provider.getChildren(settings[1]);
  const lineLength = await provider.getChildren(settings[2]);
  const mapping = await provider.getChildren(settings[4]);
  const writingDirection = await provider.getChildren(settings[5]);
  const wrapDirection = await provider.getChildren(settings[6]);
  const transforms = await provider.getChildren(settings[7]);
  assert.ok(sizes.some(item => item.label === 'Custom size…' && item.command?.command === 'youhavecode.setSidebarPrettyPrintCustomSize'));
  assert.deepStrictEqual(lineLength.map(item => item.label).slice(0, 3), ['No Wrap', 'Match Glyph Size', 'Auto (editor column)']);
  assert.deepStrictEqual(mapping.map(item => item.label), ['Square', 'Baseline', 'Baseline Tight']);
  assert.deepStrictEqual([lineLength.at(-1)?.label, lineLength.at(-1)?.command?.command, lineLength.at(-1)?.contextValue], ['Toggle Wrapping', 'youhavecode.toggleEditorLineWrapping', 'youhavecode.editorLineWrapping']);
  assert.deepStrictEqual(writingDirection.map(item => item.label), ['Auto (transform)', 'Left to right', 'Right to left', 'Top to bottom', 'Bottom to top']);
  assert.deepStrictEqual(wrapDirection.map(item => item.label), ['Auto']);
  assert.deepStrictEqual(transforms.map(item => item.label), ['Identity', 'Rotate 90°', 'Rotate 180°', 'Rotate 270°', 'Mirror', 'Flip', 'Diagonal', 'AntiDiagonal']);
  assert.ok([prettyPrintType, lineLength, writingDirection, wrapDirection, transforms].every(items => items.some(item => item.description === 'selected')));
  assert.deepStrictEqual(transforms.map(item => item.iconPath instanceof vscode.ThemeIcon ? item.iconPath.id : undefined), ['check', 'd4-rotate-90', 'd4-rotate-180', 'd4-rotate-270', 'd4-mirror-left-right', 'd4-flip-top-bottom', 'd4-reflect-slash', 'd4-reflect-backslash']);
  const tools = await provider.getChildren(root.find(item => item.group === 'tools'));
  assert.deepStrictEqual(tools.slice(0, 2).map(item => item.group), ['outputFormat', 'compatibility']);
  const output = await provider.getChildren(tools[0]);
  const selectedOutput = output.find(item => item.label === 'Braille dots');
  assert.ok(selectedOutput?.iconPath instanceof vscode.ThemeIcon);
  assert.strictEqual(selectedOutput.iconPath.id, 'check');
  const inactivePrettyPrintOutput = output.find(item => item.label === 'Block Elements');
  assert.ok(inactivePrettyPrintOutput?.iconPath instanceof vscode.ThemeIcon);
  assert.strictEqual(inactivePrettyPrintOutput.iconPath.id, 'symbol-color');
  const defaults = await provider.getChildren(root.find(item => item.group === 'defaultFilters'));
  assert.deepStrictEqual(defaults.slice(0, 2).map(item => item.label), ['(category=Po)', '(favorite)']);
  assert.deepStrictEqual(defaults.slice(0, 2).map(item => [item.contextValue, item.description, item.defaultKind, item.defaultKey]), [
   ['youhavecode.defaultItem', 'Disabled', 'property', 'category'],
   ['youhavecode.defaultItem', undefined, 'term', 'favorite'],
  ]);
  const compatibility = await provider.getChildren(tools[1]);
  assert.strictEqual(compatibility[0].label, 'iOS · 18 · required');
  assert.strictEqual(new Set(compatibility.filter(item => item.group === 'compatibilityTarget' || item.group === 'compatibilityFallback').map(item => item.id)).size, 7);
  const localFont = compatibility.find(item => item.label === 'Local Font · permitted');
  assert.ok(localFont?.iconPath instanceof vscode.ThemeIcon);
  assert.strictEqual(localFont.iconPath.id, 'text-size');
  const ios = await provider.getChildren(compatibility[0]);
  const selectedPolicy = ios.find(item => item.label === 'Policy: required');
  assert.ok(selectedPolicy?.iconPath instanceof vscode.ThemeIcon);
  assert.strictEqual(selectedPolicy.iconPath.id, 'check');
 });

 test('starts the inline search at the active editor selection', async () => {
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: 'before after' });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, 7, 0, 12);
  await vscode.commands.executeCommand('youhavecode.insertGlyph');
  assert.strictEqual(document.getText(), 'before ::');
 });

 test('starts a scoped inline search from a sidebar tag', async () => {
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: 'before after' });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, 7, 0, 12);
  await vscode.commands.executeCommand('youhavecode.searchTag', 'favorite');
  assert.strictEqual(document.getText(), 'before ::(favorite)');
 });

 test('toggles a sidebar tag inside the current query without adding another prefix', async () => {
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: '::(line)cir' });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, 11, 0, 11);
  await vscode.commands.executeCommand('youhavecode.searchTag', 'favorite');
  assert.strictEqual(document.getText(), '::(line)(favorite)cir');
  await vscode.commands.executeCommand('youhavecode.searchTag', 'favorite');
  assert.strictEqual(document.getText(), '::(line)cir');
  editor.selection = new vscode.Selection(0, 2, 0, 2);
  await vscode.commands.executeCommand('youhavecode.searchTag', 'favorite');
  assert.strictEqual(document.getText(), '::(favorite)(line)cir');
 });

 test('toggles a sidebar tag restriction and replaces its opposite form', async () => {
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: '::(favorite)' });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, 12, 0, 12);
  await vscode.commands.executeCommand('youhavecode.restrictSidebarTag', { tag: 'favorite' });
  assert.strictEqual(document.getText(), '::(!favorite)');
  editor.selection = new vscode.Selection(0, 13, 0, 13);
  await vscode.commands.executeCommand('youhavecode.restrictSidebarTag', { tag: 'favorite' });
  assert.strictEqual(document.getText(), '::');
 });

 test('cycles a sidebar tag through required, restricted, and absent', async () => {
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: '::cir' });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, 5, 0, 5);
  await vscode.commands.executeCommand('youhavecode.cycleSidebarTagConstraint', { tag: 'favorite' });
  assert.strictEqual(document.getText(), '::(favorite)cir');
  editor.selection = new vscode.Selection(0, 15, 0, 15);
  await vscode.commands.executeCommand('youhavecode.cycleSidebarTagConstraint', { tag: 'favorite' });
  assert.strictEqual(document.getText(), '::(!favorite)cir');
  editor.selection = new vscode.Selection(0, 16, 0, 16);
  await vscode.commands.executeCommand('youhavecode.cycleSidebarTagConstraint', { tag: 'favorite' });
  assert.strictEqual(document.getText(), '::cir');
 });

 test('switches mutually exclusive default tag filters and restrictions', async () => {
  await clearDefaultFilterSettings();
  await vscode.commands.executeCommand('youhavecode.setSidebarTagDefault', { tag: 'favorite' });
  assert.deepStrictEqual(vscode.workspace.getConfiguration('youhavecode').get('defaultSearchTerms'), ['FAVORITE']);
  await vscode.commands.executeCommand('youhavecode.setSidebarTagExcludedDefault', { tag: 'favorite' });
  assert.deepStrictEqual(vscode.workspace.getConfiguration('youhavecode').get('defaultSearchTerms'), ['!FAVORITE']);
  await vscode.commands.executeCommand('youhavecode.setSidebarTagDefault', { tag: 'favorite' });
  assert.deepStrictEqual(vscode.workspace.getConfiguration('youhavecode').get('defaultSearchTerms'), ['FAVORITE']);
  await clearDefaultFilterSettings();
 });

 test('renders sidebar emoji variants with their recorded presentations', async () => {
  const usage = recordGlyph(recordGlyph(emptyUsageStats(), '1F512', 'color'), '1F512', 'text');
  const provider = new UnicodeSidebarProvider({
   entries: async () => sampleEntries,
   recentHexes: () => ['1F512\u0000color', '1F512\u0000text'],
   emojiPresentation: () => 'color',
  textGlyphIcon: async () => new vscode.ThemeIcon('file-media'),
   usage: () => usage,
   customTags: () => ({ '1F512': ['emoji'] }),
  });
  const root = await provider.getChildren();
  const recent = await provider.getChildren(root.find(item => item.group === 'recent'));
  const frequent = await provider.getChildren(root.find(item => item.group === 'frequent'));
  const tags = await provider.getChildren(root.find(item => item.group === 'tags'));
  const tagged = await provider.getChildren(tags.find(item => item.tag === 'emoji'));

  for (const items of [recent, frequent, tagged]) {
   const textItems = items.filter(item => item.presentation === 'text');
   const colorItems = items.filter(item => item.presentation === 'color');
    assert.strictEqual(textItems.length, 1);
   assert.strictEqual(colorItems.length, 1);
    assert.ok(textItems.every(item => item.label === '🔒︎⃨  U+1F512' && String(item.description).includes('(text)')));
    assert.ok(textItems.every(item => item.iconPath instanceof vscode.ThemeIcon && item.iconPath.id === 'file-media'));
    assert.ok(colorItems.every(item => item.iconPath instanceof vscode.ThemeIcon && item.iconPath.id === 'symbol-character'));
   assert.deepStrictEqual(colorItems[0].command?.arguments, ['1F512', 'color']);
   assert.ok(textItems.every(item => JSON.stringify(item.command?.arguments) === JSON.stringify(['1F512', 'text'])));
  }
 });

 test('copies or appends a sidebar glyph with the configured emoji presentation', async () => {
  const configuration = vscode.workspace.getConfiguration('youhavecode');
  const previousClipboard = await vscode.env.clipboard.readText();
  await configuration.update('emojiPresentation', 'color', vscode.ConfigurationTarget.Global);
  try {
   await vscode.commands.executeCommand('youhavecode.copySidebarGlyph', { hex: '2648' });
   assert.deepStrictEqual(Array.from(await vscode.env.clipboard.readText()).map(character => character.codePointAt(0)), [0x2648, 0xFE0F]);
  await vscode.commands.executeCommand('youhavecode.appendSidebarGlyphToClipboard', { hex: '25CB' });
  assert.deepStrictEqual(Array.from(await vscode.env.clipboard.readText()).map(character => character.codePointAt(0)), [0x2648, 0xFE0F, 0x25CB]);
  } finally {
   await vscode.env.clipboard.writeText(previousClipboard);
   await configuration.update('emojiPresentation', undefined, vscode.ConfigurationTarget.Global);
  }
 });

 test('contributes the Activity Bar container and Unicode view', () => {
  const extension = vscode.extensions.all.find(candidate => candidate.packageJSON.name === 'youhavecode')!;
  assert.strictEqual(extension.packageJSON.displayName, 'YouHaveCode');
  assert.strictEqual(extension.packageJSON.description, 'Need a Unicode symbol‽ Now you have the code‼');
  assert.strictEqual(extension.packageJSON.icon, 'resources/icon.png');
  assert.strictEqual(extension.packageJSON.contributes.configuration.title, 'YouHaveCode');
  assert.strictEqual(extension.packageJSON.contributes.viewsContainers.activitybar[0].id, 'youhavecode');
  assert.strictEqual(extension.packageJSON.contributes.viewsContainers.activitybar[0].title, 'YOUHAVECODE UNICODE');
  assert.strictEqual(extension.packageJSON.contributes.viewsContainers.activitybar[0].icon, 'resources/unicode.svg');
  assert.strictEqual(extension.packageJSON.contributes.views.youhavecode[0].name, 'YOUHAVECODE UNICODE');
  assert.ok(extension.packageJSON.contributes.menus['view/item/context'].some((item: { command?: string }) => item.command === 'youhavecode.clearRecentGlyphs'));
  assert.ok(extension.packageJSON.contributes.menus['view/item/context'].some((item: { command?: string }) => item.command === 'youhavecode.copySidebarGlyph'));
  assert.ok(extension.packageJSON.contributes.menus['view/item/context'].some((item: { command?: string }) => item.command === 'youhavecode.appendSidebarGlyphToClipboard'));
  assert.ok(extension.packageJSON.contributes.menus['view/item/context'].some((item: { command?: string; when?: string }) => item.command === 'youhavecode.removeParentTagFromGlyph' && item.when?.includes('viewItem == youhavecode.tagGlyph')));
  assert.ok(extension.packageJSON.contributes.menus['view/item/context'].some((item: { command?: string; when?: string }) => item.command === 'youhavecode.removeRecentGlyph' && item.when?.includes('viewItem == youhavecode.recentGlyph')));
  assert.ok(extension.packageJSON.contributes.menus['view/item/context'].some((item: { command?: string; when?: string }) => item.command === 'youhavecode.removeFrequentGlyph' && item.when?.includes('viewItem == youhavecode.frequentGlyph')));
  assert.deepStrictEqual(extension.packageJSON.contributes.menus['view/item/context']
   .filter((item: { when?: string }) => item.when?.includes('viewItem == youhavecode.defaultItem'))
   .map((item: { command: string }) => item.command), ['youhavecode.toggleSidebarDefaultItem', 'youhavecode.clearSidebarDefaultItem']);
  assert.ok(extension.packageJSON.contributes.menus['view/item/context'].some((item: { command?: string }) => item.command === 'youhavecode.manageGlyphTags'));
  assert.ok(extension.packageJSON.contributes.menus['view/item/context'].some((item: { command?: string }) => item.command === 'youhavecode.setGlyphDefaultFilter'));
  const tagMenuCommands = extension.packageJSON.contributes.menus['view/item/context']
    .filter((item: { when?: string }) => /viewItem == youhavecode\.tag(?:\)|$)/u.test(item.when ?? ''))
   .map((item: { command: string }) => item.command);
  assert.deepStrictEqual(tagMenuCommands, [
    'youhavecode.cycleSidebarTagConstraint', 'youhavecode.searchSidebarTag', 'youhavecode.restrictSidebarTag', 'youhavecode.setSidebarTagDefault', 'youhavecode.setSidebarTagExcludedDefault', 'youhavecode.removeSidebarTagFirst',
   'youhavecode.removeSidebarTagLast', 'youhavecode.clearSidebarTag',
  ]);
  const toggleTagMenu = extension.packageJSON.contributes.menus['view/item/context'].find((item: { command?: string }) => item.command === 'youhavecode.cycleSidebarTagConstraint');
  assert.strictEqual(toggleTagMenu.group, 'inline@1');
  assert.strictEqual(extension.packageJSON.contributes.commands.find((command: { command: string }) => command.command === 'youhavecode.searchSidebarTag').title, 'Toggle as Filter');
  assert.strictEqual(extension.packageJSON.contributes.commands.find((command: { command: string }) => command.command === 'youhavecode.restrictSidebarTag').title, 'Toggle as Restriction');
  const taggedGlyphMenuCommands = extension.packageJSON.contributes.menus['view/item/context']
   .filter((item: { when?: string }) => item.when?.includes('viewItem == youhavecode.tagGlyph'))
   .map((item: { command: string }) => item.command);
  assert.deepStrictEqual(taggedGlyphMenuCommands, [
   'youhavecode.sidebarInsertGlyph', 'youhavecode.copySidebarGlyph', 'youhavecode.appendSidebarGlyphToClipboard',
   'youhavecode.removeParentTagFromGlyph', 'youhavecode.manageGlyphTags', 'youhavecode.setGlyphDefaultFilter',
  ]);
  assert.strictEqual(extension.packageJSON.contributes.views.youhavecode[0].id, 'youhavecode.unicode');
  assert.ok(extension.packageJSON.contributes.commands.some((command: { command: string }) => command.command === 'youhavecode.chooseDelegateProfile'));
  const properties = extension.packageJSON.contributes.configuration.properties;
  assert.strictEqual(properties['youhavecode.compatibilityUnknownPolicy'].default, 'warn');
  assert.strictEqual(properties['youhavecode.compatibilityLocalFontPolicy'].default, 'warn');
  assert.deepStrictEqual(properties['youhavecode.compatibilityTargets'].default.ios, { version: 'current', policy: 'warn' });
  assert.deepStrictEqual(properties['youhavecode.disabledDefaultItems'].default, []);
 });
});

test('derives automatic bitmap layout directions from the D4 transform', () => {
 assert.deepStrictEqual(transformLayout('identity'), { flow: 'lr', wrap: 'ud' });
 assert.deepStrictEqual(transformLayout('rotate-90'), { flow: 'ud', wrap: 'rl' });
 assert.deepStrictEqual(transformLayout('rotate-180'), { flow: 'rl', wrap: 'du' });
 assert.deepStrictEqual(transformLayout('rotate-270'), { flow: 'du', wrap: 'lr' });
});

test('uses the requested size for Emoji Art cell dimensions', () => {
 const rows32 = rasterizeEmojiArt('🦁️', 32);
 const rows48 = rasterizeEmojiArt('🦁️', 48);
 const rows64 = rasterizeEmojiArt('🦁️', 64);
 const displayWidth = (row: string) => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(row)].reduce((width, part) => width + (part.segment.trim() ? 2 : part.segment.length), 0);
 assert.deepStrictEqual([rows32.length, rows48.length, rows64.length], [32, 48, 64]);
 assert.ok(displayWidth(rows32[0] ?? '') <= 64 && displayWidth(rows48[0] ?? '') <= 96 && displayWidth(rows64[0] ?? '') <= 128);
});

test('Emoji Art output contains colored cells or transparent spaces, never binary zeroes', async () => {
 const output = await textToBitmap('♈️', 8, 'emoji', {
  emojiArtRasterizer: () => Array.from({ length: 8 }, (_, row) => row === 0 ? '🔳'.repeat(8) : '  '.repeat(8)),
 });
 assert.ok(output.includes('🔳'));
 assert.ok(!output.includes('0'));
});

test('treats Braille Pattern Blank as spacing instead of resolving a font', async () => {
 const output = await textToBitmap('A\u2800B', 2, 'binary', {}, character => {
  if (character === '\u2800') { throw new Error('U+2800 should be treated as spacing'); }
  return ['11', '11'];
 });
 assert.match(output, /0/);
});

test('Emoji Art falls back to ordinary glyphs when no color glyph exists', () => {
 const rows = rasterizeEmojiArt('A', 16);
 assert.ok(rows.some(row => row.includes('⚫️')));
});

test('Emoji Art aligns ragged rows to one display width', async () => {
 const output = await textToBitmap('♈️', 4, 'emoji', {
  emojiArtRasterizer: () => ['🔳🔳  ', '🔳    ', '  🔳  ', '    🔳'],
 });
 const displayWidth = (line: string) => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(line)]
  .reduce((width, part) => width + (part.segment.trim() ? 2 : Array.from(part.segment).length), 0);
 const widths = output.split('\n').map(displayWidth);
 assert.ok(new Set(widths).size <= 1, `Emoji Art row widths differ: ${widths.join(', ')}`);
});

test('builds default Pretty Print precedence from editor fonts plus known platform fallbacks', () => {
 const defaults = defaultPrettyPrintFontFamilies(['Menlo', 'monospace']);
 assert.deepStrictEqual(defaults.slice(0, 2), ['Menlo', 'monospace']);
 assert.ok(defaults.includes('Apple Symbols') && defaults.includes('Apple Color Emoji') && defaults.includes('Noto Emoji'));
 assert.ok(!defaults.includes('Apple Last Resort') && !defaults.includes('.LastResort'));
});

test('preserves source line breaks across the transform-derived wrapping axis', async () => {
 const rasterizer = () => ['1'];
 assert.strictEqual(await textToBitmap('A\nB', 1, 'iphoneBlocks', { flowDirection: 'ud', wrapDirection: 'rl' }, rasterizer), '■□■');
});

test('exposes bounded Pretty Print debug sweeps only in developer mode', async () => {
 const provider = new UnicodeSidebarProvider({
  entries: async () => sampleEntries, recentHexes: () => [], usage: () => emptyUsageStats(), developerDebugMode: () => true,
 });
 const root = await provider.getChildren();
 const prettyPrint = await provider.getChildren(root.find(item => item.group === 'prettyPrint'));
 const debug = await provider.getChildren(prettyPrint.find(item => item.group === 'prettyPrintDebug')!);
 assert.deepStrictEqual(debug.map(item => [item.label, item.command?.command]), [
  ['Print With Font Precedence', 'youhavecode.printWithAllFonts'],
  ['Pretty Print All Sizes', 'youhavecode.prettyPrintAllSizes'],
  ['Pretty Print All Transforms', 'youhavecode.prettyPrintAllTransforms'],
  ['Pretty Print All Types', 'youhavecode.prettyPrintAllTypes'],
 ]);
});

test('uses persisted bitmap output names for Pretty Print labels', async () => {
 const provider = new UnicodeSidebarProvider({
  entries: async () => sampleEntries, recentHexes: () => [], usage: () => emptyUsageStats(),
  prettyPrintDefaults: () => ({ output: 'iphone-blocks', size: '32x32', wrap: 'auto', compact: 'on', mapping: 'square', flow: 'auto', 'wrap-direction': 'auto', d4: 'identity' }),
 });
 const root = await provider.getChildren();
 const prettyPrint = await provider.getChildren(root.find(item => item.group === 'prettyPrint'));
 const settings = await provider.getChildren(prettyPrint.find(item => item.group === 'prettyPrintSettings')!);
 assert.strictEqual(settings.find(item => item.group === 'prettyPrintOutput')?.label, 'Pretty Print Type');
 assert.strictEqual(settings.find(item => item.group === 'prettyPrintOutput')?.description, 'Solid Square Art');
});

test('marks a non-preset Pretty Print size as the selected custom size', async () => {
 const provider = new UnicodeSidebarProvider({
  entries: async () => sampleEntries, recentHexes: () => [], usage: () => emptyUsageStats(),
  prettyPrintDefaults: () => ({ output: 'braille', size: '49x49', wrap: 'auto', compact: 'on', mapping: 'square', flow: 'auto', 'wrap-direction': 'auto', d4: 'identity' }),
 });
 const root = await provider.getChildren();
 const prettyPrint = await provider.getChildren(root.find(item => item.group === 'prettyPrint'));
 const settings = await provider.getChildren(prettyPrint.find(item => item.group === 'prettyPrintSettings')!);
 const size = await provider.getChildren(settings.find(item => item.group === 'prettyPrintSize')!);
 const custom = size.find(item => item.label === 'Custom size…')!;
 assert.deepStrictEqual([custom.description, custom.iconPath instanceof vscode.ThemeIcon ? custom.iconPath.id : undefined], ['selected', 'check']);
});

suite('Unicode completions', () => {
 test('offers hidden developer/debug mode controls through signed debug tokens', async () => {
  await vscode.commands.executeCommand('youhavecode.setDeveloperDebugMode', false);
  try {
   const enableDocument = await vscode.workspace.openTextDocument({ language: 'plaintext', content: '::+debug' });
  const enableEditor = await vscode.window.showTextDocument(enableDocument);
  enableEditor.selection = new vscode.Selection(0, enableDocument.getText().length, 0, enableDocument.getText().length);
   const enableCompletions = await vscode.commands.executeCommand<vscode.CompletionList>(
    'vscode.executeCompletionItemProvider', enableDocument.uri, new vscode.Position(0, 7), ':',
   );
  const enable = enableCompletions.items.find(item => (typeof item.label === 'string' ? item.label : item.label.label).includes('Enable Developer/Debug Mode'))!;
  assert.ok(enable, JSON.stringify(enableCompletions.items.map(item => typeof item.label === 'string' ? item.label : item.label.label)));
   assert.strictEqual(enable.command?.command, 'youhavecode.setDeveloperDebugMode');
   await vscode.commands.executeCommand(enable.command!.command, ...(enable.command!.arguments ?? []));
  assert.strictEqual(enableDocument.getText(), '::');

   const disableDocument = await vscode.workspace.openTextDocument({ language: 'plaintext', content: '::-debug' });
  const disableEditor = await vscode.window.showTextDocument(disableDocument);
  disableEditor.selection = new vscode.Selection(0, disableDocument.getText().length, 0, disableDocument.getText().length);
   const disableCompletions = await vscode.commands.executeCommand<vscode.CompletionList>(
    'vscode.executeCompletionItemProvider', disableDocument.uri, new vscode.Position(0, 8), ':',
   );
   const disable = disableCompletions.items.find(item => (typeof item.label === 'string' ? item.label : item.label.label).includes('Disable Developer/Debug Mode'))!;
  assert.ok(disable, JSON.stringify(disableCompletions.items.map(item => typeof item.label === 'string' ? item.label : item.label.label)));
   assert.strictEqual(disable.command?.command, 'youhavecode.setDeveloperDebugMode');
  await vscode.commands.executeCommand(disable.command!.command, ...(disable.command!.arguments ?? []));
  assert.strictEqual(disableDocument.getText(), '::');
  } finally {
   await vscode.commands.executeCommand('youhavecode.setDeveloperDebugMode', false);
  }
 });

 test('parses Unicode representation modifiers through the shared query grammar', () => {
  const prefixes = ['\\u*', '\\u:', '\\u#', '\\u&', '\\u\\', '\\u'];
  assert.deepStrictEqual(prefixes.map(prefix => parseUnicodeQuery(`${prefix}rocket`, prefixes)?.representation), [
  'prettyPrint', 'glyph', 'codepoint', 'htmlEntity', 'languageEscape', 'languageEscape',
  ]);
  const spaced = parseUnicodeQuery('\\u:emoji rocket', prefixes)!;
  assert.deepStrictEqual(spaced.words, ['EMOJI']);
  assert.strictEqual(spaced.draft, 'rocket');
  const script = parseUnicodeQuery('\\u:script=Greek', prefixes)!;
  assert.strictEqual(script.mode, 'filterValue');
  assert.strictEqual(script.filterKey, 'lang');
  assert.strictEqual(script.draft, 'Greek');
 });

 test('replaces Unicode modifier expressions with their requested representation', async () => {
  const cases = [
   { query: '\\u:203D', expected: '‽' },
   { query: '\\u#203D', expected: 'U+203D' },
   { query: '\\u&203D', expected: '&#x203D;' },
   { query: '\\u\\1F512', expected: '\\u{1F512}' },
   { query: '\\u1F512', expected: '\\u{1F512}' },
  ];
  for (const { query, expected } of cases) {
   const document = await vscode.workspace.openTextDocument({ language: 'javascript', content: query });
   const editor = await vscode.window.showTextDocument(document);
   editor.selection = new vscode.Selection(0, query.length, 0, query.length);
   await vscode.commands.executeCommand('youhavecode.insertBestGlyph');
   assert.strictEqual(document.getText(), expected);
  }
 });

 test('pretty prints a Unicode query with the \\u* shortcut', async () => {
  const configuration = vscode.workspace.getConfiguration('youhavecode');
  await Promise.all([
   configuration.update('defaultOutput', 'glyph', vscode.ConfigurationTarget.Global),
   configuration.update('bitmapSize', 8, vscode.ConfigurationTarget.Global),
  ]);
  const content = '\\u*203D';
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, content.length, 0, content.length);
  await vscode.commands.executeCommand('youhavecode.insertBestGlyph');
  assert.doesNotMatch(document.getText(), /\\u\*203D/);
  assert.match(document.getText(), /^[\u2800-\u28ff\n]+$/u);
  await Promise.all([
   configuration.update('defaultOutput', undefined, vscode.ConfigurationTarget.Global),
   configuration.update('bitmapSize', undefined, vscode.ConfigurationTarget.Global),
  ]);
 });

 test('pretty prints a double-colon query with a terminal star', async () => {
  const configuration = vscode.workspace.getConfiguration('youhavecode');
  await Promise.all([
   configuration.update('defaultOutput', 'glyph', vscode.ConfigurationTarget.Global),
   configuration.update('bitmapSize', 8, vscode.ConfigurationTarget.Global),
  ]);
  const content = '::203D*';
  const query = parseUnicodeQuery(content, ['::']);
  assert.strictEqual(query?.representation, 'prettyPrint');
  assert.strictEqual(query?.draft, '203D');
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, content.length, 0, content.length);
  await vscode.commands.executeCommand('youhavecode.insertBestGlyph');
  assert.doesNotMatch(document.getText(), /::203D\*/);
  assert.match(document.getText(), /^[\u2800-\u28ff\n]+$/u);
  await Promise.all([
   configuration.update('defaultOutput', undefined, vscode.ConfigurationTarget.Global),
   configuration.update('bitmapSize', undefined, vscode.ConfigurationTarget.Global),
  ]);
 });

 test('normalizes an unwrapped script filter before glyph selection', async () => {
  const content = '\\u:script=Greek';
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, content.length, 0, content.length);
  await vscode.commands.executeCommand('youhavecode.insertBestGlyph');
  assert.strictEqual(document.getText(), '\\u:(lang=GREEK)');
 });

 test('treats bare text as a default name-word filter', () => {
  const query = parseUnicodeQuery('const glyph = u:cl');
  assert.strictEqual(query?.draft, 'cl');
    assert.strictEqual(matchingWords(buildNameWords(sampleEntries), query!.draft)[0].value, 'CLOSED');
 });

 test('keeps STAR-prefixed glyph matches beneath the exact STAR filter chip', () => {
  const entries = [
   { ...sampleEntries[1], hex: '2605', character: '★', name: 'BLACK STAR' },
   { ...sampleEntries[1], hex: '2401', character: '␁', name: 'SYMBOL FOR START OF HEADING' },
   { ...sampleEntries[1], hex: '2728', character: '✨', name: 'SPARKLES' },
  ];
  const query = parseUnicodeQuery(':::star', ['u:', ':::', '::'])!;
  assert.strictEqual(matchingWords(buildNameWords(entries), query.draft)[0].value, 'STAR');
  assert.deepStrictEqual(matchingEntries(entries, query).map(entry => entry.name), [
   'BLACK STAR', 'SYMBOL FOR START OF HEADING',
  ]);
  assert.deepStrictEqual(matchingEntries(entries, parseUnicodeQuery(':::(star)', ['u:', ':::', '::'])!).map(entry => entry.name), [
   'BLACK STAR',
  ]);
 });

 test('maps a literal period to its friendly and formal Unicode name words', () => {
  const entries = [{ ...sampleEntries[1], hex: '2E', character: '.', name: 'FULL STOP' }];
  assert.deepStrictEqual(literalNameWords(entries, '.').map(word => word.value), ['PERIOD', 'FULL', 'STOP']);
  assert.deepStrictEqual(matchingEntries(entries, parseUnicodeQuery('u:(period)')!).map(entry => entry.character), ['.']);
 });

 test('ORs words within one group while separate groups remain ANDed', () => {
  assert.deepStrictEqual(matchingEntries(sampleEntries, parseUnicodeQuery('u:(white|black)(circle)')!).map(entry => entry.name), ['WHITE CIRCLE', 'BLACK CIRCLE']);
  assert.deepStrictEqual(parseUnicodeQuery('u:(line|circle)')?.words, ['LINE|CIRCLE']);
 });

 test('ranks OR matches lexicographically by group from left to right', () => {
  const entries = [
   { ...sampleEntries[1], hex: '100', character: 'Ā', name: 'LINE CIRCLE BELOW ABOVE' },
   { ...sampleEntries[1], hex: '101', character: 'ā', name: 'LINE CIRCLE BELOW' },
   { ...sampleEntries[1], hex: '102', character: 'Ă', name: 'LINE BELOW ABOVE' },
   { ...sampleEntries[1], hex: '103', character: 'ă', name: 'LINE BELOW' },
  ];
  const query = parseUnicodeQuery('u:(line|circle)(below|above)')!;
  assert.deepStrictEqual(matchingEntries(entries, query).map(entry => entry.hex), ['100', '101', '102', '103']);
 });

 test('expands literal glyph properties into valid query syntax', () => {
  const period = { ...sampleEntries[1], hex: '2E', character: '.', name: 'FULL STOP', category: 'Po', bidi: 'CS', language: 'COMMON', block: 'Basic Latin' };
  const capitalA = { ...period, hex: '41', character: 'A', name: 'LATIN CAPITAL LETTER A', category: 'Lu', bidi: 'L', language: 'LATIN' };
  const query = parseUnicodeQuery('::.?n', ['u:', ':::', '::']);
  assert.strictEqual(query?.mode, 'glyphProperty');
  assert.strictEqual(query?.glyphLiteral, '.');
  assert.strictEqual(query?.draft, 'n');
  assert.deepStrictEqual(glyphPropertyInputLabels(''), ['?name', '?bidi', '?combining', '?category', '?decomp', '?unicode', '?language', '?block', '?emoji']);
  assert.deepStrictEqual(glyphPropertyExpansions(period, 'n').map(expansion => expansion.value), ['(period)']);
  assert.deepStrictEqual(glyphPropertyExpansions(capitalA, 'name').map(expansion => expansion.value), ['(capital)(letter)(a)']);
  assert.deepStrictEqual(glyphPropertyExpansions(period, 'b').map(expansion => expansion.value), ['(bidi=CS)']);
  assert.deepStrictEqual(glyphPropertyExpansions(period, 'u').map(expansion => expansion.value), ['2E']);
  assert.strictEqual(parseUnicodeQuery('::?', ['u:', ':::', '::'])?.draft, '?');
 });

 test('completes OR alternatives and ranks five narrowing follow-up words', () => {
  const words = buildNameWords(sampleEntries);
  assert.deepStrictEqual(matchingWords(words, 'white|cir').map(word => word.value), ['WHITE|CIRCLE']);
  const followUps = topMatchingWords(sampleEntries, parseUnicodeQuery('u:(circle)')!);
  assert.ok(followUps.length <= 5);
  assert.ok(followUps.every(word => word.count > 0 && word.count < 3 && word.value !== 'CIRCLE'));
 });

 test('recognizes a Unicode query directly after existing string text', () => {
  const query = parseUnicodeQuery('{"glyph":"abcdefghu:inter');
  assert.strictEqual(query?.draft, 'inter');
  assert.strictEqual(query?.expressionStart, 18);
 });

 test('supports double colon as an optional shorthand prefix', () => {
  const query = parseUnicodeQuery('const glyph = ::inter', ['u:', '::']);
  assert.strictEqual(query?.prefix, '::');
  assert.strictEqual(query?.draft, 'inter');
  assert.strictEqual(parseUnicodeQuery('const glyph = ::inter', ['u:']), undefined);
 });

 test('treats triple colon as a distinct repeating prefix', () => {
  const query = parseUnicodeQuery('const glyph = :::inter', ['u:', ':::', '::']);
  assert.strictEqual(query?.prefix, ':::');
  assert.strictEqual(query?.expressionStart, 14);
  assert.strictEqual(query?.draft, 'inter');
 });

 test('parses hyphen and underscore name components generically', () => {
  const hyphenated = parseUnicodeQuery('::closed-rev', ['u:', ':::', '::']);
  assert.deepStrictEqual(hyphenated?.words, ['CLOSED']);
  assert.strictEqual(hyphenated?.draft, 'rev');
  assert.strictEqual(hyphenated?.separator, '-');
  assert.strictEqual(hyphenated?.draftStart, 9);

  const underscored = parseUnicodeQuery(':::closed_', ['u:', ':::', '::']);
  assert.deepStrictEqual(underscored?.words, ['CLOSED']);
  assert.strictEqual(underscored?.draft, '');
  assert.strictEqual(underscored?.separator, '_');
 });

 test('negates shorthand and parenthesized name components', () => {
  const entries = [
   { ...sampleEntries[1], hex: '100', character: 'Ā', name: 'ARROW RIGHT DOUBLE' },
   { ...sampleEntries[1], hex: '101', character: 'ā', name: 'ARROW RIGHT LEFT' },
   { ...sampleEntries[1], hex: '102', character: 'Ă', name: 'ARROW LEFT' },
  ];
  const shorthand = parseUnicodeQuery(':::arrow-right-!left', ['u:', ':::', '::'])!;
  assert.deepStrictEqual(shorthand.words, ['ARROW', 'RIGHT']);
  assert.strictEqual(shorthand.draft, '!left');
  assert.deepStrictEqual(matchingEntries(entries, shorthand).map(entry => entry.name), ['ARROW RIGHT DOUBLE']);
  assert.deepStrictEqual(matchingEntries(entries, parseUnicodeQuery('u:(arrow)(right)(!left)')!).map(entry => entry.name), ['ARROW RIGHT DOUBLE']);
  assert.strictEqual(matchingWords(buildNameWords(entries), '!lef')[0].value, '!LEFT');
 });

 test('parses output options separately from glyph filters', () => {
  const query = parseUnicodeQuery(':::(*print)(bidi=ON)(output=braille)(size=16x16)(wrap=32)(compact=on)(flow=ud)(wrap-direction=rl)(*d4=rotate-90)circle', ['u:', ':::', '::'])!;
  assert.deepStrictEqual(query.actions, ['print']);
  assert.deepStrictEqual(query.filters, [{ key: 'bidi', value: 'ON' }]);
  assert.deepStrictEqual(query.options, [
  { key: 'output', value: 'braille' }, { key: 'size', value: '16x16' }, { key: 'wrap', value: '32' }, { key: 'compact', value: 'on' },
  { key: 'flow', value: 'ud' }, { key: 'wrap-direction', value: 'rl' }, { key: 'd4', value: 'rotate-90' },
  ]);
  assert.strictEqual(query.draft, 'circle');
 });

 test('normalizes the language alias and matches language and block values', () => {
  const language = parseUnicodeQuery('::(language=LATIN)', ['u:', ':::', '::'])!;
  assert.deepStrictEqual(language.filters, [{ key: 'lang', value: 'LATIN' }]);
  assert.deepStrictEqual(language.tokens, ['(lang=LATIN)']);
  assert.deepStrictEqual(parseUnicodeQuery('::(script=LATIN)', ['u:', ':::', '::'])?.filters, [{ key: 'lang', value: 'LATIN' }]);
  assert.deepStrictEqual(matchingEntries(sampleEntries, language).map(entry => entry.name), ['LATIN SMALL LETTER CLOSED REVERSED OPEN E']);
  assert.deepStrictEqual(matchingEntries(sampleEntries, parseUnicodeQuery('::(block=Geometric Shapes)', ['u:', ':::', '::'])!).map(entry => entry.name), ['WHITE CIRCLE', 'BLACK CIRCLE']);
 });

 test('applies default filters while explicit filters override the same property', () => {
  const defaults = { bidi: 'ON', category: 'So' } as const;
  const inherited = withDefaultFilters(parseUnicodeQuery('u:circle')!, defaults);
  assert.deepStrictEqual(matchingEntries(sampleEntries, inherited).map(entry => entry.name), ['WHITE CIRCLE', 'BLACK CIRCLE', 'HEAVY CIRCLE']);
  const overridden = withDefaultFilters(parseUnicodeQuery('u:(bidi=L)closed')!, defaults);
  assert.deepStrictEqual(overridden.defaultFilters, [{ key: 'category', value: 'So' }]);
  assert.deepStrictEqual(matchingEntries(sampleEntries, overridden), []);
 });

 test('accumulates default name and tag terms', () => {
  const query = withDefaultFilters(parseUnicodeQuery('u:(circle)')!, {}, ['favorite', 'symbol']);
  assert.deepStrictEqual(query.words, ['FAVORITE', 'SYMBOL', 'CIRCLE']);
 });

 test('filters default-color and text-presentation emoji separately', () => {
  const entries = [sampleEntries[4], { ...sampleEntries[0], hex: '23', character: '#', name: 'NUMBER SIGN', block: 'Basic Latin' }];
  assert.deepStrictEqual(matchingEntries(entries, parseUnicodeQuery('u:(emoji=COLOR)')!).map(entry => entry.character), ['🔒']);
  assert.deepStrictEqual(matchingEntries(entries, parseUnicodeQuery('u:(emoji=TEXT)')!).map(entry => entry.character), ['#']);
 });

 test('matches repeated literal glyphs regardless of emoji presentation selectors', () => {
  const pisces = { ...sampleEntries[4], hex: '2653', character: '♓', name: 'PISCES', block: 'Miscellaneous Symbols' };
  assert.deepStrictEqual(matchingEntries([pisces], parseUnicodeQuery('u:♓︎♓️')!).map(entry => entry.hex), ['2653']);
 });

 test('hides the merged *print suggestion but preserves typed print options', async () => {
  const draftDocument = await vscode.workspace.openTextDocument({ language: 'plaintext', content: '::*pri' });
  const draft = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', draftDocument.uri, new vscode.Position(0, 6),
  );
  assert.ok(!draft.items.some(item => item.label === '*print'));

  const actionDocument = await vscode.workspace.openTextDocument({ language: 'plaintext', content: '::(*print)' });
  const options = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', actionDocument.uri, new vscode.Position(0, 10),
  );
  for (const label of ['(output=…)', '(size=…)', '(wrap=…)', '(compact=…)', '(flow=…)', '(wrap-direction=…)', '(*d4=…)']) {
   assert.ok(options.items.some(item => item.label === label));
  }
 });

 test('treats render and output as aliases with the last value winning', () => {
  const query = parseUnicodeQuery(':::(output=unicode)(render=braille)', ['u:', ':::', '::'])!;
  assert.strictEqual(queryOption(query, 'render'), 'braille');
  assert.strictEqual(queryOption(query, 'output'), 'braille');
  assert.deepStrictEqual(optionValues('output', ''), [
   'glyph', 'components', 'unicode', 'codepoint', 'name', 'details', 'full', 'braille',
  'block-elements', 'iphone-blocks', 'emoji', 'binary', 'hex',
  ]);
  assert.deepStrictEqual(optionValues('render', ''), optionValues('output', ''));
 });

 test('parses chained default and named filter chips', () => {
  const query = parseUnicodeQuery('u:(circle)(bidi=ON)');
  assert.deepStrictEqual(query?.words, ['CIRCLE']);
  assert.deepStrictEqual(query?.filters, [{ key: 'bidi', value: 'ON' }]);
  assert.deepStrictEqual(matchingEntries(sampleEntries, query!).map(entry => entry.name), ['WHITE CIRCLE', 'BLACK CIRCLE', 'HEAVY CIRCLE']);
 });

 test('ANDs name tokens and ORs repeated values within one property family', () => {
  assert.deepStrictEqual(matchingEntries(sampleEntries, parseUnicodeQuery('u:(circle)(black)')!).map(entry => entry.name), ['BLACK CIRCLE']);
  const repeated = parseUnicodeQuery('u:(bidi=L)(bidi=ON)')!;
  assert.deepStrictEqual(repeated.filters, [{ key: 'bidi', value: 'L|ON' }]);
  assert.deepStrictEqual(matchingEntries(sampleEntries, repeated).map(entry => entry.name), sampleEntries.map(entry => entry.name));
  assert.deepStrictEqual(matchingEntries(sampleEntries, parseUnicodeQuery('u:(bidi=L|ON)(category=So)')!).map(entry => entry.name), [
   'WHITE CIRCLE', 'BLACK CIRCLE', 'HEAVY CIRCLE', 'LOCK',
  ]);
 });

 test('deduplicates repeated words, filters, and output aliases with the last occurrence winning', () => {
  const query = parseUnicodeQuery('u:(circle)(black)(circle)(bidi=ON)(bidi=ON)(output=name)(render=hex)')!;
  assert.deepStrictEqual(query.words, ['BLACK', 'CIRCLE']);
  assert.deepStrictEqual(query.filters, [{ key: 'bidi', value: 'ON' }]);
  assert.deepStrictEqual(query.options, [{ key: 'render', value: 'hex' }]);
  assert.deepStrictEqual(query.tokens, ['(black)', '(circle)', '(bidi=ON)', '(render=hex)']);
 });

 test('parses custom-tag edits without using them as filters', () => {
  const query = parseUnicodeQuery(':::(+=favorites)(-=later)(--obsolete)(star)', ['u:', ':::', '::'])!;
  assert.deepStrictEqual(query.tagEdits, [
   { operation: 'add', tag: 'favorites' },
   { operation: 'remove', tag: 'later' },
   { operation: 'delete', tag: 'obsolete' },
  ]);
  assert.deepStrictEqual(query.words, ['STAR']);
  assert.deepStrictEqual(query.tokens, ['(star)']);
  assert.deepStrictEqual(parseUnicodeQuery('::(--fav', ['u:', ':::', '::'])?.tagOperation, 'delete');
  for (const text of ['_::+favorite', '_::+=favorite', '_::+favorite)', '_::+=favorite)']) {
   const direct = parseUnicodeQuery(text, ['u:', ':::', '::'])!;
   assert.deepStrictEqual([direct.mode, direct.tagOperation, direct.unwrappedTag, direct.draft], ['tagValue', 'add', true, 'favorite']);
  }
 });

 test('deletes a custom tag from every glyph without disturbing other tags', () => {
  assert.deepStrictEqual(applyCustomTagEdits({ A: ['shared', 'alpha'], B: ['shared'], C: ['other'] }, 'A', [
   { operation: 'delete', tag: 'shared' },
  ]), { A: ['alpha'], C: ['other'] });
 });

 test('matches custom tags like name words and ANDs them with other words', () => {
  const customTags = { '25CF': ['favorites'], '203D': ['favorites'] };
  assert.deepStrictEqual(matchingEntries(sampleEntries, parseUnicodeQuery('u:(favorites)')!, 100, customTags).map(entry => entry.name), [
   'BLACK CIRCLE', 'INTERROBANG',
  ]);
  assert.deepStrictEqual(matchingEntries(sampleEntries, parseUnicodeQuery('u:(circle)(favorites)')!, 100, customTags).map(entry => entry.name), ['BLACK CIRCLE']);
  assert.strictEqual(buildNameWords(sampleEntries, customTags).find(word => word.value === 'FAVORITES')?.count, 2);
 });

 test('counts property choices without applying the existing value from that family', () => {
  const query = parseUnicodeQuery('u:(bidi=L)')!;
  const counts = countFilterValues(sampleEntries, query, 'bidi', ['L', 'ON']);
  assert.strictEqual(counts.get('L'), 1);
  assert.strictEqual(counts.get('ON'), 5);
 });

 test('treats emoji as a Unicode-property search term', () => {
  const direct = parseUnicodeQuery('u:emoji')!;
  const chained = parseUnicodeQuery('u:(emoji)(category=So)')!;
  assert.ok(matchingWords(buildNameWords(sampleEntries), 'emo').some(word => word.value === 'EMOJI'));
  assert.deepStrictEqual(matchingEntries(sampleEntries, direct).map(entry => entry.name), ['LOCK']);
  assert.deepStrictEqual(matchingEntries(sampleEntries, chained).map(entry => entry.name), ['LOCK']);
 });

 test('suggests values while a named filter is open', () => {
  const query = parseUnicodeQuery('u:(circle)(bidi=O');
  assert.strictEqual(query?.mode, 'filterValue');
  assert.strictEqual(query?.filterKey, 'bidi');
  assert.deepStrictEqual(filterValues(sampleEntries, query!.filterKey!, query!.draft), ['ON', '!ON']);
 });

 test('shows friendly names beside positive and negated property values', async () => {
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: '::(bidi=' });
  const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, new vscode.Position(0, 8),
  );
  const label = (value: string) => {
   const item = completions.items.find(candidate => typeof candidate.label !== 'string' && candidate.label.label === `(bidi=${value})`);
   return item && typeof item.label !== 'string' ? item.label : undefined;
  };
  assert.match(label('BN')?.description ?? '', /^Boundary Neutral · [\d,]+ glyphs$/);
  assert.match(label('!BN')?.description ?? '', /^Not Boundary Neutral · [\d,]+ glyphs$/);
 });

 test('shows counted chips for every property filter family', async () => {
  const query = parseUnicodeQuery(':::', ['u:', ':::', '::'])!;
  for (const key of ['category', 'bidi', 'combining', 'decomp'] as const) {
   const values = filterValues(sampleEntries, key, '');
   const counts = countFilterValues(sampleEntries, query, key, values);
   assert.ok(values.length > 0);
   assert.ok(values.every(value => Number.isInteger(counts.get(value))));
  }
 });

 test('ranks negated values after positive values and inverts matching', () => {
  const values = filterValues(sampleEntries, 'bidi', '');
  assert.ok(values.indexOf('ON') < values.indexOf('!ON'));
  assert.deepStrictEqual(filterValues(sampleEntries, 'bidi', '!O'), ['!ON']);
  const query = parseUnicodeQuery('u:(bidi=!ON)')!;
  assert.deepStrictEqual(matchingEntries(sampleEntries, query).map(entry => entry.name), ['LATIN SMALL LETTER CLOSED REVERSED OPEN E']);
  const mixedEntries = [...sampleEntries, { ...sampleEntries[0], hex: '41', character: 'A', name: 'LATIN CAPITAL LETTER A', bidi: 'L' }];
  assert.deepStrictEqual(matchingEntries(mixedEntries, query).map(entry => entry.name), [
   'LATIN SMALL LETTER CLOSED REVERSED OPEN E', 'LATIN CAPITAL LETTER A',
  ]);
  assert.deepStrictEqual(matchingEntries(sampleEntries, parseUnicodeQuery('u:(bidi=!on)')!).map(entry => entry.name), [
   'LATIN SMALL LETTER CLOSED REVERSED OPEN E',
  ]);
 });

 test('accepting a property key reopens its value menu', async () => {
  let triggeredRequests = 0;
  const probe = vscode.languages.registerCompletionItemProvider({ language: 'plaintext' }, {
   provideCompletionItems: () => { triggeredRequests++; return []; },
  });
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: '::bidi' });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, 6, 0, 6);
  const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, editor.selection.active,
  );
  const property = completions.items.find(item => item.label === '(bidi=…)')!;
  assert.ok(property.range && !(property.range instanceof vscode.Range));
  const range = (property.range as { replacing: vscode.Range }).replacing;
  await editor.edit(builder => builder.replace(range, String(property.insertText)));
  editor.selection = new vscode.Selection(0, document.lineAt(0).text.length, 0, document.lineAt(0).text.length);
  assert.strictEqual(document.getText(), '::(bidi=');
  assert.strictEqual(parseUnicodeQuery(document.getText(), ['u:', ':::', '::'])?.mode, 'filterValue');
  triggeredRequests = 0;
  await vscode.commands.executeCommand(property.command!.command, ...property.command!.arguments ?? []);
  await new Promise(resolve => setTimeout(resolve, 250));
  probe.dispose();
  assert.ok(triggeredRequests > 0);
 });

 test('Tab accepts a property-key preview and reopens its value menu', async () => {
  let triggeredRequests = 0;
  const probe = vscode.languages.registerCompletionItemProvider({ language: 'plaintext' }, {
   provideCompletionItems: () => { triggeredRequests++; return []; },
  });
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: '::bidi' });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, 6, 0, 6);
  triggeredRequests = 0;
  await vscode.commands.executeCommand('youhavecode.insertBestGlyph');
  assert.strictEqual(document.getText(), '::(bidi=');
  await new Promise(resolve => setTimeout(resolve, 250));
  probe.dispose();
  assert.ok(triggeredRequests > 0);
 });

 test('widget acceptance reopens property values and the root menu after tokens', async function () {
  this.timeout(5000);
  let triggeredRequests = 0;
  const probe = vscode.languages.registerCompletionItemProvider({ language: 'plaintext' }, {
   provideCompletionItems: () => { triggeredRequests++; return []; },
  });

  const propertyDocument = await vscode.workspace.openTextDocument({ language: 'plaintext', content: ':::bidi' });
  const propertyEditor = await vscode.window.showTextDocument(propertyDocument);
  propertyEditor.selection = new vscode.Selection(0, 7, 0, 7);
  await vscode.commands.executeCommand('editor.action.triggerSuggest');
  await new Promise(resolve => setTimeout(resolve, 600));
  triggeredRequests = 0;
  await vscode.commands.executeCommand('acceptSelectedSuggestion');
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.strictEqual(propertyDocument.getText(), ':::(bidi=');
  assert.ok(triggeredRequests > 0);

  const wordDocument = await vscode.workspace.openTextDocument({ language: 'plaintext', content: ':::star' });
  const wordEditor = await vscode.window.showTextDocument(wordDocument);
  wordEditor.selection = new vscode.Selection(0, 7, 0, 7);
  await vscode.commands.executeCommand('editor.action.triggerSuggest');
  await new Promise(resolve => setTimeout(resolve, 600));
  triggeredRequests = 0;
  await vscode.commands.executeCommand('acceptSelectedSuggestion');
  await new Promise(resolve => setTimeout(resolve, 400));
  probe.dispose();
  assert.strictEqual(wordDocument.getText(), ':::(star)');
  assert.ok(triggeredRequests > 0);
 });

 test('triple-colon property tokens reopen the value and filtered result menus', async () => {
  let triggeredRequests = 0;
  const probe = vscode.languages.registerCompletionItemProvider({ language: 'plaintext' }, {
   provideCompletionItems: () => { triggeredRequests++; return []; },
  });
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: ':::bidi' });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, 7, 0, 7);

  triggeredRequests = 0;
  await vscode.commands.executeCommand('youhavecode.insertBestGlyph');
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.strictEqual(document.getText(), ':::(bidi=');
  assert.ok(triggeredRequests > 0);
  const values = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, editor.selection.active,
  );
  assert.ok(values.items.some(item => typeof item.label !== 'string' && item.label.label === '(bidi=ON)' && /^\d[\d,]* glyphs$/.test(item.detail ?? '')));

  await editor.edit(builder => builder.insert(editor.selection.active, 'O'));
  triggeredRequests = 0;
  await vscode.commands.executeCommand('youhavecode.insertBestGlyph');
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.strictEqual(document.getText(), ':::(bidi=ON)');
  assert.ok(triggeredRequests > 0);
  const results = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, editor.selection.active,
  );
  probe.dispose();
  assert.ok(results.items.some(item => typeof item.label !== 'string' && item.detail?.includes('Bidi ON')));
 });

 test('prefers recent glyphs and falls back to initial results when empty', () => {
  assert.deepStrictEqual(initialEntries(sampleEntries, ['1F512', '25CB']).map(entry => entry.name), ['LOCK', 'WHITE CIRCLE']);
  assert.deepStrictEqual(initialEntries(sampleEntries, [], 2).map(entry => entry.name), ['LATIN SMALL LETTER CLOSED REVERSED OPEN E', 'WHITE CIRCLE']);
 });

 test('provides glyph completions inside a JSON string', async () => {
  const document = await vscode.workspace.openTextDocument({ language: 'json', content: '{"glyph":"u:"}' });
  const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, new vscode.Position(0, 12), ':',
  );
  assert.ok(completions.items.some(item => typeof item.label !== 'string' && item.label.label.includes('U+')));
 });

 test('finds supplementary and ZWJ emoji from the RGI catalog', async () => {
  const cases = [
   { query: '::grinning', character: '😀', name: 'GRINNING FACE' },
   { query: '::technologist', character: '🧑‍💻', name: 'TECHNOLOGIST' },
  ];
  for (const expected of cases) {
   const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: expected.query });
   const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
    'vscode.executeCompletionItemProvider', document.uri, new vscode.Position(0, expected.query.length),
   );
   assert.ok(completions.items.some(item => typeof item.label !== 'string'
    && item.label.label.startsWith(expected.character) && item.label.description === expected.name));
  }
 });

 test('uses full CLDR words for emoji follow-up tags', async () => {
  const content = ':::(cat)(emoji)';
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content });
  const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, new vscode.Position(0, content.length),
  );
  const labels = completions.items.filter(item => item.kind === vscode.CompletionItemKind.Keyword)
   .map(item => typeof item.label === 'string' ? item.label : item.label.label);
  assert.ok(!labels.includes('(s)') && !labels.includes('(e)'));
  assert.ok(labels.includes('(with)'));
 });

 test('ranks a literal semantic alias before its exact punctuation glyph', async () => {
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: '::.' });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, 3, 0, 3);
  const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, new vscode.Position(0, 3),
  );
  const periodGlyph = completions.items.find(item => typeof item.label !== 'string' && item.label.description === 'FULL STOP')!;
  const periodWord = completions.items.find(item => typeof item.label !== 'string' && item.label.label === '(period)')!;
  assert.ok(periodWord.preselect);
  assert.ok(periodWord.sortText! < periodGlyph.sortText!);
  assert.strictEqual(periodWord.insertText, '(period)');
  await vscode.commands.executeCommand('youhavecode.insertBestGlyph');
  assert.strictEqual(document.getText(), '::(period)');
 });

 test('expands a leading question mark into its semantic name in JavaScript', async () => {
  const document = await vscode.workspace.openTextDocument({ language: 'javascript', content: '' });
  const editor = await vscode.window.showTextDocument(document);
  await editor.edit(builder => builder.insert(editor.selection.active, '::?'));
  editor.selection = new vscode.Selection(0, 3, 0, 3);
  await new Promise(resolve => setTimeout(resolve, 600));
  await vscode.commands.executeCommand('acceptSelectedSuggestion');
  assert.strictEqual(document.getText(), '::(question)(mark)');
 });

 test('shows five counted follow-up tags after a completed word chip', async () => {
  const content = ':::(line)';
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, content.length, 0, content.length);
  const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, new vscode.Position(0, content.length),
  );
  const words = completions.items.filter(item => item.kind === vscode.CompletionItemKind.Keyword);
  assert.ok(words.length > 0 && words.length <= 5);
  assert.ok(words.every(item => typeof item.label !== 'string' && Number.parseInt(item.label.description ?? '0', 10) > 1));
  assert.ok(words.every(item => item.sortText?.startsWith('!1')));
  const topLabel = typeof words[0].label === 'string' ? words[0].label : words[0].label.label;
  assert.strictEqual(topLabel, '(with)');
  await vscode.commands.executeCommand('youhavecode.insertBestGlyph');
  assert.strictEqual(document.getText(), `${content}${topLabel}`);
 });

 test('completes OR groups and inspects a literal glyph inline', async () => {
  const orContent = '::(circle|hea';
  const orDocument = await vscode.workspace.openTextDocument({ language: 'plaintext', content: orContent });
  const orCompletions = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', orDocument.uri, new vscode.Position(0, orContent.length),
  );
  assert.ok(orCompletions.items.some(item => typeof item.label !== 'string' && item.label.label === '(circle|heavy)'));

  const bareInspectContent = ':::.?';
  const bareInspectDocument = await vscode.workspace.openTextDocument({ language: 'plaintext', content: bareInspectContent });
  const bareInspectCompletions = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', bareInspectDocument.uri, new vscode.Position(0, bareInspectContent.length), '?',
  );
  assert.deepStrictEqual(bareInspectCompletions.items.map(item => typeof item.label === 'string' ? item.label : item.label.label), [
   '?name', '?bidi', '?combining', '?category', '?decomp', '?unicode', '?language', '?block', '?emoji',
  ]);

  const inspectContent = '::.?n';
  const inspectDocument = await vscode.workspace.openTextDocument({ language: 'plaintext', content: inspectContent });
  const inspectEditor = await vscode.window.showTextDocument(inspectDocument);
  inspectEditor.selection = new vscode.Selection(0, inspectContent.length, 0, inspectContent.length);
  const inspectCompletions = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', inspectDocument.uri, inspectEditor.selection.active,
  );
  const name = inspectCompletions.items.find(item => typeof item.label !== 'string' && item.label.label === '?n');
  assert.strictEqual(name?.insertText, '(period)');
  await vscode.commands.executeCommand('youhavecode.insertBestGlyph');
  assert.strictEqual(inspectDocument.getText(), '::(period)');
 });

 test('shows a bare literal inspector in uncommented JavaScript', async () => {
  const document = await vscode.workspace.openTextDocument({ language: 'javascript', content: '' });
  const editor = await vscode.window.showTextDocument(document);
  await editor.edit(builder => builder.insert(editor.selection.active, ':::.?'));
  editor.selection = new vscode.Selection(0, 5, 0, 5);
  await new Promise(resolve => setTimeout(resolve, 600));
  await vscode.commands.executeCommand('acceptSelectedSuggestion');
  assert.strictEqual(document.getText(), ':::(period)');
 });

 test('sorts counted word tags above glyphs and keeps Properties after glyphs', async () => {
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: 'u:' });
  const initial = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, new vscode.Position(0, 2), ':',
  );
  const glyph = initial.items.find(item => typeof item.label !== 'string' && item.label.label.includes('U+'));
  const property = initial.items.find(item => item.label === 'Properties…');
  assert.ok(glyph?.sortText?.startsWith('!2'));
  assert.strictEqual(property?.sortText, '!70');

  const matchedDocument = await vscode.workspace.openTextDocument({ language: 'plaintext', content: 'u:inter' });
  const matched = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', matchedDocument.uri, new vscode.Position(0, 7),
  );
  const matchedGlyph = matched.items.find(item => typeof item.label !== 'string' && item.label.description?.includes('INTERROBANG'));
  const wordTag = matched.items.find(item => typeof item.label !== 'string' && item.label.label === '(interrobang)');
  assert.match(wordTag?.detail ?? '', /^Name word · [\d,]+ glyphs$/);
  assert.match(typeof wordTag?.label === 'string' ? '' : wordTag?.label.description ?? '', /^[\d,]+ glyphs$/);
  assert.ok(matchedGlyph?.sortText && wordTag?.sortText && wordTag.sortText < matchedGlyph.sortText);
 });

 test('Tab accepts an exact counted word tag before its glyph matches', async () => {
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: '::interrobang' });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, 13, 0, 13);
  await vscode.commands.executeCommand('youhavecode.insertBestGlyph');
  assert.strictEqual(document.getText(), '::(interrobang)');
  await vscode.commands.executeCommand('youhavecode.insertBestGlyph');
  assert.notStrictEqual(document.getText(), '::(interrobang)');
 });

 test('keeps a completed triple-colon word tag as an active empty-draft query', () => {
  const query = parseUnicodeQuery(':::(line)', ['u:', ':::', '::']);
  assert.strictEqual(query?.prefix, ':::');
  assert.deepStrictEqual(query?.words, ['LINE']);
  assert.strictEqual(query?.draft, '');
  assert.strictEqual(query?.mode, 'token');
 });

test('routes Enter and Tab through the visible selected suggestion', () => {
  const extension = vscode.extensions.all.find(candidate => candidate.packageJSON.name === 'youhavecode')!;
  const bindings = extension.packageJSON.contributes.keybindings.filter((binding: { command: string }) => binding.command === 'youhavecode.acceptSelectedSuggestion');
  assert.deepStrictEqual(bindings.map((binding: { key: string }) => binding.key).sort(), ['enter', 'tab']);
  bindings.forEach((binding: { when: string }) => assert.strictEqual(
   binding.when,
   'editorTextFocus && suggestWidgetVisible && youhavecode.queryActive',
  ));
});

 test('keeps Unicode glyph completions after accepting a triple-colon word tag', async () => {
  let triggeredRequests = 0;
  const probe = vscode.languages.registerCompletionItemProvider({ language: 'plaintext' }, {
   provideCompletionItems: () => { triggeredRequests++; return []; },
  });
  const content = ':::lin';
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, content.length, 0, content.length);
  triggeredRequests = 0;
  await vscode.commands.executeCommand('youhavecode.insertBestGlyph');
  await new Promise(resolve => setTimeout(resolve, 300));
  const filtered = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, editor.selection.active,
  );
  probe.dispose();
  assert.strictEqual(document.getText(), ':::(line)');
  assert.ok(triggeredRequests > 0);
  assert.ok(filtered.items.some(item => typeof item.label !== 'string' && item.label.description?.includes('LINE')));
  assert.ok(filtered.items.some(item => item.label === 'Properties…'));
 });

 test('native post-tag menu inserts a selected Unicode glyph across host languages', async function () {
  this.timeout(8_000);
  for (const language of ['plaintext', 'html', 'javascript', 'json']) {
   const content = language === 'json' ? '{"glyph":":::(line)"}' : ':::(line)';
   const cursor = language === 'json' ? content.length - 2 : content.length;
   const document = await vscode.workspace.openTextDocument({ language, content });
   const editor = await vscode.window.showTextDocument(document);
   editor.selection = new vscode.Selection(0, cursor, 0, cursor);
    const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
     'vscode.executeCompletionItemProvider', document.uri, editor.selection.active,
    );
    const glyph = completions.items.find(item => typeof item.label !== 'string' && item.label.label.includes('U+'))!;
    const range = (glyph.range as { replacing: vscode.Range }).replacing;
    await editor.edit(builder => builder.replace(range, String(glyph.insertText)));
    editor.selection = new vscode.Selection(0, cursor + String(glyph.insertText).length, 0, cursor + String(glyph.insertText).length);
    await vscode.commands.executeCommand(glyph.command!.command, ...glyph.command!.arguments ?? []);
   const accepted = document.lineAt(0).text;
   assert.ok(!accepted.includes('(line)') && accepted.includes(':::'), `${language} accepted ${JSON.stringify(accepted)}`);
  }
 });

 test('shows and accepts parenthesized word suggestions in shorthand queries', async () => {
  let triggeredRequests = 0;
  const probe = vscode.languages.registerCompletionItemProvider({ language: 'plaintext' }, {
   provideCompletionItems: () => { triggeredRequests++; return []; },
  });
  const content = ':::(inter';
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, content.length, 0, content.length);
  const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, editor.selection.active,
  );
  const word = completions.items.find(item => typeof item.label !== 'string' && item.label.label === '(interrobang)')!;
  assert.strictEqual(word.insertText, 'interrobang)');
  const range = (word.range as { replacing: vscode.Range }).replacing;
  await editor.edit(builder => builder.replace(range, String(word.insertText)));
  editor.selection = new vscode.Selection(0, document.lineAt(0).text.length, 0, document.lineAt(0).text.length);
  triggeredRequests = 0;
  await vscode.commands.executeCommand(word.command!.command, ...word.command!.arguments ?? []);
  await new Promise(resolve => setTimeout(resolve, 500));
  probe.dispose();
  assert.strictEqual(document.getText(), ':::(interrobang)');
  assert.ok(triggeredRequests > 0);
 });

 test('nests pretty-print controls and keeps reset out of the root menu', async () => {
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: '::' });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, 2, 0, 2);
  await vscode.commands.executeCommand('youhavecode.commitGlyph', '203D', false);
  const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, new vscode.Position(0, 2), ':',
  );
  const glyph = completions.items.find(item => typeof item.label !== 'string' && item.label.label.includes('U+'))!;
  const recent = completions.items.find(item => item.label === 'Recent…')!;
  const frequent = completions.items.find(item => item.label === 'Frequent…')!;
  const customTags = completions.items.find(item => item.label === 'Custom Tags…')!;
  const properties = completions.items.find(item => item.label === 'Properties…')!;
  const settings = completions.items.find(item => item.label === 'YouHaveCode Settings')!;
  const outputFormat = completions.items.find(item => typeof item.label !== 'string' && item.label.label === 'Output Format…')!;
  const defaultFilters = completions.items.find(item => typeof item.label !== 'string' && item.label.label === 'Default Filters…')!;
  const compatibility = completions.items.find(item => typeof item.label !== 'string' && item.label.label === 'Compatibility…')!;
  assert.strictEqual(typeof outputFormat.label === 'string' ? undefined : outputFormat.label.description, '= glyph');
  assert.match(typeof defaultFilters.label === 'string' ? '' : defaultFilters.label.description ?? '', /^(?:None|\([a-z-]+=[^)]+\))+$/);
  assert.match(typeof compatibility.label === 'string' ? '' : compatibility.label.description ?? '', /^\d\/5 warn · unknown (?:warn|permitted|unlist) · local (?:warn|permitted|unlist)$/);
  assert.ok(glyph.sortText! < recent.sortText! && recent.sortText! < frequent.sortText! && frequent.sortText! < properties.sortText! && properties.sortText! < customTags.sortText!);
  assert.strictEqual(recent.command?.command, 'youhavecode.insertRecentGlyph');
  assert.ok(customTags.sortText! < outputFormat.sortText! && outputFormat.sortText! < defaultFilters.sortText! && defaultFilters.sortText! < compatibility.sortText! && compatibility.sortText! < settings.sortText!);
  assert.strictEqual(frequent.command?.command, 'youhavecode.insertFrequentGlyph');
  assert.strictEqual(customTags.command?.command, 'youhavecode.customTags');
  assert.strictEqual(properties.command?.command, 'youhavecode.propertyFilters');
  assert.strictEqual(outputFormat.command?.command, 'youhavecode.outputFormats');
  assert.strictEqual(defaultFilters.command?.command, 'youhavecode.defaultFilters');
  assert.strictEqual(compatibility.command?.command, 'youhavecode.compatibility');
  assert.strictEqual(settings.command?.command, 'workbench.action.openSettings');
  assert.deepStrictEqual(settings.command?.arguments, ['youhavecode']);
  assert.ok(!glyph.preselect);
  assert.ok(!completions.items.some(item => ['(bidi=…)', '(category=…)', '(combining=…)', '(decomp=…)', '(lang=…)', '(block=…)'].includes(String(item.label))));
  assert.ok(!completions.items.some(item => ['(render=…)', '(output=…)', '(size=…)', '(wrap=…)', '(output=glyph)', 'YouHaveCode: Reset Usage History'].includes(String(item.label))));
  assert.ok(!completions.items.some(item => item.label === '*print'));
  await vscode.commands.executeCommand(outputFormat.command!.command);
  const outputCompletions = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, new vscode.Position(0, 2), ':',
  );
  const braille = outputCompletions.items.find(item => item.insertText === '(output=braille)')!;
  const glyphOutput = outputCompletions.items.find(item => item.insertText === '(output=glyph)')!;
  assert.ok(outputCompletions.items.some(item => typeof item.label !== 'string' && item.label.label === 'glyph'));
  assert.strictEqual(typeof braille.label === 'string' ? undefined : braille.label.description, 'Pretty print');
  assert.strictEqual(typeof braille.label === 'string' ? undefined : braille.label.label, '$(symbol-color) braille');
  assert.strictEqual(typeof glyphOutput.label === 'string' ? undefined : glyphOutput.label.description, 'selected');
  assert.strictEqual(typeof glyphOutput.label === 'string' ? undefined : glyphOutput.label.label, 'glyph');
  assert.ok(outputCompletions.items.some(item => typeof item.label !== 'string' && item.label.label === 'glyph'));
  await vscode.commands.executeCommand(properties.command!.command);
  const propertyCompletions = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, new vscode.Position(0, 2), ':',
  );
  assert.deepStrictEqual(propertyCompletions.items.map(item => typeof item.label === 'string' ? item.label : item.label.label).sort(), [
    '(bidi=…)', '(category=…)', '(combining=…)', '(decomp=…)', '(lang=…)', '(block=…)', '(emoji=…)', 'Pretty Print Settings…',
  ].sort());
    assert.deepStrictEqual(propertyCompletions.items.map(item => item.sortText).sort(), ['!000', '!001', '!002', '!003', '!004', '!005', '!006', '!099']);

  await vscode.commands.executeCommand(frequent.command!.command);
  const frequentCompletions = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, new vscode.Position(0, 2), ':',
  );
  const frequentInterrobang = frequentCompletions.items.find(item => typeof item.label !== 'string' && item.label.label.includes('U+203D'));
  assert.ok(frequentInterrobang);
  assert.strictEqual(frequentInterrobang.command?.command, 'youhavecode.commitGlyph');
  assert.match(frequentInterrobang.detail ?? '', /uses/);

  const nestedPrettyPrint = propertyCompletions.items.find(item => item.label === 'Pretty Print Settings…')!;
  await vscode.commands.executeCommand(nestedPrettyPrint.command!.command);
  const quickSettings = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, new vscode.Position(0, 2), ':',
  );
  for (const label of ['(output=…)', '(size=…)', '(wrap=…)', '(compact=…)', '(flow=…)', '(wrap-direction=…)', '(*d4=…)', 'Reset Usage History']) {
   assert.ok(quickSettings.items.some(item => typeof item.label === 'string' ? item.label === label : item.label.label === label));
  }
 });

 test('uses default property filters for suggestions at an empty manual query', async () => {
  const configuration = vscode.workspace.getConfiguration('youhavecode');
  await configuration.update('defaultFilters', { block: 'Geometric Shapes' }, vscode.ConfigurationTarget.Global);
  try {
   const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: '::' });
   const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
    'vscode.executeCompletionItemProvider', document.uri, new vscode.Position(0, 2), ':',
   );
   const glyphLabels = completions.items
    .filter(item => item.command?.command === 'youhavecode.commitGlyph')
    .map(item => typeof item.label === 'string' ? item.label : item.label.label);
   assert.ok(glyphLabels.length > 5);
   assert.ok(glyphLabels.every(label => /U\+25[0-9A-F]{2}\b/u.test(label)));
  } finally {
   await configuration.update('defaultFilters', undefined, vscode.ConfigurationTarget.Global);
  }
 });

 test('offers color and text Aries variants with the configured presentation first', async () => {
  const configuration = vscode.workspace.getConfiguration('youhavecode');
  await configuration.update('emojiPresentation', 'color', vscode.ConfigurationTarget.Global);
  try {
   const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: '::aries' });
   const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
    'vscode.executeCompletionItemProvider', document.uri, new vscode.Position(0, 7), ':',
   );
  const aries = completions.items.filter(item => (typeof item.label === 'string' ? item.label : item.label.label).includes('U+2648'));
  assert.strictEqual(aries.length, 2, JSON.stringify(completions.items.map(item => typeof item.label === 'string' ? item.label : item.label.label)));
  assert.deepStrictEqual(aries.map(item => typeof item.label === 'string' ? item.label : item.label.label), ['♈️ Emoji · U+2648', '♈︎ Text · U+2648']);
  assert.deepStrictEqual(aries.map(item => Array.from(String(item.insertText)).map(character => character.codePointAt(0))), [[0x2648, 0xFE0F], [0x2648, 0xFE0E]]);
  await configuration.update('emojiPresentation', 'text', vscode.ConfigurationTarget.Global);
  const textFirst = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, new vscode.Position(0, 7), ':',
  );
  const firstAriesLabel = textFirst.items.map(item => typeof item.label === 'string' ? item.label : item.label.label).find(label => label.includes('U+2648'))!;
  assert.ok(firstAriesLabel.includes('Text'));
  } finally {
   await configuration.update('emojiPresentation', undefined, vscode.ConfigurationTarget.Global);
  }
 });

 test('does not offer a text variant for emoji-default Scorpion', async () => {
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: '::scorpion' });
  const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, new vscode.Position(0, 10), ':',
  );
  const scorpion = completions.items.filter(item => (typeof item.label === 'string' ? item.label : item.label.label).includes('U+1F982'));

  assert.deepStrictEqual(scorpion.map(item => typeof item.label === 'string' ? item.label : item.label.label), ['🦂️ Emoji · U+1F982']);
  assert.deepStrictEqual(scorpion.map(item => Array.from(String(item.insertText)).map(character => character.codePointAt(0))), [[0x1F982, 0xFE0F]]);
 });

 test('does not list a misleading text variant for emoji-default Lion', async () => {
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: '::lion' });
  const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, new vscode.Position(0, 6), ':',
  );
  const lion = completions.items.filter(item => (typeof item.label === 'string' ? item.label : item.label.label).includes('U+1F981'));

  assert.deepStrictEqual(lion.map(item => typeof item.label === 'string' ? item.label : item.label.label), ['🦁️ Emoji · U+1F981']);
 });

 test('opens versioned compatibility policies in native inline menus', async () => {
  const configuration = vscode.workspace.getConfiguration('youhavecode');
  await vscode.commands.executeCommand('youhavecode.resetCompatibility');
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: '::' });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, 2, 0, 2);
  await vscode.commands.executeCommand('youhavecode.compatibility');
  let completions = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', document.uri, editor.selection.active, ':');
  const labels = completions.items.map(item => typeof item.label === 'string' ? item.label : item.label.label);
  assert.deepStrictEqual(labels, ['iOS…', 'Android (AOSP)…', 'macOS…', 'Windows…', 'Ubuntu…', 'Unknown Evidence…', 'Local Font…', 'Reset Compatibility Defaults']);
  const ios = completions.items[0];
  assert.strictEqual(typeof ios.label === 'string' ? '' : ios.label.description, 'current · warn');
  await vscode.commands.executeCommand(ios.command!.command, ...ios.command!.arguments ?? []);
  completions = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', document.uri, editor.selection.active, ':');
  assert.deepStrictEqual(completions.items.map(item => typeof item.label === 'string' ? item.label : item.label.label), [
   'Policy: required', 'Policy: warn', 'Policy: permitted', 'Policy: blocked', 'Version: current', 'Version: any', 'Version: Pin…',
  ]);
  await vscode.commands.executeCommand('youhavecode.setCompatibilityTargetPolicy', 'ios', 'required');
  await vscode.commands.executeCommand('youhavecode.setCompatibilityTargetVersion', 'ios', '18');
  await vscode.commands.executeCommand('youhavecode.setCompatibilityFallbackPolicy', 'unknown', 'unlist');
  const targets = configuration.inspect<Record<string, { version: string; policy: string }>>('compatibilityTargets')?.globalValue;
  assert.deepStrictEqual(targets?.ios, { version: '18', policy: 'required' });
  assert.strictEqual(configuration.inspect('compatibilityUnknownPolicy')?.globalValue, 'unlist');
  await vscode.commands.executeCommand('youhavecode.resetCompatibility');
  assert.strictEqual(configuration.inspect('compatibilityTargets')?.globalValue, undefined);
  assert.strictEqual(configuration.inspect('compatibilityUnknownPolicy')?.globalValue, undefined);
 });

 test('manages persistent default filters through nested inline menus', async () => {
  const configuration = vscode.workspace.getConfiguration('youhavecode');
  await clearDefaultFilterSettings();
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: '::' });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, 2, 0, 2);
  await vscode.commands.executeCommand('youhavecode.defaultFilters');
  let completions = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', document.uri, editor.selection.active, ':');
  const bidi = completions.items.find(item => typeof item.label !== 'string' && item.label.label === 'Add Bidirectional class…')!;
  assert.strictEqual(bidi.command?.command, 'youhavecode.defaultFilterValues');
  assert.ok(completions.items.some(item => item.label === 'Clear All Default Filters'));

  await vscode.commands.executeCommand(bidi.command!.command, ...bidi.command!.arguments ?? []);
  completions = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', document.uri, editor.selection.active, ':');
  const on = completions.items.find(item => typeof item.label !== 'string' && item.label.label === '(bidi=ON)')!;
  assert.deepStrictEqual(on.command?.arguments, ['bidi', 'ON']);
  await vscode.commands.executeCommand(on.command!.command, ...on.command!.arguments ?? []);
  await waitFor(configuredDefaultFilters, { bidi: 'ON' });

  const rootDocument = await vscode.workspace.openTextDocument({ language: 'plaintext', content: '::' });
  const rootEditor = await vscode.window.showTextDocument(rootDocument);
  rootEditor.selection = new vscode.Selection(0, 2, 0, 2);
  const root = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', rootDocument.uri, rootEditor.selection.active, ':');
  const rootDefaults = root.items.find(item => typeof item.label !== 'string' && item.label.label === 'Default Filters…')!;
  assert.strictEqual(typeof rootDefaults.label === 'string' ? undefined : rootDefaults.label.description, '(bidi=ON)');
  await vscode.commands.executeCommand(rootDefaults.command!.command);
  completions = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', rootDocument.uri, rootEditor.selection.active, ':');
  const remove = completions.items.find(item => typeof item.label !== 'string' && item.label.label === 'Remove Bidirectional class')!;
  assert.strictEqual(remove.command?.command, 'youhavecode.removeDefaultFilter');
  assert.deepStrictEqual(remove.command?.arguments, ['bidi']);
  await vscode.commands.executeCommand(remove.command!.command, ...remove.command!.arguments ?? []);
  await waitFor(configuredDefaultFilters, {});

  await configuration.update('defaultFilters', { bidi: 'ON', category: 'So' }, vscode.ConfigurationTarget.Global);
  await new Promise(resolve => setTimeout(resolve, 100));
  await vscode.commands.executeCommand('youhavecode.defaultFilters');
  completions = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', rootDocument.uri, rootEditor.selection.active, ':');
  const clear = completions.items.find(item => item.label === 'Clear All Default Filters')!;
  await vscode.commands.executeCommand(clear.command!.command);
  await waitFor(configuredDefaultFilters, {});
  await clearDefaultFilterSettings();
 });

 test('toggles a default without clearing it and explains filtered Sagittarius results', async () => {
  const configuration = vscode.workspace.getConfiguration('youhavecode');
  await clearDefaultFilterSettings();
  await configuration.update('defaultFilters', { category: 'Cf' }, vscode.ConfigurationTarget.Global);
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: '::sag' });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, 5, 0, 5);
  let completions = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', document.uri, editor.selection.active, ':');
  assert.strictEqual(completions.items[0].label, 'No Unicode matches — delete to broaden');
  assert.strictEqual(completions.items[0].detail, 'Active defaults: (category=Cf)');

  const item = { defaultKind: 'property' as const, defaultKey: 'category' };
  await vscode.commands.executeCommand('youhavecode.toggleSidebarDefaultItem', item);
  assert.deepStrictEqual(configuredDefaultFilters(), { category: 'Cf' });
  await waitFor(configuredDisabledDefaults, ['property:category']);
  completions = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', document.uri, editor.selection.active, ':');
  assert.ok(completions.items.some(candidate => typeof candidate.label !== 'string' && candidate.label.label.includes('U+2650')));

  await vscode.commands.executeCommand('youhavecode.toggleSidebarDefaultItem', item);
  await waitFor(configuredDisabledDefaults, []);
  await vscode.commands.executeCommand('youhavecode.clearSidebarDefaultItem', item);
  await waitFor(configuredDefaultFilters, {});
  assert.deepStrictEqual(configuredDisabledDefaults(), []);
  await clearDefaultFilterSettings();
 });

 test('searches utility menu items and ranks them above glyph results', async () => {
  const cases = [
   { draft: 'recent', labels: ['Recent…'] },
   { draft: 'frequent', labels: ['Frequent…'] },
  { draft: 'settings', labels: ['YouHaveCode Settings'] },
  { draft: 'pretty', labels: ['Properties…'] },
   { draft: 'properties', labels: ['Properties…'] },
   { draft: 'format', labels: ['Output Format…'] },
    { draft: 'compatibility', labels: ['Compatibility…'] },
  ];
  for (const expected of cases) {
   const content = `::${expected.draft}`;
   const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content });
   const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
    'vscode.executeCompletionItemProvider', document.uri, new vscode.Position(0, content.length),
   );
   const labels = completions.items.map(item => typeof item.label === 'string' ? item.label : item.label.label);
   expected.labels.forEach(label => assert.ok(labels.includes(label), `${label} missing for ${content}`));
   assert.ok(completions.items.find(item => (typeof item.label === 'string' ? item.label : item.label.label) === expected.labels[0])?.sortText?.startsWith('!06'));
  }
 });

 test('shows five recent glyphs at root and up to twenty-five in the Recent submenu', async () => {
  const hexes = Array.from({ length: 26 }, (_, index) => (0x21 + index).toString(16).toUpperCase());
  for (const hex of hexes) { await vscode.commands.executeCommand('youhavecode.recordUsage', hex); }
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: '::' });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, 2, 0, 2);
  const root = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, editor.selection.active,
  );
  const rootGlyphs = root.items.filter(item => typeof item.label !== 'string' && item.label.label.includes('U+'));
  const recent = root.items.find(item => item.label === 'Recent…')!;
  assert.strictEqual(rootGlyphs.length, 5);
  assert.ok(rootGlyphs.every(item => item.sortText! < recent.sortText!));
  await vscode.commands.executeCommand(recent.command!.command);
  const submenu = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, editor.selection.active,
  );
  assert.strictEqual(submenu.items.length, 25);
 });

 test('does not duplicate pretty-print formats in the root suggestions', async () => {
  const content = '::braille';
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, content.length, 0, content.length);
  const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, editor.selection.active,
  );
  const labels = completions.items.map(item => typeof item.label === 'string' ? item.label : item.label.label);
  const wordIndex = labels.indexOf('(braille)');
  assert.ok(wordIndex >= 0);
  assert.ok(!labels.includes('(output=braille)'));
 });

 test('accepts a searched utility through the deterministic command', async () => {
  const content = '::properties';
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, content.length, 0, content.length);
  await vscode.commands.executeCommand('youhavecode.insertBestGlyph');
  assert.strictEqual(document.getText(), '::');
  const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, editor.selection.active,
  );
  assert.ok(completions.items.some(item => (typeof item.label === 'string' ? item.label : item.label.label) === '(category=…)'));
 });

 test('omits word chips that have no glyphs under the active filters', async () => {
  const content = '::(category=Zs)fac';
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content });
  const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, new vscode.Position(0, content.length),
  );
  const wordItems = completions.items.filter(item => item.kind === vscode.CompletionItemKind.Keyword);
  assert.ok(wordItems.every(item => typeof item.label === 'string' || item.label.description !== '0 glyphs'));
  assert.ok(!wordItems.some(item => typeof item.label !== 'string' && /^\(fac/.test(item.label.label)));
 });

 test('adds, removes, and globally deletes persistent custom tags', async () => {
  const tag = 'copilot-test-favorite';
  await vscode.commands.executeCommand('youhavecode.commitGlyph', '203D', false, [], [], undefined, undefined, [{ operation: 'add', tag }]);
  const taggedDocument = await vscode.workspace.openTextDocument({ language: 'plaintext', content: `::(${tag})` });
  const tagged = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', taggedDocument.uri, new vscode.Position(0, tag.length + 4),
  );
  assert.ok(tagged.items.some(item => typeof item.label !== 'string' && item.label.description === 'INTERROBANG'));

  await vscode.commands.executeCommand('youhavecode.commitGlyph', '203D', false, [], [], undefined, undefined, [{ operation: 'remove', tag }]);
  const removedDocument = await vscode.workspace.openTextDocument({ language: 'plaintext', content: `::(${tag})` });
  const removed = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', removedDocument.uri, new vscode.Position(0, tag.length + 4),
  );
  assert.ok(!removed.items.some(item => typeof item.label !== 'string' && item.label.description === 'INTERROBANG'));

  await vscode.commands.executeCommand('youhavecode.commitGlyph', '203D', false, [], [], undefined, undefined, [{ operation: 'add', tag }]);
  await vscode.commands.executeCommand('youhavecode.commitGlyph', '25CF', false, [], [], undefined, undefined, [{ operation: 'add', tag }]);
  await vscode.commands.executeCommand('youhavecode.commitGlyph', '203D', false, [], [], undefined, undefined, [{ operation: 'delete', tag }]);
  const deletedDocument = await vscode.workspace.openTextDocument({ language: 'plaintext', content: `::(${tag})` });
  const deleted = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', deletedDocument.uri, new vscode.Position(0, tag.length + 4),
  );
  assert.ok(!deleted.items.some(item => typeof item.label !== 'string' && ['INTERROBANG', 'BLACK CIRCLE'].includes(item.label.description ?? '')));
 });

 test('assigns an unwrapped tag shortcut to the preceding glyph', async () => {
  const tag = 'copilot-direct-tag';
  const content = `‽::+=${tag}`;
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, content.length, 0, content.length);
  await vscode.commands.executeCommand('youhavecode.insertBestGlyph');
  assert.strictEqual(document.getText(), '‽');

  const taggedDocument = await vscode.workspace.openTextDocument({ language: 'plaintext', content: `::(${tag})` });
  const tagged = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', taggedDocument.uri, new vscode.Position(0, tag.length + 4),
  );
  assert.ok(tagged.items.some(item => typeof item.label !== 'string' && item.label.description === 'INTERROBANG'));
  await vscode.commands.executeCommand('youhavecode.commitGlyph', '203D', false, [], [], undefined, undefined, [{ operation: 'delete', tag }]);
 });

 test('direct tag completion applies to the preceding glyph', async () => {
  const tag = 'copilot-completion-tag';
  const content = `●::+${tag}`;
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, content.length, 0, content.length);
  const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, editor.selection.active, ':',
  );
  const assignment = completions.items.find(item => item.filterText === tag)!;
  assert.strictEqual(assignment.command?.command, 'youhavecode.assignTagToPreviousGlyph');
  await vscode.commands.executeCommand(assignment.command!.command, ...assignment.command!.arguments ?? []);
  assert.strictEqual(document.getText(), '●');
  await vscode.commands.executeCommand('youhavecode.commitGlyph', '25CF', false, [], [], undefined, undefined, [{ operation: 'delete', tag }]);
 });

 test('accepting a Braille output value in a triple-colon query reopens the menu', async function () {
  this.timeout(4000);
  let triggeredRequests = 0;
  const configuration = vscode.workspace.getConfiguration('youhavecode');
  await configuration.update('defaultOutput', 'glyph', vscode.ConfigurationTarget.Global);
  const probe = vscode.languages.registerCompletionItemProvider({ language: 'plaintext' }, {
   provideCompletionItems: () => { triggeredRequests++; return []; },
  });
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: ':::(output=bra' });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, 14, 0, 14);
  const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, editor.selection.active,
  );
  const braille = completions.items.find(item => item.label === 'braille')!;
  assert.strictEqual(braille.command?.command, 'youhavecode.setInlineOutputFormat');
  const range = (braille.range as { replacing: vscode.Range }).replacing;
  await editor.edit(builder => builder.replace(range, String(braille.insertText)));
  editor.selection = new vscode.Selection(0, document.lineAt(0).text.length, 0, document.lineAt(0).text.length);
  triggeredRequests = 0;
  await vscode.commands.executeCommand(braille.command!.command, ...braille.command!.arguments ?? []);
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.strictEqual(document.getText(), ':::(output=braille)');
  assert.strictEqual(configuration.get('defaultOutput'), 'braille');
  assert.ok(triggeredRequests > 0);
  await editor.edit(builder => builder.insert(editor.selection.active, 'star'));
  await new Promise(resolve => setTimeout(resolve, 100));
  const filtered = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, editor.selection.active,
  );
  probe.dispose();
  await configuration.update('defaultOutput', undefined, vscode.ConfigurationTarget.Global);
  assert.ok(filtered.items.some(item => typeof item.label !== 'string' && item.label.label === '(star)'));
  assert.ok(filtered.items.some(item => typeof item.label !== 'string' && item.label.description?.includes('STAR')));
 });

test('keeps YouHaveCode results above another provider after accepting Braille', async () => {
  const content = ':::(output=braille)';
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, content.length, 0, content.length);
  const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, editor.selection.active,
  );
  const glyph = completions.items.find(item => typeof item.label !== 'string' && item.label.label.includes('U+'))!;
  assert.ok(glyph.sortText! < '0000');
});

test('shows platform compatibility warnings beside incompatible inline glyphs', async () => {
 const configuration = vscode.workspace.getConfiguration('youhavecode');
 await configuration.update('compatibilityTargets', { ios: { version: '17.0', policy: 'warn' } }, vscode.ConfigurationTarget.Global);
 try {
  const content = '::head shaking horizontally';
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content });
  const completions = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', document.uri, new vscode.Position(0, content.length), ':');
  const shaking = completions.items.find(item => typeof item.label !== 'string' && item.label.label.includes('U+1F642-200D-2194-FE0F'))!;
  assert.ok(shaking);
  assert.match(typeof shaking.label === 'string' ? '' : shaking.label.description ?? '', /^\(!Ap\) HEAD SHAKING HORIZONTALLY$/);
  assert.match(String(shaking.detail), /Compatibility: iOS 17\.0<17\.4/);
 } finally { await configuration.update('compatibilityTargets', undefined, vscode.ConfigurationTarget.Global); }
});

test('does not warn beside inline glyphs when every current target has coverage', async () => {
 const configuration = vscode.workspace.getConfiguration('youhavecode');
 await configuration.update('compatibilityUnknownPolicy', 'warn', vscode.ConfigurationTarget.Global);
 try {
  const content = '::interrobang';
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content });
  const completions = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', document.uri, new vscode.Position(0, content.length), ':');
  const interrobang = completions.items.find(item => typeof item.label !== 'string' && item.label.label.includes('U+203D'))!;
  assert.ok(interrobang);
  assert.strictEqual(typeof interrobang.label === 'string' ? '' : interrobang.label.description, 'INTERROBANG');
  assert.doesNotMatch(String(interrobang.detail), /Compatibility:/);
 } finally { await configuration.update('compatibilityUnknownPolicy', undefined, vscode.ConfigurationTarget.Global); }
});

test('preserves the selected emoji presentation in a Pretty Print completion placeholder', async () => {
 const configuration = vscode.workspace.getConfiguration('youhavecode');
 await configuration.update('defaultOutput', 'braille', vscode.ConfigurationTarget.Global);
 try {
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: '::aries' });
  const completions = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', document.uri, new vscode.Position(0, 7), ':');
  const aries = completions.items.filter(item => (typeof item.label === 'string' ? item.label : item.label.label).includes('U+2648'));
  assert.deepStrictEqual(aries.map(item => Array.from(String(item.insertText)).map(character => character.codePointAt(0))), [[0x2648, 0xFE0F], [0x2648, 0xFE0E]]);
 } finally { await configuration.update('defaultOutput', undefined, vscode.ConfigurationTarget.Global); }
});

 test('Tab accepts output keys and values', async () => {
  let triggeredRequests = 0;
  const probe = vscode.languages.registerCompletionItemProvider({ language: 'plaintext' }, {
   provideCompletionItems: () => { triggeredRequests++; return []; },
  });
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: '::output' });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, 8, 0, 8);
  triggeredRequests = 0;
  await vscode.commands.executeCommand('youhavecode.insertBestGlyph');
  assert.strictEqual(document.getText(), '::');
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.ok(triggeredRequests > 0);
  const values = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, editor.selection.active,
  );
  assert.ok(values.items.some(item => typeof item.label !== 'string' && item.label.label === 'unicode'));
  assert.ok(values.items.some(item => typeof item.label !== 'string' && item.label.label === 'braille'));
  const unicode = values.items.find(item => typeof item.label !== 'string' && item.label.label === 'unicode')!;
  await editor.edit(builder => builder.replace((unicode.range as { replacing: vscode.Range }).replacing, String(unicode.insertText)));
  probe.dispose();
  assert.strictEqual(document.getText(), '::(output=unicode)');
 });

 test('offers every renderer through output and keeps the menu open after acceptance', async () => {
  const expected = ['glyph', 'components', 'unicode', 'codepoint', 'name', 'details', 'full', 'braille', 'block-elements', 'iphone-blocks', 'emoji', 'binary', 'hex'];
  const content = '::(output=';
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, content.length, 0, content.length);
  const values = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, editor.selection.active,
  );
  assert.deepStrictEqual(expected.filter(value => values.items.some(item => item.label === value)), expected);

  let triggeredRequests = 0;
  const probe = vscode.languages.registerCompletionItemProvider({ language: 'plaintext' }, {
   provideCompletionItems: () => { triggeredRequests++; return []; },
  });
  const acceptedDocument = await vscode.workspace.openTextDocument({ language: 'plaintext', content: '::(output=bra' });
  const acceptedEditor = await vscode.window.showTextDocument(acceptedDocument);
  acceptedEditor.selection = new vscode.Selection(0, 13, 0, 13);
  triggeredRequests = 0;
  await vscode.commands.executeCommand('youhavecode.insertBestGlyph');
  assert.strictEqual(acceptedDocument.getText(), '::(output=braille)');
  await new Promise(resolve => setTimeout(resolve, 500));
  probe.dispose();
  assert.ok(triggeredRequests > 0);
 });

 test('typing equals opens every renderer for a triple-colon output option', async () => {
  const expected = ['glyph', 'components', 'unicode', 'codepoint', 'name', 'details', 'full', 'braille', 'block-elements', 'iphone-blocks', 'emoji', 'binary', 'hex'];
  const content = ':::(output=';
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, content.length, 0, content.length);
  const values = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, editor.selection.active, '=',
  );
  assert.deepStrictEqual(expected.filter(value => values.items.some(item => item.label === value)), expected);
 });

 test('accepting Braille after a four-colon boundary keeps the fresh menu open', async () => {
  let triggeredRequests = 0;
  const probe = vscode.languages.registerCompletionItemProvider({ language: 'plaintext' }, {
   provideCompletionItems: () => { triggeredRequests++; return []; },
  });
  const content = '٭::::(output=bra';
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, content.length, 0, content.length);
  triggeredRequests = 0;
  await vscode.commands.executeCommand('youhavecode.insertBestGlyph');
  assert.strictEqual(document.getText(), '٭::::(output=braille)');
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.ok(triggeredRequests > 0);
  const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, editor.selection.active,
  );
  probe.dispose();
  assert.ok(completions.items.some(item => typeof item.label !== 'string' && item.label.label.includes('U+')));
  assert.ok(!completions.items.some(item => item.label === '(output=…)'));
 });

 test('typing a word after a render token restores suggestions', async () => {
  let triggeredRequests = 0;
  const probe = vscode.languages.registerCompletionItemProvider({ language: 'plaintext' }, {
   provideCompletionItems: () => { triggeredRequests++; return []; },
  });
  const content = '٭::::(output=braille)';
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, content.length, 0, content.length);
  triggeredRequests = 0;
  await editor.edit(builder => builder.insert(editor.selection.active, 'star'));
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.ok(triggeredRequests > 0);
  const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, editor.selection.active,
  );
  probe.dispose();
  assert.ok(completions.items.some(item => typeof item.label !== 'string' && item.label.label === '(star)'));
  assert.ok(completions.items.some(item => typeof item.label !== 'string' && item.label.description?.includes('STAR')));
 });

 test('uses persistent settings instead of accepted query options as defaults', async () => {
  const configuration = vscode.workspace.getConfiguration('youhavecode');
  await Promise.all([
   configuration.update('defaultOutput', 'glyph', vscode.ConfigurationTarget.Global),
   configuration.update('bitmapSize', 32, vscode.ConfigurationTarget.Global),
   configuration.update('bitmapWrapLimit', 0, vscode.ConfigurationTarget.Global),
  ]);
  const configured = ':::(render=braille)(size=8x8)(wrap=32)interrobang';
  const configuredDocument = await vscode.workspace.openTextDocument({ language: 'plaintext', content: configured });
  const configuredEditor = await vscode.window.showTextDocument(configuredDocument);
  configuredEditor.selection = new vscode.Selection(0, configured.length, 0, configured.length);
  await vscode.commands.executeCommand('youhavecode.insertBestGlyph');
  await vscode.commands.executeCommand('youhavecode.insertBestGlyph');
  assert.ok(configuredDocument.getText().endsWith(':::'));
  assert.match(configuredDocument.getText().slice(0, -3), /^[\u2800-\u28ff\n]+$/u);

  await Promise.all([
   configuration.update('defaultOutput', 'braille', vscode.ConfigurationTarget.Global),
   configuration.update('bitmapSize', 8, vscode.ConfigurationTarget.Global),
   configuration.update('bitmapWrapLimit', 32, vscode.ConfigurationTarget.Global),
  ]);
  const freshDocument = await vscode.workspace.openTextDocument({ language: 'plaintext', content: ':::interrobang' });
  const freshEditor = await vscode.window.showTextDocument(freshDocument);
  freshEditor.selection = new vscode.Selection(0, 14, 0, 14);
  const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', freshDocument.uri, freshEditor.selection.active,
  );
  const interrobang = completions.items.find(item => typeof item.label !== 'string' && item.label.description === 'INTERROBANG');
  assert.match(interrobang?.detail ?? '', /braille bitmap · 8x8 · wrap 32/);
  await vscode.commands.executeCommand('youhavecode.insertBestGlyph');
  await vscode.commands.executeCommand('youhavecode.insertBestGlyph');
  assert.ok(freshDocument.getText().endsWith(':::'));
  assert.match(freshDocument.getText().slice(0, -3), /^[\u2800-\u28ff\n]+$/u);
  await Promise.all([
   configuration.update('defaultOutput', undefined, vscode.ConfigurationTarget.Global),
   configuration.update('bitmapSize', undefined, vscode.ConfigurationTarget.Global),
   configuration.update('bitmapWrapLimit', undefined, vscode.ConfigurationTarget.Global),
  ]);
 });

 test('opens Custom Tags as an inline ranked submenu', async () => {
  const tag = 'copilot-inline-tag';
  await vscode.commands.executeCommand('youhavecode.commitGlyph', '203D', false, [], [], undefined, undefined, [{ operation: 'add', tag }]);
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: '::' });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, 2, 0, 2);
  await vscode.commands.executeCommand('youhavecode.customTags');
  const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, editor.selection.active, ':',
  );
  const create = completions.items.find(item => item.label === 'Create New Tag')!;
  const existing = completions.items.find(item => typeof item.label !== 'string' && item.label.label === `(${tag})`)!;
  assert.strictEqual(create.command?.command, 'youhavecode.createCustomTag');
  const recentItems = completions.items.filter(item => typeof item.label !== 'string' && item.label.description?.startsWith('Recently used'));
  const popularItems = completions.items.filter(item => typeof item.label !== 'string' && item.label.description?.startsWith('Most assigned'));
  assert.ok(recentItems.every(item => item.sortText! < create.sortText!));
  assert.ok(popularItems.every(item => create.sortText! < item.sortText!));
  assert.strictEqual(existing.insertText, `(+=${tag})`);
  assert.strictEqual(existing.command?.command, 'youhavecode.continueFiltering');
  assert.match(typeof existing.label === 'string' ? '' : existing.label.description ?? '', /assignment/);
  await vscode.commands.executeCommand('youhavecode.commitGlyph', '203D', false, [], [], undefined, undefined, [{ operation: 'delete', tag }]);
 });

 test('offers direct assignment from Custom Tags after a glyph', async () => {
  const tag = 'copilot-menu-tag';
  await vscode.commands.executeCommand('youhavecode.commitGlyph', '25CF', false, [], [], undefined, undefined, [{ operation: 'add', tag }]);
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: '‽::' });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, 3, 0, 3);
  await vscode.commands.executeCommand('youhavecode.customTags');
  const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, editor.selection.active, ':',
  );
  const assignment = completions.items.find(item => typeof item.label !== 'string' && item.label.label === `(${tag})`)!;
  assert.strictEqual(assignment.insertText, `+${tag})`);
  assert.strictEqual(assignment.command?.command, 'youhavecode.assignTagToPreviousGlyph');
  await vscode.commands.executeCommand('youhavecode.commitGlyph', '25CF', false, [], [], undefined, undefined, [{ operation: 'delete', tag }]);
 });

 test('shows a singleton custom-tag glyph without a redundant tag chip', async () => {
  const tag = 'favorite';
  await vscode.commands.executeCommand('youhavecode.commitGlyph', '203D', false, [], [], undefined, undefined, [{ operation: 'delete', tag }]);
  await vscode.commands.executeCommand('youhavecode.commitGlyph', '203D', false, [], [], undefined, undefined, [{ operation: 'add', tag }]);
  const content = `::${tag}`;
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content });
  const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, new vscode.Position(0, content.length),
  );
  assert.ok(!completions.items.some(item => typeof item.label !== 'string' && item.label.label === `(${tag})`));
  const glyphs = completions.items.filter(item => item.kind === vscode.CompletionItemKind.Text);
  assert.strictEqual(typeof glyphs[0]?.label === 'string' ? '' : glyphs[0]?.label.description, 'INTERROBANG');
  assert.match(glyphs[0]?.filterText ?? '', /favorite/);
  assert.ok(glyphs[0]?.sortText?.startsWith('!05'));
  assert.ok(glyphs[0]?.preselect);
  await vscode.commands.executeCommand('youhavecode.commitGlyph', '203D', false, [], [], undefined, undefined, [{ operation: 'delete', tag }]);
 });

 test('shows a custom-tag chip when multiple glyphs share it', async () => {
  const tag = 'favorite';
  await vscode.commands.executeCommand('youhavecode.commitGlyph', '203D', false, [], [], undefined, undefined, [{ operation: 'delete', tag }]);
  await vscode.commands.executeCommand('youhavecode.commitGlyph', '203D', false, [], [], undefined, undefined, [{ operation: 'add', tag }]);
  await vscode.commands.executeCommand('youhavecode.commitGlyph', '25CF', false, [], [], undefined, undefined, [{ operation: 'add', tag }]);
  const content = `::${tag}`;
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content });
  const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, new vscode.Position(0, content.length),
  );
  const tagItem = completions.items.find(item => typeof item.label !== 'string' && item.label.label === `(${tag})`);
  assert.strictEqual(typeof tagItem?.label === 'string' ? '' : tagItem?.label.description, '2 glyphs');
  assert.ok(tagItem?.preselect);
  assert.deepStrictEqual(completions.items.filter(item => item.kind === vscode.CompletionItemKind.Text)
    .map(item => typeof item.label === 'string' ? '' : item.label.description).sort(), ['BLACK CIRCLE', 'INTERROBANG']);
  await vscode.commands.executeCommand('youhavecode.commitGlyph', '203D', false, [], [], undefined, undefined, [{ operation: 'delete', tag }]);
 });

 test('omits ordinary tag rows when only one matching glyph remains', async () => {
  const content = '::1234';
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content });
  const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, new vscode.Position(0, content.length),
  );
  assert.ok(!completions.items.some(item => item.kind === vscode.CompletionItemKind.Keyword
   && typeof item.label !== 'string' && item.label.description === '1 glyph'));
  assert.ok(completions.items.some(item => typeof item.label !== 'string' && item.label.description === 'BRAILLE PATTERN DOTS-1234'));
 });

 test('Shift+Tab undo removes query components before preceding glyphs', async () => {
  const content = '⭐:::(circle)(+=favorite)';
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, content.length, 0, content.length);
  await vscode.commands.executeCommand('youhavecode.undoQueryComponent');
  assert.strictEqual(document.getText(), '⭐:::(circle)');
  await vscode.commands.executeCommand('youhavecode.undoQueryComponent');
  assert.strictEqual(document.getText(), '⭐:::');
  await vscode.commands.executeCommand('youhavecode.undoQueryComponent');
  assert.strictEqual(document.getText(), ':::');
 });

 test('applies and replays output options throughout a triple-colon chain', async () => {
  const content = ':::(bidi=ON)(output=unicode)(size=16x16)(wrap=32)interrobang';
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, content.length, 0, content.length);
  await vscode.commands.executeCommand('youhavecode.insertBestGlyph');
  await vscode.commands.executeCommand('youhavecode.insertBestGlyph');
  assert.strictEqual(document.getText(), '\\u203D:::');
  const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, editor.selection.active,
  );
  assert.ok(!completions.items.some(item => item.preselect));
  for (const token of ['(bidi=ON)', '(output=unicode)', '(size=16x16)', '(wrap=32)', '(interrobang)']) {
   await vscode.commands.executeCommand('youhavecode.insertBestGlyph');
   assert.ok(document.getText().endsWith(token));
  }
 });

 test('renders the Braille output, size, and wrap option chain', async () => {
  const content = '::(output=braille)(size=16x16)(wrap=32)interrobang';
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, content.length, 0, content.length);
  await vscode.commands.executeCommand('youhavecode.insertBestGlyph');
  await vscode.commands.executeCommand('youhavecode.insertBestGlyph');
  assert.match(document.getText(), /^[\u2800-\u28ff\n]+$/u);
 });

 test('repeated Braille output reopens with replay and the previous glyph', async () => {
  let triggeredRequests = 0;
  const probe = vscode.languages.registerCompletionItemProvider({ language: 'plaintext' }, {
   provideCompletionItems: () => { triggeredRequests++; return []; },
  });
  const content = ':::(output=braille)(size=8x8)(compact=off)interrobang';
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, content.length, 0, content.length);
  triggeredRequests = 0;
  await vscode.commands.executeCommand('youhavecode.insertBestGlyph');
  await vscode.commands.executeCommand('youhavecode.insertBestGlyph');
  assert.ok(document.getText().endsWith(':::'));
  assert.strictEqual(editor.selection.active.character, document.lineAt(editor.selection.active.line).text.length);
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.ok(triggeredRequests > 0);
  const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, editor.selection.active,
  );
  probe.dispose();
  assert.ok(completions.items.some(item => item.label === 'Reuse (output=braille)'));
  assert.ok(!completions.items.some(item => typeof item.label === 'string' && item.label.startsWith('Reuse ') && item.preselect));
  assert.ok(completions.items.some(item => typeof item.label !== 'string' && item.label.description === 'INTERROBANG'));
 });

 test('aligns consecutive same-sized bitmap glyphs on shared rows', async () => {
  const content = ':::(output=braille)(size=8x8)interrobang';
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, content.length, 0, content.length);
  await vscode.commands.executeCommand('youhavecode.insertBestGlyph');
  await vscode.commands.executeCommand('youhavecode.insertBestGlyph');
  await vscode.commands.executeCommand('youhavecode.insertBestGlyph');
  await vscode.commands.executeCommand('youhavecode.insertBestGlyph');
  await vscode.commands.executeCommand('youhavecode.insertBestGlyph');
  const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, editor.selection.active,
  );
  const glyph = completions.items.find(item => typeof item.label !== 'string' && item.label.description === 'INTERROBANG')!;
  const range = (glyph.range as { replacing: vscode.Range }).replacing;
  await editor.edit(builder => builder.replace(range, String(glyph.insertText)));
  editor.selection = new vscode.Selection(editor.document.positionAt(editor.document.getText().length), editor.document.positionAt(editor.document.getText().length));
  await vscode.commands.executeCommand(glyph.command!.command, ...glyph.command!.arguments ?? []);
  const rows = document.getText().slice(0, -3).split('\n');
  assert.strictEqual(rows.length, 2);
  assert.ok(rows.every(row => Array.from(row).length > 4), JSON.stringify(rows.map(row => Array.from(row).length)));
 });

 test('accepting a repeated Braille glyph through the widget reopens suggestions', async () => {
  let triggeredRequests = 0;
  const probe = vscode.languages.registerCompletionItemProvider({ language: 'plaintext' }, {
   provideCompletionItems: () => { triggeredRequests++; return []; },
  });
  const content = ':::(output=braille)(size=8x8)(interrobang)';
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, content.length, 0, content.length);
  await vscode.commands.executeCommand('editor.action.triggerSuggest');
  await new Promise(resolve => setTimeout(resolve, 700));
  triggeredRequests = 0;
  await vscode.commands.executeCommand('acceptSelectedSuggestion');
  await new Promise(resolve => setTimeout(resolve, 800));
  assert.ok(document.getText().endsWith(':::'));
  assert.match(document.getText().slice(0, -3), /^[\u2800-\u28ff\n]+$/u);
  assert.ok(triggeredRequests > 0);
  const reopened = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, editor.selection.active,
  );
  probe.dispose();
  assert.ok(reopened.items.some(item => item.label === 'Properties…'));
  assert.ok(reopened.items.some(item => typeof item.label !== 'string' && item.label.label.includes('U+')));
 });

 test('selecting the Omega glyph commits it instead of an HTML snippet for each one-shot query syntax', async () => {
  for (const content of ['u:(render=glyph)omega', 'u:(render=glyph)(omega)', '::(render=glyph)omega']) {
   const document = await vscode.workspace.openTextDocument({ language: 'html', content });
   const editor = await vscode.window.showTextDocument(document);
   editor.selection = new vscode.Selection(0, content.length, 0, content.length);
   if (!content.endsWith('(omega)')) { await vscode.commands.executeCommand('youhavecode.insertBestGlyph'); }
  if (parseUnicodeQuery(document.getText(), ['u:', ':::', '::'])) {
   const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
    'vscode.executeCompletionItemProvider', document.uri, editor.selection.active,
   );
   const omega = completions.items.find(item => item.kind === vscode.CompletionItemKind.Text)!;
   await editor.edit(builder => builder.replace((omega.range as { replacing: vscode.Range }).replacing, String(omega.insertText)));
   editor.selection = new vscode.Selection(0, document.lineAt(0).text.length, 0, document.lineAt(0).text.length);
   await vscode.commands.executeCommand(omega.command!.command, ...omega.command!.arguments ?? []);
  }
   const committed = document.getText();
   assert.match(committed, /^[^\x00-\x7F]$/u, `${content} committed ${JSON.stringify(committed)}`);
  }
 });

 test('triple colon Tab insertion leaves a fresh query for the next glyph', async () => {
  const content = ':::(render=glyph)interrobang';
  const document = await vscode.workspace.openTextDocument({ language: 'html', content });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, content.length, 0, content.length);
  await vscode.commands.executeCommand('youhavecode.insertBestGlyph');
  await vscode.commands.executeCommand('youhavecode.insertBestGlyph');
  assert.match(document.getText(), /^‽:::$|^[^\x00-\x7F]:::$|^\\u\{[0-9A-F]+\}:::$|^U\+[0-9A-F]+:::$|^&.+;:::$|^<.+>:::$/u);
  assert.strictEqual(parseUnicodeQuery(document.getText(), ['u:', ':::', '::'])?.draft, '');
 });

 test('empty triple-colon Tab insertion reopens the menu at the fresh suffix', async () => {
  let triggeredRequests = 0;
  const probe = vscode.languages.registerCompletionItemProvider({ language: 'plaintext' }, {
   provideCompletionItems: () => { triggeredRequests++; return []; },
  });
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: ':::' });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, 3, 0, 3);
  await vscode.commands.executeCommand('youhavecode.commitGlyph', '2016', true, []);
  await new Promise(resolve => setTimeout(resolve, 450));
  triggeredRequests = 0;
  await vscode.commands.executeCommand('youhavecode.insertBestGlyph');
  assert.ok(document.getText().endsWith(':::'));
  assert.strictEqual(editor.selection.active.character, document.lineAt(0).text.length);
  await new Promise(resolve => setTimeout(resolve, 450));
  probe.dispose();
  assert.ok(triggeredRequests > 0);
 });

 test('Tab expands an incomplete shorthand component before inserting a glyph', async () => {
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: '::clo' });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, 5, 0, 5);
  await vscode.commands.executeCommand('youhavecode.insertBestGlyph');
  assert.match(document.getText(), /^::\(cl[a-z0-9]+\)$/);
  const query = parseUnicodeQuery(document.getText(), ['u:', ':::', '::'])!;
  assert.ok(query.words[0].startsWith('CLO'));
  assert.strictEqual(query.draft, '');
 });

 test('triple colon chains component completion, glyph insertion, and the next search', async () => {
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: ':::interr' });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, 9, 0, 9);
  await vscode.commands.executeCommand('youhavecode.insertBestGlyph');
  assert.strictEqual(document.getText(), ':::(interrobang)');
  await vscode.commands.executeCommand('youhavecode.insertBestGlyph');
  assert.match(document.getText(), /^[^\x00-\x7F]:::$|^\\u\{[0-9A-F]+\}:::$|^U\+[0-9A-F]+:::$|^&.+;:::$|^<.+>:::$/u);
  assert.strictEqual(parseUnicodeQuery(document.getText(), ['u:', ':::', '::'])?.draft, '');
 });

 test('accepting a triple-colon glyph reopens the suggestion menu', async () => {
  let triggeredRequests = 0;
  const probe = vscode.languages.registerCompletionItemProvider({ language: 'plaintext' }, {
   provideCompletionItems: () => { triggeredRequests++; return []; },
  });
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: ':::interrobang' });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, 14, 0, 14);
  const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, editor.selection.active,
  );
  const glyph = completions.items.find(item => typeof item.label !== 'string' && item.label.description === 'INTERROBANG')!;
  assert.ok(glyph.range && !(glyph.range instanceof vscode.Range));
  await editor.edit(builder => builder.replace((glyph.range as { replacing: vscode.Range }).replacing, String(glyph.insertText)));
  editor.selection = new vscode.Selection(0, document.lineAt(0).text.length, 0, document.lineAt(0).text.length);
  triggeredRequests = 0;
  await vscode.commands.executeCommand(glyph.command!.command, ...glyph.command!.arguments ?? []);
  await new Promise(resolve => setTimeout(resolve, 650));
  assert.ok(triggeredRequests > 0);
  assert.ok(document.getText().endsWith(':::'));
  await editor.edit(builder => builder.insert(editor.selection.active, 'star'));
  await new Promise(resolve => setTimeout(resolve, 100));
  const nextSearch = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, editor.selection.active,
  );
  probe.dispose();
  assert.ok(nextSearch.items.some(item => typeof item.label !== 'string' && item.label.label === '(star)'));
  assert.ok(nextSearch.items.some(item => typeof item.label !== 'string' && item.label.description?.includes('STAR')));
 });

 test('double-colon glyph insertion offers an optional transient continuation menu', async function () {
  this.timeout(4000);
  let triggeredRequests = 0;
  const probe = vscode.languages.registerCompletionItemProvider({ language: 'plaintext' }, {
   provideCompletionItems: () => { triggeredRequests++; return []; },
  });
    const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: '::' });
  const editor = await vscode.window.showTextDocument(document);
    editor.selection = new vscode.Selection(0, 2, 0, 2);
    const root = await vscode.commands.executeCommand<vscode.CompletionList>(
     'vscode.executeCompletionItemProvider', document.uri, editor.selection.active,
    );
    const rootMenuLabels = root.items.filter(item => item.command?.command !== 'youhavecode.commitGlyph')
     .map(item => typeof item.label === 'string' ? item.label : item.label.label).sort();
    await editor.edit(builder => builder.insert(editor.selection.active, 'interrobang'));
  editor.selection = new vscode.Selection(0, 13, 0, 13);
  const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, editor.selection.active,
  );
  const glyph = completions.items.find(item => typeof item.label !== 'string' && item.label.description === 'INTERROBANG')!;
  const range = (glyph.range as { replacing: vscode.Range }).replacing;
  await editor.edit(builder => builder.replace(range, String(glyph.insertText)));
  editor.selection = new vscode.Selection(0, document.lineAt(0).text.length, 0, document.lineAt(0).text.length);
  await vscode.commands.executeCommand(glyph.command!.command, ...glyph.command!.arguments ?? []);
  assert.ok(!document.getText().includes('::'));
  triggeredRequests = 0;
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.ok(triggeredRequests > 0);

  const continued = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, editor.selection.active,
  );
  const continuedLabels = continued.items.map(item => typeof item.label === 'string' ? item.label : item.label.label);
  const continuedMenuLabels = continued.items.filter(item => item.command?.command !== 'youhavecode.commitGlyph')
   .map(item => typeof item.label === 'string' ? item.label : item.label.label).sort();
  assert.deepStrictEqual(continuedMenuLabels.filter(label => label !== '(interrobang)'), rootMenuLabels);
  for (const expected of ['Recent…', 'Frequent…', 'Properties…', 'Custom Tags…', 'Output Format…', 'Default Filters…', 'Compatibility…']) {
   assert.ok(continuedLabels.includes(expected), `Missing ${expected} from continuation menu`);
  }
  assert.strictEqual(continued.items.find(item => item.label === 'Properties…')?.insertText, '::');
  const nextGlyph = continued.items.find(item => item.command?.command === 'youhavecode.commitGlyph')!;
  const nextRange = (nextGlyph.range as { replacing: vscode.Range }).replacing;
  await editor.edit(builder => builder.replace(nextRange, String(nextGlyph.insertText)));
  editor.selection = new vscode.Selection(0, document.lineAt(0).text.length, 0, document.lineAt(0).text.length);
  await vscode.commands.executeCommand(nextGlyph.command!.command, ...nextGlyph.command!.arguments ?? []);
  assert.ok(!document.getText().includes('::'));

  await editor.edit(builder => builder.insert(editor.selection.active, 'line'));
  editor.selection = new vscode.Selection(0, document.lineAt(0).text.length, 0, document.lineAt(0).text.length);
  const afterTyping = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, editor.selection.active,
  );
  probe.dispose();
  const line = afterTyping.items.find(item => typeof item.label !== 'string' && item.label.label === '(line)')!;
  assert.strictEqual(line.insertText, '::(line)');
  const lineRange = (line.range as { replacing: vscode.Range }).replacing;
  await editor.edit(builder => builder.replace(lineRange, String(line.insertText)));
  editor.selection = new vscode.Selection(0, document.lineAt(0).text.length, 0, document.lineAt(0).text.length);
  await vscode.commands.executeCommand(line.command!.command, ...line.command!.arguments ?? []);
  assert.ok(document.getText().endsWith('::(line)'));
  const lineResults = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, editor.selection.active,
  );
  assert.ok(lineResults.items.some(item => typeof item.label !== 'string' && item.label.description?.includes('LINE')));
 });

 test('continuation starts with prior query tokens followed by the accepted glyph', async () => {
  const tokens = ['(line)', '(below)'];
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: `::${tokens.join('')}` });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, document.getText().length, 0, document.getText().length);
  const matches = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, editor.selection.active,
  );
  const glyph = matches.items.find(item => item.command?.command === 'youhavecode.commitGlyph')!;
  const glyphText = String(glyph.insertText);
  await editor.edit(builder => builder.replace((glyph.range as { replacing: vscode.Range }).replacing, glyphText));
  editor.selection = new vscode.Selection(0, document.getText().length, 0, document.getText().length);
  await vscode.commands.executeCommand(glyph.command!.command, ...glyph.command!.arguments ?? []);

  const continued = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, editor.selection.active,
  );
  const ordered = [...continued.items].sort((left, right) => String(left.sortText).localeCompare(String(right.sortText)));
  assert.deepStrictEqual(ordered.slice(0, 2).map(item => item.label), tokens);
  assert.ok(ordered[0].preselect);
  assert.strictEqual((ordered[2].label as vscode.CompletionItemLabel).label, (glyph.label as vscode.CompletionItemLabel).label);

  await vscode.commands.executeCommand('youhavecode.insertBestGlyph');
  assert.strictEqual(document.getText(), `${glyphText}::(line)`);
  const remaining = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, editor.selection.active,
  );
  const remainingReplay = [...remaining.items].sort((left, right) => String(left.sortText).localeCompare(String(right.sortText)))[0];
  assert.strictEqual(remainingReplay.label, '(below)');
  assert.ok(remainingReplay.preselect);
 });

 test('does not replay an unconfirmed partial draft after accepting its glyph', async () => {
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: '::pisc' });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, 6, 0, 6);
  const matches = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, editor.selection.active,
  );
  const pisces = matches.items.find(item => item.command?.command === 'youhavecode.commitGlyph'
   && (typeof item.label === 'string' ? item.label : item.label.label).includes('U+2653'))!;
  await editor.edit(builder => builder.replace((pisces.range as { replacing: vscode.Range }).replacing, String(pisces.insertText)));
  editor.selection = new vscode.Selection(0, document.getText().length, 0, document.getText().length);
  await vscode.commands.executeCommand(pisces.command!.command, ...pisces.command!.arguments ?? []);

  const continued = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, editor.selection.active,
  );
  assert.ok(!continued.items.some(item => item.label === 'Reuse (pisc)'));
 });

 test('bounded colon search advances the closing delimiter after glyph insertion', async () => {
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: ':line:' });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, 5, 0, 5);
  const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, editor.selection.active,
  );
  assert.ok(completions.items.some(item => typeof item.label !== 'string' && item.label.label === '(line)'));
  const glyph = completions.items.find(item => item.command?.command === 'youhavecode.commitGlyph')!;
  await editor.edit(builder => builder.replace((glyph.range as { replacing: vscode.Range }).replacing, String(glyph.insertText)));
  editor.selection = new vscode.Selection(0, document.getText().length - 1, 0, document.getText().length - 1);
  await vscode.commands.executeCommand(glyph.command!.command, ...glyph.command!.arguments ?? []);
  assert.ok(!document.getText().endsWith(':'));
  assert.strictEqual(editor.selection.active.character, document.getText().length);

  await editor.edit(builder => builder.insert(editor.selection.active, 'line'));
  editor.selection = new vscode.Selection(0, document.getText().length, 0, document.getText().length);
  const continued = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, editor.selection.active,
  );
  assert.strictEqual(continued.items.find(item => typeof item.label !== 'string' && item.label.label === '(line)')?.insertText, '::(line)');
 });

 test('typing inside a bounded colon pair retriggers suggestions', async () => {
  let triggeredRequests = 0;
  const probe = vscode.languages.registerCompletionItemProvider({ language: 'plaintext' }, {
   provideCompletionItems: () => { triggeredRequests++; return []; },
  });
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: '::' });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, 1, 0, 1);
  await new Promise(resolve => setTimeout(resolve, 100));
  triggeredRequests = 0;
  await editor.edit(builder => builder.insert(editor.selection.active, 'line'));
  await new Promise(resolve => setTimeout(resolve, 100));
  probe.dispose();
  assert.ok(triggeredRequests > 0);
 });

 test('bounded colon search does not activate after an identifier', async () => {
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: 'std::' });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, 4, 0, 4);
  const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, editor.selection.active,
  );
  assert.ok(!completions.items.some(item => item.command?.command.startsWith('youhavecode.')));
 });

 test('continuation utilities open their full nested inline menus', async () => {
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: '::interrobang' });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, 13, 0, 13);
  await vscode.commands.executeCommand('youhavecode.insertBestGlyph');
  await vscode.commands.executeCommand('youhavecode.insertBestGlyph');
  const continued = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, editor.selection.active,
  );
  const properties = continued.items.find(item => item.label === 'Properties…')!;
  await editor.edit(builder => builder.insert(editor.selection.active, String(properties.insertText)));
  editor.selection = new vscode.Selection(0, document.lineAt(0).text.length, 0, document.lineAt(0).text.length);
  await vscode.commands.executeCommand(properties.command!.command, ...properties.command!.arguments ?? []);
  const nested = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, editor.selection.active,
  );
  const nestedLabels = nested.items.map(item => typeof item.label === 'string' ? item.label : item.label.label);
  assert.ok(nestedLabels.includes('(category=…)'), JSON.stringify(nestedLabels));
  assert.ok(nestedLabels.includes('(block=…)'), JSON.stringify(nestedLabels));
 });

 test('triple-colon intent repairs a stale double-colon completion', async () => {
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: ':::' });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, 3, 0, 3);
  await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, editor.selection.active,
  );
  await editor.edit(builder => builder.replace(new vscode.Range(0, 0, 0, 3), '♳::'));
  editor.selection = new vscode.Selection(0, 3, 0, 3);
  await vscode.commands.executeCommand('youhavecode.commitGlyph', '2673', false);
  assert.strictEqual(document.getText(), '♳:::');
  assert.strictEqual(parseUnicodeQuery(document.getText(), ['u:', ':::', '::'])?.prefix, ':::');
 });

 test('replays the last glyph query one token per Tab with replay ranked first', async () => {
  const tokens = ['(bidi=BN)', '(arrow)', '(double)'];
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: '♳:::' });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, 4, 0, 4);
  await vscode.commands.executeCommand('youhavecode.commitGlyph', '2673', true, tokens);

  const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, editor.selection.active,
  );
  const replay = completions.items.filter(item => typeof item.label === 'string' && item.label.startsWith('Reuse '));
  assert.deepStrictEqual(replay.map(item => item.label), tokens.map(token => `Reuse ${token}`));
  assert.ok(!replay.some(item => item.preselect));
  assert.deepStrictEqual(replay.map(item => item.sortText), ['!00000', '!00001', '!00002']);

  for (const [index, expected] of tokens.entries()) {
   await vscode.commands.executeCommand('youhavecode.insertBestGlyph');
   assert.ok(document.getText().endsWith(expected));
   const remaining = await vscode.commands.executeCommand<vscode.CompletionList>(
    'vscode.executeCompletionItemProvider', document.uri, editor.selection.active,
   );
   const remainingReplay = remaining.items.filter(item => typeof item.label === 'string' && item.label.startsWith('Reuse '));
   assert.deepStrictEqual(remainingReplay.map(item => item.label), tokens.slice(index + 1).map(token => `Reuse ${token}`));
  assert.ok(!remainingReplay.some(item => item.preselect));
  }
  assert.strictEqual(document.getText(), `♳:::${tokens.join('')}`);
 });

 test('Tab accepts a replay token and reopens the menu', async () => {
  let triggeredRequests = 0;
  const probe = vscode.languages.registerCompletionItemProvider({ language: 'plaintext' }, {
   provideCompletionItems: () => { triggeredRequests++; return []; },
  });
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: '♳:::' });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, 4, 0, 4);
  await vscode.commands.executeCommand('youhavecode.commitGlyph', '2673', true, ['(bidi=BN)', '(arrow)']);
  await new Promise(resolve => setTimeout(resolve, 225));
  triggeredRequests = 0;
  await vscode.commands.executeCommand('youhavecode.insertBestGlyph');
  await new Promise(resolve => setTimeout(resolve, 250));
  probe.dispose();
  assert.strictEqual(document.getText(), '♳:::(bidi=BN)');
  assert.ok(triggeredRequests > 0);
 });

 test('restores the accepted glyph selection when no replay token takes priority', async () => {
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: '●:::' });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, 4, 0, 4);
  await vscode.commands.executeCommand('youhavecode.commitGlyph', '25CF', true, []);
  const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, editor.selection.active,
  );
  const selected = completions.items.find(item => typeof item.label !== 'string' && item.label.label.includes('U+25CF'));
  assert.ok(selected?.preselect);
  assert.ok(!completions.items.some(item => typeof item.label === 'string' && item.label.startsWith('Reuse ')));
 });

test('deleting an overtyped separated component restores YouHaveCode matches', async () => {
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: '::closed-reversedooo' });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, 20, 0, 20);
  await vscode.commands.executeCommand('youhavecode.deleteLeftAndSuggest');
  await vscode.commands.executeCommand('youhavecode.deleteLeftAndSuggest');
  await vscode.commands.executeCommand('youhavecode.deleteLeftAndSuggest');
  const query = parseUnicodeQuery(document.getText(), ['u:', ':::', '::'])!;
  assert.deepStrictEqual(query.words, ['CLOSED']);
  assert.strictEqual(query.draft, 'reversed');
  assert.ok(matchingEntries(sampleEntries, query).some(entry => entry.name === 'LATIN SMALL LETTER CLOSED REVERSED OPEN E'));
});

 test('accepted name tag keeps Unicode suggestions active', async () => {
  const document = await vscode.workspace.openTextDocument({ language: 'html', content: 'u:(m)' });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, 5, 0, 5);
  await vscode.commands.executeCommand('youhavecode.continueFiltering');
  const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, new vscode.Position(0, 5),
  );
  assert.ok(completions.items.some(item => typeof item.label !== 'string' && item.label.label.includes('U+')));
  assert.ok(completions.items.some(item => item.label === 'Properties…'));
 });

 test('keeps the completion session recoverable when no glyphs match', async () => {
  const document = await vscode.workspace.openTextDocument({ language: 'json', content: '{"glyph":"u:zzzz"}' });
  const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, new vscode.Position(0, 16),
  );
  assert.ok(completions.isIncomplete);
  const noMatches = completions.items.find(item => item.label === 'No Unicode matches — delete to broaden');
  assert.ok(noMatches?.preselect);
  assert.strictEqual(noMatches.sortText, '!99');
 });

 test('Tab never accepts another provider while a Unicode query has no matches', async () => {
  const document = await vscode.workspace.openTextDocument({ language: 'html', content: '::zzzz' });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, 6, 0, 6);
  await vscode.commands.executeCommand('youhavecode.insertBestGlyph');
  assert.strictEqual(document.getText(), '::zzzz');
 });

 test('restores interrobang suggestions after shortening an overtyped query', async () => {
  const document = await vscode.workspace.openTextDocument({ language: 'json', content: '{"glyph":"abcdefghu:inter"}' });
  const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, new vscode.Position(0, 25),
  );
  assert.ok(completions.items.some(item => typeof item.label !== 'string' && item.label.label === '(interrobang)'));
  assert.ok(completions.items.some(item => typeof item.label !== 'string' && item.label.description?.includes('INTERROBANG')));
 });

 test('retriggers deletion from the remembered Unicode anchor', () => {
  assert.ok(shouldRetriggerAfterEdit('{"glyph":"abcdefghu:inter', 0, 25, 1, '', 0, 18));
  assert.ok(shouldRetriggerAfterEdit('{"glyph":"abcdefghu:', 0, 20, 1, '', 0, 18));
  assert.ok(!shouldRetriggerAfterEdit('{"glyph":"abcdefghu:inter', 0, 17, 1, '', 0, 18));
  assert.ok(!shouldRetriggerAfterEdit('{"glyph":"abcdefghx:inter', 0, 25, 1, '', 0, 18));
  assert.ok(!shouldRetriggerAfterEdit('{"glyph":"abcdefghu:inter', 0, 25, 1, 'r', 0, 18));
 });

 test('finds the Unicode anchor before any completion request', () => {
  const query = parseUnicodeQuery('aaaaaaaaau:interooo');
  assert.strictEqual(query?.expressionStart, 9);
  assert.strictEqual(query?.draft, 'interooo');
  assert.ok(shouldRetriggerAfterEdit('aaaaaaaaau:inter', 0, 16, 1, '', 0, query!.expressionStart));
 });

 test('restores INTERROBANG after three sequential deletes', () => {
  let text = 'aaaaaaaaau:interooo';
  const anchor = parseUnicodeQuery(text)!.expressionStart;
  for (let deletion = 0; deletion < 3; deletion++) {
   text = text.slice(0, -1);
   assert.ok(shouldRetriggerAfterEdit(text, 0, text.length, 1, '', 0, anchor));
  }
  const query = parseUnicodeQuery(text)!;
  assert.strictEqual(query.draft, 'inter');
  assert.ok(matchingEntries(sampleEntries, query).some(entry => entry.name === 'INTERROBANG'));
 });

 test('deletes through the scoped command and preserves the Unicode query', async () => {
  const document = await vscode.workspace.openTextDocument({ content: 'aaaaaaaaau:interooo' });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, document.lineAt(0).text.length, 0, document.lineAt(0).text.length);
  await vscode.commands.executeCommand('youhavecode.deleteLeftAndSuggest');
  await vscode.commands.executeCommand('youhavecode.deleteLeftAndSuggest');
  await vscode.commands.executeCommand('youhavecode.deleteLeftAndSuggest');
  assert.strictEqual(document.getText(), 'aaaaaaaaau:inter');
  const query = parseUnicodeQuery(document.getText())!;
  assert.ok(matchingEntries(sampleEntries, query).some(entry => entry.name === 'INTERROBANG'));
 });

 test('restores INTERROBANG when inserted before an existing recommendation suffix', async () => {
  const before = '  "recommendations": ["dbaeumer.vscode-eslint", "connor4312.';
  const suffix = 'esbuild-problem-matchers", "ms-vscode.extension-test-runner"]';
  const document = await vscode.workspace.openTextDocument({ language: 'jsonc', content: `${before}u:interooo${suffix}` });
  const editor = await vscode.window.showTextDocument(document);
  const cursor = before.length + 'u:interooo'.length;
  editor.selection = new vscode.Selection(0, cursor, 0, cursor);
  await vscode.commands.executeCommand('youhavecode.deleteLeftAndSuggest');
  await vscode.commands.executeCommand('youhavecode.deleteLeftAndSuggest');
  await vscode.commands.executeCommand('youhavecode.deleteLeftAndSuggest');
  assert.strictEqual(document.getText(), `${before}u:inter${suffix}`);
  const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
   'vscode.executeCompletionItemProvider', document.uri, new vscode.Position(0, before.length + 'u:inter'.length),
  );
  const labels = completions.items.map(item => typeof item.label === 'string' ? item.label : `${item.label.label} ${item.label.description ?? ''}`);
  assert.ok(completions.items.some(item => typeof item.label !== 'string' && item.label.description?.includes('INTERROBANG')), labels.slice(0, 20).join('\n'));
 });
 });

suite('Usage ranking', () => {
 test('ranks custom tags by recent use, then common assignments, then remaining counts', () => {
  const assignments = { A: ['alpha', 'common'], B: ['common', 'beta'], C: ['common', 'gamma'], D: ['delta'] };
  const usage = recordUsageValue(recordUsageValue({}, 'beta'), 'alpha');
  assert.deepStrictEqual(rankCustomTags(assignments, usage), [
   { tag: 'alpha', assignments: 1, group: 'recent' },
   { tag: 'beta', assignments: 1, group: 'recent' },
   { tag: 'common', assignments: 3, group: 'common' },
   { tag: 'delta', assignments: 1, group: 'common' },
   { tag: 'gamma', assignments: 1, group: 'common' },
  ]);
 });

 test('tracks recency and frequency independently', () => {
  let stats = emptyUsageStats();
  stats = recordGlyph(stats, '25CB');
  stats = recordGlyph(stats, '25CF');
  stats = recordGlyph(stats, '25CB');
  assert.deepStrictEqual(rankGlyphHexes(stats, 'recent'), ['25CB', '25CF']);
  assert.deepStrictEqual(rankGlyphHexes(stats, 'frequent'), ['25CB', '25CF']);
 });

 test('puts up to five recent property values before positive and negated alphabetical values', () => {
  const stats = recordTokens(emptyUsageStats(), ['(bidi=ON)', '(bidi=L|BN)', '(category=So)']);
  assert.deepStrictEqual(recentFilterValues(stats, 'bidi'), ['L', 'BN', 'ON']);
  assert.deepStrictEqual(orderFilterValues(['!ON', 'EN', 'BN', 'L', 'ON', '!L'], recentFilterValues(stats, 'bidi')), [
   'L', 'BN', 'ON', 'EN', '!L', '!ON',
  ]);
 });

 test('resets all usage records', () => {
  const stats = recordTokens(recordGlyph(emptyUsageStats(), '25CB'), ['(circle)', '(output=name)']);
  assert.strictEqual(recentOutputValue(stats), 'name');
  assert.strictEqual(recentOutputValue(resetUsageStats()), undefined);
  assert.deepStrictEqual(resetUsageStats(), emptyUsageStats());
  assert.notDeepStrictEqual(stats, resetUsageStats());
 });
});

suite('Unicode deconstruction', () => {
 test('renders neutral references, HTML entities, and language-native escapes', () => {
  assert.strictEqual(renderCodepointReference('🚀'), 'U+1F680');
  assert.strictEqual(renderHtmlEntity('❤'), '&#x2764;');
  assert.strictEqual(renderLanguageEscape('🚀', 'javascript'), '\\u{1F680}');
  assert.strictEqual(renderLanguageEscape('🚀', 'rust'), '\\u{1F680}');
  assert.strictEqual(renderLanguageEscape('🚀', 'python'), '\\U0001F680');
  assert.strictEqual(renderLanguageEscape('🚀', 'csharp'), '\\U0001F680');
  assert.strictEqual(renderLanguageEscape('❤', 'javascript'), '\\u2764');
  assert.strictEqual(renderLanguageEscape('🚀', 'java'), '\\uD83D\\uDE80');
  assert.strictEqual(renderLanguageEscape('🚀', 'json'), '\\uD83D\\uDE80');
  assert.strictEqual(renderLanguageEscape('🚀', 'css'), '\\1F680 ');
  assert.strictEqual(renderLanguageEscape('🚀', 'html'), '&#x1F680;');
 });

 test('forces emoji color, text, or deconstructed presentation with Unicode variation selectors', () => {
  assert.strictEqual(applyEmojiPresentation('☀', 'color'), '☀️');
  assert.strictEqual(applyEmojiPresentation('♈', 'color'), '♈️');
  assert.strictEqual(applyEmojiPresentation('☀️', 'text'), '☀︎');
  assert.strictEqual(applyEmojiPresentation('A', 'color'), 'A');
  assert.strictEqual(deconstructUnicode(applyEmojiPresentation('☀', 'color'), [], 'codepoints'), 'U+2600 + U+FE0F');
  assert.strictEqual(renderUnicode('☀', [], 'symbols', 'deconstructed'), '☀ + <VARIATION SELECTOR-16 (VS16, U+FE0F)> ◌️');
  assert.strictEqual(renderUnicode('A', [], 'symbols', 'deconstructed'), 'A');
 });

 test('offers reversible formats for one or multiple glyphs', () => {
  assert.strictEqual(deconstructUnicode('U+203D \\u25CF', sampleEntries, 'symbols'), '‽ ●');
  assert.strictEqual(deconstructUnicode('‽', sampleEntries, 'details'), '‽ U+203D INTERROBANG');
  assert.strictEqual(deconstructUnicode('‽', sampleEntries, 'fullDetails'), '‽ U+203D INTERROBANG (category=Po, bidi=ON, combining=0, decomp=NONE)');
  assert.strictEqual(deconstructUnicode('‽●', sampleEntries, 'codepoints'), 'U+203D + U+25CF');
  assert.strictEqual(deconstructUnicode('‽●', sampleEntries, 'names'), 'INTERROBANG + BLACK CIRCLE');
  assert.strictEqual(deconstructUnicode('‽', sampleEntries, 'jsonEscapes'), '\\u203D');
 });

 test('breaks composed text and colored emoji into encoded components', () => {
  assert.strictEqual(deconstructUnicode('é', sampleEntries, 'components'), 'e + ◌́');
  assert.strictEqual(deconstructUnicode('👨‍💻', sampleEntries, 'components'), '👨 + <ZWJ> + 💻');
  assert.strictEqual(deconstructUnicode('❤️', sampleEntries, 'components'), '❤ + <VARIATION SELECTOR-16 (VS16, U+FE0F)> ◌️');
  assert.strictEqual(deconstructUnicode('🇺🇸👍🏽', sampleEntries, 'components'), '🇺 + 🇸 | 👍 + 🏽');
 });

 test('targets a complete grapheme at the cursor', () => {
  assert.deepStrictEqual(graphemeRangeAt(`A${'e\u0301'}B`, 3), { start: 1, end: 3 });
  assert.deepStrictEqual(graphemeRangeAt('A👨‍💻B', 6), { start: 1, end: 6 });
 });

 test('encodes binary glyph pixels as two-by-four Braille cells', () => {
  assert.strictEqual(rasterRowsToBraille(['10', '01', '10', '01']), '⢕');
  assert.strictEqual(rasterRowsToBraille(['11', '11', '11', '11']), '⣿');
 });

 test('selects inserted output after multiple replacements shift the document', () => {
  assert.deepStrictEqual(replacementOffsets([
   { start: 2, end: 3, replacement: 'first\nbitmap' },
   { start: 6, end: 8, replacement: 'second' },
  ]), [
   { start: 2, end: 14 },
   { start: 17, end: 23 },
  ]);
 });
});

suite('Unicode Braille', () => {
 test('maps filled and empty pixels through separate custom glyph sets', () => {
  assert.strictEqual(rasterRowsToCustomArt(['101', '010'], { name: 'Test', glyphs: 'AB', emptyGlyphs: '._', delegate: 'cycle' }), 'A.B\n_A.');
  assert.strictEqual(rasterRowsToCustomArt(['101', '010'], { name: 'Test', glyphs: 'AB', emptyGlyphs: '._', delegate: 'checker' }), 'A_A\n_A_');
  assert.strictEqual(composeBitmapText(['👩‍💻', 'X'], ' ', { maxExtent: 3 }), '👩‍💻 X');
 });

 test('starts inline bitmap output on a new line', () => {
  assert.strictEqual(startBitmapOnNewLine('⣿', 'const glyph = '), '\n⣿');
  assert.strictEqual(startBitmapOnNewLine('⣿', '   '), '⣿');
  assert.strictEqual(startBitmapOnNewLine('⣿', ''), '⣿');
 });

 test('derives text dimensions from each output cell geometry', () => {
  assert.deepStrictEqual(bitmapTextDimensions(32, 'braille'), { columns: 16, rows: 8 });
  assert.deepStrictEqual(bitmapTextDimensions(32, 'blockElements'), { columns: 16, rows: 16 });
  assert.deepStrictEqual(bitmapTextDimensions(32, 'emoji'), { columns: 32, rows: 32 });
  assert.deepStrictEqual(bitmapTextDimensions(32, 'hex'), { columns: 8, rows: 32 });
 });

 test('encodes one raster in each bitmap text format', () => {
  const rows = ['10', '01', '10', '01'];
  assert.strictEqual(rasterRowsToText(rows, 'braille'), '⢕');
  assert.strictEqual(rasterRowsToText(rows, 'blockElements'), '▚\n▚');
  assert.strictEqual(rasterRowsToText(rows, 'iphoneBlocks'), '■□\n□■\n■□\n□■');
  assert.strictEqual(rasterRowsToText(rows, 'emoji'), '🔳  \n  🔳\n🔳  \n  🔳');
  assert.strictEqual(rasterRowsToText(rows, 'binary'), rows.join('\n'));
  assert.strictEqual(rasterRowsToText(rows, 'hex'), '8\n4\n8\n4');
 });

 test('renders every selected glyph raster locally', async () => {
  const glyphs: string[] = [];
  const rasterizer = (character: string) => {
   glyphs.push(character);
   return ['11', '11', '11', '11'];
  };
  assert.strictEqual(await textToBitmap('A B', 8, 'braille', { maxExtent: 1 }, rasterizer), '⣿\n\n⣿');
  assert.deepStrictEqual(glyphs, ['A', 'B']);
 });

 test('rasterizes emoji sequences as complete graphemes and limits oversized selections', async () => {
  const glyphs: string[] = [];
  const rasterizer = (character: string) => { glyphs.push(character); return ['1']; };
  await textToBitmap('👨‍💻 🇺🇸 👍🏽', 8, 'binary', {}, rasterizer);
  assert.deepStrictEqual(glyphs, ['👨‍💻', '🇺🇸', '👍🏽']);
  await assert.rejects(textToBitmap('A'.repeat(257), 8, 'binary', {}, rasterizer), /limited to 256 graphemes/);
 });

 test('normalizes a system-font glyph into a padded square raster', () => {
  const rows = rasterizeGlyph('A', 32);
  assert.strictEqual(rows.length, 32);
  assert.ok(rows.every(row => row.length === 32 && /^[01]+$/.test(row)));
  assert.ok(rows.some(row => row.includes('1')));
  assert.ok(rows.slice(0, 5).every(row => !row.includes('1')));
 });

 test('uses an installed fallback font instead of the missing-glyph box', () => {
  const rows = rasterizeGlyph('߷', 32);
  assert.ok(rows.some(row => row.includes('1')));
  assert.ok(rows.flatMap(row => Array.from(row)).filter(pixel => pixel === '1').length > 20);
 });

 test('prioritizes font families according to emoji presentation selectors', () => {
  const families = ['Arial', 'Apple Color Emoji', 'Noto Sans Symbols', 'Apple Symbols', 'Noto Emoji'];
  assert.deepStrictEqual(presentationFontFamilies('♐︎', families), ['Apple Symbols', 'Noto Emoji', 'Noto Sans Symbols', 'Arial']);
  assert.deepStrictEqual(presentationFontFamilies('♐️', families), ['Noto Emoji', 'Apple Color Emoji', 'Noto Sans Symbols', 'Arial', 'Apple Symbols']);
  assert.deepStrictEqual(presentationFontFamilies('🦁︎', families), ['Apple Symbols', 'Noto Emoji', 'Noto Sans Symbols', 'Arial']);
 });

 test('honors the configured Pretty Print font-family preference before built-ins', () => {
  setPrettyPrintFontFamilies('Noto Sans Symbols, "Apple Symbols"');
  try {
   assert.deepStrictEqual(presentationFontFamilies('♐︎', ['Arial', 'Apple Symbols', 'Noto Sans Symbols']), ['Noto Sans Symbols', 'Apple Symbols', 'Arial']);
  } finally {
   setPrettyPrintFontFamilies(undefined);
  }
 });

 test('rasterizes color emoji with saturated-color detail', () => {
  const rows = rasterizeGlyph('🦁️', 32);
  assert.ok(rows.some(row => row.includes('1')));
  assert.ok(rows.some(row => row.includes('0')));
  assert.ok(rows.flatMap(row => [...row]).filter(pixel => pixel === '1').length > 120);
 });

 test('uses the preferred Noto Emoji rendering for color zodiac symbols', () => {
  assert.deepStrictEqual(rasterizeGlyph('♈️', 32), rasterizeGlyphForFamily('♈️', 'Noto Emoji', 32));
 });

 test('keeps text-presentation zodiac detail rather than collapsing to a filled blob', () => {
  const rows = rasterizeGlyph('♐︎', 24);
  const ink = rows.flatMap(row => [...row]).filter(pixel => pixel === '1').length;
  assert.ok(ink > 40 && ink < 200);
  assert.ok(rows.some(row => row.includes('0')));
  assert.ok(rows[10].includes('0'));
  assert.ok(rows[11].includes('0'));
 });

 test('falls back to a renderable font for text-presentation emoji', () => {
  assert.ok(rasterizeGlyph('♈︎', 16).some(row => row.includes('1')));
 });

 test('enumerates all renderable font variants for a glyph', () => {
  const renderings = enumerateFontRenderings('♐︎');
  assert.ok(renderings.length > 0);
  assert.ok(renderings.every(item => item.family && item.rows.length > 0 && item.rows.every(row => /^[01]+$/.test(row))));
  assert.ok(renderings.some(item => item.rows.some(row => row.includes('1'))));
 });

 test('samples a tighter baseline band without losing baseline alignment', () => {
  const baseline = rasterizeGlyphBaseline('g', 32);
  const tight = rasterizeGlyphBaselineTight('g', 32);
  const inkRows = (rows: readonly string[]) => rows.filter(row => row.includes('1')).length;
  assert.ok(inkRows(tight) >= inkRows(baseline));
  assert.ok(tight.slice(-8).some(row => row.includes('1')));
 });

 test('converts an image buffer into a square grayscale bitmap', async () => {
  const rows = await rasterizeImage(glyphIconPng('A', 16, '#000000'), 8);
  assert.strictEqual(rows.length, 8);
  assert.ok(rows.every(row => row.length === 8 && /^[01]+$/.test(row)));
  assert.ok(rows.some(row => row.includes('1')));
 });

 test('lays out bitmap glyphs side-by-side and wraps at the configured extent', () => {
  assert.strictEqual(composeBitmapText(['⣿\n⣿', '⠉', '⠿\n⠿'], '⠀', { maxExtent: 3 }), '⣿⠀⠉\n⣿⠀⠀\n\n⠿\n⠿');
 });

test('compacts Braille glyphs with a one-cell separator while preserving space width', () => {
  assert.strictEqual(composeBitmapText(['⠀⣿⠀', '⠀⠀⠿⠀'], '⠀', { compact: true }), '⣿⠀⠿');
  assert.strictEqual(composeBitmapText(['⣿', '⠀⠀', '⠿'], '⠀', { compact: true }), '⣿⠀⠀⠀⠀⠿');
  assert.strictEqual(composeBitmapText(['⠀⣿⠀\n⠀⠀⠀', '⠀⠀⠿⠀\n⠀⠀⠀'], '⠀', { compact: true, flowDirection: 'ud' }), '⠀⣿⠀⠀\n⠀⠀⠀⠀\n⠀⠀⠿⠀');
});

test('uses a two-cell compact Braille space between words', async () => {
 const rasterizer = () => ['11', '11', '11', '11'];
 assert.strictEqual(await textToBitmap('A B', 4, 'braille', { compact: true }, rasterizer), '⣿⠀⠀⠀⠀⣿');
});

test('uses two compact Braille rows for spaces at every raster size', async () => {
 const rasterizer = () => ['11', '11', '11', '11', '11', '11', '11', '11'];
 const rows = (await textToBitmap('A B', 8, 'braille', { compact: true }, rasterizer)).split('\n');
 assert.strictEqual(rows.length, 2);
 assert.ok(rows.every(row => row === '⣿⠀⠀⠀⠀⣿'));
});

test('does not require a renderable font glyph for whitespace', async () => {
 const rasterizer = (character: string) => { if (character === ' ') { throw new Error('No installed font can render U+20'); } return ['11', '11', '11', '11']; };
 await assert.doesNotReject(textToBitmap('A B', 4, 'braille', { compact: true }, rasterizer));
});

test('compacts pixel-empty rows before encoding rotated vertical Braille glyphs', async () => {
 const rasterizer = () => ['0010', '0010', '0010', '0010'];
 const layout = transformLayout('rotate-90');
 assert.strictEqual(await textToBitmap('A', 4, 'iphoneBlocks', { compact: true, flowDirection: layout.flow, wrapDirection: layout.wrap, d4: 'rotate-90' }, rasterizer), '■■■■');
});

test('matches glyph size by placing each compact glyph in its own group', () => {
 assert.strictEqual(composeBitmapText(['A', 'B'], ' ', { compact: true, oneGlyphPerGroup: true }), 'A\n\nB');
});

 test('wraps before a whole glyph would exceed the target width', () => {
  assert.strictEqual(composeBitmapText(['⣿⣿⣿', '⠿⠿⠿'], '⠀', { maxExtent: 5 }), '⣿⣿⣿\n\n⠿⠿⠿');
 });

 test('applies every D4 transform to raster pixels', () => {
  const rows = ['abc', 'def'];
  assert.deepStrictEqual(transformRaster(rows, 'identity'), ['abc', 'def']);
  assert.deepStrictEqual(transformRaster(rows, 'rotate-90'), ['da', 'eb', 'fc']);
  assert.deepStrictEqual(transformRaster(rows, 'rotate-180'), ['fed', 'cba']);
  assert.deepStrictEqual(transformRaster(rows, 'rotate-270'), ['cf', 'be', 'ad']);
  assert.deepStrictEqual(transformRaster(rows, 'mirror-left-right'), ['cba', 'fed']);
  assert.deepStrictEqual(transformRaster(rows, 'flip-top-bottom'), ['def', 'abc']);
  assert.deepStrictEqual(transformRaster(rows, 'reflect-slash'), ['fc', 'eb', 'da']);
  assert.deepStrictEqual(transformRaster(rows, 'reflect-backslash'), ['ad', 'be', 'cf']);
 });

 test('flows glyphs vertically and wraps into right-to-left columns', () => {
  assert.strictEqual(composeBitmapText(['A', 'B', 'C'], '.', { maxExtent: 3, flowDirection: 'ud', wrapDirection: 'rl' }), 'C.A\n.. .'.replace(' ', '') + '\n..B');
 });
});
