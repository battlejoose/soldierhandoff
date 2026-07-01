import * as THREE from 'three';
import { MAP_W, MAP_H, TEAM_SIZE, PHASE, TEAM_NAMES } from '/shared/constants.js';
import { generateMap } from '/shared/map.js';
import { RtsCamera } from './camera.js';
import { Net } from './net.js';
import { Terrain } from './terrain.js';
import { FogOfWar } from './fog.js';
import { Units } from './units.js';
import { Input } from './input.js';

// ---- Renderer / scene ----
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0e13);
scene.fog = new THREE.Fog(0x0b0e13, 90, 220);

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.5, 500);
const rtsCam = new RtsCamera(camera, canvas, MAP_W, MAP_H);

scene.add(new THREE.AmbientLight(0xbfd0e4, 0.75));
const sun = new THREE.DirectionalLight(0xfff2dd, 1.15);
sun.position.set(60, 90, 30);
scene.add(sun);

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

// ---- Game state ----
let myTeam = null;
let map = null;
let terrain = null;
let fog = null;
let units = null;
let input = null;
let lastSnapshot = null;

const net = new Net();
net.connect();

// ---- Join UI ----
const joinScreen = document.getElementById('join-screen');
const hud = document.getElementById('hud');
document.getElementById('join-blue').onclick = () => net.join(0);
document.getElementById('join-red').onclick = () => net.join(1);
document.getElementById('join-auto').onclick = () => net.join(null);

const connStatus = document.getElementById('conn-status');
net.on('open', () => connStatus.classList.add('hidden'));
net.on('close', () => { if (myTeam !== null) connStatus.classList.remove('hidden'); });

net.on('joined', (msg) => {
  myTeam = msg.team;
  buildWorld(msg.seed);
  joinScreen.classList.add('hidden');
  hud.classList.remove('hidden');
  buildSquadBar();
});

net.on('map', (msg) => {
  // New match on a fresh map
  buildWorld(msg.seed);
});

net.on('state', (msg) => {
  lastSnapshot = msg;
  if (units) units.applySnapshot(msg, performance.now() / 1000);
  updateHud(msg);
});

function buildWorld(seed) {
  map = generateMap(seed);
  if (terrain) terrain.dispose(scene);
  terrain = new Terrain(scene, map, seed);
  fog = new FogOfWar(map);

  if (units) {
    units.clearAll();
    units.setMap(map);
  } else {
    units = new Units(scene, map, myTeam);
    input = new Input({
      dom: canvas, camera, scene,
      getTerrain: () => terrain,
      units, net, myTeam,
      onSelectionChange: refreshSquadBar,
    });
  }
  input.setSelection([]);

  const spawn = map.spawns[myTeam];
  rtsCam.centerOn(spawn.x, spawn.y);
  rtsCam.yaw = myTeam === 0 ? Math.PI : 0; // look toward the enemy side
}

// ---- HUD ----
const scoreBlue = document.getElementById('score-blue');
const scoreRed = document.getElementById('score-red');
const phaseMsg = document.getElementById('phase-msg');
const banner = document.getElementById('banner');
const squadBar = document.getElementById('squad-bar');

function buildSquadBar() {
  squadBar.innerHTML = '';
  for (let i = 0; i < TEAM_SIZE; i++) {
    const id = myTeam * TEAM_SIZE + i;
    const card = document.createElement('div');
    card.className = 'unit-card';
    card.dataset.id = id;
    card.innerHTML = `<div class="name">S-${i + 1}</div><div class="hp-track"><div class="hp-fill" style="width:100%"></div></div>`;
    card.onclick = (e) => {
      const rec = units?.soldiers.get(id);
      if (!rec || rec.dead) return;
      if (e.shiftKey) input.setSelection([...new Set([...input.selection, id])]);
      else input.setSelection([id]);
      rtsCam.centerOn(rec.x, rec.y);
    };
    squadBar.appendChild(card);
  }
}

function refreshSquadBar(selection) {
  for (const card of squadBar.children) {
    const id = Number(card.dataset.id);
    card.classList.toggle('selected', selection.includes(id));
  }
}

function updateHud(snap) {
  scoreBlue.textContent = `BLUE ${snap.alive[0]}`;
  scoreRed.textContent = `RED ${snap.alive[1]}`;

  // Squad cards
  for (const card of squadBar.children) {
    const id = Number(card.dataset.id);
    const rec = units?.soldiers.get(id);
    const fill = card.querySelector('.hp-fill');
    if (!rec || rec.dead) {
      card.classList.add('dead');
      fill.style.width = '0%';
      continue;
    }
    card.classList.remove('dead');
    const frac = Math.max(0, rec.hp) / 100;
    fill.style.width = `${frac * 100}%`;
    fill.className = `hp-fill${frac <= 0.25 ? ' low' : frac <= 0.55 ? ' mid' : ''}`;
  }

  // Phase
  if (snap.phase === PHASE.WAITING) {
    phaseMsg.textContent = 'Waiting for the enemy team to join…';
    banner.classList.add('hidden');
  } else if (snap.phase === PHASE.COUNTDOWN) {
    phaseMsg.textContent = `Battle begins in ${Math.max(1, Math.ceil(snap.timer))}…`;
    banner.classList.add('hidden');
  } else if (snap.phase === PHASE.PLAYING) {
    phaseMsg.textContent = '';
    banner.classList.add('hidden');
  } else if (snap.phase === PHASE.ENDED) {
    phaseMsg.textContent = '';
    banner.classList.remove('hidden');
    banner.classList.remove('blue', 'red');
    if (snap.winner === -1) {
      banner.innerHTML = `MUTUAL DESTRUCTION<span class="sub">New battle in ${Math.ceil(snap.timer)}s</span>`;
    } else {
      banner.classList.add(snap.winner === 0 ? 'blue' : 'red');
      const verb = snap.winner === myTeam ? 'VICTORY' : 'DEFEAT';
      banner.innerHTML = `${verb} — ${TEAM_NAMES[snap.winner].toUpperCase()} WINS<span class="sub">New battle in ${Math.ceil(snap.timer)}s</span>`;
    }
  }
}

// ---- Main loop ----
let lastT = performance.now();
let fogTimer = 0;

function frame(now) {
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;

  rtsCam.update(dt);

  if (units && fog && terrain) {
    units.update(dt, now / 1000);
    input.update(dt);

    fogTimer -= dt;
    if (fogTimer <= 0) {
      fogTimer = 0.12; // ~8 Hz visibility recompute
      const allies = units.allies().map((r) => ({ x: r.sx, y: r.sy, facing: r.sfacing }));
      fog.compute(allies);
    }
    terrain.applyFog(fog.tick(dt));
  }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
