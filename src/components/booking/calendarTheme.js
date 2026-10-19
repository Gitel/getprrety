// Shared look of the booking calendar (Month / Week / Day views and the day pop-up).
// The accent (era colour) comes from props; everything else lives here so the three views match.
// Colours are warm tints of the app palette (C in src/constants.js): a slightly darker "paper" for
// the calendar card, white grid cells, thin divider lines and a band behind the weekday headers.
import { useWindowDimensions } from 'react-native';

export const CAL = {
  card:   '#F3ECE5',   // calendar surface (a little darker than the page background C.bg)
  border: '#DDD1C5',   // card border
  line:   '#E2D7CC',   // 1 px divider lines between grid cells
  band:   '#EDE4DB',   // weekday header band + the view-toggle track
  taken:  '#EDE6DF',   // a taken (booked) time
  off:    '#F7F2ED',   // a closed / past / outside-range day
};

// Windows at least this wide (px) get the roomy desktop layout (taller cells, texts inside cells).
export const WIDE_MIN = 600;
// Max width of the whole booking column (header + body) on big screens.
export const COLUMN_MAX = 760;

// true on a desktop / tablet sized window, false on a phone. Re-renders when the window resizes.
export function useIsWide() {
  const { width } = useWindowDimensions();
  return width >= WIDE_MIN;
}

// Opaque tint of a 6-digit hex colour over white, e.g. tint('#7A9E6E', 0.08) = a very light green.
// An opaque colour (not accent + alpha) is used because grid cells sit on the divider-line colour:
// a see-through tint would pick up that grey and look muddy.
export function tint(hex, amount) {
  const n = parseInt(hex.slice(1, 7), 16);
  const mix = (c) => Math.round(255 - (255 - c) * amount);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
