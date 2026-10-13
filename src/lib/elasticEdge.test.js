import {
  BULGE_PX,
  EDGE_INSET,
  FLAT_FILL,
  FLAT_SHADOWS,
  SHADOW_PX,
  SHADOW_STEPS,
  SHADOW_STROKE_PX,
  STRIP_OUT,
  STRIP_W,
  closeBulge,
  easeClose,
  easeOpen,
  edgeFillPath,
  edgeLinePath,
  edgeShadowPaths,
  openBulge,
  rowDelays,
} from './elasticEdge';

// Pull every number out of a path string as [x, y, x, y ...] pairs is not
// possible (H/V commands), so just return the flat list of numbers.
const nums = d => (d.match(/-?\d+(\.\d+)?/g) || []).map(Number);

// True when the path contains the point (x, y) as two consecutive numbers.
const hasPoint = (d, x, y) => {
  const n = nums(d);
  for (let i = 0; i < n.length - 1; i++) if (n[i] === x && n[i + 1] === y) return true;
  return false;
};

describe('constants', () => {
  test('strip size', () => {
    expect(STRIP_W).toBe(68);
    expect(STRIP_OUT).toBe(52);
  });
  test('shadow steps fit inside SHADOW_PX', () => {
    const maxOffset = Math.max(...SHADOW_STEPS.map(s => s.offset));
    expect(maxOffset + SHADOW_STROKE_PX / 2).toBeLessThanOrEqual(SHADOW_PX);
  });
});

describe('easing', () => {
  [easeOpen, easeClose].forEach(fn => {
    test(`${fn.name} endpoints, monotonic, clamped`, () => {
      expect(fn(0)).toBe(0);
      expect(fn(1)).toBe(1);
      expect(fn(-5)).toBe(0);
      expect(fn(5)).toBe(1);
      expect(fn(NaN)).toBe(0);
      let prev = 0;
      for (let i = 1; i <= 100; i++) {
        const v = fn(i / 100);
        expect(v).toBeGreaterThanOrEqual(prev);
        prev = v;
      }
    });
  });
});

describe('openBulge', () => {
  test('zero at and before 0 ms', () => {
    expect(openBulge(0)).toBe(0);
    expect(openBulge(-100)).toBe(0);
  });
  test('outward peak is about 40 px and is the global max', () => {
    let max = -Infinity;
    for (let t = 0; t <= 225; t++) max = Math.max(max, openBulge(t));
    expect(max).toBeGreaterThan(38);
    expect(max).toBeLessThanOrEqual(40);
    let globalMax = -Infinity;
    for (let t = 0; t <= 700; t++) globalMax = Math.max(globalMax, openBulge(t));
    expect(globalMax).toBe(max);
  });
  test('back to 0 at 450 ms', () => {
    expect(Math.abs(openBulge(450))).toBeLessThan(0.01);
  });
  test('one inward dip of about 8 px', () => {
    let min = Infinity;
    for (let t = 450; t <= 650; t++) min = Math.min(min, openBulge(t));
    expect(min).toBeLessThan(0);
    expect(min).toBeGreaterThanOrEqual(-8);
    expect(min).toBeLessThan(-7);
  });
  test('exactly 0 once settled', () => {
    [650, 700, 5000].forEach(t => expect(openBulge(t)).toBe(0));
  });
  test('continuous (no jumps larger than 1.5 px per ms)', () => {
    for (let t = 0; t <= 700; t++) {
      expect(Math.abs(openBulge(t + 1) - openBulge(t))).toBeLessThan(1.5);
    }
  });
  test('non-finite input gives 0', () => {
    expect(openBulge(NaN)).toBe(0);
    expect(openBulge(Infinity)).toBe(0);
    expect(openBulge(-Infinity)).toBe(0);
  });
});

describe('closeBulge', () => {
  test('shape and clamping', () => {
    expect(closeBulge(0)).toBe(0);
    expect(closeBulge(1)).toBeCloseTo(0, 9);
    expect(closeBulge(0.5)).toBeCloseTo(20, 9);
    expect(closeBulge(-1)).toBe(0);
    expect(closeBulge(2)).toBeCloseTo(0, 9);
  });
});

describe('edgeFillPath', () => {
  test('flat path uses only x = 0 and x = 16', () => {
    expect(edgeFillPath(0)).toBe(FLAT_FILL);
    // Every X coordinate: after M, H, and the x of each C pair / V has no x.
    const xs = new Set();
    FLAT_FILL.replace(/[MH](-?[\d.]+)/g, (_, v) => xs.add(Number(v)));
    FLAT_FILL.replace(/C(-?[\d.]+) [\d.]+ (-?[\d.]+) [\d.]+ (-?[\d.]+) [\d.]+/g, (_, a, b, c) => {
      [a, b, c].forEach(v => xs.add(Number(v)));
    });
    expect([...xs].sort((a, b) => a - b)).toEqual([0, 16]);
  });
  test('apex follows the bulge', () => {
    expect(hasPoint(edgeFillPath(40), 56, 500)).toBe(true);
    expect(hasPoint(edgeFillPath(-8), 8, 500)).toBe(true);
  });
  test('clamping', () => {
    expect(edgeFillPath(999)).toBe(edgeFillPath(40));
    expect(edgeFillPath(-999)).toBe(edgeFillPath(-14));
    expect(edgeFillPath(NaN)).toBe(FLAT_FILL);
  });
  test('never prints NaN or Infinity', () => {
    [NaN, Infinity, -Infinity, undefined, 0, 12.345, -3].forEach(b => {
      expect(edgeFillPath(b)).not.toMatch(/NaN|Infinity|undefined/);
      expect(edgeLinePath(b, b)).not.toMatch(/NaN|Infinity|undefined/);
    });
  });
});

describe('edgeLinePath and shadows', () => {
  test('apex x = 16 + offset + bulge', () => {
    expect(hasPoint(edgeLinePath(20, 3), EDGE_INSET + 3 + 20, 500)).toBe(true);
    expect(hasPoint(edgeLinePath(-6, 5), EDGE_INSET + 5 - 6, 500)).toBe(true);
    expect(edgeLinePath(0, 0).startsWith(`M${EDGE_INSET} 0`)).toBe(true);
  });
  test('edgeShadowPaths returns one string per step', () => {
    const p = edgeShadowPaths(BULGE_PX);
    expect(p).toHaveLength(6);
    p.forEach(s => expect(typeof s).toBe('string'));
    expect(FLAT_SHADOWS).toEqual(edgeShadowPaths(0));
  });
});

describe('rowDelays', () => {
  test('empty / invalid counts', () => {
    expect(rowDelays(0)).toEqual([]);
    expect(rowDelays(NaN)).toEqual([]);
  });
  test('small counts use the normal step', () => {
    expect(rowDelays(1)).toEqual([120]);
    expect(rowDelays(5)).toEqual([120, 145, 170, 195, 220]);
  });
  test('long lists are capped to a 200 ms spread with equal steps', () => {
    const d = rowDelays(14);
    expect(d).toHaveLength(14);
    expect(d[13] - d[0]).toBeLessThanOrEqual(200 + 1e-9);
    const step = d[1] - d[0];
    for (let i = 1; i < d.length; i++) expect(d[i] - d[i - 1]).toBeCloseTo(step, 9);
    d.forEach(v => expect(Number.isFinite(v)).toBe(true));
  });
});
