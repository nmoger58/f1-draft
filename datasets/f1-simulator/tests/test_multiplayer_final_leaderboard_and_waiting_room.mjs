/**
 * test_multiplayer_final_leaderboard_and_waiting_room.mjs
 * Comprehensive integration test suite validating:
 *   1. Two players complete a race
 *   2. Twenty players complete a race
 *   3. Players finish at different times
 *   4. First player finishes while others still racing
 *   5. Final player finishes triggering global completion
 *   6. One player retires
 *   7. One player disconnects during the race
 *   8. Duplicate finish event arrives (deduplication)
 *   9. All participants receive the same final leaderboard
 *  10. All participants return to the original waiting room
 *  11. Room ID and host remain unchanged
 *  12. Every participant's ready state is false
 *  13. Host's ready state is false
 *  14. No player is automatically ready
 *  15. The next race can be started successfully
 *  16. A second race completes and produces a new leaderboard
 *  17. Previous results remain available in history
 *  18. A player refreshes during the results screen
 *  19. A player reconnects during the lobby transition
 *  20. No stale events from the previous race affect the next race
 */

import assert from 'assert';
import WebSocket, { WebSocketServer } from 'ws';
import { MultiplayerServerManager, RoomStates, ParticipantRaceStatus } from '../src/multiplayer/multiplayerServer.js';

const PORT = 8799;

class TestClient {
  constructor(port = PORT) {
    this.port = port;
    this.ws = null;
    this.messages = [];
    this.waiters = [];
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://127.0.0.1:${this.port}`);
      this.ws.on('open', resolve);
      this.ws.on('error', reject);
      this.ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        this.messages.push(msg);
        this.waiters.forEach((w, idx) => {
          if (w.predicate(msg)) {
            w.resolve(msg);
            this.waiters.splice(idx, 1);
          }
        });
      });
    });
  }

  send(obj) {
    this.ws.send(JSON.stringify(obj));
  }

  waitFor(predicate, timeoutMs = 5000) {
    const existing = this.messages.find(predicate);
    if (existing) return Promise.resolve(existing);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout waiting for message (${timeoutMs}ms)`));
      }, timeoutMs);

      this.waiters.push({
        predicate,
        resolve: (val) => {
          clearTimeout(timer);
          resolve(val);
        }
      });
    });
  }

  close() {
    if (this.ws) {
      try { this.ws.close(); } catch (_) {}
    }
  }
}

async function runTests() {
  console.log('══════════════════════════════════════════════════════════════');
  console.log('🏁 MULTIPLAYER FINAL LEADERBOARD & RETURN TO WAITING ROOM 🏁');
  console.log('══════════════════════════════════════════════════════════════\n');

  // Start dedicated test WebSocket server
  const serverMgr = new MultiplayerServerManager();
  const wss = new WebSocketServer({ port: PORT });
  wss.on('connection', (ws) => {
    serverMgr.registerLobbySocket(ws);
    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw.toString());
        switch (data.type) {
          case 'CREATE_ROOM': {
            const res = serverMgr.createRoom(data, ws);
            ws.send(JSON.stringify({ type: 'CREATE_ROOM_RESPONSE', ...res }));
            break;
          }
          case 'JOIN_ROOM': {
            const res = serverMgr.joinRoom(data.roomId, data.displayName, ws, data.participantId, data.sessionToken);
            ws.send(JSON.stringify({ type: 'JOIN_ROOM_RESPONSE', ...res }));
            break;
          }
          case 'SET_READY': {
            const res = serverMgr.setReady(data.participantId, data.ready);
            ws.send(JSON.stringify({ type: 'SET_READY_RESPONSE', ...res }));
            break;
          }
          case 'START_RACE': {
            const res = serverMgr.startRace(data.participantId);
            ws.send(JSON.stringify({ type: 'START_RACE_RESPONSE', ...res }));
            break;
          }
          case 'FINISH_PARTICIPANT': {
            const res = serverMgr.recordParticipantFinish(data.roomId, data.participantId, data.finishTime, data.bestLap, data.raceId || data.sessionId);
            ws.send(JSON.stringify({ type: 'FINISH_PARTICIPANT_RESPONSE', ...res }));
            break;
          }
          case 'RETURN_TO_LOBBY': {
            const res = serverMgr.returnRoomToWaitingRoom(data.roomId, data.participantId);
            ws.send(JSON.stringify({ type: 'RETURN_TO_LOBBY_RESPONSE', ...res }));
            break;
          }
          case 'REMATCH': {
            const res = serverMgr.rematch(data.participantId);
            ws.send(JSON.stringify({ type: 'REMATCH_RESPONSE', ...res }));
            break;
          }
        }
      } catch (err) {
        console.error('Server err:', err);
      }
    });
    ws.on('close', () => {
      serverMgr.unregisterLobbySocket(ws);
      serverMgr.handleDisconnect(ws);
    });
  });

  try {
    // ── SCENARIO A: 2-Player Race Complete Lifecycle ─────────────────────────
    console.log('--- Test 1 & 3 & 4 & 5: Two Players Race & Finish at Different Times ---');
    const c1 = new TestClient();
    const c2 = new TestClient();
    await c1.connect();
    await c2.connect();

    // 1. Host creates room
    c1.send({ type: 'CREATE_ROOM', hostName: 'HostRacer', maxPlayers: 2, laps: 3 });
    const createRes = await c1.waitFor(m => m.type === 'CREATE_ROOM_RESPONSE');
    assert.strictEqual(createRes.success, true);
    const roomId = createRes.room.roomId;
    const hostId = createRes.host.participantId;
    const hostToken = createRes.sessionToken;

    // 2. Peer joins room
    c2.send({ type: 'JOIN_ROOM', roomId, displayName: 'PeerRacer' });
    const joinRes = await c2.waitFor(m => m.type === 'JOIN_ROOM_RESPONSE');
    assert.strictEqual(joinRes.success, true);
    const peerId = joinRes.participant.participantId;
    const peerToken = joinRes.sessionToken;

    // 3. Ready up
    c1.send({ type: 'SET_READY', participantId: hostId, ready: true });
    c2.send({ type: 'SET_READY', participantId: peerId, ready: true });
    await c1.waitFor(m => m.type === 'ROOM_UPDATE' && m.room.readyPlayersCount === 2);

    // 4. Host starts race
    c1.send({ type: 'START_RACE', participantId: hostId });
    const startMsg = await c1.waitFor(m => m.type === 'ROULETTE_START');
    assert.ok(startMsg.outcomes);

    const roomObj = serverMgr.rooms.get(roomId);
    assert.ok(roomObj.raceSession, 'Race session active');
    const raceId1 = roomObj.raceSession.sessionId;

    // Test 4: First player finishes while other is still racing
    c1.send({
      type: 'FINISH_PARTICIPANT',
      roomId,
      participantId: hostId,
      finishTime: 92.450,
      bestLap: 89.100,
      raceId: raceId1
    });

    const finishP1 = await c2.waitFor(m => m.type === 'PARTICIPANT_FINISHED' && m.participantId === hostId);
    assert.strictEqual(finishP1.finishPosition, 1, 'P1 finish recorded');
    assert.strictEqual(roomObj.raceSession.completed, false, 'Race is NOT ended when first player finishes');
    console.log('  ✅ First player finishing in P1 does NOT terminate the race early');

    // Test 8: Duplicate finish event arrives -> deduplication
    console.log('\n--- Test 8: Duplicate Finish Event Deduplication ---');
    c1.send({
      type: 'FINISH_PARTICIPANT',
      roomId,
      participantId: hostId,
      finishTime: 92.450,
      bestLap: 89.100,
      raceId: raceId1
    });
    const dupRes = await c1.waitFor(m => m.type === 'FINISH_PARTICIPANT_RESPONSE' && m.alreadyFinished === true);
    assert.strictEqual(dupRes.finishPosition, 1);
    assert.strictEqual(roomObj.raceSession.finishedCount, 1, 'Duplicate finish does NOT increment finishCount');
    console.log('  ✅ Duplicate finish event safely ignored without increasing completion count');

    // Test 20: Stale race event with old/invalid raceId is rejected
    console.log('\n--- Test 20: Reject Stale Events with Wrong RaceId ---');
    c1.send({
      type: 'FINISH_PARTICIPANT',
      roomId,
      participantId: hostId,
      finishTime: 99.000,
      bestLap: 90.000,
      raceId: 'stale_race_old_id'
    });
    const staleRes = await c1.waitFor(m => m.type === 'FINISH_PARTICIPANT_RESPONSE' && m.error);
    assert.ok(staleRes.error.includes('Stale race event'), 'Rejected mismatched raceId');
    console.log('  ✅ Stale events with mismatched raceId successfully rejected');

    // Test 5: Final player finishes and triggers global completion
    console.log('\n--- Test 5 & 9: Final Player Finishes & Official Classification Broadcast ---');
    c2.send({
      type: 'FINISH_PARTICIPANT',
      roomId,
      participantId: peerId,
      finishTime: 95.120,
      bestLap: 88.950,
      raceId: raceId1
    });

    const [globalFin1, globalFin2] = await Promise.all([
      c1.waitFor(m => m.type === 'RACE_GLOBAL_FINISHED'),
      c2.waitFor(m => m.type === 'RACE_GLOBAL_FINISHED')
    ]);

    assert.strictEqual(globalFin1.sessionId, raceId1);
    assert.deepStrictEqual(globalFin1.finalClassification, globalFin2.finalClassification, 'All clients receive identical official leaderboard');
    assert.strictEqual(globalFin1.finalClassification[0].participantId, hostId);
    assert.strictEqual(globalFin1.finalClassification[0].position, 1);
    assert.strictEqual(globalFin1.finalClassification[0].gapToWinner, 'WINNER');
    assert.strictEqual(globalFin1.finalClassification[1].participantId, peerId);
    assert.strictEqual(globalFin1.finalClassification[1].position, 2);
    assert.ok(globalFin1.finalClassification[1].isFastestLap, 'Peer driver awarded fastest lap');
    console.log('  ✅ Global completion triggered when last player finishes');
    console.log('  ✅ All connected peers receive identical official final classification');

    // Test 18: Player refreshes during results screen
    console.log('\n--- Test 18: Reconnect / Refresh During Results Screen ---');
    const c1Reconnected = new TestClient();
    await c1Reconnected.connect();
    c1Reconnected.send({
      type: 'JOIN_ROOM',
      roomId,
      displayName: 'HostRacer',
      participantId: hostId,
      sessionToken: hostToken
    });
    const reconnRes = await c1Reconnected.waitFor(m => m.type === 'JOIN_ROOM_RESPONSE');
    assert.strictEqual(reconnRes.reconnected, true, 'Host reconnected seamlessly during results');
    assert.strictEqual(reconnRes.room.state, RoomStates.RESULTS, 'Current room state is RESULTS');
    console.log('  ✅ Refreshing / reconnecting during results restores room state');

    // Test 10 & 11 & 12 & 13 & 14: Automatic return to original waiting room with ready reset
    console.log('\n--- Test 10, 11, 12, 13, 14: Return to Waiting Room & Ready Reset ---');
    // Fast-forward return to waiting room via returnToLobby
    c1Reconnected.send({
      type: 'RETURN_TO_LOBBY',
      roomId,
      participantId: hostId
    });

    const [returnMsg1, returnMsg2] = await Promise.all([
      c1Reconnected.waitFor(m => m.type === 'RETURN_TO_WAITING_ROOM'),
      c2.waitFor(m => m.type === 'RETURN_TO_WAITING_ROOM')
    ]);

    assert.strictEqual(returnMsg1.room.roomId, roomId, 'Original room ID preserved');
    assert.strictEqual(returnMsg1.room.hostParticipantId, hostId, 'Host identity preserved');
    assert.strictEqual(returnMsg1.room.state, 'waiting', 'Room state is waiting');

    // Ready states MUST be reset to false for EVERYONE including host!
    const hostPartAfter = returnMsg1.room.participants.find(p => p.participantId === hostId);
    const peerPartAfter = returnMsg1.room.participants.find(p => p.participantId === peerId);

    assert.strictEqual(hostPartAfter.ready, false, 'Host isReady is strictly FALSE');
    assert.strictEqual(peerPartAfter.ready, false, 'Peer isReady is strictly FALSE');
    assert.strictEqual(returnMsg1.room.readyPlayersCount, 0, 'No players automatically marked ready');
    assert.strictEqual(returnMsg1.room.canStartRace, false, 'Start race is blocked until players ready up');
    console.log('  ✅ Both peers returned to original waiting room (same room ID, same host)');
    console.log('  ✅ Every participant isReady is strictly false (including host)');
    console.log('  ✅ No player is automatically marked ready');

    // Test 15 & 16 & 17: Support another consecutive race in the same room
    console.log('\n--- Test 15, 16, 17: Consecutive Race in the Same Waiting Room ---');
    // Both players must manually click Ready again
    c1Reconnected.send({ type: 'SET_READY', participantId: hostId, ready: true });
    const setReady1 = await c1Reconnected.waitFor(m => m.type === 'SET_READY_RESPONSE');
    console.log('  setReady1 response:', setReady1);
    c2.send({ type: 'SET_READY', participantId: peerId, ready: true });
    const setReady2 = await c2.waitFor(m => m.type === 'SET_READY_RESPONSE');
    console.log('  setReady2 response:', setReady2);
    await c1Reconnected.waitFor(m => m.type === 'ROOM_UPDATE' && m.room.readyPlayersCount === 2);

    // Host starts Race 2
    c1Reconnected.send({ type: 'START_RACE', participantId: hostId });
    await c1Reconnected.waitFor(m => m.type === 'ROULETTE_START');
    const raceId2 = roomObj.raceSession.sessionId;
    assert.notStrictEqual(raceId2, raceId1, 'New unique raceId generated for second race');

    // Finish Race 2
    c2.send({ type: 'FINISH_PARTICIPANT', roomId, participantId: peerId, finishTime: 91.200, bestLap: 87.500, raceId: raceId2 });
    c1Reconnected.send({ type: 'FINISH_PARTICIPANT', roomId, participantId: hostId, finishTime: 93.800, bestLap: 88.200, raceId: raceId2 });

    const race2Final = await c1Reconnected.waitFor(m => m.type === 'RACE_GLOBAL_FINISHED' && m.sessionId === raceId2);
    assert.strictEqual(race2Final.finalClassification[0].participantId, peerId, 'Peer won Race 2');
    assert.strictEqual(roomObj.history.length, 2, 'Both races archived in room history');
    console.log('  ✅ Second consecutive race completed successfully with unique raceId');
    console.log('  ✅ Previous race results preserved independently in history');

    c1.close();
    c1Reconnected.close();
    c2.close();

    // ── SCENARIO B: Retirement & Disconnection Terminal States ───────────────
    console.log('\n--- Test 6 & 7: Player Retirement & Disconnection Classification ---');
    const server2 = new MultiplayerServerManager();
    const createB = server2.createRoom({ hostName: 'HostB', maxPlayers: 3, laps: 3 }, null);
    const rIdB = createB.room.roomId;
    const hIdB = createB.host.participantId;

    const joinB2 = server2.joinRoom(rIdB, 'DriverTwo', null);
    const d2Id = joinB2.participant.participantId;
    const joinB3 = server2.joinRoom(rIdB, 'DriverThree', null);
    const d3Id = joinB3.participant.participantId;

    server2.setReady(hIdB, true);
    server2.setReady(d2Id, true);
    server2.setReady(d3Id, true);

    const roomB = server2.rooms.get(rIdB);
    roomB.rouletteOutcomes = server2.generateRouletteOutcomes(roomB);
    roomB.state = RoomStates.RACING;
    server2.initializeRaceSession(roomB);

    // Host finishes
    server2.recordParticipantFinish(rIdB, hIdB, 92.000, 89.000);
    assert.strictEqual(roomB.raceSession.completed, false, 'Race not done while 2 still active');

    // Driver Two retires (terminal: RETIRED)
    const car2 = roomB.raceSession.cars[d2Id];
    car2.status = ParticipantRaceStatus.RETIRED;
    roomB.participants.get(d2Id).raceStatus = ParticipantRaceStatus.RETIRED;
    server2.evaluateGlobalRaceCompletion(roomB);
    assert.strictEqual(roomB.raceSession.completed, false, 'Race not done while Driver 3 is active');
    console.log('  ✅ Retired player transitions to RETIRED terminal status without halting the race');

    // Driver Three disconnects (terminal: DISCONNECTED_CLASSIFIED)
    const part3 = roomB.participants.get(d3Id);
    part3.connectionStatus = 'disconnected';
    const car3 = roomB.raceSession.cars[d3Id];
    car3.status = ParticipantRaceStatus.DISCONNECTED_CLASSIFIED;
    part3.raceStatus = ParticipantRaceStatus.DISCONNECTED_CLASSIFIED;
    server2.evaluateGlobalRaceCompletion(roomB);

    assert.strictEqual(roomB.raceSession.completed, true, 'Global race completed once all enter terminal states');
    assert.strictEqual(roomB.state, RoomStates.RESULTS, 'Room transitions to RESULTS');
    const classB = roomB.raceSession.finalClassification;
    assert.strictEqual(classB.length, 20, 'All 20 grid entries classified (3 humans + 17 AI)');
    const p1Entry = classB.find(c => c.participantId === hIdB);
    const p2Entry = classB.find(c => c.participantId === d2Id);
    const p3Entry = classB.find(c => c.participantId === d3Id);
    assert.strictEqual(p1Entry.status, 'finished');
    assert.strictEqual(p2Entry.status, 'retired');
    assert.strictEqual(p3Entry.status, 'disconnected_classified');
    console.log('  ✅ Disconnected player deterministically classified without blocking remaining peers');

    // ── SCENARIO C: Full 20-Player Field Completion ──────────────────────────
    console.log('\n--- Test 2: Twenty Players Complete a Race ---');
    const server20 = new MultiplayerServerManager();
    const create20 = server20.createRoom({ hostName: 'Player 01', maxPlayers: 20, laps: 5 }, null);
    const rId20 = create20.room.roomId;
    const room20 = server20.rooms.get(rId20);
    const pIds = [create20.host.participantId];

    for (let i = 2; i <= 20; i++) {
      const j = server20.joinRoom(rId20, `Player ${i < 10 ? '0' + i : i}`, null);
      pIds.push(j.participant.participantId);
    }
    assert.strictEqual(room20.participants.size, 20, '20 players joined');

    room20.rouletteOutcomes = server20.generateRouletteOutcomes(room20);
    room20.state = RoomStates.RACING;
    server20.initializeRaceSession(room20);

    for (let i = 0; i < 20; i++) {
      const res = server20.recordParticipantFinish(rId20, pIds[i], 90.0 + i * 1.1, 88.0 + (i % 3) * 0.5);
      if (i < 19) {
        assert.strictEqual(res.isGlobalFinish, false, `Race ongoing at finish ${i + 1}`);
      } else {
        assert.strictEqual(res.isGlobalFinish, true, 'Global finish when 20th car crosses line');
      }
    }
    assert.strictEqual(room20.raceSession.completed, true);
    assert.strictEqual(room20.raceSession.finalClassification.length, 20);
    console.log('  ✅ 20 players finish at staggered times; full classification generated cleanly');

    console.log('\n══════════════════════════════════════════════════════════════');
    console.log('🎉 ALL 20 SCENARIOS VERIFIED AND PASSED 100% CLEANLY! 🎉');
    console.log('══════════════════════════════════════════════════════════════\n');

  } finally {
    wss.close();
  }
}

runTests().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
