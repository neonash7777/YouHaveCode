export interface UsageRecord { count: number; lastUsed: number }
export interface UsageStats {
 glyphs: Record<string, UsageRecord>;
 glyphVariants: Record<string, UsageRecord>;
 tokens: Record<string, UsageRecord>;
 sequence: number;
}

export interface RankedTag { tag: string; assignments: number; group: 'recent' | 'common' | 'all' }

export const emptyUsageStats = (): UsageStats => ({ glyphs: {}, glyphVariants: {}, tokens: {}, sequence: 0 });

export function glyphVariantKey(hex: string, presentation: string): string {
 return `${hex}\u0000${presentation}`;
}

export function parseGlyphVariantKey(key: string): { hex: string; presentation?: string } {
 const separator = key.indexOf('\u0000');
 return separator < 0 ? { hex: key } : { hex: key.slice(0, separator), presentation: key.slice(separator + 1) };
}

export function recordGlyph(stats: UsageStats, hex: string, presentation = 'auto'): UsageStats {
 const aggregate = record(stats, 'glyphs', hex);
 return record(aggregate, 'glyphVariants', glyphVariantKey(hex, presentation));
}

export function recordTokens(stats: UsageStats, tokens: readonly string[]): UsageStats {
 return tokens.reduce((next, token) => record(next, 'tokens', token), stats);
}

export function recentFilterValues(stats: UsageStats, key: string, limit = 5): string[] {
 const prefix = `(${key}=`;
 return rankedKeys(stats.tokens)
  .filter(token => token.startsWith(prefix) && token.endsWith(')'))
  .flatMap(token => token.slice(prefix.length, -1).split('|'))
  .filter((value, index, values) => values.indexOf(value) === index)
  .slice(0, limit);
}

export function recentOutputValue(stats: UsageStats): string | undefined {
 const token = rankedKeys(stats.tokens).find(value => /^\((?:output|render)=/.test(value));
 const value = token?.slice(token.indexOf('=') + 1, -1);
 return value && value !== 'glyph' ? value : undefined;
}

export function orderFilterValues(values: readonly string[], recent: readonly string[]): string[] {
 const available = new Set(values);
 const recentValues = recent.filter(value => available.has(value));
 const remaining = values.filter(value => !recentValues.includes(value));
 const positive = remaining.filter(value => !value.startsWith('!')).sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
 const negative = remaining.filter(value => value.startsWith('!')).sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
 return [...recentValues, ...positive, ...negative];
}

export function rankGlyphHexes(stats: UsageStats, mode: 'recent' | 'frequent'): string[] {
 return Object.entries(stats.glyphs)
  .sort(([, left], [, right]) => mode === 'recent'
   ? right.lastUsed - left.lastUsed
   : right.count - left.count || right.lastUsed - left.lastUsed)
  .map(([hex]) => hex);
}

export function rankGlyphVariants(stats: UsageStats, mode: 'recent' | 'frequent'): string[] {
 return Object.entries(stats.glyphVariants ?? {})
  .sort(([, left], [, right]) => mode === 'recent'
   ? right.lastUsed - left.lastUsed
   : right.count - left.count || right.lastUsed - left.lastUsed)
  .map(([key]) => key);
}

export function resetUsageStats(): UsageStats { return emptyUsageStats(); }

export function recordUsageValue(records: Readonly<Record<string, UsageRecord>>, key: string): Record<string, UsageRecord> {
 const lastUsed = Math.max(0, ...Object.values(records).map(record => record.lastUsed)) + 1;
 return { ...records, [key]: { count: (records[key]?.count ?? 0) + 1, lastUsed } };
}

export function rankCustomTags(assignments: Readonly<Record<string, readonly string[]>>, usage: Readonly<Record<string, UsageRecord>>): RankedTag[] {
 const counts = new Map<string, number>();
 Object.values(assignments).flat().forEach(tag => counts.set(tag, (counts.get(tag) ?? 0) + 1));
 const all = [...counts].sort(([leftTag, leftCount], [rightTag, rightCount]) => rightCount - leftCount || leftTag.localeCompare(rightTag));
 const recent = [...all].sort(([leftTag], [rightTag]) => (usage[rightTag]?.lastUsed ?? 0) - (usage[leftTag]?.lastUsed ?? 0))
  .filter(([tag]) => usage[tag]).slice(0, 3);
 const selected = new Set(recent.map(([tag]) => tag));
 const common = all.filter(([tag]) => !selected.has(tag)).slice(0, 3);
 common.forEach(([tag]) => selected.add(tag));
 return [
  ...recent.map(([tag, assignments]) => ({ tag, assignments, group: 'recent' as const })),
  ...common.map(([tag, assignments]) => ({ tag, assignments, group: 'common' as const })),
  ...all.filter(([tag]) => !selected.has(tag)).map(([tag, assignments]) => ({ tag, assignments, group: 'all' as const })),
 ];
}

function rankedKeys(records: Record<string, UsageRecord>): string[] {
 return Object.entries(records).sort(([, left], [, right]) => right.lastUsed - left.lastUsed).map(([key]) => key);
}

function record(stats: UsageStats, bucket: 'glyphs' | 'glyphVariants' | 'tokens', key: string): UsageStats {
 const sequence = stats.sequence + 1;
 const records = { ...stats[bucket] };
 records[key] = { count: (records[key]?.count ?? 0) + 1, lastUsed: sequence };
 return { ...stats, [bucket]: records, sequence };
}
