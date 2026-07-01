import * as THREE from 'three';
import { TEAM_SIZE } from '/shared/constants.js';
import { groundHeightAt } from './terrain.js';

const CLICK_PX = 6;    // below this it's a click, above it's a drag
const FACE_DRAG_PX = 14;

export class Input {
  constructor({ dom, camera, scene, getTerrain, units, net, myTeam, onSelectionChange }) {
    this.dom = dom;
    this.camera = camera;
    this.scene = scene;
    this.getTerrain = getTerrain;
    this.units = units;
    this.net = net;
    this.myTeam = myTeam;
    this.onSelectionChange = onSelectionChange;

    this.raycaster = new THREE.Raycaster();
    this.fallbackPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.12);
    this.selection = [];

    this.left = null;   // { x, y }
    this.right = null;  // { screen: {x,y}, ground: {x,y} }

    this.selectBoxEl = document.getElementById('select-box');

    this.faceArrow = new THREE.ArrowHelper(
      new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, 0xfbbf24, 0.9, 0.5,
    );
    this.faceArrow.visible = false;
    scene.add(this.faceArrow);

    this.markers = [];

    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('mousedown', (e) => this.onDown(e));
    window.addEventListener('mousemove', (e) => this.onMove(e));
    window.addEventListener('mouseup', (e) => this.onUp(e));
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  groundPoint(clientX, clientY) {
    const rect = this.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const terrain = this.getTerrain();
    if (terrain) {
      const hits = this.raycaster.intersectObject(terrain.ground, false);
      if (hits.length > 0) return { x: hits[0].point.x, y: hits[0].point.z };
    }
    const p = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.fallbackPlane, p)) return { x: p.x, y: p.z };
    return null;
  }

  screenPos(worldX, worldY, worldZ) {
    const rect = this.dom.getBoundingClientRect();
    const v = new THREE.Vector3(worldX, worldY, worldZ).project(this.camera);
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }

  onDown(e) {
    if (e.target !== this.dom) return;
    if (e.button === 0) {
      this.left = { x: e.clientX, y: e.clientY };
    } else if (e.button === 2) {
      const g = this.groundPoint(e.clientX, e.clientY);
      if (g) this.right = { screen: { x: e.clientX, y: e.clientY }, ground: g, shift: e.shiftKey };
    }
  }

  onMove(e) {
    if (this.left) {
      const dx = e.clientX - this.left.x, dy = e.clientY - this.left.y;
      if (Math.hypot(dx, dy) > CLICK_PX) {
        const el = this.selectBoxEl;
        el.classList.remove('hidden');
        el.style.left = `${Math.min(e.clientX, this.left.x)}px`;
        el.style.top = `${Math.min(e.clientY, this.left.y)}px`;
        el.style.width = `${Math.abs(dx)}px`;
        el.style.height = `${Math.abs(dy)}px`;
      }
    }
    if (this.right) {
      const drag = Math.hypot(e.clientX - this.right.screen.x, e.clientY - this.right.screen.y);
      if (drag > FACE_DRAG_PX) {
        const g = this.groundPoint(e.clientX, e.clientY);
        if (g) {
          const a = this.right.ground;
          const dir = new THREE.Vector3(g.x - a.x, 0, g.y - a.y);
          const len = Math.max(0.5, dir.length());
          dir.normalize();
          const terrain = this.getTerrain();
          const gy = terrain ? groundHeightAt(terrain.map, a.x, a.y) : 0.12;
          this.faceArrow.position.set(a.x, gy + 0.3, a.y);
          this.faceArrow.setDirection(dir);
          this.faceArrow.setLength(Math.min(len, 6), 0.9, 0.5);
          this.faceArrow.visible = true;
        }
      } else {
        this.faceArrow.visible = false;
      }
    }
  }

  onUp(e) {
    if (e.button === 0 && this.left) {
      const start = this.left;
      this.left = null;
      this.selectBoxEl.classList.add('hidden');
      const drag = Math.hypot(e.clientX - start.x, e.clientY - start.y);
      if (drag <= CLICK_PX) this.pickSingle(e.clientX, e.clientY, e.shiftKey);
      else this.pickBox(start, { x: e.clientX, y: e.clientY }, e.shiftKey);
    }
    if (e.button === 2 && this.right) {
      const r = this.right;
      this.right = null;
      this.faceArrow.visible = false;
      if (this.selection.length === 0) return;

      const drag = Math.hypot(e.clientX - r.screen.x, e.clientY - r.screen.y);
      if (drag <= FACE_DRAG_PX) {
        this.net.order({ type: 'move', ids: this.selection, x: r.ground.x, y: r.ground.y });
        this.addMarker(r.ground.x, r.ground.y, 0x60a5fa);
      } else {
        const g = this.groundPoint(e.clientX, e.clientY);
        if (!g) return;
        const angle = Math.atan2(g.y - r.ground.y, g.x - r.ground.x);
        if (r.shift || e.shiftKey) {
          this.net.order({ type: 'face', ids: this.selection, angle });
        } else {
          this.net.order({ type: 'moveface', ids: this.selection, x: r.ground.x, y: r.ground.y, angle });
          this.addMarker(r.ground.x, r.ground.y, 0xfbbf24);
        }
      }
    }
  }

  pickSingle(cx, cy, additive) {
    let best = null, bestD = 28; // px radius
    for (const rec of this.units.allies()) {
      const p = this.screenPos(rec.x, 0.7, rec.y);
      const d = Math.hypot(p.x - cx, p.y - cy);
      if (d < bestD) { bestD = d; best = rec.id; }
    }
    let sel = additive ? [...this.selection] : [];
    if (best !== null && !sel.includes(best)) sel.push(best);
    this.setSelection(sel);
  }

  pickBox(a, b, additive) {
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
    const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    const sel = additive ? [...this.selection] : [];
    for (const rec of this.units.allies()) {
      const p = this.screenPos(rec.x, 0.7, rec.y);
      if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 && !sel.includes(rec.id)) {
        sel.push(rec.id);
      }
    }
    this.setSelection(sel);
  }

  onKey(e) {
    if (e.repeat) return;
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= TEAM_SIZE) {
      const id = this.myTeam * TEAM_SIZE + (n - 1);
      const rec = this.units.soldiers.get(id);
      if (rec && !rec.dead) {
        this.setSelection(e.shiftKey ? [...new Set([...this.selection, id])] : [id]);
      }
      return;
    }
    if (e.code === 'KeyF') {
      this.setSelection(this.units.allies().map((r) => r.id));
    } else if (e.code === 'KeyH') {
      if (this.selection.length) this.net.order({ type: 'stop', ids: this.selection });
    } else if (e.code === 'Escape') {
      this.setSelection([]);
    }
  }

  setSelection(ids) {
    this.selection = ids.filter((id) => {
      const rec = this.units.soldiers.get(id);
      return rec && !rec.dead && rec.team === this.myTeam;
    });
    this.units.setSelection(this.selection);
    this.onSelectionChange?.(this.selection);
  }

  addMarker(x, y, color) {
    const terrain = this.getTerrain();
    const gy = terrain ? groundHeightAt(terrain.map, x, y) : 0.12;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.45, 0.6, 26),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, gy + 0.1, y);
    this.scene.add(ring);
    this.markers.push({ mesh: ring, ttl: 0.6, max: 0.6 });
  }

  update(dt) {
    for (let i = this.markers.length - 1; i >= 0; i--) {
      const m = this.markers[i];
      m.ttl -= dt;
      if (m.ttl <= 0) {
        this.scene.remove(m.mesh);
        m.mesh.geometry.dispose();
        m.mesh.material.dispose();
        this.markers.splice(i, 1);
      } else {
        const f = m.ttl / m.max;
        m.mesh.material.opacity = f;
        m.mesh.scale.setScalar(0.6 + 0.8 * f);
      }
    }
  }
}
