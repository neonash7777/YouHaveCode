import type { UnicodeEntry } from './unicodeData';

export const filterKeys = ['bidi', 'category', 'combining', 'decomp', 'lang', 'block', 'emoji'] as const;
export type FilterKey = typeof filterKeys[number];
const filterAliases: Readonly<Record<string, FilterKey>> = { bidirectional: 'bidi', decomposition: 'decomp', language: 'lang', script: 'lang' };
export const filterInputKeys = [...filterKeys, ...Object.keys(filterAliases)];
export const optionKeys = ['render', 'output', 'size', 'wrap', 'compact', 'flow', 'wrap-direction', 'd4'] as const;
export const suggestedOptionKeys = ['output', 'size', 'wrap', 'compact', 'flow', 'wrap-direction', 'd4'] as const;
export const actionKeys = ['print'] as const;
export const outputValues = ['glyph', 'components', 'unicode', 'codepoint', 'name', 'details', 'full', 'braille', 'block-elements', 'iphone-blocks', 'emoji', 'binary', 'hex'] as const;
export type OptionKey = typeof optionKeys[number];
const d4ValueAliases: Readonly<Record<string, string>> = { mirror: 'mirror-left-right', flip: 'flip-top-bottom', diagonal: 'reflect-slash', antidiagonal: 'reflect-backslash' };

export interface UnicodeFilter { key: FilterKey; value: string }
export interface UnicodeOption { key: OptionKey; value: string }
export interface UnicodeTagEdit { operation: 'add' | 'remove' | 'delete'; tag: string }
export type TriggerRepresentation = 'glyph' | 'codepoint' | 'htmlEntity' | 'languageEscape' | 'prettyPrint';
export interface UnicodeQuery {
 prefix: string;
 representation?: TriggerRepresentation;
 separator?: '-' | '_';
 expressionStart: number;
 draftStart: number;
 draft: string;
 mode: 'token' | 'filterValue' | 'optionValue' | 'tagValue' | 'glyphProperty';
 filterKey?: FilterKey;
 optionKey?: OptionKey;
 tagOperation?: UnicodeTagEdit['operation'];
 unwrappedFilter?: boolean;
 unwrappedTag?: boolean;
 glyphLiteral?: string;
 actions: string[];
 words: string[];
 filters: UnicodeFilter[];
 defaultFilters?: UnicodeFilter[];
 options: UnicodeOption[];
 tagEdits: UnicodeTagEdit[];
 tokens: string[];
}

export type DefaultFilterConfig = Partial<Record<FilterKey, string>>;

export function withDefaultFilters(query: UnicodeQuery, configured: DefaultFilterConfig, terms: readonly string[] = []): UnicodeQuery {
 const explicit = new Set(query.filters.map(filter => filter.key));
 const defaultFilters = filterKeys.flatMap(key => {
  const value = configured[key]?.trim();
  return value && !explicit.has(key) ? [{ key, value }] : [];
 });
 return { ...query, words: [...new Set([...terms.map(term => term.toUpperCase()), ...query.words])], defaultFilters };
}

export interface NameWord { value: string; count: number }
export type GlyphPropertyKey = 'name' | 'bidi' | 'combining' | 'category' | 'decomp' | 'unicode' | 'lang' | 'block' | 'emoji';
export interface GlyphPropertyExpansion { key: GlyphPropertyKey; label: string; value: string; detail: string }

const characterAliases: Readonly<Record<string, readonly string[]>> = {
 '.': ['PERIOD'],
};
const glyphPropertyAliases: Readonly<Record<string, GlyphPropertyKey>> = {
 n: 'name', name: 'name', b: 'bidi', bidi: 'bidi', bidirectional: 'bidi', c: 'combining', combining: 'combining',
 cat: 'category', category: 'category', d: 'decomp', decomp: 'decomp', decomposition: 'decomp', u: 'unicode', unicode: 'unicode', codepoint: 'unicode',
 l: 'lang', lang: 'lang', language: 'lang', block: 'block', e: 'emoji', emoji: 'emoji',
};

export function optionValues(key: OptionKey, draft: string): string[] {
 const values: Record<OptionKey, readonly string[]> = {
  render: outputValues,
  output: outputValues,
  size: ['8x8', '16x16', '24x24', '32x32', '64x64', '96x96', '128x128'],
  wrap: ['auto', '16', '32', '40', '80', '120'],
  compact: ['on', 'off'],
  flow: ['lr', 'rl', 'ud', 'du'],
  'wrap-direction': ['auto', 'lr', 'rl', 'ud', 'du'],
  d4: ['identity', 'rotate-90', 'rotate-180', 'rotate-270', 'mirror-left-right', 'flip-top-bottom', 'reflect-slash', 'reflect-backslash'],
 };
 return values[key].filter(value => value.startsWith(draft.toLowerCase()));
}

export function queryOption(query: UnicodeQuery, key: OptionKey): string | undefined {
 const keys: readonly OptionKey[] = key === 'render' || key === 'output' ? ['render', 'output'] : [key];
 return query.options.slice().reverse().find(option => keys.includes(option.key))?.value.toLowerCase();
}

export function parseUnicodeQuery(text: string, prefixes: string | readonly string[] = 'u:'): UnicodeQuery | undefined {
 const candidates = typeof prefixes === 'string' ? [prefixes] : prefixes;
 const prefix = [...candidates].sort((left, right) => right.length - left.length).reduce((selected, candidate) => {
  const selectedStart = text.lastIndexOf(selected);
  const candidateStart = text.lastIndexOf(candidate);
  const selectedEnd = selectedStart < 0 ? -1 : selectedStart + selected.length;
  const candidateEnd = candidateStart < 0 ? -1 : candidateStart + candidate.length;
  return candidateEnd > selectedEnd || candidateEnd === selectedEnd && candidate.length > selected.length ? candidate : selected;
 }, candidates[0] ?? 'u:');
 const expressionStart = text.lastIndexOf(prefix);
 if (expressionStart < 0) { return undefined; }
 const prettyPrintSuffix = prefix.startsWith('::') && text.endsWith('*');
 if (prettyPrintSuffix) { text = text.slice(0, -1); }
 const representation = prettyPrintSuffix ? 'prettyPrint' : triggerRepresentation(prefix);

 const words: string[] = [];
 const actions: string[] = [];
 const filters: UnicodeFilter[] = [];
 const options: UnicodeOption[] = [];
 const tagEdits: UnicodeTagEdit[] = [];
 const tokens: string[] = [];
 let cursor = expressionStart + prefix.length;
 while (cursor < text.length && text[cursor] === '(') {
  const close = text.indexOf(')', cursor + 1);
  if (close < 0) {
   const content = text.slice(cursor + 1);
    if (content.startsWith('--')) {
    return { prefix, representation, expressionStart, draftStart: cursor + 3, draft: content.slice(2), mode: 'tagValue', tagOperation: 'delete', actions, words, filters, options, tagEdits, tokens };
    }
   const equals = content.indexOf('=');
   if (equals >= 0) {
    const key = content.slice(0, equals).toLowerCase();
    const filterKey = canonicalFilterKey(key);
    if (filterKey) {
    return { prefix, representation, expressionStart, draftStart: cursor + equals + 2, draft: content.slice(equals + 1), mode: 'filterValue', filterKey, actions, words, filters, options, tagEdits, tokens };
    }
    const optionKey = canonicalOptionKey(key);
    if (optionKey) {
    return { prefix, representation, expressionStart, draftStart: cursor + equals + 2, draft: content.slice(equals + 1), mode: 'optionValue', optionKey, actions, words, filters, options, tagEdits, tokens };
    }
    if (key === '+' || key === '-') {
    return { prefix, representation, expressionStart, draftStart: cursor + equals + 2, draft: content.slice(equals + 1), mode: 'tagValue', tagOperation: key === '+' ? 'add' : 'remove', actions, words, filters, options, tagEdits, tokens };
    }
    return undefined;
   }
  return { prefix, representation, expressionStart, draftStart: cursor + 1, draft: content, mode: 'token', actions, words, filters, options, tagEdits, tokens };
  }

  const content = text.slice(cursor + 1, close);
  const equals = content.indexOf('=');
  if (equals >= 0) {
  const key = content.slice(0, equals).toLowerCase();
  const filterKey = canonicalFilterKey(key);
  const value = content.slice(equals + 1);
  if (!value) { return undefined; }
  if (filterKey) {
  upsertFilter(filters, { key: filterKey, value });
  upsertToken(tokens, token => token.startsWith(`(${filterKey}=`), `(${filterKey}=${filters.find(filter => filter.key === filterKey)!.value})`);
  } else if (canonicalOptionKey(key)) {
   const optionKey = canonicalOptionKey(key)!;
    const optionValue = optionKey === 'd4' ? d4ValueAliases[value.toLowerCase()] ?? value : value;
    upsertOption(options, { key: optionKey, value: optionValue });
    upsertToken(tokens, token => isOutputAliasToken(token, optionKey) || token.startsWith(`(${optionKey}=`) || token.startsWith(`(*${optionKey}=`), `(${optionKey === 'd4' ? '*' : ''}${optionKey}=${optionValue})`);
  } else if (key === '+' || key === '-') {
   upsertTagEdit(tagEdits, { operation: key === '+' ? 'add' : 'remove', tag: normalizeTag(value) });
  }
  else { return undefined; }
  } else if (content.startsWith('*') && actionKeys.includes(content.slice(1).toLowerCase() as typeof actionKeys[number])) {
   const action = content.slice(1).toLowerCase();
   if (!actions.includes(action)) { actions.push(action); }
   upsertToken(tokens, token => token === `(*${action})`, `(*${action})`);
  } else if (content.startsWith('--') && content.length > 2) {
   upsertTagEdit(tagEdits, { operation: 'delete', tag: normalizeTag(content.slice(2)) });
  } else if (content) {
   const word = content.toUpperCase();
   upsertWord(words, word);
   upsertToken(tokens, token => token.toUpperCase() === `(${word})`, `(${word.toLowerCase()})`);
  } else {
   return undefined;
  }
  cursor = close + 1;
 }

 const shorthand = text.slice(cursor);
 const tagShorthand = shorthand.match(/^([+-])(?:=)?([^)]*)\)?$/);
 if (tagShorthand) {
  const markerLength = shorthand.startsWith('+=') || shorthand.startsWith('-=') ? 2 : 1;
  return { prefix, representation, expressionStart, draftStart: cursor + markerLength, draft: tagShorthand[2], mode: 'tagValue', tagOperation: tagShorthand[1] === '+' ? 'add' : 'remove', unwrappedTag: true, actions, words, filters, options, tagEdits, tokens };
 }
 if (/[()]/.test(shorthand)) { return undefined; }
 const shorthandEquals = shorthand.indexOf('=');
 if (shorthandEquals >= 0) {
  const filterKey = canonicalFilterKey(shorthand.slice(0, shorthandEquals));
  if (!filterKey || shorthand.indexOf('=', shorthandEquals + 1) >= 0) { return undefined; }
  return { prefix, representation, expressionStart, draftStart: cursor + shorthandEquals + 1, draft: shorthand.slice(shorthandEquals + 1), mode: 'filterValue', filterKey, unwrappedFilter: true, actions, words, filters, options, tagEdits, tokens };
 }
 const propertyMarker = shorthand.indexOf('?');
 if (propertyMarker > 0) {
  const literal = shorthand.slice(0, propertyMarker);
  const propertyDraft = shorthand.slice(propertyMarker + 1);
  if (Array.from(literal).length !== 1 || propertyDraft.includes('?')) { return undefined; }
  return { prefix, representation, expressionStart, draftStart: cursor, draft: propertyDraft, mode: 'glyphProperty', glyphLiteral: literal, actions, words, filters, options, tagEdits, tokens };
 }
 const separatorMatches = [...shorthand.matchAll(/[-_]/g)];
 const separator = separatorMatches.at(-1)?.[0] as '-' | '_' | undefined;
 const parts = shorthand.split(/[-_\s]+/);
 const completedWords = parts.slice(0, -1);
 if (completedWords.some(word => !word)) { return undefined; }
 completedWords.forEach(value => {
  const word = value.toUpperCase();
  upsertWord(words, word);
  upsertToken(tokens, token => token.toUpperCase() === `(${word})`, `(${word.toLowerCase()})`);
 });
 const draft = parts.at(-1) ?? '';
 return { prefix, representation, separator, expressionStart, draftStart: text.length - draft.length, draft, mode: 'token', actions, words, filters, options, tagEdits, tokens };
}

function triggerRepresentation(prefix: string): TriggerRepresentation | undefined {
 if (prefix === '\\u*') { return 'prettyPrint'; }
 if (prefix === '\\u:') { return 'glyph'; }
 if (prefix === '\\u#') { return 'codepoint'; }
 if (prefix === '\\u&') { return 'htmlEntity'; }
 if (prefix === '\\u\\' || prefix === '\\u') { return 'languageEscape'; }
 return undefined;
}

export function shouldRetriggerAfterEdit(lineText: string, line: number, character: number, removedLength: number, insertedText: string, anchorLine: number, anchorCharacter: number, prefix = 'u:'): boolean {
 return removedLength > 0 && insertedText === '' && line === anchorLine && character >= anchorCharacter + prefix.length
  && lineText.slice(anchorCharacter, anchorCharacter + prefix.length) === prefix;
}

export function buildNameWords(entries: readonly UnicodeEntry[], customTags: Readonly<Record<string, readonly string[]>> = {}): NameWord[] {
 const counts = new Map<string, number>();
 entries.forEach(entry => {
  const words = new Set([...searchTokens(entry), ...(customTags[entry.hex] ?? []).map(tag => tag.toUpperCase())]);
  if (isEmoji(entry)) { words.add('EMOJI'); }
  words.forEach(word => counts.set(word, (counts.get(word) ?? 0) + 1));
 });
 return [...counts].map(([value, count]) => ({ value, count })).sort((left, right) => right.count - left.count || left.value.localeCompare(right.value));
}

export function literalNameWords(entries: readonly UnicodeEntry[], literal: string, customTags: Readonly<Record<string, readonly string[]>> = {}): NameWord[] {
 const entry = entries.find(candidate => candidate.character === literal);
 if (!entry) { return []; }
 const counts = new Map(buildNameWords(entries, customTags).map(word => [word.value, word.count]));
 return [...(characterAliases[literal] ?? []), ...nameTokens(entry.name)]
  .filter((word, index, words) => words.indexOf(word) === index)
  .map(value => ({ value, count: counts.get(value) ?? 0 }));
}

export function glyphPropertyExpansions(entry: UnicodeEntry, draft: string): GlyphPropertyExpansion[] {
 const normalized = draft.toLowerCase();
 const exact = glyphPropertyAliases[normalized];
 const keys = exact ? [exact] : [...new Set(Object.entries(glyphPropertyAliases).filter(([alias]) => alias.startsWith(normalized)).map(([, key]) => key))];
 return keys.map(key => {
  if (key === 'name') {
   const aliases = characterAliases[entry.character];
   const words = aliases?.length ? aliases : nameTokens(entry.name).filter(word => word !== entry.language.toUpperCase());
   const value = words.map(word => `(${word.toLowerCase()})`).join('');
   return { key, label: `Name · ${words.join(' ')}`, value, detail: `Replace with ${value}` };
  }
  if (key === 'unicode') { return { key, label: `Unicode · U+${entry.hex}`, value: entry.hex, detail: 'Replace with an exact code point search' }; }
  const filterKey = key as FilterKey;
  const property = propertyValue(entry, filterKey);
  const value = `(${filterKey}=${property})`;
  return { key, label: `${glyphPropertyLabel(key)} · ${property}`, value, detail: `Replace with ${value}` };
 });
}

export function glyphPropertyInputLabels(draft: string): string[] {
 const normalized = draft.toLowerCase();
 const exact = glyphPropertyAliases[normalized];
 if (exact) { return [`?${normalized}`]; }
 const preferredAliases: Readonly<Record<GlyphPropertyKey, string>> = {
  name: 'name', bidi: 'bidi', combining: 'combining', category: 'category', decomp: 'decomp', unicode: 'unicode', lang: 'language', block: 'block', emoji: 'emoji',
 };
 return [...new Set(Object.entries(glyphPropertyAliases).filter(([alias]) => alias.startsWith(normalized)).map(([, key]) => `?${preferredAliases[key]}`))];
}

export function matchingWords(words: readonly NameWord[], draft: string, limit = 60): NameWord[] {
 if (!draft) { return []; }
 const groupSeparator = draft.lastIndexOf('|');
 const prefix = groupSeparator >= 0 ? draft.slice(0, groupSeparator + 1).toUpperCase() : '';
 const activeDraft = groupSeparator >= 0 ? draft.slice(groupSeparator + 1) : draft;
 const negated = activeDraft.startsWith('!');
 const needle = (negated ? activeDraft.slice(1) : activeDraft).toUpperCase();
 const matches = words.filter(word => word.value.startsWith(needle)).slice(0, limit);
 return matches.map(word => ({ ...word, value: `${prefix}${negated ? '!' : ''}${word.value}` }));
}

export function topMatchingWords(entries: readonly UnicodeEntry[], query: UnicodeQuery, customTags: Readonly<Record<string, readonly string[]>> = {}, limit = 5): NameWord[] {
 const baseEntries = matchingEntries(entries, { ...query, draft: '' }, Infinity, customTags);
 const applied = new Set(query.words.flatMap(word => word.split('|').map(value => value.replace(/^!/, ''))));
 const counts = new Map<string, number>();
 baseEntries.forEach(entry => {
  const tokens = new Set([...searchTokens(entry), ...(customTags[entry.hex] ?? []).map(tag => tag.toUpperCase())]);
  if (isEmoji(entry)) { tokens.add('EMOJI'); }
  tokens.forEach(token => { if (!applied.has(token)) { counts.set(token, (counts.get(token) ?? 0) + 1); } });
 });
 return [...counts].filter(([, count]) => count > 1 && count < baseEntries.length)
  .map(([value, count]) => ({ value, count }))
  .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value))
  .slice(0, limit);
}

export function countMatchingWords(entries: readonly UnicodeEntry[], query: UnicodeQuery, words: readonly NameWord[], customTags: Readonly<Record<string, readonly string[]>> = {}): Map<string, number> {
 const baseEntries = matchingEntries(entries, { ...query, draft: '' }, Infinity, customTags);
 const positiveCounts = new Map(words.map(word => [word.value.replace(/^!/, ''), 0]));
 for (const entry of baseEntries) {
  const tokens = new Set(searchTokens(entry));
  customTags[entry.hex]?.forEach(tag => tokens.add(tag.toUpperCase()));
  if (isEmoji(entry)) { tokens.add('EMOJI'); }
  positiveCounts.forEach((count, word) => { if (matchesWord(entry, [...tokens], word)) { positiveCounts.set(word, count + 1); } });
 }
 return new Map(words.map(word => {
  const positive = positiveCounts.get(word.value.replace(/^!/, '')) ?? 0;
  return [word.value, word.value.startsWith('!') ? baseEntries.length - positive : positive];
 }));
}

export function countFilterValues(entries: readonly UnicodeEntry[], query: UnicodeQuery, key: FilterKey, values: readonly string[], customTags: Readonly<Record<string, readonly string[]>> = {}): Map<string, number> {
 const baseEntries = matchingEntries(entries, { ...query, draft: '', filters: query.filters.filter(filter => filter.key !== key), defaultFilters: query.defaultFilters?.filter(filter => filter.key !== key) }, Infinity, customTags);
 const positiveCounts = new Map<string, number>();
 baseEntries.forEach(entry => {
  const value = propertyValue(entry, key).toUpperCase();
  positiveCounts.set(value, (positiveCounts.get(value) ?? 0) + 1);
 });
 return new Map(values.map(value => {
  const positive = positiveCounts.get(value.replace(/^!/, '').toUpperCase()) ?? 0;
  return [value, value.startsWith('!') ? baseEntries.length - positive : positive];
 }));
}

export function matchingEntries(entries: readonly UnicodeEntry[], query: UnicodeQuery, limit = 100, customTags: Readonly<Record<string, readonly string[]>> = {}): UnicodeEntry[] {
 const draft = query.draft.toUpperCase();
 const negatedDraft = draft.startsWith('!');
 const draftValue = negatedDraft ? draft.slice(1) : draft;
 const literalGlyph = repeatedGlyphLiteral(query.draft);
 const rankOrGroups = query.words.some(word => word.includes('|'));
 const matches: Array<{ entry: UnicodeEntry; index: number; score: number[] }> = [];
 for (const entry of entries) {
  const tokens = [...searchTokens(entry), ...(customTags[entry.hex] ?? []).map(tag => tag.toUpperCase())];
  if (!query.words.every(word => matchesWord(entry, tokens, word)) || ![...(query.defaultFilters ?? []), ...query.filters].every(filter => matchesFilter(entry, filter))) { continue; }
  if (draft) {
   const draftMatches = draftValue === 'EMOJI' ? isEmoji(entry) : tokens.some(token => token.startsWith(draftValue))
    || !negatedDraft && (entry.hex.startsWith(draftValue) || entry.character === literalGlyph);
   if (negatedDraft ? draftMatches : !draftMatches) { continue; }
  }
  matches.push({ entry, index: matches.length, score: query.words.map(word => word.split('|').filter(alternative => matchesWord(entry, tokens, alternative)).length) });
  if (!rankOrGroups && matches.length === limit) { break; }
 }
 if (rankOrGroups) {
  matches.sort((left, right) => {
   for (let index = 0; index < left.score.length; index++) {
    const difference = right.score[index] - left.score[index];
    if (difference) { return difference; }
   }
   return left.index - right.index;
  });
 }
 return matches.slice(0, limit).map(match => match.entry);
}

export function initialEntries(entries: readonly UnicodeEntry[], recentHexes: readonly string[], limit = 20): UnicodeEntry[] {
 const byHex = new Map(entries.map(entry => [entry.hex, entry]));
 const recent = recentHexes.slice(0, limit).flatMap(hex => byHex.get(hex) ?? []);
 return recent.length ? recent : entries.slice(0, limit);
}

export function applyCustomTagEdits(customTags: Readonly<Record<string, readonly string[]>>, hex: string, edits: readonly UnicodeTagEdit[]): Record<string, string[]> {
 const updated = Object.fromEntries(Object.entries(customTags).map(([key, tags]) => [key, [...tags]]));
 for (const edit of edits) {
  if (edit.operation === 'delete') {
   Object.entries(updated).forEach(([key, tags]) => {
    const remaining = tags.filter(tag => tag !== edit.tag);
    if (remaining.length) { updated[key] = remaining; } else { delete updated[key]; }
   });
   continue;
  }
  const tags = new Set(updated[hex] ?? []);
  if (edit.operation === 'add') { tags.add(edit.tag); } else { tags.delete(edit.tag); }
  if (tags.size) { updated[hex] = [...tags].sort(); } else { delete updated[hex]; }
 }
 return updated;
}

export function filterValues(entries: readonly UnicodeEntry[], key: FilterKey, draft: string): string[] {
 const negated = draft.startsWith('!');
 const needle = (negated ? draft.slice(1) : draft).toUpperCase();
 const values = [...new Set(entries.map(entry => propertyValue(entry, key)))]
  .filter(value => value.toUpperCase().startsWith(needle))
  .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
 return negated ? values.map(value => `!${value}`) : [...values, ...values.map(value => `!${value}`)];
}

function matchesWord(entry: UnicodeEntry, tokens: readonly string[], word: string): boolean {
 if (word.includes('|')) { return word.split('|').filter(Boolean).some(alternative => matchesWord(entry, tokens, alternative)); }
 const negated = word.startsWith('!');
 const expected = negated ? word.slice(1) : word;
 const matches = expected === 'EMOJI' ? isEmoji(entry) : tokens.includes(expected);
 return negated ? !matches : matches;
}

function matchesFilter(entry: UnicodeEntry, filter: UnicodeFilter): boolean {
 const actual = propertyValue(entry, filter.key).toUpperCase();
 const values = filter.value.split('|').filter(Boolean);
 const positive = values.filter(value => !value.startsWith('!')).map(value => value.toUpperCase());
 const negative = values.filter(value => value.startsWith('!')).map(value => value.slice(1).toUpperCase());
 return (!positive.length || positive.includes(actual)) && !negative.includes(actual);
}

function upsertWord(words: string[], word: string): void {
 const index = words.indexOf(word);
 if (index >= 0) { words.splice(index, 1); }
 words.push(word);
}

function upsertFilter(filters: UnicodeFilter[], next: UnicodeFilter): void {
 const index = filters.findIndex(filter => filter.key === next.key);
 const values = index < 0 ? [] : filters.splice(index, 1)[0].value.split('|');
 next.value.split('|').forEach(value => {
  const existing = values.indexOf(value);
  if (existing >= 0) { values.splice(existing, 1); }
  values.push(value);
 });
 filters.push({ key: next.key, value: values.join('|') });
}

function upsertOption(options: UnicodeOption[], next: UnicodeOption): void {
 const index = options.findIndex(option => option.key === next.key || isOutputAlias(option.key, next.key));
 if (index >= 0) { options.splice(index, 1); }
 options.push(next);
}

function upsertTagEdit(edits: UnicodeTagEdit[], next: UnicodeTagEdit): void {
 const index = edits.findIndex(edit => edit.tag === next.tag);
 if (index >= 0) { edits.splice(index, 1); }
 edits.push(next);
}

function normalizeTag(value: string): string { return value.trim().toLowerCase(); }

function searchTokens(entry: UnicodeEntry): string[] {
 return [...new Set([
  ...nameTokens(entry.name),
  ...(entry.searchTerms ?? []).flatMap(nameTokens),
  ...(characterAliases[entry.character] ?? []),
 ])];
}

function isOutputAlias(left: OptionKey, right: OptionKey): boolean {
 return (left === 'render' || left === 'output') && (right === 'render' || right === 'output');
}

function isOutputAliasToken(token: string, key: OptionKey): boolean {
 return (key === 'render' || key === 'output') && /^\((?:render|output)=/.test(token);
}

function upsertToken(tokens: string[], matches: (token: string) => boolean, token: string): void {
 const index = tokens.findIndex(matches);
 if (index >= 0) { tokens.splice(index, 1); }
 tokens.push(token);
}

export function propertyValue(entry: UnicodeEntry, key: FilterKey): string {
 switch (key) {
  case 'bidi': return entry.bidi;
  case 'category': return entry.category;
  case 'combining': return String(entry.combining);
  case 'decomp': return decompositionType(entry.decomposition);
  case 'lang': return entry.language;
  case 'block': return entry.block;
  case 'emoji': return entry.emoji ? 'COLOR' : /^\p{Emoji}$/u.test(entry.character) ? 'TEXT' : 'NONE';
 }
}

function decompositionType(value?: string): string {
 if (!value) { return 'NONE'; }
 const tagged = /^<([^>]+)>/.exec(value);
 return tagged?.[1].toUpperCase() ?? 'CANONICAL';
}

function glyphPropertyLabel(key: GlyphPropertyKey): string {
 return { name: 'Name', bidi: 'Bidirectional class', combining: 'Combining class', category: 'Category', decomp: 'Decomposition', unicode: 'Unicode', lang: 'Language', block: 'Block', emoji: 'Emoji presentation' }[key];
}

function nameTokens(name: string): string[] { return name.toUpperCase().match(/[A-Z0-9]+/g) ?? []; }
function repeatedGlyphLiteral(value: string): string | undefined {
 const glyphs = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].map(segment => segment.segment.replace(/[\uFE0E\uFE0F]/gu, ''));
 return glyphs.length && glyphs.every(glyph => glyph === glyphs[0]) ? glyphs[0] : undefined;
}
function isEmoji(entry: UnicodeEntry): boolean { return entry.emoji === true; }
export function canonicalFilterKey(value: string): FilterKey | undefined {
 return filterKeys.includes(value as FilterKey) ? value as FilterKey : filterAliases[value];
}
function isOptionKey(value: string): value is OptionKey { return optionKeys.includes(value as OptionKey); }
function canonicalOptionKey(value: string): OptionKey | undefined { return isOptionKey(value) ? value : value === '*d4' || value === 'transform' ? 'd4' : undefined; }