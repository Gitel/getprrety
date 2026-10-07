// liquidReveal.js
// Pure geometry for the side menu "liquid" reveal. No DOM, no dependencies.
//
// How it is used: SideMenu.jsx runs a requestAnimationFrame loop. Every frame
// it calls liquidClipPath() with the current progress (0 = hidden, 1 = fully
// open) and the elapsed time, and writes the returned string to
// node.style.clipPath. The visible part of the panel is bounded by a wavy
// "front" edge that sweeps from the menu-button corner to the opposite corner.
//
// Coordinates are panel-local pixels. In LTR the origin corner is top-left
// (0,0) and the far corner is bottom-right (W,H). RTL mirrors x.

export const OPEN_MS = 450; // open duration
export const CLOSE_MS = 300; // close duration
export const EMPTY_POLYGON = 'polygon(0px 0px, 0px 0px, 0px 0px)';

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

const MARGIN = 10; // front starts/ends this far outside the corners
const AMPLITUDE = 32; // max wave height in px
const OMEGA = 9; // rad/s, about one cycle per 700 ms (the "flow")
const SAMPLES = 40;

// Wave shape along the front, in [-1, 1]. Two sines of different wavelength
// that travel at different speeds, so the edge looks like flowing liquid.
function wave(u, t) {
  const a = Math.sin((2 * Math.PI * u) / 260 - OMEGA * t);
  const b = Math.sin((2 * Math.PI * u) / 150 + 1.3 * OMEGA * t + 1);
  return (a + 0.35 * b) / 1.35;
}

const r1 = v => Math.round(v * 10) / 10;

export function liquidClipPath({ width, height, progress, timeMs = 0, rtl = false, offset = 0 }) {
  const ok = [width, height, progress, timeMs, offset].every(Number.isFinite);
  if (!ok || width <= 0 || height <= 0 || progress <= 0) return EMPTY_POLYGON;
  if (progress >= 1) return 'none';

  const p = progress;
  const t = timeMs / 1000;
  const L = Math.hypot(width, height);
  // d: unit vector along the diagonal (origin -> far corner).
  const dx = width / L;
  const dy = height / L;
  // n: unit normal to d; u = dot(point, n) is the position ALONG the front.
  const nx = -height / L;
  const ny = width / L;
  // s0: how far along d the (flat) front is. Starts just outside the origin
  // corner and ends just past the far corner.
  const s0 = -MARGIN + p * (L + 2 * MARGIN);
  // Aenv: wave height, zero at p=0 and p=1 so the start/end are calm.
  const aEnv = AMPLITUDE * Math.sin(Math.PI * p);
  // U: half-length of the front, enough to cover every panel corner.
  const U = (width * height) / L + 40;

  const pts = [];
  for (let i = 0; i < SAMPLES; i++) {
    const u = -U + (2 * U * i) / (SAMPLES - 1);
    // s: front position along d at this u; offset pushes it further forward.
    const s = s0 + aEnv * wave(u, t) + offset;
    pts.push([dx * s + nx * u, dy * s + ny * u]);
  }
  // Two closing points far behind the origin so the polygon covers the
  // revealed side completely.
  const back = -(60 + AMPLITUDE);
  pts.push([dx * back + nx * U, dy * back + ny * U]);
  pts.push([dx * back - nx * U, dy * back - ny * U]);

  const coords = pts.map(([x, y]) => `${r1(rtl ? width - x : x)}px ${r1(y)}px`);
  return `polygon(${coords.join(', ')})`;
}
