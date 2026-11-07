/**
 * test_custom_and_public_rooms.mjs
 * Comprehensive automated verification for Custom vs Public Multiplayer Rooms,
 * Direct Joining without Room ID, Real-Time Discovery, Privacy Enforcements,
 * Race Start Bug Fix, and In-Race Multiplayer Control Removals.
 */

import assert from 'assert';
import { MultiplayerServerManager, RoomStates, ParticipantRaceStatus } from '../src/multiplayer/multiplayerServer.js';
import { RaceEngine, RaceState } from '../src/simulation/raceEngine.js';
import { LaunchManager, StartStates } from '../src/simulation/launchManager.js';
import { CIRCUITS, getCircuit, RAW_WAYPOINTS } from '../src/data/circuitData.js';
import { buildTrack } from '../src/simulation/trackManager.js';

console.log('🏁 STARTING CUSTOM & PUBLIC MULTIPLAYER ROOM TEST SUITE...\n');

let passedTests = 0;
function pass(desc) {
  passedTests++;
  console.log(`  ✅ Scenario ${passedTests}: ${desc}`);
}

async function runTests() {
  const server = new MultiplayerServerManager();

  // ── Scenario 1: Private Custom Room Never Appears in Discovery ─────────────
  const customRoomRes = server.createRoom({
    roomType: 'custom',
    hostName: 'HostAlice',
    roomName: 'Private Friends Lounge',
    circuitId: 'monaco',
    maxPlayers: 8,
    laps: 5
  }, null);

  assert.strictEqual(customRoomRes.success, true);
  assert.strictEqual(customRoomRes.room.roomType, 'custom');

  let publicRooms = server.getPublicRooms();
  assert.strictEqual(publicRooms.length, 0, 'Custom Room must NEVER appear in public discovery list');
  pass('Private Custom Room created and strictly verified hidden from public room discovery');

  // ── Scenario 2: Public Room Appears in Discovery ───────────────────────────
  const publicRoomRes = server.createRoom({
    roomType: 'public',
    hostName: 'HostBob',
    roomName: 'Silverstone Public Grid',
    circuitId: 'silverstone',
    maxPlayers: 4,
    laps: 10,
    includeQualifying: true
  }, null);

  assert.strictEqual(publicRoomRes.success, true);
  assert.strictEqual(publicRoomRes.room.roomType, 'public');

  publicRooms = server.getPublicRooms();
  assert.strictEqual(publicRooms.length, 1, 'Public Room must be listed in public discovery');
  assert.strictEqual(publicRooms[0].roomId, publicRoomRes.room.roomId);
  assert.strictEqual(publicRooms[0].roomName, 'Silverstone Public Grid');
  assert.strictEqual(publicRooms[0].hostDisplayName, 'HostBob');
  assert.strictEqual(publicRooms[0].includeQualifying, true);
  assert.strictEqual(publicRooms[0].connectedPlayersCount, 1);
  pass('Public Room created and immediately discovered in live public browser with correct metadata');

  // ── Scenario 3: Second Player Joins Directly Without Room ID ───────────────
  const pubRoomId = publicRooms[0].roomId; // ID discovered from browser card
  const join2 = server.joinPublicRoom(pubRoomId, 'RacerCharlie', null);
  assert.strictEqual(join2.success, true, 'Second player joins directly via public endpoint');
  assert.strictEqual(join2.participant.slotNumber, 2);
  assert.strictEqual(join2.participant.displayName, 'RacerCharlie');
  pass('Player joins public room directly without typing a room ID');

  // ── Scenario 4: Third Player Joins & Live Count Updates ────────────────────
  const join3 = server.joinPublicRoom(pubRoomId, 'RacerDavid', null);
  assert.strictEqual(join3.success, true);
  assert.strictEqual(join3.participant.slotNumber, 3);

  publicRooms = server.getPublicRooms();
  assert.strictEqual(publicRooms[0].connectedPlayersCount, 3);
  assert.strictEqual(publicRooms[0].status, 'ALMOST FULL'); // 3 of 4 is >= 4-2
  pass('Third player joins; participant counts and ALMOST FULL status update cleanly');

  // ── Scenario 5: Player Leaves and Count Updates Exactly Once ───────────────
  const leaveRes = server.leaveRoom(join3.participant.participantId);
  assert.strictEqual(leaveRes.success, true);

  publicRooms = server.getPublicRooms();
  assert.strictEqual(publicRooms[0].connectedPlayersCount, 2);
  assert.strictEqual(publicRooms[0].status, 'WAITING');
  pass('Player leaves room; slot is freed and public discovery count decrements exactly once');

  // ── Scenario 6: Room Reaches Capacity & Status Transitions to FULL ─────────
  const fill1 = server.joinPublicRoom(pubRoomId, 'PlayerThree', null);
  const fill2 = server.joinPublicRoom(pubRoomId, 'PlayerFour', null);
  assert.strictEqual(fill1.success, true);
  assert.strictEqual(fill2.success, true);

  publicRooms = server.getPublicRooms();
  assert.strictEqual(publicRooms[0].connectedPlayersCount, 4);
  assert.strictEqual(publicRooms[0].status, 'FULL');
  pass('Room reaches maximum capacity (4/4); status transitions to FULL');

  // ── Scenario 7: Full Room Rejects Additional Direct Joiners ────────────────
  const overflowJoin = server.joinPublicRoom(pubRoomId, 'ExcessPlayer', null);
  assert.strictEqual(overflowJoin.success, false);
  assert(overflowJoin.error.includes('full'), 'Must reject join requests when room is at capacity');
  pass('Capacity limits strictly enforced; overflow player rejected cleanly');

  // ── Scenario 8: Cannot Join Once Race Has Started ──────────────────────────
  // Make everyone ready and start the race
  server.setReady(publicRoomRes.host.participantId, true);
  server.setReady(join2.participant.participantId, true);
  server.setReady(fill1.participant.participantId, true);
  server.setReady(fill2.participant.participantId, true);

  const startRes = server.startRace(publicRoomRes.host.participantId);
  assert.strictEqual(startRes.success, true);

  // Discovery should now automatically exclude this room because it is racing
  publicRooms = server.getPublicRooms();
  assert.strictEqual(publicRooms.length, 0, 'Active racing rooms must not appear in public WAITING discovery');

  // Direct join attempt during race must be cleanly denied
  const midRaceJoin = server.joinPublicRoom(pubRoomId, 'LateJoiner', null);
  assert.strictEqual(midRaceJoin.success, false);
  assert(midRaceJoin.error.includes('progress') || midRaceJoin.error.includes('locked'));
  pass('Active races excluded from discovery; late join requests rejected cleanly');

  // ── Scenario 9: Guessing Custom Room ID in Public Endpoint is Denied ───────
  const privateId = customRoomRes.room.roomId;
  const bypassAttempt = server.joinPublicRoom(privateId, 'SneakyPlayer', null);
  assert.strictEqual(bypassAttempt.success, false);
  assert(bypassAttempt.error.includes('private Custom Room'), 'Bypass attempt into private room must be denied');
  pass('Security check blocks custom room access via public join endpoint');

  // ── Scenario 10: Room Closure Cleans Up Discovery ──────────────────────────
  const tempRoom = server.createRoom({ roomType: 'public', hostName: 'TempHost' }, null);
  assert.strictEqual(server.getPublicRooms().length, 1);
  server.leaveRoom(tempRoom.host.participantId); // Host leaves -> room destroyed
  assert.strictEqual(server.getPublicRooms().length, 0, 'Destroyed room must disappear from discovery');
  pass('Room cleanup on host departure removes listing from public discovery');

  // ── Scenario 11: Reconnection Reconciles Without Duplicating Slots ─────────
  const recRoom = server.createRoom({ roomType: 'public', hostName: 'RecHost' }, null);
  const pJoin = server.joinPublicRoom(recRoom.room.roomId, 'RecPlayer', null);
  assert.strictEqual(pJoin.success, true);

  // Disconnect player
  const roomObj = server.rooms.get(recRoom.room.roomId);
  const participant = roomObj.participants.get(pJoin.participant.participantId);
  participant.connectionStatus = 'disconnected';

  // Reconnect with same participantId and sessionToken
  const reconn = server.joinRoom(
    recRoom.room.roomId,
    'RecPlayer',
    null,
    pJoin.participant.participantId,
    pJoin.sessionToken
  );
  assert.strictEqual(reconn.success, true);
  assert.strictEqual(reconn.reconnected, true);
  assert.strictEqual(roomObj.participants.size, 2, 'No duplicate participant records allowed');
  pass('Reconnection cleanly restores session and avoids duplicate slot allocations');

  // ── Scenario 12: Host Migration When Host Leaves With Remaining Players ────
  const oldHostId = recRoom.host.participantId;
  server.leaveRoom(oldHostId);
  const updatedRoom = server.rooms.get(recRoom.room.roomId);
  assert.strictEqual(updatedRoom.hostParticipantId, pJoin.participant.participantId, 'Host migrated to next player');
  assert.strictEqual(updatedRoom.participants.get(pJoin.participant.participantId).isHost, true);
  pass('Host migration successfully transfers leadership to next connected racer');

  // ── Scenario 13: Distinct Room-Specific Display Names ───────────────────────
  const userRoomA = server.createRoom({ roomType: 'custom', hostName: 'ScuderiaRed' }, null);
  const userRoomB = server.createRoom({ roomType: 'public', hostName: 'SilverArrow44' }, null);
  assert.strictEqual(userRoomA.host.displayName, 'ScuderiaRed');
  assert.strictEqual(userRoomB.host.displayName, 'SilverArrow44');
  pass('User can select distinct room-specific driver display names across sessions');

  // ── Scenario 14: Verification of Multiplayer Race Start Bug Fix ────────────
  // When isMultiplayer is true, launchManager must cancel pending sequence timers
  // and permit immediate acceleration once state is RACING.
  const engine = new RaceEngine();
  const circuit = getCircuit('silverstone');
  const realTrack = buildTrack(circuit, RAW_WAYPOINTS['silverstone']);
  const dummyGrid = [
    { code: 'VER', name: 'Max Verstappen', team: 'Red Bull', number: 1, color: '#0600ef', isPlayer: true, isAI: false },
    { code: 'NOR', name: 'Lando Norris', team: 'McLaren', number: 4, color: '#ff8000', isPlayer: false, isAI: true }
  ];
  engine.build(realTrack, dummyGrid, 5, { isMultiplayer: true });
  assert.strictEqual(engine.isMultiplayer, true);

  // Simulate starting sequence initiation on grid
  engine.startGridSequence();
  assert.strictEqual(engine.state, RaceState.WAITING);

  // Authoritative server lights out signal arrives
  engine.start();
  assert.strictEqual(engine.state, RaceState.RACING);
  assert.strictEqual(engine.launchManager.state, StartStates.RACING);
  assert.strictEqual(engine.launchManager.playerReacted, true);

  // Evaluate car launch: in multiplayer, both player car and peer cars MUST have canAccelerate = true!
  const playerCarLaunch = engine.launchManager.evaluateCarLaunch(engine.cars[0], engine.simTime);
  const aiCarLaunch = engine.launchManager.evaluateCarLaunch(engine.cars[1], engine.simTime);
  assert.strictEqual(playerCarLaunch.canAccelerate, true, 'Player car must be unblocked to accelerate in multiplayer');
  assert.strictEqual(aiCarLaunch.canAccelerate, true, 'AI/Peer cars must be unblocked to accelerate in multiplayer');
  pass('Multiplayer Race Start Bug Fix: LaunchManager timers cancelled, all cars accelerate immediately');

  // ── Scenario 15: Multiplayer Control Exclusions (Pause, Restart, Speed) ───
  // Inspect CSS rules ensuring Pause, Restart, and Speed buttons are hidden in multiplayer
  const fs = await import('fs');
  const cssContent = fs.readFileSync('./styles/main.css', 'utf-8');
  assert(cssContent.includes('body.multiplayer-in-race #playBtn'), 'CSS hides playBtn during multiplayer race');
  assert(cssContent.includes('body.multiplayer-in-race #restartBtn'), 'CSS hides restartBtn during multiplayer race');
  assert(cssContent.includes('body.multiplayer-in-race #warpSeg'), 'CSS hides warpSeg (Speed 1x, 2x, 5x, 10x)');
  assert(cssContent.includes('body.multiplayer-in-race #mBtnPause'), 'CSS hides mobile pause button');
  pass('Single-player Pause, Restart, and Speed buttons (1×, 2×, 5×, 10×) are strictly removed in multiplayer');

  console.log('\n======================================================');
  console.log(`🎉 ALL ${passedTests} CUSTOM & PUBLIC MULTIPLAYER TESTS PASSED CLEANLY!`);
  console.log('======================================================');
}

runTests().catch(err => {
  console.error('\n❌ Test suite failure:', err);
  process.exit(1);
});
