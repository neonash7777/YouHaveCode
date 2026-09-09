const HEADER = '0x,Name,Category,Bidi,Combining,Decomp,Lang,Block';

export interface UnicodeEntry {
 hex: string;
 character: string;
 name: string;
 category: string;
 bidi: string;
 combining: number;
 decomposition?: string;
 language: string;
 block: string;
 emoji?: boolean;
 emojiGroup?: string;
 emojiSubgroup?: string;
 emojiVersion?: string;
 emojiStatus?: string;
 searchTerms?: readonly string[];
}

export type UnicodePropertyAliases = Map<string, string>;

export function parseCompactUnicode(csv: string): UnicodeEntry[] {
 const [header, ...lines] = csv.trimEnd().split('\n');
 if (header !== HEADER) {
  throw new Error(`Unsupported Unicode data header: ${header}`);
 }

 return lines.filter(Boolean).map((line, index) => {
    const [hex, name, category, bidi, combiningText, decomposition, language, block, ...extra] = line.split(',');
    if (!hex || !name || !category || !bidi || !combiningText || !language || !block || extra.length) {
   throw new Error(`Invalid Unicode data row ${index + 2}`);
    }
  const codepoint = Number.parseInt(hex, 16);
  const combining = Number.parseInt(combiningText, 10);
  if (!Number.isInteger(codepoint) || !Number.isInteger(combining)) {
   throw new Error(`Invalid numeric value in Unicode data row ${index + 2}`);
  }
    return { hex, character: String.fromCodePoint(codepoint), name, category, bidi, combining, language, block, ...(decomposition ? { decomposition } : {}) };
 });
}

export function parseUnicodePropertyAliases(csv: string): UnicodePropertyAliases {
 const [header, ...lines] = csv.trimEnd().split('\n');
 if (header !== 'Property,Value,ShortName,Name') { throw new Error(`Unsupported Unicode property aliases header: ${header}`); }
 return new Map(lines.filter(Boolean).map((line, index) => {
  const [property, value, , name, ...extra] = line.split(',');
  if (!property || !value || !name || extra.length) { throw new Error(`Invalid Unicode property alias row ${index + 2}`); }
  return [`${property.toLowerCase()}:${value.toUpperCase()}`, name.replaceAll('_', ' ')];
 }));
}

export function parseEmojiRgi(tsv: string): UnicodeEntry[] {
 const [header, ...lines] = tsv.trimEnd().split('\n');
 if (header !== 'Codepoints\tName\tGroup\tSubgroup\tVersion\tStatus') { throw new Error(`Unsupported emoji data header: ${header}`); }
 return lines.filter(Boolean).map((line, index) => {
  const [codepoints, name, group, subgroup, version, status, ...extra] = line.split('\t');
  const normalizedCodepoints = codepoints?.trim() ?? '';
  const values = normalizedCodepoints ? normalizedCodepoints.split(/\s+/).map(value => Number.parseInt(value, 16)) : [];
  if (!values.length || values.some(value => !Number.isInteger(value)) || !name || !group || !subgroup || !version || !status || extra.length) {
   throw new Error(`Invalid emoji data row ${index + 2}`);
  }
  return {
  hex: normalizedCodepoints.replaceAll(' ', '-'), character: String.fromCodePoint(...values), name: name.toUpperCase(),
   category: 'So', bidi: 'ON', combining: 0, language: 'COMMON', block: `Emoji / ${group}`,
   emoji: true, emojiGroup: group, emojiSubgroup: subgroup, emojiVersion: version, emojiStatus: status,
   searchTerms: [group, subgroup],
  };
 });
}

export function mergeEmojiEntries(entries: readonly UnicodeEntry[], emojiEntries: readonly UnicodeEntry[]): UnicodeEntry[] {
 const merged = new Map(entries.map(entry => [entry.character, entry]));
 emojiEntries.forEach(emoji => {
  const existing = merged.get(emoji.character);
  merged.set(emoji.character, existing ? {
   ...existing,
   emoji: true,
   emojiGroup: emoji.emojiGroup,
   emojiSubgroup: emoji.emojiSubgroup,
   emojiVersion: emoji.emojiVersion,
   emojiStatus: emoji.emojiStatus,
   searchTerms: [emoji.name, ...(emoji.searchTerms ?? [])],
  } : emoji);
 });
 return [...merged.values()];
}

export function propertyValueDescription(aliases: UnicodePropertyAliases, property: string, value: string): string | undefined {
 const negated = value.startsWith('!');
 const rawValue = negated ? value.slice(1) : value;
 const name = aliases.get(`${property.toLowerCase()}:${rawValue.toUpperCase()}`);
 return name ? `${negated ? 'Not ' : ''}${name}` : undefined;
}