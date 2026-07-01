import * as THREE from 'three';
import { T } from '/shared/constants.js';
import { mulberry32 } from '/shared/rng.js';

// Visual heights (world units) per terrain type
export const TILE_TOP = {
  [T.GRASS]: 0.12,
  [T.ROAD]: 0.12,
  [T.FOREST]: 0.12,
  [T.HILL]: 0.75,
  [T.ROCK]: 1.45,
  [T.WATER]: -0.18,
};

const BASE_COLOR = {
  [T.GRASS]: new THREE.Color(0x5c8a45),
  [T.ROAD]: new THREE.Color(0x9b9188),
  [T.FOREST]: new THREE.Color(0x3d6b35),
  [T.HILL]: new THREE.Color(0x9c8f63),
  [T.ROCK]: new THREE.Color(0x6f7278),
  [T.WATER]: new THREE.Color(0x3a6ea5),
};

export function groundHeightAt(map, x, y) {
  const tx = Math.floor(x), ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return 0.12;
  return TILE_TOP[map.tiles[ty * map.w + tx]];
}

export class Terrain {
  constructor(scene, map, seed) {
    this.map = map;
    this.group = new THREE.Group();
    const n = map.w * map.h;
    const rng = mulberry32(seed ^ 0x9e3779b9);

    // Ground: one instanced box per tile
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    boxGeo.translate(0, 0.5, 0);
    const mat = new THREE.MeshLambertMaterial();
    this.ground = new THREE.InstancedMesh(boxGeo, mat, n);
    this.ground.receiveShadow = true;

    this.baseColors = new Float32Array(n * 3);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    const treeSpots = [];

    for (let ty = 0; ty < map.h; ty++) {
      for (let tx = 0; tx < map.w; tx++) {
        const i = ty * map.w + tx;
        const t = map.tiles[i];
        const top = TILE_TOP[t];
        const h = Math.max(0.05, top + 0.4); // slab thickness below the top surface
        m.makeScale(1, h, 1);
        m.setPosition(tx + 0.5, top - h, ty + 0.5);
        this.ground.setMatrixAt(i, m);

        c.copy(BASE_COLOR[t]);
        const v = 0.94 + rng() * 0.12; // subtle per-tile variation
        c.multiplyScalar(v);
        this.baseColors[i * 3] = c.r;
        this.baseColors[i * 3 + 1] = c.g;
        this.baseColors[i * 3 + 2] = c.b;
        this.ground.setColorAt(i, c);

        if (t === T.FOREST && rng() < 0.55) {
          treeSpots.push({ tile: i, x: tx + 0.3 + rng() * 0.4, z: ty + 0.3 + rng() * 0.4, s: 0.8 + rng() * 0.6 });
        }
      }
    }
    this.ground.instanceMatrix.needsUpdate = true;
    this.group.add(this.ground);

    // Trees (visual only)
    const treeGeo = new THREE.ConeGeometry(0.42, 1.5, 6);
    treeGeo.translate(0, 0.85, 0);
    const treeMat = new THREE.MeshLambertMaterial();
    this.trees = new THREE.InstancedMesh(treeGeo, treeMat, Math.max(1, treeSpots.length));
    this.treeTiles = new Int32Array(treeSpots.length);
    this.treeBase = new Float32Array(treeSpots.length * 3);
    for (let i = 0; i < treeSpots.length; i++) {
      const s = treeSpots[i];
      m.makeScale(s.s, s.s, s.s);
      m.setPosition(s.x, 0.12, s.z);
      this.trees.setMatrixAt(i, m);
      c.setHex(0x2c5e2a).multiplyScalar(0.85 + rng() * 0.3);
      this.trees.setColorAt(i, c);
      this.treeTiles[i] = s.tile;
      this.treeBase[i * 3] = c.r;
      this.treeBase[i * 3 + 1] = c.g;
      this.treeBase[i * 3 + 2] = c.b;
    }
    this.trees.count = treeSpots.length;
    this.trees.instanceMatrix.needsUpdate = true;
    this.group.add(this.trees);

    // Map border
    const borderGeo = new THREE.BoxGeometry(map.w + 2, 0.6, map.h + 2);
    const borderMat = new THREE.MeshLambertMaterial({ color: 0x22282f });
    const border = new THREE.Mesh(borderGeo, borderMat);
    border.position.set(map.w / 2, -0.45, map.h / 2);
    this.group.add(border);

    scene.add(this.group);
  }

  // fog: Float32Array per tile, 0..1 brightness multiplier
  applyFog(fog) {
    const gc = this.ground.instanceColor;
    for (let i = 0; i < fog.length; i++) {
      const f = fog[i];
      gc.setXYZ(i, this.baseColors[i * 3] * f, this.baseColors[i * 3 + 1] * f, this.baseColors[i * 3 + 2] * f);
    }
    gc.needsUpdate = true;

    const tc = this.trees.instanceColor;
    if (tc) {
      for (let i = 0; i < this.treeTiles.length; i++) {
        const f = fog[this.treeTiles[i]];
        tc.setXYZ(i, this.treeBase[i * 3] * f, this.treeBase[i * 3 + 1] * f, this.treeBase[i * 3 + 2] * f);
      }
      tc.needsUpdate = true;
    }
  }

  dispose(scene) {
    scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
}
