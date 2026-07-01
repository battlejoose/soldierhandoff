import { MAP_W, MAP_H, T, TERRAIN } from './constants.js';
import { mulberry32 } from './rng.js';

// Generates a symmetric-ish battlefield: grass base, a road across the middle,
// forest patches, hills, impassable rocks and water. Deterministic per seed.
export function generateMap(seed) {
  const rng = mulberry32(seed);
  const tiles = new Uint8Array(MAP_W * MAP_H).fill(T.GRASS);
  const idx = (x, y) => y * MAP_W + x;
  const inB = (x, y) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;

  // Stamp a feature at (cx,cy) and mirror it across the map center for fairness
  function blobMirrored(cx, cy, r, type, irregular = 0.35) {
    for (const [bx, by] of [[cx, cy], [MAP_W - 1 - cx, MAP_H - 1 - cy]]) {
      for (let y = Math.floor(by - r); y <= Math.ceil(by + r); y++) {
        for (let x = Math.floor(bx - r); x <= Math.ceil(bx + r); x++) {
          if (!inB(x, y)) continue;
          const d = Math.hypot(x - bx, y - by);
          if (d <= r * (1 - irregular + rng() * irregular * 2)) tiles[idx(x, y)] = type;
        }
      }
    }
  }

  // Winding road connecting the two spawn sides
  let ry = MAP_H / 2;
  for (let x = 0; x < MAP_W; x++) {
    ry += (rng() - 0.5) * 2.0;
    ry = Math.max(8, Math.min(MAP_H - 8, ry));
    const yy = Math.round(ry);
    for (let w = -1; w <= 1; w++) if (inB(x, yy + w)) tiles[idx(x, yy + w)] = T.ROAD;
  }

  // Forests
  const nForest = 7 + Math.floor(rng() * 4);
  for (let i = 0; i < nForest; i++) {
    blobMirrored(10 + rng() * (MAP_W / 2 - 14), 8 + rng() * (MAP_H - 16), 4 + rng() * 5, T.FOREST);
  }
  // Hills
  const nHill = 4 + Math.floor(rng() * 3);
  for (let i = 0; i < nHill; i++) {
    blobMirrored(14 + rng() * (MAP_W / 2 - 18), 10 + rng() * (MAP_H - 20), 3 + rng() * 4, T.HILL, 0.25);
  }
  // Rocks (hard cover, blocks movement and sight)
  const nRock = 6 + Math.floor(rng() * 4);
  for (let i = 0; i < nRock; i++) {
    blobMirrored(16 + rng() * (MAP_W / 2 - 20), 10 + rng() * (MAP_H - 20), 1.5 + rng() * 2, T.ROCK, 0.2);
  }
  // Water pools
  const nWater = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < nWater; i++) {
    blobMirrored(18 + rng() * (MAP_W / 2 - 24), 12 + rng() * (MAP_H - 24), 2.5 + rng() * 3, T.WATER, 0.3);
  }

  // Clear spawn zones (left and right edges, vertically centered)
  const spawns = [
    { x: 6, y: MAP_H / 2 },
    { x: MAP_W - 7, y: MAP_H / 2 },
  ];
  for (const s of spawns) {
    for (let y = -6; y <= 6; y++) {
      for (let x = -5; x <= 5; x++) {
        const tx = Math.round(s.x + x), ty = Math.round(s.y + y);
        if (inB(tx, ty)) {
          const t = tiles[idx(tx, ty)];
          if (t === T.ROCK || t === T.WATER || t === T.FOREST) tiles[idx(tx, ty)] = T.GRASS;
        }
      }
    }
  }

  return { tiles, spawns, w: MAP_W, h: MAP_H };
}

export function tileAt(map, x, y) {
  const tx = Math.floor(x), ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return T.ROCK; // out of bounds acts solid
  return map.tiles[ty * map.w + tx];
}

export function isPassable(map, x, y) {
  return TERRAIN[tileAt(map, x, y)].passable;
}

export function tileHeight(map, x, y) {
  return TERRAIN[tileAt(map, x, y)].height;
}
