export interface ProductIcon {
 name: string;
 description?: string;
 tags?: readonly string[];
}

const words = (text: string): string[] => text.toLowerCase().split(/[^a-z0-9]+/u).filter(Boolean);

export function parseProductIcons(json: string | Uint8Array): ProductIcon[] {
 const text = typeof json === 'string' ? json : new TextDecoder().decode(json);
 return JSON.parse(text) as ProductIcon[];
}

// Matches by icon name exact/prefix/word-prefix, and whole-word tags/descriptions.
export function matchingProductIcons(icons: readonly ProductIcon[], draft: string, limit = 5): ProductIcon[] {
 const query = draft.trim().toLowerCase();
 if (query.length < 2) { return []; }
 const nameMatches = icons.filter(icon =>
  icon.name === query ||
  icon.name.startsWith(query) ||
  icon.name.split('-').some(segment => segment.startsWith(query))
 );
 const tagMatches = icons.filter(icon =>
  !nameMatches.includes(icon) &&
  ((icon.tags?.some(tag => words(tag).includes(query) || tag.toLowerCase() === query)) ||
   (icon.description && words(icon.description).includes(query)))
 );
 return [...nameMatches, ...tagMatches].slice(0, limit);
}
