import { canSeePoint, visionRangeFor } from '/shared/vision.js';

const VISIBLE = 1.0;
const EXPLORED = 0.42;
const UNSEEN = 0.16;

// Per-tile fog of war: computes team visibility on the tile grid and
// smoothly fades tile brightness between states.
export class FogOfWar {
  constructor(map) {
    this.map = map;
    const n = map.w * map.h;
    this.target = new Float32Array(n).fill(UNSEEN);
    this.current = new Float32Array(n).fill(UNSEEN);
    this.explored = new Uint8Array(n);
    this.visible = new Uint8Array(n);
  }

  // allies: [{x, y, facing}] in map coordinates
  compute(allies) {
    const { map } = this;
    this.visible.fill(0);
    for (const a of allies) {
      const range = Math.ceil(visionRangeFor(map, a.x, a.y));
      const x0 = Math.max(0, Math.floor(a.x - range));
      const x1 = Math.min(map.w - 1, Math.ceil(a.x + range));
      const y0 = Math.max(0, Math.floor(a.y - range));
      const y1 = Math.min(map.h - 1, Math.ceil(a.y + range));
      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          const i = ty * map.w + tx;
          if (this.visible[i]) continue;
          if (canSeePoint(map, a, tx + 0.5, ty + 0.5)) {
            this.visible[i] = 1;
            this.explored[i] = 1;
          }
        }
      }
    }
    for (let i = 0; i < this.target.length; i++) {
      this.target[i] = this.visible[i] ? VISIBLE : this.explored[i] ? EXPLORED : UNSEEN;
    }
  }

  isTileVisible(x, y) {
    const tx = Math.floor(x), ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= this.map.w || ty >= this.map.h) return false;
    return this.visible[ty * this.map.w + tx] === 1;
  }

  // Smoothly move current brightness toward target; returns current
  tick(dt) {
    const k = Math.min(1, dt * 6);
    const { current, target } = this;
    for (let i = 0; i < current.length; i++) {
      current[i] += (target[i] - current[i]) * k;
    }
    return current;
  }
}
