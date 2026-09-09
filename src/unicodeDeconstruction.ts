import type { UnicodeEntry } from './unicodeData';

export type DeconstructionFormat = 'symbols' | 'components' | 'details' | 'fullDetails' | 'codepoints' | 'names' | 'jsonEscapes';
export type EmojiPresentation = 'auto' | 'color' | 'text' | 'deconstructed';

export function applyEmojiPresentation(text: string, presentation: EmojiPresentation): string {
 if (presentation === 'auto' || !/\p{Emoji}/u.test(text)) { return text; }
 const characters = Array.from(text);
 if (characters.length > 2 || characters.length === 2 && !/[\uFE0E\uFE0F]/u.test(characters[1])) { return text; }
 const base = text.replace(/[\uFE0E\uFE0F]/gu, '');
 return `${base}${presentation === 'text' ? '\uFE0E' : '\uFE0F'}`;
}

export function renderUnicode(text: string, entries: readonly UnicodeEntry[], format: DeconstructionFormat, presentation: EmojiPresentation): string {
 const presented = applyEmojiPresentation(text, presentation);
 return deconstructUnicode(presented, entries, presentation === 'deconstructed' && format === 'symbols' && /\p{Emoji}/u.test(text) ? 'components' : format);
}

export function renderCodepointReference(text: string): string {
 return Array.from(text).map(character => `U+${hexCodepoint(character.codePointAt(0)!)}`).join(' + ');
}

export function renderHtmlEntity(text: string): string {
 return Array.from(text).map(character => `&#x${hexCodepoint(character.codePointAt(0)!)};`).join('');
}

export function renderLanguageEscape(text: string, languageId: string): string {
 return Array.from(text).map(character => languageEscape(character.codePointAt(0)!, languageId)).join('');
}

export function deconstructUnicode(text: string, entries: readonly UnicodeEntry[], format: DeconstructionFormat): string {
 if (format === 'symbols') { return decodeUnicodeNotation(text); }
 const byCharacter = new Map(entries.map(entry => [entry.character, entry]));
 if (format === 'components') {
  return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)]
   .map(segment => Array.from(segment.segment.normalize('NFD')).map(character => componentLabel(character, byCharacter.get(character))).join(' + '))
   .join(' | ');
 }
 const parts = Array.from(text).map(character => {
  const codepoint = character.codePointAt(0)!;
  const hex = codepoint.toString(16).toUpperCase().padStart(4, '0');
  const entry = byCharacter.get(character);
    const name = entry?.name ?? `<UNKNOWN>`;
  switch (format) {
    case 'details': return `${character} U+${hex} ${name}`;
    case 'fullDetails': return `${character} U+${hex} ${name} (category=${entry?.category ?? 'UNKNOWN'}, bidi=${entry?.bidi ?? 'UNKNOWN'}, combining=${entry?.combining ?? 'UNKNOWN'}, decomp=${entry?.decomposition ?? 'NONE'})`;
  case 'codepoints': return `U+${hex}`;
    case 'names': return entry?.name ?? `<UNKNOWN U+${hex}>`;
  case 'jsonEscapes': return jsonEscape(codepoint);
  }
 });
 return parts.join(format === 'jsonEscapes' ? '' : ' + ');
}

function componentLabel(character: string, entry?: UnicodeEntry): string {
 const codepoint = character.codePointAt(0)!;
 if (codepoint === 0x200D) { return '<ZWJ>'; }
 if (codepoint === 0xFE0E) { return `<VARIATION SELECTOR-15 (VS15, U+FE0E)> ◌${character}`; }
 if (codepoint === 0xFE0F) { return `<VARIATION SELECTOR-16 (VS16, U+FE0F)> ◌${character}`; }
 if (entry?.category.startsWith('M') || /\p{Mark}/u.test(character)) { return `◌${character}`; }
 return character;
}

function decodeUnicodeNotation(text: string): string {
 return text
    .replace(/\\u\{([0-9a-f]{1,6})\}/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/(?:U\+|\\u)([0-9a-f]{4,6})/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)));
}

export function graphemeRangeAt(text: string, cursor: number): { start: number; end: number } | undefined {
 const segments = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)];
 const selected = segments.find(segment => cursor > segment.index && cursor <= segment.index + segment.segment.length)
  ?? segments.find(segment => segment.index === cursor);
 return selected ? { start: selected.index, end: selected.index + selected.segment.length } : undefined;
}

export function rasterRowsToBraille(rows: readonly string[]): string {
 const width = Math.max(0, ...rows.map(row => row.length));
 const dots = [[0, 0, 1], [1, 0, 2], [2, 0, 4], [3, 0, 64], [0, 1, 8], [1, 1, 16], [2, 1, 32], [3, 1, 128]] as const;
 return Array.from({ length: Math.ceil(rows.length / 4) }, (_, blockRow) => Array.from({ length: Math.ceil(width / 2) }, (_, blockColumn) => {
  let codepoint = 0x2800;
  dots.forEach(([row, column, bit]) => {
   if (rows[(blockRow * 4) + row]?.[(blockColumn * 2) + column] === '1') { codepoint += bit; }
  });
  return String.fromCodePoint(codepoint);
 }).join('')).join('\n');
}

export function replacementOffsets(targets: readonly { start: number; end: number; replacement: string }[]): { start: number; end: number }[] {
 let delta = 0;
 return [...targets].sort((left, right) => left.start - right.start).map(target => {
  const start = target.start + delta;
  const end = start + target.replacement.length;
  delta += target.replacement.length - (target.end - target.start);
  return { start, end };
 });
}

function jsonEscape(codepoint: number): string {
 if (codepoint <= 0xFFFF) { return `\\u${codepoint.toString(16).toUpperCase().padStart(4, '0')}`; }
 const value = codepoint - 0x10000;
 return `\\u${(0xD800 + (value >> 10)).toString(16).toUpperCase()}\\u${(0xDC00 + (value & 0x3FF)).toString(16).toUpperCase()}`;
}

function languageEscape(codepoint: number, languageId: string): string {
 const hex = hexCodepoint(codepoint);
 if (['javascript', 'javascriptreact', 'typescript', 'typescriptreact'].includes(languageId)) { return codepoint <= 0xFFFF ? `\\u${hex}` : `\\u{${hex}}`; }
 if (['rust', 'swift', 'php'].includes(languageId)) { return `\\u{${hex}}`; }
 if (['python', 'csharp', 'go', 'c', 'cpp'].includes(languageId)) { return codepoint <= 0xFFFF ? `\\u${hex}` : `\\U${hex.padStart(8, '0')}`; }
 if (languageId === 'css' || languageId === 'scss' || languageId === 'less') { return `\\${hex} `; }
 if (['html', 'xml', 'markdown'].includes(languageId)) { return `&#x${hex};`; }
 return jsonEscape(codepoint);
}

function hexCodepoint(codepoint: number): string {
 return codepoint.toString(16).toUpperCase().padStart(4, '0');
}