/** The journey's scroll chapters, in order. Kept free of three.js so the page shell can import it. */
export type Chapter = 'departure' | 'crossing' | 'transit' | 'discovery' | 'arrival' | 'possibility';
export const CHAPTERS: Chapter[] = ['departure', 'crossing', 'transit', 'discovery', 'arrival', 'possibility'];
