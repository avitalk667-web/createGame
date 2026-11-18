/**
 * The gameplay showcase video on the home page. To replace the video, put the new files in client/public/video/
 * and change only the paths here (MP4 H.264 with "faststart", so playback can begin before the whole file arrives).
 */
export const TUTORIAL_VIDEO = {
  src: 'video/gameplay-showcase.mp4',
  /**
   * The same file on an external storage (e.g. Cloudflare R2), so plays do not count toward the site's bandwidth.
   * null = only the site's own copy. When set, the player asks the external copy first and falls back to `src` by
   * itself if it cannot be reached (also in the middle of playing). Must be the identical MP4 (same bytes).
   */
  remoteSrc: null as string | null,
  poster: 'video/gameplay-showcase-poster.webp',
  /** The video's accessible name. */
  title: 'סרטון הדגמה: כך נראה משחק בחדר הבריחה הווירטואלי של PORTAL X',
  /** A text alternative for the preview picture (shown before playing). */
  posterAlt: 'תמונת פתיחה של סרטון ההדגמה: הבלש מהמשחק „סוד פך השמן” בוחן בזכוכית מגדלת את הדלתות המוזהבות, והכיתוב „רוצים לראות איך זה נראה באמת?”',
  width: 1920,
  height: 1080,
} as const;
