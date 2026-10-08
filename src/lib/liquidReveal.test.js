import { EMPTY_POLYGON, easeClose, easeOpen, liquidClipPath } from './liquidReveal';

const W = 320;
const H = 844;

// Parse 'polygon(1px 2px, ...)' into [[x, y], ...].
function parse(str) {
  return str
    .slice('polygon('.length, -1)
    .split(',')
    .map(s => s.trim().split(' ').map(parseFloat));
}

// Ray-casting point-in-polygon test.
function inside(str, x, y) {
  if (str === 'none') return true;
  const pts = parse(str);
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

// A 20x40 grid of points covering the panel.
const GRID = [];
for (let i = 0; i < 20; i++) {
  for (let j = 0; j < 40; j++) GRID.push([((i + 0.5) * W) / 20, ((j + 0.5) * H) / 40]);
}

const coverage = str => GRID.filter(([x, y]) => inside(str, x, y)).length / GRID.length;
const clip = (progress, extra = {}) => liquidClipPath({ width: W, height: H, progress, ...extra });

describe('liquidClipPath edge cases', () => {
  test('progress 0 is the empty polygon', () => {
    expect(clip(0)).toBe(EMPTY_POLYGON);
  });

  test('progress 1 and above is none', () => {
    expect(clip(1)).toBe('none');
    expect(clip(1.5)).toBe('none');
  });

  test('negative / NaN progress or zero size is empty', () => {
    expect(clip(-0.2)).toBe(EMPTY_POLYGON);
    expect(clip(NaN)).toBe(EMPTY_POLYGON);
    expect(liquidClipPath({ width: 0, height: H, progress: 0.5 })).toBe(EMPTY_POLYGON);
    expect(liquidClipPath({ width: W, height: 0, progress: 0.5 })).toBe(EMPTY_POLYGON);
  });

  test('never outputs NaN across a sweep', () => {
    for (let p = 0; p <= 1.001; p += 0.05) {
      for (const t of [0, 100, 450, 1234]) {
        expect(clip(p, { timeMs: t })).not.toMatch(/NaN/);
        expect(clip(p, { timeMs: t, rtl: true, offset: 9 })).not.toMatch(/NaN/);
      }
    }
  });
});

describe('liquidClipPath geometry (LTR)', () => {
  test('small progress: origin corner inside, far corner outside', () => {
    const s = clip(0.08);
    expect(inside(s, 4, 4)).toBe(true);
    expect(inside(s, 316, 840)).toBe(false);
  });

  test('half progress: origin inside, far corner outside', () => {
    const s = clip(0.5);
    expect(inside(s, 4, 4)).toBe(true);
    expect(inside(s, 316, 840)).toBe(false);
  });

  test('0.97 progress: most of the panel is inside', () => {
    expect(coverage(clip(0.97))).toBeGreaterThan(0.85);
  });

  test('coverage only grows with progress', () => {
    for (const t of [0, 200, 777]) {
      let prev = 0;
      for (let p = 0.05; p < 0.96; p += 0.05) {
        const cov = coverage(clip(p, { timeMs: t }));
        expect(cov).toBeGreaterThanOrEqual(prev);
        prev = cov;
      }
    }
  });
});

describe('liquidClipPath rtl / offset / motion', () => {
  test('RTL: top-right corner is inside at small progress', () => {
    const s = clip(0.08, { rtl: true });
    expect(inside(s, W - 4, 4)).toBe(true);
    expect(inside(s, 4, 840)).toBe(false);
  });

  test('RTL mirrors LTR horizontally', () => {
    for (const [p, t] of [[0.2, 0], [0.5, 150], [0.8, 333]]) {
      const ltr = clip(p, { timeMs: t });
      const rtl = clip(p, { timeMs: t, rtl: true });
      for (const [x, y] of GRID) {
        expect(inside(rtl, W - x, y)).toBe(inside(ltr, x, y));
      }
    }
  });

  test('offset only grows the revealed area (superset)', () => {
    for (const p of [0.1, 0.5, 0.9]) {
      const base = clip(p, { timeMs: 120 });
      const shifted = clip(p, { timeMs: 120, offset: 9 });
      for (const [x, y] of GRID) {
        if (inside(base, x, y)) expect(inside(shifted, x, y)).toBe(true);
      }
    }
  });

  test('the wave moves with time', () => {
    expect(clip(0.5, { timeMs: 0 })).not.toBe(clip(0.5, { timeMs: 200 }));
  });
});

describe.each([['easeOpen', easeOpen], ['easeClose', easeClose]])('%s', (_name, fn) => {
  test('endpoints are 0 and 1', () => {
    expect(fn(0)).toBe(0);
    expect(fn(1)).toBe(1);
  });

  test('is monotonic', () => {
    let prev = -1;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      expect(fn(t)).toBeGreaterThanOrEqual(prev);
      prev = fn(t);
    }
  });

  test('clamps out-of-range input', () => {
    expect(fn(-1)).toBe(0);
    expect(fn(2)).toBe(1);
  });

  test('has a fast start', () => {
    expect(fn(0.1)).toBeGreaterThan(0.1);
  });
});
