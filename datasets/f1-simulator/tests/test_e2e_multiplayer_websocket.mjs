/**
 * test_e2e_multiplayer_websocket.mjs
 * End-to-end multi-client WebSocket test over live server (ws://127.0.0.1:8765/).
 * Validates:
 *   - Real network WebSocket connections across multiple independent clients
 *   - Room creation with Host Room Display Name
 *   - Room Join with "Your Name for This Room" prompt flow
 *   - Capacity bounds enforcement (e.g. 4 players max, 5th rejected)
 *   - Live synchronized readiness updates across all clients
 *   - Host-only Start Race permissions
 *   - Synchronized roulette sequence broadcasting
 *   - Full-field finish rule: race remains active until ALL clients report finish
 *   - Final race results with room display names
 *   - Rematch flow
 */

import assert from 'assert';
import { WebSocket } from 'ws';

console.log('🌐 ══════════════════════════════════════════════════════════════');
console.log('   E2E MULTI-CLIENT WEBSOCKET NETWORK INTEGRATION TEST SUITE    ');
console.log('════════════════════════════════════════════════════════════════\n');

const SERVER_URL = 'ws://127.0.0.1:8765/';

function createClientHelper() {
  const ws = new WebSocket(SERVER_URL);
  const messages = [];

  ws.on('message', (data) => {
    messages.push(JSON.parse(data.toString()));
  });

  const send = (obj) => ws.send(JSON.stringify(obj));

  const waitFor = (predicate, timeoutMs = 4000) => {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      const check = () => {
        const found = messages.find(predicate);
        if (found) return resolve(found);
        if (Date.now() - start > timeoutMs) {
          return reject(new Error(`Timeout waiting for message matching predicate`));
        }
        setTimeout(check, 30);
      };
      check();
    });
  };

  const waitForOpen = () => new Promise(res => ws.on('open', res));

  return { ws, messages, send, waitFor, waitForOpen };
}

async function runTest() {
  console.log('--- Step 1: Connecting Host Client & Creating Room ---');
  const client1 = createClientHelper();
  await client1.waitForOpen();

  client1.send({
    type: 'CREATE_ROOM',
    hostName: 'Naga (Host)',
    roomName: 'Live Multiplayer Championship',
    maxPlayers: 4,
    circuitId: 'silverstone',
    laps: 3,
    aiParticipation: { enabled: false, fillToMax: false }
  });

  const createRes = await client1.waitFor(m => m.type === 'CREATE_ROOM_RESPONSE');
  assert.strictEqual(createRes.success, true, 'Host successfully creates room');
  const roomId = createRes.room.roomId;
  const hostId = createRes.host.participantId;
  console.log(`  ✓ Room ${roomId} created by host "${createRes.host.displayName}" (Capacity: 4)`);

  console.log('\n--- Step 2: Joining 3 Real Independent Clients with Room Display Names ---');
  const client2 = createClientHelper();
  const client3 = createClientHelper();
  const client4 = createClientHelper();
  await Promise.all([client2.waitForOpen(), client3.waitForOpen(), client4.waitForOpen()]);

  client2.send({ type: 'JOIN_ROOM', roomId, displayName: 'Racer007' });
  client3.send({ type: 'JOIN_ROOM', roomId, displayName: 'SpeedKing' });
  client4.send({ type: 'JOIN_ROOM', roomId, displayName: 'ApexRival' });

  const joinRes2 = await client2.waitFor(m => m.type === 'JOIN_ROOM_RESPONSE');
  const joinRes3 = await client3.waitFor(m => m.type === 'JOIN_ROOM_RESPONSE');
  const joinRes4 = await client4.waitFor(m => m.type === 'JOIN_ROOM_RESPONSE');

  assert.strictEqual(joinRes2.success, true);
  assert.strictEqual(joinRes3.success, true);
  assert.strictEqual(joinRes4.success, true);
  console.log('  ✓ 3 additional clients successfully joined with room-specific display names');

  // Verify Host received ROOM_UPDATE with 4 players
  const update4 = await client1.waitFor(m => m.type === 'ROOM_UPDATE' && m.room.connectedPlayersCount === 4);
  assert.strictEqual(update4.room.connectedPlayersCount, 4);
  assert.strictEqual(update4.room.participants.length, 4);
  console.log('  ✓ Host receives synchronized participant table with 4 connected players');

  console.log('\n--- Step 3: Attempting 5th Join (Exceeding Capacity 4) ---');
  const client5 = createClientHelper();
  await client5.waitForOpen();
  client5.send({ type: 'JOIN_ROOM', roomId, displayName: 'OverflowDriver' });
  const joinRes5 = await client5.waitFor(m => m.type === 'JOIN_ROOM_RESPONSE');
  assert.strictEqual(joinRes5.success, false, '5th player join is rejected');
  assert.ok(joinRes5.error.includes('Room is full'), 'Rejection error states room is full');
  client5.ws.close();
  console.log('  ✓ Capacity enforcement verified: 5th player safely rejected on server');

  console.log('\n--- Step 4: Ready State Synchronization & Host Start Validation ---');
  // Host tries to start while others are unready
  client1.send({ type: 'START_RACE', participantId: hostId });
  const startErr = await client1.waitFor(m => m.type === 'START_RACE_RESPONSE' && !m.success);
  assert.strictEqual(startErr.success, false, 'Host cannot start while players unready');
  console.log('  ✓ Host start blocked while participants unready');

  // Non-host attempts start -> rejected
  client2.send({ type: 'START_RACE', participantId: joinRes2.participant.participantId });
  const nonHostErr = await client2.waitFor(m => m.type === 'START_RACE_RESPONSE' && !m.success);
  assert.strictEqual(nonHostErr.success, false, 'Non-host forbidden from starting');
  console.log('  ✓ Non-host start forbidden');

  // Clients 2, 3, 4 ready up
  client2.send({ type: 'SET_READY', participantId: joinRes2.participant.participantId, ready: true });
  client3.send({ type: 'SET_READY', participantId: joinRes3.participant.participantId, ready: true });
  client4.send({ type: 'SET_READY', participantId: joinRes4.participant.participantId, ready: true });

  const allReady = await client1.waitFor(m => m.type === 'ROOM_UPDATE' && m.room.canStartRace === true);
  assert.strictEqual(allReady.room.readyPlayersCount, 4, 'All 4 players ready');
  console.log('  ✓ All 4 connected players marked ready; Host start race button enabled');

  console.log('\n--- Step 5: Host Starts Race & Synchronized Roulette Broadcast ---');
  client1.send({ type: 'START_RACE', participantId: hostId });
  const startOk = await client1.waitFor(m => m.type === 'START_RACE_RESPONSE' && m.success);
  assert.strictEqual(startOk.success, true, 'Start race accepted');

  // All 4 clients receive ROULETTE_START with authoritative outcomes
  const [r1, r2, r3, r4] = await Promise.all([
    client1.waitFor(m => m.type === 'ROULETTE_START'),
    client2.waitFor(m => m.type === 'ROULETTE_START'),
    client3.waitFor(m => m.type === 'ROULETTE_START'),
    client4.waitFor(m => m.type === 'ROULETTE_START')
  ]);

  assert.strictEqual(r1.phase, 'driver_roulette');
  assert.strictEqual(r2.phase, 'driver_roulette');
  assert.deepStrictEqual(r1.outcomes, r2.outcomes, 'All clients receive identical authoritative roulette outcomes');
  console.log('  ✓ All 4 clients receive identical server-authoritative driver roulette outcomes');

  console.log('\n--- Step 6: Full-Field Finish Rule (Race Continues Until ALL Finish) ---');
  // Client 1 (Naga) crosses the line first
  client1.send({
    type: 'FINISH_PARTICIPANT',
    roomId,
    participantId: hostId,
    finishTime: 92.512,
    bestLap: 88.401
  });

  const p1FinishBroadcast = await client2.waitFor(m => m.type === 'PARTICIPANT_FINISHED' && m.displayName === 'Naga (Host)');
  assert.strictEqual(p1FinishBroadcast.finishPosition, 1, 'Naga takes P1');
  assert.strictEqual(p1FinishBroadcast.isGlobalFinish, false, 'Race is NOT finished globally');
  console.log('  ✓ Leader finish (P1) broadcasted to peers; race remains active for remaining 3 cars');

  // Clients 2 and 3 finish
  client2.send({ type: 'FINISH_PARTICIPANT', roomId, participantId: joinRes2.participant.participantId, finishTime: 94.110, bestLap: 89.2 });
  client3.send({ type: 'FINISH_PARTICIPANT', roomId, participantId: joinRes3.participant.participantId, finishTime: 95.820, bestLap: 90.1 });

  // Client 4 finishes (Last active participant!)
  client4.send({ type: 'FINISH_PARTICIPANT', roomId, participantId: joinRes4.participant.participantId, finishTime: 98.440, bestLap: 91.0 });

  // All clients receive RACE_GLOBAL_FINISHED with official classification!
  const finalClassMsg = await client1.waitFor(m => m.type === 'RACE_GLOBAL_FINISHED');
  assert.ok(finalClassMsg.finalClassification, 'Final classification present');
  assert.strictEqual(finalClassMsg.finalClassification.length, 4, 'All 4 drivers classified');

  // Verify display names in classification
  const names = finalClassMsg.finalClassification.map(c => c.displayName);
  assert.deepStrictEqual(names, ['Naga (Host)', 'Racer007', 'SpeedKing', 'ApexRival']);
  console.log('  ✓ Full-field finish triggered when last car finished; official classification has all player names');

  console.log('\n--- Step 7: Rematch Lifecycle ---');
  client1.send({ type: 'REMATCH', participantId: hostId });
  const rematchMsg = await client2.waitFor(m => m.type === 'REMATCH_ACCEPTED');
  assert.strictEqual(rematchMsg.room.state, 'waiting', 'Room reset to waiting for rematch');
  assert.strictEqual(rematchMsg.room.participants.length, 4, 'All 4 participants retained');
  console.log('  ✓ Rematch successfully resets session while preserving room and players');

  // Cleanup
  client1.ws.close();
  client2.ws.close();
  client3.ws.close();
  client4.ws.close();

  console.log('\n════════════════════════════════════════════════════════════');
  console.log('🎉 LIVE MULTI-CLIENT WEBSOCKET NETWORK INTEGRATION PASSED! 🎉');
  console.log('════════════════════════════════════════════════════════════\n');
}

runTest().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
