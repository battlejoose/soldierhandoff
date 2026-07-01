import * as THREE from 'three';

// RTS camera rig: orbits a ground focus point with fixed pitch.
// Rotate with Q/E or middle-mouse drag, pan with WASD, zoom with wheel.
export class RtsCamera {
  constructor(camera, domElement, mapW, mapH) {
    this.camera = camera;
    this.dom = domElement;
    this.mapW = mapW;
    this.mapH = mapH;

    this.focus = new THREE.Vector3(mapW / 2, 0, mapH / 2);
    this.yaw = Math.PI / 4;
    this.pitch = (52 * Math.PI) / 180;
    this.dist = 42;
    this.minDist = 12;
    this.maxDist = 90;

    this.keys = new Set();
    this.rotating = false;
    this.lastMouse = { x: 0, y: 0 };

    domElement.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.dist = THREE.MathUtils.clamp(this.dist * (e.deltaY > 0 ? 1.12 : 0.89), this.minDist, this.maxDist);
    }, { passive: false });

    domElement.addEventListener('mousedown', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        this.rotating = true;
        this.lastMouse = { x: e.clientX, y: e.clientY };
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 1) this.rotating = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (this.rotating) {
        const dx = e.clientX - this.lastMouse.x;
        const dy = e.clientY - this.lastMouse.y;
        this.yaw -= dx * 0.006;
        this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.004, Math.PI / 7, Math.PI / 2.15);
        this.lastMouse = { x: e.clientX, y: e.clientY };
      }
    });

    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  centerOn(x, z) {
    this.focus.set(x, 0, z);
  }

  update(dt) {
    const panSpeed = this.dist * 0.9 * dt;
    const fwd = new THREE.Vector3(Math.cos(this.yaw), 0, Math.sin(this.yaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);

    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) this.focus.addScaledVector(fwd, -panSpeed);
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) this.focus.addScaledVector(fwd, panSpeed);
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) this.focus.addScaledVector(right, panSpeed);
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) this.focus.addScaledVector(right, -panSpeed);
    if (this.keys.has('KeyQ')) this.yaw += 1.8 * dt;
    if (this.keys.has('KeyE')) this.yaw -= 1.8 * dt;

    this.focus.x = THREE.MathUtils.clamp(this.focus.x, 0, this.mapW);
    this.focus.z = THREE.MathUtils.clamp(this.focus.z, 0, this.mapH);

    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    this.camera.position.set(
      this.focus.x + this.dist * cp * Math.cos(this.yaw),
      this.focus.y + this.dist * sp,
      this.focus.z + this.dist * cp * Math.sin(this.yaw),
    );
    this.camera.lookAt(this.focus);
  }
}
