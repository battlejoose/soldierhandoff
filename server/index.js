import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { Game } from './game.js';
import { TICK_RATE, SNAPSHOT_RATE } from '../shared/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const app = express();
app.use(express.static(path.join(root, 'client')));
app.use('/shared', express.static(path.join(root, 'shared')));
app.use('/vendor/three', express.static(path.join(root, 'node_modules', 'three')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const game = new Game();

wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    if (msg.t === 'join') {
      const team = game.addPlayer(ws, msg.team);
      ws.send(JSON.stringify({ t: 'joined', team, seed: game.seed }));
    } else if (msg.t === 'order') {
      game.handleOrder(ws, msg);
    }
  });
  ws.on('close', () => game.removePlayer(ws));
  ws.on('error', () => game.removePlayer(ws));
});

// Simulation loop
let lastSeed = game.seed;
setInterval(() => {
  game.tick(1 / TICK_RATE);
}, 1000 / TICK_RATE);

// Snapshot broadcast loop (per-team fog-of-war filtering)
setInterval(() => {
  if (wss.clients.size === 0) { game.drainEvents(); return; }
  const events = game.drainEvents();
  const perTeam = [game.snapshotFor(0, events), game.snapshotFor(1, events)];

  // If the match reset, tell clients the new map seed
  const seedMsg = game.seed !== lastSeed ? JSON.stringify({ t: 'map', seed: game.seed }) : null;
  lastSeed = game.seed;

  for (const ws of wss.clients) {
    if (ws.readyState !== 1) continue;
    const p = game.players.get(ws);
    if (!p) continue;
    if (seedMsg) ws.send(seedMsg);
    ws.send(JSON.stringify(perTeam[p.team]));
  }
}, 1000 / SNAPSHOT_RATE);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Soldier Handoff server running at http://localhost:${PORT}`);
});
