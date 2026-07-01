import {
  T, SOLDIER,
  HILL_VISION_MULT, FOREST_VISION_MULT, FOREST_SEE_DEPTH,
} from './constants.js';
import { tileAt, tileHeight } from './map.js';

export const CLOSE_RANGE = 4; // omnidirectional awareness radius (tiles)

// Effective vision range for a soldier given the terrain they stand on
export function visionRangeFor(map, sx, sy) {
  const t = tileAt(map, sx, sy);
  let r = SOLDIER.visionRange;
  if (t === T.HILL) r *= HILL_VISION_MULT;
  if (t === T.FOREST) r *= FOREST_VISION_MULT;
  return r;
}

// Line of sight between two points, respecting rocks, hill elevation and forest density.
// Returns true if unobstructed.
export function hasLineOfSight(map, x0, y0, x1, y1) {
  const obsH = tileHeight(map, x0, y0);
  const tgtH = tileHeight(map, x1, y1);
  const maxH = Math.max(obsH, tgtH);
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(dist * 2)); // sample every half tile
  let forestCrossed = 0;
  const targetInForest = tileAt(map, x1, y1) === T.FOREST;

  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    const tile = tileAt(map, x, y);
    if (tile === T.ROCK) return false;
    // Hills block sight unless the observer or target stands at that height or above
    if (tile === T.HILL && tileHeight(map, x, y) > maxH) return false;
    if (tile === T.FOREST) {
      forestCrossed += 0.5; // half-tile samples
      // You can see a couple tiles into a forest, not through a deep one —
      // unless the target is inside the forest within that depth.
      const budget = targetInForest ? FOREST_SEE_DEPTH : FOREST_SEE_DEPTH - 0.5;
      if (forestCrossed > budget) return false;
    }
  }
  return true;
}

// Can observer (with facing angle, radians) see the target point?
export function canSeePoint(map, obs, tx, ty) {
  const dx = tx - obs.x, dy = ty - obs.y;
  const dist = Math.hypot(dx, dy);
  const range = visionRangeFor(map, obs.x, obs.y);
  if (dist > range) return false;
  if (dist > CLOSE_RANGE) {
    let da = Math.atan2(dy, dx) - obs.facing;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    if (Math.abs(da) > SOLDIER.visionFov / 2) return false;
  }
  return hasLineOfSight(map, obs.x, obs.y, tx, ty);
}
