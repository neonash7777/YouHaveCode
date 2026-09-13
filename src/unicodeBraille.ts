import { rasterRowsToBraille } from './unicodeDeconstruction';
import { GlyphRasterizer, rasterizeGlyph } from './glyphRaster';

export type BitmapTextFormat = 'braille' | 'blockElements' | 'iphoneBlocks' | 'emoji' | 'binary' | 'hex' | 'zalgo';
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
 zalgoStrategy?: ZalgoStrategy;
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
 const [pixelsAcross, pixelsDown] = format === 'braille' ? [2, 4] : format === 'blockElements' ? [2, 2] : format === 'hex' ? [4, 1] : format === 'zalgo' ? [1, 4] : [1, 1];
 return { columns: Math.ceil(Math.max(1, rasterSize) / pixelsAcross), rows: Math.ceil(Math.max(1, rasterSize) / pixelsDown) };
}

export function startBitmapOnNewLine(bitmap: string, textBeforeSelection: string): string {
 return textBeforeSelection.trim() ? `\n${bitmap}` : bitmap;
}

export function safeRasterizer(rasterizer: GlyphRasterizer): GlyphRasterizer {
 return (character: string, size: number): string[] => {
  if (/^(?:\s|\u2800)+$/u.test(character)) {
   return Array.from({ length: size }, () => '0'.repeat(size));
  }
  try {
   return rasterizer(character, size);
  } catch {
   return Array.from({ length: size }, () => '0'.repeat(size));
  }
 };
}

export async function textToBitmap(text: string, size: number, format: BitmapTextFormat, options: BitmapLayoutOptions = {}, rawRasterizer: GlyphRasterizer = rasterizeGlyph): Promise<string> {
 const rasterizer = safeRasterizer(rawRasterizer);
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
    rendered[lineIndex].push(format === 'emoji' ? compactRaster.join('\n') : rasterRowsToText(compactRaster, format, options.zalgoStrategy ?? 'detailed'));
   }
   if (index++ % 8 === 7) { await new Promise<void>(resolve => setImmediate(resolve)); }
  }
 }
 const blanks: Record<BitmapTextFormat, string> = { braille: '⠀', blockElements: '⠀', iphoneBlocks: '□', emoji: ' ', binary: '0', hex: '0', zalgo: ' ' };
 const output = composeSourceLines(rendered, blanks[format], options);
 if (format !== 'emoji') { return output; }
 const trimmed = trimBlankEdges(output.replace(/[0-9]/gu, ' '), ' ', true);
 const rows = trimmed.split('\n');
 const width = Math.max(0, ...rows.map(textDisplayWidth));
 return rows.map(line => line + ' '.repeat(Math.max(0, width - textDisplayWidth(line)))).join('\n');
}

export async function textToCustomArt(text: string, size: number, profile: CustomArtProfile, options: BitmapLayoutOptions = {}, rawRasterizer: GlyphRasterizer = rasterizeGlyph): Promise<string> {
  const rasterizer = safeRasterizer(rawRasterizer);
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

export function rasterRowsToText(rows: readonly string[], format: BitmapTextFormat, zalgoStrategy: ZalgoStrategy = 'detailed'): string {
 if (format === 'braille') { return rasterRowsToBraille(rows); }
 if (format === 'binary') { return rows.join('\n'); }
 if (format === 'hex') { return rows.map(row => Array.from({ length: Math.ceil(row.length / 4) }, (_, index) => Number.parseInt(row.slice(index * 4, (index + 1) * 4).padEnd(4, '0'), 2).toString(16)).join('')).join('\n'); }
 if (format === 'iphoneBlocks') { return rows.map(row => Array.from(row, value => value === '1' ? '■' : '□').join('')).join('\n'); }
 if (format === 'emoji') { return rows.map(row => Array.from(row, value => value === '1' ? '🔳' : '  ').join('')).join('\n'); }
 if (format === 'zalgo') { return optimizeCombiningArt(rows, true, zalgoStrategy); }
 const blocks = ['⠀', '▘', '▝', '▀', '▖', '▌', '▞', '▛', '▗', '▚', '▐', '▜', '▄', '▙', '▟', '█'];
 return Array.from({ length: Math.ceil(rows.length / 2) }, (_, blockRow) => Array.from({ length: Math.ceil((rows[0]?.length ?? 0) / 2) }, (_, blockColumn) => {
    const top = rows[blockRow * 2] ?? '';
    const bottom = rows[(blockRow * 2) + 1] ?? '';
    return blocks[(top[blockColumn * 2] === '1' ? 1 : 0) | (top[(blockColumn * 2) + 1] === '1' ? 2 : 0) | (bottom[blockColumn * 2] === '1' ? 4 : 0) | (bottom[(blockColumn * 2) + 1] === '1' ? 8 : 0)];
 }).join('')).join('\n');
}

export function rasterRowsToZalgo(rows: readonly string[]): string {
 const height = rows.length;
 const width = Math.max(0, ...rows.map(r => r.length));
 const lineCount = Math.ceil(height / 4);
 return Array.from({ length: lineCount }, (_, lineIdx) => {
  const r0 = rows[lineIdx * 4] ?? '';
  const r1 = rows[lineIdx * 4 + 1] ?? '';
  const r2 = rows[lineIdx * 4 + 2] ?? '';
  const r3 = rows[lineIdx * 4 + 3] ?? '';
  return Array.from({ length: width }, (_, col) => {
   const p0 = r0[col] === '1';
   const p1 = r1[col] === '1';
   const p2 = r2[col] === '1';
   const p3 = r3[col] === '1';
   if (!p0 && !p1 && !p2 && !p3) { return ' '; }
   let cell = ':';
   if (p0) { cell += '\u0311'; }
   if (p1) { cell += '\u0305'; }
   if (p2) { cell += '\u0332'; }
   if (p3) { cell += '\u035C'; }
   return cell;
  }).join('');
 }).join('\n');
}

export type ZalgoStrategy = 'sculpt' | 'detailed' | 'calculated' | 'hatching' | 'fast';

// 3-Base Glyphs Reconstructive Sculptor: 3 base anchors (| : ·) + up to 12 vertical tiers of combining marks
export function sculptCombiningArt(rows: readonly string[], maxTiers = 12): string {
 if (!rows.length) { return ''; }
 const height = rows.length;
 const width = Math.max(0, ...rows.map(r => r.length));
 const midRow = Math.floor(height / 2);

 return Array.from({ length: width }, (_, col) => {
  const colPixels = Array.from({ length: height }, (_, r) => rows[r]?.[col] === '1');
  const hasPixels = colPixels.some(Boolean);
  if (!hasPixels) { return ' '; }

  const hasLeft = col > 0 && Array.from({ length: height }, (_, r) => rows[r]?.[col - 1] === '1').some(Boolean);
  const hasRight = col + 1 < width && Array.from({ length: height }, (_, r) => rows[r]?.[col + 1] === '1').some(Boolean);
  const isBridge = hasLeft && hasRight;

  const centerInk = Number(colPixels[midRow] ?? false) + Number(colPixels[midRow - 1] ?? false) + Number(colPixels[midRow + 1] ?? false);
  const totalInk = colPixels.filter(Boolean).length;

  // Strictly 3 base glyphs: | (dense column), : (medium grid/bridge), · (fine anchor)
  const base = totalInk >= height * 0.6 || centerInk >= 2 ? '|' : isBridge || centerInk === 1 ? ':' : '·';
  let cell = base;

  // Upward Pass (Tiers +1 to +12)
  const aboveSlices = colPixels.slice(0, midRow).reverse();
  const numAbove = Math.min(maxTiers, aboveSlices.length);
  for (let tier = 0; tier < numAbove; tier++) {
   const needsInk = aboveSlices[tier];
   const higherNeedsInk = aboveSlices.slice(tier + 1).some(Boolean);
   if (needsInk) {
    if (isBridge && (tier === 0 || tier === numAbove - 1)) {
     cell += '\u0361'; // spanning arch
    } else if (tier === 0) {
     cell += '\u0305'; // immediate overline
    } else if (tier === 1) {
     cell += '\u0311'; // inverted breve dome
    } else if (tier % 3 === 0) {
     cell += '\u0308'; // diaeresis 2-dots
    } else if (tier % 2 === 0) {
     cell += '\u030B'; // double acute
    } else {
     cell += '\u0302'; // circumflex peak
    }
   } else if (higherNeedsInk) {
    cell += '\u0358'; // minimal spacer dot to elevate next tier
   }
  }

  // Downward Pass (Tiers -1 to -12)
  const belowSlices = colPixels.slice(midRow + 1);
  const numBelow = Math.min(maxTiers, belowSlices.length);
  for (let tier = 0; tier < numBelow; tier++) {
   const needsInk = belowSlices[tier];
   const lowerNeedsInk = belowSlices.slice(tier + 1).some(Boolean);
   if (needsInk) {
    if (isBridge && (tier === 0 || tier === numBelow - 1)) {
     cell += '\u035C'; // spanning wave below
    } else if (tier === 0) {
     cell += '\u0332'; // low line
    } else if (tier === 1) {
     cell += '\u0347'; // equals below ladder
    } else if (tier % 3 === 0) {
     cell += '\u0324'; // diaeresis below
    } else if (tier % 2 === 0) {
     cell += '\u0331'; // macron below
    } else {
     cell += '\u032E'; // breve below
    }
   } else if (lowerNeedsInk) {
    cell += '\u0323'; // spacer dot below to drop next tier
   }
  }
  return cell;
 }).join('').trimEnd();
}

// Grayscale Hatching & Density Overlay Sculptor
export function hatchingCombiningArt(rows: readonly string[]): string {
 const height = rows.length;
 const width = Math.max(0, ...rows.map(r => r.length));
 const lineCount = Math.ceil(height / 4);

 return Array.from({ length: lineCount }, (_, lineIdx) => {
  const r0 = rows[lineIdx * 4] ?? '';
  const r1 = rows[lineIdx * 4 + 1] ?? '';
  const r2 = rows[lineIdx * 4 + 2] ?? '';
  const r3 = rows[lineIdx * 4 + 3] ?? '';

  return Array.from({ length: width }, (_, col) => {
   const p0 = r0[col] === '1';
   const p1 = r1[col] === '1';
   const p2 = r2[col] === '1';
   const p3 = r3[col] === '1';
   const count = Number(p0) + Number(p1) + Number(p2) + Number(p3);
   if (count === 0) { return ' '; }

   const base = count === 4 ? '#' : count === 3 ? '%' : count === 2 ? '/' : '.';
   let cell = base;
   if (count >= 3) { cell += '\u0338\u0336'; } // long solidus overlay + long stroke overlay
   else if (count === 2) { cell += '\u0337'; } // short solidus overlay
   else if (p0 || p1) { cell += '\u0307'; }    // dot above
   else { cell += '\u0323'; }                  // dot below
   return cell;
  }).join('').trimEnd();
 }).join('\n');
}

export function optimizeCombiningArt(rows: readonly string[], compact = true, strategy: ZalgoStrategy = 'sculpt'): string {
 const effectiveRows = compact ? trimRasterEdges(rows, true) : rows;
 if (strategy === 'sculpt') {
  return sculptCombiningArt(effectiveRows);
 }
 if (strategy === 'hatching') {
  return hatchingCombiningArt(effectiveRows);
 }
 const height = effectiveRows.length;
 const width = Math.max(0, ...effectiveRows.map(r => r.length));
 const lineCount = Math.ceil(height / 4);

 return Array.from({ length: lineCount }, (_, lineIdx) => {
  const r0 = effectiveRows[lineIdx * 4] ?? '';
  const r1 = effectiveRows[lineIdx * 4 + 1] ?? '';
  const r2 = effectiveRows[lineIdx * 4 + 2] ?? '';
  const r3 = effectiveRows[lineIdx * 4 + 3] ?? '';

  return Array.from({ length: width }, (_, col) => {
   const p0 = r0[col] === '1';
   const p1 = r1[col] === '1';
   const p2 = r2[col] === '1';
   const p3 = r3[col] === '1';
   const onCount = Number(p0) + Number(p1) + Number(p2) + Number(p3);
   if (onCount === 0) { return ' '; }

   const leftOn = col > 0 && (r0[col - 1] === '1' || r1[col - 1] === '1' || r2[col - 1] === '1' || r3[col - 1] === '1');
   const rightOn = col + 1 < width && (r0[col + 1] === '1' || r1[col + 1] === '1' || r2[col + 1] === '1' || r3[col + 1] === '1');
   const isBridge = leftOn && rightOn;

   // 1. FAST: Clean 4-bit scanline bitfield
   if (strategy === 'fast') {
    let cell = ':';
    if (p0) { cell += '\u0311'; } // inverted breve above
    if (p1) { cell += '\u0305'; } // overline
    if (p2) { cell += '\u0332'; } // low line
    if (p3) { cell += '\u035C'; } // double breve below
    return cell;
   }

   // 2. CALCULATED: Structural bridges, spanning waves, adaptive bases
   if (strategy === 'calculated') {
    const base = onCount >= 3 ? '|' : isBridge ? ':' : onCount === 1 ? '·' : ':';
    let cell = base;
    if (p0) { cell += isBridge ? '\u0361' : '\u0311'; } // double inverted breve bridge or single inverted breve
    if (p1) { cell += '\u0305'; }                       // overline
    if (p2) { cell += '\u0332'; }                       // underline
    if (p3) { cell += isBridge ? '\u035C' : '\u032E'; } // double breve wave bridge or breve below
    return cell;
   }

   // 3. DETAILED: Rich micro-ligature construction with dense dot textures (|̠̠̩̤̤...)
   const base = onCount === 4 ? '|' : onCount === 3 ? '|' : onCount === 2 ? (isBridge ? ':' : '¦') : '·';
   let cell = base;
   if (p0 && p1) {
    cell += '\u033F\u0308'; // double overline + diaeresis 2-dots
   } else if (p0) {
    cell += isBridge ? '\u0361' : '\u030B'; // spanning arch or double acute
   } else if (p1) {
    cell += '\u0305'; // overline
   }

   if (p2 && p3) {
    cell += '\u0347\u0324'; // equals below + diaeresis 2-dots below
   } else if (p2) {
    cell += '\u0331\u0320'; // macron below + minus below
   } else if (p3) {
    cell += isBridge ? '\u035C' : '\u0329\u0325'; // double breve wave or vertical line + ring below
   }
   return cell;
  }).join('').trimEnd();
 }).join('\n');
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

function gapSize(options: BitmapLayoutOptions, blank: string): number {
 return options.compact ? options.compactGap ?? (blank === '⠀' ? 1 : blank === ' ' ? 1 : 4) : 1;
}
function blankBitmap(size: number, format: BitmapTextFormat): string { return rasterRowsToText(Array.from({ length: size }, () => '0'.repeat(size)), format); }
function spaceBitmap(size: number, format: BitmapTextFormat, compact: boolean): string {
 if (!compact) { return blankBitmap(size, format); }
 if (format === 'braille') { return Array.from({ length: 2 }, () => '⠀'.repeat(2)).join('\n'); }
 if (format === 'zalgo') { return Array.from({ length: Math.ceil(size / 4) }, () => ' '.repeat(3)).join('\n'); }
 return blankBitmap(size, format);
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

export function trimRasterEdges(rows: readonly string[], horizontal: boolean): string[] {
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