/**
 * test_championship_workflow.mjs
 * End-to-End Automated Test of the F1 Championship Mode Workflow.
 *
 * Simulates a full 3-Round Championship Season (Monaco, Silverstone, Spa):
 *   1. Championship creation & initialization
 *   2. Practice session progression
 *   3. Authoritative qualifying execution & grid formation
 *   4. Starting grid confirmation & race preparation
 *   5. Race simulation through chequered flag
 *   6. Authoritative & IDEMPOTENT race finalization
 *   7. Points allocation (FIA 25-18-15-12-10-8-6-4-2-1 + FL)
 *   8. Driver and Constructor standings calculation with tie-breakers
 *   9. Mid-season state persistence & reload
 *  10. Multi-round progression to season finale
 *  11. World Champion coronation and history archiving
 *  12. Independence of Quick Play
 */

import { ChampionshipManager } from '../src/championship/championshipManager.js';
import { WeekendStage, SeasonStatus } from '../src/championship/championshipState.js';
import { RaceEngine, RaceState } from '../src/simulation/raceEngine.js';
import { buildTrack } from '../src/simulation/trackManager.js';
import { getCircuit, RAW_WAYPOINTS } from '../src/data/circuitData.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

console.log('🧪 RUNNING F1 CHAMPIONSHIP WORKFLOW END-TO-END VALIDATION 🧪\n');

// ── STEP 1: Championship Creation ──────────────────────────────────────────
console.log('--- STEP 1: Championship Creation & Identity ---');
ChampionshipManager.deleteActiveChampionship(); // clean start

const testConfig = {
  name: '2025 Test World Championship',
  raceDistance: 'short', // 3 laps for testing speed
  aiDifficulty: 'normal',
  rules: {
    practiceEnabled: true,
    qualifyingEnabled: true,
    fastestLapPoint: true,
    twoCompoundRule: true,
  },
  player: { driverCode: 'NOR', team: 'McLaren', teammateCode: 'PIA' },
  circuitIds: ['monaco', 'silverstone', 'spa']
};

let champ = ChampionshipManager.createChampionship(testConfig);

assert(champ !== null, 'Championship successfully created');
assert(champ.id.startsWith('champ_'), `Valid championship ID: ${champ.id}`);
assert(champ.calendar.length === 3, 'Calendar contains exactly 3 rounds');
assert(champ.currentRoundIndex === 0, 'Season starts at Round 1 (index 0)');
assert(champ.status === SeasonStatus.IN_PROGRESS, 'Season status is IN_PROGRESS');
assert(champ.player.driverCode === 'NOR', 'Player driver is Lando Norris (NOR)');
assert(champ.player.teammateCode === 'PIA', 'Teammate is Oscar Piastri (PIA)');
assert(champ.driverStandings.length === 20, 'Driver standings contain full 20-car grid');
assert(champ.driverStandings.every(d => d.points === 0), 'All drivers initialize with 0 points');

// ── STEP 2: Round 1 (Monaco) - Practice Session ────────────────────────────
console.log('\n--- STEP 2: Round 1 (Monaco) - Weekend Overview & Practice ---');
let round1 = ChampionshipManager.getCurrentRound(champ);
assert(round1.circuitId === 'monaco', 'Round 1 circuit is Monaco');
assert(round1.stage === WeekendStage.EVENT_OVERVIEW, 'Round starts in EVENT_OVERVIEW stage');

// Advance to practice
ChampionshipManager.advanceStage(champ, WeekendStage.PRACTICE_PENDING);
round1 = ChampionshipManager.getCurrentRound(champ);
assert(round1.stage === WeekendStage.PRACTICE_PENDING, 'Stage advanced to PRACTICE_PENDING');

// Complete practice
const practiceRes = ChampionshipManager.completePractice(champ, [74.215, 73.810, 73.550]);
assert(practiceRes.completed === true, 'Practice session completed');
assert(practiceRes.bestLap === 73.550, `Recorded practice best lap: ${practiceRes.bestLap}s`);
assert(round1.stage === WeekendStage.PRACTICE_COMPLETED, 'Stage advanced to PRACTICE_COMPLETED');

// ── STEP 3: Round 1 - Qualifying Session & Grid Formation ──────────────────
console.log('\n--- STEP 3: Round 1 (Monaco) - Qualifying Shootout ---');
ChampionshipManager.advanceStage(champ, WeekendStage.QUALIFYING_PENDING);
const qualiResults = ChampionshipManager.runQualifying(champ, 72.850);

assert(Array.isArray(qualiResults) && qualiResults.length === 20, 'Qualifying produced 20 timed driver entries');
assert(qualiResults[0].isPole === true, `P1 Pole position awarded to: ${qualiResults[0].driverCode}`);
assert(qualiResults[0].position === 1, 'Pole position has position 1');
assert(qualiResults[0].gapS === 0, 'Pole gap is 0.000s');

// Verify ascending order (fastest first)
let timesSorted = true;
for (let i = 1; i < qualiResults.length; i++) {
  if (qualiResults[i].lapTimeS < qualiResults[i - 1].lapTimeS) {
    timesSorted = false; break;
  }
}
assert(timesSorted, 'Qualifying times are strictly sorted fastest to slowest');

// Verify starting grid constructed
round1 = ChampionshipManager.getCurrentRound(champ);
assert(Array.isArray(round1.grid) && round1.grid.length === 20, 'Starting grid constructed with 20 slots');
assert(round1.grid[0].driverCode === qualiResults[0].driverCode, 'Grid slot 1 matches Pole winner');
assert(round1.stage === WeekendStage.QUALIFYING_COMPLETED, 'Stage advanced to QUALIFYING_COMPLETED');

// ── STEP 4: Grid Confirmation & Race Preparation ───────────────────────────
console.log('\n--- STEP 4: Round 1 (Monaco) - Grid Confirmation & Race Prep ---');
ChampionshipManager.advanceStage(champ, WeekendStage.GRID_CONFIRMATION);
assert(round1.stage === WeekendStage.GRID_CONFIRMATION, 'Stage is GRID_CONFIRMATION');

ChampionshipManager.advanceStage(champ, WeekendStage.RACE_READY);
assert(round1.stage === WeekendStage.RACE_READY, 'Stage is RACE_READY');

ChampionshipManager.advanceStage(champ, WeekendStage.RACE_IN_PROGRESS);
assert(round1.stage === WeekendStage.RACE_IN_PROGRESS, 'Stage is RACE_IN_PROGRESS');

// ── STEP 5: Live Race Execution & Chequered Flag ───────────────────────────
console.log('\n--- STEP 5: Round 1 (Monaco) - Live Race Execution ---');
const circuitM = getCircuit('monaco');
const rawM = RAW_WAYPOINTS.monaco;
const trackM = buildTrack(circuitM, rawM);

// The grid order from qualifying is passed into RaceEngine
const gridDrivers = round1.grid.map(g => champ.drivers.find(d => d.code === g.driverCode));
const engine = new RaceEngine();
engine.build(trackM, gridDrivers, 3); // 3 laps
engine.start();

assert(engine.cars.length === 20, 'RaceEngine initialized with 20 drivers in qualifying grid order');
assert(engine.cars[0].code === round1.grid[0].driverCode, `P1 on track is ${engine.cars[0].code}`);

// Run race ticks until chequered flag
let ticks = 0;
while (engine.state !== RaceState.FINISHED && ticks < 2000) {
  engine.warp = 50; // fast forward simulation
  engine.step(0.05);
  ticks++;
}

assert(engine.state === RaceState.FINISHED, `Race finished after ${ticks} steps (SimTime: ${engine.simTime.toFixed(1)}s)`);
assert(engine.standings[0].finished === true, `Winner is ${engine.standings[0].code}`);

// ── STEP 6: Authoritative & IDEMPOTENT Finalization ─────────────────────────
console.log('\n--- STEP 6: Round 1 - Idempotent Race Finalization & Scoring ---');
const fin1 = ChampionshipManager.finalizeRace(champ, engine);

assert(fin1.alreadyFinalized === false, 'First finalization executed successfully');
assert(fin1.raceResults.length === 20, '20 classified finishers recorded');
assert(fin1.raceResults[0].finishPosition === 1, 'P1 recorded as winner');
assert(fin1.raceResults[0].pointsEarned >= 25, `Winner awarded at least 25 points (${fin1.raceResults[0].pointsEarned} pts)`);
assert(fin1.fastestLap !== null, `Fastest lap recorded: ${fin1.fastestLap.driverCode} (${fin1.fastestLap.timeFormatted})`);

// Verify IDEMPOTENCY: calling finalizeRace second time MUST NOT double-score points!
const initialLeaderPts = champ.driverStandings[0].points;
const fin2 = ChampionshipManager.finalizeRace(champ, engine);
assert(fin2.alreadyFinalized === true, 'Second finalization safely detected idempotency lock');
assert(champ.driverStandings[0].points === initialLeaderPts, `Points remained strictly unchanged (${initialLeaderPts} pts)`);

// ── STEP 7: Standings & Constructor Points Verification ────────────────────
console.log('\n--- STEP 7: Round 1 - Standings & Constructor Points ---');
assert(champ.driverStandings[0].position === 1, 'Standings leader has P1');
assert(champ.driverStandings[0].points >= 25, 'Standings leader has 25+ points');
assert(champ.driverStandings[0].wins === 1, 'Standings leader has 1 race win');

const mclaren = champ.constructorStandings.find(c => c.team === 'McLaren');
const nor = champ.driverStandings.find(d => d.driverCode === 'NOR');
const pia = champ.driverStandings.find(d => d.driverCode === 'PIA');
assert(mclaren.points === (nor.points + pia.points),
  `Constructor points (${mclaren.points}) exactly equals sum of NOR (${nor.points}) + PIA (${pia.points})`);

// ── STEP 8: State Persistence & Reload Verification ────────────────────────
console.log('\n--- STEP 8: State Persistence & Mid-Season Reload ---');
ChampionshipManager.saveActiveChampionship(champ);

// Load from persistence
const reloaded = ChampionshipManager.loadActiveChampionship();
assert(reloaded !== null, 'Championship successfully reloaded from storage');
assert(reloaded.id === champ.id, 'Loaded championship matches original ID');
assert(reloaded.currentRoundIndex === 0, 'Current round is index 0');
assert(reloaded.calendar[0].status === 'completed', 'Round 1 status preserved as completed');
assert(reloaded.driverStandings[0].points === champ.driverStandings[0].points, 'Driver standings points preserved identically');

// ── STEP 9: Advance to Round 2 (Silverstone) ───────────────────────────────
console.log('\n--- STEP 9: Advance to Round 2 (Silverstone) ---');
const adv1 = ChampionshipManager.advanceToNextRound(reloaded);

assert(adv1.seasonFinished === false, 'Season continues to next round');
assert(reloaded.currentRoundIndex === 1, 'Current round advanced to index 1');
let round2 = ChampionshipManager.getCurrentRound(reloaded);
assert(round2.circuitId === 'silverstone', 'Round 2 circuit is Silverstone');
assert(round2.status === 'in_progress', 'Round 2 status is in_progress');

// Run Round 2: Skip practice, Run Quali, Run Race
ChampionshipManager.skipPractice(reloaded);
ChampionshipManager.runQualifying(reloaded, 87.200);
ChampionshipManager.advanceStage(reloaded, WeekendStage.GRID_CONFIRMATION);
ChampionshipManager.advanceStage(reloaded, WeekendStage.RACE_READY);
ChampionshipManager.advanceStage(reloaded, WeekendStage.RACE_IN_PROGRESS);

const circuitS = getCircuit('silverstone');
const rawS = RAW_WAYPOINTS.silverstone;
const trackS = buildTrack(circuitS, rawS);
const gridDrivers2 = round2.grid.map(g => reloaded.drivers.find(d => d.code === g.driverCode));
const engine2 = new RaceEngine();
engine2.build(trackS, gridDrivers2, 3);
engine2.start();

ticks = 0;
while (engine2.state !== RaceState.FINISHED && ticks < 2000) {
  engine2.warp = 50;
  engine2.step(0.05);
  ticks++;
}

ChampionshipManager.finalizeRace(reloaded, engine2);
assert(round2.status === 'completed', 'Round 2 finalized and completed');
assert(reloaded.driverStandings[0].points > initialLeaderPts, 'Leader accumulated points across Rounds 1 & 2');

// ── STEP 10: Advance to Round 3 (Spa - Season Finale) ──────────────────────
console.log('\n--- STEP 10: Advance to Round 3 (Spa - Final Round) ---');
const adv2 = ChampionshipManager.advanceToNextRound(reloaded);
assert(adv2.seasonFinished === false, 'Season enters final round');
assert(reloaded.currentRoundIndex === 2, 'Current round is index 2 (final)');
let round3 = ChampionshipManager.getCurrentRound(reloaded);
assert(round3.circuitId === 'spa', 'Round 3 circuit is Spa-Francorchamps');

ChampionshipManager.skipPractice(reloaded);
ChampionshipManager.runQualifying(reloaded, 104.500);
ChampionshipManager.advanceStage(reloaded, WeekendStage.GRID_CONFIRMATION);
ChampionshipManager.advanceStage(reloaded, WeekendStage.RACE_READY);
ChampionshipManager.advanceStage(reloaded, WeekendStage.RACE_IN_PROGRESS);

const circuitSpa = getCircuit('spa');
const rawSpa = RAW_WAYPOINTS.spa;
const trackSpa = buildTrack(circuitSpa, rawSpa);
const gridDrivers3 = round3.grid.map(g => reloaded.drivers.find(d => d.code === g.driverCode));
const engine3 = new RaceEngine();
engine3.build(trackSpa, gridDrivers3, 3);
engine3.start();

ticks = 0;
while (engine3.state !== RaceState.FINISHED && ticks < 2000) {
  engine3.warp = 50;
  engine3.step(0.05);
  ticks++;
}

ChampionshipManager.finalizeRace(reloaded, engine3);
assert(round3.status === 'completed', 'Round 3 finalized and completed');

// ── STEP 11: Season Completion & History Archiving ─────────────────────────
console.log('\n--- STEP 11: Season Finale & World Champions ---');
const advFinale = ChampionshipManager.advanceToNextRound(reloaded);

assert(advFinale.seasonFinished === true, 'Season successfully completed!');
assert(reloaded.status === SeasonStatus.COMPLETED, 'Season status is COMPLETED');
assert(advFinale.champion !== undefined && advFinale.champion.points > 0,
  `🏆 2025 World Drivers' Champion: ${advFinale.champion.name} (${advFinale.champion.team}) with ${advFinale.champion.points} pts`);
assert(advFinale.constructorChampion !== undefined,
  `🏆 2025 World Constructors' Champion: ${advFinale.constructorChampion.team} with ${advFinale.constructorChampion.points} pts`);

// Verify archived history
const history = ChampionshipManager.getChampionshipHistory();
assert(history.length >= 1, `Season successfully archived to history (${history.length} archived seasons)`);
assert(history[0].champion.driverCode === advFinale.champion.driverCode, 'Archived season champion matches finale');

// ── STEP 12: Independence of Quick Play ────────────────────────────────────
console.log('\n--- STEP 12: Independence of Quick Play ---');
const champPtsBeforeQP = reloaded.driverStandings[0].points;

// Run a standalone Quick Play race on Monza
const qpCircuit = getCircuit('monza');
const qpTrack = buildTrack(qpCircuit, RAW_WAYPOINTS.monza);
const qpEngine = new RaceEngine();
qpEngine.build(qpTrack, champ.drivers.slice(0, 6), 3);
qpEngine.start();
for (let i = 0; i < 50; i++) {
  qpEngine.warp = 10;
  qpEngine.step(0.05);
}

// Check that championship was not touched
const currentChamp = ChampionshipManager.loadActiveChampionship();
assert(currentChamp.driverStandings[0].points === champPtsBeforeQP,
  'Quick Play did not modify championship standings (100% independent)');

// ── SUMMARY ──
console.log('\n════════════════════════════════════════════════════════════');
if (failed === 0) {
  console.log(`🏁 ALL ${passed} CHAMPIONSHIP WORKFLOW TESTS PASSED (100%) 🏁`);
} else {
  console.error(`💥 ${failed} TESTS FAILED out of ${passed + failed}`);
  process.exit(1);
}
console.log('════════════════════════════════════════════════════════════\n');
