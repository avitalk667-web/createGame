// Test helper: adds simulated players to a room so one person can try a 4-player game alone.
// The bots join, pick characters, mark "ready" and stay connected (they do not solve puzzles).
// Usage (from the client folder):  node ../tools/bots.mjs <ROOM-CODE> [count=3] [http://localhost:5080]
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), '../client/package.json'));
const signalR = require('@microsoft/signalr');

const [code, countArg, baseArg] = process.argv.slice(2);
if (!code) {
  console.error('Usage: node tools/bots.mjs <ROOM-CODE> [count] [baseUrl]');
  process.exit(1);
}
const base = baseArg ?? 'http://localhost:5080';
const names = ['דוד', 'אורי', 'משה', 'יונתן', 'נתן', 'שמואל', 'אליהו'];
const chars = ['scholar', 'navigator', 'detective', 'explorer'];
const count = Math.min(7, Number(countArg ?? 3));

for (let i = 0; i < count; i++) {
  const res = await fetch(`${base}/api/rooms/${code}/players`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname: `${names[i]} (בוט)`.slice(0, 16), characterId: chars[i % 4], appearance: JSON.stringify({ skin: i % 4, hair: i % 3, glasses: i % 2, bag: i % 4 }) }),
  });
  const body = await res.json();
  if (!res.ok) {
    console.error(`bot ${i + 1}: ${body.message}`);
    continue;
  }
  const hub = new signalR.HubConnectionBuilder().withUrl(`${base}/hubs/game`).withAutomaticReconnect().configureLogging(signalR.LogLevel.Error).build();
  await hub.start();
  const r = await hub.invoke('Connect', body.token);
  await hub.invoke('SetReady', true);
  // wander a little in the library so the others can see them move
  let a = i;
  setInterval(() => {
    a += 0.05;
    hub.send('Move', Math.sin(a) * 3 + i - 1, 0, Math.cos(a) * 2 + 1, a, 'library').catch(() => {});
  }, 150);
  console.log(`bot ${names[i]} joined and is ready (${r.ok ? 'connected' : r.message})`);
}
console.log('Bots are connected. Press Ctrl+C to remove them.');
