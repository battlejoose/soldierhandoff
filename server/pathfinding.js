import { TERRAIN } from '../shared/constants.js';
import { tileAt } from '../shared/map.js';

// A* over the tile grid. Cost is inversely proportional to terrain speed so
// soldiers prefer roads and avoid slow forest when a detour is cheap.
export function findPath(map, sx, sy, tx, ty) {
  const w = map.w, h = map.h;
  const start = { x: Math.floor(sx), y: Math.floor(sy) };
  let goal = { x: Math.floor(tx), y: Math.floor(ty) };

  const passable = (x, y) =>
    x >= 0 && y >= 0 && x < w && y < h && TERRAIN[tileAt(map, x + 0.5, y + 0.5)].passable;

  if (!passable(goal.x, goal.y)) {
    goal = nearestPassable(map, goal.x, goal.y);
    if (!goal) return null;
  }
  if (!passable(start.x, start.y)) {
    const s = nearestPassable(map, start.x, start.y);
    if (!s) return null;
    start.x = s.x; start.y = s.y;
  }

  const key = (x, y) => y * w + x;
  const open = new MinHeap();
  const gScore = new Map();
  const came = new Map();
  const startK = key(start.x, start.y);
  gScore.set(startK, 0);
  open.push({ x: start.x, y: start.y, f: heur(start, goal) });

  const DIRS = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
  ];

  let iterations = 0;
  while (open.size > 0 && iterations++ < 20000) {
    const cur = open.pop();
    const curK = key(cur.x, cur.y);
    if (cur.x === goal.x && cur.y === goal.y) {
      return reconstruct(came, curK, w, tx, ty);
    }
    const g = gScore.get(curK);
    for (const [dx, dy, base] of DIRS) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (!passable(nx, ny)) continue;
      // No diagonal corner cutting through impassable tiles
      if (dx !== 0 && dy !== 0 && (!passable(cur.x + dx, cur.y) || !passable(cur.x, cur.y + dy))) continue;
      const speed = TERRAIN[tileAt(map, nx + 0.5, ny + 0.5)].speedMult || 1;
      const cost = base / speed;
      const nk = key(nx, ny);
      const ng = g + cost;
      if (ng < (gScore.get(nk) ?? Infinity)) {
        gScore.set(nk, ng);
        came.set(nk, curK);
        open.push({ x: nx, y: ny, f: ng + heur({ x: nx, y: ny }, goal) });
      }
    }
  }
  return null;
}

function heur(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function reconstruct(came, endK, w, exactX, exactY) {
  const path = [];
  let k = endK;
  while (k !== undefined) {
    path.push({ x: (k % w) + 0.5, y: Math.floor(k / w) + 0.5 });
    k = came.get(k);
  }
  path.reverse();
  path.shift(); // drop current tile
  // Land exactly where the player clicked (still inside the goal tile)
  if (path.length > 0) { path[path.length - 1] = { x: exactX, y: exactY }; }
  else path.push({ x: exactX, y: exactY });
  return path;
}

function nearestPassable(map, x, y) {
  for (let r = 1; r < 12; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < map.w && ny < map.h &&
            TERRAIN[tileAt(map, nx + 0.5, ny + 0.5)].passable) {
          return { x: nx, y: ny };
        }
      }
    }
  }
  return null;
}

class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(n) {
    const a = this.a;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}
