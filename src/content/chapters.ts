import type { Chapter } from '../scene/chapters';

/**
 * Narrative copy, built on the JTBD in research.md:
 *  - Emotional: when the future feels uncertain, believe there are still worlds
 *    worth discovering — hope rather than helplessness.
 *  - Functional: discover and evaluate potentially habitable worlds.
 *  - Social: be part of humanity's pursuit of something greater.
 * Awe first, then hope. Earth is never framed as doomed, and the mission
 * investigates habitability — it never claims life has been found.
 */
export interface Beat {
  /** Plain clause, then an italic turn. */
  lead: string;
  turn?: string;
  /** Chapter progress window [in, out] in which the line is on screen. */
  at: [number, number];
}

export interface ChapterCopy {
  id: Chapter;
  label: string;
  /** Where the copy sits, chosen to keep clear of the astronaut in each shot. */
  placement: 'lower-left' | 'upper-left' | 'upper-right' | 'center' | 'top-center';
  beats: Beat[];
  /** Mission notes: what this world is, and what the mission does there. */
  notes?: { label: string; value: string }[];
  notesAt?: [number, number];
  ariaSummary: string;
}

export const INTRO = {
  kicker: 'Mission LF-1 · A fictional exploration concept',
  title: 'The Last Frontier',
  line: 'One astronaut. One distant world. One question: could it be a place where life begins again?',
  cue: 'Scroll to begin the journey',
};

export const CHAPTER_COPY: ChapterCopy[] = [
  {
    id: 'departure',
    label: '01 — Departure',
    placement: 'lower-left',
    beats: [
      { lead: 'For all our history,', turn: 'we have known only one home.', at: [0.1, 0.4] },
      { lead: 'When the future feels uncertain,', turn: 'we look outward — for reasons to hope.', at: [0.55, 0.95] },
    ],
    ariaSummary: 'A lone astronaut drifts away from Earth as the sun rises over its horizon.',
  },
  {
    id: 'crossing',
    label: '02 — The Crossing',
    placement: 'upper-right',
    beats: [
      { lead: 'Somewhere beyond the familiar,', turn: 'another world may be waiting.', at: [0.25, 0.6] },
      { lead: 'To find it,', turn: 'we go further than anyone has gone.', at: [0.68, 1.01] },
    ],
    ariaSummary: 'Far ahead, light bends around a black hole; the astronaut is drawn towards its glowing disk.',
  },
  {
    id: 'transit',
    label: 'Transit',
    placement: 'top-center',
    beats: [{ lead: 'Beyond distance. Beyond certainty.', turn: 'Beyond everything we know.', at: [0.3, 0.72] }],
    ariaSummary: 'The astronaut passes through a wormhole at great speed; the distortion dissolves into a new star system.',
  },
  {
    id: 'discovery',
    label: '03 — Discovery',
    placement: 'upper-right',
    beats: [{ lead: 'A distant world.', turn: 'A possibility worth exploring.', at: [0.2, 0.85] }],
    notes: [
      { label: 'Designation', value: 'LF-1 · fictional' },
      { label: 'Liquid water', value: 'Indicated from orbit' },
      { label: 'Atmosphere', value: 'Under analysis' },
      { label: 'Life', value: 'Unknown — that is the question' },
    ],
    notesAt: [0.3, 0.82],
    ariaSummary: 'An Earth-like planet grows ahead of the astronaut.',
  },
  {
    id: 'arrival',
    label: '04 — Arrival',
    placement: 'upper-right',
    beats: [{ lead: 'We came to read this world closely —', turn: 'its air, its water, its ground.', at: [0.5, 1.01] }],
    notes: [
      { label: 'Survey', value: 'Map coastlines, climate, terrain' },
      { label: 'Sample', value: 'Air, water and soil' },
      { label: 'Evaluate', value: 'Could this world sustain life?' },
    ],
    notesAt: [0.6, 1.01],
    ariaSummary: 'From high above, the astronaut looks down on the coastlines and drifting clouds of the new world.',
  },
  {
    id: 'possibility',
    label: '05 — Possibility',
    placement: 'center',
    beats: [
      { lead: 'Every answer it finds', turn: 'belongs to all of us.', at: [0.04, 0.4] },
      { lead: 'The universe is larger than we imagined.', turn: 'So is what we can discover.', at: [0.48, 1.01] },
    ],
    ariaSummary: 'The view widens over the new world: an invitation to follow the journey.',
  },
];
