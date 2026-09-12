import type { UnicodeEntry } from './unicodeData';

export const compatibilityTargets = [
 { key: 'macos', label: 'macOS' },
 { key: 'windows', label: 'Windows' },
 { key: 'ubuntu', label: 'Ubuntu' },
 { key: 'ios', label: 'iOS' },
 { key: 'android-aosp', label: 'Android(AOSP)' },
] as const;

export type CompatibilityTarget = typeof compatibilityTargets[number]['key'];
export type CompatibilityPolicy = 'enforced' | 'warned' | 'dismissed';
export type CompatibilityFallbackPolicy = 'warn' | 'permitted' | 'unlist';
export type CompatibilityBadgeStyle = 'symbol' | 'letter' | 'icon';

// Search words that should surface a "change compatibility" suggestion instead of a glyph result.
export const compatibilityDraftAliases: Record<string, readonly CompatibilityTarget[]> = {
 mac: ['macos'], macos: ['macos'],
 ios: ['ios'], iphone: ['ios'], ipad: ['ios'],
 apple: ['macos', 'ios'],
 android: ['android-aosp'], aosp: ['android-aosp'],
 windows: ['windows'], win: ['windows'],
 microsoft: ['windows'],
 ubuntu: ['ubuntu'], linux: ['ubuntu'],
 mobile: ['ios', 'android-aosp'],
};

export function normalizePolicy(policy: string | undefined): CompatibilityPolicy {
 const lower = policy?.toLowerCase().trim();
 if (lower === 'enforced' || lower === 'required' || lower === 'blocked') { return 'enforced'; }
 if (lower === 'dismissed' || lower === 'permitted') { return 'dismissed'; }
 return 'warned';
}

export function getTargetSymbol(target: CompatibilityTarget, isMac: boolean = typeof process !== 'undefined' && process.platform === 'darwin'): string {
 if (target === 'macos' && isMac) { return ''; }
 switch (target) {
  case 'macos': return '🍎';
  case 'windows': return '⊞';
  case 'ubuntu': return '🐧';
  case 'android-aosp': return '🤖';
  case 'ios': return '📱';
 }
}

export function getTargetCodicon(target: CompatibilityTarget): string {
 switch (target) {
  case 'ios': return 'device-mobile';
  case 'android-aosp': return 'device-mobile';
  case 'macos': return 'device-desktop';
  case 'windows': return 'device-desktop';
  case 'ubuntu': return 'terminal-linux';
 }
}

export const targetLetterBadges: Record<CompatibilityTarget, string> = {
 ios: 'iOS',
 'android-aosp': 'An',
 macos: 'Mac',
 windows: 'Wi',
 ubuntu: 'Li',
};

export interface PlatformBadgeConfig { glyph?: string; label?: string; fallback?: string; codicon?: string }
export interface CompatibilityTargetSetting { version: string; policy: CompatibilityPolicy }
export type CompatibilityTargetSettings = Record<CompatibilityTarget, CompatibilityTargetSetting>;
export interface CompatibilityFinding { target: CompatibilityTarget; label: string; configuredVersion: string; requiredVersion: string; policy: CompatibilityPolicy; reason: string }
export interface FontCoverageProfile { ranges: readonly string[]; source?: string; coverageMode?: string; fontCount?: number; codepointCount?: number }
export interface CompatibilityProfiles { schemaVersion: 1; emojiPlatformSupport: Record<string, readonly CompatibilityTargetEvidence[]>; fontCoverage?: Partial<Record<CompatibilityTarget, Record<string, FontCoverageProfile>>>; badges?: Partial<Record<CompatibilityTarget, string>>; symbols?: Partial<Record<CompatibilityTarget, string>>; platformBadges?: Partial<Record<CompatibilityTarget, PlatformBadgeConfig>> }

interface CompatibilityTargetEvidence { target: CompatibilityTarget; version: string }

export const fallbackCompatibilityProfiles: CompatibilityProfiles = {
 schemaVersion: 1,
 badges: { ios: 'iOS', 'android-aosp': 'An', macos: 'Mac', windows: 'Wi', ubuntu: 'Li' },
 symbols: { ios: '📱', 'android-aosp': '🤖', macos: '🍎', windows: '⊞', ubuntu: '🐧' },
 platformBadges: {
  macos: { glyph: '🍎', label: 'macOS', fallback: 'Mac', codicon: 'desktop-download' },
  windows: { glyph: '⊞', label: 'Windows', fallback: 'Wi', codicon: 'desktop-download' },
  ubuntu: { glyph: '🐧', label: 'Ubuntu / Linux', fallback: 'Li', codicon: 'terminal-linux' },
  'android-aosp': { glyph: '🤖', label: 'Android(AOSP)', fallback: 'An', codicon: 'device-mobile' },
  ios: { glyph: '📱', label: 'iOS / iPhone', fallback: 'iOS', codicon: 'device-mobile' },
 },
 fontCoverage: {},
 emojiPlatformSupport: {
  '15.0': [{ target: 'ios', version: '16.4' }, { target: 'android-aosp', version: '14' }, { target: 'macos', version: '13.3' }, { target: 'windows', version: '11-22H2' }, { target: 'ubuntu', version: '22.04' }],
  '15.1': [{ target: 'ios', version: '17.4' }, { target: 'android-aosp', version: '15' }, { target: 'macos', version: '14.4' }, { target: 'windows', version: '11-24H2' }, { target: 'ubuntu', version: '24.04' }],
  '16.0': [{ target: 'ios', version: '18.4' }, { target: 'android-aosp', version: '16' }, { target: 'macos', version: '15.4' }, { target: 'windows', version: '11-25H2' }, { target: 'ubuntu', version: '26.04' }],
 },
};

export function parseCompatibilityProfiles(json: string | Uint8Array): CompatibilityProfiles {
 const text = typeof json === 'string' ? json : new TextDecoder().decode(json);
 const parsed = JSON.parse(text) as Record<string, unknown>;
 const knownTargets = new Set<string>(compatibilityTargets.map(target => target.key));
 const support = parsed.emojiPlatformSupport;
 if (parsed.schemaVersion !== 1 || !support || typeof support !== 'object') { throw new Error('Unsupported compatibility profile document.'); }
 const emojiPlatformSupport = Object.fromEntries(Object.entries(support as Record<string, unknown>).map(([version, evidence]) => {
  if (!/^\d+(?:\.\d+)?$/u.test(version) || !Array.isArray(evidence)) { throw new Error(`Invalid emoji support profile: ${version}`); }
  return [version, evidence.map(item => {
   const target = normalizeTargetKey(String((item as { target?: unknown })?.target ?? ''));
   const ver = String((item as { version?: unknown })?.version ?? '').trim();
   if (!item || typeof item !== 'object' || !target || !ver) { throw new Error(`Invalid emoji support evidence for ${version}`); }
   return { target, version: ver };
  })];
 }));
 return {
  schemaVersion: 1,
  emojiPlatformSupport,
  fontCoverage: parseFontCoverage(parsed.fontCoverage, parsed.platforms, parsed.common, parsed.commonEmoji, knownTargets),
  badges: parsed.badges as Partial<Record<CompatibilityTarget, string>> | undefined,
  symbols: parsed.symbols as Partial<Record<CompatibilityTarget, string>> | undefined,
  platformBadges: parsePlatformBadges(parsed.platformBadges),
 };
}

function parsePlatformBadges(value: unknown): Partial<Record<CompatibilityTarget, PlatformBadgeConfig>> | undefined {
 if (!value || typeof value !== 'object') { return undefined; }
 const result: Partial<Record<CompatibilityTarget, PlatformBadgeConfig>> = {};
 for (const [rawKey, item] of Object.entries(value as Record<string, unknown>)) {
  const target = normalizeTargetKey(rawKey);
  if (!target || !item || typeof item !== 'object') { continue; }
  const glyph = String((item as { glyph?: unknown }).glyph ?? '').trim();
  const label = String((item as { label?: unknown }).label ?? '').trim();
  const fallback = String((item as { fallback?: unknown }).fallback ?? '').trim();
  const codicon = String((item as { codicon?: unknown }).codicon ?? '').trim();
  result[target] = { glyph, label, fallback, codicon };
 }
 return Object.keys(result).length ? result : undefined;
}

function parseFontCoverage(
 fontCoverageValue: unknown,
 platformsValue: unknown,
 commonValue: unknown,
 commonEmojiValue: unknown,
 knownTargets: ReadonlySet<string>,
): CompatibilityProfiles['fontCoverage'] {
 const commonRanges: string[] = [];
 for (const source of [commonValue, commonEmojiValue]) {
  if (Array.isArray(source)) {
   for (const item of source) {
    const range = normalizeRange(item);
    if (range) { commonRanges.push(range); }
   }
  }
 }

 const result: Partial<Record<CompatibilityTarget, Record<string, FontCoverageProfile>>> = {};

 if (fontCoverageValue && typeof fontCoverageValue === 'object') {
  for (const [targetRaw, versions] of Object.entries(fontCoverageValue as Record<string, unknown>)) {
   const target = normalizeTargetKey(targetRaw);
   if (!target || !knownTargets.has(target) || !versions || typeof versions !== 'object') {
    throw new Error(`Invalid font coverage target: ${targetRaw}`);
   }
   result[target] = result[target] ?? {};
   for (const [version, profile] of Object.entries(versions as Record<string, unknown>)) {
    if (!version.trim() || !profile || typeof profile !== 'object') {
     throw new Error(`Invalid font coverage profile: ${targetRaw}/${version}`);
    }
    const rawRanges = Array.isArray((profile as { ranges?: unknown }).ranges)
     ? (profile as { ranges: unknown[] }).ranges
     : [];
    const ranges = [...commonRanges];
    for (const item of rawRanges) {
     const range = normalizeRange(item);
     if (!range) { throw new Error(`Invalid font coverage profile: ${targetRaw}/${version}`); }
     ranges.push(range);
    }
    result[target]![version] = { ranges };
   }
  }
 }

 if (platformsValue && typeof platformsValue === 'object') {
  for (const [targetRaw, item] of Object.entries(platformsValue as Record<string, unknown>)) {
   const target = normalizeTargetKey(targetRaw);
   if (!target || !knownTargets.has(target)) { continue; }
   result[target] = result[target] ?? {};
   const rawRanges = Array.isArray(item)
    ? item
    : Array.isArray((item as { additional?: unknown }).additional)
     ? ((item as { additional: unknown[] }).additional)
     : [];
   const ranges = [...commonRanges];
   for (const entry of rawRanges) {
    const range = normalizeRange(entry);
    if (range) { ranges.push(range); }
   }
   result[target]!['current'] = { ranges };
  }
 }

 return result;
}

function normalizeTargetKey(key: string): CompatibilityTarget | undefined {
 const lower = key.toLowerCase().replace(/[^a-z0-9]/g, '');
 if (lower === 'ios') { return 'ios'; }
 if (lower === 'android' || lower === 'androidaosp' || lower === 'android-aosp') { return 'android-aosp'; }
 if (lower === 'macos' || lower === 'mac') { return 'macos'; }
 if (lower === 'windows' || lower === 'win') { return 'windows'; }
 if (lower === 'ubuntu' || lower === 'linux') { return 'ubuntu'; }
 return undefined;
}

function normalizeRange(range: unknown): string | undefined {
 if (Array.isArray(range) && range.length >= 2) {
  const start = String(range[0]).replace(/^U\+/iu, '').padStart(4, '0').toUpperCase();
  const end = String(range[1]).replace(/^U\+/iu, '').padStart(4, '0').toUpperCase();
  return `${start}..${end}`;
 }
 if (typeof range === 'object' && range !== null && 'start' in range) {
  const r = range as { start: unknown; end?: unknown };
  const start = String(r.start).replace(/^U\+/iu, '').padStart(4, '0').toUpperCase();
  const end = String(r.end ?? r.start).replace(/^U\+/iu, '').padStart(4, '0').toUpperCase();
  return `${start}..${end}`;
 }
 if (typeof range === 'string') {
  const cleaned = range.replace(/U\+/giu, '').trim();
  if (/^[0-9A-F]{4,6}(?:\.\.[0-9A-F]{4,6})?$/iu.test(cleaned)) {
   return cleaned.toUpperCase();
  }
 }
 return undefined;
}

export const defaultCompatibilityTargets = (): CompatibilityTargetSettings => Object.fromEntries(
 compatibilityTargets.map(({ key }) => [key, { version: 'current', policy: 'warned' }]),
) as CompatibilityTargetSettings;

export function resolveCompatibilityTargets(configured: Partial<Record<CompatibilityTarget, Partial<{ version?: string; policy?: string }>>>): CompatibilityTargetSettings {
 const defaults = defaultCompatibilityTargets();
 return Object.fromEntries(compatibilityTargets.map(({ key }) => [key, {
  version: configured[key]?.version?.trim() || defaults[key].version || 'current',
  policy: normalizePolicy(configured[key]?.policy ?? defaults[key].policy),
 }])) as CompatibilityTargetSettings;
}

export function compatibilitySummary(targets: CompatibilityTargetSettings, unknownPolicy: CompatibilityFallbackPolicy, localFontPolicy: CompatibilityFallbackPolicy): string {
 const counts = { enforced: 0, warned: 0, dismissed: 0 };
 for (const { key } of compatibilityTargets) {
  const policy = normalizePolicy(targets[key]?.policy);
  counts[policy]++;
 }
 return `${counts.warned} warned · ${counts.enforced} enforced · ${counts.dismissed} dismissed`;
}

export function emojiCompatibilityFindings(emojiVersion: string | undefined, targets: CompatibilityTargetSettings, profiles: CompatibilityProfiles = fallbackCompatibilityProfiles): CompatibilityFinding[] {
 const version = normalizeEmojiVersion(emojiVersion);
 if (!version) { return []; }
 return (profiles.emojiPlatformSupport[version] ?? []).flatMap(evidence => {
  const setting = targets[evidence.target];
  const policy = normalizePolicy(setting?.policy);
  if (policy === 'dismissed') { return []; }
  if (setting?.version && setting.version !== 'current' && setting.version !== 'any' && compareLooseVersions(setting.version, evidence.version) >= 0) { return []; }
  const label = compatibilityTargets.find(target => target.key === evidence.target)?.label ?? evidence.target;
  return [{ target: evidence.target, label, configuredVersion: setting?.version ?? 'current', requiredVersion: evidence.version, policy, reason: `Emoji ${version}` }];
 });
}

export function fontCoverageFindings(codepoints: readonly number[], targets: CompatibilityTargetSettings, profiles: CompatibilityProfiles = fallbackCompatibilityProfiles): CompatibilityFinding[] {
 return compatibilityTargets.flatMap(({ key, label }) => {
  const setting = targets[key];
  const policy = normalizePolicy(setting?.policy);
  if (policy === 'dismissed') { return []; }
  const profile = profiles.fontCoverage?.[key]?.[setting?.version ?? 'current'] ?? profiles.fontCoverage?.[key]?.['current'];
  if (!profile) { return []; }
  const missing = codepoints.filter(codepoint => !rangeListContains(profile.ranges, codepoint));
  return missing.length ? [{ target: key, label, configuredVersion: setting?.version ?? 'current', requiredVersion: 'font-cmap', policy, reason: `${missing.length} scalar${missing.length === 1 ? '' : 's'} missing from system font cmap` }] : [];
 });
}

export function unsupportedGlyphCount(
 entries: readonly UnicodeEntry[],
 target: CompatibilityTarget,
 profiles: CompatibilityProfiles = fallbackCompatibilityProfiles,
 targetVersion = 'current',
): number {
 const testTargets: CompatibilityTargetSettings = {
  ...defaultCompatibilityTargets(),
  [target]: { version: targetVersion, policy: 'warned' },
 };
 let count = 0;
 for (const entry of entries) {
  const scalarCodepoints = Array.from(entry.character, (char: string) => char.codePointAt(0)!).filter(codepoint => codepoint !== 0xFE0E && codepoint !== 0xFE0F);
  const fontFindings = fontCoverageFindings(scalarCodepoints, testTargets, profiles);
  const emojiFindings = emojiCompatibilityFindings(entry.emojiVersion, testTargets, profiles);
  if (fontFindings.some(f => f.target === target) || emojiFindings.some(f => f.target === target)) {
   count++;
  }
 }
 return count;
}

export function hasCompleteFontCoverageEvidence(targets: CompatibilityTargetSettings, profiles: CompatibilityProfiles = fallbackCompatibilityProfiles): boolean {
 return compatibilityTargets.every(({ key }) => normalizePolicy(targets[key]?.policy) === 'dismissed' || !!(profiles.fontCoverage?.[key]?.[targets[key]?.version ?? 'current'] ?? profiles.fontCoverage?.[key]?.['current']));
}

export function unknownCompatibilityFindings(targets: CompatibilityTargetSettings, profiles: CompatibilityProfiles = fallbackCompatibilityProfiles, policy: CompatibilityFallbackPolicy = 'warn'): CompatibilityFinding[] {
 if (policy !== 'warn') { return []; }
 return compatibilityTargets.flatMap(({ key, label }) => {
   const setting = targets[key];
   return normalizePolicy(setting?.policy) !== 'dismissed' && !(profiles.fontCoverage?.[key]?.[setting?.version ?? 'current'] ?? profiles.fontCoverage?.[key]?.['current'])
    ? [{ target: key, label, configuredVersion: setting?.version ?? 'current', requiredVersion: 'unknown', policy: 'warned', reason: 'No bundled platform font coverage profile' }]
    : [];
 });
}

export function compatibilityWarningText(findings: readonly CompatibilityFinding[]): string | undefined {
 const warnings = findings.filter(finding => normalizePolicy(finding.policy) === 'warned');
 return warnings.length ? warnings.map(finding => finding.requiredVersion === 'font-cmap' ? `${finding.label} missing font` : finding.requiredVersion === 'unknown' ? `${finding.label} no evidence` : `${finding.label} < ${finding.requiredVersion}`).join(', ') : undefined;
}

export function compatibilityWarningBadge(findings: readonly CompatibilityFinding[], profiles: CompatibilityProfiles = fallbackCompatibilityProfiles, style: CompatibilityBadgeStyle = 'symbol'): string | undefined {
 const warningTargets = new Set(findings.filter(finding => normalizePolicy(finding.policy) === 'warned').map(finding => finding.target));
 if (style === 'icon') {
  const icons = [...new Set(compatibilityTargets.filter(({ key }) => warningTargets.has(key)).map(({ key }) => getTargetCodicon(key)))];
  return icons.length ? `$(warning)(${icons.map(icon => `$(${icon})`).join('')})` : undefined;
 }
 const isMac = typeof process !== 'undefined' && process.platform === 'darwin';
 const codes = [...new Set(compatibilityTargets.map(({ key }) => {
  if (!warningTargets.has(key)) { return ''; }
  if (style === 'symbol') {
   if (key === 'macos' && isMac) { return ''; }
   const badgeConfig = profiles.platformBadges?.[key];
   if (badgeConfig?.glyph) { return badgeConfig.glyph; }
   const symbolOverride = profiles.symbols?.[key];
   if (symbolOverride && (key !== 'macos' || symbolOverride !== '🍎')) { return symbolOverride; }
   return getTargetSymbol(key, isMac);
  }
  const badgeConfig = profiles.platformBadges?.[key];
  if (badgeConfig?.fallback) { return badgeConfig.fallback; }
  return profiles.badges?.[key] ?? fallbackCompatibilityProfiles.badges?.[key] ?? targetLetterBadges[key] ?? key;
 }).filter(Boolean))].join('');
 return codes ? `(!${codes})` : undefined;
}

export function hasEmojiCompatibilityEvidence(emojiVersion: string | undefined, profiles: CompatibilityProfiles = fallbackCompatibilityProfiles): boolean {
 const version = normalizeEmojiVersion(emojiVersion);
 return !!version && version in profiles.emojiPlatformSupport;
}

export function unknownCompatibilityWarningBadge(policy: CompatibilityFallbackPolicy, style: CompatibilityBadgeStyle = 'symbol'): string | undefined {
 if (policy !== 'warn') { return undefined; }
 return style === 'icon' ? '$(warning)($(question))' : style === 'symbol' ? '(!❓)' : '(!?)';
}

export function unknownCompatibilityWarningText(policy: CompatibilityFallbackPolicy): string | undefined { return policy === 'warn' ? 'No bundled platform evidence' : undefined; }

// Per-platform status, always rendered regardless of warnings; style selects symbol/letter/icon representation.
export function compatibilityStatusBadges(findings: readonly CompatibilityFinding[], targets: CompatibilityTargetSettings, profiles: CompatibilityProfiles = fallbackCompatibilityProfiles, style: CompatibilityBadgeStyle = 'symbol'): string {
 const warningTargets = new Set(findings.filter(finding => normalizePolicy(finding.policy) === 'warned').map(finding => finding.target));
 const active = compatibilityTargets.filter(({ key }) => normalizePolicy(targets[key]?.policy) !== 'dismissed');
 if (style === 'icon') {
  return active.map(({ key, label }) => `$(${getTargetCodicon(key)}) ${label} $(${warningTargets.has(key) ? 'warning' : 'check'})`).join(' · ');
 }
 return active.map(({ key }) => {
   const badgeConfig = profiles.platformBadges?.[key];
   const symbol = style === 'symbol'
    ? badgeConfig?.glyph ?? profiles.symbols?.[key] ?? getTargetSymbol(key, false)
    : badgeConfig?.fallback ?? profiles.badges?.[key] ?? fallbackCompatibilityProfiles.badges?.[key] ?? targetLetterBadges[key] ?? key;
   return `${symbol}${warningTargets.has(key) ? '⚠' : '✓'}`;
  }).join(' ');
}

// Readable "what it has" platform list for tooltips, e.g. "macOS, iOS, Windows".
export function compatibilitySupportedNames(findings: readonly CompatibilityFinding[], targets: CompatibilityTargetSettings): string {
 const warningTargets = new Set(findings.filter(finding => normalizePolicy(finding.policy) === 'warned').map(finding => finding.target));
 return compatibilityTargets
  .filter(({ key }) => normalizePolicy(targets[key]?.policy) !== 'dismissed' && !warningTargets.has(key))
  .map(({ label }) => label)
  .join(', ');
}

function normalizeEmojiVersion(value: string | undefined): string | undefined {
 const match = /^E?(\d+(?:\.\d+)?)$/iu.exec(value?.trim() ?? '');
 return match?.[1];
}

function compareLooseVersions(left: string, right: string): number {
 const leftParts = left.match(/\d+/gu)?.map(Number) ?? [];
 const rightParts = right.match(/\d+/gu)?.map(Number) ?? [];
 for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index++) {
  const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
  if (delta) { return delta; }
 }
 return 0;
}

function validRange(range: string): boolean { return /^[0-9A-F]{4,6}(?:\.\.[0-9A-F]{4,6})?$/u.test(range); }

function rangeListContains(ranges: readonly string[], codepoint: number): boolean {
 return ranges.some(range => {
  const [start, end = start] = range.split('..');
  return Number.parseInt(start, 16) <= codepoint && codepoint <= Number.parseInt(end, 16);
 });
}
