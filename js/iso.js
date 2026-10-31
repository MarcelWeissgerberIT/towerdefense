import { HW, HH } from './config.js';

// grid (continuous tile coords) -> world px
export function toWorld(gx, gy) {
  return { x: (gx - gy) * HW, y: (gx + gy) * HH };
}
// world px -> grid coords
export function toGrid(wx, wy) {
  const a = wx / HW, b = wy / HH;
  return { x: (b + a) / 2, y: (b - a) / 2 };
}

export function dist(ax, ay, bx, by) {
  const dx = ax - bx, dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

// deterministic RNG for level decoration
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => a + Math.random() * (b - a);
