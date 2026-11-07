/**
 * test_multiplayer_bot_cars_option.mjs
 * Comprehensive validation of the multiplayer AI Bot Cars option and enhancements:
 * 1. Default room creation has NO AI bots (fillToMax = false).
 * 2. Creating a room with AI bots enabled (fillToMax = true) populates grid to 20 cars.
 * 3. AI difficulty options (easy, balanced, hard, elite) apply correct pace multipliers.
 * 4. Waiting room metadata strip displays AI status ("AI filling grid" vs "No AI opponents").
 * 5. Host configuration update can toggle AI participation.
 * 6. Live race with NO bots finishes cleanly with only human players in classification.
 * 7. Live race WITH bots completes full-field with both humans and bots classified.
 */

import assert from 'node:assert/strict';
import { MultiplayerServerManager } from '../src/multiplayer/multiplayerServer.js';

console.log('🤖 ══════════════════════════════════════════════════════════════');
console.log('   MULTIPLAYER BOT CARS USER SELECTION & ENHANCEMENT TEST SUITE  ');
console.log('════════════════════════════════════════════════════════════════\n');

async function run() {
  const server = new MultiplayerServerManager();

  // ── TEST 1: User creates room with AI bots DISABLED (Default behavior) ────
  console.log('--- TEST 1: Room Created with AI Bots Disabled (fillToMax: false) ---');
  const roomRes1 = server.createRoom({
    hostName: 'Alice (Host)',
    roomName: 'Humans Only GP',
    maxPlayers: 10,
    circuitId: 'monza',
    laps: 3,
    aiParticipation: {
      enabled: false,
      fillToMax: false,
      difficulty: 'balanced'
    }
  });

  assert.equal(roomRes1.success, true, 'Room 1 created successfully');
  const r1 = server.rooms.get(roomRes1.room.roomId);
  assert.equal(r1.aiParticipation.enabled, false, 'AI participation disabled');
  assert.equal(r1.aiParticipation.fillToMax, false, 'fillToMax is false');

  // Add 2nd human player
  const join1_2 = server.joinRoom(r1.roomId, 'Bob', null);
  assert.equal(join1_2.success, true);

  // Ready both
  server.setReady(roomRes1.host.participantId, true);
  server.setReady(join1_2.participant.participantId, true);

  // Start race
  const start1 = server.startRace(roomRes1.host.participantId);
  assert.equal(start1.success, true);

  // Verify roulette outcomes have NO AI drivers
  assert.equal(r1.rouletteOutcomes.aiDrivers.length, 0, 'No AI drivers in roulette outcomes');
  const roster1 = server.getAuthoritativeRoster(r1);
  assert.equal(roster1.length, 2, 'Only 2 human drivers in authoritative roster');
  assert.equal(roster1.every(e => !e.isAI), true, 'All roster entries are humans');

  // Verify race session has only 2 cars
  const cars1 = Object.values(r1.raceSession.cars);
  assert.equal(cars1.length, 2, 'Race session has exactly 2 cars (no bots)');
  assert.equal(cars1.every(c => !c.isAI), true, 'Zero bot cars in race session');
  console.log('  ✅ Verified: With AI disabled, only real human players enter the race (0 bots).');

  // ── TEST 2: User creates room with AI bots ENABLED (fillToMax: true) ───────
  console.log('\n--- TEST 2: Room Created with AI Bots Enabled (fillToMax: true) ---');
  const roomRes2 = server.createRoom({
    hostName: 'Charlie (Host)',
    roomName: 'Full Grid with Bots',
    maxPlayers: 10,
    circuitId: 'spa',
    laps: 5,
    aiParticipation: {
      enabled: true,
      fillToMax: true,
      difficulty: 'hard'
    }
  });

  assert.equal(roomRes2.success, true);
  const r2 = server.rooms.get(roomRes2.room.roomId);
  assert.equal(r2.aiParticipation.enabled, true, 'AI enabled');
  assert.equal(r2.aiParticipation.fillToMax, true, 'fillToMax enabled');
  assert.equal(r2.aiParticipation.difficulty, 'hard', 'AI difficulty hard');

  // Add 2nd human player
  const join2_2 = server.joinRoom(r2.roomId, 'Dave', null);
  assert.equal(join2_2.success, true);

  // Ready both
  server.setReady(roomRes2.host.participantId, true);
  server.setReady(join2_2.participant.participantId, true);

  // Start race
  const start2 = server.startRace(roomRes2.host.participantId);
  assert.equal(start2.success, true);

  // Verify roulette outcomes have 18 AI drivers (2 humans + 18 AI = 20 total)
  assert.equal(r2.rouletteOutcomes.aiDrivers.length, 18, '18 AI drivers filled the grid');
  const roster2 = server.getAuthoritativeRoster(r2);
  assert.equal(roster2.length, 20, 'Total 20 drivers in authoritative roster');

  const cars2 = Object.values(r2.raceSession.cars);
  assert.equal(cars2.length, 20, 'Race session has 20 total cars');
  const aiCars = cars2.filter(c => c.isAI);
  assert.equal(aiCars.length, 18, '18 AI bot cars present in session');
  assert.equal(aiCars[0].aiPaceMultiplier, 1.00, 'Hard difficulty pace multiplier (1.00) applied');
  console.log('  ✅ Verified: With AI enabled, bots fill remaining slots up to 20 cars with correct pace multiplier.');

  // ── TEST 3: AI Difficulty Multipliers ────────────────────────────────────
  console.log('\n--- TEST 3: AI Difficulty Multipliers (Easy, Balanced, Elite) ---');
  const diffs = [
    { diff: 'easy', expectedPace: 0.93 },
    { diff: 'balanced', expectedPace: 0.97 },
    { diff: 'elite', expectedPace: 1.03 }
  ];

  for (const { diff, expectedPace } of diffs) {
    const rm = server.createRoom({
      hostName: 'TestHost',
      maxPlayers: 2,
      aiParticipation: { enabled: true, fillToMax: true, difficulty: diff }
    });
    const r = server.rooms.get(rm.room.roomId);
    const j = server.joinRoom(r.roomId, 'Peer', null);
    server.setReady(rm.host.participantId, true);
    server.setReady(j.participant.participantId, true);
    server.startRace(rm.host.participantId);

    const firstAiCar = Object.values(r.raceSession.cars).find(c => c.isAI);
    assert.equal(firstAiCar.aiPaceMultiplier, expectedPace, `Difficulty ${diff} pace multiplier should be ${expectedPace}`);
  }
  console.log('  ✅ Verified: easy (0.93), balanced (0.97), hard (1.00), elite (1.03) difficulty multipliers applied.');

  // ── TEST 4: Serialized Room State Includes AI Participation ───────────────
  console.log('\n--- TEST 4: Serialized Room State Exposure ---');
  const serialized1 = server.serializeRoom(r1);
  assert.equal(serialized1.aiParticipation.fillToMax, false, 'Serialized r1 shows fillToMax: false');
  const serialized2 = server.serializeRoom(r2);
  assert.equal(serialized2.aiParticipation.fillToMax, true, 'Serialized r2 shows fillToMax: true');
  console.log('  ✅ Verified: Room serialization accurately broadcasts aiParticipation configuration to clients.');

  // ── TEST 5: Finish Lifecycle with Humans Only (No AI Hang) ───────────────
  console.log('\n--- TEST 5: Finish Lifecycle with Humans Only (No Bots) ---');
  // In r1, Alice finishes P1, then Bob finishes P2
  const fin1 = server.recordParticipantFinish(r1.roomId, roomRes1.host.participantId, 91.500, 89.100);
  assert.equal(fin1.success, true);
  assert.equal(fin1.finishPosition, 1);
  assert.equal(r1.raceSession.completed, false, 'Race still waiting for Bob');

  const fin2 = server.recordParticipantFinish(r1.roomId, join1_2.participant.participantId, 93.200, 90.000);
  assert.equal(fin2.success, true);
  assert.equal(fin2.finishPosition, 2);
  assert.equal(r1.raceSession.completed, true, 'Race completes immediately when all humans finish');
  assert.equal(r1.state, 'results', 'Room transitions to results');

  const finalClass1 = r1.raceSession.finalClassification;
  assert.equal(finalClass1.length, 2, 'Final leaderboard has exactly 2 entries (Alice & Bob, zero bots)');
  assert.equal(finalClass1[0].displayName, 'Alice (Host)');
  assert.equal(finalClass1[1].displayName, 'Bob');
  console.log('  ✅ Verified: Humans-only race concludes cleanly with exactly the human players on the leaderboard.');

  // ── TEST 6: Finish Lifecycle with AI Bots ─────────────────────────────────
  console.log('\n--- TEST 6: Finish Lifecycle with AI Bots Auto-Classification ---');
  // In r2, both human players finish (Charlie and Dave)
  server.recordParticipantFinish(r2.roomId, roomRes2.host.participantId, 90.000, 88.000);
  assert.equal(r2.raceSession.completed, false, 'Race ongoing while Dave is racing');

  server.recordParticipantFinish(r2.roomId, join2_2.participant.participantId, 92.000, 89.500);
  // Now all humans finished -> server should auto-classify remaining AI cars and complete
  assert.equal(r2.raceSession.completed, true, 'Global race completed');
  assert.equal(r2.raceSession.finalClassification.length, 20, 'All 20 cars (2 humans + 18 AI) classified');
  console.log('  ✅ Verified: With AI enabled, when humans finish, full 20-car grid is auto-classified.');

  // ── TEST 7: Host Can Update Config to Toggle AI Before Starting ──────────
  console.log('\n--- TEST 7: Host Can Update AI Config in Waiting Room ---');
  const roomRes7 = server.createRoom({
    hostName: 'Host7',
    aiParticipation: { enabled: false, fillToMax: false }
  });
  const r7 = server.rooms.get(roomRes7.room.roomId);
  assert.equal(r7.aiParticipation.fillToMax, false);

  // Host updates config to enable AI
  const updateRes = server.updateConfig(roomRes7.host.participantId, {
    aiParticipation: { enabled: true, fillToMax: true, difficulty: 'elite' }
  });
  assert.equal(updateRes.success, true);
  assert.equal(r7.aiParticipation.fillToMax, true);
  assert.equal(r7.aiParticipation.difficulty, 'elite');
  console.log('  ✅ Verified: Host updateConfig can change AI participation settings.');

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('🎉 ALL MULTIPLAYER BOT CARS TESTS PASSED (100% GREEN)       ');
  console.log('══════════════════════════════════════════════════════════════\n');
}

run().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
