// Minimal test client: joins a team and pushes its soldiers toward the map center.
// Usage: node tools/test-bot.js [team]
import WebSocket from 'ws';
import { TEAM_SIZE, MAP_W, MAP_H } from '../shared/constants.js';

const team = Number(process.argv[2] ?? 1);
const ws = new WebSocket('ws://localhost:3000');

ws.on('open', () => {
  console.log('bot connected, joining team', team);
  ws.send(JSON.stringify({ t: 'join', team }));
});

let ordered = false;
ws.on('message', (data) => {
  const msg = JSON.parse(data);
  if (msg.t === 'joined') console.log('bot joined team', msg.team);
  if (msg.t === 'state') {
    if (msg.phase === 'playing' && !ordered) {
      ordered = true;
      const ids = Array.from({ length: TEAM_SIZE }, (_, i) => team * TEAM_SIZE + i);
      ws.send(JSON.stringify({ t: 'order', type: 'move', ids, x: MAP_W / 2, y: MAP_H / 2 }));
      console.log('bot ordered advance to center');
    }
    if (msg.phase === 'ended') {
      console.log('match ended, winner:', msg.winner, 'alive:', msg.alive);
      ordered = false;
    }
  }
});

ws.on('close', () => process.exit(0));
ws.on('error', (e) => { console.error('bot error', e.message); process.exit(1); });
