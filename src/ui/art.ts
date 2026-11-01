import type { Person } from '../sim/types';
import thickenedIcons from '../../public/art/icons-small/index.json';

/**
 * Where the delivered artwork lives and how the interface names it. Every
 * image the game loads goes through here, so a missing file has one place to
 * fall back from and the manifest in public/art stays the single inventory.
 */

export const ART_ROOT = '/art';

export function art(path: string): string {
  return `${ART_ROOT}/${path}`;
}

const THICKENED = new Set<string>(thickenedIcons);
/** At or below this size a thin glyph uses its thickened small variant. */
export const SMALL_ICON_PX = 20;

/** One of the engraved glyphs in public/art/icons, by "group/name". Thin glyphs
 * have a thickened variant for small sizes. */
export function iconUrl(name: string, size = Infinity): string {
  return size <= SMALL_ICON_PX && THICKENED.has(name) ? art(`icons-small/${name}.png`) : art(`icons/${name}.png`);
}

const MALE_PORTRAITS = 64;
const FEMALE_PORTRAITS = 32;

/** The painted sitter for a person: the portrait number picks from the fixed pool. */
export function portraitUrl(person: Pick<Person, 'portrait' | 'female'>): string {
  const n = Math.abs(person.portrait | 0);
  if (person.female) return art(`portraits/f/f-${String(1 + (n % FEMALE_PORTRAITS)).padStart(2, '0')}.png`);
  return art(`portraits/m/m-${String(1 + (n % MALE_PORTRAITS)).padStart(2, '0')}.png`);
}

/** A gang boss's painted heritage portrait (P3b), when the person has one. */
export function bossPortraitUrl(face: string | undefined): string | undefined {
  return face ? art(`portraits/nationality/${face}.png`) : undefined;
}

/** Mastheads in the same order as NEWSPAPER_NAMES. */
export const MASTHEADS = ['press/masthead-herald.png', 'press/masthead-post.png', 'press/masthead-tribune.png', 'press/masthead-times.png'].map(art);

/** Press photographs by news section; the week picks one. */
export const SECTION_PHOTOS: Record<string, string[]> = {
  crime: ['press/photo-shopfront-wrecked.jpg', 'press/photo-fire.jpg'].map(art),
  law: ['press/photo-raid.jpg', 'press/photo-courthouse-steps.jpg'].map(art),
  politics: ['press/photo-city-hall.jpg', 'press/photo-rally.jpg'].map(art),
  deaths: ['press/photo-funeral.jpg'].map(art),
  charity: ['press/photo-soup-kitchen.jpg'].map(art),
  business: ['press/photo-bank.jpg', 'press/photo-docks.jpg'].map(art),
  city: ['press/photo-rally.jpg', 'press/photo-docks.jpg', 'press/photo-city-hall.jpg'].map(art),
};
SECTION_PHOTOS.front = [...SECTION_PHOTOS.crime, ...SECTION_PHOTOS.law, ...SECTION_PHOTOS.politics, ...SECTION_PHOTOS.business];

export function pressPhoto(section: string, seed: number): string | null {
  const list = SECTION_PHOTOS[section];
  if (!list || !list.length) return null;
  return list[Math.abs(seed) % list.length];
}

export function crestUrl(color: string): string {
  return art(`crests/${color}.png`);
}

/** The painted elevation on a site's papers. */
export function thumbUrl(cls: string, state: string): string {
  const key = state === 'destroyed' ? 'destroyed' : cls;
  return art(`city/thumbs/${key}.png`);
}

const cache = new Map<string, Promise<HTMLImageElement>>();

/** Load an image once and share it; rejects if the file is not there. */
export function loadImage(src: string): Promise<HTMLImageElement> {
  let p = cache.get(src);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => { cache.delete(src); reject(new Error(`missing ${src}`)); };
      img.src = src;
    });
    cache.set(src, p);
  }
  return p;
}
