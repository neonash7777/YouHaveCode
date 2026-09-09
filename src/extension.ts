import * as vscode from 'vscode';
import { actionKeys, applyCustomTagEdits, buildNameWords, canonicalFilterKey, countFilterValues, countMatchingWords, filterInputKeys, filterKeys, filterValues, glyphPropertyExpansions, glyphPropertyInputLabels, initialEntries, literalNameWords, matchingEntries, matchingWords, optionValues, outputValues, parseUnicodeQuery, propertyValue, queryOption, shouldRetriggerAfterEdit, suggestedOptionKeys, topMatchingWords, withDefaultFilters, type DefaultFilterConfig, type FilterKey, type OptionKey, type UnicodeOption, type UnicodeQuery, type UnicodeTagEdit } from './unicodeCompletions';
import { mergeEmojiEntries, parseCompactUnicode, parseEmojiRgi, parseUnicodePropertyAliases, propertyValueDescription, type UnicodeEntry } from './unicodeData';
import { applyEmojiPresentation, deconstructUnicode, renderCodepointReference, renderHtmlEntity, renderLanguageEscape, renderUnicode, replacementOffsets, type DeconstructionFormat, type EmojiPresentation } from './unicodeDeconstruction';
import { bitmapTextDimensions, startBitmapOnNewLine, textToBitmap, textToCustomArt, transformLayout, type BitmapD4, type BitmapFlowDirection, type BitmapTextFormat, type BitmapWrapDirection, type CustomArtProfile } from './unicodeBraille';
import { defaultPrettyPrintFontFamilies, enumerateFontRenderings, glyphIconPng, installedFontFamilies, parseFontFamilyList, rasterizeEmojiArt, rasterizeGlyph, rasterizeGlyphBaseline, rasterizeGlyphBaselineTight, rasterizeGlyphBaselineTightForFamily, rasterizeGlyphBaselineForFamily, rasterizeGlyphForFamily, rasterizeImage, rasterizeImageEmojiArt, setPrettyPrintFontFamilies } from './glyphRaster';
import { emptyUsageStats, glyphVariantKey, orderFilterValues, parseGlyphVariantKey, rankCustomTags, rankGlyphHexes, recentFilterValues, recordGlyph, recordTokens, recordUsageValue, resetUsageStats, type UsageRecord, type UsageStats } from './usageRanking';
import { UnicodeSidebarProvider } from './unicodeSidebar';
import { builtInDelegateProfiles, resolveDelegateProfile, type DelegateProfileConfig } from './delegateSandbox';
import { compatibilitySummary, compatibilityTargets, compatibilityWarningBadge, compatibilityWarningText, emojiCompatibilityFindings, fallbackCompatibilityProfiles, fontCoverageFindings, hasCompleteFontCoverageEvidence, hasEmojiCompatibilityEvidence, parseCompatibilityProfiles, resolveCompatibilityTargets, unknownCompatibilityFindings, unknownCompatibilityWarningBadge, unknownCompatibilityWarningText, type CompatibilityFallbackPolicy, type CompatibilityPolicy, type CompatibilityProfiles, type CompatibilityTarget, type CompatibilityTargetSettings } from './compatibilitySettings';

export interface RenderDefaults { render: string; size: string; wrap: string; compact: string; mapping?: string; flow: string; 'wrap-direction': string; d4: string }
interface UtilityAction { key: 'recent' | 'frequent' | 'customTags' | 'properties' | 'defaultFilters' | 'compatibility' | 'settings' | 'outputFormat'; label: string; terms: readonly string[]; command: string; commandTitle: string; commandArguments?: readonly unknown[]; kind: vscode.CompletionItemKind; rootSort: string }
export interface SelectionOutputChoice { label: string; description: string; format: DeconstructionFormat | BitmapTextFormat | 'lastBitmap' | 'quickBitmap' | 'customBitmap' }
interface BackQuickPickItem extends vscode.QuickPickItem { back: true }
interface BitmapSizeChoice extends vscode.QuickPickItem { size: number; custom?: true }

const backQuickPickItem: BackQuickPickItem = { label: '$(arrow-left) Back', description: 'Return to the previous choice', back: true };
const standardBitmapSizes = [8, 12, 16, 24, 32, 48, 64, 96, 128] as const;
const textPresentationBases = new Set([
  0x23, 0x2A, ...Array.from({ length: 10 }, (_, index) => 0x30 + index), 0xA9, 0xAE, 0x203C, 0x2049, 0x2122, 0x2139,
  0x2194, 0x2195, 0x2196, 0x2197, 0x2198, 0x2199, 0x21A9, 0x21AA, 0x231A, 0x231B, 0x2328, 0x23CF,
  0x23E9, 0x23EA, 0x23EB, 0x23EC, 0x23ED, 0x23EE, 0x23EF, 0x23F0, 0x23F1, 0x23F2, 0x23F3, 0x23F8, 0x23F9, 0x23FA,
  0x24C2, 0x25AA, 0x25AB, 0x25B6, 0x25C0, 0x25FB, 0x25FC, 0x25FD, 0x25FE, 0x2600, 0x2601, 0x2602, 0x2603, 0x2604,
  0x260E, 0x2611, 0x2614, 0x2615, 0x2618, 0x261D, 0x2620, 0x2622, 0x2623, 0x2626, 0x262A, 0x262E, 0x262F,
  0x2638, 0x2639, 0x263A, 0x2640, 0x2642, 0x2648, 0x2649, 0x264A, 0x264B, 0x264C, 0x264D, 0x264E, 0x264F, 0x2650, 0x2651, 0x2652, 0x2653,
  0x265F, 0x2660, 0x2663, 0x2665, 0x2666, 0x2668, 0x267B, 0x267E, 0x267F, 0x2692, 0x2693, 0x2694, 0x2695, 0x2696, 0x2697, 0x2699, 0x269B, 0x269C,
  0x26A0, 0x26A1, 0x26A7, 0x26AA, 0x26AB, 0x26B0, 0x26B1, 0x26BD, 0x26BE, 0x26C4, 0x26C5, 0x26C8, 0x26CE, 0x26CF, 0x26D1, 0x26D3, 0x26D4,
  0x26E9, 0x26EA, 0x26F0, 0x26F1, 0x26F2, 0x26F3, 0x26F4, 0x26F5, 0x26F7, 0x26F8, 0x26F9, 0x26FA, 0x26FD,
  0x2702, 0x2705, 0x2708, 0x2709, 0x270A, 0x270B, 0x270C, 0x270D, 0x270F, 0x2712, 0x2714, 0x2716, 0x271D, 0x2721, 0x2728, 0x2733, 0x2734, 0x2744, 0x2747, 0x274C, 0x274E, 0x2753, 0x2754, 0x2755, 0x2757, 0x2795, 0x2796, 0x2797, 0x27A1, 0x27B0, 0x27BF,
  0x2934, 0x2935, 0x2B05, 0x2B06, 0x2B07, 0x2B1B, 0x2B1C, 0x2B50, 0x2B55, 0x3030, 0x303D, 0x3297, 0x3299,
]);

export function bitmapSizeChoices(lastUsed: number, customHistory: readonly number[]): BitmapSizeChoice[] {
 const recentCustom = customHistory.filter((size, index) => size >= 8 && size <= 128 && customHistory.indexOf(size) === index).slice(0, 3);
 const listed = [...new Set([...standardBitmapSizes, ...recentCustom])].sort((left, right) => left - right);
 return [
  { label: `Last used (${lastUsed} × ${lastUsed})`, description: 'Current bitmap size', size: lastUsed },
  ...(recentCustom.length ? [{ label: `Last custom (${recentCustom[0]} × ${recentCustom[0]})`, description: 'Most recent manually entered size', size: recentCustom[0] }] : []),
  ...listed.map(size => ({ label: `${size} × ${size} pixels`, description: recentCustom.includes(size) ? 'Recent custom size' : 'Preset size', size })),
  { label: 'Custom size…', description: 'Enter 8–128 pixels', size: 0, custom: true as const },
 ];
}

async function showQuickPickStep<T extends vscode.QuickPickItem>(items: readonly T[], options: vscode.QuickPickOptions, canGoBack: boolean): Promise<T | 'back' | undefined> {
 const selected = await vscode.window.showQuickPick<BackQuickPickItem | T>(canGoBack ? [backQuickPickItem, ...items] : items, options);
 return selected && 'back' in selected ? 'back' : selected;
}

export function selectionOutputChoices(lastOutput: string, defaults?: RenderDefaults): SelectionOutputChoice[] {
 const lastSettings = defaults
  ? `${optionOutputLabel(lastOutput)} · ${defaults.size} · wrap ${defaults.wrap} · ${defaults.flow}/${defaults['wrap-direction']} · ${defaults.compact} · ${defaults.d4}`
  : optionOutputLabel(lastOutput);
 return [
  { label: 'Pretty Print', description: `Use last settings · ${lastSettings}`, format: 'lastBitmap' },
  { label: 'Pretty Print…', description: 'Choose only bitmap type and size', format: 'quickBitmap' },
  { label: 'Pretty Print*…', description: 'Customize type, size, wrapping, spacing, flow, and transform', format: 'customBitmap' },
  { label: 'Braille dots', description: '2 × 4 pixels per character', format: 'braille' },
  { label: 'Block Elements', description: '2 × 2 pixels per character', format: 'blockElements' },
  { label: 'iPhone solid blocks', description: '1 × 1 pixel per square cell', format: 'iphoneBlocks' },
  { label: 'Emoji Art', description: '1 × 1 pixel per colored emoji cell', format: 'emoji' },
  { label: 'Binary', description: '1 × 1 pixel per 0 or 1', format: 'binary' },
  { label: 'Hex', description: '4 × 1 pixels per hexadecimal digit', format: 'hex' },
  { label: 'Glyph / symbol', description: 'Keep the selected Unicode text', format: 'symbols' },
  { label: 'Glyph components', description: 'Break graphemes and emoji into encoded parts', format: 'components' },
  { label: 'Details', description: '‽ U+203D INTERROBANG', format: 'details' },
  { label: 'Full details', description: 'Glyph, code point, name, category, bidi, combining, decomposition', format: 'fullDetails' },
  { label: 'Code points', description: 'U+203D', format: 'codepoints' },
  { label: 'Unicode names', description: 'INTERROBANG', format: 'names' },
  { label: 'JSON escapes', description: '\\u203D', format: 'jsonEscapes' },
 ];
}

interface BitmapSelectionSettings {
 format: BitmapTextFormat;
 size: number;
 wrapLimit: number;
 compact: boolean;
 flow: BitmapFlowDirection;
 wrapDirection: BitmapWrapDirection;
 d4: BitmapD4;
}

async function chooseBitmapSettings(mode: 'quickBitmap' | 'customBitmap', lastOutput: string, defaults: RenderDefaults, context: vscode.ExtensionContext): Promise<BitmapSelectionSettings | undefined> {
 const layout = resolvedBitmapLayout(defaults);
 const settings: BitmapSelectionSettings = {
  format: bitmapOutputFormat(lastOutput) ?? 'braille', size: Number.parseInt(defaults.size, 10),
  wrapLimit: defaults.wrap === 'none' ? -1 : defaults.wrap === 'glyph' ? -2 : defaults.wrap === 'auto' ? 0 : Number.parseInt(defaults.wrap, 10), compact: defaults.compact === 'on',
  flow: layout.flowDirection, wrapDirection: layout.wrapDirection, d4: defaults.d4 as BitmapD4,
 };
 const lastStep = mode === 'quickBitmap' ? 1 : 6;
 let step = 0;
 while (step <= lastStep) {
  if (step === 0) {
   const output = await showQuickPickStep([
    { label: 'Braille dots', description: `2 × 4 pixels per character${settings.format === 'braille' ? ' (currently selected)' : ''}`, format: 'braille' as const },
    { label: 'Block Elements', description: `2 × 2 pixels per character${settings.format === 'blockElements' ? ' (currently selected)' : ''}`, format: 'blockElements' as const },
    { label: 'iPhone solid blocks', description: `1 × 1 pixel per ■ or □ cell${settings.format === 'iphoneBlocks' ? ' (currently selected)' : ''}`, format: 'iphoneBlocks' as const },
    { label: 'Emoji Art', description: `1 × 1 pixel per colored emoji cell${settings.format === 'emoji' ? ' (currently selected)' : ''}`, format: 'emoji' as const },
    { label: 'Binary', description: `1 × 1 pixel per 0 or 1${settings.format === 'binary' ? ' (currently selected)' : ''}`, format: 'binary' as const },
    { label: 'Hex', description: `4 × 1 pixels per hexadecimal digit${settings.format === 'hex' ? ' (currently selected)' : ''}`, format: 'hex' as const },
   ], { title: `${mode === 'quickBitmap' ? 'Pretty Print' : 'Pretty Print*'} › Type`, placeHolder: 'Choose how raster pixels are packed into text' }, false);
  if (!output || output === 'back') { return undefined; }
   settings.format = output.format;
  } else if (step === 1) {
    const sizeChoice = await showQuickPickStep(bitmapSizeChoices(settings.size, context.globalState.get<number[]>('customBitmapSizes', [])).map(choice => {
     const dimensions = bitmapTextDimensions(choice.size || settings.size, settings.format);
     return { ...choice, description: choice.custom ? choice.description : `${dimensions.columns} columns × ${dimensions.rows} rows · ${choice.description}` };
    }), { title: `${mode === 'quickBitmap' ? 'Pretty Print' : 'Pretty Print*'} › Size`, placeHolder: 'Choose the raster resolution for each glyph' }, true);
   if (!sizeChoice) { return undefined; }
   if (sizeChoice === 'back') { step--; continue; }
   const size = sizeChoice.size || Number.parseInt(await vscode.window.showInputBox({
    title: 'Custom Bitmap Size', prompt: 'Square raster size in pixels (8–128)', value: String(settings.size),
    validateInput: value => /^(?:[89]|[1-9][0-9]|1[01][0-9]|12[0-8])$/.test(value) ? undefined : 'Enter a whole number from 8 through 128.',
   }) ?? '', 10);
   if (!Number.isInteger(size)) { continue; }
   settings.size = size;
  if (sizeChoice.custom) { await rememberCustomBitmapSize(context, size); }
  } else if (step === 2) {
   const wrapChoice = await showQuickPickStep([
    { label: 'No Wrap', description: `Keep the complete output on one flow axis${settings.wrapLimit === -1 ? ' (currently selected)' : ''}`, value: -1 },
    { label: 'Match Glyph Size', description: `Wrap after one glyph along the active writing axis${settings.wrapLimit === -2 ? ' (currently selected)' : ''}`, value: -2 },
    { label: 'Auto', description: `Use editor word-wrap column${settings.wrapLimit === 0 ? ' (currently selected)' : ''}`, value: 0 },
    ...[16, 32, 40, 80, 120].map(value => ({ label: `${value} text cells`, description: `${value === settings.wrapLimit ? 'Currently selected · ' : ''}Maximum extent along the flow axis`, value })),
    { label: 'Custom limit…', description: '1–1000 text cells', value: -1 },
   ], { title: 'Pretty Print* › Wrap', placeHolder: 'Choose the maximum extent along the flow axis' }, true);
   if (!wrapChoice) { return undefined; }
   if (wrapChoice === 'back') { step--; continue; }
  const wrapLimit = wrapChoice.value >= -2 ? wrapChoice.value : Number.parseInt(await vscode.window.showInputBox({
    title: 'Custom Bitmap Wrap Limit', prompt: 'Maximum text cells along the flow axis (1–1000)', value: String(settings.wrapLimit || 80),
    validateInput: value => /^(?:[1-9]|[1-9][0-9]{1,2}|1000)$/.test(value) ? undefined : 'Enter a whole number from 1 through 1000.',
  }) ?? '', 10);
   if (!Number.isInteger(wrapLimit)) { continue; }
   settings.wrapLimit = wrapLimit;
  } else if (step === 3) {
   const spacing = await showQuickPickStep([
    { label: 'Compact', description: `Trim blank edges along the flow axis${settings.compact ? ' (currently selected)' : ''}`, compact: true },
    { label: 'Padded', description: `Preserve each glyph raster’s full square extent${settings.compact ? '' : ' (currently selected)'}`, compact: false },
   ], { title: 'Pretty Print* › Spacing', placeHolder: 'Choose spacing between glyphs' }, true);
   if (!spacing) { return undefined; }
   if (spacing === 'back') { step--; continue; }
   settings.compact = spacing.compact;
  } else if (step === 4) {
   const flow = await showQuickPickStep([
    { label: 'Left to right', description: settings.flow === 'lr' ? 'Currently selected' : '', value: 'lr' as const },
    { label: 'Right to left', description: settings.flow === 'rl' ? 'Currently selected' : '', value: 'rl' as const },
    { label: 'Top to bottom', description: settings.flow === 'ud' ? 'Currently selected' : '', value: 'ud' as const },
    { label: 'Bottom to top', description: settings.flow === 'du' ? 'Currently selected' : '', value: 'du' as const },
   ], { title: 'Pretty Print* › Flow', placeHolder: 'Choose where consecutive glyphs advance' }, true);
   if (!flow) { return undefined; }
   if (flow === 'back') { step--; continue; }
   settings.flow = flow.value;
  } else if (step === 5) {
   const horizontal = settings.flow === 'lr' || settings.flow === 'rl';
   const wrapDirection = await showQuickPickStep([
    { label: 'Auto', description: `${horizontal ? 'New rows progress top to bottom' : 'New columns progress left to right'}${settings.wrapDirection === 'auto' ? ' (currently selected)' : ''}`, value: 'auto' as const },
    ...(horizontal
     ? [{ label: 'Top to bottom', description: `New rows progress downward${settings.wrapDirection === 'ud' ? ' (currently selected)' : ''}`, value: 'ud' as const }, { label: 'Bottom to top', description: `New rows progress upward${settings.wrapDirection === 'du' ? ' (currently selected)' : ''}`, value: 'du' as const }]
     : [{ label: 'Left to right', description: `New columns progress rightward${settings.wrapDirection === 'lr' ? ' (currently selected)' : ''}`, value: 'lr' as const }, { label: 'Right to left', description: `New columns progress leftward${settings.wrapDirection === 'rl' ? ' (currently selected)' : ''}`, value: 'rl' as const }]),
   ], { title: 'Pretty Print* › Wrap Direction', placeHolder: 'Choose the perpendicular line progression' }, true);
   if (!wrapDirection) { return undefined; }
   if (wrapDirection === 'back') { step--; continue; }
   settings.wrapDirection = wrapDirection.value;
  } else {
   const d4 = await showQuickPickStep(optionValues('d4', '').map(value => ({
    label: value, description: `${optionValueDetail('d4', value)}${value === settings.d4 ? ' (currently selected)' : ''}`, value: value as BitmapD4,
   })), { title: 'Pretty Print* › Transform', placeHolder: 'Choose a geometric transform for each glyph raster' }, true);
   if (!d4) { return undefined; }
   if (d4 === 'back') { step--; continue; }
   settings.d4 = d4.value;
  }
  step++;
 }
 return settings;
}

async function chooseCustomBitmapSize(context: vscode.ExtensionContext, lastUsed: number): Promise<number | undefined> {
 const choice = await vscode.window.showQuickPick(bitmapSizeChoices(lastUsed, context.globalState.get<number[]>('customBitmapSizes', [])), {
  title: 'Custom Art › Size', placeHolder: 'Choose the source raster resolution', matchOnDescription: true,
 });
 if (!choice) { return undefined; }
 if (!choice.custom) { return choice.size; }
 const size = Number.parseInt(await vscode.window.showInputBox({
  title: 'Custom Art Size', prompt: 'Square raster size in pixels (8–128)', value: String(lastUsed),
  validateInput: value => /^(?:[89]|[1-9][0-9]|1[01][0-9]|12[0-8])$/.test(value) ? undefined : 'Enter a whole number from 8 through 128.',
 }) ?? '', 10);
 if (!Number.isInteger(size)) { return undefined; }
 await rememberCustomBitmapSize(context, size);
 return size;
}

async function rememberCustomBitmapSize(context: vscode.ExtensionContext, size: number): Promise<void> {
 const history = context.globalState.get<number[]>('customBitmapSizes', []);
 await context.globalState.update('customBitmapSizes', [size, ...history.filter(value => value !== size)].slice(0, 3));
}

const propertyFilters: ReadonlyArray<{ key: FilterKey; label: string; description: string }> = [
 { key: 'category', label: 'Category', description: 'Unicode general category' },
 { key: 'bidi', label: 'Bidirectional class', description: 'Text writing direction behavior' },
 { key: 'combining', label: 'Combining class', description: 'Canonical combining class' },
 { key: 'decomp', label: 'Decomposition', description: 'Unicode decomposition type' },
 { key: 'lang', label: 'Language family', description: 'Language/script family; alias: language' },
 { key: 'block', label: 'Unicode block', description: 'Named Unicode code-point block' },
 { key: 'emoji', label: 'Emoji presentation', description: 'Color emoji, text emoji, or non-emoji' },
];
const utilityActions: readonly UtilityAction[] = [
 { key: 'recent', label: 'Recent…', terms: ['recent', 'recents', 'history'], command: 'youhavecode.insertRecentGlyph', commandTitle: 'Show recent glyphs', kind: vscode.CompletionItemKind.Folder, rootSort: '!50' },
 { key: 'frequent', label: 'Frequent…', terms: ['frequent', 'frequency', 'usage'], command: 'youhavecode.insertFrequentGlyph', commandTitle: 'Show frequent glyphs', kind: vscode.CompletionItemKind.Folder, rootSort: '!60' },
 { key: 'properties', label: 'Properties…', terms: ['properties', 'property', 'filters', 'pretty', 'print', 'bitmap'], command: 'youhavecode.propertyFilters', commandTitle: 'Open Unicode properties', kind: vscode.CompletionItemKind.Folder, rootSort: '!70' },
 { key: 'customTags', label: 'Custom Tags…', terms: ['custom', 'tags', 'keywords'], command: 'youhavecode.customTags', commandTitle: 'Open custom tags', kind: vscode.CompletionItemKind.Folder, rootSort: '!72' },
 { key: 'outputFormat', label: 'Output Format…', terms: ['output', 'format', 'insertion', 'pretty', 'print', 'bitmap'], command: 'youhavecode.outputFormats', commandTitle: 'Open output formats', kind: vscode.CompletionItemKind.Folder, rootSort: '!90' },
 { key: 'defaultFilters', label: 'Default Filters…', terms: ['default', 'defaults', 'filter', 'filters', 'properties'], command: 'youhavecode.defaultFilters', commandTitle: 'Open default filters', kind: vscode.CompletionItemKind.Folder, rootSort: '!91' },
 { key: 'compatibility', label: 'Compatibility…', terms: ['compatibility', 'support', 'platform', 'operating', 'system', 'font'], command: 'youhavecode.compatibility', commandTitle: 'Open compatibility settings', kind: vscode.CompletionItemKind.Folder, rootSort: '!92' },
 { key: 'settings', label: 'YouHaveCode Settings', terms: ['settings', 'configuration', 'preferences'], command: 'workbench.action.openSettings', commandTitle: 'Open settings', commandArguments: ['youhavecode'], kind: vscode.CompletionItemKind.Event, rootSort: '!93' },
];

const matchingUtilityActions = (draft: string): readonly UtilityAction[] => {
 const normalized = draft.toLowerCase();
 return utilityActions.filter(action => !normalized || action.terms.some(term => term.startsWith(normalized)));
};

export async function activate(context: vscode.ExtensionContext) {
 const recentGlyphsKey = 'recentGlyphHexes';
 const recentGlyphPresentationsKey = 'recentGlyphPresentations';
 const recentQueryTokensKey = 'recentQueryTokens';
 const insertionFormatKey = 'insertionFormat';
 const usageStatsKey = 'usageStats';
 const customGlyphTagsKey = 'customGlyphTags';
 const customTagUsageKey = 'customTagUsage';
 const lastSelectionOutputKey = 'lastSelectionOutput';
 const developerDebugModeKey = 'developerDebugMode';
 const savedInsertionFormat = context.globalState.get<string>(insertionFormatKey, 'symbols');
 const legacyInsertionFormat = savedInsertionFormat === 'tags' ? 'details' : savedInsertionFormat as DeconstructionFormat;
 let insertionFormat = outputFormat(vscode.workspace.getConfiguration('youhavecode').get('defaultOutput', 'glyph'), legacyInsertionFormat);
 let developerDebugMode = context.globalState.get<boolean>(developerDebugModeKey, false);
 let entriesPromise: Promise<UnicodeEntry[]> | undefined;
 let aliasesPromise: ReturnType<typeof loadAliases> | undefined;
 let wordsPromise: ReturnType<typeof buildNameWords> | undefined;
 let compatibilityProfilesPromise: Promise<CompatibilityProfiles> | undefined;
 let suggestTimer: ReturnType<typeof setTimeout> | undefined;
 let typingSuggestTimer: ReturnType<typeof setTimeout> | undefined;
 let completionAnchor: { document: vscode.TextDocument; line: number; character: number; prefix: string } | undefined;
 let continuationAnchor: { document: vscode.TextDocument; version: number; line: number; character: number; bounded?: boolean } | undefined;
 let inlineMenuAnchor: { kind: 'recent' | 'frequent' | 'properties' | 'quickSettings' | 'customTags' | 'customTagActions' | 'outputFormats' | 'defaultFilters' | 'defaultFilterValues' | 'compatibility' | 'compatibilityTarget' | 'compatibilityFallback'; document: vscode.TextDocument; version: number; line: number; character: number; expressionStart: number; tag?: string; filterKey?: FilterKey; compatibilityTarget?: CompatibilityTarget; compatibilityFallback?: 'unknown' | 'localFont' } | undefined;
 const refreshPrettyPrintFontFamilies = () => {
  const configuration = vscode.workspace.getConfiguration('youhavecode');
  const configured = configuration.get<string>('prettyPrintFontFamily', '').trim();
  const editorFamilies = parseFontFamilyList(vscode.workspace.getConfiguration('editor', vscode.window.activeTextEditor?.document.uri).get<string>('fontFamily', ''));
  setPrettyPrintFontFamilies(configured || defaultPrettyPrintFontFamilies(editorFamilies).join(', '), configuration.get<string[]>('prettyPrintFontFamilyDisabled', []));
 };
 refreshPrettyPrintFontFamilies();
 context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(refreshPrettyPrintFontFamilies));
 await vscode.commands.executeCommand('setContext', 'youhavecode.developerDebugMode', developerDebugMode);
 let repeatingQuery: { document: vscode.TextDocument; line: number } | undefined;
 let repeatingBitmap: { document: vscode.TextDocument; startOffset: number; source: string; output: string; signature: string; leadingText: string } | undefined;
 let replayTokens = context.globalState.get<string[]>(recentQueryTokensKey, []);
 let renderDefaults = configuredRenderDefaults(context);
 const savedSelectionOutput = context.globalState.get<string>(lastSelectionOutputKey);
 let lastSelectionOutput = bitmapOutputFormat(savedSelectionOutput) ? savedSelectionOutput!
  : bitmapOutputFormat(renderDefaults.render) ? renderDefaults.render : 'braille';
 let usageStats = context.globalState.get<UsageStats>(usageStatsKey, emptyUsageStats());
 const savedCustomGlyphTags = context.globalState.get<Record<string, string[]>>(customGlyphTagsKey);
 let customGlyphTags = savedCustomGlyphTags ?? { '2605': ['favorite'] };
 if (!savedCustomGlyphTags) { await context.globalState.update(customGlyphTagsKey, customGlyphTags); }
 let customTagUsage = context.globalState.get<Record<string, UsageRecord>>(customTagUsageKey, {});
 const textGlyphIcons = new Map<string, Promise<vscode.IconPath>>();
 const textGlyphIcon = (character: string) => {
  const cached = textGlyphIcons.get(character);
  if (cached) { return cached; }
  const generated = (async (): Promise<vscode.IconPath> => {
  const directory = vscode.Uri.joinPath(context.globalStorageUri, 'text-glyph-icons');
  const key = Array.from(character, glyph => glyph.codePointAt(0)!.toString(16)).join('-');
  const dark = vscode.Uri.joinPath(directory, `${key}-v2-dark.png`);
  const light = vscode.Uri.joinPath(directory, `${key}-v2-light.png`);
  await vscode.workspace.fs.createDirectory(directory);
  const files: readonly [vscode.Uri, string][] = [[dark, '#FFFFFF'], [light, '#000000']];
  await Promise.all(files.map(async ([uri, color]) => {
   try { await vscode.workspace.fs.stat(uri); }
   catch { await vscode.workspace.fs.writeFile(uri, glyphIconPng(character, 32, color)); }
  }));
  return { dark, light };
  })();
  textGlyphIcons.set(character, generated);
  return generated;
 };
 let preferredGlyphHex: string | undefined;
 const loadEntries = () => entriesPromise ??= Promise.all([
  vscode.workspace.fs.readFile(vscode.Uri.joinPath(context.extensionUri, 'data', 'unicode_compact.csv')),
  vscode.workspace.fs.readFile(vscode.Uri.joinPath(context.extensionUri, 'data', 'emoji_rgi.tsv')),
 ]).then(([unicode, emoji]) => mergeEmojiEntries(
  parseCompactUnicode(new TextDecoder().decode(unicode)),
  parseEmojiRgi(new TextDecoder().decode(emoji)),
 ));
 const loadCompatibilityProfiles = () => compatibilityProfilesPromise ??= Promise.resolve(vscode.workspace.fs.readFile(vscode.Uri.joinPath(context.extensionUri, 'data', 'compatibility_profiles.json')))
  .then(bytes => parseCompatibilityProfiles(bytes), () => fallbackCompatibilityProfiles);
 function loadAliases() {
  return Promise.resolve(vscode.workspace.fs.readFile(vscode.Uri.joinPath(context.extensionUri, 'data', 'unicode_property_aliases.csv')))
   .then(bytes => parseUnicodePropertyAliases(new TextDecoder().decode(bytes)));
 }
 const getAliases = () => aliasesPromise ??= loadAliases();
 const loadWords = async () => wordsPromise ??= buildNameWords(await loadEntries(), customGlyphTags);
 const triggerPrefixes = () => {
  const configuration = vscode.workspace.getConfiguration('youhavecode');
  const primary = configuration.get<string>('triggerPrefix', 'u:');
  const unicodePrefixes = ['\\u*', '\\u:', '\\u#', '\\u&', '\\u\\', '\\u'];
  return configuration.get('enableDoubleColonPrefix', true) ? [...new Set([primary, ...unicodePrefixes, ':::', '::'])] : [...new Set([primary, ...unicodePrefixes])];
 };
 const configuredDefaultFilters = () => {
  const inspected = vscode.workspace.getConfiguration('youhavecode').inspect<DefaultFilterConfig>('defaultFilters');
  return Object.assign({}, inspected?.defaultValue, inspected?.globalValue, inspected?.workspaceValue, inspected?.workspaceFolderValue,
   inspected?.defaultLanguageValue, inspected?.globalLanguageValue, inspected?.workspaceLanguageValue, inspected?.workspaceFolderLanguageValue);
 };
 const configuredDefaultTerms = () => vscode.workspace.getConfiguration('youhavecode').get<string[]>('defaultSearchTerms', []);
 const configuredDisabledDefaultItems = () => vscode.workspace.getConfiguration('youhavecode').get<string[]>('disabledDefaultItems', []);
 const defaultPropertyId = (key: FilterKey) => `property:${key}`;
 const defaultTermId = (term: string) => `term:${term.toUpperCase()}`;
 const enabledDefaultFilters = () => {
  const configured = { ...configuredDefaultFilters() };
  const disabled = new Set(configuredDisabledDefaultItems());
  filterKeys.forEach(key => { if (disabled.has(defaultPropertyId(key))) { delete configured[key]; } });
  return configured;
 };
 const enabledDefaultTerms = () => {
  const disabled = new Set(configuredDisabledDefaultItems());
  return configuredDefaultTerms().filter(term => !disabled.has(defaultTermId(term)));
 };
 const updateDisabledDefaultItems = (items: readonly string[]) => vscode.workspace.getConfiguration('youhavecode').update(
  'disabledDefaultItems', items.length ? [...new Set(items)] : undefined, vscode.ConfigurationTarget.Global,
 );
 const defaultFilterSummary = () => {
  const configured = enabledDefaultFilters();
  return filterKeys.flatMap(key => configured[key] ? [`(${key}=${configured[key]})`] : []).join('');
 };
 const configuredCompatibilityTargets = () => resolveCompatibilityTargets(vscode.workspace.getConfiguration('youhavecode').get<Partial<CompatibilityTargetSettings>>('compatibilityTargets', {}));
 const configuredCompatibilityFallback = (key: 'compatibilityUnknownPolicy' | 'compatibilityLocalFontPolicy') => vscode.workspace.getConfiguration('youhavecode').get<CompatibilityFallbackPolicy>(key, 'warn');
 const configuredCompatibilitySummary = () => compatibilitySummary(configuredCompatibilityTargets(), configuredCompatibilityFallback('compatibilityUnknownPolicy'), configuredCompatibilityFallback('compatibilityLocalFontPolicy'));
 const effectiveConfigurationTarget = (key: string): vscode.ConfigurationTarget => {
  const inspected = vscode.workspace.getConfiguration('youhavecode').inspect(key);
  return inspected?.workspaceFolderValue !== undefined ? vscode.ConfigurationTarget.WorkspaceFolder
   : inspected?.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
 };
 const fontPreferenceState = () => {
  const configuration = vscode.workspace.getConfiguration('youhavecode');
  const configured = parseFontFamilyList(configuration.get<string>('prettyPrintFontFamily', ''));
  const editorFamilies = parseFontFamilyList(vscode.workspace.getConfiguration('editor', vscode.window.activeTextEditor?.document.uri).get<string>('fontFamily', ''));
  const disabled = configuration.get<string[]>('prettyPrintFontFamilyDisabled', []);
  const disabledNames = new Set(disabled.map(family => family.toLocaleLowerCase()));
  const active = (configured.length ? configured : defaultPrettyPrintFontFamilies(editorFamilies)).filter(family => !disabledNames.has(family.toLocaleLowerCase()));
  const available = installedFontFamilies().sort((left, right) => left.localeCompare(right));
  return { active, disabled, available: [...new Set([...active, ...disabled, ...available])] };
 };
 const fontFamilyFromItem = (item: string | { fontFamily?: string }) => typeof item === 'string' ? item : item.fontFamily;
 const saveFontPreference = async (active: readonly string[], disabled: readonly string[]) => {
  const configuration = vscode.workspace.getConfiguration('youhavecode');
  await Promise.all([
   configuration.update('prettyPrintFontFamily', active.join(', '), effectiveConfigurationTarget('prettyPrintFontFamily')),
   configuration.update('prettyPrintFontFamilyDisabled', [...new Set(disabled)], effectiveConfigurationTarget('prettyPrintFontFamilyDisabled')),
  ]);
  sidebar.refresh();
 };
 const sidebar = new UnicodeSidebarProvider({
  entries: loadEntries,
  recentHexes: () => context.globalState.get<string[]>(recentGlyphsKey, []).map(value => value.includes('\u0000') ? value : glyphVariantKey(value, context.globalState.get<Record<string, EmojiPresentation>>(recentGlyphPresentationsKey, {})[value] ?? 'auto')),
  recentPresentation: hex => context.globalState.get<Record<string, EmojiPresentation>>(recentGlyphPresentationsKey, {})[hex],
  emojiPresentation: () => vscode.workspace.getConfiguration('youhavecode').get<EmojiPresentation>('emojiPresentation', 'auto'),
  textGlyphIcon,
  usage: () => usageStats,
  customTags: () => customGlyphTags,
  properties: () => propertyFilters,
  defaultFilters: configuredDefaultFilters,
  defaultTerms: configuredDefaultTerms,
  disabledDefaults: configuredDisabledDefaultItems,
  output: () => vscode.workspace.getConfiguration('youhavecode').get('defaultOutput', 'glyph'),
  prettyPrintDefaults: () => {
   const defaults = configuredRenderDefaults(context);
  const bitmapFormat = bitmapOutputFormat(defaults.render);
  return { output: bitmapFormat ? bitmapOutputValue(bitmapFormat) : 'braille', size: defaults.size, wrap: defaults.wrap, compact: defaults.compact, mapping: defaults.mapping ?? 'baseline', flow: defaults.flow, 'wrap-direction': defaults['wrap-direction'], d4: defaults.d4 };
  },
  prettyPrintFontFamilies: () => {
   const state = fontPreferenceState();
   return { active: state.active, available: state.available };
  },
  developerDebugMode: () => developerDebugMode,
  editorWrap: () => vscode.workspace.getConfiguration('editor', vscode.window.activeTextEditor?.document.uri).get<string>('wordWrap', 'off'),
  d4Icon: operation => ({
   dark: vscode.Uri.joinPath(context.extensionUri, 'resources', 'd4', `${operation}-dark.svg`),
   light: vscode.Uri.joinPath(context.extensionUri, 'resources', 'd4', `${operation}-light.svg`),
  }),
  directionIcon: (direction, paired = false) => ({
   dark: vscode.Uri.joinPath(context.extensionUri, 'resources', 'direction', `${paired ? 'wrap-' : ''}${direction}-dark.svg`),
   light: vscode.Uri.joinPath(context.extensionUri, 'resources', 'direction', `${paired ? 'wrap-' : ''}${direction}-light.svg`),
  }),
  compatibility: () => ({ targets: configuredCompatibilityTargets(), unknown: configuredCompatibilityFallback('compatibilityUnknownPolicy'), localFont: configuredCompatibilityFallback('compatibilityLocalFontPolicy') }),
 });
 const emojiPresentation = () => vscode.workspace.getConfiguration('youhavecode').get<EmojiPresentation>('emojiPresentation', 'auto');
 const presentedCharacter = (character: string, presentation = emojiPresentation()) => applyEmojiPresentation(character, presentation);
 const recordUsage = async (hex: string, presentation = emojiPresentation()) => {
  const recent = context.globalState.get<string[]>(recentGlyphsKey, []);
  const presentations = context.globalState.get<Record<string, EmojiPresentation>>(recentGlyphPresentationsKey, {});
  const variantKey = glyphVariantKey(hex, presentation);
  const nextRecent = [variantKey, ...recent.filter(value => value !== variantKey)].slice(0, 20);
  const nextPresentations = Object.fromEntries(nextRecent.flatMap(value => {
   const { hex: recentHex } = parseGlyphVariantKey(value);
   const recentPresentation = parseGlyphVariantKey(value).presentation as EmojiPresentation | undefined;
   return [[recentHex, recentPresentation ?? presentations[recentHex] ?? 'auto']];
  }));
  usageStats = recordGlyph(usageStats, hex, presentation);
  await Promise.all([
   context.globalState.update(recentGlyphsKey, nextRecent),
   context.globalState.update(recentGlyphPresentationsKey, nextPresentations),
   context.globalState.update(usageStatsKey, usageStats),
  ]);
  sidebar.refresh();
 };
 const recordQueryTokens = async (tokens: readonly string[]) => {
  usageStats = recordTokens(usageStats, tokens);
  await context.globalState.update(usageStatsKey, usageStats);
 };
 const rememberQueryTokens = async (tokens: string[]) => {
  replayTokens = tokens;
  await context.globalState.update(recentQueryTokensKey, tokens);
 };
 const applyTagEdits = async (hex: string, edits: readonly UnicodeTagEdit[]) => {
  if (!edits.length) { return; }
  customGlyphTags = applyCustomTagEdits(customGlyphTags, hex, edits);
  edits.filter(edit => edit.operation !== 'delete').forEach(edit => { customTagUsage = recordUsageValue(customTagUsage, edit.tag); });
  wordsPromise = undefined;
  await Promise.all([
   context.globalState.update(customGlyphTagsKey, customGlyphTags),
   context.globalState.update(customTagUsageKey, customTagUsage),
  ]);
 };
 const reopenAfterGlyph = async (hex: string, delay = 200, bounded = false) => {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { return; }
  const position = editor.selection.active;
  preferredGlyphHex = hex;
  continuationAnchor = { document: editor.document, version: editor.document.version, line: position.line, character: position.character, bounded };
  await vscode.commands.executeCommand('setContext', 'youhavecode.queryActive', false);
  await vscode.commands.executeCommand('hideSuggestWidget');
  if (suggestTimer) { clearTimeout(suggestTimer); }
  suggestTimer = setTimeout(() => {
   suggestTimer = undefined;
   const active = vscode.window.activeTextEditor;
   const anchor = continuationAnchor;
   if (!active || !anchor || active.document !== anchor.document || active.document.version !== anchor.version
    || active.selection.active.line !== anchor.line || active.selection.active.character !== anchor.character) { return; }
   void vscode.commands.executeCommand('editor.action.triggerSuggest');
  }, delay);
 };
 const insertBestGlyph = async () => {
  const editor = vscode.window.activeTextEditor;
  const query = activeQuery();
  if (!editor || !query) { return; }
  if (query.draft && replayTokens.length) { await rememberQueryTokens([]); }
  const availableReplayTokens = replayTokens.filter(token => !query.tokens.includes(token));
  const replayPosition = editor.selection.active;
  const anchor = continuationAnchor;
  const continuationSession = !!anchor && anchor.document === editor.document && anchor.version === editor.document.version
   && anchor.line === replayPosition.line && query.prefix === '::' && query.expressionStart === anchor.character;
  if ((query.prefix === ':::' || continuationSession) && !query.draft && availableReplayTokens.length) {
   const token = availableReplayTokens[0];
   const visiblePrefix = editor.document.lineAt(replayPosition.line).text.slice(query.expressionStart, replayPosition.character).startsWith('::');
   const inserted = await editor.edit(builder => builder.insert(replayPosition, visiblePrefix || query.prefix === ':::' ? token : `${anchor?.bounded ? ':' : '::'}${token}`));
   if (inserted) {
    replayTokens = replayTokens.filter(candidate => candidate !== token);
    await context.globalState.update(recentQueryTokensKey, replayTokens);
    await continueFiltering();
   }
   return;
  }
  if (query.mode === 'filterValue' && query.filterKey) {
    const value = orderFilterValues(filterValues(await loadEntries(), query.filterKey, query.draft), recentFilterValues(usageStats, query.filterKey))[0];
   if (value) { await acceptQueryValue(value); }
   return;
  }
  if (query.mode === 'optionValue' && query.optionKey) {
   const value = optionValues(query.optionKey, query.draft)[0];
   if (value) { await acceptQueryValue(value); }
   return;
  }
  if (query.mode === 'tagValue' && query.tagOperation) {
   const knownTags = [...new Set(Object.values(customGlyphTags).flat())].sort();
   const draft = query.draft.trim().toLowerCase();
   const value = draft || knownTags[0];
   if (value) { await acceptQueryValue(value); }
   return;
  }
  if (query.mode === 'glyphProperty' && query.glyphLiteral) {
   const entry = (await loadEntries()).find(candidate => candidate.character === query.glyphLiteral);
   const expansion = entry && glyphPropertyExpansions(entry, query.draft)[0];
   if (!expansion) { await continueFiltering(); return; }
   const position = editor.selection.active;
   const inserted = await editor.edit(builder => builder.replace(
    new vscode.Range(position.line, query.draftStart, position.line, position.character), expansion.value,
   ));
   if (inserted) { await continueFiltering(); }
   return;
  }
  const action = actionKeys.find(candidate => `*${candidate}`.startsWith(query.draft.toLowerCase()));
  if (query.mode === 'token' && query.draft.startsWith('*') && action) {
   const position = editor.selection.active;
   const parenthesized = query.draftStart > query.expressionStart + query.prefix.length
    && editor.document.lineAt(position.line).text[query.draftStart - 1] === '(';
   const inserted = await editor.edit(builder => builder.replace(
    new vscode.Range(position.line, query.draftStart, position.line, position.character),
    parenthesized ? `*${action})` : `(*${action})`,
   ));
   if (inserted) { await continueFiltering(); }
   return;
  }
  if (query.mode === 'token' && !query.draft && query.actions.includes('print')) {
   const appliedOptionKeys = new Set(query.options.map(option => option.key));
   const optionKey = suggestedOptionKeys.find(candidate => !appliedOptionKeys.has(candidate));
   if (optionKey) {
    const position = editor.selection.active;
    const inserted = await editor.edit(builder => builder.insert(position, `(${optionKey}=`));
    if (inserted) { await continueFiltering(); }
    return;
   }
  }
  const utilityAction = query.mode === 'token' && query.draft ? matchingUtilityActions(query.draft)[0] : undefined;
  if (utilityAction) {
   const position = editor.selection.active;
   const removed = await editor.edit(builder => builder.delete(new vscode.Range(position.line, query.draftStart, position.line, position.character)));
    if (removed) {
     const actionPosition = new vscode.Position(position.line, query.draftStart);
     editor.selection = new vscode.Selection(actionPosition, actionPosition);
     await vscode.commands.executeCommand(utilityAction.command, ...(utilityAction.commandArguments ?? []));
    }
   return;
  }
  const filterInput = filterInputKeys.find(candidate => candidate.startsWith(query.draft.toLowerCase()));
  const key = filterInput ? canonicalFilterKey(filterInput) : suggestedOptionKeys.find(candidate => candidate.startsWith(query.draft.toLowerCase()));
  if (query.mode === 'token' && query.draft && key) {
   const position = editor.selection.active;
   const inserted = await editor.edit(builder => builder.replace(
    new vscode.Range(position.line, query.draftStart, position.line, position.character),
    `(${key}=`,
   ));
   if (inserted) { await continueFiltering(); }
   return;
  }
  const [entries, words] = await Promise.all([loadEntries(), loadWords()]);
  const literalEntry = query.draft ? entries.find(entry => entry.character === query.draft) : undefined;
  const literalExpansion = literalEntry ? glyphPropertyExpansions(literalEntry, 'name')[0]?.value : undefined;
  if (literalExpansion) {
   const position = editor.selection.active;
   const completed = await editor.edit(builder => builder.replace(
    new vscode.Range(position.line, query.draftStart, position.line, position.character), literalExpansion,
   ));
   if (completed) { await continueFiltering(); }
   return;
  }
  const word = query.prefix.startsWith('::')
   ? query.draft
    ? matchingWords(words, query.draft).sort((left, right) => left.value.length - right.value.length || right.count - left.count || left.value.localeCompare(right.value))[0]
    : query.words.length || query.filters.length ? topMatchingWords(entries, query, customGlyphTags)[0] : undefined
   : undefined;
  if (word) {
   const position = editor.selection.active;
   const parenthesized = query.draftStart > query.expressionStart + query.prefix.length
    && editor.document.lineAt(position.line).text[query.draftStart - 1] === '(';
   const completed = await editor.edit(builder => builder.replace(
    new vscode.Range(position.line, query.draftStart, position.line, position.character),
    parenthesized ? `${word.value.toLowerCase()})` : `(${word.value.toLowerCase()})`,
   ));
   if (completed) { await continueFiltering(); }
   return;
  }
  const results = !query.draft && !query.words.length && !query.filters.length
    ? initialEntries(entries, rankGlyphHexes(usageStats, 'recent'), 1)
    : matchingEntries(entries, query, 1, customGlyphTags);
  const best = results[0];
  if (!best) { await continueFiltering(); return; }
  const position = editor.selection.active;
  const leadingText = editor.document.lineAt(position.line).text.slice(0, query.expressionStart);
  const output = await renderQueryOutput(best, entries, query, insertionFormat, renderDefaults, context, leadingText);
  const outputStart = editor.document.offsetAt(new vscode.Position(position.line, query.expressionStart));
  const inserted = await editor.edit(builder => builder.replace(
   new vscode.Range(position.line, query.expressionStart, position.line, position.character),
    output + (query.prefix === ':::' ? ':::' : ''),
  ));
    if (inserted) {
    await recordUsage(best.hex);
    await applyTagEdits(best.hex, query.tagEdits);
    await recordQueryTokens(reusableQueryTokens(query));
    if (query.prefix === ':::') {
      if (isBitmapQueryOutput(query, effectiveQueryOption(query, 'render', renderDefaults))) {
      repeatingBitmap = { document: editor.document, startOffset: outputStart, source: presentedCharacter(best.character), output, signature: queryOutputLabel(query, insertionFormat, renderDefaults), leadingText };
      } else { repeatingBitmap = undefined; }
      preferredGlyphHex = best.hex;
     await rememberQueryTokens(reusableQueryTokens(query));
     await continueFiltering();
    } else if (query.prefix === '::') { await reopenAfterGlyph(best.hex); }
    }
 };
 const assignTagToPreviousGlyph = async (requestedTag?: string) => {
  const editor = vscode.window.activeTextEditor;
  const query = activeQuery();
  if (!editor || !query?.unwrappedTag || query.tagOperation !== 'add') { return; }
  const tag = (requestedTag ?? query.draft).trim().toLowerCase();
  if (!/^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u.test(tag)) { return; }
  const position = editor.selection.active;
  const leading = editor.document.lineAt(position.line).text.slice(0, query.expressionStart);
  const preceding = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(leading)].at(-1)?.segment;
  const entry = preceding && (await loadEntries()).find(candidate => candidate.character === preceding);
  if (!entry) { await vscode.window.setStatusBarMessage('No preceding Unicode glyph to tag', 2500); return; }
  await applyTagEdits(entry.hex, [{ operation: 'add', tag }]);
  const applied = await editor.edit(builder => builder.delete(new vscode.Range(position.line, query.expressionStart, position.line, position.character)));
  if (applied) {
   await vscode.window.setStatusBarMessage(`Added ${tag} to ${entry.character}`, 2500);
   await vscode.commands.executeCommand('hideSuggestWidget');
  }
 };
 const acceptQueryValue = async (value: string) => {
  const editor = vscode.window.activeTextEditor;
  const query = activeQuery();
  if (!editor || !query) { return; }
  if (query.unwrappedTag && query.tagOperation === 'add') { await assignTagToPreviousGlyph(value); return; }
  const position = editor.selection.active;
  const inserted = await editor.edit(builder => {
   let acceptedValue = value;
   if (query.mode === 'filterValue' && query.filterKey) {
    const previous = query.filters.find(filter => filter.key === query.filterKey);
    acceptedValue = [...new Set([...(previous?.value.split('|') ?? []), ...value.split('|')])].join('|');
    const line = editor.document.lineAt(position.line).text;
    const beforeCurrent = line.slice(query.expressionStart, query.draftStart - query.filterKey.length - 2);
    const pattern = new RegExp(`\\(${query.filterKey}=[^)]+\\)`, 'g');
    for (const match of beforeCurrent.matchAll(pattern)) {
     const start = query.expressionStart + match.index!;
     builder.delete(new vscode.Range(position.line, start, position.line, start + match[0].length));
    }
   }
  builder.replace(
   query.unwrappedFilter
    ? new vscode.Range(position.line, query.expressionStart + query.prefix.length, position.line, position.character)
    : new vscode.Range(position.line, query.draftStart, position.line, position.character),
   query.unwrappedFilter ? `(${query.filterKey}=${acceptedValue})` : `${acceptedValue})`,
  );
  });
  if (inserted) { await continueFiltering(); }
 };
 const navigateSuggestion = async (command: 'selectPrevSuggestion' | 'selectNextSuggestion') => {
  await vscode.commands.executeCommand('setContext', 'youhavecode.suggestionNavigated', true);
  await vscode.commands.executeCommand(command);
 };
 const continueFiltering = async (delay = 200) => {
  if (typingSuggestTimer) { clearTimeout(typingSuggestTimer); typingSuggestTimer = undefined; }
  await vscode.commands.executeCommand('setContext', 'youhavecode.suggestionNavigated', false);
  await vscode.commands.executeCommand('setContext', 'youhavecode.queryActive', activeQuery() !== undefined);
  await vscode.commands.executeCommand('hideSuggestWidget');
  if (suggestTimer) { clearTimeout(suggestTimer); }
  const editor = vscode.window.activeTextEditor;
  const snapshot = editor && { document: editor.document, version: editor.document.version, selection: editor.selection };
  const unchanged = () => !!snapshot && vscode.window.activeTextEditor?.document === snapshot.document
   && snapshot.document.version === snapshot.version && vscode.window.activeTextEditor.selection.isEqual(snapshot.selection)
   && activeQuery() !== undefined;
  suggestTimer = setTimeout(() => {
   suggestTimer = undefined;
   if (!unchanged()) { suggestTimer = undefined; return; }
   void vscode.commands.executeCommand('hideSuggestWidget')
    .then(() => vscode.commands.executeCommand('editor.action.triggerSuggest'));
  }, delay);
 };
 const consumeReplayToken = async (token: string) => {
  if (replayTokens.includes(token)) {
   replayTokens = replayTokens.filter(candidate => candidate !== token);
   await context.globalState.update(recentQueryTokensKey, replayTokens);
  }
  await continueFiltering();
 };
 const undoQueryComponent = async () => {
  const editor = vscode.window.activeTextEditor;
  const query = activeQuery();
  if (!editor || !query) { return; }
  const position = editor.selection.active;
  const line = editor.document.lineAt(position.line).text;
  const bodyStart = query.expressionStart + query.prefix.length;
  const body = line.slice(bodyStart, position.character);
  let start = bodyStart;
  let end = position.character;
  if (body) {
   const lastClose = body.lastIndexOf(')');
   if (lastClose < body.length - 1) {
    const trailing = body.slice(lastClose + 1);
    const separator = Math.max(trailing.lastIndexOf('-'), trailing.lastIndexOf('_'));
    start = bodyStart + lastClose + 1 + (separator >= 0 ? separator : 0);
   } else {
    start = bodyStart + body.lastIndexOf('(');
   }
  } else if (query.expressionStart > 0) {
   const leading = line.slice(0, query.expressionStart);
   const segments = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(leading)];
   start = segments.at(-1)?.index ?? query.expressionStart;
    end = query.expressionStart;
  } else { return; }
    const removed = await editor.edit(builder => builder.delete(new vscode.Range(position.line, start, position.line, end)));
  if (removed) { await continueFiltering(0); }
 };
 const commitGlyph = async (
  hex: string,
  repeat: boolean,
  tokens: string[] = [],
  _options: UnicodeOption[] = [],
  cleanup?: { line: number; start: number; end: number },
  bitmap?: { query: UnicodeQuery; leadingText: string },
  tagEdits: UnicodeTagEdit[] = [],
  continueAfterInsert = false,
  bounded = false,
   selectedPresentation = emojiPresentation(),
 ) => {
    await recordUsage(hex, selectedPresentation);
  await applyTagEdits(hex, tagEdits);
  await recordQueryTokens(tokens);
  const editor = vscode.window.activeTextEditor;
  if (editor && cleanup) {
   const position = editor.selection.active;
    if (bounded && editor.document.lineAt(position.line).text[position.character] === ':') {
     await editor.edit(builder => builder.delete(new vscode.Range(position, position.translate(0, 1))));
    }
   const cleanupRange = new vscode.Range(cleanup.line, cleanup.start, cleanup.line, cleanup.end);
   if (bitmap) {
    const entries = await loadEntries();
    const entry = entries.find(candidate => candidate.hex === hex);
    if (entry) {
     const selectedCharacter = applyEmojiPresentation(entry.character, selectedPresentation);
     const trailingLength = repeat ? 3 : 0;
     const placeholderEnd = position.translate(0, -trailingLength);
     const placeholderStart = placeholderEnd.translate(0, -selectedCharacter.length);
     const signature = queryOutputLabel(bitmap.query, insertionFormat, renderDefaults);
     const currentStartOffset = editor.document.offsetAt(cleanupRange.start);
     const canCombine = repeat && repeatingBitmap?.document === editor.document && repeatingBitmap.signature === signature
      && editor.document.getText(new vscode.Range(editor.document.positionAt(repeatingBitmap.startOffset), cleanupRange.start)) === repeatingBitmap.output;
    const source = `${canCombine ? repeatingBitmap!.source : ''}${selectedCharacter}`;
     const leadingText = canCombine ? repeatingBitmap!.leadingText : bitmap.leadingText;
     const output = await renderQueryOutput({ ...entry, character: source }, entries, bitmap.query, insertionFormat, renderDefaults, context, leadingText);
     const outputStart = canCombine ? repeatingBitmap!.startOffset : currentStartOffset;
     const replaced = await editor.edit(builder => {
      if (canCombine) { builder.replace(new vscode.Range(editor.document.positionAt(outputStart), placeholderEnd), output); }
      else {
       if (!cleanupRange.isEmpty) { builder.delete(cleanupRange); }
       builder.replace(new vscode.Range(placeholderStart, placeholderEnd), output);
      }
     });
     if (replaced) {
      const outputEnd = editor.document.positionAt(outputStart + output.length + trailingLength);
      editor.selection = new vscode.Selection(outputEnd, outputEnd);
      repeatingBitmap = repeat ? { document: editor.document, startOffset: outputStart, source, output, signature, leadingText } : undefined;
     }
    }
   } else if (!cleanupRange.isEmpty) {
    repeatingBitmap = undefined;
    await editor.edit(builder => builder.delete(cleanupRange));
   }
  }
  if (continueAfterInsert) {
   repeatingQuery = undefined;
   await rememberQueryTokens(tokens);
    await reopenAfterGlyph(hex, bitmap ? 500 : 200);
   return;
  }
  const position = editor?.selection.active;
  const repeating = repeat || !!editor && !!position && repeatingQuery?.document === editor.document && repeatingQuery.line === position.line;
  if (!repeating || !editor || !position) { repeatingQuery = undefined; return; }
  preferredGlyphHex = hex;
  const line = editor.document.lineAt(position.line).text;
  const trailingColons = /:+$/.exec(line.slice(0, position.character))?.[0].length ?? 0;
  if (trailingColons !== 3) {
   await editor.edit(builder => builder.replace(
    new vscode.Range(position.line, position.character - trailingColons, position.line, position.character),
    ':::',
   ));
  }
  await rememberQueryTokens(tokens);
  await continueFiltering(bitmap ? 500 : 300);
 };

 const boundedQueryAt = (document: vscode.TextDocument, position: vscode.Position) => {
  if (!vscode.workspace.getConfiguration('youhavecode').get('enableDoubleColonPrefix', true)) { return undefined; }
  const line = document.lineAt(position.line).text;
  if (line[position.character] !== ':') { return undefined; }
  const linePrefix = line.slice(0, position.character);
  const expressionStart = linePrefix.lastIndexOf(':');
  if (expressionStart < 0) { return undefined; }
  const anchored = continuationAnchor?.bounded && continuationAnchor.document === document
   && continuationAnchor.line === position.line && continuationAnchor.character === expressionStart;
  if (!anchored && expressionStart > 0 && /[\p{L}\p{N}_]/u.test(linePrefix[expressionStart - 1])) { return undefined; }
  const query = parseUnicodeQuery(`::${linePrefix.slice(expressionStart + 1)}`, ['::']);
  return query && { ...query, expressionStart, draftStart: expressionStart + query.draftStart - 1 };
 };
 const activeQuery = () => {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { return undefined; }
  const position = editor.selection.active;
  const linePrefix = editor.document.lineAt(position.line).text.slice(0, position.character);
  const bounded = boundedQueryAt(editor.document, position);
  const anchor = continuationAnchor;
  const continuationText = anchor?.document === editor.document && anchor.version === editor.document.version
   && anchor.line === position.line && position.character >= anchor.character ? linePrefix.slice(anchor.character) : undefined;
  const parsed = continuationText !== undefined && !continuationText.startsWith('::')
   ? parseUnicodeQuery(`::${continuationText}`, ['::'])
  : bounded ?? parseUnicodeQuery(linePrefix, triggerPrefixes());
  const query = parsed && continuationText !== undefined && !continuationText.startsWith('::') ? {
   ...parsed,
   expressionStart: anchor!.character,
   draftStart: anchor!.character + parsed.draftStart - 2,
  } : parsed;
  return query && withDefaultFilters(query, enabledDefaultFilters(), enabledDefaultTerms());
 };
 const openInlineQuery = async (menuCommand?: 'youhavecode.customTags' | 'youhavecode.propertyFilters', token = '') => {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { await vscode.window.showWarningMessage('Open a text editor before searching Unicode.'); return; }
  await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
  const inserted = await editor.edit(builder => editor.selections.forEach(selection => builder.replace(selection, `::${token}`)));
  if (!inserted) { return; }
  if (menuCommand) { await vscode.commands.executeCommand(menuCommand); }
  else { await vscode.commands.executeCommand('editor.action.triggerSuggest'); }
 };
 const toggleInlineTag = async (tag: string, restricted = false) => {
  const editor = vscode.window.activeTextEditor;
  const query = activeQuery(), token = `(${restricted ? '!' : ''}${tag})`, oppositeToken = `(${restricted ? '' : '!'}${tag})`;
  if (!editor || !query) { await openInlineQuery(undefined, token); return; }
  const position = editor.selection.active;
  const queryText = editor.document.lineAt(position.line).text.slice(query.expressionStart, position.character);
  const findToken = (value: string) => new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'iu').exec(queryText);
  const existing = findToken(token), opposite = findToken(oppositeToken);
  const changed = await editor.edit(builder => {
   if (existing?.index !== undefined) {
    const start = query.expressionStart + existing.index;
    builder.delete(new vscode.Range(position.line, start, position.line, start + existing[0].length));
   } else if (opposite?.index !== undefined) {
   const start = query.expressionStart + opposite.index;
   builder.replace(new vscode.Range(position.line, start, position.line, start + opposite[0].length), token);
   } else {
   builder.insert(new vscode.Position(position.line, query.draftStart), token);
   }
  });
  if (changed) { await continueFiltering(); }
 };
 const cycleInlineTag = async (tag: string) => {
  const editor = vscode.window.activeTextEditor;
  const query = activeQuery();
  if (!editor || !query) { await openInlineQuery(undefined, `(${tag})`); return; }
  const position = editor.selection.active;
  const queryText = editor.document.lineAt(position.line).text.slice(query.expressionStart, position.character);
  const required = new RegExp(`\\(${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`, 'iu').exec(queryText);
  const restricted = new RegExp(`\\(!${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`, 'iu').exec(queryText);
  const changed = await editor.edit(builder => {
   if (required?.index !== undefined) {
    const start = query.expressionStart + required.index;
    builder.replace(new vscode.Range(position.line, start, position.line, start + required[0].length), `(!${tag})`);
   } else if (restricted?.index !== undefined) {
    const start = query.expressionStart + restricted.index;
    builder.delete(new vscode.Range(position.line, start, position.line, start + restricted[0].length));
   } else {
    builder.insert(new vscode.Position(position.line, query.draftStart), `(${tag})`);
   }
  });
  if (changed) { await continueFiltering(); }
 };
 const sidebarGlyphHex = (value: string | { hex?: string }) => typeof value === 'string' ? value : value?.hex;
 const sidebarTagName = (value: string | { tag?: string }) => typeof value === 'string' ? value : value?.tag;
 const setSidebarTagDefault = async (item: string | { tag?: string }, restricted: boolean) => {
  const tag = sidebarTagName(item)?.trim().toUpperCase();
  if (!tag) { return; }
  const updated = configuredDefaultTerms().filter(term => term !== tag && term !== `!${tag}`);
  updated.push(`${restricted ? '!' : ''}${tag}`);
  const disabled = configuredDisabledDefaultItems().filter(id => id !== defaultTermId(tag) && id !== defaultTermId(`!${tag}`));
  await Promise.all([
   vscode.workspace.getConfiguration('youhavecode').update('defaultSearchTerms', updated, vscode.ConfigurationTarget.Global),
   updateDisabledDefaultItems(disabled),
  ]);
  sidebar.refresh();
 };
 const sidebarTagHexes = (tag: string) => Object.entries(customGlyphTags)
  .filter(([, tags]) => tags.includes(tag))
  .map(([hex]) => hex)
  .sort((left, right) => Number.parseInt(left, 16) - Number.parseInt(right, 16));
 const removeSidebarTagEndpoint = async (item: string | { tag?: string }, endpoint: 'first' | 'last') => {
  const tag = sidebarTagName(item);
  const hexes = tag ? sidebarTagHexes(tag) : [];
  const hex = endpoint === 'first' ? hexes[0] : hexes.at(-1);
  if (!tag || !hex) { return; }
  await applyTagEdits(hex, [{ operation: 'remove', tag }]);
  sidebar.refresh();
 };
   const setPrettyPrintFontFamilyEnabled = async (item: string | { fontFamily?: string }, enabled: boolean) => {
    const family = fontFamilyFromItem(item);
    if (!family) { return; }
    const state = fontPreferenceState();
    const disabled = state.disabled.filter(candidate => candidate.toLocaleLowerCase() !== family.toLocaleLowerCase());
    const active = state.active.filter(candidate => candidate.toLocaleLowerCase() !== family.toLocaleLowerCase());
    await saveFontPreference(enabled ? [...active, family] : active, enabled ? disabled : [...disabled, family]);
   };
   const movePrettyPrintFontFamily = async (item: string | { fontFamily?: string }, direction: 'top' | 'up' | 'down' | 'bottom') => {
    const family = fontFamilyFromItem(item);
    if (!family) { return; }
    const state = fontPreferenceState();
    const index = state.active.findIndex(candidate => candidate.toLocaleLowerCase() === family.toLocaleLowerCase());
    if (index < 0) { return; }
    const target = direction === 'top' ? 0 : direction === 'bottom' ? state.active.length - 1 : direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= state.active.length || target === index) { return; }
    const active = [...state.active];
    const [moved] = active.splice(index, 1);
    active.splice(target, 0, moved);
    await saveFontPreference(active, state.disabled);
   };
 context.subscriptions.push(
  vscode.window.registerTreeDataProvider('youhavecode.unicode', sidebar),
  vscode.commands.registerCommand('youhavecode.refreshSidebar', () => sidebar.refresh()),
  vscode.commands.registerCommand('youhavecode.openInlineTags', () => openInlineQuery('youhavecode.customTags')),
  vscode.commands.registerCommand('youhavecode.searchTag', toggleInlineTag),
  vscode.commands.registerCommand('youhavecode.createSidebarTag', async () => {
   await openInlineQuery();
   await vscode.commands.executeCommand('youhavecode.createCustomTag');
  }),
  vscode.commands.registerCommand('youhavecode.searchSidebarTag', (item: string | { tag?: string }) => {
   const tag = sidebarTagName(item);
   return tag ? vscode.commands.executeCommand('youhavecode.searchTag', tag) : undefined;
  }),
  vscode.commands.registerCommand('youhavecode.restrictSidebarTag', (item: string | { tag?: string }) => {
   const tag = sidebarTagName(item);
   return tag ? vscode.commands.executeCommand('youhavecode.searchTag', tag, true) : undefined;
  }),
  vscode.commands.registerCommand('youhavecode.cycleSidebarTagConstraint', (item: string | { tag?: string }) => {
   const tag = sidebarTagName(item);
   return tag ? cycleInlineTag(tag) : undefined;
  }),
  vscode.commands.registerCommand('youhavecode.setSidebarTagDefault', (item: string | { tag?: string }) => setSidebarTagDefault(item, false)),
  vscode.commands.registerCommand('youhavecode.setSidebarTagExcludedDefault', (item: string | { tag?: string }) => setSidebarTagDefault(item, true)),
  vscode.commands.registerCommand('youhavecode.removeSidebarTagFirst', (item: string | { tag?: string }) => removeSidebarTagEndpoint(item, 'first')),
  vscode.commands.registerCommand('youhavecode.removeSidebarTagLast', (item: string | { tag?: string }) => removeSidebarTagEndpoint(item, 'last')),
  vscode.commands.registerCommand('youhavecode.clearSidebarTag', async (item: string | { tag?: string }) => {
   const tag = sidebarTagName(item);
   const hexes = tag ? sidebarTagHexes(tag) : [];
   if (!tag || !hexes.length) { return; }
   const confirmed = await vscode.window.showWarningMessage(`Remove ${tag} from all ${hexes.length} assigned glyph${hexes.length === 1 ? '' : 's'}?`, { modal: true }, 'Clear Tag');
   if (confirmed !== 'Clear Tag') { return; }
   await applyTagEdits(hexes[0], [{ operation: 'delete', tag }]);
   sidebar.refresh();
  }),
  vscode.commands.registerCommand('youhavecode.openInlineProperties', () => openInlineQuery('youhavecode.propertyFilters')),
  vscode.commands.registerCommand('youhavecode.openInlineProperty', async (filterKey: FilterKey) => {
   const editor = vscode.window.activeTextEditor;
   const query = activeQuery();
   const token = `(${filterKey}=`;
   if (!editor || !query) { await openInlineQuery(undefined, token); return; }
   const inserted = await editor.edit(builder => builder.insert(editor.selection.active, token));
   if (inserted) { await vscode.commands.executeCommand('editor.action.triggerSuggest'); }
  }),
  vscode.commands.registerCommand('youhavecode.clearRecentGlyphs', async () => {
    await Promise.all([context.globalState.update(recentGlyphsKey, []), context.globalState.update(recentGlyphPresentationsKey, {})]);
   sidebar.refresh();
  }),
  vscode.commands.registerCommand('youhavecode.clearFrequentGlyphs', async () => {
   usageStats = { ...usageStats, glyphs: {}, glyphVariants: {} };
   await context.globalState.update(usageStatsKey, usageStats);
   sidebar.refresh();
  }),
  vscode.commands.registerCommand('youhavecode.toggleEditorLineWrapping', async () => {
    await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
   await vscode.commands.executeCommand('editor.action.toggleWordWrap');
   sidebar.refresh();
  }),
  vscode.commands.registerCommand('youhavecode.setSidebarPrettyPrintSetting', async (setting: string, value: string) => {
   const configuration = vscode.workspace.getConfiguration('youhavecode');
   const settings: Readonly<Record<string, readonly string[]>> = {
    output: ['braille', 'block-elements', 'iphone-blocks', 'emoji', 'binary', 'hex'], size: ['8x8', '12x12', '16x16', '24x24', '32x32', '48x48', '64x64', '96x96', '128x128'], wrap: ['none', 'glyph', 'auto', '16', '32', '40', '80', '120'], compact: ['on', 'off'], mapping: ['square', 'baseline', 'baseline-tight'], flow: ['auto', 'lr', 'rl', 'ud', 'du'], 'wrap-direction': ['auto', 'ud', 'du', 'lr', 'rl'], d4: ['identity', 'rotate-90', 'rotate-180', 'rotate-270', 'mirror-left-right', 'flip-top-bottom', 'reflect-slash', 'reflect-backslash'],
   };
   if (!settings[setting]?.includes(value)) { return; }
    const currentFlow = configuration.get<string>('bitmapFlowDirection', 'auto');
    if (setting === 'wrap-direction' && (currentFlow === 'auto' || value !== 'auto' && (['lr', 'rl'].includes(value) === ['lr', 'rl'].includes(currentFlow)))) { return; }
    const updates: Readonly<Record<string, unknown>> = { output: value, size: Number.parseInt(value, 10), wrap: value === 'none' ? -1 : value === 'glyph' ? -2 : value === 'auto' ? 0 : Number.parseInt(value, 10), compact: value === 'on', mapping: value, flow: value, 'wrap-direction': value, d4: value };
     const keys: Readonly<Record<string, string>> = { output: 'defaultOutput', size: 'bitmapSize', wrap: 'bitmapWrapLimit', compact: 'bitmapCompact', mapping: 'bitmapGlyphMapping', flow: 'bitmapFlowDirection', 'wrap-direction': 'bitmapWrapDirection', d4: 'bitmapD4' };
  const axisChanged = setting === 'flow' && (value === 'auto' || currentFlow === 'auto' || ['lr', 'rl'].includes(value) !== ['lr', 'rl'].includes(currentFlow));
  await Promise.all([configuration.update(keys[setting], updates[setting], effectiveConfigurationTarget(keys[setting])), ...(axisChanged ? [configuration.update('bitmapWrapDirection', 'auto', effectiveConfigurationTarget('bitmapWrapDirection'))] : [])]);
   renderDefaults = configuredRenderDefaults(context);
  sidebar.refreshPrettyPrintSetting(setting as 'output' | 'size' | 'wrap' | 'compact' | 'mapping' | 'flow' | 'wrap-direction' | 'd4');
  if (axisChanged) { sidebar.refreshPrettyPrintSetting('wrap-direction'); }
  }),
  vscode.commands.registerCommand('youhavecode.copyEditorFontFamilyToPrettyPrint', async () => {
   const editorFamilies = vscode.workspace.getConfiguration('editor', vscode.window.activeTextEditor?.document.uri).get<string>('fontFamily', '').trim();
   if (!editorFamilies) {
    await vscode.window.showInformationMessage('The active editor has no font-family list configured.');
    return;
   }
   const configuration = vscode.workspace.getConfiguration('youhavecode');
   const target = effectiveConfigurationTarget('prettyPrintFontFamily');
   await configuration.update('prettyPrintFontFamily', editorFamilies, target);
   await vscode.window.showInformationMessage(`Pretty Print font preference set to ${editorFamilies}.`);
  }),
  vscode.commands.registerCommand('youhavecode.setDeveloperDebugMode', async (enabled: boolean) => {
   developerDebugMode = enabled === true;
   await context.globalState.update(developerDebugModeKey, developerDebugMode);
   await vscode.commands.executeCommand('setContext', 'youhavecode.developerDebugMode', developerDebugMode);
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.selection.isEmpty) {
     const position = editor.selection.active;
     const beforeCursor = editor.document.lineAt(position.line).text.slice(0, position.character);
     const marker = beforeCursor.lastIndexOf('::');
     const suffix = beforeCursor.slice(marker + 2);
     if (marker >= 0 && /^[+-]debug$/u.test(suffix)) {
      await editor.edit(builder => builder.delete(new vscode.Range(position.line, marker + 2, position.line, position.character)));
     }
    }
   sidebar.refresh();
  }),
  vscode.commands.registerCommand('youhavecode.togglePrettyPrintFontFamily', async (item: string | { fontFamily?: string }) => {
   const family = fontFamilyFromItem(item);
   if (!family) { return; }
   const state = fontPreferenceState();
   await setPrettyPrintFontFamilyEnabled(item, !state.active.some(candidate => candidate.toLocaleLowerCase() === family.toLocaleLowerCase()));
  }),
  vscode.commands.registerCommand('youhavecode.resetPrettyPrintFontFamilies', async () => {
   const configuration = vscode.workspace.getConfiguration('youhavecode');
   await Promise.all([
    configuration.update('prettyPrintFontFamily', undefined, effectiveConfigurationTarget('prettyPrintFontFamily')),
    configuration.update('prettyPrintFontFamilyDisabled', undefined, effectiveConfigurationTarget('prettyPrintFontFamilyDisabled')),
   ]);
   sidebar.refresh();
  }),
  vscode.commands.registerCommand('youhavecode.movePrettyPrintFontFamilyTop', async (item: string | { fontFamily?: string }) => {
   await movePrettyPrintFontFamily(item, 'top');
  }),
  vscode.commands.registerCommand('youhavecode.movePrettyPrintFontFamilyUp', async (item: string | { fontFamily?: string }) => {
   await movePrettyPrintFontFamily(item, 'up');
  }),
  vscode.commands.registerCommand('youhavecode.movePrettyPrintFontFamilyDown', async (item: string | { fontFamily?: string }) => {
   await movePrettyPrintFontFamily(item, 'down');
  }),
  vscode.commands.registerCommand('youhavecode.movePrettyPrintFontFamilyBottom', async (item: string | { fontFamily?: string }) => {
   await movePrettyPrintFontFamily(item, 'bottom');
  }),
  vscode.commands.registerCommand('youhavecode.quickSidebarPrettyPrint', async (item: { prettyPrintOutput?: string }) => {
   const format = item.prettyPrintOutput && bitmapOutputFormat(item.prettyPrintOutput);
   if (format) { await vscode.commands.executeCommand('youhavecode.prettyPrintSelectionAs', format); }
  }),
  vscode.commands.registerCommand('youhavecode.prettyPrintWithDefaults', async () => {
   const editor = vscode.window.activeTextEditor;
   if (!editor) { await vscode.window.showWarningMessage('Open a text editor before pretty printing.'); return; }
   if (editor.selections.some(selection => !selection.isEmpty)) { await vscode.commands.executeCommand('youhavecode.chooseInsertionFormat', 'lastBitmap'); return; }
   const text = await vscode.env.clipboard.readText();
   if (!text) { await vscode.window.showInformationMessage('Copy text before pretty printing. Image clipboard content is not available through the VS Code extension API.'); return; }
   const defaults = configuredRenderDefaults(context);
   const format = bitmapOutputFormat(defaults.render) ?? bitmapOutputFormat(lastSelectionOutput) ?? 'braille';
   const layout = resolvedBitmapLayout(defaults);
   const maxExtent = defaults.wrap === 'none' || defaults.wrap === 'glyph' ? undefined : defaults.wrap === 'auto' ? vscode.workspace.getConfiguration('editor', editor.document.uri).get('wordWrapColumn', 80) : Number.parseInt(defaults.wrap, 10);
   try {
    const outputs = await Promise.all(editor.selections.map(async selection => startBitmapOnNewLine(await textToBitmap(text, Number.parseInt(defaults.size, 10), format, {
    compact: defaults.compact === 'on', maxExtent, oneGlyphPerGroup: defaults.wrap === 'glyph', emojiArtRasterizer: rasterizeEmojiArt, ...layout,
    }, bitmapRasterizer(defaults.mapping)), editor.document.lineAt(selection.active.line).text.slice(0, selection.active.character))));
    await editor.edit(builder => editor.selections.forEach((selection, index) => builder.replace(selection, outputs[index])));
   } catch (error) {
    await vscode.window.showErrorMessage(`Could not pretty print clipboard text. ${error instanceof Error ? error.message : String(error)}`);
   }
  }),
  vscode.commands.registerCommand('youhavecode.prettyPrintImage', () => {
    const targetEditor = vscode.window.activeTextEditor;
    if (!targetEditor) { return; }
    const targetSelections = targetEditor.selections.map(selection => ({
     start: selection.start,
     end: selection.end,
    }));
   const panel = vscode.window.createWebviewPanel('youhavecode.prettyPrintImage', 'Pretty Print Image', vscode.ViewColumn.Active, { enableScripts: true });
  panel.webview.html = `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  :root{color-scheme:light dark;--panel:var(--vscode-editorWidget-background,#252526);--border:var(--vscode-input-border,#616161);--muted:var(--vscode-descriptionForeground,#9d9d9d);--accent:var(--vscode-focusBorder,#007fd4);--text:var(--vscode-foreground,#cccccc)}*{box-sizing:border-box}body{margin:0;padding:24px;background:var(--vscode-editor-background,#1e1e1e);color:var(--text);font:13px var(--vscode-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif)}main{max-width:680px;margin:0 auto}.heading{display:flex;align-items:center;gap:12px;margin-bottom:18px}.heading-icon{display:grid;place-items:center;width:36px;height:36px;border-radius:8px;background:var(--vscode-textLink-foreground,#3794ff);color:#fff;font-size:20px}.heading h1{margin:0;font-size:18px;font-weight:600}.heading p{margin:3px 0 0;color:var(--muted)}.drop{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:250px;padding:28px;border:1px dashed var(--border);border-radius:10px;background:color-mix(in srgb,var(--panel) 78%,transparent);text-align:center;cursor:pointer;transition:border-color .15s,background .15s}.drop:hover,.drop.over{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 12%,var(--panel))}.drop-icon{font-size:38px;line-height:1;margin-bottom:14px}.drop strong{font-size:15px}.drop span{margin-top:7px;color:var(--muted)}button{margin-top:18px;padding:7px 14px;border:1px solid var(--border);border-radius:5px;background:var(--vscode-button-background,#0e639c);color:var(--vscode-button-foreground,#fff);font:inherit;cursor:pointer}button:hover{background:var(--vscode-button-hoverBackground,#1177bb)}button:focus-visible,.drop:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.preview{display:none;overflow:hidden;border:1px solid var(--border);border-radius:10px;background:var(--panel)}.preview.ready{display:block}.preview img{display:block;width:100%;max-height:420px;object-fit:contain;background:repeating-conic-gradient(#333 0 25%,#222 0 50%) 50%/16px 16px;padding:12px}.meta{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 14px;border-top:1px solid var(--border);color:var(--muted)}.meta strong{overflow:hidden;color:var(--text);font-weight:500;text-overflow:ellipsis;white-space:nowrap}.status{min-height:20px;margin:14px 2px 0;color:var(--muted)}.status.error{color:var(--vscode-errorForeground,#f48771)}.actions{display:none;justify-content:flex-end;gap:8px}.actions.ready{display:flex}.actions button{margin-top:0}.secondary{background:transparent;color:var(--text)}
  </style></head><body><main><header class="heading"><div class="heading-icon" aria-hidden="true">▧</div><div><h1>Pretty Print Image</h1><p>Choose an image to convert with your current Pretty Print settings.</p></div></header><section id="drop" class="drop" role="button" tabindex="0" aria-label="Drop an image here or browse for an image"><div class="drop-icon" aria-hidden="true">▧</div><strong>Drop an image here</strong><span>or browse for a PNG, JPEG, WebP, or GIF</span><button id="browse" type="button">Browse…</button></section><section id="preview" class="preview" aria-live="polite"><img id="previewImage" alt="Selected image preview"><div class="meta"><strong id="fileName">Selected image</strong><span id="fileSize"></span></div></section><div id="status" class="status" role="status">Nothing selected</div><div id="actions" class="actions"><button id="replace" class="secondary" type="button">Choose another</button><button id="use" type="button">Use image</button></div><input id="file" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden aria-label="Choose an image"></main><script>const vscode=acquireVsCodeApi(),file=document.getElementById('file'),drop=document.getElementById('drop'),browse=document.getElementById('browse'),preview=document.getElementById('preview'),previewImage=document.getElementById('previewImage'),fileName=document.getElementById('fileName'),fileSize=document.getElementById('fileSize'),status=document.getElementById('status'),actions=document.getElementById('actions'),use=document.getElementById('use'),replace=document.getElementById('replace');let selected;const size=n=>n<1024?n+' B':n<1048576?(n/1024).toFixed(1)+' KB':(n/1048576).toFixed(1)+' MB';const choose=()=>file.click();const setStatus=(text,error=false)=>{status.textContent=text;status.className='status'+(error?' error':'')};const load=f=>{if(!f)return;if(!f.type.startsWith('image/')){setStatus('Please choose an image file.',true);return}selected=f;previewImage.src=URL.createObjectURL(f);fileName.textContent=f.name;fileSize.textContent=size(f.size);preview.className='preview ready';actions.className='actions ready';setStatus('Ready to use');};const send=()=>{if(!selected)return;use.disabled=true;replace.disabled=true;setStatus('Processing image…');const reader=new FileReader();reader.onload=()=>vscode.postMessage({image:Array.from(new Uint8Array(reader.result))});reader.onerror=()=>{use.disabled=false;replace.disabled=false;setStatus('Could not read that image.',true)};reader.readAsArrayBuffer(selected)};file.onchange=()=>load(file.files[0]);browse.onclick=e=>{e.stopPropagation();choose()};replace.onclick=()=>{file.value='';choose()};use.onclick=send;drop.onclick=e=>{if(e.target!==browse)choose()};drop.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose()}};['dragenter','dragover'].forEach(type=>drop.addEventListener(type,e=>{e.preventDefault();drop.classList.add('over')}));['dragleave','drop'].forEach(type=>drop.addEventListener(type,e=>{e.preventDefault();drop.classList.remove('over')}));drop.addEventListener('drop',e=>load(e.dataTransfer.files[0]));</script></body></html>`;
   panel.webview.onDidReceiveMessage(async (message: { image?: number[] }) => {
    if (!message.image?.length) { return; }
    try {
     const editor = targetEditor;
     const defaults = configuredRenderDefaults(context);
     const format = bitmapOutputFormat(defaults.render) ?? 'braille';
     const layout = resolvedBitmapLayout(defaults);
     const rows = await rasterizeImage(Uint8Array.from(message.image), Number.parseInt(defaults.size, 10));
    const emojiRows = format === 'emoji' ? await rasterizeImageEmojiArt(Uint8Array.from(message.image), Number.parseInt(defaults.size, 10)) : undefined;
    const output = await textToBitmap('█', Number.parseInt(defaults.size, 10), format, {
     compact: defaults.compact === 'on', maxExtent: undefined, ...layout,
     emojiArtRasterizer: emojiRows ? () => emojiRows : undefined,
    }, () => rows);
    const edit = new vscode.WorkspaceEdit();
    targetSelections.forEach(selection => edit.replace(
     editor.document.uri,
     new vscode.Range(selection.start, selection.end),
     startBitmapOnNewLine(output, editor.document.lineAt(selection.start.line).text.slice(0, selection.start.character)),
    ));
    const inserted = await vscode.workspace.applyEdit(edit);
     if (!inserted) { await vscode.window.showWarningMessage('Could not insert the Pretty Print image into the original editor selection.'); return; }
     panel.dispose();
    } catch (error) {
     await vscode.window.showErrorMessage(`Could not pretty print image. ${error instanceof Error ? error.message : String(error)}`);
    }
   });
  }),
  vscode.commands.registerCommand('youhavecode.removeRecentGlyph', async (item: string | { hex?: string; presentation?: EmojiPresentation }) => {
   const hex = sidebarGlyphHex(item);
   if (!hex) { return; }
   const presentation = typeof item === 'string' ? undefined : item.presentation;
   const variantKey = presentation ? glyphVariantKey(hex, presentation) : undefined;
    await Promise.all([
    context.globalState.update(recentGlyphsKey, context.globalState.get<string[]>(recentGlyphsKey, []).filter(candidate => variantKey ? candidate !== variantKey : parseGlyphVariantKey(candidate).hex !== hex)),
    ...(variantKey ? [] : [context.globalState.update(recentGlyphPresentationsKey, Object.fromEntries(Object.entries(context.globalState.get<Record<string, EmojiPresentation>>(recentGlyphPresentationsKey, {})).filter(([candidate]) => candidate !== hex)))]),
    ]);
   sidebar.refresh();
  }),
  vscode.commands.registerCommand('youhavecode.removeFrequentGlyph', async (item: string | { hex?: string; presentation?: EmojiPresentation }) => {
   const hex = sidebarGlyphHex(item);
   if (!hex) { return; }
   const presentation = typeof item === 'string' ? undefined : item.presentation;
   const variantKey = presentation ? glyphVariantKey(hex, presentation) : undefined;
  const glyphVariants = Object.fromEntries(Object.entries(usageStats.glyphVariants ?? {}).filter(([key]) => variantKey ? key !== variantKey : parseGlyphVariantKey(key).hex !== hex));
  const remaining = Object.entries(glyphVariants).filter(([key]) => parseGlyphVariantKey(key).hex === hex).map(([, record]) => record);
  const glyphs = { ...usageStats.glyphs };
  if (remaining.length) { glyphs[hex] = { count: remaining.reduce((total, record) => total + record.count, 0), lastUsed: Math.max(...remaining.map(record => record.lastUsed)) }; }
  else { delete glyphs[hex]; }
  usageStats = { ...usageStats, glyphs, glyphVariants };
   await context.globalState.update(usageStatsKey, usageStats);
   sidebar.refresh();
  }),
  vscode.commands.registerCommand('youhavecode.sidebarInsertGlyph', (item: string | { hex?: string; presentation?: EmojiPresentation }) => {
   const hex = sidebarGlyphHex(item);
   return hex ? vscode.commands.executeCommand('youhavecode.insertGlyphByHex', hex, typeof item === 'string' ? undefined : item.presentation) : undefined;
  }),
  vscode.commands.registerCommand('youhavecode.copySidebarGlyph', async (item: string | { hex?: string; presentation?: EmojiPresentation }) => {
   const hex = sidebarGlyphHex(item);
   const entry = hex && (await loadEntries()).find(candidate => candidate.hex === hex);
   if (!entry) { return; }
   await vscode.env.clipboard.writeText(presentedCharacter(entry.character, typeof item === 'string' ? undefined : item.presentation));
  }),
  vscode.commands.registerCommand('youhavecode.appendSidebarGlyphToClipboard', async (item: string | { hex?: string; presentation?: EmojiPresentation }) => {
   const hex = sidebarGlyphHex(item);
   const entry = hex && (await loadEntries()).find(candidate => candidate.hex === hex);
   if (!entry) { return; }
   await vscode.env.clipboard.writeText(`${await vscode.env.clipboard.readText()}${presentedCharacter(entry.character, typeof item === 'string' ? undefined : item.presentation)}`);
  }),
  vscode.commands.registerCommand('youhavecode.removeParentTagFromGlyph', async (item: { hex?: string; parentTag?: string }) => {
   if (!item.hex || !item.parentTag) { return; }
   await applyTagEdits(item.hex, [{ operation: 'remove', tag: item.parentTag }]);
   sidebar.refresh();
  }),
  vscode.commands.registerCommand('youhavecode.manageGlyphTags', async (item: string | { hex?: string }) => {
   const hex = sidebarGlyphHex(item);
   const entry = hex && (await loadEntries()).find(candidate => candidate.hex === hex);
   if (!entry) { return; }
   while (true) {
    const assigned = [...(customGlyphTags[hex!] ?? [])].sort();
    const assignedSet = new Set(assigned);
    const ranked = rankCustomTags(customGlyphTags, customTagUsage).filter(tag => !assignedSet.has(tag.tag));
    const selected = await vscode.window.showQuickPick([
     ...assigned.map(tag => ({ label: `$(remove) ${tag}`, description: 'Assigned · Remove', tag, operation: 'remove' as const })),
     ...ranked.map(tag => ({ label: `$(add) ${tag.tag}`, description: `${tag.group === 'recent' ? 'Recent' : 'Frequent'} · Add · ${tag.assignments} assignment${tag.assignments === 1 ? '' : 's'}`, tag: tag.tag, operation: 'add' as const })),
     { label: '$(new-file) New Tag…', description: 'Create and assign', operation: 'create' as const },
    ], { title: `Manage Tags · ${entry.character} U+${entry.hex}`, placeHolder: 'Add or remove tags; press Escape when finished', matchOnDescription: true });
    if (!selected) { return; }
    if (selected.operation === 'create') {
     const tag = await vscode.window.showInputBox({
      title: `New Tag · ${entry.character} U+${entry.hex}`, prompt: 'Create and assign a tag',
      validateInput: value => /^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u.test(value.trim()) ? undefined : 'Use letters, numbers, underscores, or hyphens.',
     });
     if (tag) { await applyTagEdits(hex!, [{ operation: 'add', tag: tag.trim().toLowerCase() }]); sidebar.refresh(); }
    } else {
     await applyTagEdits(hex!, [{ operation: selected.operation, tag: selected.tag! }]);
     sidebar.refresh();
    }
   }
  }),
  vscode.commands.registerCommand('youhavecode.setGlyphDefaultFilter', async (item: string | { hex?: string }) => {
   const hex = sidebarGlyphHex(item);
   const entry = hex && (await loadEntries()).find(candidate => candidate.hex === hex);
   if (!entry) { return; }
   const stopWords = new Set(['A', 'AN', 'AND', 'OF', 'THE', 'WITH']);
   const words = [...new Set(entry.name.split(/[^\p{L}\p{N}]+/u).filter(word => word.length > 1 && !stopWords.has(word)))];
   const selected = await vscode.window.showQuickPick([
    ...filterKeys.map(key => ({ label: `(${key}=${propertyValue(entry, key)})`, description: 'Replace this property default', key, value: propertyValue(entry, key) })),
    ...words.map(term => ({ label: `(${term.toLowerCase()})`, description: 'Add name-word default', term })),
    ...(customGlyphTags[entry.hex] ?? []).map(term => ({ label: `(${term})`, description: 'Add custom-tag default', term })),
   ], { title: `Set Default Filter · ${entry.character} U+${entry.hex}`, placeHolder: 'Properties replace; words and tags accumulate' });
   if (!selected) { return; }
   if ('key' in selected) { await vscode.commands.executeCommand('youhavecode.setDefaultFilter', selected.key, selected.value); }
   else { await vscode.commands.executeCommand('youhavecode.addDefaultSearchTerm', selected.term); }
  }),
  vscode.commands.registerCommand('youhavecode.chooseDelegateProfile', async () => {
   const configuration = vscode.workspace.getConfiguration('youhavecode');
   const configured = configuration.get<Record<string, DelegateProfileConfig>>('delegateProfiles', {});
   const current = configuration.get('delegateProfile', 'restricted');
   const names = [...Object.keys(builtInDelegateProfiles), ...Object.keys(configured).filter(name => !(name in builtInDelegateProfiles))];
   const selected = await vscode.window.showQuickPick(names.map(name => {
    const profile = resolveDelegateProfile(name, configured);
    return {
     label: name,
     description: `${profile.capabilities.size} capabilities${profile.trusted ? ' · trusted full access' : ' · isolated policy'}`,
     detail: name === current ? 'Currently selected' : `Extends ${profile.preset}`,
     name, profile,
    };
   }), { title: 'Delegate Profile', placeHolder: 'Choose the capability profile used by custom delegates', matchOnDescription: true });
   if (!selected) { return; }
   if (selected.profile.trusted) {
    const confirmed = await vscode.window.showWarningMessage(
     `${selected.name} grants trusted extension-host access. Delegate code can access files, the network, processes, commands, and VS Code APIs.`,
     { modal: true }, 'Use Trusted Profile',
    );
    if (confirmed !== 'Use Trusted Profile') { return; }
   }
   await configuration.update('delegateProfile', selected.name, vscode.ConfigurationTarget.Global);
   await vscode.window.setStatusBarMessage(`Delegate profile: ${selected.name}`, 2500);
  }),
  vscode.commands.registerCommand('youhavecode.recordUsage', recordUsage),
  vscode.commands.registerCommand('youhavecode.insertBestGlyph', insertBestGlyph),
  vscode.commands.registerCommand('youhavecode.acceptSelectedSuggestion', () => vscode.commands.executeCommand('acceptSelectedSuggestion')),
  vscode.commands.registerCommand('youhavecode.selectPrevSuggestion', () => navigateSuggestion('selectPrevSuggestion')),
  vscode.commands.registerCommand('youhavecode.selectNextSuggestion', () => navigateSuggestion('selectNextSuggestion')),
  vscode.commands.registerCommand('youhavecode.continueFiltering', continueFiltering),
  vscode.commands.registerCommand('youhavecode.setInlineOutputFormat', async (output: string) => {
   await vscode.commands.executeCommand('youhavecode.setSidebarOutputFormat', output);
   await continueFiltering();
  }),
  vscode.commands.registerCommand('youhavecode.assignTagToPreviousGlyph', assignTagToPreviousGlyph),
  vscode.commands.registerCommand('youhavecode.consumeReplayToken', consumeReplayToken),
  vscode.commands.registerCommand('youhavecode.undoQueryComponent', undoQueryComponent),
  vscode.commands.registerCommand('youhavecode.commitGlyph', commitGlyph),
  vscode.commands.registerCommand('youhavecode.resetUsageHistory', async () => {
    const confirmed = await vscode.window.showWarningMessage('Clear recent glyphs, usage frequencies, and replay history?', { modal: true }, 'Reset Usage History');
    if (confirmed !== 'Reset Usage History') { return; }
   usageStats = resetUsageStats();
   replayTokens = [];
   await Promise.all([
    context.globalState.update(usageStatsKey, usageStats),
    context.globalState.update(recentGlyphsKey, []),
    context.globalState.update(recentGlyphPresentationsKey, {}),
    context.globalState.update(recentQueryTokensKey, []),
   ]);
    sidebar.refresh();
  await vscode.window.showInformationMessage('YouHaveCode usage history cleared.');
  }),
  vscode.commands.registerCommand('youhavecode.insertRecentGlyph', async () => {
   const editor = vscode.window.activeTextEditor;
   const query = activeQuery();
   if (!editor || !query) { return; }
   const position = editor.selection.active;
   inlineMenuAnchor = { kind: 'recent', document: editor.document, version: editor.document.version, line: position.line, character: position.character, expressionStart: query.expressionStart };
   await continueFiltering();
  }),
  vscode.commands.registerCommand('youhavecode.insertFrequentGlyph', async () => {
   const editor = vscode.window.activeTextEditor;
   const query = activeQuery();
   if (!editor || !query) { return; }
   const position = editor.selection.active;
    inlineMenuAnchor = { kind: 'frequent', document: editor.document, version: editor.document.version, line: position.line, character: position.character, expressionStart: query.expressionStart };
    await continueFiltering();
  }),
  vscode.commands.registerCommand('youhavecode.propertyFilters', async () => {
   const editor = vscode.window.activeTextEditor;
   const query = activeQuery();
   if (!editor || !query) { return; }
    const position = editor.selection.active;
    inlineMenuAnchor = { kind: 'properties', document: editor.document, version: editor.document.version, line: position.line, character: position.character, expressionStart: query.expressionStart };
    await continueFiltering();
  }),
  vscode.commands.registerCommand('youhavecode.prettyPrintSettings', async () => {
   const editor = vscode.window.activeTextEditor;
   const query = activeQuery();
   if (!editor || !query) { return; }
   const position = editor.selection.active;
   inlineMenuAnchor = { kind: 'quickSettings', document: editor.document, version: editor.document.version, line: position.line, character: position.character, expressionStart: query.expressionStart };
   await continueFiltering();
  }),
  vscode.commands.registerCommand('youhavecode.customTags', async () => {
   const editor = vscode.window.activeTextEditor;
   const query = activeQuery();
   if (!editor || !query) { return; }
   const position = editor.selection.active;
   inlineMenuAnchor = { kind: 'customTags', document: editor.document, version: editor.document.version, line: position.line, character: position.character, expressionStart: query.expressionStart };
   await continueFiltering();
  }),
  vscode.commands.registerCommand('youhavecode.outputFormats', async () => {
   const editor = vscode.window.activeTextEditor;
   const query = activeQuery();
   if (!editor || !query) { return; }
   const position = editor.selection.active;
   inlineMenuAnchor = { kind: 'outputFormats', document: editor.document, version: editor.document.version, line: position.line, character: position.character, expressionStart: query.expressionStart };
   await continueFiltering();
  }),
  vscode.commands.registerCommand('youhavecode.defaultFilters', async () => {
   const editor = vscode.window.activeTextEditor;
   const query = activeQuery();
   if (!editor || !query) { return; }
   const position = editor.selection.active;
   inlineMenuAnchor = { kind: 'defaultFilters', document: editor.document, version: editor.document.version, line: position.line, character: position.character, expressionStart: query.expressionStart };
   await continueFiltering();
  }),
  vscode.commands.registerCommand('youhavecode.defaultFilterValues', async (filterKey: FilterKey) => {
   const editor = vscode.window.activeTextEditor;
   const query = activeQuery();
   if (!editor || !query || !filterKeys.includes(filterKey)) { return; }
   const position = editor.selection.active;
   inlineMenuAnchor = { kind: 'defaultFilterValues', filterKey, document: editor.document, version: editor.document.version, line: position.line, character: position.character, expressionStart: query.expressionStart };
   await continueFiltering();
  }),
  vscode.commands.registerCommand('youhavecode.setDefaultFilter', async (filterKey: FilterKey, value: string) => {
   const configuration = vscode.workspace.getConfiguration('youhavecode');
    await Promise.all([
     configuration.update('defaultFilters', { ...configuredDefaultFilters(), [filterKey]: value }, vscode.ConfigurationTarget.Global),
     updateDisabledDefaultItems(configuredDisabledDefaultItems().filter(id => id !== defaultPropertyId(filterKey))),
    ]);
  sidebar.refresh();
  if (activeQuery()) { await vscode.commands.executeCommand('youhavecode.defaultFilters'); }
  }),
  vscode.commands.registerCommand('youhavecode.removeDefaultFilter', async (filterKey: FilterKey) => {
   const configuration = vscode.workspace.getConfiguration('youhavecode');
    const updated = { ...configuredDefaultFilters() };
   delete updated[filterKey];
    await Promise.all([
     configuration.update('defaultFilters', Object.keys(updated).length ? updated : undefined, vscode.ConfigurationTarget.Global),
     updateDisabledDefaultItems(configuredDisabledDefaultItems().filter(id => id !== defaultPropertyId(filterKey))),
    ]);
   sidebar.refresh();
   if (activeQuery()) { await vscode.commands.executeCommand('youhavecode.defaultFilters'); }
  }),
  vscode.commands.registerCommand('youhavecode.addDefaultSearchTerm', async (term: string) => {
   const normalized = term.trim().toUpperCase();
   if (!normalized) { return; }
  const configuration = vscode.workspace.getConfiguration('youhavecode');
  await Promise.all([
   configuration.update('defaultSearchTerms', [...new Set([...configuredDefaultTerms(), normalized])], vscode.ConfigurationTarget.Global),
   updateDisabledDefaultItems(configuredDisabledDefaultItems().filter(id => id !== defaultTermId(normalized))),
  ]);
   sidebar.refresh();
  }),
  vscode.commands.registerCommand('youhavecode.removeDefaultSearchTerm', async (term: string) => {
   const updated = configuredDefaultTerms().filter(candidate => candidate !== term);
  const configuration = vscode.workspace.getConfiguration('youhavecode');
  await Promise.all([
   configuration.update('defaultSearchTerms', updated.length ? updated : undefined, vscode.ConfigurationTarget.Global),
   updateDisabledDefaultItems(configuredDisabledDefaultItems().filter(id => id !== defaultTermId(term))),
  ]);
   sidebar.refresh();
  }),
  vscode.commands.registerCommand('youhavecode.toggleSidebarDefaultItem', async (item: { defaultKind?: 'property' | 'term'; defaultKey?: string }) => {
  if (!item.defaultKind || !item.defaultKey) { return; }
  const id = item.defaultKind === 'property' ? `property:${item.defaultKey}` : defaultTermId(item.defaultKey);
  const disabled = configuredDisabledDefaultItems();
  await updateDisabledDefaultItems(disabled.includes(id) ? disabled.filter(candidate => candidate !== id) : [...disabled, id]);
  sidebar.refresh();
  }),
  vscode.commands.registerCommand('youhavecode.setSidebarPrettyPrintCustomSize', async () => {
   const current = Number.parseInt(configuredRenderDefaults(context).size, 10);
   const value = await vscode.window.showInputBox({ title: 'Custom Pretty Print Size', prompt: 'Square raster size in pixels (8-128)', value: String(current), validateInput: candidate => /^(?:[89]|[1-9][0-9]|1[01][0-9]|12[0-8])$/.test(candidate) ? undefined : 'Enter a whole number from 8 through 128.' });
   if (value) { await vscode.commands.executeCommand('youhavecode.setSidebarPrettyPrintSetting', 'size', `${value}x${value}`); }
  }),
  vscode.commands.registerCommand('youhavecode.clearSidebarDefaultItem', async (item: { defaultKind?: 'property' | 'term'; defaultKey?: string }) => {
  if (!item.defaultKind || !item.defaultKey) { return; }
  await vscode.commands.executeCommand(item.defaultKind === 'property' ? 'youhavecode.removeDefaultFilter' : 'youhavecode.removeDefaultSearchTerm', item.defaultKey);
  }),
  vscode.commands.registerCommand('youhavecode.sidebarAddDefaultTerm', async () => {
   const term = await vscode.window.showInputBox({ title: 'Add Default Search Term', prompt: 'Enter a Unicode name word or custom tag', validateInput: value => /^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u.test(value.trim()) ? undefined : 'Use letters, numbers, underscores, or hyphens.' });
   if (term) { await vscode.commands.executeCommand('youhavecode.addDefaultSearchTerm', term); }
  }),
  vscode.commands.registerCommand('youhavecode.sidebarAddDefaultFilter', async () => {
    const key = await vscode.window.showQuickPick(propertyFilters.map(({ key: value, label, description }) => ({ label, description, value })), { title: 'Add Default Property Filter' });
   if (!key) { return; }
    const [entries, aliases] = await Promise.all([loadEntries(), getAliases()]);
    const value = await vscode.window.showQuickPick(filterValues(entries, key.value, '').map(candidate => ({
     label: candidate, description: propertyValueDescription(aliases, key.value, candidate), value: candidate,
    })), { title: `Default ${key.label}` });
   if (value) { await vscode.commands.executeCommand('youhavecode.setDefaultFilter', key.value, value.value); }
  }),
  vscode.commands.registerCommand('youhavecode.clearDefaultFilters', async () => {
   const configuration = vscode.workspace.getConfiguration('youhavecode');
  await Promise.all([
   configuration.update('defaultFilters', undefined, vscode.ConfigurationTarget.Global),
   configuration.update('defaultSearchTerms', undefined, vscode.ConfigurationTarget.Global),
   configuration.update('disabledDefaultItems', undefined, vscode.ConfigurationTarget.Global),
  ]);
   sidebar.refresh();
   if (activeQuery()) { await vscode.commands.executeCommand('youhavecode.defaultFilters'); }
  }),
  vscode.commands.registerCommand('youhavecode.compatibility', async () => {
   const editor = vscode.window.activeTextEditor;
   const query = activeQuery();
   if (!editor || !query) { return; }
   const position = editor.selection.active;
   inlineMenuAnchor = { kind: 'compatibility', document: editor.document, version: editor.document.version, line: position.line, character: position.character, expressionStart: query.expressionStart };
   await continueFiltering();
  }),
  vscode.commands.registerCommand('youhavecode.compatibilityTarget', async (target: CompatibilityTarget) => {
   const editor = vscode.window.activeTextEditor;
   const query = activeQuery();
   if (!editor || !query || !compatibilityTargets.some(candidate => candidate.key === target)) { return; }
   const position = editor.selection.active;
   inlineMenuAnchor = { kind: 'compatibilityTarget', compatibilityTarget: target, document: editor.document, version: editor.document.version, line: position.line, character: position.character, expressionStart: query.expressionStart };
   await continueFiltering();
  }),
  vscode.commands.registerCommand('youhavecode.compatibilityFallback', async (fallback: 'unknown' | 'localFont') => {
   const editor = vscode.window.activeTextEditor;
   const query = activeQuery();
   if (!editor || !query || !['unknown', 'localFont'].includes(fallback)) { return; }
   const position = editor.selection.active;
   inlineMenuAnchor = { kind: 'compatibilityFallback', compatibilityFallback: fallback, document: editor.document, version: editor.document.version, line: position.line, character: position.character, expressionStart: query.expressionStart };
   await continueFiltering();
  }),
  vscode.commands.registerCommand('youhavecode.setCompatibilityTargetPolicy', async (target: CompatibilityTarget, policy: CompatibilityPolicy) => {
   const configured = configuredCompatibilityTargets();
   await vscode.workspace.getConfiguration('youhavecode').update('compatibilityTargets', { ...configured, [target]: { ...configured[target], policy } }, vscode.ConfigurationTarget.Global);
  sidebar.refresh();
  if (activeQuery()) { await vscode.commands.executeCommand('youhavecode.compatibility'); }
  }),
  vscode.commands.registerCommand('youhavecode.setCompatibilityTargetVersion', async (target: CompatibilityTarget, version: string) => {
   const configured = configuredCompatibilityTargets();
   await vscode.workspace.getConfiguration('youhavecode').update('compatibilityTargets', { ...configured, [target]: { ...configured[target], version } }, vscode.ConfigurationTarget.Global);
  sidebar.refresh();
  if (activeQuery()) { await vscode.commands.executeCommand('youhavecode.compatibility'); }
  }),
  vscode.commands.registerCommand('youhavecode.pinCompatibilityTargetVersion', async (target: CompatibilityTarget) => {
   const version = await vscode.window.showInputBox({ title: `Pin ${compatibilityTargets.find(candidate => candidate.key === target)?.label ?? target} Version`, prompt: 'Enter a platform version such as 18, 15, or 24.04', validateInput: value => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value.trim()) ? undefined : 'Use letters, numbers, dots, underscores, or hyphens.' });
   if (version) { await vscode.commands.executeCommand('youhavecode.setCompatibilityTargetVersion', target, version.trim()); }
  }),
  vscode.commands.registerCommand('youhavecode.setCompatibilityFallbackPolicy', async (fallback: 'unknown' | 'localFont', policy: CompatibilityFallbackPolicy) => {
   const key = fallback === 'unknown' ? 'compatibilityUnknownPolicy' : 'compatibilityLocalFontPolicy';
   await vscode.workspace.getConfiguration('youhavecode').update(key, policy, vscode.ConfigurationTarget.Global);
  sidebar.refresh();
  if (activeQuery()) { await vscode.commands.executeCommand('youhavecode.compatibility'); }
  }),
  vscode.commands.registerCommand('youhavecode.resetCompatibility', async () => {
   const configuration = vscode.workspace.getConfiguration('youhavecode');
   await Promise.all([
    configuration.update('compatibilityTargets', undefined, vscode.ConfigurationTarget.Global),
    configuration.update('compatibilityUnknownPolicy', undefined, vscode.ConfigurationTarget.Global),
    configuration.update('compatibilityLocalFontPolicy', undefined, vscode.ConfigurationTarget.Global),
   ]);
  sidebar.refresh();
  if (activeQuery()) { await vscode.commands.executeCommand('youhavecode.compatibility'); }
  }),
  vscode.commands.registerCommand('youhavecode.customTagActions', async (tag: string) => {
   const editor = vscode.window.activeTextEditor;
   const query = activeQuery();
   if (!editor || !query) { return; }
   const position = editor.selection.active;
   inlineMenuAnchor = { kind: 'customTagActions', tag, document: editor.document, version: editor.document.version, line: position.line, character: position.character, expressionStart: query.expressionStart };
   await continueFiltering();
  }),
  vscode.commands.registerCommand('youhavecode.createCustomTag', async () => {
   const editor = vscode.window.activeTextEditor;
   if (!editor || !activeQuery()) { return; }
   const selectedTag = await vscode.window.showInputBox({
     title: 'Add Custom Tag', prompt: 'Enter a keyword for the glyph you select next',
     validateInput: value => /^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u.test(value.trim()) ? undefined : 'Use letters, numbers, underscores, or hyphens.',
   });
   if (!selectedTag) { return; }
   const position = editor.selection.active;
    const normalizedTag = selectedTag.trim().toLowerCase();
    const inserted = await editor.edit(builder => builder.insert(position, `(+=${normalizedTag})`));
   if (inserted) { await continueFiltering(); }
  }),
 );
 const updateQueryContext = () => vscode.commands.executeCommand('setContext', 'youhavecode.queryActive', activeQuery() !== undefined);
 const deleteAndSuggest = (editor: vscode.TextEditor, builder: vscode.TextEditorEdit, direction: 'left' | 'right') => {
  void vscode.commands.executeCommand('setContext', 'youhavecode.suggestionNavigated', false);
  editor.selections.forEach(selection => {
   const range = deletionRange(editor.document, selection, direction);
   if (range) { builder.delete(range); }
  });
  if (suggestTimer) { clearTimeout(suggestTimer); }
  suggestTimer = setTimeout(() => {
   suggestTimer = undefined;
   const query = activeQuery();
   void vscode.commands.executeCommand('setContext', 'youhavecode.queryActive', query !== undefined);
   if (query) {
    void vscode.commands.executeCommand('hideSuggestWidget')
     .then(() => vscode.commands.executeCommand('editor.action.triggerSuggest'));
   }
  }, 0);
 };

 context.subscriptions.push(
  vscode.commands.registerTextEditorCommand('youhavecode.deleteLeftAndSuggest', (editor, builder) => deleteAndSuggest(editor, builder, 'left')),
  vscode.commands.registerTextEditorCommand('youhavecode.deleteRightAndSuggest', (editor, builder) => deleteAndSuggest(editor, builder, 'right')),
  vscode.window.onDidChangeTextEditorSelection(event => {
   void updateQueryContext();
   if (boundedQueryAt(event.textEditor.document, event.selections[0].active)) {
    void vscode.commands.executeCommand('editor.action.triggerSuggest');
   }
  }),
  vscode.window.onDidChangeActiveTextEditor(() => { void updateQueryContext(); }),
  { dispose: () => {
   if (suggestTimer) { clearTimeout(suggestTimer); }
   if (typingSuggestTimer) { clearTimeout(typingSuggestTimer); }
  } },
 );
 void updateQueryContext();

 const completionSchemes = ['file', 'untitled', 'vscode-notebook-cell'];
 const completionSelector: vscode.DocumentSelector = (await vscode.languages.getLanguages())
  .flatMap(language => completionSchemes.map(scheme => ({ language, scheme })))
  .concat({ language: '*', scheme: '*' });
 context.subscriptions.push(vscode.languages.registerCompletionItemProvider(completionSelector, {
  async provideCompletionItems(document, position) {
  const linePrefix = document.lineAt(position).text.slice(0, position.character);
    const boundedQuery = boundedQueryAt(document, position);
  const anchor = continuationAnchor;
  const continuationText = anchor?.document === document && anchor.version === document.version && anchor.line === position.line
   && position.character >= anchor.character ? linePrefix.slice(anchor.character) : undefined;
  const continuation = !boundedQuery && continuationText !== undefined && !continuationText.startsWith('::');
  const parsedQuery = continuation ? undefined : boundedQuery ?? parseUnicodeQuery(linePrefix, triggerPrefixes());
  const virtualContinuation = continuation ? parseUnicodeQuery(`::${continuationText}`, ['::']) : undefined;
  const continuationQuery = virtualContinuation && anchor ? {
   ...virtualContinuation,
   expressionStart: anchor.character,
   draftStart: anchor.character + virtualContinuation.draftStart - 2,
  } : undefined;
  const baseQuery = parsedQuery ?? continuationQuery;
   if (!baseQuery) { return undefined; }
  const continuationSession = continuation || !!anchor && anchor.document === document && anchor.version === document.version
   && anchor.line === position.line && parsedQuery?.prefix === '::' && parsedQuery.expressionStart === anchor.character;
  const boundedSession = !!boundedQuery || !!anchor?.bounded && continuationSession;
  const query = withDefaultFilters(baseQuery, enabledDefaultFilters(), enabledDefaultTerms());
  if (parsedQuery && !continuationSession) { continuationAnchor = undefined; }
  if (query.prefix === ':::') { repeatingQuery = { document, line: position.line }; }
  completionAnchor = { document, line: position.line, character: query.expressionStart, prefix: query.prefix };
  await vscode.commands.executeCommand('setContext', 'youhavecode.queryActive', true);

    const [entries, words, aliases, compatibilityProfiles] = await Promise.all([loadEntries(), loadWords(), getAliases(), loadCompatibilityProfiles()]);
   const draftRange = new vscode.Range(position.line, query.draftStart, position.line, position.character);
    const completionRange = { inserting: draftRange, replacing: draftRange };
    const inlineMenu = inlineMenuAnchor?.document === document && inlineMenuAnchor.version === document.version
     && inlineMenuAnchor.line === position.line && inlineMenuAnchor.character === position.character
     && inlineMenuAnchor.expressionStart === query.expressionStart ? inlineMenuAnchor.kind : undefined;
    if (inlineMenu === 'compatibility') {
     const targets = configuredCompatibilityTargets();
     const items = compatibilityTargets.map(({ key, label }, index) => {
      const target = targets[key];
      const item = new vscode.CompletionItem({ label: `${label}…`, description: `${target.version} · ${target.policy}` }, vscode.CompletionItemKind.Folder);
      item.detail = 'Configure the platform version and support policy';
      item.insertText = ''; item.range = completionRange; item.sortText = `!0${index}`;
      item.command = { command: 'youhavecode.compatibilityTarget', title: `Configure ${label}`, arguments: [key] };
      return item;
     });
     const fallbackItems = ([
      { key: 'unknown' as const, label: 'Unknown Evidence…', policy: configuredCompatibilityFallback('compatibilityUnknownPolicy'), detail: 'Behavior when bundled data has no reliable verdict' },
      { key: 'localFont' as const, label: 'Local Font…', policy: configuredCompatibilityFallback('compatibilityLocalFontPolicy'), detail: 'Behavior when no installed local font can render a glyph' },
     ]).map((fallback, index) => {
      const item = new vscode.CompletionItem({ label: fallback.label, description: fallback.policy }, vscode.CompletionItemKind.Folder);
      item.detail = fallback.detail; item.insertText = ''; item.range = completionRange; item.sortText = `!1${index}`;
      item.command = { command: 'youhavecode.compatibilityFallback', title: `Configure ${fallback.label}`, arguments: [fallback.key] };
      return item;
     });
     const reset = new vscode.CompletionItem('Reset Compatibility Defaults', vscode.CompletionItemKind.Event);
     reset.detail = 'Restore every known target to current + warn'; reset.insertText = ''; reset.range = completionRange; reset.sortText = '!299';
     reset.command = { command: 'youhavecode.resetCompatibility', title: 'Reset compatibility defaults' };
     return new vscode.CompletionList([...items, ...fallbackItems, reset], true);
    }
    if (inlineMenu === 'compatibilityTarget' && inlineMenuAnchor?.compatibilityTarget) {
     const target = inlineMenuAnchor.compatibilityTarget;
     const configured = configuredCompatibilityTargets()[target];
     const policies: readonly CompatibilityPolicy[] = ['required', 'warn', 'permitted', 'blocked'];
     const policyItems = policies.map((policy, index) => {
      const item = new vscode.CompletionItem({ label: `Policy: ${policy}`, description: policy === configured.policy ? 'current' : '' }, vscode.CompletionItemKind.EnumMember);
      item.detail = { required: 'Unlist known unsupported glyphs', warn: 'List with a compatibility warning', permitted: 'List without warnings or filtering', blocked: 'Exclude glyphs supported only for this target' }[policy];
      item.insertText = ''; item.range = completionRange; item.sortText = `!0${index}`;
      item.command = { command: 'youhavecode.setCompatibilityTargetPolicy', title: `Use ${policy}`, arguments: [target, policy] };
      return item;
     });
     const versions = ['current', 'any'].map((version, index) => {
      const item = new vscode.CompletionItem({ label: `Version: ${version}`, description: version === configured.version ? 'current' : '' }, vscode.CompletionItemKind.EnumMember);
      item.detail = version === 'current' ? 'Use the latest bundled platform profile' : 'Accept support from any bundled version';
      item.insertText = ''; item.range = completionRange; item.sortText = `!1${index}`;
      item.command = { command: 'youhavecode.setCompatibilityTargetVersion', title: `Use ${version}`, arguments: [target, version] };
      return item;
     });
     const pinned = new vscode.CompletionItem({ label: 'Version: Pin…', description: !['current', 'any'].includes(configured.version) ? configured.version : '' }, vscode.CompletionItemKind.Value);
     pinned.detail = 'Enter a specific reproducible platform version'; pinned.insertText = ''; pinned.range = completionRange; pinned.sortText = '!12';
     pinned.command = { command: 'youhavecode.pinCompatibilityTargetVersion', title: 'Pin platform version', arguments: [target] };
     return new vscode.CompletionList([...policyItems, ...versions, pinned], true);
    }
    if (inlineMenu === 'compatibilityFallback' && inlineMenuAnchor?.compatibilityFallback) {
     const fallback = inlineMenuAnchor.compatibilityFallback;
     const key = fallback === 'unknown' ? 'compatibilityUnknownPolicy' : 'compatibilityLocalFontPolicy';
     const current = configuredCompatibilityFallback(key);
     return new vscode.CompletionList((['warn', 'permitted', 'unlist'] as const).map((policy, index) => {
      const item = new vscode.CompletionItem({ label: policy, description: policy === current ? 'current' : '' }, vscode.CompletionItemKind.EnumMember);
      item.detail = policy === 'warn' ? 'Keep the glyph and show a warning' : policy === 'permitted' ? 'Keep the glyph without a warning' : 'Remove the glyph from results';
      item.insertText = ''; item.range = completionRange; item.sortText = `!0${index}`;
      item.command = { command: 'youhavecode.setCompatibilityFallbackPolicy', title: `Use ${policy}`, arguments: [fallback, policy] };
      return item;
     }), true);
    }
    if (inlineMenu === 'defaultFilters') {
     const configured = configuredDefaultFilters();
     const propertyItems = propertyFilters.map((filter, index) => {
      const current = configured[filter.key];
      const item = new vscode.CompletionItem({ label: `${current ? 'Change' : 'Add'} ${filter.label}…`, description: current ? `(${filter.key}=${current})` : 'Not set' }, vscode.CompletionItemKind.Property);
      item.detail = filter.description;
      item.insertText = '';
      item.range = completionRange;
      item.sortText = `!0${String(index).padStart(2, '0')}`;
      item.command = { command: 'youhavecode.defaultFilterValues', title: `Choose default ${filter.key}`, arguments: [filter.key] };
      return item;
     });
     const removeItems = propertyFilters.filter(filter => configured[filter.key]).map((filter, index) => {
      const item = new vscode.CompletionItem({ label: `Remove ${filter.label}`, description: `(${filter.key}=${configured[filter.key]})` }, vscode.CompletionItemKind.Event);
      item.detail = `Stop applying the ${filter.key} default`;
      item.insertText = '';
      item.range = completionRange;
      item.sortText = `!1${String(index).padStart(2, '0')}`;
      item.command = { command: 'youhavecode.removeDefaultFilter', title: `Remove default ${filter.key}`, arguments: [filter.key] };
      return item;
     });
     const clearItem = new vscode.CompletionItem('Clear All Default Filters', vscode.CompletionItemKind.Event);
     clearItem.detail = 'Remove every persistent default filter';
     clearItem.insertText = '';
     clearItem.range = completionRange;
     clearItem.sortText = '!299';
     clearItem.command = { command: 'youhavecode.clearDefaultFilters', title: 'Clear all default filters' };
     return new vscode.CompletionList([...propertyItems, ...removeItems, clearItem], true);
    }
    if (inlineMenu === 'defaultFilterValues' && inlineMenuAnchor?.filterKey) {
     const filterKey = inlineMenuAnchor.filterKey;
     const values = orderFilterValues(filterValues(entries, filterKey, ''), recentFilterValues(usageStats, filterKey));
     const counts = countFilterValues(entries, query, filterKey, values, customGlyphTags);
     return new vscode.CompletionList(values.map((value, index) => {
      const description = propertyValueDescription(aliases, filterKey, value);
      const item = new vscode.CompletionItem({ label: `(${filterKey}=${value})`, description: `${description ? `${description} · ` : ''}${(counts.get(value) ?? 0).toLocaleString()} glyphs` }, vscode.CompletionItemKind.EnumMember);
      item.detail = `Use ${value} as the default ${filterKey} filter`;
      item.insertText = '';
      item.range = completionRange;
      item.sortText = `!0${String(index).padStart(4, '0')}`;
      item.command = { command: 'youhavecode.setDefaultFilter', title: `Set default ${filterKey}`, arguments: [filterKey, value] };
      return item;
     }), true);
    }
    if (inlineMenu === 'properties') {
     const applied = new Set(query.filters.map(filter => filter.key));
     const propertyItems = propertyFilters.filter(filter => !applied.has(filter.key)).map((filter, index) => {
      const item = new vscode.CompletionItem({ label: `(${filter.key}=…)`, description: filter.label }, vscode.CompletionItemKind.Property);
      item.detail = filter.description;
      item.insertText = `(${filter.key}=`;
      item.range = completionRange;
      item.sortText = `!0${String(index).padStart(2, '0')}`;
      item.command = { command: 'youhavecode.continueFiltering', title: `Choose ${filter.key}` };
      return item;
     });
      const prettyPrint = new vscode.CompletionItem('Pretty Print Settings…', vscode.CompletionItemKind.Folder);
      prettyPrint.detail = `Output ${effectiveQueryOption(query, 'render', renderDefaults)} · Size ${effectiveQueryOption(query, 'size', renderDefaults)} · Wrap ${effectiveQueryOption(query, 'wrap', renderDefaults)}`;
      prettyPrint.insertText = '';
      prettyPrint.range = completionRange;
      prettyPrint.sortText = '!099';
      prettyPrint.command = { command: 'youhavecode.prettyPrintSettings', title: 'Open pretty print settings' };
      return new vscode.CompletionList([...propertyItems, prettyPrint], true);
    }
    if (inlineMenu === 'quickSettings') {
     const quickSettingItems = suggestedOptionKeys.map((key, index) => {
      const tokenKey = key === 'd4' ? '*d4' : key;
      const item = new vscode.CompletionItem({ label: `(${tokenKey}=…)`, description: effectiveQueryOption(query, key === 'output' ? 'render' : key, renderDefaults) }, vscode.CompletionItemKind.Property);
      item.detail = `Change ${key} for this query`;
      item.insertText = `(${tokenKey}=`;
      item.range = completionRange;
      item.sortText = `!0${String(index).padStart(2, '0')}`;
      item.command = { command: 'youhavecode.continueFiltering', title: `Choose ${key}` };
      return item;
     });
     const resetItem = new vscode.CompletionItem('Reset Usage History', vscode.CompletionItemKind.Event);
     resetItem.detail = 'Clear recent glyphs, frequencies, and token history';
     resetItem.insertText = '';
     resetItem.range = completionRange;
     resetItem.sortText = '!099';
     resetItem.command = { command: 'youhavecode.resetUsageHistory', title: 'Reset usage history' };
     return new vscode.CompletionList([...quickSettingItems, resetItem], true);
    }
    if (inlineMenu === 'customTags') {
    const leading = document.lineAt(position.line).text.slice(0, query.expressionStart);
    const preceding = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(leading)].at(-1)?.segment;
    const assignPrevious = !query.words.length && !query.filters.length && !query.options.length && !query.actions.length && !query.tagEdits.length
     && !!preceding && entries.some(entry => entry.character === preceding);
    const createItem = new vscode.CompletionItem('Create New Tag', vscode.CompletionItemKind.Event);
     createItem.detail = assignPrevious ? `Create and add a custom tag to ${preceding}` : 'Create and add a custom tag to the glyph selected next';
     createItem.insertText = '';
     createItem.range = completionRange;
    const rankedTags = rankCustomTags(customGlyphTags, customTagUsage);
    createItem.sortText = `!0${String(rankedTags.filter(tag => tag.group === 'recent').length + 1).padStart(3, '0')}`;
     createItem.command = { command: 'youhavecode.createCustomTag', title: 'Create custom tag' };
    const tagItems = rankedTags.map((ranked, index) => {
      const group = ranked.group === 'recent' ? 'Recently used' : ranked.group === 'common' ? 'Most assigned' : 'All tags';
      const item = new vscode.CompletionItem({ label: `(${ranked.tag})`, description: `${group} · ${ranked.assignments} assignment${ranked.assignments === 1 ? '' : 's'}` }, vscode.CompletionItemKind.Keyword);
      item.detail = assignPrevious ? `Add ${ranked.tag} to ${preceding}` : `Add ${ranked.tag} to the glyph selected next`;
      item.insertText = assignPrevious ? `+${ranked.tag})` : `(+=${ranked.tag})`;
      item.range = completionRange;
      const createOffset = ranked.group === 'recent' ? 0 : 1;
      item.sortText = `!0${String(index + 1 + createOffset).padStart(3, '0')}`;
      item.command = assignPrevious
       ? { command: 'youhavecode.assignTagToPreviousGlyph', title: `Add ${ranked.tag} to ${preceding}`, arguments: [ranked.tag] }
       : { command: 'youhavecode.continueFiltering', title: `Add ${ranked.tag} to next glyph` };
      return item;
    });
      return new vscode.CompletionList([createItem, ...tagItems], true);
    }
    if (inlineMenu === 'customTagActions' && inlineMenuAnchor?.tag) {
     const tag = inlineMenuAnchor.tag;
     const actions = [
      { label: 'Add to next glyph', detail: `Attach ${tag} to the glyph selected next`, token: `(+=${tag})` },
      { label: 'Remove from next glyph', detail: `Detach ${tag} from the glyph selected next`, token: `(-=${tag})` },
      { label: 'Delete tag everywhere', detail: `Remove ${tag} from every glyph`, token: `(--${tag})` },
     ];
     return new vscode.CompletionList(actions.map((action, index) => {
      const item = new vscode.CompletionItem(action.label, index === 2 ? vscode.CompletionItemKind.Event : vscode.CompletionItemKind.Operator);
      item.detail = action.detail;
      item.insertText = action.token;
      item.range = completionRange;
      item.sortText = `!00${index}`;
      item.command = { command: 'youhavecode.continueFiltering', title: action.label };
      return item;
     }), true);
    }
    if (inlineMenu === 'outputFormats') {
     const current = effectiveQueryOption(query, 'render', renderDefaults);
     const formatItems = outputValues.map((format, index) => {
      const bitmap = bitmapOutputFormat(format);
      const selected = format === current;
      const item = new vscode.CompletionItem({ label: `${bitmap ? selected ? '$(check)' : '$(symbol-color)' : ''}${bitmap ? ' ' : ''}${format}`, description: selected ? 'selected' : bitmap ? 'Pretty print' : 'Text output' }, vscode.CompletionItemKind.Value);
      item.detail = optionValueDetail('output', format);
      item.insertText = `(output=${format})`;
      item.range = completionRange;
      item.sortText = `!0${bitmap ? '1' : '0'}${String(index).padStart(2, '0')}`;
      item.command = { command: 'youhavecode.setInlineOutputFormat', title: `Use ${format} output`, arguments: [format] };
      return item;
     });
     return new vscode.CompletionList(formatItems, true);
    }
    if (inlineMenu === 'recent' || inlineMenu === 'frequent') {
     const matching = new Map(matchingEntries(entries, query, Infinity, customGlyphTags).map(entry => [entry.hex, entry]));
    const rankedEntries = rankGlyphHexes(usageStats, inlineMenu).flatMap(hex => matching.get(hex) ?? []).slice(0, inlineMenu === 'recent' ? 25 : undefined);
     const repeat = query.prefix === ':::';
     const output = effectiveQueryOption(query, 'render', renderDefaults);
    const rankedItems = rankedEntries.flatMap((entry, index) => emojiPresentationChoices(entry, emojiPresentation(), query.representation === undefined || query.representation === 'glyph').map((choice, variantIndex) => {
    const compatibilityNotice = glyphCompatibilityNotice(entry, configuredCompatibilityTargets(), configuredCompatibilityFallback('compatibilityUnknownPolicy'), compatibilityProfiles);
    const item = new vscode.CompletionItem({ label: `${displayGlyph(entry, choice.presentation)}${choice.label ? ` ${choice.label} · U+` : '  U+'}${entry.hex}`, description: compatibilityNotice.badge ? `${compatibilityNotice.badge} ${entry.name}` : entry.name }, vscode.CompletionItemKind.Text);
      item.detail = `${inlineMenu === 'recent' ? 'Recently used' : `${usageStats.glyphs[entry.hex]?.count ?? 0} uses`} · Insert as ${queryOutputLabel(query, insertionFormat, renderDefaults)}${compatibilityNotice.detail ? ` · Compatibility: ${compatibilityNotice.detail}` : ''}`;
      item.filterText = `${entry.name} ${entry.hex} ${entry.character}${choice.label ? ` ${choice.label}` : ''}`;
      item.insertText = renderCompletionOutput(entry.character, entries, query, output, insertionFormat, choice.presentation, document.languageId) + (repeat ? ':::' : '');
      item.range = completionRange;
      item.sortText = `!0${String(index).padStart(4, '0')}${variantIndex}`;
      item.command = {
       command: 'youhavecode.commitGlyph', title: repeat ? 'Insert another glyph' : 'Remember recently used glyph', arguments: [
      entry.hex, repeat, reusableQueryTokens(query), query.options,
      { line: position.line, start: query.expressionStart, end: query.draftStart },
      isBitmapQueryOutput(query, output) ? { query, leadingText: document.lineAt(position).text.slice(0, query.expressionStart) } : undefined,
      query.tagEdits,
      query.prefix === '::',
      boundedSession,
      choice.presentation,
       ],
      };
      return item;
    }));
      return new vscode.CompletionList(rankedItems.length ? rankedItems : [emptyMenuItem(`No ${inlineMenu} glyphs match this query`, completionRange)], true);
    }
    if (query.mode === 'glyphProperty' && query.glyphLiteral) {
     const entry = entries.find(candidate => candidate.character === query.glyphLiteral);
     const inputLabels = glyphPropertyInputLabels(query.draft);
     const propertyStart = query.draftStart + query.glyphLiteral.length;
     const propertyRange = new vscode.Range(position.line, propertyStart, position.line, position.character);
     const literalRange = new vscode.Range(position.line, query.draftStart, position.line, propertyStart);
     const propertyItems = (entry ? glyphPropertyExpansions(entry, query.draft) : []).map((expansion, index) => {
      const inputLabel = inputLabels[index] ?? `?${expansion.key}`;
      const item = new vscode.CompletionItem({ label: inputLabel, description: `${expansion.label} → ${expansion.value}` }, vscode.CompletionItemKind.Property);
      item.detail = expansion.detail;
      item.filterText = inputLabel;
      item.insertText = expansion.value;
      item.range = { inserting: propertyRange, replacing: propertyRange };
      item.additionalTextEdits = [vscode.TextEdit.delete(literalRange)];
      item.sortText = `!0${String(index).padStart(2, '0')}`;
      item.preselect = index === 0;
      item.command = { command: 'youhavecode.continueFiltering', title: 'Inspect glyph property' };
      return item;
     });
     return new vscode.CompletionList(propertyItems.length ? propertyItems : [emptyMenuItem('No matching glyph property', completionRange)], true);
    }
   if (query.mode === 'filterValue' && query.filterKey) {
     const previous = query.filters.find(filter => filter.key === query.filterKey);
     const activeValues = new Set(previous?.value.split('|') ?? []);
     const values = orderFilterValues(filterValues(entries, query.filterKey, query.draft).filter(value => !activeValues.has(value)), recentFilterValues(usageStats, query.filterKey));
    const counts = countFilterValues(entries, query, query.filterKey, values, customGlyphTags);
     const valueItems = values.map((value, index) => {
      const description = propertyValueDescription(aliases, query.filterKey!, value);
      const count = counts.get(value) ?? 0;
      const chip = `(${query.filterKey}=${value})`;
      const item = new vscode.CompletionItem({ label: chip, description: `${description ? `${description} · ` : ''}${count.toLocaleString()} glyphs` }, vscode.CompletionItemKind.EnumMember);
     item.detail = `${count.toLocaleString()} glyphs`;
     item.filterText = value;
    item.insertText = query.unwrappedFilter ? chip : `${[...activeValues, value].join('|')})`;
    if (activeValues.size) {
     const line = document.lineAt(position).text;
     const beforeCurrent = line.slice(query.expressionStart, query.draftStart - query.filterKey!.length - 2);
     const pattern = new RegExp(`\\(${query.filterKey}=[^)]+\\)`, 'g');
     item.additionalTextEdits = [...beforeCurrent.matchAll(pattern)].map(match => {
      const start = query.expressionStart + match.index!;
      return vscode.TextEdit.delete(new vscode.Range(position.line, start, position.line, start + match[0].length));
     });
    }
    item.range = query.unwrappedFilter
     ? new vscode.Range(position.line, query.expressionStart + query.prefix.length, position.line, position.character)
     : completionRange;
    item.sortText = `!0${String(index).padStart(4, '0')}`;
    item.command = { command: 'youhavecode.continueFiltering', title: 'Continue filtering' };
     return item;
     });
    return new vscode.CompletionList(valueItems.length ? valueItems : [noMatchesItem(query.draft, completionRange)], true);
   }
    if (query.mode === 'optionValue' && query.optionKey) {
     const valueItems = optionValues(query.optionKey, query.draft).map((value, index) => {
      const item = new vscode.CompletionItem(value, vscode.CompletionItemKind.Value);
      item.detail = optionValueDetail(query.optionKey!, value);
      item.insertText = `${value})`;
      item.range = completionRange;
      item.sortText = `!0${String(index).padStart(4, '0')}`;
      item.command = query.optionKey === 'output' || query.optionKey === 'render'
       ? { command: 'youhavecode.setInlineOutputFormat', title: `Use ${value} output`, arguments: [value] }
       : { command: 'youhavecode.continueFiltering', title: 'Apply output option' };
      return item;
     });
     return new vscode.CompletionList(valueItems.length ? valueItems : [noMatchesItem(query.draft, completionRange)], true);
    }
  if (query.mode === 'tagValue' && query.tagOperation && query.unwrappedTag && 'debug'.startsWith(query.draft.toLowerCase())) {
   const enabled = query.tagOperation === 'add';
   const debugItem = new vscode.CompletionItem({ label: enabled ? '$(debug) Enable Developer/Debug Mode' : '$(debug) Disable Developer/Debug Mode', description: developerDebugMode === enabled ? 'already selected' : enabled ? 'Show developer-only Pretty Print tools' : 'Hide developer-only Pretty Print tools' }, vscode.CompletionItemKind.Event);
   debugItem.detail = 'Private workspace developer mode';
   debugItem.filterText = `${enabled ? '+' : '-'}debug developer debug mode`;
   debugItem.insertText = 'debug';
   debugItem.range = completionRange;
   debugItem.sortText = '!000';
   debugItem.command = { command: 'youhavecode.setDeveloperDebugMode', title: enabled ? 'Enable Developer/Debug Mode' : 'Disable Developer/Debug Mode', arguments: [enabled] };
   return new vscode.CompletionList([debugItem], true);
  }
  if (query.mode === 'tagValue' && query.tagOperation) {
    const draft = query.draft.trim().toLowerCase();
    const knownTags = [...new Set(Object.values(customGlyphTags).flat())].filter(tag => tag.startsWith(draft)).sort();
    const values = query.tagOperation === 'add' && /^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u.test(draft)
     ? [draft, ...knownTags.filter(tag => tag !== draft)] : knownTags;
    const symbol = query.tagOperation === 'add' ? '+' : '-';
    const valueItems = values.map((tag, index) => {
       const item = new vscode.CompletionItem(query.tagOperation === 'delete' ? `(--${tag})` : `(${symbol}=${tag})`, vscode.CompletionItemKind.Keyword);
       item.detail = query.tagOperation === 'delete' ? 'Delete this custom tag from every glyph' : `${query.tagOperation === 'add' ? 'Add' : 'Remove'} custom tag on the glyph selected next`;
     item.filterText = tag;
     item.insertText = `${tag})`;
     item.range = completionRange;
     item.sortText = `!0${String(index).padStart(4, '0')}`;
    item.command = query.unwrappedTag
     ? { command: 'youhavecode.assignTagToPreviousGlyph', title: `Add ${tag} to preceding glyph`, arguments: [tag] }
     : { command: 'youhavecode.continueFiltering', title: 'Continue filtering' };
     return item;
    });
    return new vscode.CompletionList(valueItems.length ? valueItems : [noMatchesItem(query.draft, completionRange)], true);
  }

  const items: vscode.CompletionItem[] = [];
  const availableReplayTokens = (query.prefix === ':::' || continuationSession) && !query.draft
   ? replayTokens.filter(token => !query.tokens.includes(token)) : [];
  const canReplay = availableReplayTokens.length > 0;
  availableReplayTokens.forEach((token, index) => {
  const item = new vscode.CompletionItem(continuationSession ? token : `Reuse ${token}`, vscode.CompletionItemKind.Reference);
   item.detail = `Reapply from the last glyph search · ${availableReplayTokens.length} token${availableReplayTokens.length === 1 ? '' : 's'} remaining`;
   item.insertText = token;
   item.range = completionRange;
   item.sortText = `!00${String(index).padStart(3, '0')}`;
  item.preselect = continuationSession && index === 0;
   item.command = { command: 'youhavecode.consumeReplayToken', title: 'Reuse previous search token', arguments: [token] };
   items.push(item);
  });
  const draft = query.draft.toLowerCase();
  if (query.mode === 'token' && /^[+-][a-z]*$/u.test(draft) && 'debug'.startsWith(draft.slice(1))) {
   const enabled = draft.startsWith('+');
  const debugItem = new vscode.CompletionItem({ label: enabled ? '$(debug) Enable Developer/Debug Mode' : '$(debug) Disable Developer/Debug Mode', description: developerDebugMode === enabled ? 'already selected' : enabled ? 'Show developer-only Pretty Print tools' : 'Hide developer-only Pretty Print tools' }, vscode.CompletionItemKind.Event);
   debugItem.detail = 'Private workspace developer mode';
   debugItem.filterText = `${enabled ? '+' : '-'}debug developer debug mode`;
   debugItem.insertText = '';
   debugItem.range = completionRange;
   debugItem.sortText = '!000';
   debugItem.command = { command: 'youhavecode.setDeveloperDebugMode', title: enabled ? 'Enable Developer/Debug Mode' : 'Disable Developer/Debug Mode', arguments: [enabled] };
   items.push(debugItem);
  }
  actionKeys.filter(action => action !== 'print' && !query.actions.includes(action) && `*${action}`.startsWith(draft)).forEach((action, index) => {
  const parenthesized = query.draftStart > query.expressionStart + query.prefix.length
   && document.lineAt(position).text[query.draftStart - 1] === '(';
  const item = new vscode.CompletionItem(`*${action}`, vscode.CompletionItemKind.Event);
  item.detail = 'Configure printable output without filtering glyphs';
  item.filterText = `*${action}`;
  item.insertText = parenthesized ? `*${action})` : `(*${action})`;
  item.range = completionRange;
  item.sortText = `!89${index}`;
  item.command = { command: 'youhavecode.continueFiltering', title: 'Open print options' };
  items.push(item);
  });
  const appliedFilterKeys = new Set(query.filters.map(filter => filter.key));
  const directFilterKeys = [...new Set(filterInputKeys.filter(input => draft && input.startsWith(draft)).map(input => canonicalFilterKey(input)!))];
  directFilterKeys.filter(key => !appliedFilterKeys.has(key)).forEach((key, index) => {
    const item = new vscode.CompletionItem(`(${key}=…)`, vscode.CompletionItemKind.Property);
    item.filterText = key;
    item.insertText = `(${key}=`;
    item.range = completionRange;
    item.sortText = `!70${index}`;
    item.command = { command: 'youhavecode.continueFiltering', title: `Choose ${key}` };
    items.push(item);
  });
  if (!query.draft && query.actions.includes('print')) {
   const appliedOptionKeys = new Set(query.options.map(option => option.key));
   suggestedOptionKeys.filter(key => !appliedOptionKeys.has(key)).forEach((key, index) => {
    const item = new vscode.CompletionItem(`(${key === 'd4' ? '*' : ''}${key}=…)`, vscode.CompletionItemKind.Property);
    item.detail = key === 'compact' ? 'Reduce blank side columns between glyphs' : `Configure print ${key}`;
    item.insertText = `(${key === 'd4' ? '*' : ''}${key}=`;
    item.range = completionRange;
    item.sortText = `!01${index}`;
    item.command = { command: 'youhavecode.continueFiltering', title: `Choose ${key}` };
    items.push(item);
   });
  }
    const matchingUtilities = query.mode === 'token' ? matchingUtilityActions(query.draft) : [];
    const literalWords = literalNameWords(entries, query.draft, customGlyphTags);
    const literalEntry = query.draft ? entries.find(entry => entry.character === query.draft) : undefined;
    const literalExpansion = literalEntry ? glyphPropertyExpansions(literalEntry, 'name')[0]?.value : undefined;
    const individualLiteralValues = new Set(literalWords.map(word => `(${word.value.toLowerCase()})`));
    const compoundLiteralExpansion = literalExpansion && !individualLiteralValues.has(literalExpansion) ? literalExpansion : undefined;
    const hasSearchConstraints = query.words.length > 0 || query.filters.length > 0 || (query.defaultFilters?.length ?? 0) > 0;
    const followUpWords = !query.draft && hasSearchConstraints ? topMatchingWords(entries, query, customGlyphTags) : [];
    const candidateWordMatches = (literalWords.length ? literalWords : query.draft ? matchingWords(words, query.draft) : followUpWords).filter(word => !query.words.includes(word.value));
    const wordCounts = countMatchingWords(entries, query, candidateWordMatches, customGlyphTags);
    const wordMatches = candidateWordMatches.filter(word => literalWords.length > 0 || (wordCounts.get(word.value) ?? 0) > 1);
    if (compoundLiteralExpansion) {
     const item = new vscode.CompletionItem({ label: compoundLiteralExpansion, description: '1 glyph' }, vscode.CompletionItemKind.Keyword);
     item.detail = `Unicode name · ${literalEntry!.name}`;
     item.filterText = query.draft;
     item.insertText = compoundLiteralExpansion;
     item.range = completionRange;
     item.sortText = '!03999';
     item.preselect = !canReplay;
     item.command = { command: 'youhavecode.continueFiltering', title: 'Continue filtering' };
     items.push(item);
    }
    wordMatches.forEach((word, index) => {
    const parenthesized = query.draftStart > query.expressionStart + query.prefix.length
     && document.lineAt(position).text[query.draftStart - 1] === '(';
    const value = word.value.toLowerCase();
    const count = wordCounts.get(word.value) ?? 0;
    const item = new vscode.CompletionItem({ label: `(${value})`, description: `${count.toLocaleString()} glyphs` }, vscode.CompletionItemKind.Keyword);
    item.detail = `Name word · ${count.toLocaleString()} glyphs`;
    item.filterText = literalWords.length ? query.draft : word.value;
    item.insertText = parenthesized ? `${value})` : `(${value})`;
    item.range = completionRange;
    item.sortText = `${literalWords.length ? '!04' : '!1'}${String(index).padStart(4, '0')}`;
    item.preselect = !canReplay && !matchingUtilities.length && !compoundLiteralExpansion && index === 0;
    item.command = { command: 'youhavecode.continueFiltering', title: 'Continue filtering' };
    items.push(item);
    });
    const normalizedDraft = query.draft.toUpperCase();
    const exactCustomTagMatch = (entry: UnicodeEntry) => (customGlyphTags[entry.hex] ?? []).some(tag => tag.toUpperCase() === normalizedDraft);
    const resultEntries = (!query.draft && !hasSearchConstraints
      ? initialEntries(entries, rankGlyphHexes(usageStats, 'recent'), 5)
    : matchingEntries(entries, query, 100, customGlyphTags))
     .sort((left, right) => Number(exactCustomTagMatch(right)) - Number(exactCustomTagMatch(left)));
    const restoreGlyphSelection = !query.draft && !query.words.length && !query.filters.length
     && resultEntries.some(entry => entry.hex === preferredGlyphHex);
    resultEntries.forEach((entry, index) => emojiPresentationChoices(entry, emojiPresentation(), query.representation === undefined || query.representation === 'glyph').forEach((choice, variantIndex) => {
    const compatibilityNotice = glyphCompatibilityNotice(entry, configuredCompatibilityTargets(), configuredCompatibilityFallback('compatibilityUnknownPolicy'), compatibilityProfiles);
    const item = new vscode.CompletionItem({ label: `${displayGlyph(entry, choice.presentation)}${choice.label ? ` ${choice.label} · U+` : '  U+'}${entry.hex}`, description: compatibilityNotice.badge ? `${compatibilityNotice.badge} ${entry.name}` : entry.name }, vscode.CompletionItemKind.Text);
    item.detail = `${entry.category} · Bidi ${entry.bidi} · Combining ${entry.combining} · Insert as ${queryOutputLabel(query, insertionFormat, renderDefaults)}${compatibilityNotice.detail ? ` · Compatibility: ${compatibilityNotice.detail}` : ''}`;
      item.filterText = `${entry.name} ${entry.hex} ${entry.character} ${(customGlyphTags[entry.hex] ?? []).join(' ')}${choice.label ? ` ${choice.label}` : ''}`;
    const repeat = query.prefix === ':::';
    const output = effectiveQueryOption(query, 'render', renderDefaults);
    item.insertText = renderCompletionOutput(entry.character, entries, query, output, insertionFormat, choice.presentation, document.languageId) + (repeat ? ':::' : '');
    item.range = completionRange;
    const exactLiteral = entry.character === query.draft;
    item.sortText = continuationSession && entry.hex === preferredGlyphHex ? `!01000${variantIndex}`
     : `${exactLiteral || exactCustomTagMatch(entry) ? '!05' : '!2'}${String(index).padStart(4, '0')}${variantIndex}`;
    const emptyRoot = !query.draft && !query.words.length && !query.filters.length;
    item.preselect = !canReplay && (emptyRoot
    ? restoreGlyphSelection && entry.hex === preferredGlyphHex && variantIndex === 0
    : variantIndex === 0 && !matchingUtilities.length && (!literalWords.length && !compoundLiteralExpansion && exactLiteral || !wordMatches.length && !compoundLiteralExpansion && index === 0));
    item.command = {
     command: 'youhavecode.commitGlyph',
     title: repeat ? 'Insert another glyph' : 'Remember recently used glyph',
    arguments: [
     entry.hex,
     repeat,
     reusableQueryTokens(query),
     query.options,
     { line: position.line, start: query.expressionStart, end: query.draftStart },
    isBitmapQueryOutput(query, output) ? { query, leadingText: document.lineAt(position).text.slice(0, query.expressionStart) } : undefined,
    query.tagEdits,
    query.prefix === '::',
    boundedSession,
    choice.presentation,
    ],
    };
    items.push(item);
    }));
    matchingUtilities.forEach((action, index) => {
      const label = action.key === 'outputFormat' ? { label: action.label, description: `= ${renderDefaults.render}` }
      : action.key === 'defaultFilters' ? { label: action.label, description: defaultFilterSummary() || 'None' }
        : action.key === 'compatibility' ? { label: action.label, description: configuredCompatibilitySummary() }
       : action.label;
     const item = new vscode.CompletionItem(label, action.kind);
    item.detail = action.key === 'recent' ? query.words.length || query.filters.length ? 'Recently used glyphs within these filters' : 'Up to 25 glyphs ordered by recency'
     : action.key === 'frequent' ? query.words.length || query.filters.length ? 'Frequently used glyphs within these filters' : 'Glyphs ordered by usage count'
      : action.key === 'properties' ? `${propertyFilters.filter(filter => !appliedFilterKeys.has(filter.key)).length} available Unicode property filters`
       : action.key === 'customTags' ? 'Add or remove a searchable keyword on the glyph selected next'
        : action.key === 'defaultFilters' ? 'Apply persistent property filters; explicit query filters override matching properties'
        : action.key === 'compatibility' ? 'Configure versioned platform support and local-font policies'
        : action.key === 'settings' ? 'Open all extension settings'
        : `Choose text or pretty-print output; current format is ${renderDefaults.render}`;
     item.filterText = action.terms.join(' ');
    item.insertText = '';
     item.range = completionRange;
     item.sortText = query.draft ? `!06${String(index).padStart(2, '0')}` : action.rootSort;
     item.preselect = !!query.draft && index === 0;
     item.command = { command: action.command, title: action.commandTitle, arguments: action.commandArguments ? [...action.commandArguments] : undefined };
     items.push(item);
    });
    if (continuation) {
     items.filter(item => item.command?.command !== 'youhavecode.commitGlyph').forEach(item => {
      if (typeof item.insertText === 'string' && !item.insertText.startsWith(':')) {
       item.insertText = `${boundedSession ? ':' : '::'}${item.insertText}`;
      }
     });
    }
    if (!items.length) {
     const activeDefaults = [...enabledDefaultTerms(), defaultFilterSummary()].filter(Boolean).join(' ');
     items.push(noMatchesItem(query.draft, completionRange, activeDefaults));
    }
   return new vscode.CompletionList(items, true);
  },
 }, ':', '=', '?'));

 context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => {
  const editor = vscode.window.activeTextEditor;
  if (!editor || event.document !== editor.document || event.contentChanges.length !== 1) { return; }
  const change = event.contentChanges[0];
  const position = change.range.start;
  if (position.line !== change.range.end.line) { return; }
  const lineText = event.document.lineAt(position.line).text;
  const cursorCharacter = position.character + change.text.length;
    const anchoredEdit = continuationAnchor?.document === event.document && continuationAnchor.line === position.line
     && position.character >= continuationAnchor.character;
    const continuation = anchoredEdit && !lineText.slice(continuationAnchor!.character, cursorCharacter).startsWith('::');
    if (anchoredEdit) {
     continuationAnchor = { ...continuationAnchor!, version: event.document.version };
    }
    if (continuation) {
     if (typingSuggestTimer) { clearTimeout(typingSuggestTimer); }
     typingSuggestTimer = setTimeout(() => {
      typingSuggestTimer = undefined;
      void vscode.commands.executeCommand('editor.action.triggerSuggest');
     }, 40);
    }
  const cursorPosition = new vscode.Position(position.line, cursorCharacter);
  const currentQuery = boundedQueryAt(event.document, cursorPosition)
   ?? parseUnicodeQuery(lineText.slice(0, cursorCharacter), triggerPrefixes());
  if (currentQuery) {
    if (currentQuery.prefix === ':::') { repeatingQuery = { document: event.document, line: position.line }; }
    void vscode.commands.executeCommand('setContext', 'youhavecode.suggestionNavigated', false);
   completionAnchor = { document: event.document, line: position.line, character: currentQuery.expressionStart, prefix: currentQuery.prefix };
    void vscode.commands.executeCommand('setContext', 'youhavecode.queryActive', true);
    if (change.text) {
     if (typingSuggestTimer) { clearTimeout(typingSuggestTimer); }
     typingSuggestTimer = setTimeout(() => {
      typingSuggestTimer = undefined;
      const query = activeQuery();
      if (query?.mode === 'glyphProperty' || query?.draft === '?') {
       void vscode.commands.executeCommand('hideSuggestWidget')
        .then(() => vscode.commands.executeCommand('editor.action.triggerSuggest'));
      } else if (query) {
       void vscode.commands.executeCommand('editor.action.triggerSuggest');
      }
     }, 40);
    }
  }
  if (!completionAnchor || completionAnchor.document !== event.document) { return; }
  const { line, character, prefix } = completionAnchor;
  if (!shouldRetriggerAfterEdit(lineText, position.line, position.character, change.rangeLength, change.text, line, character, prefix)) {
   void updateQueryContext();
  }
 }));

 context.subscriptions.push(vscode.commands.registerCommand('youhavecode.insertGlyph', () => openInlineQuery()));

 context.subscriptions.push(vscode.commands.registerCommand('youhavecode.insertGlyphByHex', async (hex: string, presentation = emojiPresentation()) => {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { await vscode.window.showWarningMessage('Open a text editor before inserting a Unicode glyph.'); return; }
  const entry = (await loadEntries()).find(candidate => candidate.hex === hex);
  if (!entry) { await vscode.window.showErrorMessage(`Unicode glyph U+${hex} is unavailable.`); return; }
  const inserted = await editor.edit(builder => editor.selections.forEach(selection => builder.replace(selection, renderUnicode(entry.character, [entry], insertionFormat, presentation))));
  if (inserted) { await recordUsage(entry.hex, presentation); }
 }));

 context.subscriptions.push(vscode.commands.registerCommand('youhavecode.prettyPrintSelectionAs', async (format: BitmapTextFormat) => {
  if (!vscode.window.activeTextEditor?.selections.some(selection => !selection.isEmpty)) {
   await vscode.window.showInformationMessage('Select a Unicode message to pretty print.');
   return;
  }
  const output = bitmapOutputValue(format);
  lastSelectionOutput = output;
  await Promise.all([
   context.globalState.update(lastSelectionOutputKey, output),
   vscode.workspace.getConfiguration('youhavecode').update('defaultOutput', output, vscode.ConfigurationTarget.Global),
  ]);
  await vscode.commands.executeCommand('youhavecode.chooseInsertionFormat', 'lastBitmap');
 }));

 const printPrettyPrintSweep = async (kind: 'fonts' | 'sizes' | 'transforms' | 'types') => {
  const editor = vscode.window.activeTextEditor;
  const selectionText = editor?.selections.filter(selection => !selection.isEmpty).map(selection => editor.document.getText(selection)).join('') ?? '';
  const target = selectionText || '🦁️';
  const defaults = configuredRenderDefaults(context);
  const compact = defaults.compact === 'on';
  const maxExtent = defaults.wrap === 'none' || defaults.wrap === 'glyph' ? undefined : defaults.wrap === 'auto' ? vscode.workspace.getConfiguration('editor').get('wordWrapColumn', 80) : Number.parseInt(defaults.wrap, 10);
  const layout = resolvedBitmapLayout(defaults);
  const activeFamilies = fontPreferenceState().active;
  const sizes = [8, 16, 24, 32, 48, 64, 96, 128];
  const transforms: readonly BitmapD4[] = ['identity', 'rotate-90', 'rotate-180', 'rotate-270', 'mirror-left-right', 'flip-top-bottom', 'reflect-slash', 'reflect-backslash'];
  const types: readonly BitmapTextFormat[] = ['braille', 'blockElements', 'iphoneBlocks', 'emoji', 'binary', 'hex'];
  const sweepFamilies = kind === 'fonts' ? activeFamilies : activeFamilies.slice(0, 1);
  const lines: string[] = [];
  const segments = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(target)].map(segment => segment.segment);
  for (const grapheme of segments) {
   lines.push(`=== ${grapheme} ${Array.from(grapheme).map(character => `U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`).join(' ')} ===`);
   if (!activeFamilies.length) {
    lines.push('No active Pretty Print font families configured.');
    continue;
   }
  const variants = kind === 'fonts' ? sweepFamilies.map(family => ({ label: `family: ${family}`, family, size: Number.parseInt(defaults.size, 10) || 32, format: bitmapOutputFormat(defaults.render) ?? 'braille' as BitmapTextFormat, d4: layout.d4 }))
   : kind === 'sizes' ? sweepFamilies.flatMap(family => sizes.map(size => ({ label: `family: ${family} · size: ${size}`, family, size, format: bitmapOutputFormat(defaults.render) ?? 'braille' as BitmapTextFormat, d4: layout.d4 })))
   : kind === 'transforms' ? sweepFamilies.flatMap(family => transforms.map(d4 => ({ label: `family: ${family} · D4: ${d4}`, family, size: Number.parseInt(defaults.size, 10) || 32, format: bitmapOutputFormat(defaults.render) ?? 'braille' as BitmapTextFormat, d4 })))
   : sweepFamilies.flatMap(family => types.map(format => ({ label: `family: ${family} · type: ${format}`, family, size: Number.parseInt(defaults.size, 10) || 32, format, d4: layout.d4 })));
   for (const variant of variants) {
    try {
    const variantLayout = kind === 'transforms' ? transformLayout(variant.d4) : { flow: layout.flowDirection, wrap: layout.wrapDirection };
     const bitmap = await textToBitmap(grapheme, variant.size, variant.format, {
      compact,
      maxExtent,
      oneGlyphPerGroup: defaults.wrap === 'glyph',
      flowDirection: variantLayout.flow,
      wrapDirection: variantLayout.wrap,
      d4: variant.d4,
      emojiArtRasterizer: rasterizeEmojiArt,
     }, (character: string) => bitmapRasterizerForFamily(defaults.mapping, character, variant.family, variant.size));
     lines.push(variant.label);
     lines.push(bitmap);
     lines.push('---');
    } catch (error) {
    lines.push(`${variant.label} (not renderable: ${error instanceof Error ? error.message : String(error)})`);
     lines.push('---');
    }
   }
  }
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: lines.join('\n') || 'No fonts rendered.' });
  await vscode.window.showTextDocument(document, { preview: false, viewColumn: vscode.ViewColumn.Beside });
 };

 context.subscriptions.push(vscode.commands.registerCommand('youhavecode.printWithAllFonts', () => printPrettyPrintSweep('fonts')));
 context.subscriptions.push(vscode.commands.registerCommand('youhavecode.prettyPrintAllSizes', () => printPrettyPrintSweep('sizes')));
 context.subscriptions.push(vscode.commands.registerCommand('youhavecode.prettyPrintAllTransforms', () => printPrettyPrintSweep('transforms')));
 context.subscriptions.push(vscode.commands.registerCommand('youhavecode.prettyPrintAllTypes', () => printPrettyPrintSweep('types')));

   context.subscriptions.push(vscode.commands.registerCommand('youhavecode.customArtSelection', async () => {
    const editor = vscode.window.activeTextEditor;
    const targets = editor?.selections.filter(selection => !selection.isEmpty).map(range => ({ range, text: editor.document.getText(range) })) ?? [];
    if (!editor || !targets.length) { await vscode.window.showInformationMessage('Select a Unicode message to turn into custom art.'); return; }
    const configuredProfiles = vscode.workspace.getConfiguration('youhavecode').get<CustomArtProfile[]>('customArtProfiles', []).filter(validCustomArtProfile);
    const selected = await vscode.window.showQuickPick([
     ...configuredProfiles.map(profile => ({ label: profile.name, description: `${profile.glyphs} on ${profile.emptyGlyphs.trim() || 'space'} · ${profile.delegate}`, profile })),
     { label: 'Ad hoc…', description: 'Choose glyph sets for this render', profile: undefined },
    ], { title: 'Custom Art', placeHolder: configuredProfiles.length ? 'Choose a saved profile or create an ad hoc palette' : 'Create an ad hoc glyph palette' });
    if (!selected) { return; }
    let profile = selected.profile;
    if (!profile) {
     const glyphs = await vscode.window.showInputBox({ title: 'Custom Art › Main Glyphs', prompt: 'Filled pixels cycle through these glyphs', value: '█', validateInput: value => value ? undefined : 'Enter at least one glyph.' });
     if (!glyphs) { return; }
     const emptyMode = await vscode.window.showQuickPick([
      { label: 'Auto', description: 'Braille blank; reliably occupies one text cell', glyphs: '⠀' },
      { label: 'Space', description: 'Regular U+0020 space', glyphs: ' ' },
      { label: 'Monospace', description: 'U+2007 figure space', glyphs: ' ' },
      { label: 'Empty Block', description: 'Hollow square cell', glyphs: '□' },
     ], { title: 'Custom Art › Empty Glyphs', placeHolder: 'Choose the base glyph for empty pixels' });
     if (!emptyMode) { return; }
     const additions = await vscode.window.showInputBox({ title: 'Custom Art › Additional Empty Glyphs', prompt: 'Optional glyphs to add to the empty-pixel cycle', placeHolder: 'Leave empty to use only the selected base' });
     if (additions === undefined) { return; }
     const delegate = await vscode.window.showQuickPick([
      { label: 'Cycle', description: 'Advance independently through filled and empty sets', value: 'cycle' as const },
      { label: 'Checker', description: 'Choose by row and column for a repeating pattern', value: 'checker' as const },
      { label: 'Hash', description: 'Choose a deterministic, less repetitive distribution', value: 'hash' as const },
     ], { title: 'Custom Art › Delegate', placeHolder: 'Choose how multiple glyphs are distributed' });
     if (!delegate) { return; }
     profile = { name: 'Ad hoc', glyphs, emptyGlyphs: emptyMode.glyphs + additions, delegate: delegate.value };
    }
    const defaults = configuredRenderDefaults(context);
    const size = await chooseCustomBitmapSize(context, Number.parseInt(defaults.size, 10));
    if (!size) { return; }
    await vscode.workspace.getConfiguration('youhavecode').update('bitmapSize', size, vscode.ConfigurationTarget.Global);
    try {
    const maxExtent = defaults.wrap === 'none' ? undefined : defaults.wrap === 'auto' ? vscode.workspace.getConfiguration('editor', editor.document.uri).get('wordWrapColumn', 80) : Number.parseInt(defaults.wrap, 10);
     const replacements = await Promise.all(targets.map(async target => startBitmapOnNewLine(await textToCustomArt(target.text, size, profile!, {
      compact: defaults.compact === 'on', maxExtent, ...resolvedBitmapLayout(defaults),
     }), editor.document.lineAt(target.range.start.line).text.slice(0, target.range.start.character))));
     const selectedOffsets = replacementOffsets(targets.map((target, index) => ({ start: editor.document.offsetAt(target.range.start), end: editor.document.offsetAt(target.range.end), replacement: replacements[index] })));
     const replaced = await editor.edit(builder => targets.forEach((target, index) => builder.replace(target.range, replacements[index])));
     if (replaced) {
      editor.selections = selectedOffsets.map(range => new vscode.Selection(editor.document.positionAt(range.start), editor.document.positionAt(range.end)));
      editor.revealRange(editor.selections[0]);
     }
    } catch (error) {
     await vscode.window.showErrorMessage(`Could not render custom art. ${error instanceof Error ? error.message : String(error)}`);
    }
   }));

 context.subscriptions.push(vscode.commands.registerCommand('youhavecode.chooseInsertionFormat', async (requestedFormat?: SelectionOutputChoice['format']) => {
  const editor = vscode.window.activeTextEditor;
  const targets = editor?.selections.filter(selection => !selection.isEmpty)
   .map(range => ({ range, text: editor.document.getText(range) })) ?? [];
    const formats: SelectionOutputChoice[] = targets.length ? selectionOutputChoices(lastSelectionOutput, configuredRenderDefaults(context)) : [
      { label: 'Glyph / symbol', description: '‽', format: 'symbols' },
    { label: 'Details', description: '‽ U+203D INTERROBANG', format: 'details' },
    { label: 'Full details', description: 'Glyph, code point, name, category, bidi, combining, decomposition', format: 'fullDetails' },
   { label: 'Code points', description: 'U+203D', format: 'codepoints' },
   { label: 'Unicode names', description: 'INTERROBANG', format: 'names' },
   { label: 'JSON escapes', description: '\\u203D', format: 'jsonEscapes' },
    ];
  const selectedFormat = requestedFormat && targets.length ? formats.find(format => format.format === requestedFormat) : await vscode.window.showQuickPick(formats, targets.length
    ? { title: 'Pretty Print Selected Glyph Stream', placeHolder: 'Convert the full selected message as one layout' }
    : { title: 'Output Format', placeHolder: 'Choose what each accepted glyph inserts' });
  if (requestedFormat && !targets.length) { await vscode.window.showInformationMessage('Select a Unicode message to pretty print.'); return; }
  if (!selectedFormat) { return; }
  if (editor && targets.length) {
    try {
     const configuration = vscode.workspace.getConfiguration('youhavecode');
      let replacements: string[];
      if (selectedFormat.format === 'quickBitmap' || selectedFormat.format === 'customBitmap') {
        const defaults = configuredRenderDefaults(context);
        const bitmapSettings = await chooseBitmapSettings(selectedFormat.format, lastSelectionOutput, defaults, context);
        if (!bitmapSettings) { return; }
        const output = bitmapOutputValue(bitmapSettings.format);
        lastSelectionOutput = output;
        await Promise.all([
         context.globalState.update(lastSelectionOutputKey, output),
         configuration.update('defaultOutput', output, vscode.ConfigurationTarget.Global),
         configuration.update('bitmapSize', bitmapSettings.size, vscode.ConfigurationTarget.Global),
         configuration.update('bitmapWrapLimit', bitmapSettings.wrapLimit, vscode.ConfigurationTarget.Global),
         configuration.update('bitmapCompact', bitmapSettings.compact, vscode.ConfigurationTarget.Global),
         configuration.update('bitmapFlowDirection', bitmapSettings.flow, vscode.ConfigurationTarget.Global),
         configuration.update('bitmapWrapDirection', bitmapSettings.wrapDirection, vscode.ConfigurationTarget.Global),
         configuration.update('bitmapD4', bitmapSettings.d4, vscode.ConfigurationTarget.Global),
        ]);
        const maxExtent = bitmapSettings.wrapLimit === -1 || bitmapSettings.wrapLimit === -2 ? undefined : bitmapSettings.wrapLimit || vscode.workspace.getConfiguration('editor', editor.document.uri).get('wordWrapColumn', 80);
        replacements = await Promise.all(targets.map(async target => startBitmapOnNewLine(
         await textToBitmap(target.text, bitmapSettings.size, bitmapSettings.format, {
          compact: bitmapSettings.compact, maxExtent, oneGlyphPerGroup: bitmapSettings.wrapLimit === -2, flowDirection: bitmapSettings.flow,
          wrapDirection: bitmapSettings.wrapDirection, d4: bitmapSettings.d4,
          emojiArtRasterizer: rasterizeEmojiArt,
         }, bitmapRasterizer(defaults.mapping)),
         editor.document.lineAt(target.range.start.line).text.slice(0, target.range.start.character),
        )));
      } else {
      const directBitmap = (['braille', 'blockElements', 'iphoneBlocks', 'emoji', 'binary', 'hex'] as const).includes(selectedFormat.format as BitmapTextFormat)
       ? bitmapOutputValue(selectedFormat.format as BitmapTextFormat)
       : undefined;
      const selectedOutput = selectedFormat.format === 'lastBitmap' ? lastSelectionOutput : directBitmap ?? outputValueFromFormat(selectedFormat.format as DeconstructionFormat);
       const selectedBitmapFormat = bitmapOutputFormat(selectedOutput);
       if (selectedBitmapFormat) {
        const defaults = configuredRenderDefaults(context);
        const size = Number.parseInt(defaults.size, 10);
        const maxExtent = defaults.wrap === 'none' ? undefined : defaults.wrap === 'auto' ? vscode.workspace.getConfiguration('editor', editor.document.uri).get('wordWrapColumn', 80) : Number.parseInt(defaults.wrap, 10);
        replacements = await Promise.all(targets.map(async target => startBitmapOnNewLine(
         await textToBitmap(target.text, size, selectedBitmapFormat, {
          compact: defaults.compact === 'on', maxExtent, ...resolvedBitmapLayout(defaults), emojiArtRasterizer: rasterizeEmojiArt,
         }, bitmapRasterizer(defaults.mapping)),
         editor.document.lineAt(target.range.start.line).text.slice(0, target.range.start.character),
        )));
       } else {
        const entries = await loadEntries();
        const format = outputFormat(selectedOutput, insertionFormat);
        replacements = targets.map(target => deconstructUnicode(target.text, entries, format));
       }
      }
    const selectedOffsets = replacementOffsets(targets.map((target, index) => ({
     start: editor.document.offsetAt(target.range.start), end: editor.document.offsetAt(target.range.end), replacement: replacements[index],
    })));
    const replaced = await editor.edit(builder => targets.forEach((target, index) => builder.replace(target.range, replacements[index])));
    if (replaced) {
     editor.selections = selectedOffsets.map(range => new vscode.Selection(editor.document.positionAt(range.start), editor.document.positionAt(range.end)));
     editor.revealRange(editor.selections[0]);
    }
    } catch (error) {
    await vscode.window.showErrorMessage(`Could not pretty print the selected text. ${error instanceof Error ? error.message : String(error)}`);
    }
   return;
  }
    if (selectedFormat.format === 'lastBitmap' || selectedFormat.format === 'quickBitmap' || selectedFormat.format === 'customBitmap') { return; }
  insertionFormat = selectedFormat.format as DeconstructionFormat;
  const configuredOutput = outputValueFromFormat(insertionFormat);
  renderDefaults = { ...renderDefaults, render: configuredOutput };
  await Promise.all([
   context.globalState.update(insertionFormatKey, insertionFormat),
   vscode.workspace.getConfiguration('youhavecode').update('defaultOutput', configuredOutput, vscode.ConfigurationTarget.Global),
  ]);
  await vscode.window.setStatusBarMessage(`Output format: ${selectedFormat.label}`, 2500);
 }));

 context.subscriptions.push(vscode.commands.registerCommand('youhavecode.setSidebarOutputFormat', async (output: string) => {
  if (!(outputValues as readonly string[]).includes(output)) { return; }
  insertionFormat = outputFormat(output, insertionFormat);
  renderDefaults = { ...renderDefaults, render: output };
  await Promise.all([
   context.globalState.update(insertionFormatKey, insertionFormat),
   vscode.workspace.getConfiguration('youhavecode').update('defaultOutput', output, vscode.ConfigurationTarget.Global),
  ]);
  sidebar.refresh();
 }));

 context.subscriptions.push(vscode.commands.registerCommand('youhavecode.prettyPrintSelection', async () => {
  const editor = vscode.window.activeTextEditor;
  if (!editor?.selections.some(selection => !selection.isEmpty)) {
   await vscode.window.showInformationMessage('Select a Unicode message to pretty print.');
   return;
  }
  await vscode.commands.executeCommand('youhavecode.chooseInsertionFormat');
 }));

 context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
  if (event.affectsConfiguration('youhavecode.prettyPrintFontFamily') || event.affectsConfiguration('youhavecode.prettyPrintFontFamilyDisabled') || event.affectsConfiguration('editor.fontFamily')) { refreshPrettyPrintFontFamilies(); }
  if (!event.affectsConfiguration('youhavecode')) { return; }
  renderDefaults = configuredRenderDefaults(context);
  insertionFormat = outputFormat(renderDefaults.render, insertionFormat);
 if (event.affectsConfiguration('youhavecode.bitmapCompact') || event.affectsConfiguration('youhavecode.bitmapSize') || event.affectsConfiguration('youhavecode.bitmapWrapLimit') || event.affectsConfiguration('youhavecode.bitmapGlyphMapping') || event.affectsConfiguration('youhavecode.bitmapFlowDirection') || event.affectsConfiguration('youhavecode.bitmapWrapDirection') || event.affectsConfiguration('youhavecode.bitmapD4')) { sidebar.refreshPrettyPrintHeaders(); return; }
  sidebar.refresh();
 }));
}

function validCustomArtProfile(profile: CustomArtProfile): boolean {
 return !!profile && typeof profile.name === 'string' && !!profile.name.trim()
  && typeof profile.glyphs === 'string' && !!profile.glyphs
  && typeof profile.emptyGlyphs === 'string'
  && ['cycle', 'checker', 'hash'].includes(profile.delegate);
}

function deletionRange(document: vscode.TextDocument, selection: vscode.Selection, direction: 'left' | 'right'): vscode.Range | undefined {
 if (!selection.isEmpty) { return selection; }
 const position = selection.active;
 if (direction === 'left') {
  if (position.character > 0) { return new vscode.Range(position.translate(0, -1), position); }
  if (position.line > 0) { return new vscode.Range(document.lineAt(position.line - 1).range.end, position); }
  return undefined;
 }
 if (position.character < document.lineAt(position.line).text.length) { return new vscode.Range(position, position.translate(0, 1)); }
 if (position.line + 1 < document.lineCount) { return new vscode.Range(position, new vscode.Position(position.line + 1, 0)); }
 return undefined;
}

function reusableQueryTokens(query: ReturnType<typeof parseUnicodeQuery>): string[] {
 return query ? [...query.tokens] : [];
}

function noMatchesItem(
 draft: string,
 range: vscode.Range | { inserting: vscode.Range; replacing: vscode.Range },
 activeDefaults = '',
): vscode.CompletionItem {
 const item = new vscode.CompletionItem('No Unicode matches — delete to broaden', vscode.CompletionItemKind.Text);
 item.detail = activeDefaults
  ? `Active defaults: ${activeDefaults}`
  : 'Keep typing or delete characters to change the query';
 item.filterText = draft;
 item.insertText = draft;
 item.range = range;
 item.sortText = '!99';
 item.preselect = true;
 return item;
}

function emptyMenuItem(label: string, range: vscode.Range | { inserting: vscode.Range; replacing: vscode.Range }): vscode.CompletionItem {
 const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Text);
 item.insertText = '';
 item.range = range;
 item.sortText = '!99';
 return item;
}

function displayGlyph(entry: UnicodeEntry, presentation: EmojiPresentation = 'auto'): string {
 if (entry.category.startsWith('M')) {
  return `◌${entry.character}`;
 }
 if (entry.category.startsWith('C') || entry.character.trim() === '') {
  return '·';
 }
 return applyEmojiPresentation(entry.character, presentation);
}

function emojiPresentationChoices(entry: UnicodeEntry, configured: EmojiPresentation, includeAlternates: boolean): readonly { presentation: EmojiPresentation; label?: string }[] {
 if (!includeAlternates || !entry.emoji) { return [{ presentation: configured }]; }
 const codepoints = Array.from(entry.character);
 if (codepoints.length !== 1) { return [{ presentation: 'color', label: 'Emoji' }]; }
 if (!textPresentationBases.has(entry.character.codePointAt(0)!)) {
  return [{ presentation: 'color', label: 'Emoji' }];
 }
 const first: EmojiPresentation = configured === 'text' ? 'text' : 'color';
 const presentations: readonly EmojiPresentation[] = [first, first === 'color' ? 'text' : 'color'];
 return presentations.map(presentation => ({ presentation, label: presentation === 'color' ? 'Emoji' : 'Text' }));
}

function formatLabel(format: DeconstructionFormat): string {
 return { symbols: 'glyph', components: 'glyph components', details: 'details', fullDetails: 'full details', codepoints: 'code point', names: 'Unicode name', jsonEscapes: 'JSON escape' }[format];
}

function optionOutputLabel(output: string): string {
 return {
  glyph: 'Glyph / symbol', components: 'Glyph components', unicode: 'JSON escapes', codepoint: 'Code points', name: 'Unicode names', details: 'Details', full: 'Full details',
  braille: 'Braille dots', 'block-elements': 'Block Elements', 'iphone-blocks': 'iPhone solid blocks', emoji: 'Emoji Art', binary: 'Binary', hex: 'Hex',
 }[output] ?? output;
}

function optionValueDetail(key: OptionKey, value: string): string {
 if (key === 'size') { return `Square ${value} pixel raster`; }
 if (key === 'wrap') { return value === 'auto' ? 'Use the editor limit along the flow axis' : `Wrap after ${value} text cells along the flow axis`; }
 if (key === 'compact') { return value === 'on' ? 'Trim blank edges along the flow axis' : 'Preserve full square glyph spacing'; }
 if (key === 'flow') { return { lr: 'Write glyphs left to right', rl: 'Write glyphs right to left', ud: 'Write glyphs top to bottom', du: 'Write glyphs bottom to top' }[value] ?? 'Glyph flow direction'; }
 if (key === 'wrap-direction') { return value === 'auto' ? 'Down for horizontal flow; right for vertical flow' : `Wrapped lines progress ${value}`; }
 if (key === 'd4') { return { identity: 'Do not transform glyph rasters', 'rotate-90': 'Rotate every glyph raster 90°', 'rotate-180': 'Rotate every glyph raster 180°', 'rotate-270': 'Rotate every glyph raster 270°', 'mirror-left-right': 'Mirror every glyph raster', 'flip-top-bottom': 'Flip every glyph raster', 'reflect-slash': 'Reflect every glyph raster across the diagonal', 'reflect-backslash': 'Reflect every glyph raster across the anti-diagonal' }[value] ?? `Apply ${value} to every glyph raster`; }
 return {
  glyph: 'Insert the glyph itself', components: 'Break graphemes and emoji into encoded parts', unicode: 'Insert a Unicode escape such as \\u203D', codepoint: 'Insert a code point such as U+203D',
  name: 'Insert the Unicode name', details: 'Insert glyph, code point, and name', full: 'Insert all Unicode details',
  braille: 'Render pixels as Braille dots', 'block-elements': 'Pack 2 × 2 pixels into Block Elements',
  'iphone-blocks': 'Render pixels as solid and hollow square cells', emoji: 'Render pixels as Emoji Art cells',
  binary: 'Render pixels as 0 and 1', hex: 'Render pixels as hexadecimal',
 }[value] ?? 'Output format';
}

function outputFormat(output: string | undefined, fallback: DeconstructionFormat): DeconstructionFormat {
 return { glyph: 'symbols', components: 'components', unicode: 'jsonEscapes', codepoint: 'codepoints', name: 'names', details: 'details', full: 'fullDetails' }[output ?? ''] as DeconstructionFormat | undefined ?? fallback;
}

function renderCompletionOutput(character: string, entries: readonly UnicodeEntry[], query: UnicodeQuery, output: string, fallback: DeconstructionFormat, presentation: EmojiPresentation, languageId: string): string {
 if (query.representation === 'glyph') { return applyEmojiPresentation(character, presentation); }
 if (query.representation === 'codepoint') { return renderCodepointReference(character); }
 if (query.representation === 'htmlEntity') { return renderHtmlEntity(character); }
 if (query.representation === 'languageEscape') { return renderLanguageEscape(character, languageId); }
 return bitmapOutputFormat(output) ? applyEmojiPresentation(character, presentation) : renderUnicode(character, entries, outputFormat(output, fallback), presentation);
}

function outputValueFromFormat(format: DeconstructionFormat): string {
 return { symbols: 'glyph', components: 'components', jsonEscapes: 'unicode', codepoints: 'codepoint', names: 'name', details: 'details', fullDetails: 'full' }[format];
}

function bitmapOutputFormat(output: string | undefined): BitmapTextFormat | undefined {
 return { braille: 'braille', 'block-elements': 'blockElements', 'iphone-blocks': 'iphoneBlocks', emoji: 'emoji', binary: 'binary', hex: 'hex' }[output ?? ''] as BitmapTextFormat | undefined;
}

function bitmapOutputValue(format: BitmapTextFormat): string {
 return { braille: 'braille', blockElements: 'block-elements', iphoneBlocks: 'iphone-blocks', emoji: 'emoji', binary: 'binary', hex: 'hex' }[format];
}

function queryOutputLabel(query: UnicodeQuery, fallback: DeconstructionFormat, defaults: RenderDefaults): string {
 if (query.representation === 'glyph') { return 'glyph / symbol'; }
 if (query.representation === 'codepoint') { return 'code point reference'; }
 if (query.representation === 'htmlEntity') { return 'HTML numeric entity'; }
 if (query.representation === 'languageEscape') { return 'language-native escape'; }
 if (query.representation === 'prettyPrint') { return `${effectiveQueryOption(query, 'render', defaults)} pretty print`; }
 const output = effectiveQueryOption(query, 'render', defaults);
 if (!bitmapOutputFormat(output)) { return formatLabel(outputFormat(output, fallback)); }
 const size = effectiveQueryOption(query, 'size', defaults) ?? '32x32';
 const wrap = effectiveQueryOption(query, 'wrap', defaults) ?? 'auto';
 const compact = effectiveQueryOption(query, 'compact', defaults) ?? 'off';
 const flow = effectiveQueryOption(query, 'flow', defaults);
 const wrapDirection = effectiveQueryOption(query, 'wrap-direction', defaults);
 const d4 = effectiveQueryOption(query, 'd4', defaults);
 return `${output} bitmap · ${size} · wrap ${wrap} ${flow}/${wrapDirection} · compact ${compact} · D4 ${d4}`;
}

function isBitmapQueryOutput(query: UnicodeQuery, output: string | undefined): boolean {
 return (!query.representation || query.representation === 'prettyPrint') && !!bitmapOutputFormat(output);
}

function glyphCompatibilityNotice(entry: UnicodeEntry, targets: CompatibilityTargetSettings, unknownPolicy: CompatibilityFallbackPolicy, profiles: CompatibilityProfiles): { badge?: string; detail?: string } {
 const scalarCodepoints = Array.from(entry.character, character => character.codePointAt(0)!).filter(codepoint => codepoint !== 0xFE0E && codepoint !== 0xFE0F);
 const findings = fontCoverageFindings(scalarCodepoints, targets, profiles).concat(emojiCompatibilityFindings(entry.emojiVersion, targets, profiles));
 const badge = compatibilityWarningBadge(findings, profiles);
 const detail = compatibilityWarningText(findings);
 if (badge || detail) { return { badge, detail }; }
 if (hasCompleteFontCoverageEvidence(targets, profiles) || hasEmojiCompatibilityEvidence(entry.emojiVersion, profiles)) { return {}; }
 const unknownFindings = unknownCompatibilityFindings(targets, profiles, unknownPolicy);
 return { badge: compatibilityWarningBadge(unknownFindings, profiles) ?? unknownCompatibilityWarningBadge(unknownPolicy), detail: compatibilityWarningText(unknownFindings) ?? unknownCompatibilityWarningText(unknownPolicy) };
}

async function renderQueryOutput(entry: UnicodeEntry, entries: UnicodeEntry[], query: UnicodeQuery, fallback: DeconstructionFormat, defaults: RenderDefaults, context: vscode.ExtensionContext, leadingText: string): Promise<string> {
 const output = effectiveQueryOption(query, 'render', defaults);
 const presentation = vscode.workspace.getConfiguration('youhavecode').get<EmojiPresentation>('emojiPresentation', 'auto');
 if (query.representation && query.representation !== 'prettyPrint') {
  return renderCompletionOutput(entry.character, entries, query, output, fallback, presentation, vscode.window.activeTextEditor?.document.languageId ?? 'plaintext');
 }
 const bitmapFormat = bitmapOutputFormat(output);
 const character = applyEmojiPresentation(entry.character, presentation);
 if (!bitmapFormat) { return renderUnicode(entry.character, entries, outputFormat(output, fallback), presentation); }
 const sizeMatch = /^(\d{1,3})x\1$/.exec(effectiveQueryOption(query, 'size', defaults) ?? '');
 const size = sizeMatch ? Math.min(128, Math.max(8, Number(sizeMatch[1]))) : 32;
 const compact = effectiveQueryOption(query, 'compact', defaults) === 'on';
 const d4 = effectiveQueryOption(query, 'd4', defaults) as BitmapD4;
 const flow = effectiveQueryOption(query, 'flow', defaults);
 const wrap = effectiveQueryOption(query, 'wrap-direction', defaults);
 const layout = flow === 'auto' ? transformLayout(d4) : { flow: flow as BitmapFlowDirection, wrap: wrap as BitmapWrapDirection };
 const wrapOption = effectiveQueryOption(query, 'wrap', defaults);
 const wrapLimit = wrapOption === 'none' || wrapOption === 'glyph' ? undefined : /^\d+$/.test(wrapOption ?? '') ? Number(wrapOption) : vscode.workspace.getConfiguration('editor').get('wordWrapColumn', 80);
 const bitmap = await textToBitmap(character, size, bitmapFormat, { compact, maxExtent: wrapLimit, oneGlyphPerGroup: wrapOption === 'glyph', flowDirection: layout.flow, wrapDirection: layout.wrap, d4, emojiArtRasterizer: rasterizeEmojiArt }, bitmapRasterizer(defaults.mapping));
 return startBitmapOnNewLine(bitmap, leadingText);
}

function effectiveQueryOption(query: UnicodeQuery, key: 'render' | 'size' | 'wrap' | 'compact' | 'flow' | 'wrap-direction' | 'd4', defaults: RenderDefaults): string {
 if (key === 'render' && query.representation === 'prettyPrint') { return bitmapOutputFormat(defaults.render) ? defaults.render : 'braille'; }
 return queryOption(query, key) ?? defaults[key];
}

function resolvedBitmapLayout(defaults: RenderDefaults): { flowDirection: BitmapFlowDirection; wrapDirection: BitmapWrapDirection; d4: BitmapD4 } {
 const d4 = defaults.d4 as BitmapD4;
 const layout = defaults.flow === 'auto' ? transformLayout(d4) : { flow: defaults.flow as BitmapFlowDirection, wrap: defaults['wrap-direction'] as BitmapWrapDirection };
 return { flowDirection: layout.flow, wrapDirection: layout.wrap, d4 };
}

function bitmapFlowExtent(size: number, format: BitmapTextFormat, d4: BitmapD4, flow: BitmapFlowDirection): number {
 const dimensions = bitmapTextDimensions(size, format);
 const swapsAxes = d4 === 'rotate-90' || d4 === 'rotate-270' || d4.startsWith('reflect-');
 const width = swapsAxes ? dimensions.rows : dimensions.columns;
 const height = swapsAxes ? dimensions.columns : dimensions.rows;
 return flow === 'lr' || flow === 'rl' ? width : height;
}

function bitmapRasterizer(mapping: string | undefined) { return mapping === 'baseline-tight' ? rasterizeGlyphBaselineTight : mapping === 'baseline' ? rasterizeGlyphBaseline : rasterizeGlyph; }

function bitmapRasterizerForFamily(mapping: string | undefined, character: string, family: string, size: number): string[] {
 return mapping === 'baseline-tight' ? rasterizeGlyphBaselineTightForFamily(character, family, size)
  : mapping === 'baseline' ? rasterizeGlyphBaselineForFamily(character, family, size)
  : rasterizeGlyphForFamily(character, family, size);
}

function configuredRenderDefaults(context: vscode.ExtensionContext): RenderDefaults {
 const configuration = vscode.workspace.getConfiguration('youhavecode');
 const sizeInspection = configuration.inspect<number>('bitmapSize');
 const explicitSize = sizeInspection?.workspaceFolderValue ?? sizeInspection?.workspaceValue ?? sizeInspection?.globalValue;
 const size = explicitSize ?? context.globalState.get('brailleRasterSize', configuration.get('bitmapSize', 32));
 const wrapLimit = configuration.get<number>('bitmapWrapLimit', 0);
 return {
  render: configuration.get('defaultOutput', 'glyph'),
  size: `${size}x${size}`,
  wrap: wrapLimit === -2 ? 'glyph' : wrapLimit < 0 ? 'none' : wrapLimit > 0 ? String(wrapLimit) : 'auto',
  compact: configuration.get('bitmapCompact', true) ? 'on' : 'off',
  mapping: configuration.get('bitmapGlyphMapping', 'baseline'),
  flow: configuration.get('bitmapFlowDirection', 'auto'),
  'wrap-direction': configuration.get('bitmapWrapDirection', 'auto'),
  d4: configuration.get('bitmapD4', 'identity'),
 };
}
