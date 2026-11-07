/**
 * test_tyre_strategy.mjs
 * Validation suite for:
 *   1. Accelerated 1x baseline simulation speed (WARP_RATES)
 *   2. Complete F1 Tyre Compound and Strategy System (5 compounds)
 *   3. Tyre thermodynamics, wear cliff, punctures, limp mode, and flat spots
 *   4. Dynamic weather grip crossover (Dry, Damp, Heavy Wet)
 *   5. FIA Two-Compound mandatory dry rule enforcement
 *   6. Safety Car / VSC opportunistic cheap pit stop windows
 *   7. User-directed pit stop compound swaps
 */

import { TyreModel, TYRE_COMPOUNDS } from '../src/simulation/tyreModel.js';
import { StrategyAI } from '../src/strategy/strategyAI.js';
import { RaceEngine } from '../src/simulation/raceEngine.js';
import { buildTrack } from '../src/simulation/trackManager.js';
import { getCircuit, RAW_WAYPOINTS } from '../src/data/circuitData.js';
import { getGrid } from '../src/data/driverData.js';
import { WARP_RATES } from '../src/app.js';
import { PitStopManager, PitStates } from '../src/strategy/pitStopManager.js';

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

console.log('🧪 RUNNING F1 TYRE COMPOUND & STRATEGY VALIDATION SUITE 🧪\n');

// ── TEST GROUP 1: 1x Speed Warp Enhancement ──
console.log('--- TEST GROUP 1: 1x Speed Warp Enhancement ---');
assert(WARP_RATES[1] >= 2.0, `1x warp is accelerated for broadcast pacing (WARP_RATES[1] = ${WARP_RATES[1]}x)`);
assert(WARP_RATES[2] >= 4.0, `2x warp is appropriately scaled (WARP_RATES[2] = ${WARP_RATES[2]}x)`);
assert(WARP_RATES[5] >= 10.0, `5x warp offers rapid simulation (WARP_RATES[5] = ${WARP_RATES[5]}x)`);

// ── TEST GROUP 2: 5 Compounds Representation & Physical Parameters ──
console.log('\n--- TEST GROUP 2: 5 Compounds Representation & Physical Parameters ---');
const compounds = ['soft', 'medium', 'hard', 'intermediate', 'wet'];
compounds.forEach(cmp => {
  const spec = TYRE_COMPOUNDS[cmp];
  assert(spec !== undefined, `Compound '${cmp}' exists with valid specification`);
  assert(typeof spec.colour === 'string' && spec.colour.startsWith('#'), `'${cmp}' has official FIA colour: ${spec.colour}`);
  assert(spec.baseGrip > 0, `'${cmp}' has positive base grip (${spec.baseGrip})`);
  assert(spec.optTempMin < spec.optTempMax, `'${cmp}' has valid operating window: ${spec.optTempMin}°C - ${spec.optTempMax}°C`);
});

// Verify base grip dry hierarchy: Soft > Medium > Hard
assert(TYRE_COMPOUNDS.soft.baseGrip > TYRE_COMPOUNDS.medium.baseGrip, 'Soft base grip > Medium base grip');
assert(TYRE_COMPOUNDS.medium.baseGrip > TYRE_COMPOUNDS.hard.baseGrip, 'Medium base grip > Hard base grip');
// Verify degradation dry hierarchy: Soft > Medium > Hard
assert(TYRE_COMPOUNDS.soft.degradBase > TYRE_COMPOUNDS.medium.degradBase, 'Soft degradation > Medium degradation');
assert(TYRE_COMPOUNDS.medium.degradBase > TYRE_COMPOUNDS.hard.degradBase, 'Medium degradation > Hard degradation');

// ── TEST GROUP 3: Dynamic Weather Grip Crossovers ──
console.log('\n--- TEST GROUP 3: Dynamic Weather Grip Crossovers ---');
const softTyre = new TyreModel('soft');
const interTyre = new TyreModel('intermediate');
const wetTyre = new TyreModel('wet');

// Optimal temps
softTyre.temp = 100;
interTyre.temp = 75;
wetTyre.temp = 65;

// Scenario A: Bone Dry (wetness = 0.0)
const drySoftGrip  = softTyre.getGrip(0.0).totalGrip;
const dryInterGrip = interTyre.getGrip(0.0).totalGrip;
const dryWetGrip   = wetTyre.getGrip(0.0).totalGrip;

assert(drySoftGrip > dryInterGrip && dryInterGrip > dryWetGrip,
  `Bone Dry: Soft (${drySoftGrip.toFixed(2)}) > Inter (${dryInterGrip.toFixed(2)}) > Wet (${dryWetGrip.toFixed(2)})`);

// Scenario B: Damp / Intermediate conditions (wetness = 0.35)
const dampSoftGrip  = softTyre.getGrip(0.35).totalGrip;
const dampInterGrip = interTyre.getGrip(0.35).totalGrip;
const dampWetGrip   = wetTyre.getGrip(0.35).totalGrip;

assert(dampInterGrip > dampSoftGrip,
  `Damp track (35% wet): Inter (${dampInterGrip.toFixed(2)}) out-grips Slicks (${dampSoftGrip.toFixed(2)})`);
assert(dampInterGrip >= dampWetGrip,
  `Damp track (35% wet): Inter (${dampInterGrip.toFixed(2)}) is optimal over Full Wet (${dampWetGrip.toFixed(2)})`);

// Scenario C: Heavy Rain / Standing Water (wetness = 0.85)
const wetSoftGrip  = softTyre.getGrip(0.85).totalGrip;
const wetInterGrip = interTyre.getGrip(0.85).totalGrip;
const wetWetGrip   = wetTyre.getGrip(0.85).totalGrip;

assert(wetWetGrip > wetInterGrip,
  `Heavy Rain (85% wet): Full Wet (${wetWetGrip.toFixed(2)}) out-grips Inter (${wetInterGrip.toFixed(2)})`);
assert(wetWetGrip > wetSoftGrip * 2,
  `Heavy Rain (85% wet): Full Wet vastly outperforms compromised slick (${wetSoftGrip.toFixed(2)})`);

// Scenario D: Intermediate tyre overheating & shredding on dry track
const dryInterSim = new TyreModel('intermediate');
dryInterSim.temp = 70;
// Simulate driving 1000m on dry track at 60 m/s
for (let t = 0; t < 15; t += 0.5) {
  dryInterSim.update(0.5, 60, 15, 5, 0.0, 35, 0.75);
}
assert(dryInterSim.temp > dryInterSim.spec.optTempMax,
  `Inters on dry track overheat rapidly (Temp: ${dryInterSim.temp.toFixed(1)}°C > max ${dryInterSim.spec.optTempMax}°C)`);
assert(dryInterSim.wear > 0.015,
  `Inters on dry track suffer severe thermal shredding (Wear: ${(dryInterSim.wear * 100).toFixed(1)}%)`);

// ── TEST GROUP 4: Progressive Wear, Cliff, Puncture & Limp Mode ──
console.log('\n--- TEST GROUP 4: Progressive Wear, Cliff, Puncture & Limp Mode ---');
const testTyre = new TyreModel('medium');
testTyre.distanceM = 500; // past initial scrub-in
testTyre.temp = 104;

// At 20% wear: minimal grip loss
testTyre.wear = 0.20;
const grip20 = testTyre.getGrip(0).totalGrip;
assert(grip20 > 0.90, `20% wear retains solid grip (${grip20.toFixed(2)})`);

// At 70% wear: past the cliff
testTyre.wear = 0.70;
const grip70 = testTyre.getGrip(0).totalGrip;
assert(grip70 < 0.85, `70% wear enters degradation cliff (${grip70.toFixed(2)})`);
assert(testTyre.getGrip(0).condition === 'CLIFF', `Condition shows CLIFF at 70% wear`);

// At 93% wear: puncture triggers
testTyre.wear = 0.93;
testTyre.update(0.1, 50, 5, 2, 0, 30, 0.75);
assert(testTyre.punctured === true, `Tyre punctures when wear exceeds 92% (punctured: ${testTyre.punctured})`);
const punctureGrip = testTyre.getGrip(0).totalGrip;
assert(punctureGrip <= 0.25, `Punctured tyre grip collapses to limp level (${punctureGrip.toFixed(2)})`);
assert(testTyre.getGrip(0).condition === 'PUNCTURED', `Condition reports PUNCTURED`);

// ── TEST GROUP 5: Wheel Lockup Flat-Spotting ──
console.log('\n--- TEST GROUP 5: Wheel Lockup Flat-Spotting ---');
const lockupTyre = new TyreModel('hard');
lockupTyre.distanceM = 500; // past initial scrub-in
lockupTyre.temp = 105;
const preFlatGrip = lockupTyre.getGrip(0).totalGrip;
// Simulate harsh lockup: longitudinal decel = -45 m/s²
lockupTyre.update(1.0, 45, 0, -45, 0, 30, 0.75);
assert(lockupTyre.flatSpot > 0, `Lockup induces flat-spotting (flatSpot: ${lockupTyre.flatSpot.toFixed(3)})`);
const postFlatGrip = lockupTyre.getGrip(0).totalGrip;
assert(postFlatGrip < preFlatGrip, `Flat spot reduces usable tyre grip (${postFlatGrip.toFixed(2)} < ${preFlatGrip.toFixed(2)})`);

// ── TEST GROUP 6: Out-of-Pit Scrub-In Warm-Up ──
console.log('\n--- TEST GROUP 6: Out-of-Pit Scrub-In Warm-Up ---');
const freshTyre = new TyreModel('soft');
assert(freshTyre.temp === freshTyre.spec.blanketTemp, `Fresh tyre starts at blanket temp (${freshTyre.temp}°C)`);
assert(freshTyre.getGrip(0).condition === 'WARMING UP', `Fresh tyre starts in WARMING UP condition`);

// Advance 400m
freshTyre.update(6.0, 70, 10, 5, 0, 30, 0.75);
assert(freshTyre.distanceM >= 350, `Tyre passes scrub-in distance (${freshTyre.distanceM.toFixed(1)}m)`);
assert(freshTyre.getGrip(0).condition !== 'WARMING UP', `Tyre completes scrub-in phase`);

// ── TEST GROUP 7: FIA Mandatory Two-Compound Rule (Dry vs Wet) ──
console.log('\n--- TEST GROUP 7: FIA Mandatory Two-Compound Rule ---');
const mockCar = {
  code: 'NOR',
  lap: 10,
  v: 60,
  d: 1000,
  driver: { personality: { aggression: 0.5, consistency: 0.8 } },
  tyreModel: new TyreModel('medium'),
  compoundsUsed: new Set(['medium'])
};

// Scenario A: Dry race, only Medium used so far -> Strategy must mandate Soft or Hard
const dryEval = StrategyAI.evaluate(mockCar, 30, 0.0, { rainIntensity: 0 }, 22, [mockCar], 'green');
assert(dryEval.twoDrySatisfied === false, 'Two dry compounds rule NOT yet satisfied with only Medium used');
assert(dryEval.recommendedCompound === 'hard' || dryEval.recommendedCompound === 'soft',
  `Strategy chooses distinct dry compound to comply with FIA rules: ${dryEval.recommendedCompound.toUpperCase()}`);

// Scenario B: After second distinct dry compound fitted
mockCar.compoundsUsed.add(dryEval.recommendedCompound);
const dryEval2 = StrategyAI.evaluate(mockCar, 30, 0.0, { rainIntensity: 0 }, 22, [mockCar], 'green');
assert(dryEval2.twoDrySatisfied === true, 'Two dry compounds rule SATISFIED after fitting second dry compound');

// Scenario C: Wet race -> mandatory 2-dry rule waived
const mockWetCar = {
  code: 'VER',
  lap: 8,
  v: 50,
  d: 800,
  driver: { personality: { aggression: 0.7, consistency: 0.7 } },
  tyreModel: new TyreModel('intermediate'),
  compoundsUsed: new Set(['intermediate'])
};
const wetEval = StrategyAI.evaluate(mockWetCar, 30, 0.35, { rainIntensity: 0.40 }, 22, [mockWetCar], 'green');
assert(wetEval.twoDrySatisfied === true, 'FIA rule: Two dry compound requirement WAIVED in wet conditions');

// ── TEST GROUP 8: Safety Car Opportunistic Cheap Pit Stop ──
console.log('\n--- TEST GROUP 8: Safety Car Opportunistic Cheap Pit Stop ---');
const scCar = {
  code: 'HAM',
  lap: 12,
  v: 30,
  d: 500,
  driver: { personality: { aggression: 0.6, consistency: 0.8 } },
  tyreModel: new TyreModel('medium'),
  compoundsUsed: new Set(['medium'])
};
scCar.tyreModel.wear = 0.42; // Moderate wear, normally stays out under green

// Green flag: stays out
const greenEval = StrategyAI.evaluate(scCar, 30, 0.0, { rainIntensity: 0 }, 22, [scCar], 'green');
assert(greenEval.shouldPit === false, 'Green flag: 42% wear is manageable, stays out');

// Safety Car deployed: takes cheap pit stop
const scEval = StrategyAI.evaluate(scCar, 30, 0.0, { rainIntensity: 0 }, 22, [scCar], 'safety_car');
assert(scEval.shouldPit === true, 'Safety Car flag: triggers opportunistic cheap pit stop');
assert(scEval.cheapPitWindow === true, 'Strategy flags cheap pit window active');
assert(scEval.reason.includes('SAFETY_CAR'), 'Pit reason references Safety Car delta saving');

// ── TEST GROUP 9: User-Directed Pit Stop with All 5 Compounds ──
console.log('\n--- TEST GROUP 9: User-Directed Pit Stop with All 5 Compounds ---');
const circuit = getCircuit('monaco');
const rawPts  = RAW_WAYPOINTS.monaco;
const track   = buildTrack(circuit, rawPts);
const grid    = getGrid(4);
const engine  = new RaceEngine();
engine.build(track, grid, 15);
engine.setSelectedCar(0);

// Request pit stop with Intermediate tyres
const pitRes = engine.requestPit(0, 'intermediate');
assert(pitRes.success === true, `User requested pit stop for INTERMEDIATE: ${pitRes.message}`);
const car0 = engine.cars[0];
assert(car0.targetCompound === 'intermediate', `Car target compound updated to INTERMEDIATE`);

// Fast forward car into pit lane service
car0.d = track.circuit.lengthM - 10;
car0.pitState = PitStates.SERVICING;
car0.pitServiceTimer = 0.01;

const newEvents = [];
PitStopManager.update(car0, track, 0.05, 15.0, newEvents);

assert(car0.tyreModel.compound === 'intermediate', `Car fitted with INTERMEDIATE tyres after service`);
assert(car0.tyreModel.spec.code === 'I', `Fitted tyre has code 'I'`);
assert(car0.tyreModel.spec.colour === '#39b54a', `Fitted tyre has FIA green colour (#39b54a)`);
assert(car0.compoundsUsed.has('intermediate'), `Car compoundsUsed includes 'intermediate'`);

// Test telemetry output
const tel = engine.getTelemetry(0);
assert(tel.tyre === 'I', `Telemetry reflects tyre 'I'`);
assert(tel.tyreCompound === 'intermediate', `Telemetry compound is 'intermediate'`);
assert(tel.tyreColour === '#39b54a', `Telemetry colour is '#39b54a'`);
assert(tel.tyreCondition !== undefined, `Telemetry includes tyre condition: ${tel.tyreCondition}`);

// ── SUMMARY ──
console.log('\n════════════════════════════════════════════════════════════');
if (failed === 0) {
  console.log(`🏁 ALL ${passed} TYRE & STRATEGY TESTS PASSED (100%) 🏁`);
} else {
  console.error(`💥 ${failed} TESTS FAILED out of ${passed + failed}`);
  process.exit(1);
}
console.log('════════════════════════════════════════════════════════════\n');
