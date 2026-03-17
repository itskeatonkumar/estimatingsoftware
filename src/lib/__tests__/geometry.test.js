/**
 * Geometry calculation tests — these functions directly affect bid totals.
 * Wrong area = wrong price = lost bid or negative margin.
 * 
 * Run: npx vitest run src/lib/__tests__/geometry.test.js
 */
import { describe, it, expect } from 'vitest';
import {
  calcArea, calcLinear, bezierPt, bezierLength,
  calcShapeArea, calcShapeLength, buildShapePath,
  normalizeShapes, splitShapeHoles, pointInPoly,
  clipPolygonToOuter, calcShapeNetArea, snapToAngle, idMatch,
} from '../geometry.js';

describe('calcArea', () => {
  it('returns 0 for fewer than 3 points', () => {
    expect(calcArea([], 1)).toBe(0);
    expect(calcArea([{x:0,y:0}, {x:1,y:1}], 1)).toBe(0);
  });

  it('returns 0 when scale is null', () => {
    expect(calcArea([{x:0,y:0}, {x:10,y:0}, {x:10,y:10}], null)).toBe(0);
  });

  it('calculates a right triangle correctly', () => {
    // 10x10 right triangle = 50 sq px. At scale=1 (1px=1ft), area = 50 SF
    const pts = [{x:0,y:0}, {x:10,y:0}, {x:10,y:10}];
    expect(calcArea(pts, 1)).toBeCloseTo(50, 5);
  });

  it('calculates a square correctly', () => {
    // 100x100 square = 10000 sq px. At scale=10 (10px=1ft), area = 100 SF
    const pts = [{x:0,y:0}, {x:100,y:0}, {x:100,y:100}, {x:0,y:100}];
    expect(calcArea(pts, 10)).toBeCloseTo(100, 5);
  });

  it('handles clockwise and counter-clockwise winding', () => {
    const ccw = [{x:0,y:0}, {x:10,y:0}, {x:10,y:10}, {x:0,y:10}];
    const cw = [{x:0,y:0}, {x:0,y:10}, {x:10,y:10}, {x:10,y:0}];
    expect(calcArea(ccw, 1)).toBeCloseTo(calcArea(cw, 1), 5);
  });

  it('scales correctly with construction scales', () => {
    // 192px = 1ft at 1/16"=1' (ratio 192). 
    // 192x192 square = 36864 sq px = 1 SF
    const pts = [{x:0,y:0}, {x:192,y:0}, {x:192,y:192}, {x:0,y:192}];
    expect(calcArea(pts, 192)).toBeCloseTo(1, 2);
  });
});

describe('calcLinear', () => {
  it('returns 0 when scale is null', () => {
    expect(calcLinear({x:0,y:0}, {x:10,y:0}, null)).toBe(0);
  });

  it('calculates horizontal distance', () => {
    expect(calcLinear({x:0,y:0}, {x:100,y:0}, 10)).toBeCloseTo(10, 5);
  });

  it('calculates diagonal distance', () => {
    // 30-40-50 triangle
    expect(calcLinear({x:0,y:0}, {x:30,y:40}, 1)).toBeCloseTo(50, 5);
  });
});

describe('bezierPt', () => {
  it('returns start point at t=0', () => {
    const pt = bezierPt({x:0,y:0}, {x:5,y:10}, {x:10,y:0}, 0);
    expect(pt.x).toBeCloseTo(0);
    expect(pt.y).toBeCloseTo(0);
  });

  it('returns end point at t=1', () => {
    const pt = bezierPt({x:0,y:0}, {x:5,y:10}, {x:10,y:0}, 1);
    expect(pt.x).toBeCloseTo(10);
    expect(pt.y).toBeCloseTo(0);
  });

  it('returns midpoint at t=0.5', () => {
    const pt = bezierPt({x:0,y:0}, {x:5,y:10}, {x:10,y:0}, 0.5);
    expect(pt.x).toBeCloseTo(5);
    expect(pt.y).toBeCloseTo(5);
  });
});

describe('normalizeShapes', () => {
  it('wraps flat points array into [[pts]]', () => {
    const pts = [{x:0,y:0}, {x:1,y:1}];
    const result = normalizeShapes(pts);
    expect(result).toEqual([pts]);
  });

  it('passes through already-nested arrays', () => {
    const pts = [[{x:0,y:0}], [{x:1,y:1}]];
    expect(normalizeShapes(pts)).toEqual(pts);
  });

  it('returns empty for empty input', () => {
    expect(normalizeShapes([])).toEqual([]);
    expect(normalizeShapes(null)).toEqual([]);
  });
});

describe('splitShapeHoles', () => {
  it('returns all points as outer when no holes', () => {
    const pts = [{x:0,y:0}, {x:10,y:0}, {x:10,y:10}];
    const { outer, holes } = splitShapeHoles(pts);
    expect(outer).toEqual(pts);
    expect(holes).toEqual([]);
  });

  it('splits on _holeStart marker', () => {
    const pts = [
      {x:0,y:0}, {x:10,y:0}, {x:10,y:10},
      {_holeStart: true, x:0, y:0},
      {x:2,y:2}, {x:4,y:2}, {x:4,y:4},
    ];
    const { outer, holes } = splitShapeHoles(pts);
    expect(outer).toHaveLength(3);
    expect(holes).toHaveLength(1);
    expect(holes[0]).toHaveLength(3);
  });

  it('handles multiple holes', () => {
    const pts = [
      {x:0,y:0}, {x:10,y:0},
      {_holeStart: true, x:0, y:0},
      {x:1,y:1},
      {_holeStart: true, x:0, y:0},
      {x:5,y:5},
    ];
    const { outer, holes } = splitShapeHoles(pts);
    expect(outer).toHaveLength(2);
    expect(holes).toHaveLength(2);
  });
});

describe('pointInPoly', () => {
  const square = [{x:0,y:0}, {x:10,y:0}, {x:10,y:10}, {x:0,y:10}];

  it('detects point inside', () => {
    expect(pointInPoly({x:5, y:5}, square)).toBe(true);
  });

  it('detects point outside', () => {
    expect(pointInPoly({x:15, y:5}, square)).toBe(false);
  });

  it('detects point far outside', () => {
    expect(pointInPoly({x:-5, y:-5}, square)).toBe(false);
  });
});

describe('calcShapeNetArea', () => {
  it('returns outer area when no holes', () => {
    const pts = [{x:0,y:0}, {x:100,y:0}, {x:100,y:100}, {x:0,y:100}];
    expect(calcShapeNetArea(pts, 1)).toBeCloseTo(10000, 0);
  });

  it('subtracts hole area from outer', () => {
    const pts = [
      // Outer: 100x100 = 10000
      {x:0,y:0}, {x:100,y:0}, {x:100,y:100}, {x:0,y:100},
      // Hole: 20x20 = 400
      {_holeStart: true, x:0, y:0},
      {x:10,y:10}, {x:30,y:10}, {x:30,y:30}, {x:10,y:30},
    ];
    expect(calcShapeNetArea(pts, 1)).toBeCloseTo(9600, 0);
  });

  it('clips hole that extends outside outer', () => {
    const pts = [
      // Outer: 100x100 = 10000
      {x:0,y:0}, {x:100,y:0}, {x:100,y:100}, {x:0,y:100},
      // Hole extends outside: only portion inside should be subtracted
      {_holeStart: true, x:0, y:0},
      {x:80,y:80}, {x:120,y:80}, {x:120,y:120}, {x:80,y:120},
    ];
    const net = calcShapeNetArea(pts, 1);
    // Hole inside outer = 20x20 = 400. Net should be 10000-400 = 9600
    expect(net).toBeCloseTo(9600, -1); // allow ±10 for clipping precision
  });

  it('never returns negative', () => {
    const pts = [
      {x:0,y:0}, {x:10,y:0}, {x:10,y:10}, {x:0,y:10},
      {_holeStart: true, x:0, y:0},
      {x:-100,y:-100}, {x:200,y:-100}, {x:200,y:200}, {x:-100,y:200},
    ];
    expect(calcShapeNetArea(pts, 1)).toBeGreaterThanOrEqual(0);
  });
});

describe('idMatch', () => {
  it('matches int to string', () => {
    expect(idMatch(72, '72')).toBe(true);
  });

  it('matches string to string', () => {
    expect(idMatch('abc', 'abc')).toBe(true);
  });

  it('rejects mismatches', () => {
    expect(idMatch(72, '73')).toBe(false);
  });
});

describe('snapToAngle', () => {
  it('returns to when disabled', () => {
    const to = {x: 17, y: 23};
    expect(snapToAngle({x:0,y:0}, to, false)).toEqual(to);
  });

  it('returns to when from is null', () => {
    const to = {x: 17, y: 23};
    expect(snapToAngle(null, to, true)).toEqual(to);
  });

  it('snaps to 0° for nearly horizontal', () => {
    const result = snapToAngle({x:0,y:0}, {x:100,y:3}, true);
    expect(result.y).toBe(0);
    expect(result.x).toBeGreaterThan(90);
  });

  it('snaps to 90° for nearly vertical', () => {
    const result = snapToAngle({x:0,y:0}, {x:3,y:100}, true);
    expect(result.x).toBe(0);
    expect(result.y).toBeGreaterThan(90);
  });
});

describe('buildShapePath', () => {
  it('builds a simple polygon path', () => {
    const pts = [{x:0,y:0}, {x:10,y:0}, {x:10,y:10}];
    const d = buildShapePath(pts, true);
    expect(d).toContain('M');
    expect(d).toContain('L');
    expect(d).toContain('Z');
  });

  it('builds quadratic bezier for _ctrl points', () => {
    const pts = [{x:0,y:0}, {x:5,y:10,_ctrl:true}, {x:10,y:0}];
    const d = buildShapePath(pts, false);
    expect(d).toContain('Q');
  });

  it('returns empty string for empty input', () => {
    expect(buildShapePath([])).toBe('');
    expect(buildShapePath(null)).toBe('');
  });
});
