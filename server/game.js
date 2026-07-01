import {
  T, SOLDIER, TEAM_SIZE, PHASE,
  HILL_RANGE_MULT, FOREST_HIT_MULT, MOVING_HIT_MULT, REVEAL_TIME,
  COUNTDOWN_SECONDS, RESET_SECONDS, TICK_RATE,
} from '../shared/constants.js';
import { generateMap, tileAt, isPassable } from '../shared/map.js';
import { visionRangeFor, canSeePoint, hasLineOfSight } from '../shared/vision.js';
import { findPath } from './pathfinding.js';
import { TERRAIN } from '../shared/constants.js';

const WAYPOINT_EPS = 0.15;

export class Game {
  constructor() {
    this.players = new Map(); // ws -> { team, name }
    this.resetMatch(true);
  }

  resetMatch(fresh = false) {
    this.seed = (Math.random() * 0xffffffff) >>> 0;
    this.map = generateMap(this.seed);
    this.phase = PHASE.WAITING;
    this.phaseTimer = 0;
    this.winner = null;
    this.time = 0;
    this.events = []; // drained into each snapshot
    this.soldiers = [];
    for (let team = 0; team < 2; team++) {
      const spawn = this.map.spawns[team];
      for (let i = 0; i < TEAM_SIZE; i++) {
        this.soldiers.push({
          id: team * TEAM_SIZE + i,
          team,
          x: spawn.x + (i % 2 === 0 ? 0 : (i % 4 < 2 ? 1.5 : -1.5)),
          y: spawn.y + (i - (TEAM_SIZE - 1) / 2) * 2,
          facing: team === 0 ? 0 : Math.PI, // face toward the enemy side
          hp: SOLDIER.hp,
          path: null,
          faceOrder: null,
          fireCooldown: Math.random() * SOLDIER.fireInterval,
          revealUntil: -Infinity,
          moving: false,
        });
      }
    }
    if (!fresh) this.checkStart();
  }

  // ---- players ----

  addPlayer(ws, requestedTeam) {
    const counts = [0, 0];
    for (const p of this.players.values()) counts[p.team]++;
    let team = requestedTeam;
    if (team !== 0 && team !== 1) team = counts[0] <= counts[1] ? 0 : 1;
    this.players.set(ws, { team });
    this.checkStart();
    return team;
  }

  removePlayer(ws) {
    this.players.delete(ws);
  }

  teamsReady() {
    const counts = [0, 0];
    for (const p of this.players.values()) counts[p.team]++;
    return counts[0] > 0 && counts[1] > 0;
  }

  checkStart() {
    if (this.phase === PHASE.WAITING && this.teamsReady()) {
      this.phase = PHASE.COUNTDOWN;
      this.phaseTimer = COUNTDOWN_SECONDS;
    }
  }

  // ---- orders ----

  handleOrder(ws, msg) {
    const player = this.players.get(ws);
    if (!player || this.phase !== PHASE.PLAYING) return;
    const mine = (id) => {
      const s = this.soldiers[id];
      return s && s.team === player.team && s.hp > 0;
    };
    const ids = Array.isArray(msg.ids) ? msg.ids.filter(mine) : [];
    if (ids.length === 0) return;

    if (msg.type === 'move' && Number.isFinite(msg.x) && Number.isFinite(msg.y)) {
      const targets = formationTargets(this.map, msg.x, msg.y, ids.length);
      // Assign nearest soldier to each formation slot greedily
      const remaining = [...ids];
      for (const t of targets) {
        let bestI = 0, bestD = Infinity;
        for (let i = 0; i < remaining.length; i++) {
          const s = this.soldiers[remaining[i]];
          const d = Math.hypot(s.x - t.x, s.y - t.y);
          if (d < bestD) { bestD = d; bestI = i; }
        }
        const s = this.soldiers[remaining.splice(bestI, 1)[0]];
        s.path = findPath(this.map, s.x, s.y, t.x, t.y);
        s.faceOrder = null;
      }
    } else if (msg.type === 'face' && Number.isFinite(msg.angle)) {
      for (const id of ids) {
        const s = this.soldiers[id];
        s.faceOrder = msg.angle;
        s.path = null; // facing order also means hold position
      }
    } else if (msg.type === 'moveface' && Number.isFinite(msg.x) && Number.isFinite(msg.y) && Number.isFinite(msg.angle)) {
      // Move to a point, then face a direction on arrival
      const targets = formationTargets(this.map, msg.x, msg.y, ids.length);
      const remaining = [...ids];
      for (const t of targets) {
        let bestI = 0, bestD = Infinity;
        for (let i = 0; i < remaining.length; i++) {
          const s = this.soldiers[remaining[i]];
          const d = Math.hypot(s.x - t.x, s.y - t.y);
          if (d < bestD) { bestD = d; bestI = i; }
        }
        const s = this.soldiers[remaining.splice(bestI, 1)[0]];
        s.path = findPath(this.map, s.x, s.y, t.x, t.y);
        s.faceOrder = msg.angle;
      }
    } else if (msg.type === 'stop') {
      for (const id of ids) {
        const s = this.soldiers[id];
        s.path = null;
        s.faceOrder = null;
      }
    }
  }

  // ---- simulation ----

  tick(dt) {
    this.time += dt;

    if (this.phase === PHASE.COUNTDOWN) {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) this.phase = PHASE.PLAYING;
      return;
    }
    if (this.phase === PHASE.ENDED) {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) this.resetMatch();
      return;
    }
    if (this.phase !== PHASE.PLAYING) return;

    for (const s of this.soldiers) {
      if (s.hp <= 0) continue;
      this.updateMovement(s, dt);
    }
    this.applySeparation(dt);
    for (const s of this.soldiers) {
      if (s.hp <= 0) continue;
      this.updateCombat(s, dt);
    }
    this.checkWin();
  }

  updateMovement(s, dt) {
    s.moving = false;
    if (!s.path || s.path.length === 0) {
      // Idle: honor facing order
      if (s.faceOrder !== null && s.engageTargetId === undefined) {
        s.facing = turnToward(s.facing, s.faceOrder, SOLDIER.turnRate * dt);
        if (Math.abs(angleDiff(s.facing, s.faceOrder)) < 0.01) {
          s.facing = s.faceOrder;
        }
      }
      return;
    }
    const wp = s.path[0];
    const dx = wp.x - s.x, dy = wp.y - s.y;
    const dist = Math.hypot(dx, dy);
    if (dist < WAYPOINT_EPS) {
      s.path.shift();
      return;
    }
    const speedMult = TERRAIN[tileAt(this.map, s.x, s.y)].speedMult || 1;
    const step = Math.min(dist, SOLDIER.speed * speedMult * dt);
    const moveAngle = Math.atan2(dy, dx);
    s.facing = turnToward(s.facing, moveAngle, SOLDIER.turnRate * dt);
    s.x += (dx / dist) * step;
    s.y += (dy / dist) * step;
    s.moving = true;
    if (s.path.length === 1 && dist < WAYPOINT_EPS * 2) s.path = null;
  }

  applySeparation(dt) {
    const alive = this.soldiers.filter((s) => s.hp > 0);
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i], b = alive[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        const minD = SOLDIER.radius * 2.2;
        if (d > 0.0001 && d < minD) {
          const push = ((minD - d) / 2) * Math.min(1, dt * 10);
          const nx = dx / d, ny = dy / d;
          tryNudge(this.map, a, -nx * push, -ny * push);
          tryNudge(this.map, b, nx * push, ny * push);
        }
      }
    }
  }

  updateCombat(s, dt) {
    s.fireCooldown -= dt;

    // Effective weapon range from terrain
    let range = SOLDIER.weaponRange;
    if (tileAt(this.map, s.x, s.y) === T.HILL) range *= HILL_RANGE_MULT;

    // Acquire nearest visible enemy in range
    let target = null, bestD = Infinity;
    for (const e of this.soldiers) {
      if (e.team === s.team || e.hp <= 0) continue;
      const d = Math.hypot(e.x - s.x, e.y - s.y);
      if (d > range || d >= bestD) continue;
      if (canSeePoint(this.map, s, e.x, e.y)) {
        target = e;
        bestD = d;
      }
    }

    if (!target) {
      delete s.engageTargetId;
      return;
    }
    s.engageTargetId = target.id;

    // Track the target while engaging (only when not actively moving somewhere)
    if (!s.moving) {
      const aimAngle = Math.atan2(target.y - s.y, target.x - s.x);
      s.facing = turnToward(s.facing, aimAngle, SOLDIER.turnRate * dt);
    }

    if (s.fireCooldown > 0) return;
    s.fireCooldown = SOLDIER.fireInterval * (0.9 + Math.random() * 0.2);
    s.revealUntil = this.time + REVEAL_TIME;

    // Hit resolution
    let hitChance = 0.8 * Math.max(0.25, 1.1 - 0.6 * (bestD / range));
    if (tileAt(this.map, target.x, target.y) === T.FOREST) hitChance *= FOREST_HIT_MULT;
    if (target.moving) hitChance *= MOVING_HIT_MULT;
    if (s.moving) hitChance *= 0.7; // firing on the move is inaccurate

    const hit = Math.random() < hitChance;
    let tx = target.x, ty = target.y;
    if (!hit) {
      const missA = Math.random() * Math.PI * 2;
      const missR = 0.6 + Math.random() * 1.2;
      tx += Math.cos(missA) * missR;
      ty += Math.sin(missA) * missR;
    }
    this.events.push({ e: 'shot', from: s.id, x: s.x, y: s.y, tx, ty, hit, target: target.id });

    if (hit) {
      const dmg = SOLDIER.damageMin + Math.random() * (SOLDIER.damageMax - SOLDIER.damageMin);
      target.hp = Math.max(0, target.hp - dmg);
      if (target.hp <= 0) {
        target.path = null;
        this.events.push({ e: 'death', id: target.id, x: target.x, y: target.y, team: target.team });
      }
    }
  }

  checkWin() {
    const alive = [0, 0];
    for (const s of this.soldiers) if (s.hp > 0) alive[s.team]++;
    if (alive[0] === 0 || alive[1] === 0) {
      this.phase = PHASE.ENDED;
      this.winner = alive[0] > 0 ? 0 : alive[1] > 0 ? 1 : -1;
      this.phaseTimer = RESET_SECONDS;
    }
  }

  // ---- snapshots ----

  // Which enemy soldiers can `team` currently see?
  visibleEnemiesFor(team) {
    const allies = this.soldiers.filter((s) => s.team === team && s.hp > 0);
    const out = new Set();
    for (const e of this.soldiers) {
      if (e.team === team || e.hp <= 0) continue;
      for (const a of allies) {
        if (canSeePoint(this.map, a, e.x, e.y)) { out.add(e.id); break; }
        // Muzzle flash: recently-fired enemies are revealed through the cone
        // restriction (but still need range + line of sight)
        if (e.revealUntil > this.time) {
          const d = Math.hypot(e.x - a.x, e.y - a.y);
          if (d <= visionRangeFor(this.map, a.x, a.y) &&
              hasLineOfSight(this.map, a.x, a.y, e.x, e.y)) {
            out.add(e.id);
            break;
          }
        }
      }
    }
    return out;
  }

  snapshotFor(team, drainedEvents) {
    const visible = this.visibleEnemiesFor(team);
    const soldiers = [];
    for (const s of this.soldiers) {
      if (s.team === team) {
        soldiers.push({
          id: s.id, team: s.team, hp: round2(s.hp),
          x: round2(s.x), y: round2(s.y), facing: round2(s.facing),
          moving: s.moving,
          wp: s.path && s.path.length ? s.path.map((p) => [round2(p.x), round2(p.y)]) : null,
        });
      } else if (s.hp > 0 && visible.has(s.id)) {
        soldiers.push({
          id: s.id, team: s.team, hp: round2(s.hp),
          x: round2(s.x), y: round2(s.y), facing: round2(s.facing),
          moving: s.moving,
        });
      }
    }
    const events = drainedEvents.filter((ev) => {
      if (ev.e === 'shot') {
        const shooter = this.soldiers[ev.from];
        return shooter.team === team || visible.has(ev.from);
      }
      return true; // deaths and other events are always shown
    });
    const counts = [0, 0];
    for (const s of this.soldiers) if (s.hp > 0) counts[s.team]++;
    return {
      t: 'state',
      phase: this.phase,
      timer: round2(this.phaseTimer),
      winner: this.winner,
      alive: counts,
      soldiers,
      events,
    };
  }

  drainEvents() {
    const ev = this.events;
    this.events = [];
    return ev;
  }
}

function formationTargets(map, x, y, n) {
  if (n === 1) return [{ x, y }];
  const targets = [];
  const spacing = 1.2;
  const cols = Math.ceil(Math.sqrt(n));
  for (let i = 0; i < n; i++) {
    const cx = (i % cols) - (cols - 1) / 2;
    const cy = Math.floor(i / cols) - (Math.ceil(n / cols) - 1) / 2;
    let tx = x + cx * spacing, ty = y + cy * spacing;
    if (!isPassable(map, tx, ty)) { tx = x; ty = y; }
    targets.push({ x: tx, y: ty });
  }
  return targets;
}

function tryNudge(map, s, dx, dy) {
  if (isPassable(map, s.x + dx, s.y + dy)) {
    s.x += dx;
    s.y += dy;
  }
}

function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

function turnToward(current, target, maxStep) {
  const d = angleDiff(current, target);
  if (Math.abs(d) <= maxStep) return target;
  return current + Math.sign(d) * maxStep;
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

export { TICK_RATE };
