import { Canvas, createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';

const renderCanvasSize = 384;
const renderFontSize = 256;
const probeCanvasSize = 64;
const probeFontSize = 48;
const padding = 6;
const missingGlyph = '\u{10FFFF}';
const familyByGlyph = new Map<string, string>();
const successfulFamilies: string[] = [];
const missingMaskByFamily = new Map<string, Buffer>();
const colorEmojiFamily = /(?:color\s*emoji|emoji.*color|twemoji)/iu;
const emojiPresentationFamily = /(?:^noto\s+emoji$|color\s*emoji|emoji.*color|twemoji)/iu;
const textEmojiFamilyOrder = ['Apple Symbols', 'Noto Emoji', 'Noto Sans Symbols 2', 'Noto Sans Symbols', 'Arial Unicode MS', 'Symbol'];
const bayer4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]] as const;
const emojiArtCandidates = ['🦁️', '🐯️', '🐱️', '🦊️', '🐻️', '🐼️', '🐨️', '🐸️', '🐵️', '🐙️', '🦋️', '🌸️', '🌞️', '🔥️', '🌳️', '🌊️', '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '⚪️', '⚫️'];
const emojiArtPalette = new Map<string, { glyph: string; red: number; green: number; blue: number; coverage: number }[]>();
let configuredFontFamilies: string[] = [];
let disabledFontFamilies: string[] = [];

export function parseFontFamilyList(fontFamilySetting: string | undefined): string[] {
 return (fontFamilySetting ?? '').split(',').map(family => family.trim().replace(/^(['"])(.*)\1$/u, '$2')).filter(Boolean);
}

export function defaultPrettyPrintFontFamilies(editorFamilies: readonly string[] = []): string[] {
 const knownFamilies = [
  'Apple Symbols', 'Apple Color Emoji', 'Noto Emoji', 'Noto Color Emoji', 'Noto Sans Symbols 2', 'Noto Sans Symbols',
  'Segoe UI Symbol', 'Segoe UI Emoji', 'Arial Unicode MS', 'Symbola', 'DejaVu Sans', 'Liberation Sans', 'Symbol',
 ];
 return [...new Set([...editorFamilies, ...knownFamilies])];
}

export function installedFontFamilies(): string[] {
 return GlobalFonts.families.map(({ family }) => family).filter(family => family !== '.LastResort');
}

export function rasterizeEmojiArt(character: string, size: number): string[] {
 const emojiCharacter = character.includes('\uFE0F') ? character : `${character}\uFE0F`;
 const families = presentationFontFamilies(emojiCharacter, installedFontFamilies());
 const family = families.find(candidate => colorEmojiFamily.test(candidate)) ?? families.find(candidate => emojiPresentationFamily.test(candidate)) ?? systemFontFor(emojiCharacter, rasterCharacter(emojiCharacter)).family;
 const sourceRender = render(rasterCharacter(emojiCharacter), family, renderCanvasSize, renderFontSize);
 const sourceCanvas = sourceRender.canvas;
 const sourcePixels = sourceCanvas.getContext('2d').getImageData(0, 0, renderCanvasSize, renderCanvasSize).data;
 const missingMask = render(missingGlyph, family, renderCanvasSize, renderFontSize).mask;
 const bounds = boundingBoxFromMask(sourceRender.mask, renderCanvasSize, renderCanvasSize);
 if (!bounds || sourceRender.mask.equals(missingMask)) {
  return rasterizeGlyph(character, size).map(row => Array.from(row, pixel => pixel === '1' ? '⚫️' : '  ').join(''));
 }
 const gridSize = Math.max(1, Math.min(128, Math.round(size)));
 const palette = emojiArtPalette.get(family) ?? buildEmojiArtPalette(family);
 if (!palette.length) {
  return rasterizeGlyph(character, size).map(row => Array.from(row, pixel => pixel === '1' ? '⚫️' : '  ').join(''));
 }
 return Array.from({ length: gridSize }, (_, row) => Array.from({ length: gridSize }, (_, column) => {
  const sample = averageColor(sourcePixels, bounds.minX + (column + 0.5) * bounds.width / gridSize, bounds.minY + (row + 0.5) * bounds.height / gridSize, bounds.width / gridSize, bounds.height / gridSize);
  if (!sample || sample.coverage < 0.08) { return '  '; }
  return palette.slice().sort((left, right) => colorDistance(sample, left) - colorDistance(sample, right))[0]?.glyph ?? '  ';
 }).join(''));
}

export async function rasterizeImageEmojiArt(bytes: Uint8Array, size: number): Promise<string[]> {
 const image = await loadImage(bytes);
 const canvas = createCanvas(renderCanvasSize, renderCanvasSize);
 const context = canvas.getContext('2d');
 const scale = Math.min(renderCanvasSize / image.width, renderCanvasSize / image.height);
 const width = Math.max(1, Math.round(image.width * scale));
 const height = Math.max(1, Math.round(image.height * scale));
 const left = Math.floor((renderCanvasSize - width) / 2);
 const top = Math.floor((renderCanvasSize - height) / 2);
 context.clearRect(0, 0, renderCanvasSize, renderCanvasSize);
 context.drawImage(image, left, top, width, height);
 const pixels = context.getImageData(0, 0, renderCanvasSize, renderCanvasSize).data;
 const family = presentationFontFamilies('\u{1F981}\uFE0F', installedFontFamilies()).find(candidate => colorEmojiFamily.test(candidate)) ?? 'sans-serif';
 const palette = emojiArtPalette.get(family) ?? buildEmojiArtPalette(family);
 const gridSize = Math.max(1, Math.min(128, Math.round(size)));
 return Array.from({ length: gridSize }, (_, row) => Array.from({ length: gridSize }, (_, column) => {
  const sample = averageColor(pixels, (column + 0.5) * renderCanvasSize / gridSize, (row + 0.5) * renderCanvasSize / gridSize, renderCanvasSize / gridSize, renderCanvasSize / gridSize);
  if (!sample || sample.coverage < 0.08) { return '  '; }
  return palette.slice().sort((leftColor, rightColor) => colorDistance(sample, leftColor) - colorDistance(sample, rightColor))[0]?.glyph ?? '  ';
 }).join(''));
}

function buildEmojiArtPalette(family: string) {
 const palette = emojiArtCandidates.flatMap(glyph => {
  const rendered = render(rasterCharacter(glyph), family, renderCanvasSize, renderFontSize);
  const pixels = rendered.canvas.getContext('2d').getImageData(0, 0, renderCanvasSize, renderCanvasSize).data;
  const color = averageColor(pixels, renderCanvasSize / 2, renderCanvasSize / 2, renderCanvasSize, renderCanvasSize);
  return color ? [{ glyph, ...color }] : [];
 });
 emojiArtPalette.set(family, palette);
 return palette;
}

function averageColor(pixels: Uint8ClampedArray, centerX: number, centerY: number, width: number, height: number) {
 const left = Math.max(0, Math.floor(centerX - width / 2)), top = Math.max(0, Math.floor(centerY - height / 2));
 const right = Math.min(renderCanvasSize, Math.ceil(centerX + width / 2)), bottom = Math.min(renderCanvasSize, Math.ceil(centerY + height / 2));
 let red = 0, green = 0, blue = 0, weight = 0;
 for (let row = top; row < bottom; row++) { for (let column = left; column < right; column++) {
  const offset = ((row * renderCanvasSize) + column) * 4;
  const alpha = pixels[offset + 3] / 255;
  if (!alpha) { continue; }
  red += pixels[offset] * alpha; green += pixels[offset + 1] * alpha; blue += pixels[offset + 2] * alpha; weight += alpha;
 } }
 const area = Math.max(1, (right - left) * (bottom - top));
 return weight ? { red: red / weight, green: green / weight, blue: blue / weight, coverage: Math.min(1, weight / area) } : undefined;
}

function colorDistance(left: { red: number; green: number; blue: number; coverage: number }, right: { red: number; green: number; blue: number; coverage: number }) {
 const color = (left.red - right.red) ** 2 + (left.green - right.green) ** 2 + (left.blue - right.blue) ** 2;
 const coverage = ((left.coverage - right.coverage) * 255) ** 2;
 return color + (coverage * 0.12);
}

export function setPrettyPrintFontFamilies(fontFamilySetting: string | undefined, disabledFamilies: readonly string[] = []): void {
 configuredFontFamilies = parseFontFamilyList(fontFamilySetting);
 disabledFontFamilies = [...disabledFamilies];
 familyByGlyph.clear();
 successfulFamilies.length = 0;
}

function otsuThreshold(values: number[]): number {
 if (values.length === 0) { return 128; }
 const histogram = new Array<number>(256).fill(0);
 for (const value of values) {
  const index = Math.max(0, Math.min(255, Math.round(value)));
  histogram[index] += 1;
 }
 const total = values.length;
 let sum = 0;
 for (let level = 0; level < 256; level++) {
  sum += level * histogram[level];
 }
 let sumBackground = 0;
 let weightBackground = 0;
 let bestThreshold = 0;
 let bestVariance = 0;
 const totalWeight = total;
 for (let level = 0; level < 256; level++) {
  const count = histogram[level];
  if (count === 0) { continue; }
  weightBackground += count;
  if (weightBackground === 0 || weightBackground === totalWeight) { continue; }
  sumBackground += level * count;
  const meanBackground = sumBackground / weightBackground;
  const meanForeground = (sum - sumBackground) / (totalWeight - weightBackground);
  const variance = weightBackground * (totalWeight - weightBackground) * (meanBackground - meanForeground) ** 2;
  if (variance > bestVariance) {
   bestVariance = variance;
   bestThreshold = level;
  }
 }
 return Math.max(16, Math.min(240, bestThreshold));
}

function adaptiveColorEmojiThreshold(pixels: Uint8ClampedArray, size: number): number {
 const luminanceValues: number[] = [];
 for (let row = 0; row < size; row++) {
  for (let column = 0; column < size; column++) {
   const offset = ((row * size) + column) * 4;
   const alpha = pixels[offset + 3];
   if (alpha <= 0) { continue; }
   const red = pixels[offset];
   const green = pixels[offset + 1];
   const blue = pixels[offset + 2];
   const luminance = (red * 0.2126) + (green * 0.7152) + (blue * 0.0722);
   const saturation = Math.max(red, green, blue) === 0 ? 0 : (Math.max(red, green, blue) - Math.min(red, green, blue)) / Math.max(red, green, blue);
   luminanceValues.push(Math.max(0, luminance - (saturation * 88)));
  }
 }
 if (luminanceValues.length === 0) { return 128; }
 const threshold = otsuThreshold(luminanceValues);
 return threshold;
}

export type GlyphRasterizer = (character: string, size: number) => string[];

const rasterCharacter = (character: string) => character.replace(/[\uFE0E\uFE0F]/gu, '');

export function presentationFontFamilies(character: string, families: readonly string[]): string[] {
 const disabled = new Set(disabledFontFamilies.map(family => family.toLocaleLowerCase()));
 const unique = [...new Set(families.filter(family => family !== '.LastResort' && !disabled.has(family.toLocaleLowerCase())))];
 const installedByName = new Map(unique.map(family => [family.toLocaleLowerCase(), family]));
 const configured = configuredFontFamilies.flatMap(family => installedByName.has(family.toLocaleLowerCase()) ? [installedByName.get(family.toLocaleLowerCase())!] : []);
 const text = character.includes('\uFE0E');
 const color = character.includes('\uFE0F');
 const ordered = unique.sort((left, right) => Number(!left.startsWith('Noto ')) - Number(!right.startsWith('Noto ')));
 if (text) {
  const nonColor = ordered.filter(family => !colorEmojiFamily.test(family));
  const preferred = textEmojiFamilyOrder.flatMap(name => nonColor.filter(family => family === name));
  return [...configured.filter(family => !colorEmojiFamily.test(family)), ...preferred.filter(family => !configured.includes(family)), ...nonColor.filter(family => !preferred.includes(family) && !configured.includes(family))];
 }
 if (color) { return [...configured, ...ordered.filter(family => emojiPresentationFamily.test(family) && !configured.includes(family)), ...ordered.filter(family => !emojiPresentationFamily.test(family) && !configured.includes(family))]; }
 return ordered;
}

export function enumerateFontRenderings(character: string, size = 24): { family: string; rows: string[] }[] {
 const renderedCharacter = rasterCharacter(character);
 const families = [...new Set([
  ...presentationFontFamilies(character, GlobalFonts.families.map(({ family }) => family)),
  ...presentationFontFamilies(character, successfulFamilies),
  'sans-serif', 'Arial', 'Apple Symbols', 'Noto Emoji', 'Noto Sans Symbols 2', 'Noto Sans Symbols'
 ])];
 const renderings: { family: string; rows: string[] }[] = [];
 for (const family of families) {
  try {
   const probe = render(renderedCharacter, family, probeCanvasSize, probeFontSize);
   const probeMissing = render(missingGlyph, family, probeCanvasSize, probeFontSize).mask;
   if (probe.mask.equals(probeMissing) || !probe.mask.some(alpha => alpha > 0)) { continue; }
   const result = render(renderedCharacter, family, renderCanvasSize, renderFontSize);
   const mask = result.mask;
  if (!mask.some(alpha => alpha > 0)) { continue; }
   const bounding = boundingBoxFromMask(mask, renderCanvasSize, renderCanvasSize);
   if (!bounding) { continue; }
   const { minX, minY, width, height } = bounding;
   const targetCanvas = createCanvas(size, size);
   const context = targetCanvas.getContext('2d');
   context.clearRect(0, 0, size, size);
   context.imageSmoothingEnabled = true;
   context.imageSmoothingQuality = 'high';
   context.drawImage(result.canvas, minX, minY, width, height, 0, 0, size, size);
   const pixels = context.getImageData(0, 0, size, size).data;
   const rows = Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, column) => {
    const alpha = pixels[((row * size) + column) * 4 + 3];
    return alpha >= 16 ? '1' : '0';
   }).join(''));
   renderings.push({ family, rows });
  } catch { }
 }
 return renderings;
}

function boundingBoxFromMask(mask: Buffer, width: number, height: number) {
 let minX = width, minY = height, maxX = -1, maxY = -1;
 for (let index = 0; index < mask.length; index++) {
  if (mask[index] === 0) { continue; }
  const x = index % width;
  const y = Math.floor(index / width);
  minX = Math.min(minX, x); minY = Math.min(minY, y);
  maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
 }
 if (maxX < minX || maxY < minY) { return undefined; }
 return { minX, minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function render(character: string, family: string, canvasSize = renderCanvasSize, fontSize = renderFontSize): { canvas: Canvas; mask: Buffer } {
 const renderCanvas = createCanvas(canvasSize, canvasSize);
 const renderContext = renderCanvas.getContext('2d');
 renderContext.font = `${fontSize}px "${family.replaceAll('"', '\\"')}"`;
 const metrics = renderContext.measureText(character);
 const x = (canvasSize + metrics.actualBoundingBoxLeft - metrics.actualBoundingBoxRight) / 2;
 const y = (canvasSize + metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2;
 renderContext.fillStyle = '#fff';
 renderContext.fillText(character, x, y);
 const pixels = renderContext.getImageData(0, 0, canvasSize, canvasSize).data;
 return { canvas: renderCanvas, mask: Buffer.from(pixels.filter((_, index) => index % 4 === 3)) };
}

function systemFontFor(character: string, renderedCharacter = character): { canvas: Canvas; mask: Buffer; family: string } {
 const cachedFamily = familyByGlyph.get(character);
 if (cachedFamily) { return { ...render(renderedCharacter, cachedFamily), family: cachedFamily }; }
 const installedFamilies = presentationFontFamilies(character, GlobalFonts.families.map(({ family }) => family));
 const successful = presentationFontFamilies(character, successfulFamilies);
 const color = character.includes('\uFE0F');
 const colorFirst = (families: readonly string[]) => families.filter(family => emojiPresentationFamily.test(family));
 const nonColor = (families: readonly string[]) => families.filter(family => !emojiPresentationFamily.test(family));
 const families = [...new Set(character.includes('\uFE0E') ? [...successful, ...installedFamilies, 'sans-serif'] : color ? [...colorFirst(successful), ...colorFirst(installedFamilies), ...nonColor(successful), 'sans-serif', ...nonColor(installedFamilies)] : [...successful, 'sans-serif', ...installedFamilies])];
 for (const family of families) {
  const rendered = render(renderedCharacter, family, probeCanvasSize, probeFontSize);
  const missingMask = missingMaskByFamily.get(family) ?? render(missingGlyph, family, probeCanvasSize, probeFontSize).mask;
  missingMaskByFamily.set(family, missingMask);
  if (!rendered.mask.equals(missingMask) && rendered.mask.some(alpha => alpha > 0)) {
   familyByGlyph.set(character, family);
  if (!color && !successfulFamilies.includes(family)) { successfulFamilies.unshift(family); }
  return { ...render(renderedCharacter, family), family };
  }
 }
 const codepoints = Array.from(character, value => `U+${value.codePointAt(0)!.toString(16).toUpperCase()}`).join(' ');
 throw new Error(`No installed font can render ${codepoints}`);
}

export function rasterizeGlyphForFamily(character: string, family: string, size: number): string[] {
 const renderedCharacter = rasterCharacter(character);
 const colorEmoji = character.includes('\uFE0F');
 const renderCanvas = render(renderedCharacter, family, renderCanvasSize, renderFontSize).canvas;
 const mask = render(renderedCharacter, family, renderCanvasSize, renderFontSize).mask;

 let minX = renderCanvasSize, minY = renderCanvasSize, maxX = -1, maxY = -1;
 for (let index = 0; index < mask.length; index++) {
  if (mask[index] === 0) { continue; }
  const pixelX = index % renderCanvasSize;
  const pixelY = Math.floor(index / renderCanvasSize);
  minX = Math.min(minX, pixelX); minY = Math.min(minY, pixelY);
  maxX = Math.max(maxX, pixelX); maxY = Math.max(maxY, pixelY);
 }
 if (maxX < minX || maxY < minY) { throw new Error(`Glyph has no visible pixels`); }

 const sourceWidth = maxX - minX + 1;
 const sourceHeight = maxY - minY + 1;
 const inset = character.includes('\uFE0E') ? 2 : padding;
 const scale = Math.min((size - (inset * 2)) / sourceWidth, (size - (inset * 2)) / sourceHeight);
 const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
 const targetHeight = Math.max(1, Math.round(sourceHeight * scale));
 const targetCanvas = createCanvas(size, size);
 const targetContext = targetCanvas.getContext('2d');
 targetContext.imageSmoothingEnabled = true;
 targetContext.imageSmoothingQuality = 'high';
 targetContext.drawImage(renderCanvas, minX, minY, sourceWidth, sourceHeight,
  Math.floor((size - targetWidth) / 2), Math.floor((size - targetHeight) / 2), targetWidth, targetHeight);
 const targetPixels = targetContext.getImageData(0, 0, size, size).data;
 const alphaThreshold = character.includes('\uFE0E') ? 16 : 128;
 const colorEmojiThreshold = colorEmoji ? adaptiveColorEmojiThreshold(targetPixels, size) : alphaThreshold;
 return Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, column) =>
  pixelIsInk(targetPixels, ((row * size) + column) * 4, row, column, colorEmoji, alphaThreshold, colorEmojiThreshold) ? '1' : '0').join(''));
}

export const rasterizeGlyph: GlyphRasterizer = (character, size) => {
 const renderedCharacter = rasterCharacter(character);
 const { family } = systemFontFor(/[\uFE0E\uFE0F]/u.test(character) ? character : renderedCharacter, renderedCharacter);
 return rasterizeGlyphForFamily(character, family, size);
};

// The VS15 text path is deliberately protected: do not change it once the symbol rendering is correct.
// The color-emoji path uses an image-wide adaptive threshold so the internal cutout and ring structure survive the binarization step.
function pixelIsInk(pixels: Uint8ClampedArray, offset: number, row: number, column: number, colorEmoji: boolean, alphaThreshold: number, colorEmojiThreshold = 128): boolean {
 const alpha = pixels[offset + 3];
 if (!colorEmoji) { return alpha >= alphaThreshold; }
 const red = pixels[offset], green = pixels[offset + 1], blue = pixels[offset + 2];
 const luminance = (red * 0.2126) + (green * 0.7152) + (blue * 0.0722);
 const saturation = Math.max(red, green, blue) === 0 ? 0 : (Math.max(red, green, blue) - Math.min(red, green, blue)) / Math.max(red, green, blue);
 const grayscale = Math.max(0, luminance - (saturation * 88));
 const localBias = ((bayer4[row % 4][column % 4] + 0.5) * (255 / 16)) - 128;
 return grayscale < (colorEmojiThreshold + localBias * 0.2);
}

export const rasterizeGlyphBaseline: GlyphRasterizer = (character, size) => {
 return rasterizeGlyphBaselineBand(character, size, 0, renderCanvasSize);
};

export function rasterizeGlyphBaselineForFamily(character: string, family: string, size: number): string[] {
 return rasterizeGlyphBaselineBand(character, size, 0, renderCanvasSize, family);
}

export const rasterizeGlyphBaselineTight: GlyphRasterizer = (character, size) => {
 return rasterizeGlyphBaselineBand(character, size, renderFontSize * 0.42, renderFontSize * 0.84);
};

export function rasterizeGlyphBaselineTightForFamily(character: string, family: string, size: number): string[] {
 return rasterizeGlyphBaselineBand(character, size, renderFontSize * 0.42, renderFontSize * 0.84, family);
}

function rasterizeGlyphBaselineBand(character: string, size: number, top: number, height: number, family?: string): string[] {
 const renderedCharacter = rasterCharacter(character);
 const selectedFamily = family ?? systemFontFor(/[\uFE0E\uFE0F]/u.test(character) ? character : renderedCharacter, renderedCharacter).family;
 const canvas = createCanvas(renderCanvasSize, renderCanvasSize);
 const context = canvas.getContext('2d');
 context.font = `${renderFontSize}px "${selectedFamily.replaceAll('"', '\\"')}"`;
 context.fillStyle = '#fff';
 const baseline = renderCanvasSize * 0.75;
 context.fillText(renderedCharacter, (renderCanvasSize - context.measureText(renderedCharacter).width) / 2, baseline);
 const pixels = context.getImageData(0, 0, renderCanvasSize, renderCanvasSize).data;
 const bottom = Math.min(renderCanvasSize, top + height);
 return Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, column) =>
  pixels[(((Math.min(bottom - 1, Math.floor(top + (row * (bottom - top) / size))) * renderCanvasSize) + Math.floor(column * renderCanvasSize / size)) * 4) + 3] >= 128 ? '1' : '0').join(''));
}

export async function rasterizeImage(bytes: Uint8Array, size: number): Promise<string[]> {
 const image = await loadImage(bytes);
 const canvas = createCanvas(size, size);
 const context = canvas.getContext('2d');
 const scale = Math.min(size / image.width, size / image.height);
 const width = Math.max(1, Math.round(image.width * scale));
 const height = Math.max(1, Math.round(image.height * scale));
 context.fillStyle = '#fff';
 context.fillRect(0, 0, size, size);
 context.drawImage(image, Math.floor((size - width) / 2), Math.floor((size - height) / 2), width, height);
 const pixels = context.getImageData(0, 0, size, size).data;
 return Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, column) => {
  const offset = ((row * size) + column) * 4;
  const luminance = (pixels[offset] * 0.2126) + (pixels[offset + 1] * 0.7152) + (pixels[offset + 2] * 0.0722);
  return luminance < 160 ? '1' : '0';
 }).join(''));
}

export function glyphIconPng(character: string, size: number, color: string): Buffer {
 const renderedCharacter = rasterCharacter(character);
 const { canvas: source, mask } = systemFontFor(/[\uFE0E\uFE0F]/u.test(character) ? character : renderedCharacter, renderedCharacter);
 let minX = renderCanvasSize, minY = renderCanvasSize, maxX = -1, maxY = -1;
 for (let index = 0; index < mask.length; index++) {
  if (mask[index] === 0) { continue; }
  const x = index % renderCanvasSize;
  const y = Math.floor(index / renderCanvasSize);
  minX = Math.min(minX, x); minY = Math.min(minY, y);
  maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
 }
 if (maxX < minX || maxY < minY) { throw new Error('Glyph has no visible pixels'); }
 const width = maxX - minX + 1;
 const height = maxY - minY + 1;
 const scale = Math.min((size - 2) / width, (size - 2) / height);
 const targetWidth = Math.max(1, Math.round(width * scale));
 const targetHeight = Math.max(1, Math.round(height * scale));
 const target = createCanvas(size, size);
 const context = target.getContext('2d');
 context.imageSmoothingEnabled = true;
 context.imageSmoothingQuality = 'high';
 context.drawImage(source, minX, minY, width, height, Math.floor((size - targetWidth) / 2), Math.floor((size - targetHeight) / 2), targetWidth, targetHeight);
 context.globalCompositeOperation = 'source-in';
 context.fillStyle = color;
 context.fillRect(0, 0, size, size);
 return target.toBuffer('image/png');
}