import * as vscode from 'vscode';
import { filterKeys, outputValues, type DefaultFilterConfig, type FilterKey } from './unicodeCompletions';
import { compatibilityTargets, type CompatibilityFallbackPolicy, type CompatibilityTarget, type CompatibilityTargetSettings } from './compatibilitySettings';
import type { UnicodeEntry } from './unicodeData';
import { applyEmojiPresentation, type EmojiPresentation } from './unicodeDeconstruction';
import { parseGlyphVariantKey, rankGlyphVariants, type UsageStats } from './usageRanking';

type SidebarGroup = 'recent' | 'frequent' | 'tags' | 'properties' | 'unicodeTable' | 'unicodeTableBlock' | 'unicodeTableSubBlock' | 'unicodeTableRow' | 'prettyPrint' | 'prettyPrintOutput' | 'prettyPrintSize' | 'prettyPrintWrap' | 'prettyPrintSpacing' | 'prettyPrintMapping' | 'prettyPrintFlow' | 'prettyPrintWrapDirection' | 'prettyPrintTransform' | 'prettyPrintFormats' | 'prettyPrintSettings' | 'prettyPrintDebug' | 'prettyPrintType' | 'prettyPrintFontFamilies' | 'prettyPrintFontActive' | 'prettyPrintFontInstalled' | 'prettyPrintFontBucket' | 'tools' | 'outputFormat' | 'defaultFilters' | 'compatibility' | 'compatibilityTarget' | 'compatibilityFallback';
type PrettyPrintSetting = 'output' | 'size' | 'wrap' | 'compact' | 'mapping' | 'flow' | 'wrap-direction' | 'd4';

export interface UnicodeSidebarSource {
 entries(): Promise<readonly UnicodeEntry[]>;
 recentHexes(): readonly string[];
 recentPresentation?(hex: string): EmojiPresentation | undefined;
 emojiPresentation?(): EmojiPresentation;
 textGlyphIcon?(character: string): Promise<vscode.IconPath | undefined>;
 usage(): UsageStats;
 customTags?(): Readonly<Record<string, readonly string[]>>;
 properties?(): ReadonlyArray<{ key: FilterKey; label: string; description: string }>;
 defaultFilters?(): DefaultFilterConfig;
 defaultTerms?(): readonly string[];
 disabledDefaults?(): readonly string[];
 output?(): string;
 prettyPrintDefaults?(): Readonly<Record<PrettyPrintSetting, string>>;
 prettyPrintFontFamilies?(): { active: readonly string[]; available: readonly string[] };
 developerDebugMode?(): boolean;
 editorWrap?(): string;
 d4Icon?(operation: string): vscode.IconPath | undefined;
 directionIcon?(direction: string, paired?: boolean): vscode.IconPath | undefined;
 compatibility?(): { targets: CompatibilityTargetSettings; unknown: CompatibilityFallbackPolicy; localFont: CompatibilityFallbackPolicy };
}

export class UnicodeSidebarProvider implements vscode.TreeDataProvider<UnicodeSidebarItem> {
 private readonly changed = new vscode.EventEmitter<UnicodeSidebarItem | UnicodeSidebarItem[] | undefined>();
 private readonly prettyPrintHeaders = new Map<PrettyPrintSetting, UnicodeSidebarItem>();
 readonly onDidChangeTreeData = this.changed.event;

 constructor(private readonly source: UnicodeSidebarSource) {}

 refresh(): void { this.changed.fire(undefined); }
 refreshPrettyPrintSetting(setting: PrettyPrintSetting): void {
  const item = this.prettyPrintHeaders.get(setting);
  if (!item) { this.refresh(); return; }
  const defaults = this.source.prettyPrintDefaults?.() ?? defaultPrettyPrintDefaults;
  item.description = prettyPrintHeaderDescription(setting, defaults[setting]);
  item.id = `youhavecode.prettyPrint.${setting}.${defaults[setting]}`;
  this.changed.fire(item);
 }
 refreshPrettyPrintHeaders(): void {
  if (!this.prettyPrintHeaders.size) { this.refresh(); return; }
  const defaults = this.source.prettyPrintDefaults?.() ?? defaultPrettyPrintDefaults;
  const headers = [...this.prettyPrintHeaders].map(([setting, item]) => {
   item.description = prettyPrintHeaderDescription(setting, defaults[setting]);
    item.id = `youhavecode.prettyPrint.${setting}.${defaults[setting]}`;
   return item;
  });
  this.changed.fire(headers);
 }
 getTreeItem(item: UnicodeSidebarItem): vscode.TreeItem { return item; }

 async getChildren(item?: UnicodeSidebarItem): Promise<UnicodeSidebarItem[]> {
  if (!item) {
   const currentOutput = outputLabel(this.source.output?.() ?? 'glyph');
   const outputFormat = group('Output Format', `Currently set to ${currentOutput}`, 'symbol-string', 'outputFormat');
   outputFormat.description = currentOutput;
   return [
        action('Search and Insert', undefined, 'search', 'youhavecode.insertGlyph'),
    group('Recent', 'Recently inserted glyphs', 'history', 'recent'),
    group('Frequent', 'Most-used glyphs', 'graph', 'frequent'),
  outputFormat,
        group('Tags', 'Search and assign custom tags', 'tag', 'tags'),
        group('Properties', 'Search Unicode properties', 'symbol-property', 'properties'),
      group('Unicode Table', 'Browse every Unicode entry by block, page, row, and glyph', 'table', 'unicodeTable'),
    group('Pretty Print', 'Convert selected Unicode text', 'symbol-color', 'prettyPrint'),
      group('Default Filters', 'Manage persistent property and search-term defaults', 'filter', 'defaultFilters'),
    group('Tools', 'Output and extension settings', 'tools', 'tools'),
   ];
  }
    if (item.group === 'tags') {
     const entries = await this.source.entries();
     const byHex = new Map(entries.map(entry => [entry.hex, entry]));
     const assignments = this.source.customTags?.() ?? {};
     const tags = new Map<string, string[]>();
    Object.entries(assignments).forEach(([hex, values]) => values.forEach(tag => tags.set(tag, [...(tags.get(tag) ?? []), hex])));
    tags.forEach(hexes => hexes.sort((left, right) => Number.parseInt(left, 16) - Number.parseInt(right, 16)));
     return [
      action('Create or Add Tag…', 'Create a tag and assign it to a glyph', 'add', 'youhavecode.createSidebarTag'),
      ...[...tags].sort(([left], [right]) => left.localeCompare(right)).map(([tag, hexes]) => tagItem(tag, hexes, byHex, this.source.usage(), this.source.recentPresentation)),
     ];
    }
      if (item.tag) {
       const entries = await this.source.entries();
       const assignments = this.source.customTags?.() ?? {};
      return Promise.all(entries
        .filter(entry => assignments[entry.hex]?.includes(item.tag!))
        .sort((left, right) => Number.parseInt(left.hex, 16) - Number.parseInt(right.hex, 16))
       .map(async entry => {
         const presentations = variantPresentations(entry.hex, this.source.usage(), this.source.recentPresentation?.(entry.hex));
        return (await Promise.all(presentations.map(presentation => glyphs(entry, undefined, false, item.tag, undefined, resolvePresentation(presentation, this.source.emojiPresentation?.()), this.source.textGlyphIcon)))).flat();
       })).then(items => items.flat());
      }
    if (item.group === 'properties') {
     return (this.source.properties?.() ?? []).map(property => action(
      property.label, property.description, 'symbol-property', 'youhavecode.openInlineProperty', [property.key],
     ));
    }
  if (item.group === 'unicodeTable') {
   return tableBlocks(await this.source.entries());
  }
  if (item.group === 'unicodeTableBlock' || item.group === 'unicodeTableSubBlock' || item.group === 'unicodeTableRow') {
   const entries = (await this.source.entries()).filter(entry => item.tableBlock === undefined || entry.block === item.tableBlock)
    .filter(entry => item.tableStart === undefined || item.tableEnd === undefined || between(entryCodepoint(entry), item.tableStart, item.tableEnd));
   if (item.group === 'unicodeTableBlock') { return tableRanges(entries, 'unicodeTableSubBlock', 0x100); }
   if (item.group === 'unicodeTableSubBlock') { return tableRanges(entries, 'unicodeTableRow', 0x10); }
   return Promise.all(entries.sort(compareEntriesByCodepoint).map(entry => glyphs(entry, undefined, false, undefined, undefined, resolvePresentation(undefined, this.source.emojiPresentation?.()), this.source.textGlyphIcon))).then(items => items.flat());
  }
  if (item.group === 'prettyPrint') {
   const defaults = this.source.prettyPrintDefaults?.() ?? defaultPrettyPrintDefaults;
    const transform = prettyPrintGroup('Transform', defaults.d4, 'mirror', 'prettyPrintTransform', 'd4');
    transform.iconPath = this.source.d4Icon?.(defaults.d4) ?? transform.iconPath;
  const flow = prettyPrintGroup('Writing Direction', defaults.flow === 'auto' ? 'Auto (transform)' : flowLabel(defaults.flow), 'arrow-right', 'prettyPrintFlow', 'flow');
  if (defaults.flow !== 'auto') { flow.iconPath = this.source.directionIcon?.(defaults.flow) ?? flow.iconPath; }
  const wrapDirection = prettyPrintGroup('Wrap Direction', wrapDirectionLabel(defaults['wrap-direction']), 'arrow-swap', 'prettyPrintWrapDirection', 'wrap-direction');
  if (defaults['wrap-direction'] !== 'auto') { wrapDirection.iconPath = this.source.directionIcon?.(defaults['wrap-direction'], true) ?? wrapDirection.iconPath; }
  const headers = [
    action('Pretty Print', `Apply ${prettyPrintOutputLabel(defaults.output)} with current settings`, 'play', 'youhavecode.prettyPrintWithDefaults'),
    action('Pretty Print Image…', 'Drop an image to convert it into the current bitmap text format', 'file-media', 'youhavecode.prettyPrintImage'),
    group('Pretty Print Settings', 'Choose bitmap type, size, wrapping, spacing, flow, transform, and font precedence', 'settings', 'prettyPrintSettings'),
    ...(this.source.developerDebugMode?.() ? [group('Pretty Print Debug', 'Developer-only Pretty Print diagnostics and sweeps', 'debug', 'prettyPrintDebug')] : []),
  ];
    headers.forEach(item => { if (item.prettyPrintSetting) { this.prettyPrintHeaders.set(item.prettyPrintSetting, item); } });
    return headers;
  }
  if (item.group?.startsWith('prettyPrint') && item.prettyPrintSetting) {
   const defaults = this.source.prettyPrintDefaults?.() ?? defaultPrettyPrintDefaults;
   const setting = item.prettyPrintSetting;
    const choices = prettyPrintValues(setting, defaults.flow).map(value => {
    const selected = value === defaults[setting];
  const choice = action(prettyPrintChoiceLabel(setting, value), selected ? 'selected' : undefined, selected ? 'check' : prettyPrintIcon(setting), 'youhavecode.setSidebarPrettyPrintSetting', [setting, value]);
  if (selected) { choice.description = 'selected'; }
    if (setting === 'd4' && value !== defaults[setting]) { choice.iconPath = this.source.d4Icon?.(value) ?? choice.iconPath; }
    if ((setting === 'flow' || setting === 'wrap-direction') && value !== 'auto' && !selected) { choice.iconPath = this.source.directionIcon?.(value, setting === 'wrap-direction') ?? choice.iconPath; }
     if (setting === 'output') { choice.contextValue = 'youhavecode.prettyPrintOutputChoice'; choice.prettyPrintOutput = value; }
     return choice;
    });
      if (setting === 'size') {
       const presetSizes = prettyPrintValues('size', defaults.flow);
       if (!presetSizes.includes(defaults.size)) {
        const custom = action('Custom size…', `${defaults.size.replace('x', ' × ')} pixels`, 'check', 'youhavecode.setSidebarPrettyPrintCustomSize');
        custom.description = 'selected';
        choices.push(custom);
       } else {
        choices.push(action('Custom size…', 'Enter a square raster size from 8 through 128 pixels', 'edit', 'youhavecode.setSidebarPrettyPrintCustomSize'));
       }
      }
      if (setting === 'wrap') { choices.push(editorWrapItem(this.source.editorWrap?.())); }
     return choices;
  }
  if (item.group === 'prettyPrintType') {
   return [
    action('Braille Art', undefined, 'symbol-array', 'youhavecode.prettyPrintSelectionAs', ['braille']),
    action('Block Elements Art', undefined, 'symbol-array', 'youhavecode.prettyPrintSelectionAs', ['blockElements']),
    action('Solid Square Art', undefined, 'symbol-array', 'youhavecode.prettyPrintSelectionAs', ['iphoneBlocks']),
    action('Emoji Art', undefined, 'symbol-array', 'youhavecode.prettyPrintSelectionAs', ['emoji']),
    action('Binary Art', undefined, 'symbol-numeric', 'youhavecode.prettyPrintSelectionAs', ['binary']),
    action('Hex Art', undefined, 'symbol-number', 'youhavecode.prettyPrintSelectionAs', ['hex']),
   ];
  }
  if (item.group === 'prettyPrintSettings') {
    const defaults = this.source.prettyPrintDefaults?.() ?? defaultPrettyPrintDefaults;
    const transform = prettyPrintGroup('Transform', defaults.d4, 'mirror', 'prettyPrintTransform', 'd4');
    transform.iconPath = this.source.d4Icon?.(defaults.d4) ?? transform.iconPath;
    const flow = prettyPrintGroup('Writing Direction', defaults.flow === 'auto' ? 'Auto (transform)' : flowLabel(defaults.flow), 'arrow-right', 'prettyPrintFlow', 'flow');
    if (defaults.flow !== 'auto') { flow.iconPath = this.source.directionIcon?.(defaults.flow) ?? flow.iconPath; }
    const wrapDirection = prettyPrintGroup('Wrap Direction', wrapDirectionLabel(defaults['wrap-direction']), 'arrow-swap', 'prettyPrintWrapDirection', 'wrap-direction');
    if (defaults['wrap-direction'] !== 'auto') { wrapDirection.iconPath = this.source.directionIcon?.(defaults['wrap-direction'], true) ?? wrapDirection.iconPath; }
  const settings = [
    prettyPrintGroup('Pretty Print Type', defaults.output, 'symbol-array', 'prettyPrintOutput', 'output'),
    prettyPrintGroup('Size', defaults.size, 'symbol-ruler', 'prettyPrintSize', 'size'),
    prettyPrintGroup('Line Length', defaults.wrap, 'word-wrap', 'prettyPrintWrap', 'wrap'),
    prettyPrintGroup('Spacing', prettyPrintCompactLabel(defaults.compact), 'text-size', 'prettyPrintSpacing', 'compact'),
    prettyPrintGroup('Glyph Mapping', defaults.mapping === 'baseline-tight' ? 'Baseline Tight' : defaults.mapping === 'baseline' ? 'Baseline' : 'Square', 'symbol-text', 'prettyPrintMapping', 'mapping'),
    flow,
    wrapDirection,
    transform,
    group('Font Precedence', 'Choose and rank Pretty Print font families', 'symbol-text', 'prettyPrintFontFamilies'),
  ];
    settings.forEach(child => { if (child.prettyPrintSetting) { this.prettyPrintHeaders.set(child.prettyPrintSetting, child); } });
    return settings;
  }
  if (item.group === 'prettyPrintDebug') {
   return [
    action('Print With Font Precedence', 'Compare the active Pretty Print font precedence families', 'debug', 'youhavecode.printWithAllFonts'),
    action('Pretty Print All Sizes', 'Compare the active font precedence family at every supported size', 'symbol-ruler', 'youhavecode.prettyPrintAllSizes'),
    action('Pretty Print All Transforms', 'Compare the active font precedence family across every D4 transform', 'mirror', 'youhavecode.prettyPrintAllTransforms'),
    action('Pretty Print All Types', 'Compare the active font precedence family across every bitmap output type', 'symbol-array', 'youhavecode.prettyPrintAllTypes'),
   ];
  }
  if (item.group === 'prettyPrintFontFamilies') {
    const fonts = this.source.prettyPrintFontFamilies?.() ?? { active: [], available: [] };
    return [
     nested('Active Font Priority', 'checklist', 'prettyPrintFontActive', {}),
    nested('Installed Fonts', 'server-environment', 'prettyPrintFontInstalled', {}),
    ];
  }
    if (item.group === 'prettyPrintFontInstalled') {
     return fontBuckets((this.source.prettyPrintFontFamilies?.() ?? { active: [], available: [] }).available)
      .map(bucket => {
       const item = nested(bucket.label, 'folder', 'prettyPrintFontBucket', { fontFamilyBucket: bucket.key });
       item.id = `youhavecode.group.prettyPrintFontBucket.${bucket.key}`;
       return item;
      });
    }
    if (item.group === 'prettyPrintFontActive' || item.group === 'prettyPrintFontBucket') {
    const fonts = this.source.prettyPrintFontFamilies?.() ?? { active: [], available: [] };
    const families = item.group === 'prettyPrintFontActive'
     ? fonts.active
     : fontBuckets(fonts.available).find(bucket => bucket.key === item.fontFamilyBucket)?.families ?? [];
    const active = new Set(fonts.active.map(family => family.toLocaleLowerCase()));
    const items = families.map(family => fontFamilyItem(family, active.has(family.toLocaleLowerCase())));
    if (item.group === 'prettyPrintFontActive') {
    items.push(action('Reset to Defaults', 'Clear the Pretty Print override and restore editor.fontFamily plus known platform fallback families', 'discard', 'youhavecode.resetPrettyPrintFontFamilies'));
    }
    return items;
    }
  if (item.group === 'tools') {
   return [
    group('Compatibility', 'Configure platform versions and support policies', 'warning', 'compatibility'),
    action('Extension Settings…', 'Configure YouHaveCode', 'gear', 'workbench.action.openSettings', ['youhavecode']),
    action('Reset Usage History…', 'Clear recent and frequency rankings', 'clear-all', 'youhavecode.resetUsageHistory'),
   ];
  }
  if (item.group === 'outputFormat') {
   const current = this.source.output?.() ?? 'glyph';
   return [
    ...outputValues.map(value => action(outputLabel(value), `Set default output to ${value}`, value === current ? 'check' : prettyPrintOutputValues.includes(value) ? 'symbol-color' : 'symbol-string', 'youhavecode.setSidebarOutputFormat', [value])),
   ];
  }
  if (item.group === 'prettyPrintFormats') {
   return [
    action('Pretty Print', 'Use last bitmap settings on the selection', 'play', 'youhavecode.chooseInsertionFormat', ['lastBitmap']),
    group('Pretty Print Type', 'Choose the bitmap output type', 'symbol-array', 'prettyPrintType'),
    group('Pretty Print Settings', 'Choose bitmap size, wrapping, spacing, flow, and transform', 'settings', 'prettyPrintSettings'),
   ];
  }
  if (item.group === 'defaultFilters') {
   const configured = this.source.defaultFilters?.() ?? {};
   const terms = this.source.defaultTerms?.() ?? [];
   const disabled = new Set(this.source.disabledDefaults?.() ?? []);
   const active = [
    ...filterKeys.flatMap(key => configured[key] ? [defaultItem(`(${key}=${configured[key]})`, 'property', key, disabled.has(`property:${key}`))] : []),
    ...terms.map(term => defaultItem(`(${term})`, 'term', term, disabled.has(`term:${term.toUpperCase()}`))),
   ];
   return [
    ...active,
    action('Add Property…', 'Choose a persistent Unicode property filter', 'add', 'youhavecode.sidebarAddDefaultFilter'),
    action('Add Search Term…', 'Add an accumulating name word or custom tag', 'add', 'youhavecode.sidebarAddDefaultTerm'),
    ...(active.length ? [action('Clear All', 'Remove all default filters and terms', 'clear-all', 'youhavecode.clearDefaultFilters')] : []),
   ];
  }
  if (item.group === 'compatibility') {
   const configured = this.source.compatibility?.();
   if (!configured) { return []; }
  return [
   ...compatibilityTargets.map(({ key, label }) => {
    const targetItem = nested(`${label} · ${configured.targets[key].version} · ${configured.targets[key].policy}`, 'server-environment', 'compatibilityTarget', { target: key });
    targetItem.id = `youhavecode.group.compatibilityTarget.${key}`;
    return targetItem;
   }),
   (() => { const fallback = nested(`Unknown Evidence · ${configured.unknown}`, 'question', 'compatibilityFallback', { fallback: 'unknown' }); fallback.id = 'youhavecode.group.compatibilityFallback.unknown'; return fallback; })(),
  (() => { const fallback = nested(`Local Font · ${configured.localFont}`, 'text-size', 'compatibilityFallback', { fallback: 'localFont' }); fallback.id = 'youhavecode.group.compatibilityFallback.localFont'; return fallback; })(),
   action('Reset Defaults', 'Restore current versions and warning policies', 'discard', 'youhavecode.resetCompatibility'),
  ];
  }
  if (item.group === 'compatibilityTarget' && item.target) {
   const current = this.source.compatibility?.().targets[item.target];
   if (!current) { return []; }
   return [
    ...(['required', 'warn', 'permitted', 'blocked'] as const).map(policy => action(`Policy: ${policy}`, `Set ${item.target} policy`, policy === current.policy ? 'check' : 'shield', 'youhavecode.setCompatibilityTargetPolicy', [item.target, policy])),
    ...(['current', 'any'] as const).map(version => action(`Version: ${version}`, `Set ${item.target} version`, version === current.version ? 'check' : 'versions', 'youhavecode.setCompatibilityTargetVersion', [item.target, version])),
    action('Version: Pin…', 'Enter a specific platform version', 'pin', 'youhavecode.pinCompatibilityTargetVersion', [item.target]),
   ];
  }
  if (item.group === 'compatibilityFallback' && item.fallback) {
   const current = this.source.compatibility?.()[item.fallback === 'unknown' ? 'unknown' : 'localFont'];
  return (['warn', 'permitted', 'unlist'] as const).map(policy => action(policy, 'Set fallback policy', policy === current ? 'check' : 'shield', 'youhavecode.setCompatibilityFallbackPolicy', [item.fallback, policy]));
  }
  if (item.group === 'recent' || item.group === 'frequent') {
    const historyGroup = item.group;
   const entries = await this.source.entries();
   const byHex = new Map(entries.map(entry => [entry.hex, entry]));
    const variantKeys = historyGroup === 'recent' ? this.source.recentHexes() : rankGlyphVariants(this.source.usage(), 'frequent');
    const sidebarGlyphs = await Promise.all(variantKeys.slice(0, 20).map(async key => {
     const { hex, presentation } = parseGlyphVariantKey(key);
      return byHex.has(hex) ? await glyphs(
      byHex.get(hex)!, this.source.usage().glyphVariants?.[key]?.count ?? this.source.usage().glyphs[hex]?.count, historyGroup === 'frequent', undefined, historyGroup,
      resolvePresentation(presentation as EmojiPresentation | undefined, this.source.recentPresentation?.(hex), this.source.emojiPresentation?.()), this.source.textGlyphIcon,
      ) : [];
    })).then(items => items.flat());
    return sidebarGlyphs.length ? sidebarGlyphs : [placeholder(historyGroup === 'recent' ? 'No recent glyphs yet' : 'No usage recorded yet')];
  }
  return [];
 }
}

export class UnicodeSidebarItem extends vscode.TreeItem {
 hex?: string;
 tag?: string;
 parentTag?: string;
 historyGroup?: 'recent' | 'frequent';
 presentation?: EmojiPresentation;
 prettyPrintSetting?: PrettyPrintSetting;
 prettyPrintOutput?: string;
 defaultKind?: 'property' | 'term';
 defaultKey?: string;
 target?: CompatibilityTarget;
 fallback?: 'unknown' | 'localFont';
 fontFamily?: string;
 fontFamilyActive?: boolean;
 fontFamilyBucket?: string;
 tableBlock?: string;
 tableStart?: number;
 tableEnd?: number;
 constructor(label: string, state: vscode.TreeItemCollapsibleState, readonly group?: SidebarGroup) { super(label, state); }
}

const group = (label: string, tooltip: string, icon: string, value: SidebarGroup) => {
 const item = new UnicodeSidebarItem(label, vscode.TreeItemCollapsibleState.Collapsed, value);
 item.id = `youhavecode.group.${value}`;
 item.tooltip = tooltip;
 item.iconPath = new vscode.ThemeIcon(icon);
 item.contextValue = `youhavecode.group.${value}`;
 item.accessibilityInformation = { label: `${label}, ${tooltip}`, role: 'treeitem' };
 return item;
};

const nested = (label: string, icon: string, value: SidebarGroup, metadata: { target?: CompatibilityTarget; fallback?: 'unknown' | 'localFont'; fontFamilyBucket?: string }) => {
 const item = group(label, label, icon, value);
 Object.assign(item, metadata);
 return item;
};

const tableBlocks = (entries: readonly UnicodeEntry[]) => {
 const blocks = new Map<string, UnicodeEntry[]>();
 entries.forEach(entry => blocks.set(entry.block, [...(blocks.get(entry.block) ?? []), entry]));
 return [...blocks.entries()].sort(([, left], [, right]) => entryCodepoint(left[0]) - entryCodepoint(right[0])).map(([block, blockEntries]) => {
  const sorted = blockEntries.sort(compareEntriesByCodepoint);
  return tableNode(block, `${rangeLabel(entryCodepoint(sorted[0]), entryCodepoint(sorted.at(-1)!))} · ${blockEntries.length.toLocaleString()} glyph${blockEntries.length === 1 ? '' : 's'}`, 'symbol-class', 'unicodeTableBlock', block, entryCodepoint(sorted[0]), entryCodepoint(sorted.at(-1)!));
 });
};

const tableRanges = (entries: readonly UnicodeEntry[], group: 'unicodeTableSubBlock' | 'unicodeTableRow', size: number) => {
 const ranges = new Map<number, UnicodeEntry[]>();
 entries.forEach(entry => {
  const start = Math.floor(entryCodepoint(entry) / size) * size;
  ranges.set(start, [...(ranges.get(start) ?? []), entry]);
 });
 return [...ranges.entries()].sort(([left], [right]) => left - right).map(([start, rangeEntries]) => {
  const sorted = rangeEntries.sort(compareEntriesByCodepoint);
  const end = start + size - 1;
  return tableNode(rangeLabel(start, end), `${rangeEntries.length.toLocaleString()} glyph${rangeEntries.length === 1 ? '' : 's'} · ${sorted[0].name}..${sorted.at(-1)!.name}`, group === 'unicodeTableRow' ? 'symbol-numeric' : 'symbol-array', group, sorted[0].block, start, end);
 });
};

const tableNode = (label: string, description: string, icon: string, group: 'unicodeTableBlock' | 'unicodeTableSubBlock' | 'unicodeTableRow', block: string, start: number, end: number) => {
 const item = new UnicodeSidebarItem(label, vscode.TreeItemCollapsibleState.Collapsed, group);
 item.id = `youhavecode.table.${group}.${block}.${start.toString(16)}.${end.toString(16)}`;
 item.description = description;
 item.tooltip = `${label}, ${description}`;
 item.iconPath = new vscode.ThemeIcon(icon);
 item.contextValue = `youhavecode.group.${group}`;
 item.tableBlock = block;
 item.tableStart = start;
 item.tableEnd = end;
 item.accessibilityInformation = { label: `${label}, ${description}`, role: 'treeitem' };
 return item;
};

const entryCodepoint = (entry: UnicodeEntry) => entry.character.codePointAt(0) ?? Number.parseInt(entry.hex.split('-')[0], 16);
const compareEntriesByCodepoint = (left: UnicodeEntry, right: UnicodeEntry) => entryCodepoint(left) - entryCodepoint(right) || left.name.localeCompare(right.name);
const between = (value: number, start: number, end: number) => start <= value && value <= end;
const rangeLabel = (start: number, end: number) => `U+${start.toString(16).toUpperCase().padStart(4, '0')}..U+${end.toString(16).toUpperCase().padStart(4, '0')}`;

const defaultPrettyPrintDefaults: Readonly<Record<PrettyPrintSetting, string>> = { output: 'braille', size: '32x32', wrap: 'auto', compact: 'on', mapping: 'baseline', flow: 'auto', 'wrap-direction': 'auto', d4: 'identity' };
const prettyPrintValues = (setting: PrettyPrintSetting, flow = 'lr'): string[] => ({
  output: ['braille', 'block-elements', 'iphone-blocks', 'emoji', 'binary', 'hex'], size: ['8x8', '12x12', '16x16', '24x24', '32x32', '48x48', '64x64', '96x96', '128x128'],
 wrap: ['none', 'glyph', 'auto', '16', '32', '40', '80', '120'], compact: ['on', 'off'], mapping: ['square', 'baseline', 'baseline-tight'], flow: ['auto', 'lr', 'rl', 'ud', 'du'], 'wrap-direction': flow === 'auto' ? ['auto'] : ['auto', ...(flow === 'lr' || flow === 'rl' ? ['ud', 'du'] : ['lr', 'rl'])], d4: ['identity', 'rotate-90', 'rotate-180', 'rotate-270', 'mirror-left-right', 'flip-top-bottom', 'reflect-slash', 'reflect-backslash'],
})[setting];
const prettyPrintOutputLabel = (value: string) => ({ braille: 'Braille Art', 'block-elements': 'Block Elements Art', 'iphone-blocks': 'Solid Square Art', emoji: 'Emoji Art', binary: 'Binary Art', hex: 'Hex Art' }[value] ?? value);
const flowLabel = (value: string) => ({ lr: 'Left to right', rl: 'Right to left', ud: 'Top to bottom', du: 'Bottom to top' }[value] ?? value);
const wrapDirectionLabel = (value: string) => value === 'auto' ? 'Auto' : flowLabel(value);
const prettyPrintCompactValue = (value: string | boolean | undefined): 'on' | 'off' => value === 'off' || value === false ? 'off' : 'on';
const prettyPrintCompactLabel = (value: string | boolean | undefined): 'Compact' | 'Padded' => prettyPrintCompactValue(value) === 'on' ? 'Compact' : 'Padded';
const prettyPrintChoiceLabel = (setting: PrettyPrintSetting, value: string) => setting === 'output' ? prettyPrintOutputLabel(value)
 : setting === 'size' ? `${value.replace('x', ' × ')} pixels` : setting === 'wrap' ? value === 'none' ? 'No Wrap' : value === 'glyph' ? 'Match Glyph Size' : value === 'auto' ? 'Auto (editor column)' : `${value} text cells`
 : setting === 'compact' ? prettyPrintCompactLabel(value) : setting === 'mapping' ? value === 'square' ? 'Square' : value === 'baseline-tight' ? 'Baseline Tight' : 'Baseline' : setting === 'flow' ? value === 'auto' ? 'Auto (transform)' : flowLabel(value)
 : setting === 'wrap-direction' ? wrapDirectionLabel(value) : d4Label(value);
const d4Label = (value: string) => ({ identity: 'Identity', 'rotate-90': 'Rotate 90°', 'rotate-180': 'Rotate 180°', 'rotate-270': 'Rotate 270°', 'mirror-left-right': 'Mirror', 'flip-top-bottom': 'Flip', 'reflect-slash': 'Diagonal', 'reflect-backslash': 'AntiDiagonal' }[value] ?? value);
const prettyPrintIcon = (setting: PrettyPrintSetting) => ({ output: 'symbol-array', size: 'symbol-ruler', wrap: 'word-wrap', compact: 'text-size', mapping: 'symbol-text', flow: 'arrow-right', 'wrap-direction': 'arrow-swap', d4: 'mirror' })[setting];
const prettyPrintGroup = (label: string, value: string, icon: string, group: SidebarGroup, setting: PrettyPrintSetting) => {
 const item = nested(label, icon, group, {});
 item.id = `youhavecode.prettyPrint.${setting}.${value}`;
 item.description = prettyPrintHeaderDescription(setting, value);
 item.prettyPrintSetting = setting;
 return item;
};

const prettyPrintHeaderDescription = (setting: PrettyPrintSetting, value: string) => setting === 'output' ? prettyPrintOutputLabel(value) : prettyPrintChoiceLabel(setting, value);

const editorWrapItem = (mode?: string) => {
 const enabled = mode !== 'off' && mode !== undefined;
 const item = action('Toggle Wrapping', `Word wrapping is ${enabled ? 'on' : 'off'} for the active editor`, enabled ? 'word-wrap' : 'circle-slash', 'youhavecode.toggleEditorLineWrapping');
 item.contextValue = 'youhavecode.editorLineWrapping';
 return item;
};

const fontFamilyItem = (family: string, active: boolean) => {
 const item = action(family, active ? 'Enabled Pretty Print font family' : 'Disabled Pretty Print font family', active ? 'check' : 'circle-slash', 'youhavecode.togglePrettyPrintFontFamily', [family]);
 item.contextValue = `youhavecode.prettyPrintFontFamily.${active ? 'active' : 'disabled'}`;
 item.fontFamily = family;
 item.fontFamilyActive = active;
 return item;
};

const fontBuckets = (families: readonly string[]) => {
 const buckets = new Map<string, string[]>();
 for (const family of [...new Set(families)].sort((left, right) => left.localeCompare(right))) {
  const first = family.trim().charAt(0).toUpperCase();
  const key = /[A-Z]/u.test(first) ? first : '#+';
  buckets.set(key, [...(buckets.get(key) ?? []), family]);
 }
 return [...buckets.entries()].map(([key, bucketFamilies]) => ({ key, label: `Fonts: ${key}`, families: bucketFamilies }));
};

const action = (label: string, description: string | undefined, icon: string, command: string, args?: readonly unknown[]) => {
 const item = new UnicodeSidebarItem(label, vscode.TreeItemCollapsibleState.None);
 item.tooltip = description;
 item.iconPath = new vscode.ThemeIcon(icon);
 item.command = { command, title: label, arguments: args ? [...args] : undefined };
 item.contextValue = 'youhavecode.action';
 item.accessibilityInformation = { label: description ? `${label}, ${description}` : label, role: 'button' };
 return item;
};

const defaultItem = (label: string, kind: 'property' | 'term', key: string, disabled: boolean) => {
 const item = new UnicodeSidebarItem(label, vscode.TreeItemCollapsibleState.None);
 item.description = disabled ? 'Disabled' : undefined;
 item.tooltip = disabled ? `${label} is disabled` : `${label} is enabled`;
 item.iconPath = new vscode.ThemeIcon(disabled ? 'circle-slash' : 'filter', disabled ? new vscode.ThemeColor('disabledForeground') : undefined);
 item.contextValue = 'youhavecode.defaultItem';
 item.defaultKind = kind;
 item.defaultKey = key;
 return item;
};

const outputLabel = (value: string) => ({
 glyph: 'Glyph / symbol', components: 'Glyph components', unicode: 'JSON escapes', codepoint: 'Code points', name: 'Unicode names', details: 'Details', full: 'Full details',
 braille: 'Braille dots', 'block-elements': 'Block Elements', 'iphone-blocks': 'Solid square art', emoji: 'Emoji Art', binary: 'Binary', hex: 'Hex',
}[value] ?? value);
const prettyPrintOutputValues = ['braille', 'block-elements', 'iphone-blocks', 'emoji', 'binary', 'hex'];

const tagItem = (tag: string, hexes: readonly string[], entries: ReadonlyMap<string, UnicodeEntry>, usage: UsageStats, recentPresentation?: (hex: string) => EmojiPresentation | undefined) => {
 const glyphLabel = (hex: string) => {
  const entry = entries.get(hex);
  return entry && !entry.category.startsWith('C') && entry.character.trim() ? entry.character : `U+${hex}`;
 };
 const sampled = hexes.length <= 6 ? hexes : [...hexes.slice(0, 3), '…', ...hexes.slice(-3)];
 const count = hexes.reduce((total, hex) => total + variantPresentations(hex, usage, recentPresentation?.(hex)).length, 0);
 const description = `{${sampled.map(hex => hex === '…' ? hex : glyphLabel(hex)).join('')}} × ${count}`;
 const item = new UnicodeSidebarItem(tag, vscode.TreeItemCollapsibleState.Collapsed);
 item.description = description;
 item.tooltip = `${tag} ${description}`;
 item.iconPath = new vscode.ThemeIcon('tag');
 item.contextValue = 'youhavecode.tag';
 item.tag = tag;
 item.accessibilityInformation = { label: `${tag}, ${description}`, role: 'button' };
 return item;
};

const variantPresentations = (hex: string, usage: UsageStats, legacyPresentation?: EmojiPresentation): EmojiPresentation[] => {
 const presentations = Object.keys(usage.glyphVariants ?? {})
  .filter(key => parseGlyphVariantKey(key).hex === hex)
  .map(key => parseGlyphVariantKey(key).presentation as EmojiPresentation);
 if (legacyPresentation && !presentations.includes(legacyPresentation)) { presentations.push(legacyPresentation); }
 return presentations.length ? [...new Set(presentations)] : ['auto'];
};

const resolvePresentation = (...presentations: (EmojiPresentation | undefined)[]): EmojiPresentation =>
 presentations.find(presentation => presentation && presentation !== 'auto') ?? presentations.find(Boolean) ?? 'auto';

const glyphs = async (entry: UnicodeEntry, uses?: number, showUses = false, parentTag?: string, historyGroup?: 'recent' | 'frequent', presentation: EmojiPresentation = 'auto', textGlyphIcon?: (character: string) => Promise<vscode.IconPath | undefined>) => {
 const character = applyEmojiPresentation(entry.character, presentation);
 const displayCharacter = presentation === 'text' ? `${character}\u20E8` : character;
 const item = action(`${displayCharacter}  U+${entry.hex}`, entry.name, presentation === 'text' ? 'symbol-text' : 'symbol-character', 'youhavecode.insertGlyphByHex', [entry.hex, presentation]);
 if (presentation === 'text') { item.iconPath = await textGlyphIcon?.(entry.character) ?? item.iconPath; }
 const descriptions = [showUses ? `× ${uses ?? 0}` : undefined, entry.emoji && presentation === 'text' ? '(text)' : undefined].filter(Boolean);
 if (descriptions.length) { item.description = descriptions.join(' · '); }
 item.contextValue = parentTag ? 'youhavecode.tagGlyph' : historyGroup ? `youhavecode.${historyGroup}Glyph` : 'youhavecode.glyph';
 item.hex = entry.hex;
 item.parentTag = parentTag;
 item.historyGroup = historyGroup;
 item.presentation = presentation;
 item.tooltip = `${character}  U+${entry.hex} ${entry.name}${uses ? ` · ${uses} use${uses === 1 ? '' : 's'}` : ''}`;
 return [item];
};

const placeholder = (label: string) => {
 const item = new UnicodeSidebarItem(label, vscode.TreeItemCollapsibleState.None);
 item.iconPath = new vscode.ThemeIcon('info');
 item.contextValue = 'youhavecode.placeholder';
 return item;
};