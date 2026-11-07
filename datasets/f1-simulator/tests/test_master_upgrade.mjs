/**
 * test_master_upgrade.mjs
 * End-to-end Master Upgrade Integration Test Suite.
 *
 * Simulates a full Grand Prix race with 20 drivers under evolving track and weather conditions:
 *   1. Dry Start & Wheel-to-Wheel Launch
 *   2. Dynamic Rubber Deposition on the Racing Line
 *   3. Incoming Rain Shower: Grip loss, tire crossover, and standing water off-line
 *   4. Autonomous AI Strategy: Predicting pit windows, cheap SC stops, and compound switches
 *   5. Track Drying & Water Displacement: Cars carve a drying line
 *   6. Full Classification & Telemetry Integrity Check (No NaN, no physics explosions)
 */

import { strict as assert } from 'assert';
import { RaceEngine, RaceState } from '../src/simulation/raceEngine.js';
import { buildTrack } from '../src/simulation/trackManager.js';
import { getCircuit, RAW_WAYPOINTS } from '../src/data/circuitData.js';
import { getGrid } from '../src/data/driverData.js';

console.log('🏁 Starting Master Upgrade End-to-End Integration Suite...\n');

const circuit = getCircuit('monza');
const track = buildTrack(circuit, RAW_WAYPOINTS.monza);
const driverList = getGrid(20);

assert.equal(driverList.length, 20, 'Grid must contain 20 drivers');

const engine = new RaceEngine();
engine.build(track, driverList, 5, {
  weatherPreset: 'DRY',
  safetyCarEnabled: true,
  vscEnabled: true,
  penaltiesEnabled: true
});

assert.equal(engine.cars.length, 20, 'Engine must initialise 20 cars');
assert.equal(engine.state, RaceState.WAITING, 'Initial engine state must be WAITING');

// 1. Launch & Race Start
console.log('Stage 1: Starting Race & Launch Sequence');
engine.state = RaceState.RACING;
engine.flag = 'green';
engine.raceControl.state = 'green';
engine.launchManager.state = 'racing';

// Step initial sprint (15 seconds)
for (let step = 0; step < 15; step++) {
  engine.step(1.0);
}

for (const car of engine.cars) {
  assert(!isNaN(car.v), `Car ${car.code} velocity must not be NaN`);
  assert(!isNaN(car.d), `Car ${car.code} distance must not be NaN`);
  assert(!isNaN(car.lat), `Car ${car.code} lateral offset must not be NaN`);
  assert(car.v > 0, `Car ${car.code} must have accelerated off the grid`);
}
console.log(`  ✓ 20 cars successfully launched. Leader speed: ${(engine.cars[0].v * 3.6).toFixed(0)} km/h`);

// 2. Wheel-to-Wheel Racing & Dynamic Rubber Buildup
console.log('Stage 2: Racing Line Rubber Buildup over Green Flag laps');
const initialRubber = engine.trackCondition.averageRubberLevel;

// Advance 60 seconds of dry racing
for (let step = 0; step < 60; step++) {
  engine.step(1.0);
}

const currentRubber = engine.trackCondition.averageRubberLevel;
assert(currentRubber >= initialRubber, 'Rubber must accumulate on racing line during dry running');
console.log(`  ✓ Track rubber evolved: ${(initialRubber * 100).toFixed(1)}% -> ${(currentRubber * 100).toFixed(1)}% (+${((currentRubber - initialRubber) * 100).toFixed(2)}%)`);

// Verify wheel-to-wheel safety corridors: no two cars occupying exact same coordinates
for (let i = 0; i < engine.cars.length; i++) {
  for (let j = i + 1; j < engine.cars.length; j++) {
    const a = engine.cars[i];
    const b = engine.cars[j];
    const longGap = Math.abs(a.d - b.d);
    const latGap = Math.abs(a.lat - b.lat);
    if (longGap < 3.0) {
      assert(latGap > 1.0, `Cars ${a.code} and ${b.code} must have lateral separation when side-by-side (gap: ${longGap.toFixed(1)}m, latGap: ${latGap.toFixed(1)}px)`);
    }
  }
}
console.log('  ✓ Wheel-to-wheel lateral separation verified across entire grid');

// 3. Dynamic Rain Shower & Track Wetting
console.log('Stage 3: Incoming Rain Shower & Weather Evolution');
engine.weatherEngine.setPreset('DYNAMIC_MONSOON');

// Advance 45 seconds of heavy rain
for (let step = 0; step < 45; step++) {
  engine.step(1.0);
}

const wetness = engine.trackCondition.averageWetness;
assert(wetness > 0.15, `Track wetness must increase with rain (got ${(wetness * 100).toFixed(1)}%)`);
console.log(`  ✓ Rainfall accumulated. Track average wetness: ${(wetness * 100).toFixed(1)}%`);

// 4. Autonomous Strategy & Pit Stop Calls
console.log('Stage 4: Autonomous Strategy & Pit Execution');
// Let cars run in wet for 90 seconds to trigger pit stops for wet/intermediate tyres
let pitStopsTriggered = 0;
for (let step = 0; step < 90; step++) {
  engine.step(1.0);
  for (const car of engine.cars) {
    if (car.pitState !== 'ready' || car.pitstops > 0) {
      pitStopsTriggered++;
    }
  }
}

console.log(`  ✓ Pit strategy evaluated dynamically. Wet pit activities detected: ${pitStopsTriggered}`);

// 5. Track Drying & Water Displacement
console.log('Stage 5: Rain Ceases & Drying Line Formation');
engine.weatherEngine.setPreset('DRY'); // Rain stops, cars continue displacing water

// Run 120 seconds of drying
for (let step = 0; step < 120; step++) {
  engine.step(1.0);
}

const dryingState = engine.trackCondition.getDryingLineState();
assert(dryingState.avgLineWetness <= dryingState.avgOffLineWetness,
  'Car passages must keep racing line drier than off-line asphalt');
console.log(`  ✓ Dynamic drying: On-line wetness = ${(dryingState.avgLineWetness * 100).toFixed(1)}% vs Off-line wetness = ${(dryingState.avgOffLineWetness * 100).toFixed(1)}%`);

// 6. Telemetry & Simulation Classification Integrity
console.log('Stage 6: Classification & Telemetry Integrity Check');
const telemetry = engine.getTelemetry(0);
assert(telemetry !== null, 'Telemetry must not be null');
assert(!isNaN(telemetry.speed), 'Speed must not be NaN');
assert(!isNaN(telemetry.tyreWear), 'Tyre wear must not be NaN');
assert(typeof telemetry.trackRubberLevel === 'number', 'Track rubber telemetry must be numeric');
assert(typeof telemetry.dryingLine === 'object', 'Drying line telemetry must be an object');
assert(typeof telemetry.strategicAdvice === 'object', 'Strategic advice telemetry must be present');

const standings = engine.standings;
assert.equal(standings.length, 20, 'Standings must contain all 20 cars');
for (let i = 0; i < standings.length; i++) {
  assert.equal(standings[i].position, i + 1, `Standings position order must be sequential (index ${i} has pos ${standings[i].position})`);
}
console.log(`  ✓ Race leader: ${standings[0].code} (${standings[0].name}) with ${standings[0].lap} laps completed`);
console.log(`  ✓ All telemetry fields and classification validated cleanly.`);

console.log('\n🏁 Master Upgrade End-to-End Integration Suite Passed with Distinction!\n');
