/** A marked area on a screenshot, in percent of the picture: a numbered frame, or an arrow pointing at a spot. */
export interface GuideMark {
  n: number;
  x: number;
  y: number;
  /** A frame's size; without it the mark is a numbered dot. */
  w?: number;
  h?: number;
  /** An arrow pointing at (x, y) from this side. */
  arrow?: 'up' | 'down' | 'left' | 'right';
}

export interface GuideShot {
  /** File name in /img/guide (without the extension): a .webp in two widths, -1440 and -720. */
  src: string;
  alt: string;
  width: number;
  height: number;
  marks?: GuideMark[];
  /** What each number on the picture shows, in order. */
  legend?: string[];
  caption?: string;
  /** A tall phone screenshot: shown narrower, so it does not fill the whole page. */
  portrait?: boolean;
}

export interface GuideStep {
  title: string;
  /** Short paragraphs: what you see, and what to do. */
  text: string[];
  shot?: GuideShot;
  /** Keys and controls, shown as small key caps. */
  keys?: { keys: string[]; label: string }[];
  tip?: string;
}

export interface GuideChapter {
  id: string;
  letter: string;
  title: string;
  lead: string;
  steps: GuideStep[];
}
