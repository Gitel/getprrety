// elasticEdge.js
// Pure geometry + timing for the side menu "elastic edge". No DOM, no dependencies.
//
// How it is used: SideMenu.jsx runs a requestAnimationFrame loop. Every frame
// it writes three things to the DOM: the panel's CSS transform (the slide),
// the dim layer opacity, and the SVG path strings returned by edgeFillPath()
// and edgeShadowPaths() for the current bulge. The SVG strip sits on the
// panel's trailing edge and shows ONE smooth bulge at the middle of the screen
// height. Right-to-left mirroring is done by CSS in SideMenu, NOT here: all
// drawing in this file is left-to-right (bulge toward +x).
//
// Strip geometry: the SVG uses viewBox="0 0 STRIP_W VIEW_H" with
// preserveAspectRatio="none", so x units are real pixels and y units (0..1000)
// are stretched to the screen height. x = 0 in the strip is EDGE_INSET px
// INSIDE the panel; the panel's real straight edge is at x = EDGE_INSET.

// ---- Timing (milliseconds) ----
export const OPEN_MS = 450; // panel slide-in duration
export const CLOSE_MS = 300; // panel slide-out duration
export const OPEN_SETTLE_MS = 650; // the edge wobble is finished (flat) from this time on
export const BLEND_MS = 80; // when an animation reverses mid-way, the old bulge fades out over this time

// ---- Bulge sizes (pixels) ----
export const BULGE_PX = 40; // max outward bulge while opening
export const DIP_PX = 8; // depth of the single inward wobble after the panel lands
export const CLOSE_BULGE_PX = 20; // slight drag curve while closing

// ---- Strip layout (pixels) ----
export const EDGE_INSET = 16; // px of the panel, inside its edge, that the strip paints
export const SHADOW_PX = 12; // room for the shadow outside the largest bulge
export const STRIP_W = EDGE_INSET + BULGE_PX + SHADOW_PX; // 68, strip width in px
export const STRIP_OUT = BULGE_PX + SHADOW_PX; // 52, how far the strip sticks out beyond the panel's straight edge

// ---- Strip drawing (viewBox units, 0..1000 along the height) ----
export const VIEW_H = 1000; // viewBox height units
export const BELL_CENTER = 500; // bulge centre: the middle of the height
export const BELL_HALF = 420; // half the height of the bell, in view units
export const SHADOW_STROKE_PX = 2; // width of each shadow stroke
// Soft shadow = a few thin strokes following the edge curve, each shifted
// further out (+x). offset = px further out than the edge; alpha fades out.
export const SHADOW_STEPS = [
  { offset: 1, alpha: 0.07 },
  { offset: 3, alpha: 0.05 },
  { offset: 5, alpha: 0.035 },
  { offset: 7, alpha: 0.022 },
  { offset: 9, alpha: 0.012 },
  { offset: 11, alpha: 0.006 },
];

// ---- Row stagger (milliseconds / pixels) ----
export const ROW_START_MS = 120; // first row starts fading in this long after the open starts
export const ROW_STEP_MS = 25; // gap between rows
export const ROW_SPREAD_CAP_MS = 200; // the last row starts at most this long after the first
export const ROW_SHIFT_PX = 16; // rows slide in from this far
export const ROW_DURATION_MS = 260; // each row's fade/slide

// Non-finite numbers become 0, everything else is clamped into [0, 1].
const clamp01 = t => (Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0);

// Ease-out cubic: fast start, soft stop (opening).
export function easeOpen(t) {
  const c = clamp01(t);
  return 1 - (1 - c) ** 3;
}

// Ease-out quad: no slow start (closing time -> distance mapping).
export function easeClose(t) {
  const c = clamp01(t);
  return 1 - (1 - c) ** 2;
}

// Avoid returning -0 (it prints as "0" but fails toBe(0) style checks).
const noNegZero = v => (v === 0 ? 0 : v);

// Bulge in px at `ms` after the open started. Positive = outward.
//  - 0..OPEN_MS: one outward hump (peak ~40 px at ~179 ms, back to 0 at 450 ms).
//    The 0.75 power makes the rise faster than the fall.
//  - OPEN_MS..OPEN_SETTLE_MS: one small inward dip (down to -DIP_PX).
//  - afterwards: exactly 0 (flat edge).
export function openBulge(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  if (ms <= OPEN_MS) return noNegZero(BULGE_PX * Math.sin(Math.PI * (ms / OPEN_MS) ** 0.75));
  if (ms < OPEN_SETTLE_MS) {
    return noNegZero(-DIP_PX * Math.sin((Math.PI * (ms - OPEN_MS)) / (OPEN_SETTLE_MS - OPEN_MS)));
  }
  return 0;
}

// Bulge in px while closing; tau = close progress 0..1 (clamped).
// 0 at both ends, CLOSE_BULGE_PX in the middle. No wobble.
export function closeBulge(tau) {
  return noNegZero(CLOSE_BULGE_PX * Math.sin(Math.PI * clamp01(tau)));
}

// Round to 1 decimal. String() of the result has no trailing ".0" noise.
const r1 = v => Math.round(v * 10) / 10;
const num = v => String(noNegZero(r1(v)));

// Keep the bulge inside what the strip can draw: at most BULGE_PX outward and
// at most (EDGE_INSET - 2) px inward so the edge never leaves the strip.
const clampBulge = b =>
  Number.isFinite(b) ? Math.min(BULGE_PX, Math.max(-(EDGE_INSET - 2), b)) : 0;

// Shared edge curve (no start "M"): straight line down to the bell, a cubic up
// to the apex, a cubic back down, then straight to the bottom. Both cubics have
// vertical tangents at their ends, so the bell is smooth with no corner.
// x0 = x of the straight edge, x1 = x of the apex.
function edgeCurve(x0, x1) {
  const c = BELL_CENTER;
  const h = BELL_HALF;
  const n = num;
  return (
    `V${n(c - h)} ` +
    `C${n(x0)} ${n(c - h / 2)} ${n(x1)} ${n(c - h / 2)} ${n(x1)} ${n(c)} ` +
    `C${n(x1)} ${n(c + h / 2)} ${n(x0)} ${n(c + h / 2)} ${n(x0)} ${n(c + h)} ` +
    `V${n(VIEW_H)}`
  );
}

// SVG `d` string of the FILLED shape (panel colour) in viewBox units, LTR.
// It paints the last EDGE_INSET px of the panel plus the bulge.
export function edgeFillPath(bulgePx) {
  const b = clampBulge(bulgePx);
  const I = EDGE_INSET;
  return `M0 0 H${num(I)} ${edgeCurve(I, I + b)} H0 Z`;
}

// The same edge curve as an OPEN path (stroke only), shifted +offsetPx in x.
export function edgeLinePath(bulgePx, offsetPx) {
  const b = clampBulge(bulgePx);
  const o = Number.isFinite(offsetPx) ? offsetPx : 0;
  const x0 = EDGE_INSET + o;
  return `M${num(x0)} 0 ${edgeCurve(x0, x0 + b)}`;
}

// One open path per SHADOW_STEPS entry, following the current edge curve.
export function edgeShadowPaths(bulgePx) {
  return SHADOW_STEPS.map(s => edgeLinePath(bulgePx, s.offset));
}

// Resting (no bulge) strings, handy as the initial / final DOM values.
export const FLAT_FILL = edgeFillPath(0);
export const FLAT_SHADOWS = edgeShadowPaths(0);

// Start delays (ms) for `count` staggered rows. Rows start ROW_STEP_MS apart,
// but the step shrinks for long lists so the last row starts at most
// ROW_SPREAD_CAP_MS after the first. Invalid / empty counts give [].
export function rowDelays(count) {
  if (!Number.isFinite(count) || count < 1) return [];
  const n = Math.floor(count);
  const step = n > 1 ? Math.min(ROW_STEP_MS, ROW_SPREAD_CAP_MS / (n - 1)) : 0;
  return Array.from({ length: n }, (_, i) => ROW_START_MS + i * step);
}
