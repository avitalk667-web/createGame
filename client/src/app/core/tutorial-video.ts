/**
 * The gameplay tutorial video on the home page. To replace the video, put the new files in client/public/video/
 * and change only the paths here (MP4 H.264 with "faststart", so playback can begin before the whole file arrives).
 */
export const TUTORIAL_VIDEO = {
  src: 'video/gameplay-tutorial.mp4',
  poster: 'video/gameplay-tutorial-poster.webp',
  /** The video's accessible name. */
  title: 'סרטון הדרכה: איך משחקים בחדר הבריחה הווירטואלי של PORTAL X',
  /** A text alternative for the preview picture (shown before playing). */
  posterAlt: 'תמונת פתיחה של סרטון ההדרכה: הלוגו של PORTAL X והכיתוב „המשימה מתחילה עכשיו”',
  width: 1920,
  height: 1080,
} as const;
