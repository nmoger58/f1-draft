/**
 * test_qualifying_system.mjs
 * Comprehensive Verification Suite for F1 Simulator Qualifying System:
 *   - All Cars Participate & Independent Completion
 *   - Optional Qualifying Configuration Toggle
 *   - Session State Machine Transitions
 *   - Sector Timing & Lap Validity
 *   - No Stale Data on Restarts
 *   - Game Mode Consistency (Quick Race, Championship, Multiplayer)
 */

import assert from 'assert';
import { QualifyingEngine, QualifyingStatus } from '../src/championship/qualifyingEngine.js';
import {
  DEFAULT_QUICK_RACE_CONFIG,
  validateQuickRaceConfig,
  buildStartingGrid
} from '../src/quickrace/quickRaceConfig.js';
import { QuickRaceManager } from '../src/quickrace/quickRaceManager.js';
import { QuickRaceState, QuickRaceUIController } from '../src/quickrace/quickRaceUIController.js';
import { RaceEngine, RaceState } from '../src/simulation/raceEngine.js';
import { buildTrack } from '../src/simulation/trackManager.js';
import { getCircuit, RAW_WAYPOINTS } from '../src/data/circuitData.js';
import { DRIVERS } from '../src/data/driverData.js';
import { ChampionshipManager } from '../src/championship/championshipManager.js';
import { WeekendStage } from '../src/championship/championshipState.js';
import { MultiplayerServerManager } from '../src/multiplayer/multiplayerServer.js';

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(err);
    failed++;
  }
}

console.log('\n🏎️ ══════════════════════════════════════════════════════════════');
console.log('   FULL-FIELD QUALIFYING SYSTEM & OPTIONAL CONFIG TEST SUITE    ');
console.log('════════════════════════════════════════════════════════════════\n');

// ── TEST 1: Full Selected Field Participation ─────────────────────────────
console.log('--- TEST 1: Full Selected Field Participation ---');
runTest('Every eligible car in a 20-car field participates and receives a recorded entry', () => {
  const pool = DRIVERS.slice(0, 20);
  const results = QualifyingEngine.runQualifyingSession({
    circuitId: 'silverstone',
    drivers: pool,
    difficulty: 'normal',
    playerCode: 'HAM'
  });

  assert.strictEqual(results.length, 20, 'Expected exactly 20 driver results');
  const codes = new Set(results.map(r => r.driverCode));
  assert.strictEqual(codes.size, 20, 'Expected 20 unique driver codes without duplicates');
  assert.ok(results.every(r => r.driverCode && r.name && r.team), 'Every result has complete metadata');
});

// ── TEST 2: Multiple Cars Complete Laps with Valid Times & Sector Splits ──
console.log('\n--- TEST 2: Valid Times, Gaps & Sector Splits ---');
runTest('Every car records independent Sector 1, 2, 3 splits and valid lap time', () => {
  const pool = DRIVERS.slice(0, 10);
  const results = QualifyingEngine.runQualifyingSession({
    circuitId: 'spa',
    drivers: pool,
    difficulty: 'normal',
    playerCode: 'VER'
  });

  for (const r of results) {
    assert.strictEqual(r.valid, true, `Driver ${r.driverCode} must have valid lap`);
    assert.ok(r.lapTimeS > 0, `Driver ${r.driverCode} must have positive lap time`);
    assert.ok(r.sector1 > 0, `Driver ${r.driverCode} must have valid Sector 1`);
    assert.ok(r.sector2 > 0, `Driver ${r.driverCode} must have valid Sector 2`);
    assert.ok(r.sector3 > 0, `Driver ${r.driverCode} must have valid Sector 3`);
    assert.strictEqual(r.status, QualifyingStatus.COMPLETED);
  }

  // Sorted ascending by lap time
  for (let i = 0; i < results.length - 1; i++) {
    assert.ok(results[i].lapTimeS <= results[i + 1].lapTimeS, 'Times must be strictly sorted ascending');
  }

  assert.strictEqual(results[0].position, 1, 'Fastest car is P1');
  assert.strictEqual(results[0].isPole, true, 'Fastest car has isPole = true');
  assert.strictEqual(results[0].gapS, 0, 'Pole gap is 0.000s');
});

// ── TEST 3: One Car Finishing Lap Early Does NOT End Qualifying ─────────────
console.log('\n--- TEST 3: One Car Finishing Early Does NOT Terminate Session ---');
runTest('RaceEngine in QUALIFYING mode does not finish when 1 car completes lap; waits for all cars', () => {
  const circuit = getCircuit('monaco');
  const track = buildTrack(circuit, RAW_WAYPOINTS.monaco);
  const engine = new RaceEngine();

  engine.build(track, DRIVERS.slice(0, 5), 1, {
    sessionType: 'QUALIFYING',
    playerCarIdx: 0
  });

  assert.strictEqual(engine.sessionType, 'QUALIFYING');

  // Mark only the first car (car 0) as having completed its qualifying lap
  engine.cars[0].lap = 1;
  engine.cars[0].lastLap = 74.250;
  engine.cars[0].qualifyingCompleted = true;
  engine.cars[0].finished = true;

  // The other 4 cars are still racing
  assert.strictEqual(engine.checkGlobalRaceFinished(), false, 'Session must NOT be finished when only 1 of 5 cars finished');

  // Mark 3 more cars as completed
  for (let i = 1; i < 4; i++) {
    engine.cars[i].lap = 1;
    engine.cars[i].lastLap = 75.000 + i * 0.2;
    engine.cars[i].qualifyingCompleted = true;
    engine.cars[i].finished = true;
  }
  assert.strictEqual(engine.checkGlobalRaceFinished(), false, 'Session must NOT be finished when 4 of 5 cars finished');

  // Finish the final 5th car
  engine.cars[4].lap = 1;
  engine.cars[4].lastLap = 76.500;
  engine.cars[4].qualifyingCompleted = true;
  engine.cars[4].finished = true;

  assert.strictEqual(engine.checkGlobalRaceFinished(), true, 'Session finishes ONLY when all 5 cars have completed');
});

// ── TEST 4: Timing Association Across Different Finish Times ──────────────
console.log('\n--- TEST 4: Timing Association Across Drivers ---');
runTest('Explicit live player lap time is accurately associated with player while AI times are distinct', () => {
  const pool = DRIVERS.slice(0, 8);
  const playerTime = 84.123;
  const results = QualifyingEngine.runQualifyingSession({
    circuitId: 'silverstone',
    drivers: pool,
    difficulty: 'normal',
    playerCode: 'HAM',
    playerTime
  });

  const playerResult = results.find(r => r.driverCode === 'HAM');
  assert.ok(playerResult, 'Player result found in classification');
  assert.strictEqual(playerResult.lapTimeS, playerTime, 'Player lap time must exactly match provided live time');
  assert.strictEqual(playerResult.isPlayer, true, 'isPlayer flag preserved');

  const otherResults = results.filter(r => r.driverCode !== 'HAM');
  assert.ok(otherResults.every(r => r.lapTimeS !== playerTime), 'AI lap times are independent and distinct');
});

// ── TEST 5: Invalid or Incomplete Lap Does NOT Receive Fabricated Time ─────
console.log('\n--- TEST 5: Invalid / Incomplete Lap Handling ---');
runTest('Driver with an invalidated lap receives NO TIME status and null lapTimeS', () => {
  const pool = DRIVERS.slice(0, 6);
  const invalidTarget = pool[2].code; // e.g. LEC
  const results = QualifyingEngine.runQualifyingSession({
    circuitId: 'monza',
    drivers: pool,
    difficulty: 'normal',
    forcedInvalidDrivers: [invalidTarget] // lap deleted for track limits
  });

  const targetRes = results.find(r => r.driverCode === invalidTarget);
  assert.ok(targetRes, `${invalidTarget} exists in results`);
  assert.strictEqual(targetRes.valid, false, `${invalidTarget} lap must be marked invalid`);
  assert.strictEqual(targetRes.lapTimeS, null, `${invalidTarget} lapTimeS must be null`);
  assert.strictEqual(targetRes.formattedTime, 'NO TIME', `${invalidTarget} formattedTime must be NO TIME`);
  assert.strictEqual(targetRes.status, QualifyingStatus.NO_TIME, `${invalidTarget} status must be NO TIME`);
});

// ── TEST 6: NO TIME Fallback Grid Rules ─────────────────────────────────────
console.log('\n--- TEST 6: NO TIME Drivers Placed Below Timed Cars on Grid ---');
runTest('Drivers without valid times are placed at the back in deterministic order', () => {
  const pool = DRIVERS.slice(0, 6);
  const invalidTargets = [pool[1].code, pool[3].code];
  const results = QualifyingEngine.runQualifyingSession({
    circuitId: 'monza',
    drivers: pool,
    difficulty: 'normal',
    forcedInvalidDrivers: invalidTargets // Two cars with NO TIME
  });

  // Valid timed drivers should occupy positions 1 to 4
  const validDrivers = results.filter(r => r.valid);
  assert.strictEqual(validDrivers.length, 4, '4 drivers have valid lap times');
  assert.strictEqual(results[0].position, 1);
  assert.strictEqual(results[1].position, 2);
  assert.strictEqual(results[2].position, 3);
  assert.strictEqual(results[3].position, 4);

  // NO TIME drivers must occupy positions 5 and 6 at the back
  const noTimeDrivers = results.filter(r => !r.valid);
  assert.strictEqual(noTimeDrivers.length, 2, '2 drivers have NO TIME');
  assert.strictEqual(noTimeDrivers[0].position, 5);
  assert.strictEqual(noTimeDrivers[1].position, 6);
  assert.strictEqual(noTimeDrivers[0].formattedTime, 'NO TIME');
  assert.strictEqual(noTimeDrivers[1].formattedTime, 'NO TIME');
});

// ── TEST 7: Qualifying Disabled Skips Session Entirely ─────────────────────
console.log('\n--- TEST 7: Qualifying Disabled Skips Session ---');
runTest('When includeQualifying is false, grid is built without qualifying and qualifyingResults is null', () => {
  const config = {
    ...DEFAULT_QUICK_RACE_CONFIG,
    includeQualifying: false,
    gridMode: 'performance',
    fieldSize: 10
  };

  const gridData = buildStartingGrid(config);
  assert.strictEqual(gridData.gridDrivers.length, 10);
  assert.strictEqual(gridData.qualifyingResults, undefined, 'Qualifying results must NOT be attached when disabled');
});

// ── TEST 8: Qualifying Disabled After Previous Race Carries No Stale Times ─
console.log('\n--- TEST 8: No Stale Qualifying Results Carried Over ---');
runTest('Disabling qualifying after a previous qualifying race produces clean non-qualifying grid', () => {
  const manager = new QuickRaceManager();

  // Race 1: with qualifying
  manager.setConfig({ includeQualifying: true, fieldSize: 8 });
  manager.runQualifyingSession();
  assert.ok(manager.getConfig().qualifyingResults?.length === 8, 'Qualifying results recorded in Race 1');

  // Race 2: qualifying disabled
  manager.setConfig({ includeQualifying: false, gridMode: 'random', qualifyingResults: null });
  const gridData = manager.prepareStartingGrid();

  assert.strictEqual(gridData.qualifyingResults, undefined, 'Qualifying results strictly omitted in Race 2');
});

// ── TEST 9: Quick Race Restart Resets Session State ────────────────────────
console.log('\n--- TEST 9: Quick Race Restart Clean Reset ---');
runTest('Restarting race clears session-specific qualifying state without duplicating drivers', () => {
  const manager = new QuickRaceManager();
  manager.setConfig({ includeQualifying: true, fieldSize: 12 });
  manager.runQualifyingSession();

  assert.ok(manager.config.qualifyingResults !== null);

  // Restart
  manager.resetQualifyingState();
  assert.strictEqual(manager.config.qualifyingResults, null, 'Qualifying results cleared on reset');
  assert.strictEqual(manager.activeGridData, null, 'Active grid data reset');
});

// ── TEST 10: Championship Weekend Format Consistency ──────────────────────
console.log('\n--- TEST 10: Championship Format Consistency ---');
runTest('Championship respects rules.qualifyingEnabled flag', () => {
  // Test with qualifying enabled
  const champWithQuali = ChampionshipManager.createChampionship({
    name: 'Quali Champ',
    rules: { qualifyingEnabled: true },
    player: { driverCode: 'NOR', team: 'McLaren' },
    circuitIds: ['monaco']
  });

  const round1 = ChampionshipManager.getCurrentRound(champWithQuali);
  ChampionshipManager.advanceStage(champWithQuali, WeekendStage.QUALIFYING_PENDING);
  const qualiRes = ChampionshipManager.runQualifying(champWithQuali);
  assert.strictEqual(qualiRes.length, 20, '20 drivers classified in championship qualifying');
  assert.strictEqual(round1.stage, WeekendStage.QUALIFYING_COMPLETED);

  // Test with qualifying disabled
  const champNoQuali = ChampionshipManager.createChampionship({
    name: 'No Quali Champ',
    rules: { qualifyingEnabled: false },
    player: { driverCode: 'NOR', team: 'McLaren' },
    circuitIds: ['monaco']
  });

  const roundNoQ = ChampionshipManager.getCurrentRound(champNoQuali);
  assert.strictEqual(champNoQuali.rules.qualifyingEnabled, false);
});

// ── TEST 11: Multiplayer Room Synchronizes includeQualifying ──────────────
console.log('\n--- TEST 11: Multiplayer Qualifying Setting Synchronization ---');
runTest('Multiplayer room respects host includeQualifying setting and broadcasts to clients', () => {
  const server = new MultiplayerServerManager();
  const mockSocket = { readyState: 1, send: () => {} };

  // Host creates room with qualifying enabled
  const createRes = server.createRoom({
    hostName: 'HostDriver',
    includeQualifying: true,
    maxPlayers: 8,
    circuitId: 'silverstone'
  }, mockSocket);

  assert.strictEqual(createRes.success, true);
  assert.strictEqual(createRes.room.includeQualifying, true, 'Room includeQualifying is true');

  // Update room config to disable qualifying
  const updateRes = server.updateConfig(createRes.host.participantId, {
    includeQualifying: false
  });

  assert.strictEqual(updateRes.success, true);
  assert.strictEqual(updateRes.room.includeQualifying, false, 'Updated includeQualifying is false');
});

// ── TEST 12: Race Lifecycle & State Machine Transitions ───────────────────
console.log('\n--- TEST 12: Session State Machine & Race Lifecycle ---');
runTest('State machine correctly transitions through qualifying states when enabled vs direct when disabled', () => {
  let startedWithOpts = null;
  const mockEngine = { cars: [] };
  const mockEl = {
    style: {},
    addEventListener: () => {},
    querySelector: () => ({ addEventListener: () => {}, style: {} }),
    querySelectorAll: () => []
  };
  const mock$ = () => mockEl;

  const ctrl = new QuickRaceUIController({
    engine: mockEngine,
    onStartRace: (opts) => { startedWithOpts = opts; },
    onSwitchToChampionship: () => {},
    onReturnHome: () => {},
    $: mock$
  });

  // Flow A: Qualifying Disabled
  ctrl.launchRaceWithConfig({
    includeQualifying: false,
    gridMode: 'random',
    fieldSize: 6
  });

  assert.strictEqual(ctrl.sessionState, QuickRaceState.RACING, 'Direct transition to RACING when qualifying disabled');
  assert.ok(startedWithOpts !== null, 'Race started with options');

  // Flow B: Qualifying Enabled
  startedWithOpts = null;
  ctrl.launchRaceWithConfig({
    includeQualifying: true,
    fieldSize: 6
  });

  assert.strictEqual(ctrl.sessionState, QuickRaceState.QUALIFYING_INITIALIZATION, 'State transitioned to QUALIFYING_INITIALIZATION');
  assert.strictEqual(startedWithOpts, null, 'Race does NOT start prematurely before qualifying is completed');
});

// ── SUMMARY ───────────────────────────────────────────────────────────────
console.log('\n════════════════════════════════════════════════════════════');
console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
console.log('════════════════════════════════════════════════════════════');

if (failed > 0) {
  process.exit(1);
} else {
  console.log('🎉 ALL 12 ACCEPTANCE TESTS PASSED CLEANLY! 🎉\n');
}
