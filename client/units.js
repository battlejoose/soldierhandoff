import * as THREE from 'three';
import { SOLDIER, TEAM_COLORS } from '/shared/constants.js';
import { visionRangeFor } from '/shared/vision.js';
import { groundHeightAt } from './terrain.js';

const ENEMY_LINGER = 0.35; // seconds an enemy stays drawn after last snapshot sighting

function makeVisionConeGeometry() {
  // Fan pointing +x in the xz plane, radius 1 (scaled at runtime)
  const segs = 24;
  const half = SOLDIER.visionFov / 2;
  const verts = [0, 0, 0];
  for (let i = 0; i <= segs; i++) {
    const a = -half + (i / segs) * SOLDIER.visionFov;
    verts.push(Math.cos(a), 0, Math.sin(a));
  }
  const idx = [];
  for (let i = 1; i <= segs; i++) idx.push(0, i, i + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx);
  return g;
}

export class Units {
  constructor(scene, map, myTeam) {
    this.scene = scene;
    this.map = map;
    this.myTeam = myTeam;
    this.group = new THREE.Group();
    scene.add(this.group);

    this.soldiers = new Map(); // id -> visual record
    this.tracers = [];
    this.corpses = [];
    this.selected = new Set();
    this.visionGeo = makeVisionConeGeometry();
  }

  isAlly(id) {
    const rec = this.soldiers.get(id);
    return rec ? rec.team === this.myTeam : false;
  }

  ensureSoldier(s) {
    let rec = this.soldiers.get(s.id);
    if (rec) return rec;

    const teamColor = TEAM_COLORS[s.team];
    const root = new THREE.Group();

    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.28, 0.5, 4, 10),
      new THREE.MeshLambertMaterial({ color: teamColor }),
    );
    body.position.y = 0.55;
    root.add(body);

    const helmet = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 10, 8),
      new THREE.MeshLambertMaterial({ color: new THREE.Color(teamColor).multiplyScalar(0.55) }),
    );
    helmet.position.y = 1.0;
    root.add(helmet);

    // Rifle wedge shows facing at a glance
    const nose = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.08, 0.08),
      new THREE.MeshLambertMaterial({ color: 0x2b2f36 }),
    );
    nose.position.set(0.42, 0.72, 0);
    root.add(nose);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.62, 28),
      new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.95, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    ring.visible = false;
    root.add(ring);

    // HP bar: two camera-facing sprites
    const barBg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x14181e, depthTest: false }));
    barBg.scale.set(0.95, 0.11, 1);
    barBg.position.y = 1.5;
    barBg.renderOrder = 10;
    root.add(barBg);
    const barFill = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x34d399, depthTest: false }));
    barFill.scale.set(0.9, 0.07, 1);
    barFill.position.y = 1.5;
    barFill.renderOrder = 11;
    root.add(barFill);

    // Vision cone (allies only)
    let cone = null;
    if (s.team === this.myTeam) {
      cone = new THREE.Mesh(
        this.visionGeo,
        new THREE.MeshBasicMaterial({
          color: teamColor, transparent: true, opacity: 0.07,
          depthWrite: false, side: THREE.DoubleSide,
        }),
      );
      cone.position.y = 0.05;
      root.add(cone);
    }

    // Order path line (allies, when selected)
    let pathLine = null;
    if (s.team === this.myTeam) {
      pathLine = new THREE.Line(
        new THREE.BufferGeometry(),
        new THREE.LineBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.6 }),
      );
      pathLine.visible = false;
      this.group.add(pathLine);
    }

    this.group.add(root);
    rec = {
      id: s.id, team: s.team, root, body, ring, barFill, cone, pathLine,
      // display state (smoothed)
      x: s.x, y: s.y, facing: s.facing,
      // latest server state
      sx: s.x, sy: s.y, sfacing: s.facing, hp: s.hp, wp: null,
      lastSeen: performance.now() / 1000,
      dead: false,
    };
    this.soldiers.set(s.id, rec);
    return rec;
  }

  applySnapshot(snap, nowSec) {
    const seen = new Set();
    for (const s of snap.soldiers) {
      seen.add(s.id);
      const rec = this.ensureSoldier(s);
      rec.sx = s.x;
      rec.sy = s.y;
      rec.sfacing = s.facing;
      rec.hp = s.hp;
      rec.wp = s.wp || null;
      rec.lastSeen = nowSec;
      if (rec.dead && s.hp > 0) {
        // match reset
        rec.dead = false;
        rec.root.visible = true;
        rec.x = s.x; rec.y = s.y; rec.facing = s.facing;
      }
      if (s.hp <= 0 && !rec.dead) this.kill(rec);
    }

    // Allies are always in snapshots; a missing ally means they died before we joined.
    // Missing enemies simply fell out of vision (handled in update via linger).
    for (const ev of snap.events) {
      if (ev.e === 'shot') this.addTracer(ev);
      if (ev.e === 'death') {
        const rec = this.soldiers.get(ev.id);
        if (rec && !rec.dead) {
          rec.sx = ev.x; rec.sy = ev.y;
          this.kill(rec);
        } else if (!rec) {
          this.addCorpse(ev.x, ev.y, ev.team);
        }
      }
    }
  }

  kill(rec) {
    rec.dead = true;
    rec.root.visible = false;
    if (rec.pathLine) rec.pathLine.visible = false;
    this.selected.delete(rec.id);
    this.addCorpse(rec.sx, rec.sy, rec.team);
  }

  addCorpse(x, y, team) {
    const g = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(TEAM_COLORS[team]).multiplyScalar(0.35) });
    const slab = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.14, 0.4), mat);
    slab.rotation.y = Math.random() * Math.PI;
    g.add(slab);
    g.position.set(x, groundHeightAt(this.map, x, y) + 0.08, y);
    this.group.add(g);
    this.corpses.push(g);
  }

  addTracer(ev) {
    const y0 = groundHeightAt(this.map, ev.x, ev.y) + 0.75;
    const y1 = groundHeightAt(this.map, ev.tx, ev.ty) + (ev.hit ? 0.6 : 0.2);
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(ev.x, y0, ev.y),
      new THREE.Vector3(ev.tx, y1, ev.ty),
    ]);
    const mat = new THREE.LineBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.9 });
    const line = new THREE.Line(geo, mat);
    this.group.add(line);
    this.tracers.push({ line, ttl: 0.14, max: 0.14 });

    if (ev.hit) {
      const spark = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xff5544, transparent: true, opacity: 0.95 }));
      spark.position.set(ev.tx, y1, ev.ty);
      spark.scale.set(0.5, 0.5, 1);
      this.group.add(spark);
      this.tracers.push({ line: spark, ttl: 0.22, max: 0.22 });
    }
  }

  setSelection(ids) {
    this.selected = new Set(ids);
    for (const rec of this.soldiers.values()) {
      rec.ring.visible = this.selected.has(rec.id) && !rec.dead;
    }
  }

  allies() {
    return [...this.soldiers.values()].filter((r) => r.team === this.myTeam && !r.dead);
  }

  update(dt, nowSec) {
    const posK = Math.min(1, dt * 14);
    const angK = Math.min(1, dt * 12);

    for (const rec of this.soldiers.values()) {
      if (rec.dead) continue;

      // Enemies fade out of existence when no longer reported
      if (rec.team !== this.myTeam && nowSec - rec.lastSeen > ENEMY_LINGER) {
        rec.root.visible = false;
        continue;
      }
      rec.root.visible = true;

      rec.x += (rec.sx - rec.x) * posK;
      rec.y += (rec.sy - rec.y) * posK;
      let da = rec.sfacing - rec.facing;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      rec.facing += da * angK;

      const gy = groundHeightAt(this.map, rec.x, rec.y);
      rec.root.position.set(rec.x, gy, rec.y);
      rec.root.rotation.y = -rec.facing;

      // HP bar
      const frac = Math.max(0, rec.hp) / SOLDIER.hp;
      rec.barFill.scale.x = 0.9 * frac;
      rec.barFill.position.x = -0.45 * (1 - frac);
      rec.barFill.material.color.setHex(frac > 0.55 ? 0x34d399 : frac > 0.25 ? 0xfbbf24 : 0xef4444);

      // Vision cone scaled by terrain-modified range
      if (rec.cone) {
        const r = visionRangeFor(this.map, rec.x, rec.y);
        rec.cone.scale.set(r, 1, r);
      }

      // Path line for selected allies
      if (rec.pathLine) {
        if (this.selected.has(rec.id) && rec.wp && rec.wp.length) {
          const pts = [new THREE.Vector3(rec.x, gy + 0.15, rec.y)];
          for (const [wx, wy] of rec.wp) {
            pts.push(new THREE.Vector3(wx, groundHeightAt(this.map, wx, wy) + 0.15, wy));
          }
          rec.pathLine.geometry.dispose();
          rec.pathLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
          rec.pathLine.visible = true;
        } else {
          rec.pathLine.visible = false;
        }
      }
    }

    // Tracer decay
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.ttl -= dt;
      if (t.ttl <= 0) {
        this.group.remove(t.line);
        if (t.line.geometry) t.line.geometry.dispose();
        t.line.material.dispose();
        this.tracers.splice(i, 1);
      } else {
        t.line.material.opacity = 0.95 * (t.ttl / t.max);
      }
    }
  }

  clearAll() {
    for (const rec of this.soldiers.values()) {
      this.group.remove(rec.root);
      if (rec.pathLine) this.group.remove(rec.pathLine);
    }
    for (const c of this.corpses) this.group.remove(c);
    for (const t of this.tracers) this.group.remove(t.line);
    this.soldiers.clear();
    this.corpses = [];
    this.tracers = [];
    this.selected.clear();
  }

  setMap(map) {
    this.map = map;
  }
}
