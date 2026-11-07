/**
 * test_multiplayer_server_and_lobby.mjs
 * Comprehensive automated verification for the 2–20 Player Multiplayer System.
 *
 * Validates:
 * 1. Room Creation, Capacity (2 to 20), and 21st Player Rejection.
 * 2. Room-Specific Display Name Validation & Sanitization.
 * 3. Atomic Slot Assignment & Prevention of Duplicate Slot Occupancy.
 * 4. Ready System & Host-Only Start Race Permissions (requires >= 2 players & 100% ready).
 * 5. Rejection of Unauthorized Non-Host Start Requests.
 * 6. Server-Authoritative Roulette (Driver, Car, Manager) with Unique Constraints.
 * 7. Full-Field Race Completion: Race strictly waits for ALL 20 participants to finish.
 * 8. Official Final Classification Results containing every participant's Room Display Name.
 * 9. Rematch Lifecycle preserving room and participants.
 */

import assert from 'assert';
import {
  MultiplayerServerManager,
  RoomStates,
  ParticipantRaceStatus,
  validateDisplayName
} from '../src/multiplayer/multiplayerServer.js';

console.log('🏎️ ══════════════════════════════════════════════════════════════');
console.log('   2–20 PLAYER MULTIPLAYER LOBBY, ROULETTE & RACE TEST SUITE    ');
console.log('════════════════════════════════════════════════════════════════\n');

// Mock WebSocket class
class MockSocket {
  constructor(id) {
    this.id = id;
    this.readyState = 1; // WebSocket.OPEN
    this.sentMessages = [];
  }
  send(msg) {
    this.sentMessages.push(JSON.parse(msg));
  }
}

const server = new MultiplayerServerManager();

// ── TEST 1: Display Name Validation & Sanitization ─────────────────────────
console.log('--- TEST 1: Room-Specific Display Name Validation & Sanitization ---');
assert.strictEqual(validateDisplayName('').valid, false, 'Empty name rejected');
assert.strictEqual(validateDisplayName('   ').valid, false, 'Whitespace-only name rejected');
assert.strictEqual(validateDisplayName('A'.repeat(25)).valid, false, 'Name > 20 chars rejected');

const validHost = validateDisplayName('  Naga Host  ');
assert.strictEqual(validHost.valid, true, 'Valid name accepted');
assert.strictEqual(validHost.name, 'Naga Host', 'Leading/trailing whitespace trimmed');

const xssName = validateDisplayName('<b>Racer</b><script>');
assert.strictEqual(xssName.valid, true, 'Unsafe tags sanitized');
assert.strictEqual(xssName.name, 'Racer', 'Markup stripped');
console.log('  ✅ Display name trimming, character bounding, and sanitization verified');

// ── TEST 2: Room Creation with Capacity = 20 & Host Setup ──────────────────
console.log('\n--- TEST 2: Room Creation (Capacity: 20 Players) ---');
const hostSocket = new MockSocket('sock_host');
const createRes = server.createRoom({
  hostName: 'Naga (Host)',
  roomName: 'Apex 20-Player Championship',
  maxPlayers: 20,
  circuitId: 'silverstone',
  laps: 5,
  duplicatePolicy: { drivers: 'unique', cars: 'allow', managers: 'allow' }
}, hostSocket);

assert.strictEqual(createRes.success, true, 'Room created successfully');
assert.ok(createRes.room.roomId.startsWith('RACE-'), 'Room code generated with RACE- prefix');
assert.strictEqual(createRes.room.maxPlayers, 20, 'Max capacity set to 20');
assert.strictEqual(createRes.room.connectedPlayersCount, 1, 'Initial connected count is 1');
assert.strictEqual(createRes.host.displayName, 'Naga (Host)', 'Host assigned room display name');
assert.strictEqual(createRes.host.isHost, true, 'Creator marked as Host');
assert.strictEqual(createRes.host.slotNumber, 1, 'Host assigned Slot 1');

const roomId = createRes.room.roomId;
const hostId = createRes.host.participantId;
console.log(`  ✅ Room ${roomId} created with capacity 20 and host "${createRes.host.displayName}" in Slot 01`);

// ── TEST 3: Host Cannot Start Alone (< 2 Players) ──────────────────────────
console.log('\n--- TEST 3: Start Race Blocked With < 2 Players ---');
const prematureStart = server.startRace(hostId);
assert.strictEqual(prematureStart.success, false, 'Single player cannot start race');
assert.ok(prematureStart.error.includes('At least 2 human players'), 'Correct error returned');
console.log('  ✅ Server rejects start request with fewer than 2 players');

// ── TEST 4: Joining Up to 20 Human Players & 21st Rejection ────────────────
console.log('\n--- TEST 4: Filling Grid from 2 to 20 Players & 21st Rejection ---');
const sockets = [hostSocket];
const participants = [createRes.host];

// Join 19 more players (total 20)
for (let i = 2; i <= 20; i++) {
  const sock = new MockSocket(`sock_${i}`);
  sockets.push(sock);
  const joinRes = server.joinRoom(roomId, `Driver ${String(i).padStart(2, '0')}`, sock);
  assert.strictEqual(joinRes.success, true, `Player ${i} joins successfully`);
  assert.strictEqual(joinRes.participant.slotNumber, i, `Player assigned Slot ${i}`);
  assert.strictEqual(joinRes.participant.displayName, `Driver ${String(i).padStart(2, '0')}`);
  participants.push(joinRes.participant);
}

const fullRoom = server.rooms.get(roomId);
assert.strictEqual(fullRoom.participants.size, 20, 'Exactly 20 participants in room');
assert.strictEqual(fullRoom.slots.filter(s => s !== null).length, 20, 'All 20 slots occupied');
console.log('  ✅ Grid successfully populated with 20 real players across slots 01 to 20');

// Attempt to join 21st player
const extraSock = new MockSocket('sock_21');
const overflowJoin = server.joinRoom(roomId, 'Extra Driver 21', extraSock);
assert.strictEqual(overflowJoin.success, false, '21st player strictly rejected');
assert.ok(overflowJoin.error.includes('Room is full'), 'Rejection error indicates room is full');
console.log('  ✅ 21st participant safely rejected when capacity reaches 20');

// ── TEST 5: Ready System Validation & Unready Start Block ──────────────────
console.log('\n--- TEST 5: Ready System & Host-Only Start Enforcement ---');

// Currently host is ready, but players 2..20 are not ready
const unreadyCheck = server.canStartRace(fullRoom);
assert.strictEqual(unreadyCheck.canStart, false, 'Cannot start when participants unready');
assert.strictEqual(unreadyCheck.unreadyCount, 19, 'Reports 19 unready drivers');

// Attempt unauthorized start by non-host player 2
const nonHostStart = server.startRace(participants[1].participantId);
assert.strictEqual(nonHostStart.success, false, 'Non-host cannot start race');
assert.ok(nonHostStart.error.includes('Only the room host'), 'Host permission error returned');
console.log('  ✅ Non-host start attempt safely rejected with permission error');

// Players 2 to 19 ready up, player 20 remains unready
for (let i = 1; i < 19; i++) {
  server.setReady(participants[i].participantId, true);
}
const partialCheck = server.canStartRace(fullRoom);
assert.strictEqual(partialCheck.canStart, false, 'Cannot start with 1 unready player');
assert.strictEqual(partialCheck.unreadyCount, 1, 'Reports 1 unready driver');

// Player 20 readies up -> 100% ready!
server.setReady(participants[19].participantId, true);
const allReadyCheck = server.canStartRace(fullRoom);
assert.strictEqual(allReadyCheck.canStart, true, 'Can start when all 20 players are ready');
assert.strictEqual(allReadyCheck.unreadyCount, 0, 'Zero unready drivers');
console.log('  ✅ Server strictly requires 100% readiness across all 20 connected players');

// ── TEST 6: Synchronized Server-Authoritative Selection Roulette ───────────
console.log('\n--- TEST 6: Authoritative Driver, Car & Manager Roulette ---');
const startRes = server.startRace(hostId);
assert.strictEqual(startRes.success, true, 'Host starts race sequence');
assert.strictEqual(fullRoom.state, RoomStates.DRIVER_ROULETTE, 'Room enters DRIVER_ROULETTE');

const outcomes = fullRoom.rouletteOutcomes;
assert.ok(outcomes, 'Roulette outcomes generated');
assert.strictEqual(Object.keys(outcomes.participants).length, 20, '20 participant assignments');

// Enforce unique drivers rule (20 drivers assigned without duplicates)
const assignedDriverCodes = new Set();
for (const [pId, assignment] of Object.entries(outcomes.participants)) {
  assert.ok(assignment.driver?.code, 'Driver code exists');
  assert.ok(assignment.car?.name, 'Car exists');
  assert.ok(assignment.manager?.name, 'Manager exists');
  assert.strictEqual(assignedDriverCodes.has(assignment.driver.code), false, `Driver ${assignment.driver.code} is unique`);
  assignedDriverCodes.add(assignment.driver.code);
}
assert.strictEqual(assignedDriverCodes.size, 20, 'All 20 drivers on the grid are unique');
console.log('  ✅ Authoritative roulette assigns 20 unique authentic drivers, cars, and managers');

// ── TEST 7: Full-Field Race Completion (Must Wait for ALL Drivers) ─────────
console.log('\n--- TEST 7: Full-Field Finish Lifecycle (No Early Termination) ---');
fullRoom.state = RoomStates.RACING;
server.initializeRaceSession(fullRoom);

const session = fullRoom.raceSession;
assert.strictEqual(session.totalParticipants, 20, 'Session has 20 racing cars');
assert.strictEqual(session.finishedCount, 0, 'Initially 0 finished');

// Finish Driver 1 (Leader)
const finish1 = server.recordParticipantFinish(roomId, participants[0].participantId, 95.420, 89.123);
assert.strictEqual(finish1.success, true);
assert.strictEqual(finish1.finishPosition, 1, 'First finisher takes P1');
assert.strictEqual(finish1.isGlobalFinish, false, 'Global race remains ACTIVE after first finisher');
assert.strictEqual(session.completed, false, 'Session is NOT finished when P1 crosses line');
console.log('  ✅ Leader finishing in P1 does NOT end the race for remaining 19 drivers');

// Finish Drivers 2 through 19 (19 total finished, 1 still racing)
for (let i = 1; i < 19; i++) {
  const f = server.recordParticipantFinish(roomId, participants[i].participantId, 95.420 + i * 1.5, 89.5);
  assert.strictEqual(f.finishPosition, i + 1, `Finisher takes P${i + 1}`);
  assert.strictEqual(f.isGlobalFinish, false, `Race remains ACTIVE while 20th driver is on track`);
}
assert.strictEqual(session.finishedCount, 19, '19 drivers finished');
assert.strictEqual(session.completed, false, 'Race strictly ongoing with 1 driver remaining');
console.log('  ✅ Race strictly ongoing with 19 finished and 1 car still racing on track');

// Driver 20 finishes -> Now ALL 20 participants are finished!
const finish20 = server.recordParticipantFinish(roomId, participants[19].participantId, 125.880, 92.1);
assert.strictEqual(finish20.finishPosition, 20, 'Last finisher takes P20');
assert.strictEqual(finish20.isGlobalFinish, true, 'Global race FINISHED when last car crosses line');
assert.strictEqual(session.completed, true, 'Session officially marked complete');
assert.strictEqual(fullRoom.state, RoomStates.RESULTS, 'Room transitions to RESULTS');
console.log('  ✅ Full-field completion: Global race concludes ONLY when all 20 cars finish');

// ── TEST 8: Official Final Classification with Player Display Names ────────
console.log('\n--- TEST 8: Final Classification Leaderboard with Player Names ---');
const classification = session.finalClassification;
assert.ok(Array.isArray(classification), 'Final classification exists');
assert.strictEqual(classification.length, 20, 'Classification contains all 20 drivers');

// Check that P1 contains host's room display name
assert.strictEqual(classification[0].position, 1, 'Position 1');
assert.strictEqual(classification[0].displayName, 'Naga (Host)', 'Displays official room display name');
assert.strictEqual(classification[0].gapToWinner, 'WINNER');

// Check that P20 contains player 20's room display name
assert.strictEqual(classification[19].position, 20, 'Position 20');
assert.strictEqual(classification[19].displayName, 'Driver 20', 'Displays Player 20 room name');
assert.ok(classification[19].gapToWinner.startsWith('+'), 'Displays positive gap to winner');
console.log('  ✅ Verified full classification displays each participant\'s room-specific name');

// ── TEST 9: Rematch Flow (Preserves Room, Resets Session) ───────────────────
console.log('\n--- TEST 9: Rematch Lifecycle ---');
const rematchRes = server.rematch(hostId);
assert.strictEqual(rematchRes.success, true, 'Host initiates rematch');
assert.strictEqual(fullRoom.state, RoomStates.WAITING, 'Room reset to WAITING');
assert.strictEqual(fullRoom.history.length, 1, 'Previous race persisted in history');
assert.strictEqual(fullRoom.raceSession, null, 'Previous session cleared for fresh start');

// Verify participants remain in room with display names intact
assert.strictEqual(fullRoom.participants.size, 20, 'All 20 participants preserved in room');
const p1 = fullRoom.participants.get(hostId);
assert.strictEqual(p1.displayName, 'Naga (Host)', 'Host name preserved');
assert.strictEqual(p1.ready, false, 'Host ready state reset to false');
assert.ok(Array.from(fullRoom.participants.values()).every(p => p.ready === false), 'All participants ready reset to false');
console.log('  ✅ Rematch preserves room, players, and historical classification while resetting ready state to false');

console.log('\n════════════════════════════════════════════════════════════');
console.log('🎉 ALL 20-PLAYER MULTIPLAYER TESTS PASSED CLEANLY! 🎉');
console.log('════════════════════════════════════════════════════════════\n');
