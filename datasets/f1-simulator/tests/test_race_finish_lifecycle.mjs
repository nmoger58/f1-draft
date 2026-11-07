/**
 * test_race_finish_lifecycle.mjs
 * Comprehensive automated test suite for independent driver finish states
 * and authoritative race completion lifecycle in the F1 simulator.
 *
 * Verifies:
 *   Test A: AI finishes first -> AI marked finished, race stays active, player drives
 *   Test B: Multiple AI cars finish -> individual results preserved, player completes laps
 *   Test C: Player finishes -> authoritative transition to FINISHED
 *   Test D: Race integrity -> exact finish order, independent finish times, no overwriting
 *   Test E: Championship integrity -> points/calendar wait for player finish, updated once
 *   Test F: Restart & retirement -> clean reset on restart, player DNF properly concludes session
 */

import assert from 'node:assert';
import { CIRCUITS, RAW_WAYPOINTS, getCircuit } from '../src/data/circuitData.js';
import { getGrid }                              from '../src/data/driverData.js';
import { buildTrack }                           from '../src/simulation/trackManager.js';
import { RaceEngine, RaceState }               from '../src/simulation/raceEngine.js';
import { QuickRaceManager }                     from '../src/quickrace/quickRaceManager.js';
import { ChampionshipManager }                 from '../src/championship/championshipManager.js';
import { WeekendStage }                         from '../src/championship/championshipState.js';

console.log('🏎️ Starting Race Finish Lifecycle & Driver Independence Test Suite...\n');

const monzaData = getCircuit('monza');
const monzaTrack = buildTrack(monzaData, RAW_WAYPOINTS.monza);
const L = monzaTrack.circuit.lengthM;

// ── Test A: AI Finishes First ───────────────────────────────────────────────
{
  console.log('Test A: AI Finishes First');
  const engine = new RaceEngine();
  const grid = getGrid().slice(0, 4);
  // Driver 0: AI (NOR), Driver 1: Player (PIA)
  engine.build(monzaTrack, grid, 5, { playerCarIdx: 1 });
  engine.start();

  const aiCar = engine.cars[0];
  const playerCar = engine.cars[1];

  assert.strictEqual(aiCar.isPlayer, false, 'Car 0 is AI');
  assert.strictEqual(playerCar.isPlayer, true, 'Car 1 is Player');
  assert.strictEqual(engine.state, RaceState.RACING, 'Engine initially RACING');

  // Fast-forward AI car to complete 5 laps (lap becomes 6)
  aiCar.lap = 5;
  aiCar.d = 5 * L - 10;
  playerCar.lap = 4;
  playerCar.d = 4 * L + 500;

  // Step AI car across the finish line
  aiCar.d = 5 * L + 20;
  engine.simTime = 320.5;
  engine._onLapComplete(aiCar, []);

  // Assertions for Test A
  assert.strictEqual(aiCar.finished, true, 'AI car must be marked finished');
  assert.strictEqual(aiCar.finishPosition, 1, 'AI car must have finishPosition = 1');
  assert.strictEqual(aiCar.finishTime, 320.5, 'AI finish time must match simTime at finish');
  assert.strictEqual(playerCar.finished, false, 'Player car must NOT be marked finished');
  assert.strictEqual(engine.checkGlobalRaceFinished(), false, 'Global finish condition must be FALSE');
  assert.strictEqual(engine.state, RaceState.RACING, 'Race MUST REMAIN ACTIVE (RACING) when AI finishes first');

  // Verify player can continue driving
  const playerPrevD = playerCar.d;
  playerCar.v = 70;
  engine.step(0.05);
  assert.strictEqual(engine.state, RaceState.RACING, 'Race remains active after step');
  assert.ok(playerCar.d > playerPrevD, 'Player continues advancing along the track');

  console.log('  ✓ AI car 0 finished in P1 at 320.5s.');
  console.log('  ✓ Race remained active; player car 1 continued racing on Lap 4/5.');
  console.log('  ✓ Test A Passed: AI finish does not prematurely end the race.\n');
}

// ── Test B: Multiple AI Cars Finish Before Player ───────────────────────────
{
  console.log('Test B: Multiple AI Cars Finish Before Player');
  const engine = new RaceEngine();
  const grid = getGrid().slice(0, 4);
  // Driver 3 is player; Drivers 0, 1, 2 are AI
  engine.build(monzaTrack, grid, 3, { playerCarIdx: 3 });
  engine.start();

  const ai0 = engine.cars[0];
  const ai1 = engine.cars[1];
  const ai2 = engine.cars[2];
  const player = engine.cars[3];

  assert.strictEqual(player.isPlayer, true, 'Car 3 is Player');

  // AI 0 finishes P1 at t = 200s
  engine.simTime = 200.0;
  ai0.lap = 3;
  ai0.d = 3 * L + 10;
  engine._onLapComplete(ai0, []);
  assert.strictEqual(ai0.finished, true);
  assert.strictEqual(ai0.finishPosition, 1);
  assert.strictEqual(ai0.finishTime, 200.0);
  assert.strictEqual(engine.state, RaceState.RACING);

  // AI 1 finishes P2 at t = 203.4s
  engine.simTime = 203.4;
  ai1.lap = 3;
  ai1.d = 3 * L + 15;
  engine._onLapComplete(ai1, []);
  assert.strictEqual(ai1.finished, true);
  assert.strictEqual(ai1.finishPosition, 2);
  assert.strictEqual(ai1.finishTime, 203.4);
  assert.strictEqual(engine.state, RaceState.RACING);

  // AI 2 finishes P3 at t = 205.8s
  engine.simTime = 205.8;
  ai2.lap = 3;
  ai2.d = 3 * L + 12;
  engine._onLapComplete(ai2, []);
  assert.strictEqual(ai2.finished, true);
  assert.strictEqual(ai2.finishPosition, 3);
  assert.strictEqual(ai2.finishTime, 205.8);
  assert.strictEqual(engine.state, RaceState.RACING);

  // Player is still on lap 2
  player.lap = 2;
  player.d = 2 * L + 200;
  engine._updatePositions();

  assert.strictEqual(player.finished, false, 'Player not finished');
  assert.strictEqual(player.position, 4, 'Player is running in P4 behind finished cars');
  assert.strictEqual(engine.checkGlobalRaceFinished(), false, 'Race not globally finished');

  // Player completes Lap 2 -> Lap 3
  engine.simTime = 220.0;
  player.d = 3 * L - 200;
  engine._onLapComplete(player, []);
  assert.strictEqual(player.lap, 3, 'Player now on Lap 3');
  assert.strictEqual(player.finished, false, 'Player still racing lap 3');
  assert.strictEqual(engine.state, RaceState.RACING, 'Race still active for player');

  console.log('  ✓ 3 AI cars finished (P1: 200.0s, P2: 203.4s, P3: 205.8s).');
  console.log('  ✓ Player completed remaining laps independently without interference.');
  console.log('  ✓ Test B Passed: Multiple AI finishes preserved; player race continues.\n');
}

// ── Test C: Player Finishes -> Race Concludes ───────────────────────────────
{
  console.log('Test C: Player Finishes -> Global Race State Transitions to FINISHED');
  const engine = new RaceEngine();
  const grid = getGrid().slice(0, 4);
  engine.build(monzaTrack, grid, 3, { playerCarIdx: 2 });
  engine.start();

  const ai0 = engine.cars[0];
  const player = engine.cars[2];

  // AI 0 finishes P1
  engine.simTime = 210.0;
  ai0.lap = 3;
  ai0.d = 3 * L + 10;
  engine._onLapComplete(ai0, []);

  assert.strictEqual(engine.state, RaceState.RACING, 'Race active before player finishes');

  // Player completes final lap and crosses the line
  engine.simTime = 218.45;
  player.lap = 3;
  player.d = 3 * L + 20;
  engine._onLapComplete(player, []);

  assert.strictEqual(player.finished, true, 'Player marked finished');
  assert.strictEqual(player.finishPosition, 2, 'Player finished P2');
  assert.strictEqual(player.finishTime, 218.45, 'Player finish time recorded');

  // Global check
  assert.strictEqual(engine.checkGlobalRaceFinished(), true, 'Global race finish check must be TRUE');

  // Step engine once to trigger transition
  engine.step(0.05);
  assert.strictEqual(engine.state, RaceState.FINISHED, 'Engine state transitions to FINISHED');
  assert.strictEqual(engine.flag, 'chequered', 'Race flag transitions to chequered');

  console.log('  ✓ Player completed final lap and crossed line in P2.');
  console.log('  ✓ Engine authoritative state transitioned to FINISHED with chequered flag.');
  console.log('  ✓ Test C Passed: Authoritative race conclusion upon player finish.\n');
}

// ── Test D: Race Integrity & Non-Overwriting Classification ──────────────────
{
  console.log('Test D: Race Timing Integrity & Classification Order');
  const engine = new RaceEngine();
  const grid = getGrid().slice(0, 4);
  engine.build(monzaTrack, grid, 2, { playerCarIdx: 1 });
  engine.start();

  const c0 = engine.cars[0]; // AI
  const c1 = engine.cars[1]; // Player
  const c2 = engine.cars[2]; // AI
  const c3 = engine.cars[3]; // AI

  // Finish c0 at 140.0s (P1)
  engine.simTime = 140.0;
  c0.lap = 2; c0.d = 2 * L + 5;
  engine._onLapComplete(c0, []);

  // Finish c1 (Player) at 143.2s (P2)
  engine.simTime = 143.2;
  c1.lap = 2; c1.d = 2 * L + 8;
  engine._onLapComplete(c1, []);

  // Finish c2 at 145.0s (P3)
  engine.simTime = 145.0;
  c2.lap = 2; c2.d = 2 * L + 12;
  engine._onLapComplete(c2, []);

  // Finish c3 at 148.5s (P4)
  engine.simTime = 148.5;
  c3.lap = 2; c3.d = 2 * L + 15;
  engine._onLapComplete(c3, []);

  engine._updatePositions();
  const standings = engine.standings;

  assert.strictEqual(standings[0].code, c0.code, 'P1 is c0');
  assert.strictEqual(standings[0].finishPosition, 1);
  assert.strictEqual(standings[0].finishTime, 140.0);

  assert.strictEqual(standings[1].code, c1.code, 'P2 is c1 (Player)');
  assert.strictEqual(standings[1].finishPosition, 2);
  assert.strictEqual(standings[1].finishTime, 143.2);

  assert.strictEqual(standings[2].code, c2.code, 'P3 is c2');
  assert.strictEqual(standings[2].finishPosition, 3);
  assert.strictEqual(standings[2].finishTime, 145.0);

  assert.strictEqual(standings[3].code, c3.code, 'P4 is c3');
  assert.strictEqual(standings[3].finishPosition, 4);
  assert.strictEqual(standings[3].finishTime, 148.5);

  // Quick Race classification check
  const qrm = new QuickRaceManager();
  qrm.setConfig({ circuitId: 'monza', totalLaps: 2, playerDriverCode: c1.code });
  const finalClass = qrm.calculateFinalClassification(engine);

  assert.strictEqual(finalClass[0].position, 1);
  assert.strictEqual(finalClass[0].driverCode, c0.code);

  assert.strictEqual(finalClass[1].position, 2);
  assert.strictEqual(finalClass[1].driverCode, c1.code);
  assert.strictEqual(finalClass[1].isPlayer, true);
  assert.strictEqual(finalClass[1].gapText, '+3.200s');

  console.log('  ✓ Standings order:', standings.map(c => `P${c.position}:${c.code}(${c.finishTime}s)`).join(' -> '));
  console.log('  ✓ QuickRaceManager classification gapText matches delta:', finalClass[1].gapText);
  console.log('  ✓ Test D Passed: No times overwritten, exact finish order preserved.\n');
}

// ── Test E: Championship Mode Integrity ─────────────────────────────────────
{
  console.log('Test E: Championship Mode Integrity (No premature points/advance)');
  const champ = ChampionshipManager.createChampionship({
    year: 2024,
    calendarLength: 3,
    difficulty: 'normal',
    playerDriverCode: 'LEC',
    playerTeamName: 'Ferrari'
  });

  const round1 = ChampionshipManager.getCurrentRound(champ);
  round1.grid = champ.drivers.slice(0, 20).map((d, i) => ({ driverCode: d.code, gridPosition: i + 1 }));
  ChampionshipManager.advanceStage(champ, WeekendStage.RACE_IN_PROGRESS);
  assert.strictEqual(round1.stage, WeekendStage.RACE_IN_PROGRESS);
  const initialDriverStandings = JSON.parse(JSON.stringify(champ.driverStandings));

  // Build race engine for round 1
  const engine = new RaceEngine();
  const cData = getCircuit(round1.circuitId);
  const cTrack = buildTrack(cData, RAW_WAYPOINTS[round1.circuitId]);
  const playerIdx = round1.grid.findIndex(g => g.driverCode === 'LEC');

  engine.build(cTrack, round1.grid.map(g => champ.drivers.find(d => d.code === g.driverCode)), round1.laps, {
    playerCarIdx: playerIdx
  });
  engine.start();

  const playerCar = engine.cars[playerIdx];
  const aiWinner = engine.cars[playerIdx === 0 ? 1 : 0];

  // AI finishes first
  engine.simTime = 180.0;
  aiWinner.lap = round1.laps;
  aiWinner.d = round1.laps * cTrack.circuit.lengthM + 10;
  engine._onLapComplete(aiWinner, []);

  // Verify: AI finished, but round remains active, NO points awarded yet
  assert.strictEqual(aiWinner.finished, true, 'AI winner finished');
  assert.strictEqual(playerCar.finished, false, 'Player not finished');
  assert.strictEqual(engine.checkGlobalRaceFinished(), false, 'Engine not finished');
  assert.strictEqual(round1.stage, WeekendStage.RACE_IN_PROGRESS, 'Round stage must stay RACE_IN_PROGRESS while player drives');
  assert.deepStrictEqual(champ.driverStandings, initialDriverStandings, 'Points must NOT be awarded prematurely');

  // Player completes race
  engine.simTime = 188.0;
  playerCar.lap = round1.laps;
  playerCar.d = round1.laps * cTrack.circuit.lengthM + 20;
  engine._onLapComplete(playerCar, []);
  assert.strictEqual(engine.checkGlobalRaceFinished(), true, 'Engine now finished');

  engine.step(0.05);
  assert.strictEqual(engine.state, RaceState.FINISHED, 'Race officially FINISHED');

  // Now finalize race officially
  const results = ChampionshipManager.finalizeRace(champ, engine);
  assert.ok(results, 'Finalize race returned results');
  assert.strictEqual(round1.stage, WeekendStage.EVENT_COMPLETED, 'Round marked EVENT_COMPLETED');

  // Verify points awarded once
  const winnerStanding = champ.driverStandings.find(d => d.driverCode === aiWinner.code);
  assert.ok(winnerStanding.points > initialDriverStandings.find(d => d.driverCode === aiWinner.code).points, 'Winner awarded points');

  const ptsAfterFirstFinalize = winnerStanding.points;
  // Idempotency: calling finalizeRace again does not double points
  ChampionshipManager.finalizeRace(champ, engine);
  assert.strictEqual(winnerStanding.points, ptsAfterFirstFinalize, 'Points are idempotent and not duplicated');

  console.log('  ✓ AI finish did not prematurely trigger stage progression or award points.');
  console.log('  ✓ Standings updated cleanly once player completed the race.');
  console.log('  ✓ Test E Passed: Championship progression and scoring integrity validated.\n');
}

// ── Test F: Restart Reset & Player DNF ───────────────────────────────────────
{
  console.log('Test F: Restart Reset Cleanliness & Player DNF Handling');
  const engine = new RaceEngine();
  const grid = getGrid().slice(0, 4);
  engine.build(monzaTrack, grid, 2, { playerCarIdx: 0 });
  engine.start();

  const pCar = engine.cars[0];
  const aiCar = engine.cars[1];

  // Part 1: Player DNF
  pCar.lap = 1;
  pCar.d = 1000;
  const dnfRes = engine.retireCar(0, 'Hydraulic Leak');
  assert.strictEqual(dnfRes, true, 'retireCar must succeed');
  assert.strictEqual(pCar.retiredLap, 1, 'Player retiredLap recorded as 1');
  assert.strictEqual(pCar.v, 0, 'Retired car velocity zeroed');

  // AI finishes while player is DNF -> race must finish cleanly, not hang forever
  engine.simTime = 150.0;
  aiCar.lap = 2;
  aiCar.d = 2 * L + 10;
  engine._onLapComplete(aiCar, []);

  assert.strictEqual(aiCar.finished, true, 'AI finished');
  assert.strictEqual(engine.checkGlobalRaceFinished(), true, 'Global finish is TRUE when player is DNF and leader finishes');
  engine.step(0.05);
  assert.strictEqual(engine.state, RaceState.FINISHED, 'Race ends cleanly after player DNF without hanging');

  // Part 2: Restart Race
  engine.build(monzaTrack, grid, 2, { playerCarIdx: 0 });
  assert.strictEqual(engine.state, RaceState.WAITING, 'State reset to WAITING');
  assert.strictEqual(engine.cars[0].finished, false, 'Finished flag reset on car 0');
  assert.strictEqual(engine.cars[0].retiredLap, null, 'retiredLap reset to null');
  assert.strictEqual(engine.cars[0].finishTime, null, 'finishTime reset to null');
  assert.strictEqual(engine.cars[0].finishPosition, null, 'finishPosition reset to null');
  assert.strictEqual(engine._finishedCount, 0, '_finishedCount reset to 0');
  assert.strictEqual(engine._leaderFinished, false, '_leaderFinished reset to false');
  assert.strictEqual(engine._playerFinished, false, '_playerFinished reset to false');

  console.log('  ✓ Player DNF correctly concluded session when leader crossed line.');
  console.log('  ✓ Engine rebuild reset all flags, timers, and finish states.');
  console.log('  ✓ Test F Passed: Restart & retirement handling verified.\n');
}

console.log('═════════════════════════════════════════════════════════════════');
console.log('🎉 ALL RACE FINISH & LIFECYCLE INDEPENDENCE TESTS PASSED! 🎉');
console.log('═════════════════════════════════════════════════════════════════');
