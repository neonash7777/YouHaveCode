import { rasterRowsToBraille } from './unicodeDeconstruction';
import { GlyphRasterizer, rasterizeGlyph } from './glyphRaster';

export type BitmapTextFormat = 'braille' | 'blockElements' | 'iphoneBlocks' | 'emoji' | 'binary' | 'hex';
export type BitmapFlowDirection = 'lr' | 'rl' | 'ud' | 'du';
export type BitmapWrapDirection = 'auto' | BitmapFlowDirection;
export type BitmapD4 = 'identity' | 'rotate-90' | 'rotate-180' | 'rotate-270' | 'mirror-left-right' | 'flip-top-bottom' | 'reflect-slash' | 'reflect-backslash';
export type CustomArtDelegate = 'cycle' | 'checker' | 'hash';

export interface CustomArtProfile {
 name: string;
 glyphs: string;
 emptyGlyphs: string;
 delegate: CustomArtDelegate;
}

export interface BitmapLayoutOptions {
 compact?: boolean;
 compactGap?: number;
 oneGlyphPerGroup?: boolean;
 maxExtent?: number;
 flowDirection?: BitmapFlowDirection;
 wrapDirection?: BitmapWrapDirection;
 d4?: BitmapD4;
 emojiArtRasterizer?: (character: string, size: number) => string[];
}

export function transformLayout(d4: BitmapD4): { flow: BitmapFlowDirection; wrap: BitmapFlowDirection } {
 return ({
  identity: { flow: 'lr', wrap: 'ud' }, 'rotate-90': { flow: 'ud', wrap: 'rl' }, 'rotate-180': { flow: 'rl', wrap: 'du' }, 'rotate-270': { flow: 'du', wrap: 'lr' },
  'mirror-left-right': { flow: 'rl', wrap: 'ud' }, 'flip-top-bottom': { flow: 'lr', wrap: 'du' }, 'reflect-slash': { flow: 'du', wrap: 'rl' }, 'reflect-backslash': { flow: 'ud', wrap: 'lr' },
 } as const)[d4];
}

const maxBitmapGraphemes = 256;

export function bitmapTextDimensions(rasterSize: number, format: BitmapTextFormat): { columns: number; rows: number } {
 const [pixelsAcross, pixelsDown] = format === 'braille' ? [2, 4] : format === 'blockElements' ? [2, 2] : format === 'hex' ? [4, 1] : [1, 1];
 return { columns: Math.ceil(Math.max(1, rasterSize) / pixelsAcross), rows: Math.ceil(Math.max(1, rasterSize) / pixelsDown) };
}

export function startBitmapOnNewLine(bitmap: string, textBeforeSelection: string): string {
 return textBeforeSelection.trim() ? `\n${bitmap}` : bitmap;
}

export async function textToBitmap(text: string, size: number, format: BitmapTextFormat, options: BitmapLayoutOptions = {}, rasterizer: GlyphRasterizer = rasterizeGlyph): Promise<string> {
 const glyphLines = text.split(/\r?\n/u).map(line => Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(line), part => part.segment));
 const glyphs = glyphLines.flat();
 if (glyphs.length > maxBitmapGraphemes) { throw new Error(`Bitmap output is limited to ${maxBitmapGraphemes} graphemes per selection; select a smaller range.`); }
 const rendered = glyphLines.map(() => [] as string[]);
 const horizontalFlow = options.flowDirection === undefined || options.flowDirection === 'lr' || options.flowDirection === 'rl';
 let index = 0;
 for (const [lineIndex, line] of glyphLines.entries()) {
  for (const character of line) {
  if (/^(?:\s|\u2800)+$/u.test(character)) {
    rendered[lineIndex].push(spaceBitmap(size, format, options.compact === true));
  } else {
    const raster = format === 'emoji' && options.emojiArtRasterizer
     ? transformRaster(options.emojiArtRasterizer(character, size), options.d4)
     : transformRaster(rasterizer(character, size), options.d4);
    const compactRaster = format === 'emoji'
    ? trimBlankEdges(raster.join('\n'), ' ', horizontalFlow).split('\n')
     : options.compact ? trimRasterEdges(raster, horizontalFlow) : raster;
    rendered[lineIndex].push(format === 'emoji' ? compactRaster.join('\n') : rasterRowsToText(compactRaster, format));
   }
   if (index++ % 8 === 7) { await new Promise<void>(resolve => setImmediate(resolve)); }
  }
 }
 const blanks: Record<BitmapTextFormat, string> = { braille: '⠀', blockElements: '⠀', iphoneBlocks: '□', emoji: ' ', binary: '0', hex: '0' };
 const output = composeSourceLines(rendered, blanks[format], options);
 if (format !== 'emoji') { return output; }
 const trimmed = trimBlankEdges(output.replace(/[0-9]/gu, ' '), ' ', true);
 const rows = trimmed.split('\n');
 const width = Math.max(0, ...rows.map(textDisplayWidth));
 return rows.map(line => line + ' '.repeat(Math.max(0, width - textDisplayWidth(line)))).join('\n');
}

export async function textToCustomArt(text: string, size: number, profile: CustomArtProfile, options: BitmapLayoutOptions = {}, rasterizer: GlyphRasterizer = rasterizeGlyph): Promise<string> {
  const glyphs = Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), part => part.segment).filter(character => !/^(?:\s|\u2800)+$/u.test(character));
 if (glyphs.length > maxBitmapGraphemes) { throw new Error(`Bitmap output is limited to ${maxBitmapGraphemes} graphemes per selection; select a smaller range.`); }
 const rendered: string[] = [];
 for (const [index, character] of glyphs.entries()) {
  rendered.push(rasterRowsToCustomArt(transformRaster(rasterizer(character, size), options.d4), profile));
  if (index % 8 === 7) { await new Promise<void>(resolve => setImmediate(resolve)); }
 }
 return composeBitmapText(rendered, customArtGlyphs(profile.emptyGlyphs, ' ')[0], options);
}

export function rasterRowsToCustomArt(rows: readonly string[], profile: CustomArtProfile): string {
 const foreground = customArtGlyphs(profile.glyphs, '█');
 const background = customArtGlyphs(profile.emptyGlyphs, ' ');
 const width = Math.max(0, ...rows.map(row => Array.from(row).length));
 let foregroundIndex = 0, backgroundIndex = 0;
 return rows.map((row, rowIndex) => Array.from(row, (value, columnIndex) => {
  const set = value === '1' ? foreground : background;
  const sequence = rowIndex * width + columnIndex;
  const index = profile.delegate === 'cycle' ? value === '1' ? foregroundIndex++ : backgroundIndex++
   : profile.delegate === 'checker' ? rowIndex + columnIndex
   : profile.delegate === 'hash' ? Math.imul(sequence + 1, 2654435761) >>> 0
    : 0;
  return set[index % set.length];
 }).join('')).join('\n');
}

function customArtGlyphs(value: string, fallback: string): string[] {
 const glyphs = textCells(value.replace(/[\r\n]/gu, ''));
 return glyphs.length ? glyphs : [fallback];
}

export function transformRaster(rows: readonly string[], transform: BitmapD4 = 'identity'): string[] {
 const height = rows.length;
 const width = Math.max(0, ...rows.map(row => Array.from(row).length));
 const matrix = rows.map(row => [...Array.from(row), ...Array(Math.max(0, width - Array.from(row).length)).fill('0')]);
 const outputHeight = transform === 'rotate-90' || transform === 'rotate-270' || transform.startsWith('reflect-') ? width : height;
 const outputWidth = outputHeight === width ? height : width;
 return Array.from({ length: outputHeight }, (_, row) => Array.from({ length: outputWidth }, (_, column) => {
  const [sourceRow, sourceColumn] = {
   identity: [row, column],
   'rotate-90': [height - 1 - column, row],
   'rotate-180': [height - 1 - row, width - 1 - column],
   'rotate-270': [column, width - 1 - row],
   'mirror-left-right': [row, width - 1 - column],
   'flip-top-bottom': [height - 1 - row, column],
   'reflect-slash': [height - 1 - column, width - 1 - row],
   'reflect-backslash': [column, row],
  }[transform];
  return matrix[sourceRow]?.[sourceColumn] ?? '0';
 }).join(''));
}

export function rasterRowsToText(rows: readonly string[], format: BitmapTextFormat): string {
 if (format === 'braille') { return rasterRowsToBraille(rows); }
 if (format === 'binary') { return rows.join('\n'); }
 if (format === 'hex') { return rows.map(row => Array.from({ length: Math.ceil(row.length / 4) }, (_, index) => Number.parseInt(row.slice(index * 4, (index + 1) * 4).padEnd(4, '0'), 2).toString(16)).join('')).join('\n'); }
 if (format === 'iphoneBlocks') { return rows.map(row => Array.from(row, value => value === '1' ? '■' : '□').join('')).join('\n'); }
 if (format === 'emoji') { return rows.map(row => Array.from(row, value => value === '1' ? '🔳' : '  ').join('')).join('\n'); }
 const blocks = ['⠀', '▘', '▝', '▀', '▖', '▌', '▞', '▛', '▗', '▚', '▐', '▜', '▄', '▙', '▟', '█'];
 return Array.from({ length: Math.ceil(rows.length / 2) }, (_, blockRow) => Array.from({ length: Math.ceil((rows[0]?.length ?? 0) / 2) }, (_, blockColumn) => {
    const top = rows[blockRow * 2] ?? '';
    const bottom = rows[(blockRow * 2) + 1] ?? '';
    return blocks[(top[blockColumn * 2] === '1' ? 1 : 0) | (top[(blockColumn * 2) + 1] === '1' ? 2 : 0) | (bottom[blockColumn * 2] === '1' ? 4 : 0) | (bottom[(blockColumn * 2) + 1] === '1' ? 8 : 0)];
 }).join('')).join('\n');
}

export function composeBitmapText(bitmaps: readonly string[], blank = '⠀', options: BitmapLayoutOptions = {}): string {
 const flow = options.flowDirection ?? 'lr';
 const wrap = resolveWrapDirection(flow, options.wrapDirection);
 const horizontal = flow === 'lr' || flow === 'rl';
 const gap = gapSize(options, blank);
 const prepared = bitmaps.map(bitmap => options.compact ? trimBlankEdges(bitmap, blank, horizontal) : bitmap);
 const groups: string[][] = [];
 for (const bitmap of prepared) {
   const group = groups.at(-1);
   const extent = horizontal ? bitmapWidth(bitmap) : bitmapHeight(bitmap);
   const groupExtent = group?.reduce((total, item) => total + (horizontal ? bitmapWidth(item) : bitmapHeight(item)), Math.max(0, group.length - 1)) ?? 0;
  if (!group || options.oneGlyphPerGroup || group.length > 0 && options.maxExtent !== undefined && groupExtent + gap + extent > options.maxExtent) {
    groups.push([bitmap]);
  } else {
    group.push(bitmap);
  }
 }
 if (horizontal) {
  const orderedGroups = wrap === 'du' ? groups.reverse() : groups;
  return orderedGroups.map(group => composeHorizontalGroup(flow === 'rl' ? group.reverse() : group, blank, gap)).join('\n\n');
 }
 const orderedGroups = wrap === 'rl' ? groups.reverse() : groups;
 const columns = orderedGroups.map(group => composeVerticalGroup(flow === 'du' ? group.reverse() : group, blank, gap).split('\n'));
 const height = Math.max(0, ...columns.map(lines => lines.length));
 const widths = columns.map(lines => Math.max(0, ...lines.map(textDisplayWidth)));
 return Array.from({ length: height }, (_, row) => columns.map((lines, index) => {
  const line = lines[row] ?? '';
  return line + blank.repeat(Math.max(0, widths[index] - textDisplayWidth(line)));
 }).join(blank)).join('\n');
}

function composeSourceLines(lines: readonly (readonly string[])[], blank: string, options: BitmapLayoutOptions): string {
 const renderedLines = lines.map(line => composeBitmapText(line, blank, options));
 return renderedLines.length <= 1 ? renderedLines[0] ?? '' : composeBitmapText(renderedLines, blank, { ...options, maxExtent: 0 });
}

function composeHorizontalGroup(bitmaps: readonly string[], blank: string, gap: number): string {
 const group = bitmaps.map(bitmap => bitmap.split('\n'));
  const height = Math.max(0, ...group.map(lines => lines.length));
  const widths = group.map(lines => Math.max(0, ...lines.map(textDisplayWidth)));
 return Array.from({ length: height }, (_, row) => group.map((lines, index) => {
   const line = lines[row] ?? '';
  return line + blank.repeat(Math.max(0, widths[index] - textDisplayWidth(line)));
 }).join(blank.repeat(gap))).join('\n');
}

function bitmapWidth(bitmap: string): number { return Math.max(0, ...bitmap.split('\n').map(textDisplayWidth)); }
function bitmapHeight(bitmap: string): number { return bitmap ? bitmap.split('\n').length : 0; }

function composeVerticalGroup(bitmaps: readonly string[], blank: string, gap: number): string {
 const width = Math.max(0, ...bitmaps.map(bitmapWidth));
 return bitmaps.map(bitmap => bitmap.split('\n').map(line => line + blank.repeat(Math.max(0, width - textDisplayWidth(line)))).join('\n')).join(`\n${blank.repeat(width)}\n`.repeat(gap));
}

function gapSize(options: BitmapLayoutOptions, blank: string): number { return options.compact ? options.compactGap ?? (blank === '⠀' ? 1 : 4) : 1; }
function blankBitmap(size: number, format: BitmapTextFormat): string { return rasterRowsToText(Array.from({ length: size }, () => '0'.repeat(size)), format); }
function spaceBitmap(size: number, format: BitmapTextFormat, compact: boolean): string {
 if (!compact || format !== 'braille') { return blankBitmap(size, format); }
 return Array.from({ length: 2 }, () => '⠀'.repeat(2)).join('\n');
}

function resolveWrapDirection(flow: BitmapFlowDirection, wrap: BitmapWrapDirection = 'auto'): Exclude<BitmapWrapDirection, 'auto'> {
 if ((flow === 'lr' || flow === 'rl') && (wrap === 'ud' || wrap === 'du')) { return wrap; }
 if ((flow === 'ud' || flow === 'du') && (wrap === 'lr' || wrap === 'rl')) { return wrap; }
 return flow === 'lr' || flow === 'rl' ? 'ud' : 'lr';
}

function trimBlankEdges(bitmap: string, blank: string, horizontal: boolean): string {
 const lines = bitmap.split('\n').map(textCells);
 if (lines.every(line => line.every(cell => cell === blank))) { return bitmap; }
 if (!horizontal) {
  while (lines.length && lines[0].every(cell => cell === blank)) { lines.shift(); }
  while (lines.length && lines.at(-1)!.every(cell => cell === blank)) { lines.pop(); }
  return lines.map(line => line.join('')).join('\n');
 }
 const width = Math.max(0, ...lines.map(line => line.length));
 let left = 0, right = width;
 while (left < right && lines.every(line => isBlankCell(line[left] ?? blank))) { left++; }
 while (right > left && lines.every(line => isBlankCell(line[right - 1] ?? blank))) { right--; }
 return lines.map(line => line.slice(left, right).join('')).join('\n');
}

function trimRasterEdges(rows: readonly string[], horizontal: boolean): string[] {
 if (!rows.some(row => row.includes('1'))) { return [...rows]; }
 if (!horizontal) {
  const first = rows.findIndex(row => row.includes('1'));
  let last = rows.length - 1;
  while (last >= first && !rows[last].includes('1')) { last--; }
  return rows.slice(first, last + 1);
 }
 const width = Math.max(0, ...rows.map(row => row.length));
 let left = 0, right = width;
 while (left < right && rows.every(row => row[left] !== '1')) { left++; }
 while (right > left && rows.every(row => row[right - 1] !== '1')) { right--; }
 return rows.map(row => row.slice(left, right));
}

function textCells(value: string): string[] {
 return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value), part => part.segment);
}

function isBlankCell(value: string): boolean { return value.trim() === ''; }
function textCellWidth(value: string): number {
 if (isBlankCell(value)) { return Array.from(value).length; }
 return /[\u{1F000}-\u{1FAFF}\u2600-\u27BF\uFE0F\u200D]/u.test(value) ? 2 : 1;
}
function textDisplayWidth(value: string): number { return textCells(value).reduce((total, cell) => total + textCellWidth(cell), 0); }