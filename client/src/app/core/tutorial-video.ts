/**
 * The gameplay showcase video on the home page. To replace the video, put the new files in client/public/video/
 * and change only the paths here (MP4 H.264 with "faststart", so playback can begin before the whole file arrives).
 */
export const TUTORIAL_VIDEO = {
  src: 'video/gameplay-showcase.mp4',
  poster: 'video/gameplay-showcase-poster.webp',
  /** The video's accessible name. */
  title: 'סרטון הדגמה: כך נראה משחק בחדר הבריחה הווירטואלי של PORTAL X',
  /** A text alternative for the preview picture (shown before playing). */
  posterAlt: 'תמונת פתיחה של סרטון ההדגמה: הבלש מהמשחק „סוד פך השמן” בוחן בזכוכית מגדלת את הדלתות המוזהבות, והכיתוב „רוצים לראות איך זה נראה באמת?”',
  width: 1920,
  height: 1080,
} as const;
