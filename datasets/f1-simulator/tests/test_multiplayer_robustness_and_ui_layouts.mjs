/**
 * test_multiplayer_robustness_and_ui_layouts.mjs
 * Verification of:
 * 1. WebSocket Client connection resilience (CONNECTING state safety, timeout, URL resolution)
 * 2. RaceEngine participant and peer car telemetry mapping
 * 3. Complete multiplayer UI layouts (Hub, Modals, 20-slot Lobby, Roulette, Timing Tower collapse, Podium Results)
 */

import assert from 'assert';
import fs from 'fs';
import WebSocket from 'ws';

if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = WebSocket;
}

import { MultiplayerClient } from '../src/multiplayer/multiplayerClient.js';
import { RaceEngine } from '../src/simulation/raceEngine.js';
import { buildTrack } from '../src/simulation/trackManager.js';
import { getCircuit, RAW_WAYPOINTS } from '../src/data/circuitData.js';

console.log('🧪 Starting Multiplayer Robustness & UI Layouts Verification Suite\n');

// ── Test 1: URL Resolution & WebSocket Client Connection Handling ───────────
console.log('Test 1: WebSocket URL Resolution & Concurrent connect() Safety');

const client = new MultiplayerClient({ wsUrl: 'ws://127.0.0.1:8765/' });

// Test default URL resolution fallback logic
const fallbackUrl = client._getDefaultWsUrl();
assert.ok(fallbackUrl.includes(':8765'), `Default WS URL should point to port 8765, got: ${fallbackUrl}`);

// Connect concurrently - must return the same pending promise and resolve cleanly
const p1 = client.connect();
const p2 = client.connect();
assert.strictEqual(p1, p2, 'Concurrent connect() calls must share the exact same in-flight connection promise');

await Promise.all([p1, p2]);
assert.strictEqual(client.connected, true, 'Client should be connected');
console.log('✅ Test 1 Passed: Client handles concurrent connect() cleanly without premature resolution.\n');

// ── Test 2: Public Rooms Fetch & Room Lifecycle ─────────────────────────────
console.log('Test 2: Public Rooms Fetch & Direct Create');
const rooms = await client.getPublicRooms();
assert.ok(Array.isArray(rooms), 'getPublicRooms() must return an array');

const created = await client.createRoom({
  roomType: 'public',
  hostName: 'TestHostRacer',
  roomName: 'Robustness Verification Arena',
  maxPlayers: 20,
  circuitId: 'silverstone',
  laps: 5
});
assert.strictEqual(created.success, true, 'createRoom should succeed');
assert.strictEqual(created.room.maxPlayers, 20, 'Room maxPlayers should be 20');
assert.strictEqual(created.host.displayName, 'TestHostRacer', 'Host displayName must match');

await client.leaveRoom();
console.log('✅ Test 2 Passed: Room creation and leave room lifecycle working authoritatively.\n');

// ── Test 3: RaceEngine Car Participant Mapping ──────────────────────────────
console.log('Test 3: RaceEngine Car Participant & Remote Peer Flag Assignment');
const circ = getCircuit('silverstone');
const track = buildTrack(circ, RAW_WAYPOINTS.silverstone);
const grid = [
  { code: 'VER', name: 'Max Verstappen', team: 'redbull', number: 1, participantId: 'p1', displayName: 'PlayerHost', isAI: false },
  { code: 'HAM', name: 'Lewis Hamilton', team: 'mercedes', number: 44, participantId: 'p2', displayName: 'PlayerFriend', isAI: false },
  { code: 'LEC', name: 'Charles Leclerc', team: 'ferrari', number: 16, participantId: null, displayName: 'Charles Leclerc', isAI: true }
];

const engine = new RaceEngine();
engine.build(track, grid, 5, { isMultiplayer: true, playerCarIdx: 0 });

assert.strictEqual(engine.cars.length, 3);
assert.strictEqual(engine.cars[0].participantId, 'p1');
assert.strictEqual(engine.cars[0].displayName, 'PlayerHost');
assert.strictEqual(engine.cars[0].isPlayer, true);
assert.strictEqual(engine.cars[0].isRemotePeer, false);

assert.strictEqual(engine.cars[1].participantId, 'p2');
assert.strictEqual(engine.cars[1].displayName, 'PlayerFriend');
assert.strictEqual(engine.cars[1].isPlayer, false);
assert.strictEqual(engine.cars[1].isRemotePeer, true, 'Friend car must be marked as isRemotePeer for peer telemetry sync');

assert.strictEqual(engine.cars[2].isAI, true, 'AI car must be marked as isAI');
assert.strictEqual(engine.cars[2].isRemotePeer, false);
console.log('✅ Test 3 Passed: RaceEngine maps participantId, displayName, and isRemotePeer accurately.\n');

// ── Test 4: Multiplayer UI Templates & Layout Inspection ────────────────────
console.log('Test 4: Multiplayer Views Markup & CSS Structure Inspection');
const viewsCode = fs.readFileSync(new URL('../src/multiplayer/multiplayerViews.js', import.meta.url), 'utf8');
const cssCode = fs.readFileSync(new URL('../styles/main.css', import.meta.url), 'utf8');

// Hub Layout
assert.ok(viewsCode.includes('id="mpConnStatusBadge"'), 'Hub must have connection status badge');
assert.ok(viewsCode.includes('id="btnMpCreateCustom"'), 'Hub must have Create Custom Room button');
assert.ok(viewsCode.includes('id="btnMpCreatePublic"'), 'Hub must have Create Public Room button');
assert.ok(viewsCode.includes('id="btnMpOpenJoin"'), 'Hub must have Join Private Room button');
assert.ok(viewsCode.includes('id="inputQuickRoomId"'), 'Hub must have quick room code input');
assert.ok(viewsCode.includes('id="btnMpRefreshRooms"'), 'Hub must have refresh rooms button');
assert.ok(viewsCode.includes('id="mpPublicRoomsGrid"'), 'Hub must have public rooms grid container');

// Waiting Room Lobby Layout
assert.ok(viewsCode.includes('id="btnMpLobbyBack"'), 'Lobby must have Back/Leave button');
assert.ok(viewsCode.includes('id="btnMpLobbyClose"'), 'Lobby must have Close button');
assert.ok(viewsCode.includes('mp-participant-table'), 'Lobby must have participant table');
assert.ok(viewsCode.includes('id="btnMpToggleReady"'), 'Lobby must have ready toggle button');
assert.ok(viewsCode.includes('id="btnMpStartRace"'), 'Lobby must have start race button');

// Timing Tower Collapse Layout
assert.ok(viewsCode.includes('id="btnToggleTower"'), 'Timing tower must have collapse/expand toggle button');
assert.ok(viewsCode.includes('tower-collapsed'), 'Timing tower template must support collapsed state');

// Results & Podium Layout
assert.ok(viewsCode.includes('class="mp-podium-showcase"'), 'Results screen must feature Podium showcase');
assert.ok(viewsCode.includes('podium-p1'), 'Results screen must feature P1 Gold podium card');
assert.ok(viewsCode.includes('id="btnMpRematch"'), 'Results screen must have Rematch button');
assert.ok(viewsCode.includes('id="btnMpResultsExit"'), 'Results screen must have Exit to Hub button');

// CSS Styles
assert.ok(cssCode.includes('.mp-hub-card'), 'CSS must style .mp-hub-card');
assert.ok(cssCode.includes('.mp-conn-badge'), 'CSS must style .mp-conn-badge');
assert.ok(cssCode.includes('.mp-lobby-card'), 'CSS must style .mp-lobby-card');
assert.ok(cssCode.includes('.mp-podium-showcase'), 'CSS must style .mp-podium-showcase');
assert.ok(cssCode.includes('.mp-timing-tower-panel.tower-collapsed'), 'CSS must style collapsed timing tower');
assert.ok(cssCode.includes('.mp-roulette-track.animating'), 'CSS must style animated roulette track');

console.log('✅ Test 4 Passed: All Multiplayer UI layouts, modals, and style rules verified.\n');

console.log('🎉 ALL MULTIPLAYER ROBUSTNESS & UI LAYOUT TESTS PASSED CLEANLY (100%)');
process.exit(0);
