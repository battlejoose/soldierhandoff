# Soldier Handoff

A squad-based multiplayer tactics game in the spirit of *Commandos* and *Foxhole*: a 3D battlefield viewed from a far-away, rotatable isometric camera, RTS-style unit control, directional fields of view, and terrain-driven fog of war.

Two teams of 5 soldiers fight until one team is completely eliminated.

## Running

```bash
npm install
npm start
```

Then open http://localhost:3000 in two browser windows (or on two machines) and join opposite teams. The match starts automatically once both teams have at least one player. Multiple players may share a team — everyone on a team can command any of its soldiers.

## Controls

| Action | Input |
| --- | --- |
| Select soldier / drag-select squad | Left click / left drag |
| Move order | Right click |
| Move, then face drag direction on arrival | Right click + drag |
| Face a direction in place | Shift + right drag |
| Rotate camera | Q / E or middle-mouse drag |
| Pan camera | WASD / arrow keys |
| Zoom | Mouse wheel |
| Select soldier 1–5 | Number keys |
| Select whole squad | F |
| Halt selected | H |

## Gameplay

- **Field of view** — each soldier sees a 130° cone (about 20 tiles), plus a small omnidirectional awareness radius. Enemies outside every squad member's vision are hidden.
- **Muzzle flash** — firing reveals a soldier for a couple of seconds, even outside vision cones (line of sight still required).
- **Hills** — +40% vision range and +35% weapon range; also block line of sight from below.
- **Forest** — concealment: sight lines only penetrate a couple of tiles deep, targets inside are harder to hit, but movement is slower and defenders see less far.
- **Roads** — +30% movement speed.
- **Rocks / water** — impassable; rocks block bullets and sight entirely.
- Moving soldiers (and soldiers firing on the move) are less accurate.

## Architecture

- `server/` — authoritative Node.js simulation (20 Hz) over WebSockets: A* pathfinding, cone-and-LOS visibility, combat resolution, per-team fog-of-war-filtered snapshots (12 Hz), match lifecycle.
- `client/` — Three.js renderer: instanced tile terrain, rotatable RTS camera rig, vision cones, tracers, per-tile fog shading, selection/orders UI.
- `shared/` — deterministic map generation (seeded), terrain constants, and vision/line-of-sight math used identically by server and client.
