/**
 * Geometry and measurement calculation utilities for takeoff
 * Pure functions — no React, no Supabase, no side effects
 */

// ── Area: Shoelace formula (px² → ft² using scale) ─────
export function calcArea(pts, scale) {
  if (!scale || pts.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(a) / 2 / (scale * scale);
}

// ── Linear: distance between two points (px → ft) ──────
export function calcLinear(p1, p2, scale) {
  if (!scale) return 0;
  return Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2) / scale;
}

// ── Bezier point at parameter t ─────────────────────────
export function bezierPt(p0, ctrl, p1, t) {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * ctrl.x + t * t * p1.x,
    y: u * u * p0.y + 2 * u * t * ctrl.y + t * t * p1.y,
  };
}

// ── Bezier arc length (numeric integration) ─────────────
export function bezierLength(p0, ctrl, p1, steps = 30) {
  let len = 0;
  let prev = p0;
  for (let i = 1; i <= steps; i++) {
    const cur = bezierPt(p0, ctrl, p1, i / steps);
    len += Math.hypot(cur.x - prev.x, cur.y - prev.y);
    prev = cur;
  }
  return len;
}

// ── Area with arc segments (expand beziers for shoelace) ─
export function calcShapeArea(expandedPts, scale) {
  const expanded = [];
  let i = 0;
  while (i < expandedPts.length) {
    if (expandedPts[i + 1]?._ctrl && i + 2 < expandedPts.length) {
      for (let s = 0; s <= 20; s++) {
        expanded.push(bezierPt(expandedPts[i], expandedPts[i + 1], expandedPts[i + 2], s / 20));
      }
      i += 3;
    } else {
      expanded.push(expandedPts[i]);
      i++;
    }
  }
  return calcArea(expanded, scale);
}

// ── Length with arc segments ─────────────────────────────
export function calcShapeLength(pts) {
  if (!pts || pts.length < 2) return 0;
  let total = 0;
  let i = 1;
  while (i < pts.length) {
    if (pts[i]?._ctrl && i + 1 < pts.length) {
      total += bezierLength(pts[i - 1] ?? pts[0], pts[i], pts[i + 1]);
      i += 2;
    } else {
      const a = pts[i - 1] ?? pts[0];
      const b = pts[i];
      total += Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
      i++;
    }
  }
  return total;
}

// ── Build SVG path from points (handles bezier ctrl pts) ─
export function buildShapePath(pts, close = false) {
  if (!pts || !pts.length) return '';
  let d = `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
  let i = 1;
  while (i < pts.length) {
    if (pts[i]?._ctrl && i + 1 < pts.length) {
      d += ` Q${pts[i].x.toFixed(2)},${pts[i].y.toFixed(2)} ${pts[i + 1].x.toFixed(2)},${pts[i + 1].y.toFixed(2)}`;
      i += 2;
    } else {
      d += ` L${pts[i].x.toFixed(2)},${pts[i].y.toFixed(2)}`;
      i++;
    }
  }
  if (close) d += ' Z';
  return d;
}

// ── Normalize points to array-of-shapes format ──────────
// Legacy: [{x,y},...] → wrap in outer array
// New: [[{x,y},...], ...] — multiple shapes per condition
export function normalizeShapes(pts) {
  if (!pts || pts.length === 0) return [];
  if (Array.isArray(pts[0])) return pts;
  if (pts[0] && typeof pts[0].x === 'number') return [pts];
  return pts;
}

// ── Split shape into outer boundary + embedded holes ────
// Holes separated by {_holeStart:true} markers
export function splitShapeHoles(pts) {
  if (!pts || !pts.length) return { outer: [], holes: [] };
  const segments = [];
  let cur = [];
  for (const p of pts) {
    if (p._holeStart) {
      if (cur.length) segments.push(cur);
      cur = [];
    } else {
      cur.push(p);
    }
  }
  if (cur.length) segments.push(cur);
  return { outer: segments[0] || [], holes: segments.slice(1) };
}

// ── Point-in-polygon (ray casting) ──────────────────────
export function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    if (((yi > pt.y) !== (yj > pt.y)) && (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

// ── Sutherland-Hodgman polygon clipping ─────────────────
// Clips subject polygon to clip polygon boundary
export function clipPolygonToOuter(subject, clip) {
  if (!subject.length || !clip.length) return [];
  let signedArea = 0;
  for (let i = 0; i < clip.length; i++) {
    const j = (i + 1) % clip.length;
    signedArea += clip[i].x * clip[j].y - clip[j].x * clip[i].y;
  }
  const flip = signedArea > 0 ? 1 : -1;

  let output = subject.map(p => ({ x: p.x, y: p.y }));
  for (let i = 0; i < clip.length; i++) {
    if (!output.length) return [];
    const input = [...output];
    output = [];
    const a = clip[i], b = clip[(i + 1) % clip.length];
    const inside = (p) => flip * ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) >= 0;
    const intersect = (p1, p2) => {
      const x1 = p1.x, y1 = p1.y, x2 = p2.x, y2 = p2.y;
      const x3 = a.x, y3 = a.y, x4 = b.x, y4 = b.y;
      const d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
      if (Math.abs(d) < 1e-10) return p1;
      const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / d;
      return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) };
    };
    for (let j = 0; j < input.length; j++) {
      const cur = input[j];
      const prev = input[(j + input.length - 1) % input.length];
      const curIn = inside(cur), prevIn = inside(prev);
      if (curIn) {
        if (!prevIn) output.push(intersect(prev, cur));
        output.push(cur);
      } else if (prevIn) {
        output.push(intersect(prev, cur));
      }
    }
  }
  return output;
}

// ── Net area: outer minus clipped holes ─────────────────
export function calcShapeNetArea(pts, scale) {
  const { outer, holes } = splitShapeHoles(pts);
  if (outer.length < 3) return 0;
  const outerClean = outer.filter(p => !p._ctrl);
  const outerArea = Math.abs(outer.some(p => p._ctrl) ? calcShapeArea(outer, scale) : calcArea(outer, scale));
  const holesArea = holes.reduce((s, h) => {
    const hClean = h.filter(p => !p._ctrl);
    if (hClean.length < 3) return s;
    const clipped = clipPolygonToOuter(hClean, outerClean);
    if (clipped.length < 3) return s;
    return s + Math.abs(calcArea(clipped, scale));
  }, 0);
  return Math.max(0, outerArea - holesArea);
}

// ── Snap to angle (45/60/90°) ───────────────────────────
export function snapToAngle(from, to, enabled = false) {
  if (!from || !enabled) return to;
  const dx = to.x - from.x, dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 2) return to;
  const deg = Math.atan2(dy, dx) * 180 / Math.PI;
  const snaps = [0, 45, 60, 90, 135, 150, 180, 225, 240, 270, 315, 300, 360, -45, -60, -90, -135, -150, -180, -225, -240, -270, -300, -315];
  const best = snaps.reduce((b, a) => {
    const d = Math.abs(((deg - a) + 540) % 360 - 180);
    return d < b.diff ? { a, diff: d } : b;
  }, { a: 0, diff: Infinity }).a;
  const rad = best * Math.PI / 180;
  return { x: Math.round(from.x + len * Math.cos(rad)), y: Math.round(from.y + len * Math.sin(rad)) };
}

// ── String-safe ID comparison (handles int vs string) ───
export function idMatch(a, b) {
  return String(a) === String(b);
}
