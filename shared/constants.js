// Shared gameplay constants (used by both server simulation and client rendering)

export const MAP_W = 96;
export const MAP_H = 96;

// Terrain types
export const T = {
  GRASS: 0,
  ROAD: 1,
  FOREST: 2,
  HILL: 3,
  ROCK: 4,
  WATER: 5,
};

export const TERRAIN = {
  [T.GRASS]:  { name: 'grass',  passable: true,  speedMult: 1.0,  height: 0 },
  [T.ROAD]:   { name: 'road',   passable: true,  speedMult: 1.3,  height: 0 },
  [T.FOREST]: { name: 'forest', passable: true,  speedMult: 0.7,  height: 0 },
  [T.HILL]:   { name: 'hill',   passable: true,  speedMult: 0.85, height: 1 },
  [T.ROCK]:   { name: 'rock',   passable: false, speedMult: 0,    height: 2 },
  [T.WATER]:  { name: 'water',  passable: false, speedMult: 0,    height: 0 },
};

export const TEAM_SIZE = 5;

export const SOLDIER = {
  hp: 100,
  radius: 0.35,
  speed: 4.5,                       // tiles / second on grass
  visionRange: 20,                  // tiles
  visionFov: (130 * Math.PI) / 180, // cone width
  weaponRange: 14,                  // tiles
  fireInterval: 0.75,               // seconds between shots
  damageMin: 9,
  damageMax: 16,
  turnRate: Math.PI * 3.2,          // rad / second
};

// Terrain combat/vision modifiers
export const HILL_VISION_MULT = 1.4;   // standing on a hill sees further
export const HILL_RANGE_MULT = 1.35;   // standing on a hill shoots further
export const FOREST_VISION_MULT = 0.7; // standing in forest sees less far
export const FOREST_SEE_DEPTH = 2.2;   // how many forest tiles a sight line can cross
export const FOREST_HIT_MULT = 0.65;   // targets in forest are harder to hit
export const MOVING_HIT_MULT = 0.85;   // moving targets are harder to hit
export const REVEAL_TIME = 2.0;        // seconds a soldier stays revealed after firing

export const TICK_RATE = 20;      // server simulation Hz
export const SNAPSHOT_RATE = 12;  // server -> client Hz

export const PHASE = { WAITING: 'waiting', COUNTDOWN: 'countdown', PLAYING: 'playing', ENDED: 'ended' };

export const COUNTDOWN_SECONDS = 3;
export const RESET_SECONDS = 8;

export const TEAM_NAMES = ['Blue', 'Red'];
export const TEAM_COLORS = [0x3b82f6, 0xef4444];
