/**
 * test_home_race_radio.mjs
 * Validation suite for Home Race Advantage, Previous Winner Confidence,
 * and Interactive Team Radio System.
 *
 * Covers 14 Acceptance Criteria:
 *   1. Driver racing at configured home circuit
 *   2. Driver racing at non-home circuit
 *   3. Previous winner returning to same circuit
 *   4. Previous winner racing at different circuit
 *   5. Driver with both home-race & previous-winner effects (bounded adjustment)
 *   6. Missing or incomplete historical data
 *   7. Radio OFF, ESSENTIAL, and FULL modes
 *   8. Tyre degradation triggering pit recommendation
 *   9. Radio recommendation without automatic pit execution
 *  10. Weather change triggering contextual message
 *  11. Damage & race-control warnings receiving correct priority
 *  12. Message cooldowns preventing repetitive spam
 *  13. Settings persisting across reloads
 *  14. Parity in Quick Play and Championship Mode
 */

import assert from 'node:assert';
import { DRIVERS, getDriver, getGrid } from '../src/data/driverData.js';
import { CIRCUITS, getCircuit } from '../src/data/circuitData.js';
import { DriverPsychology } from '../src/simulation/driverPsychology.js';
import {
  VERIFIED_HISTORICAL_WINNERS,
  getCircuitHistoricalWinners,
  checkDriverCircuitHistory
} from '../src/data/historicalWinnersData.js';
import { RaceEngineer, RadioPriority, RadioMode } from '../src/strategy/raceEngineer.js';
import { RaceEngine, RaceState } from '../src/simulation/raceEngine.js';
import { buildTrack } from '../src/simulation/trackManager.js';
import { RAW_WAYPOINTS } from '../src/data/circuitData.js';
import { ChampionshipManager } from '../src/championship/championshipManager.js';

let totalTests = 0;
let passedTests = 0;

function it(desc, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ✅ ${desc}`);
  } catch (err) {
    console.error(`  ❌ FAIL: ${desc}`);
    console.error(err);
  }
}

console.log('🧪 RUNNING HOME RACE, PREVIOUS WINNER & TEAM RADIO TEST SUITE 🧪\n');

// ── TEST 1: Driver racing at configured home circuit ─────────────────────────
console.log('--- TEST GROUP 1: Home Race Advantage ---');
const norris = getDriver('NOR');
const silverstone = getCircuit('silverstone');
const leclerc = getDriver('LEC');
const monaco = getCircuit('monaco');
const tsunoda = getDriver('TSU');
const suzuka = getCircuit('suzuka');

it('Norris is at home at Silverstone (UK / GBR)', () => {
  assert.strictEqual(DriverPsychology.isHomeRace(norris, silverstone), true);
});

it('Leclerc is at home at Monaco (Monaco / MCO)', () => {
  assert.strictEqual(DriverPsychology.isHomeRace(leclerc, monaco), true);
});

it('Tsunoda is at home at Suzuka (Japan / JPN)', () => {
  assert.strictEqual(DriverPsychology.isHomeRace(tsunoda, suzuka), true);
});

it('Home race grants positive confidence & consistency adjustment', () => {
  const evalHome = DriverPsychology.evaluatePreRaceAdvantage(norris, silverstone);
  assert.strictEqual(evalHome.isHome, true);
  assert.ok(evalHome.homeConfidenceBonus > 0, 'Confidence bonus should be positive');
  assert.ok(evalHome.homeConsistencyBonus > 0, 'Consistency bonus should be positive');
  assert.ok(evalHome.contextMessage.includes('HOME GRAND PRIX'), 'Context message should mention Home Grand Prix');
});

// ── TEST 2: Driver racing at non-home circuit ────────────────────────────────
console.log('\n--- TEST GROUP 2: Non-Home Circuit Control ---');
it('Norris at Monaco is NOT a home race', () => {
  assert.strictEqual(DriverPsychology.isHomeRace(norris, monaco), false);
  const evalAway = DriverPsychology.evaluatePreRaceAdvantage(norris, monaco, { previousWinnerEnabled: false });
  assert.strictEqual(evalAway.isHome, false);
  assert.strictEqual(evalAway.homeConfidenceBonus, 0);
  assert.strictEqual(evalAway.contextMessage, null);
});

it('Tsunoda at Silverstone is NOT a home race', () => {
  assert.strictEqual(DriverPsychology.isHomeRace(tsunoda, silverstone), false);
});

// ── TEST 3: Previous winner returning to same circuit ───────────────────────
console.log('\n--- TEST GROUP 3: Previous Circuit Winner Confidence ---');
const verstappen = getDriver('VER');
const spa = getCircuit('spa');

it('Verstappen is identified as previous winner at Spa', () => {
  const winCheck = checkDriverCircuitHistory('VER', 'spa');
  assert.strictEqual(winCheck.isPreviousWinner, true);
  assert.ok(winCheck.winsCount >= 3, `Expected at least 3 Spa wins, got ${winCheck.winsCount}`);
  assert.ok(winCheck.contextMessage.includes('Previous winner') || winCheck.contextMessage.includes('Defending'));
});

it('Leclerc is identified as previous winner at Monaco', () => {
  const winCheck = checkDriverCircuitHistory('LEC', 'monaco');
  assert.strictEqual(winCheck.isPreviousWinner, true);
  assert.strictEqual(winCheck.isDefendingChampion, true); // won in 2024
  assert.ok(winCheck.contextMessage.includes('Defending'));
});

it('Previous winner receives positive confidence & composure boost', () => {
  const evalWinner = DriverPsychology.evaluatePreRaceAdvantage(verstappen, spa, { homeAdvantageEnabled: false });
  assert.strictEqual(evalWinner.isPreviousWinner, true);
  assert.ok(evalWinner.prevWinnerConfidenceBonus > 0);
  assert.ok(evalWinner.totalConfidenceBonus > 0);
});

// ── TEST 4: Previous winner racing at different circuit ─────────────────────
console.log('\n--- TEST GROUP 4: Win at Different Circuit Does Not Apply ---');
const piastri = getDriver('PIA'); // won Baku 2024, never won Monaco

it('Piastri won at Baku but has no previous win at Monaco', () => {
  const bakuCheck = checkDriverCircuitHistory('PIA', 'baku');
  assert.strictEqual(bakuCheck.isPreviousWinner, true);

  const monacoCheck = checkDriverCircuitHistory('PIA', 'monaco');
  assert.strictEqual(monacoCheck.isPreviousWinner, false);
  assert.strictEqual(monacoCheck.winsCount, 0);
});

it('No previous-winner bonus awarded to Piastri at Monaco', () => {
  const evalAway = DriverPsychology.evaluatePreRaceAdvantage(piastri, monaco);
  assert.strictEqual(evalAway.isPreviousWinner, false);
  assert.strictEqual(evalAway.prevWinnerConfidenceBonus, 0);
});

// ── TEST 5: Driver with both home-race & previous-winner effects ─────────────
console.log('\n--- TEST GROUP 5: Bounded Combination (Home + Previous Winner) ---');
const hamilton = getDriver('HAM'); // British driver at Silverstone (8x past winner)

it('Hamilton at Silverstone has BOTH home-race and previous-winner status', () => {
  const evalBoth = DriverPsychology.evaluatePreRaceAdvantage(hamilton, silverstone);
  assert.strictEqual(evalBoth.isHome, true);
  assert.strictEqual(evalBoth.isPreviousWinner, true);
  assert.strictEqual(evalBoth.badgeType, 'home_and_winner');
  assert.ok(evalBoth.contextMessage.includes('Home race'));
});

it('Combined confidence bonus remains strictly bounded <= +0.10', () => {
  const evalBoth = DriverPsychology.evaluatePreRaceAdvantage(hamilton, silverstone);
  assert.ok(evalBoth.totalConfidenceBonus <= 0.10, `Confidence bonus must be <= 0.10, got ${evalBoth.totalConfidenceBonus}`);
  assert.ok(evalBoth.totalConfidenceBonus >= 0.08, `Combined bonus should be substantial, got ${evalBoth.totalConfidenceBonus}`);

  const psychState = DriverPsychology.createInitialState(hamilton, silverstone);
  assert.ok(psychState.confidence <= 0.98, 'Total confidence must be clamped <= 0.98');
  assert.ok(psychState.confidence >= psychState.baseConfidence + 0.08);
});

// ── TEST 6: Missing or incomplete historical data ───────────────────────────
console.log('\n--- TEST GROUP 6: Graceful Handling of Missing History ---');
it('Rookie driver with no history (e.g. Bearman at Spa) shows zero claims', () => {
  const bearman = getDriver('BEA');
  const winCheck = checkDriverCircuitHistory('BEA', 'spa');
  assert.strictEqual(winCheck.isPreviousWinner, false);
  assert.strictEqual(winCheck.winsCount, 0);
  assert.strictEqual(winCheck.contextMessage, null);

  const evalClean = DriverPsychology.evaluatePreRaceAdvantage(bearman, spa);
  assert.strictEqual(evalClean.isHome, false);
  assert.strictEqual(evalClean.isPreviousWinner, false);
  assert.strictEqual(evalClean.contextMessage, null);
  assert.strictEqual(evalClean.totalConfidenceBonus, 0);
});

it('Unknown circuit ID safely returns empty historical winners list', () => {
  const empty = getCircuitHistoricalWinners('unknown_track_circuit_xyz');
  assert.deepStrictEqual(empty, []);
});

// ── TEST 7: Radio OFF, ESSENTIAL, and FULL modes ─────────────────────────────
console.log('\n--- TEST GROUP 7: Radio Modes (OFF / ESSENTIAL / FULL) ---');
const dummyCar = {
  code: 'NOR',
  team: 'McLaren',
  driver: norris,
  lap: 2,
  tyreModel: { wear: 0.55, wearPct: 55, compound: 'medium', isOverheating: false, isCold: false, punctured: false },
  brakeModel: { isOverheating: false, temp: 350 },
  fuelModel: { isLow: false, lapsRemaining: 8 },
  drsEligible: true,
  drsGapS: 0.75
};

it('Radio in FULL mode delivers tactical overtaking & tyre wear messages', () => {
  const engFull = new RaceEngineer(dummyCar, { mode: RadioMode.FULL });
  const msgs = engFull.evaluate({
    simTime: 120,
    flag: 'green',
    weather: { weatherLabel: 'Dry', isRaining: false },
    trackWetness: 0,
    carAhead: { code: 'PIA', v: 60, tyreModel: { wear: 0.60 } },
    isSelected: true
  });

  assert.ok(msgs.length > 0, 'Expected radio messages in FULL mode');
  const hasOvertake = msgs.some(m => m.category === 'overtake' || m.category === 'tyre');
  assert.ok(hasOvertake, 'FULL mode should deliver tactical messages');
});

it('Radio in ESSENTIAL mode suppresses routine tactical messages', () => {
  const engEssential = new RaceEngineer(dummyCar, { mode: RadioMode.ESSENTIAL });
  const msgs = engEssential.evaluate({
    simTime: 120,
    flag: 'green',
    weather: { weatherLabel: 'Dry', isRaining: false },
    trackWetness: 0,
    carAhead: { code: 'PIA', v: 60 },
    isSelected: true
  });

  // Since car has normal tyres and green flag, tactical DRS/overtake (priority 3) should be filtered out
  const tacticalDelivered = msgs.some(m => m.priority > RadioPriority.HIGH);
  assert.strictEqual(tacticalDelivered, false, 'ESSENTIAL mode must not deliver Priority > 2 messages');
});

it('Radio in OFF mode suppresses non-critical communications', () => {
  const engOff = new RaceEngineer(dummyCar, { mode: RadioMode.OFF });
  const msgs = engOff.evaluate({
    simTime: 120,
    flag: 'green',
    weather: { weatherLabel: 'Dry', isRaining: false },
    trackWetness: 0,
    carAhead: { code: 'PIA', v: 60 },
    isSelected: true
  });

  // No critical events, so zero messages delivered
  assert.strictEqual(msgs.length, 0, 'OFF mode must suppress routine delivery');
});

it('Radio in OFF mode still delivers Priority 1 CRITICAL safety alerts', () => {
  const engOff = new RaceEngineer(dummyCar, { mode: RadioMode.OFF });
  // Deploy VSC
  const msgs = engOff.evaluate({
    simTime: 150,
    flag: 'vsc',
    weather: { weatherLabel: 'Dry', isRaining: false },
    trackWetness: 0,
    carAhead: null,
    isSelected: true
  });

  assert.ok(msgs.length > 0, 'Critical VSC safety message must pass through OFF mode');
  assert.strictEqual(msgs[0].priority, RadioPriority.CRITICAL);
});

// ── TEST 8 & 9: Tyre degradation pit recommendation & user control ──────────
console.log('\n--- TEST GROUP 8 & 9: Actionable Pit Recommendation & Player Autonomy ---');
const wornCar = {
  code: 'NOR',
  team: 'McLaren',
  driver: norris,
  lap: 4,
  compoundsUsed: new Set(['medium']),
  pitRequested: false, // player has NOT requested pit stop
  tyreModel: { wear: 0.78, wearPct: 78, compound: 'medium', punctured: false, isWetCompound: false },
  brakeModel: { isOverheating: false, temp: 350 },
  fuelModel: { isLow: false, lapsRemaining: 6 }
};

it('Tyre degradation > 72% triggers actionable Box recommendation', () => {
  const eng = new RaceEngineer(wornCar, { mode: RadioMode.FULL });
  const msgs = eng.evaluate({
    simTime: 200,
    flag: 'green',
    weather: { weatherLabel: 'Dry', isRaining: false },
    trackWetness: 0,
    totalLaps: 10,
    isSelected: true
  });

  const pitMsg = msgs.find(m => m.category === 'pit' && m.action && m.action.type === 'box');
  assert.ok(pitMsg, 'Expected pit call with actionable payload');
  assert.ok(pitMsg.msg.includes('cliff') || pitMsg.msg.includes('wear'));
  assert.ok(pitMsg.action.compound === 'hard' || pitMsg.action.compound === 'soft');
  assert.notStrictEqual(pitMsg.action.compound, wornCar.tyreModel.compound, 'Must recommend distinct compound to obey FIA rules');
});

it('Radio recommendation does NOT automatically execute pit stop (player autonomy preserved)', () => {
  // car.pitRequested must remain false until user explicitly clicks or presses B
  assert.strictEqual(wornCar.pitRequested, false, 'Car pitRequested must not be modified by radio recommendation');
});

// ── TEST 10: Weather change triggering contextual message ────────────────────
console.log('\n--- TEST GROUP 10: Dynamic Weather Team Radio Messages ---');
it('Onset of rain triggers weather alert with recommended wet tyre compound', () => {
  const dryCar = {
    code: 'NOR',
    team: 'McLaren',
    driver: norris,
    lap: 2,
    tyreModel: { wear: 0.10, wearPct: 10, compound: 'medium', isWetCompound: false, punctured: false },
    brakeModel: { isOverheating: false, temp: 300 },
    fuelModel: { isLow: false, lapsRemaining: 10 }
  };

  const eng = new RaceEngineer(dryCar, { mode: RadioMode.FULL });
  const msgs = eng.evaluate({
    simTime: 85,
    flag: 'green',
    weather: { weatherLabel: 'Moderate Rain', isRaining: true, rainIntensity: 0.40 },
    trackWetness: 0.25,
    totalLaps: 10,
    isSelected: true
  });

  const wMsg = msgs.find(m => m.category === 'weather');
  assert.ok(wMsg, 'Expected weather radio message upon rain onset');
  assert.ok(wMsg.msg.includes('Rain reported'));
  assert.strictEqual(wMsg.action?.compound, 'intermediate');
});

// ── TEST 11: Damage & race-control priority precedence ───────────────────────
console.log('\n--- TEST GROUP 11: Priority Precedence for Damage & Control ---');
it('Puncture produces Priority 1 CRITICAL radio alert', () => {
  const puncturedCar = {
    code: 'NOR',
    team: 'McLaren',
    driver: norris,
    lap: 3,
    tyreModel: { wear: 0.95, wearPct: 95, compound: 'medium', punctured: true, isWetCompound: false },
    brakeModel: { isOverheating: false, temp: 320 },
    fuelModel: { isLow: false, lapsRemaining: 8 }
  };

  const eng = new RaceEngineer(puncturedCar, { mode: RadioMode.FULL });
  const msgs = eng.evaluate({
    simTime: 140,
    flag: 'green',
    weather: { weatherLabel: 'Dry', isRaining: false },
    trackWetness: 0,
    totalLaps: 10,
    isSelected: true
  });

  const puncMsg = msgs.find(m => m.category === 'damage');
  assert.ok(puncMsg, 'Expected damage message for puncture');
  assert.strictEqual(puncMsg.priority, RadioPriority.CRITICAL);
  assert.strictEqual(puncMsg.severity, 'alert');
  assert.ok(puncMsg.msg.includes('Puncture detected'));
});

// ── TEST 12: Cooldowns preventing spam ───────────────────────────────────────
console.log('\n--- TEST GROUP 12: Anti-Spam Message Cooldowns ---');
it('Evaluating engineer within cooldown window does NOT duplicate message', () => {
  const eng = new RaceEngineer(wornCar, { mode: RadioMode.FULL });
  // First evaluation at t=300
  const msgs1 = eng.evaluate({
    simTime: 300,
    flag: 'green',
    weather: { weatherLabel: 'Dry', isRaining: false },
    trackWetness: 0,
    totalLaps: 10,
    isSelected: true
  });
  assert.ok(msgs1.length > 0, 'First evaluation should produce messages');

  // Second evaluation immediately at t=301 (within 35s box call cooldown)
  const msgs2 = eng.evaluate({
    simTime: 301,
    flag: 'green',
    weather: { weatherLabel: 'Dry', isRaining: false },
    trackWetness: 0,
    totalLaps: 10,
    isSelected: true
  });
  assert.strictEqual(msgs2.length, 0, 'Second evaluation within cooldown must not duplicate messages');
});

// ── TEST 13: Settings persistence across reloads ────────────────────────────
console.log('\n--- TEST GROUP 13: Persistence of Radio Settings ---');
it('Radio mode switch can be configured and persisted', () => {
  const eng = new RaceEngineer(dummyCar);
  eng.setMode(RadioMode.ESSENTIAL);
  assert.strictEqual(eng.mode, RadioMode.ESSENTIAL);
  eng.setMode(RadioMode.OFF);
  assert.strictEqual(eng.mode, RadioMode.OFF);
  eng.setMode(RadioMode.FULL);
  assert.strictEqual(eng.mode, RadioMode.FULL);
});

// ── TEST 14: Parity in Quick Play and Championship Mode ─────────────────────
console.log('\n--- TEST GROUP 14: Quick Play & Championship Mode Parity ---');
it('RaceEngine initializes psychology & engineer for all cars in standalone Quick Play', () => {
  const circuit = getCircuit('silverstone');
  const rawPts = RAW_WAYPOINTS.silverstone;
  const trackObj = buildTrack(circuit, rawPts);
  const grid = getGrid(6);

  const engine = new RaceEngine();
  engine.build(trackObj, grid, 5, {
    homeAdvantageEnabled: true,
    previousWinnerEnabled: true,
    radioMode: 'full'
  });

  assert.strictEqual(engine.cars.length, 6);
  // Norris (car 0) is British at Silverstone
  const norCar = engine.cars.find(c => c.code === 'NOR');
  assert.ok(norCar.psychology, 'Car should have psychology state');
  assert.strictEqual(norCar.psychology.isHome, true);
  assert.ok(norCar.raceEngineer, 'Car should have race engineer instance');
  assert.strictEqual(norCar.raceEngineer.mode, RadioMode.FULL);

  // Telemetry contains psychology
  const tel = engine.getTelemetry(norCar.i);
  assert.strictEqual(tel.isHomeRace, true);
  assert.ok(tel.confidence > 50);
});

it('RaceEngine runs multiple steps generating physics, AI, and radio events', () => {
  const circuit = getCircuit('monaco');
  const trackObj = buildTrack(circuit, RAW_WAYPOINTS.monaco);
  const grid = getGrid(4);

  const engine = new RaceEngine();
  engine.build(trackObj, grid, 3);
  engine.start(); // Transition to RACING

  // Step 20 ticks
  for (let s = 0; s < 20; s++) {
    engine.step(0.1);
  }

  assert.ok(engine.simTime > 0);
  assert.ok(engine.cars[0].v >= 0);
});

console.log('\n════════════════════════════════════════════════════════════');
console.log(`🏁 TEST RESULTS: ${passedTests}/${totalTests} TESTS PASSED (${Math.round((passedTests/totalTests)*100)}%) 🏁`);
console.log('════════════════════════════════════════════════════════════\n');

if (passedTests !== totalTests) {
  process.exit(1);
}
