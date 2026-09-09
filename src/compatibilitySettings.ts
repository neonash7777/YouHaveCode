export const compatibilityTargets = [
 { key: 'ios', label: 'iOS' },
 { key: 'android-aosp', label: 'Android (AOSP)' },
 { key: 'macos', label: 'macOS' },
 { key: 'windows', label: 'Windows' },
 { key: 'ubuntu', label: 'Ubuntu' },
] as const;

export type CompatibilityTarget = typeof compatibilityTargets[number]['key'];
export type CompatibilityPolicy = 'required' | 'warn' | 'permitted' | 'blocked';
export type CompatibilityFallbackPolicy = 'warn' | 'permitted' | 'unlist';
export interface CompatibilityTargetSetting { version: string; policy: CompatibilityPolicy }
export type CompatibilityTargetSettings = Record<CompatibilityTarget, CompatibilityTargetSetting>;
export interface CompatibilityFinding { target: CompatibilityTarget; label: string; configuredVersion: string; requiredVersion: string; policy: CompatibilityPolicy; reason: string }
export interface FontCoverageProfile { ranges: readonly string[]; source?: string; coverageMode?: string; fontCount?: number; codepointCount?: number }
export interface CompatibilityProfiles { schemaVersion: 1; emojiPlatformSupport: Record<string, readonly CompatibilityTargetEvidence[]>; fontCoverage?: Partial<Record<CompatibilityTarget, Record<string, FontCoverageProfile>>>; badges?: Partial<Record<CompatibilityTarget, string>> }

interface CompatibilityTargetEvidence { target: CompatibilityTarget; version: string }

export const fallbackCompatibilityProfiles: CompatibilityProfiles = {
 schemaVersion: 1,
 badges: { ios: 'Ap', 'android-aosp': 'An', macos: 'Ap', windows: 'Wi', ubuntu: 'Li' },
 fontCoverage: {},
 emojiPlatformSupport: {
  '15.0': [{ target: 'ios', version: '16.4' }, { target: 'android-aosp', version: '14' }, { target: 'macos', version: '13.3' }, { target: 'windows', version: '11-22H2' }, { target: 'ubuntu', version: '22.04' }],
  '15.1': [{ target: 'ios', version: '17.4' }, { target: 'android-aosp', version: '15' }, { target: 'macos', version: '14.4' }, { target: 'windows', version: '11-24H2' }, { target: 'ubuntu', version: '24.04' }],
  '16.0': [{ target: 'ios', version: '18.4' }, { target: 'android-aosp', version: '16' }, { target: 'macos', version: '15.4' }, { target: 'windows', version: '11-25H2' }, { target: 'ubuntu', version: '26.04' }],
 },
};

export function parseCompatibilityProfiles(json: string | Uint8Array): CompatibilityProfiles {
 const text = typeof json === 'string' ? json : new TextDecoder().decode(json);
 const parsed = JSON.parse(text) as Partial<CompatibilityProfiles>;
 const knownTargets = new Set(compatibilityTargets.map(target => target.key));
 const support = parsed.emojiPlatformSupport;
 if (parsed.schemaVersion !== 1 || !support || typeof support !== 'object') { throw new Error('Unsupported compatibility profile document.'); }
 const emojiPlatformSupport = Object.fromEntries(Object.entries(support).map(([version, evidence]) => {
  if (!/^\d+(?:\.\d+)?$/u.test(version) || !Array.isArray(evidence)) { throw new Error(`Invalid emoji support profile: ${version}`); }
  return [version, evidence.map(item => {
   if (!knownTargets.has(item.target) || typeof item.version !== 'string' || !item.version.trim()) { throw new Error(`Invalid emoji support evidence for ${version}`); }
   return { target: item.target, version: item.version.trim() };
  })];
 }));
 return { schemaVersion: 1, emojiPlatformSupport, fontCoverage: parseFontCoverage(parsed.fontCoverage, knownTargets), badges: parsed.badges };
}

function parseFontCoverage(value: CompatibilityProfiles['fontCoverage'] | undefined, knownTargets: ReadonlySet<string>): CompatibilityProfiles['fontCoverage'] {
 if (!value) { return {}; }
 return Object.fromEntries(Object.entries(value).map(([target, versions]) => {
    if (!knownTargets.has(target) || !versions || typeof versions !== 'object') { throw new Error(`Invalid font coverage target: ${target}`); }
    return [target, Object.fromEntries(Object.entries(versions).map(([version, profile]) => {
     if (!version.trim() || !profile || !Array.isArray(profile.ranges) || profile.ranges.some(range => !validRange(range))) { throw new Error(`Invalid font coverage profile: ${target}/${version}`); }
     return [version, { ...profile, ranges: profile.ranges }];
    }))];
 })) as CompatibilityProfiles['fontCoverage'];
}

export const defaultCompatibilityTargets = (): CompatibilityTargetSettings => Object.fromEntries(
 compatibilityTargets.map(({ key }) => [key, { version: 'current', policy: 'warn' }]),
) as CompatibilityTargetSettings;

export function resolveCompatibilityTargets(configured: Partial<Record<CompatibilityTarget, Partial<CompatibilityTargetSetting>>>): CompatibilityTargetSettings {
 const defaults = defaultCompatibilityTargets();
 return Object.fromEntries(compatibilityTargets.map(({ key }) => [key, {
  version: configured[key]?.version?.trim() || defaults[key].version,
  policy: configured[key]?.policy ?? defaults[key].policy,
 }])) as CompatibilityTargetSettings;
}

export function compatibilitySummary(targets: CompatibilityTargetSettings, unknownPolicy: CompatibilityFallbackPolicy, localFontPolicy: CompatibilityFallbackPolicy): string {
 const warnings = compatibilityTargets.filter(({ key }) => targets[key].policy === 'warn').length;
 return `${warnings}/${compatibilityTargets.length} warn · unknown ${unknownPolicy} · local ${localFontPolicy}`;
}

export function emojiCompatibilityFindings(emojiVersion: string | undefined, targets: CompatibilityTargetSettings, profiles: CompatibilityProfiles = fallbackCompatibilityProfiles): CompatibilityFinding[] {
 const version = normalizeEmojiVersion(emojiVersion);
 if (!version) { return []; }
 return (profiles.emojiPlatformSupport[version] ?? []).flatMap(evidence => {
  const setting = targets[evidence.target];
  if (!setting || setting.version === 'current' || setting.version === 'any' || setting.policy === 'permitted') { return []; }
  if (compareLooseVersions(setting.version, evidence.version) >= 0) { return []; }
  const label = compatibilityTargets.find(target => target.key === evidence.target)?.label ?? evidence.target;
  return [{ target: evidence.target, label, configuredVersion: setting.version, requiredVersion: evidence.version, policy: setting.policy, reason: `Emoji ${version}` }];
 });
}

export function fontCoverageFindings(codepoints: readonly number[], targets: CompatibilityTargetSettings, profiles: CompatibilityProfiles = fallbackCompatibilityProfiles): CompatibilityFinding[] {
 return compatibilityTargets.flatMap(({ key, label }) => {
  const setting = targets[key];
  const profile = profiles.fontCoverage?.[key]?.[setting.version];
  if (!setting || !profile || setting.policy === 'permitted') { return []; }
  const missing = codepoints.filter(codepoint => !rangeListContains(profile.ranges, codepoint));
  return missing.length ? [{ target: key, label, configuredVersion: setting.version, requiredVersion: 'font-cmap', policy: setting.policy, reason: `${missing.length} scalar${missing.length === 1 ? '' : 's'} missing from system font cmap` }] : [];
 });
}

export function hasCompleteFontCoverageEvidence(targets: CompatibilityTargetSettings, profiles: CompatibilityProfiles = fallbackCompatibilityProfiles): boolean {
 return compatibilityTargets.every(({ key }) => targets[key].policy === 'permitted' || !!profiles.fontCoverage?.[key]?.[targets[key].version]);
}

export function unknownCompatibilityFindings(targets: CompatibilityTargetSettings, profiles: CompatibilityProfiles = fallbackCompatibilityProfiles, policy: CompatibilityFallbackPolicy = 'warn'): CompatibilityFinding[] {
 if (policy !== 'warn') { return []; }
 return compatibilityTargets.flatMap(({ key, label }) => {
   const setting = targets[key];
   return setting.policy !== 'permitted' && !profiles.fontCoverage?.[key]?.[setting.version]
    ? [{ target: key, label, configuredVersion: setting.version, requiredVersion: 'unknown', policy: 'warn', reason: 'No bundled platform font coverage profile' }]
    : [];
 });
}

export function compatibilityWarningText(findings: readonly CompatibilityFinding[]): string | undefined {
 const warnings = findings.filter(finding => finding.policy === 'warn');
 return warnings.length ? warnings.map(finding => finding.requiredVersion === 'font-cmap' ? `${finding.label} ${finding.configuredVersion} missing font` : finding.requiredVersion === 'unknown' ? `${finding.label} ${finding.configuredVersion} no evidence` : `${finding.label} ${finding.configuredVersion}<${finding.requiredVersion}`).join(', ') : undefined;
}

export function compatibilityWarningBadge(findings: readonly CompatibilityFinding[], profiles: CompatibilityProfiles = fallbackCompatibilityProfiles): string | undefined {
 const warningTargets = new Set(findings.filter(finding => finding.policy === 'warn').map(finding => finding.target));
 const codes = [...new Set(compatibilityTargets.map(({ key }) => warningTargets.has(key) ? profiles.badges?.[key] ?? fallbackCompatibilityProfiles.badges?.[key] ?? key : '').filter(Boolean))].join('');
 return codes ? `(!${codes})` : undefined;
}

export function hasEmojiCompatibilityEvidence(emojiVersion: string | undefined, profiles: CompatibilityProfiles = fallbackCompatibilityProfiles): boolean {
 const version = normalizeEmojiVersion(emojiVersion);
 return !!version && version in profiles.emojiPlatformSupport;
}

export function unknownCompatibilityWarningBadge(policy: CompatibilityFallbackPolicy): string | undefined { return policy === 'warn' ? '(!?)' : undefined; }

export function unknownCompatibilityWarningText(policy: CompatibilityFallbackPolicy): string | undefined { return policy === 'warn' ? 'No bundled platform evidence' : undefined; }

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
