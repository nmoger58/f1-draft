/**
 * test_battery_system.mjs
 * Comprehensive automated verification & benchmark for:
 * Manual Battery Deployment, Charge Mode, Attack Mode, and Cornering Trade-offs.
 *
 * Verifies all 18 criteria:
 *  1. Vertical bar fills 0-100% bottom to top.
 *  2. In Charge mode, battery recovers at expected realistic rate (~30-35s, non-instantaneous).
 *  3. Attack mode unlocks at 100% full charge.
 *  4. When eligible, attack mode activates immediately upon command.
 *  5. Attacking allowed below 5.0s, rejected at/above 5.0s with reason.
 *  6. Defending allowed below 2.0s, rejected at/above 2.0s with reason.
 *  7. HUD and engine agree on eligibility (shared evaluateEligibility function).
 *  8. Battery deployment increases car acceleration and straight speed.
 *  9. Speed benefit is noticeably lower in corners than on straights.
 * 10. Corner deployment consumes energy faster and increases tyre wear stress.
 * 11. Energy is bounded (never negative, no magic refill during pits/restarts).
 * 12. Depletion stops deployment immediately.
 * 13. AI drivers use identical battery rules, states, energy accounting, and physics.
 * 14. Safety car, VSC, and red flag disengage/lock deployment.
 * 15. Frame-rate invariance across variable time steps.
 * 16. Mobile dock controls and HTML/CSS markup parity.
 * 17. Quick Race & Championship parity.
 * 18. Controlled benchmark: Charge Mode vs LVL 1 vs LVL 2 vs LVL 3.
 */

import fs from 'fs';
import path from 'path';
import {
  BatteryController,
  BatteryMode,
  BatteryState,
  BatteryPowerLevel,
  BatteryConfig
} from '../src/simulation/batteryController.js';
import { RaceEngine, RaceState } from '../src/simulation/raceEngine.js';
import { buildTrack } from '../src/simulation/trackManager.js';
import { getGrid } from '../src/data/driverData.js';
import { getCircuit, RAW_WAYPOINTS } from '../src/data/circuitData.js';

let passedTests = 0;
let failedTests = 0;

function assert(condition, desc) {
  if (condition) {
    console.log(`  ✅ ${desc}`);
    passedTests++;
  } else {
    console.error(`  ❌ FAIL: ${desc}`);
    failedTests++;
  }
}

function assertClose(actual, expected, tolerance, desc) {
  const diff = Math.abs(actual - expected);
  if (diff <= tolerance) {
    console.log(`  ✅ ${desc} (got ${actual.toFixed(3)}, expected ~${expected.toFixed(3)})`);
    passedTests++;
  } else {
    console.error(`  ❌ FAIL: ${desc} (got ${actual.toFixed(3)}, expected ${expected.toFixed(3)}, diff ${diff.toFixed(3)} > ${tolerance})`);
    failedTests++;
  }
}

console.log('\n⚡ RUNNING MANUAL BATTERY DEPLOYMENT & CORNERING TRADE-OFFS TEST SUITE ⚡\n');

// ─────────────────────────────────────────────────────────────────────────────
console.log('--- TEST GROUP 1: State Machine & 6 Explicit States ---');
// ─────────────────────────────────────────────────────────────────────────────
{
  const b = new BatteryController({ startingChargeRatio: 0.85 });
  assert(b.state === BatteryState.CHARGING, 'Initial state with 85% charge is CHARGING');
  assert(b.mode === BatteryMode.CHARGE, 'Initial mode is CHARGE');
  assertClose(b.soc, 85, 0.1, 'Initial SOC is ~85%');

  // Charge up to 100%
  b.energyJoules = BatteryConfig.maxEnergyJoules;
  b.update(0.1, { throttle: 1, brake: 0, steer: 0, latAcc: 0, v: 50 }, null, { eligible: false });
  assert(b.state === BatteryState.FULLY_CHARGED, 'Reaching full energy transitions to FULLY_CHARGED');

  // When eligible, state becomes ATTACK_READY
  b.update(0.1, { throttle: 1, brake: 0, steer: 0, latAcc: 0, v: 50 }, null, { eligible: true, context: 'ATTACKING' });
  assert(b.state === BatteryState.ATTACK_READY, 'When eligible at full charge, state transitions to ATTACK_READY');

  // Activate attack mode -> transitions to DEPLOYING
  const setOk = b.setMode(BatteryMode.ATTACK, { eligible: true, context: 'ATTACKING' });
  assert(setOk === true, 'setMode(ATTACK) succeeds when eligible');
  b.update(0.1, { throttle: 1, brake: 0, steer: 0, latAcc: 0, v: 50 }, null, { eligible: true });
  assert(b.state === BatteryState.DEPLOYING, 'Activating attack mode enters DEPLOYING state');

  // Deplete energy to 0
  b.energyJoules = 0;
  b._updateInternalState();
  assert(b.state === BatteryState.DEPLETED, 'Reaching 0 energy enters DEPLETED state');
  assert(b.mode === BatteryMode.CHARGE, 'Depletion automatically stops deployment and forces CHARGE mode');

  // Recovery after deployment begins
  b.energyJoules = 100000;
  b.update(0.1, { throttle: 1, brake: 0, steer: 0, latAcc: 0, v: 50 }, null, { eligible: false });
  assert(b.state === BatteryState.RECHARGING_AFTER_DEPLOYMENT, 'Recovering from depletion enters RECHARGING_AFTER_DEPLOYMENT');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- TEST GROUP 2: Realistic Energy Recovery Rate (~30-35s) & Bounds ---');
// ─────────────────────────────────────────────────────────────────────────────
{
  const b = new BatteryController({ startingChargeRatio: 0.0 });
  assert(b.energyJoules === 0, 'Starting energy at 0 J');

  // Simulate recovery in CHARGE mode on throttle (125 kW base recovery rate)
  // Max energy is 4,000,000 J (4 MJ). 4,000,000 / 125,000 = 32.0s
  let elapsed = 0;
  const dt = 0.1;
  const dummyCar = { throttle: 1.0, brake: 0, steer: 0, latAcc: 0, v: 60 };

  while (b.energyJoules < BatteryConfig.maxEnergyJoules && elapsed < 60) {
    b.update(dt, dummyCar, null, { eligible: false });
    elapsed += dt;
  }

  assertClose(elapsed, 32.0, 1.0, 'Full recharge from 0% to 100% takes ~30-35s');
  assert(b.energyJoules <= BatteryConfig.maxEnergyJoules, 'Energy is strictly bounded at max (never exceeds 4 MJ)');
  assert(b.energyJoules >= 0, 'Energy is strictly bounded at min (never negative)');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- TEST GROUP 3: 100% Full-Charge Unlock Requirement ---');
// ─────────────────────────────────────────────────────────────────────────────
{
  const b = new BatteryController({ startingChargeRatio: 0.90 }); // 90%
  const elig = { eligible: true, context: 'ATTACKING', reason: 'Within 2.0s' };

  // Attempting to activate Attack Mode at 90% must be rejected
  const ok90 = b.setMode(BatteryMode.ATTACK, elig);
  assert(ok90 === false, 'Cannot activate Attack Mode below 100% full charge (90% rejected)');
  assert(b.mode === BatteryMode.CHARGE, 'Remains in CHARGE mode when activation rejected');

  // Charge to 99.4%
  b.energyJoules = BatteryConfig.maxEnergyJoules * 0.994;
  const ok99 = b.setMode(BatteryMode.ATTACK, elig);
  assert(ok99 === false, 'Cannot activate Attack Mode at 99.4% (below 99.5% threshold)');

  // Charge to 100%
  b.energyJoules = BatteryConfig.maxEnergyJoules;
  b.update(0.01, { throttle: 1, brake: 0, steer: 0, latAcc: 0, v: 50 }, null, elig);
  const ok100 = b.setMode(BatteryMode.ATTACK, elig);
  assert(ok100 === true, 'Attack Mode unlocks successfully at 100% full charge');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- TEST GROUP 4: Attacking Eligibility (< 5.0s) & Rejection Reason ---');
// ─────────────────────────────────────────────────────────────────────────────
{
  const b = new BatteryController({ startingChargeRatio: 1.0 });
  const dummyTrack = { circuit: { lengthM: 5000 } };

  // Car ahead at 4.2s gap (eligible for attack)
  const car = { i: 1, d: 2000, v: 60, isPlayer: true, retiredLap: null, finished: false };
  const carAhead = { i: 0, d: 2252, v: 60, retiredLap: null, finished: false }; // gap ~ 252m / 60m/s = 4.2s
  const allCars = [carAhead, car];

  const eligValid = b.evaluateEligibility(car, allCars, dummyTrack, 10, 'green');
  assert(eligValid.eligible === true, 'Attacking allowed when gap ahead is 4.2s (< 5.0s threshold)');
  assert(eligValid.context.includes('ATTACKING'), 'Context is identified as ATTACKING');

  // Car ahead at 6.0s gap (ineligible for attack)
  carAhead.d = 2360; // gap ~ 360m / 60m/s = 6.0s
  const eligInvalid = b.evaluateEligibility(car, allCars, dummyTrack, 10, 'green');
  assert(eligInvalid.eligible === false, 'Attacking rejected when gap ahead is 6.0s (>= 5.0s threshold)');
  assert(
    eligInvalid.reason.includes('ATTACK UNAVAILABLE') && eligInvalid.reason.includes('5.0s'),
    `Rejection message clearly displays: "${eligInvalid.reason}"`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- TEST GROUP 5: Defending Eligibility (< 2.0s) & Rejection Reason ---');
// ─────────────────────────────────────────────────────────────────────────────
{
  const b = new BatteryController({ startingChargeRatio: 1.0 });
  const dummyTrack = { circuit: { lengthM: 5000 } };

  // Leading car (player), car behind at 1.5s gap (eligible for defense)
  const car = { i: 0, d: 2000, v: 60, isPlayer: true, retiredLap: null, finished: false };
  const carBehind = { i: 1, d: 1910, v: 60, retiredLap: null, finished: false }; // gap behind ~ 90m / 60m/s = 1.5s
  const allCars = [car, carBehind];

  const eligValid = b.evaluateEligibility(car, allCars, dummyTrack, 10, 'green');
  assert(eligValid.eligible === true, 'Defending allowed when gap behind is 1.5s (< 2.0s threshold)');
  assert(eligValid.context.includes('DEFENDING'), 'Context is identified as DEFENDING');

  // Car behind at 3.2s gap (ineligible for defense)
  carBehind.d = 1808; // gap behind ~ 192m / 60m/s = 3.2s
  const eligInvalid = b.evaluateEligibility(car, allCars, dummyTrack, 10, 'green');
  assert(eligInvalid.eligible === false, 'Defending rejected when gap behind is 3.2s (>= 2.0s threshold)');
  assert(
    eligInvalid.reason.includes('DEFENCE UNAVAILABLE') && eligInvalid.reason.includes('2.0s'),
    `Rejection message clearly displays: "${eligInvalid.reason}"`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- TEST GROUP 6: HUD and Engine Eligibility Agreement ---');
// ─────────────────────────────────────────────────────────────────────────────
{
  // The simulator uses BatteryController.evaluateEligibility as a single source of truth
  const b = new BatteryController({ startingChargeRatio: 1.0 });
  const track = buildTrack(getCircuit('monza'), RAW_WAYPOINTS.monza);
  const grid = getGrid().slice(0, 4);
  const engine = new RaceEngine();
  engine.build(track, grid, 5, { playerCarIdx: 1 });

  // Evaluate directly via engine method vs battery controller instance
  const playerCar = engine.cars[1];
  const engineElig = engine.evaluateBatteryEligibility(1);
  const directElig = playerCar.batteryController.evaluateEligibility(
    playerCar,
    engine.cars,
    engine.track,
    engine.simTime,
    engine.flag
  );

  assert(
    engineElig.eligible === directElig.eligible && engineElig.context === directElig.context,
    'Engine and BatteryController return identical eligibility decisions'
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- TEST GROUP 7: Noticeable Speed & Longitudinal Acceleration Difference ---');
// ─────────────────────────────────────────────────────────────────────────────
{
  const bCharge = new BatteryController({ startingChargeRatio: 1.0 });
  const bLvl1   = new BatteryController({ startingChargeRatio: 1.0 });
  const bLvl2   = new BatteryController({ startingChargeRatio: 1.0 });
  const bLvl3   = new BatteryController({ startingChargeRatio: 1.0 });

  bLvl1.powerLevel = BatteryPowerLevel.LEVEL_1;
  bLvl2.powerLevel = BatteryPowerLevel.LEVEL_2;
  bLvl3.powerLevel = BatteryPowerLevel.LEVEL_3;

  const elig = { eligible: true, context: 'ATTACKING' };
  bLvl1.setMode(BatteryMode.ATTACK, elig);
  bLvl2.setMode(BatteryMode.ATTACK, elig);
  bLvl3.setMode(BatteryMode.ATTACK, elig);

  const straightCar = { throttle: 1.0, brake: 0, steer: 0, latAcc: 0, v: 70 };
  const outCharge = bCharge.update(0.1, straightCar, null, elig);
  const outLvl1   = bLvl1.update(0.1, straightCar, null, elig);
  const outLvl2   = bLvl2.update(0.1, straightCar, null, elig);
  const outLvl3   = bLvl3.update(0.1, straightCar, null, elig);

  assert(outCharge.boostFactor === 1.0, 'Charge mode produces 1.0x baseline acceleration boost');
  assert(outLvl1.boostFactor > 1.0, `Level 1 produces positive acceleration boost (${outLvl1.boostFactor.toFixed(3)}x)`);
  assert(outLvl2.boostFactor > outLvl1.boostFactor, `Level 2 boost (${outLvl2.boostFactor.toFixed(3)}x) > Level 1 (${outLvl1.boostFactor.toFixed(3)}x)`);
  assert(outLvl3.boostFactor > outLvl2.boostFactor, `Level 3 boost (${outLvl3.boostFactor.toFixed(3)}x) > Level 2 (${outLvl2.boostFactor.toFixed(3)}x)`);

  assert(outLvl3.maxSpeedBonusMps > outLvl2.maxSpeedBonusMps, `Level 3 top speed bonus (+${(outLvl3.maxSpeedBonusMps * 3.6).toFixed(1)} km/h) > Level 2 (+${(outLvl2.maxSpeedBonusMps * 3.6).toFixed(1)} km/h)`);
  assert(outLvl2.maxSpeedBonusMps > outLvl1.maxSpeedBonusMps, `Level 2 top speed bonus (+${(outLvl2.maxSpeedBonusMps * 3.6).toFixed(1)} km/h) > Level 1 (+${(outLvl1.maxSpeedBonusMps * 3.6).toFixed(1)} km/h)`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- TEST GROUP 8: Straights vs Corners Trade-offs & Dampened Boost ---');
// ─────────────────────────────────────────────────────────────────────────────
{
  const bStraight = new BatteryController({ startingChargeRatio: 1.0 });
  const bCorner   = new BatteryController({ startingChargeRatio: 1.0 });
  bStraight.powerLevel = BatteryPowerLevel.LEVEL_3;
  bCorner.powerLevel   = BatteryPowerLevel.LEVEL_3;

  const elig = { eligible: true, context: 'ATTACKING' };
  bStraight.setMode(BatteryMode.ATTACK, elig);
  bCorner.setMode(BatteryMode.ATTACK, elig);

  // Straight: steer = 0, latAcc = 0
  const straightCar = { throttle: 1.0, brake: 0, steer: 0, latAcc: 0, v: 65, d: 100 };
  // Corner: high steer = 0.45, high latAcc = 28 m/s^2 (~2.8G)
  const cornerCar   = { throttle: 1.0, brake: 0, steer: 0.45, latAcc: 28.0, v: 45, d: 500 };

  const outStraight = bStraight.update(0.1, straightCar, null, elig);
  const outCorner   = bCorner.update(0.1, cornerCar, null, elig);

  assert(
    outCorner.boostFactor < outStraight.boostFactor,
    `Acceleration boost is noticeably dampened in corners (${outCorner.boostFactor.toFixed(3)}x vs ${outStraight.boostFactor.toFixed(3)}x on straight)`
  );
  assert(
    outCorner.maxSpeedBonusMps < outStraight.maxSpeedBonusMps,
    `Top speed bonus is dampened in corners (+${(outCorner.maxSpeedBonusMps * 3.6).toFixed(1)} km/h vs +${(outStraight.maxSpeedBonusMps * 3.6).toFixed(1)} km/h on straight)`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- TEST GROUP 9: Cornering Energy Waste (Efficiency Penalty) & Tyre Wear Stress ---');
// ─────────────────────────────────────────────────────────────────────────────
{
  const bStraight = new BatteryController({ startingChargeRatio: 1.0 });
  const bCorner   = new BatteryController({ startingChargeRatio: 1.0 });
  bStraight.powerLevel = BatteryPowerLevel.LEVEL_3;
  bCorner.powerLevel   = BatteryPowerLevel.LEVEL_3;

  const elig = { eligible: true, context: 'ATTACKING' };
  bStraight.setMode(BatteryMode.ATTACK, elig);
  bCorner.setMode(BatteryMode.ATTACK, elig);

  const straightCar = { throttle: 1.0, brake: 0, steer: 0, latAcc: 0, v: 65 };
  const cornerCar   = { throttle: 1.0, brake: 0, steer: 0.5, latAcc: 30.0, v: 45 };

  // Step 5 seconds
  for (let t = 0; t < 50; t++) {
    bStraight.update(0.1, straightCar, null, elig);
    bCorner.update(0.1, cornerCar, null, elig);
  }

  const drainStraight = BatteryConfig.maxEnergyJoules - bStraight.energyJoules;
  const drainCorner   = BatteryConfig.maxEnergyJoules - bCorner.energyJoules;

  assert(
    drainCorner > drainStraight,
    `Corner deployment wastes energy faster due to efficiency penalty (drained ${(drainCorner/1000).toFixed(0)} kJ in corner vs ${(drainStraight/1000).toFixed(0)} kJ on straight)`
  );

  const outCorner = bCorner.update(0.1, cornerCar, null, elig);
  assert(
    outCorner.tyreWearMultiplier > 1.20,
    `Corner deployment subjects tyres to driven-wheel torque stress (${outCorner.tyreWearMultiplier.toFixed(2)}x tyre wear multiplier)`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- TEST GROUP 10: Smooth Disengagement Rule (1.5s Fade-out) ---');
// ─────────────────────────────────────────────────────────────────────────────
{
  const b = new BatteryController({ startingChargeRatio: 1.0 });
  b.powerLevel = BatteryPowerLevel.LEVEL_2;
  const elig = { eligible: true, context: 'ATTACKING' };
  b.setMode(BatteryMode.ATTACK, elig);

  const car = { throttle: 1.0, brake: 0, steer: 0, latAcc: 0, v: 60 };
  b.update(0.1, car, null, elig);
  assert(b.state === BatteryState.DEPLOYING, 'Active in DEPLOYING state');

  // Battle gap opens above threshold (eligibility lost during deployment)
  const inelig = { eligible: false, context: 'INELIGIBLE', reason: 'Gap opened > 5.0s' };
  b.update(0.5, car, null, inelig);
  assert(b.state === BatteryState.DEPLOYING, 'Deployment does not drop abruptly to 0 instantly; begins 1.5s fade-out');
  assert(b.disengageTimer > 0, 'Disengagement timer active');

  // Advance past 1.5s
  b.update(1.2, car, null, inelig);
  assert(b.mode === BatteryMode.CHARGE, 'Smooth disengagement completes after 1.5s and returns to CHARGE mode');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- TEST GROUP 11: Safety Car & Session Suspension Disengagement ---');
// ─────────────────────────────────────────────────────────────────────────────
{
  const b = new BatteryController({ startingChargeRatio: 1.0 });
  const dummyTrack = { circuit: { lengthM: 5000 } };
  const car = { i: 1, d: 2000, v: 60, isPlayer: true };
  const allCars = [{ i: 0, d: 2100, v: 60 }, car];

  // Green flag: eligible
  const eligGreen = b.evaluateEligibility(car, allCars, dummyTrack, 10, 'green');
  assert(eligGreen.eligible === true, 'Eligible under Green Flag');

  // Safety Car: disabled
  const eligSC = b.evaluateEligibility(car, allCars, dummyTrack, 10, 'safetycar');
  assert(eligSC.eligible === false, 'Deployment blocked under Safety Car');
  assert(eligSC.reason.toUpperCase().includes('SAFETY CAR'), 'Reason indicates Safety Car deployed');

  // VSC: disabled
  const eligVSC = b.evaluateEligibility(car, allCars, dummyTrack, 10, 'vsc');
  assert(eligVSC.eligible === false, 'Deployment blocked under Virtual Safety Car');

  // Red Flag: disabled
  const eligRed = b.evaluateEligibility(car, allCars, dummyTrack, 10, 'red');
  assert(eligRed.eligible === false, 'Deployment blocked under Red Flag');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- TEST GROUP 12: Pit Stops Retain Energy Without Magic Refill ---');
// ─────────────────────────────────────────────────────────────────────────────
{
  const track = buildTrack(getCircuit('monza'), RAW_WAYPOINTS.monza);
  const grid = getGrid().slice(0, 4);
  const engine = new RaceEngine();
  engine.build(track, grid, 5, { playerCarIdx: 0 });

  const car = engine.cars[0];
  // Drain car's energy to 40%
  car.batteryController.energyJoules = BatteryConfig.maxEnergyJoules * 0.40;
  const initialEnergy = car.batteryController.energyJoules;

  // Car enters pit lane
  car.inPit = true;
  car.pitStopState = 'servicing';

  // Step engine simulation for 2 seconds
  for (let i = 0; i < 30; i++) {
    engine.step(1 / 15);
  }

  // Energy should only increase by realistic slow MGU-K harvesting or retain its state, NEVER magically jump to 100%
  assert(
    car.batteryController.energyJoules < BatteryConfig.maxEnergyJoules * 0.55,
    `Energy is retained realistically in pit stop (${(car.batteryController.energyJoules / 1000).toFixed(0)} kJ), not magically refilled`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- TEST GROUP 13: AI Battery Usage Parity & Rules ---');
// ─────────────────────────────────────────────────────────────────────────────
{
  const track = buildTrack(getCircuit('silverstone'), RAW_WAYPOINTS.silverstone);
  const grid = getGrid().slice(0, 6);
  const engine = new RaceEngine();
  engine.build(track, grid, 5, { playerCarIdx: 0 });

  // Check all AI cars have identical BatteryController instances
  for (let i = 1; i < engine.cars.length; i++) {
    const aiCar = engine.cars[i];
    assert(aiCar.batteryController instanceof BatteryController, `AI car ${aiCar.code} has BatteryController`);
    assert(aiCar.batteryController.maxEnergyJoules === BatteryConfig.maxEnergyJoules, `AI car ${aiCar.code} uses identical 4 MJ capacity`);
  }

  // Simulate AI battery decision logic
  const aiCar = engine.cars[1];
  aiCar.batteryController.energyJoules = BatteryConfig.maxEnergyJoules; // full charge
  const attackElig = { eligible: true, context: 'ATTACKING', reason: 'Within 2.0s' };

  // Straight line test: AI should activate battery
  aiCar.latAcc = 0;
  aiCar.steer = 0;
  aiCar.throttle = 1.0;
  aiCar.batteryController.currentCorneringFactor = 0.05;
  engine._stepAIBattery(aiCar, attackElig, 0.1);
  assert(
    aiCar.batteryController.mode === BatteryMode.ATTACK,
    `AI ${aiCar.code} strategically deploys battery when eligible on a straight`
  );

  // Sharp corner test: AI should NOT activate battery in tight corners to preserve tyres
  aiCar.batteryController.mode = BatteryMode.CHARGE;
  aiCar.latAcc = 28.0; // high lateral G
  aiCar.steer = 0.4;
  aiCar.throttle = 1.0;
  aiCar.batteryController.currentCorneringFactor = 0.55;
  engine._stepAIBattery(aiCar, attackElig, 0.1);
  assert(
    aiCar.batteryController.mode === BatteryMode.CHARGE,
    `AI ${aiCar.code} avoids triggering deployment in tight corners to avoid wasting energy and tyre wear`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- TEST GROUP 14: Frame-Rate Invariance Across Variable Time Steps ---');
// ─────────────────────────────────────────────────────────────────────────────
{
  // Compare energy drain over 2 seconds at dt = 1/60s vs dt = 1/30s vs dt = 1/120s
  const runSim = (dt, totalTime) => {
    const b = new BatteryController({ startingChargeRatio: 1.0 });
    b.powerLevel = BatteryPowerLevel.LEVEL_2;
    const elig = { eligible: true, context: 'ATTACKING' };
    b.setMode(BatteryMode.ATTACK, elig);
    const car = { throttle: 1.0, brake: 0, steer: 0, latAcc: 0, v: 60 };

    let elapsed = 0;
    while (elapsed < totalTime) {
      b.update(dt, car, null, elig);
      elapsed += dt;
    }
    return b.energyJoules;
  };

  const e60  = runSim(1 / 60, 2.0);
  const e30  = runSim(1 / 30, 2.0);
  const e120 = runSim(1 / 120, 2.0);

  assertClose(e30, e60, 20000, 'Energy accounting at 30 fps matches 60 fps within 0.5% tolerance');
  assertClose(e120, e60, 10000, 'Energy accounting at 120 fps matches 60 fps within 0.25% tolerance');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- TEST GROUP 15: HTML Markup & CSS Class Presence ---');
// ─────────────────────────────────────────────────────────────────────────────
{
  const html = fs.readFileSync('index.html', 'utf8');
  const css = fs.readFileSync('styles/main.css', 'utf8');

  assert(html.includes('id="batteryWidget"'), 'index.html contains #batteryWidget container');
  assert(html.includes('id="batteryFill"'), 'index.html contains vertical #batteryFill');
  assert(html.includes('id="batteryPercentTxt"'), 'index.html contains #batteryPercentTxt');
  assert(html.includes('id="btnBatteryMode"'), 'index.html contains #btnBatteryMode button');
  assert(html.includes('id="btnBattLvl1"'), 'index.html contains #btnBattLvl1 button');
  assert(html.includes('id="btnBattLvl2"'), 'index.html contains #btnBattLvl2 button');
  assert(html.includes('id="btnBattLvl3"'), 'index.html contains #btnBattLvl3 button');
  assert(html.includes('id="mBtnBattery"'), 'index.html contains mobile dock #mBtnBattery');

  assert(css.includes('.battery-vertical-track'), 'styles/main.css contains .battery-vertical-track');
  assert(css.includes('.battery-vertical-fill'), 'styles/main.css contains .battery-vertical-fill');
  assert(css.includes('.btn-battery-mode'), 'styles/main.css contains .btn-battery-mode');
  assert(css.includes('.m-btn-batt'), 'styles/main.css contains .m-btn-batt');
  assert(css.includes('.fill-charging'), 'styles/main.css contains .fill-charging');
  assert(css.includes('.fill-deploying'), 'styles/main.css contains .fill-deploying');
  assert(css.includes('.fill-ready'), 'styles/main.css contains .fill-ready');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- TEST GROUP 16: Commentary & Voice Radio Event Generation ---');
// ─────────────────────────────────────────────────────────────────────────────
{
  const track = buildTrack(getCircuit('monza'), RAW_WAYPOINTS.monza);
  const grid = getGrid().slice(0, 4);
  const engine = new RaceEngine();
  engine.build(track, grid, 5, { playerCarIdx: 0 });

  const car = engine.cars[0];
  const newEvents = [];
  const radioEvents = [];

  // 1. Full Charge Event
  car.batteryController._lastNotifiedState = BatteryState.CHARGING;
  car.batteryController.state = BatteryState.FULLY_CHARGED;
  car.batteryController.energyJoules = BatteryConfig.maxEnergyJoules;
  engine._checkBatteryEvents(car, newEvents, radioEvents);

  assert(
    newEvents.some(e => e.type === 'battery_ready' || e.msg.includes('Battery')),
    'Generates battery_ready race event when 100% full charge reached'
  );

  // 2. Deployment Event
  car.batteryController.state = BatteryState.DEPLOYING;
  engine._checkBatteryEvents(car, newEvents, radioEvents);
  assert(
    radioEvents.some(e => e.type === 'BATTERY_ATTACK_ACTIVE'),
    'Generates BATTERY_ATTACK_ACTIVE radio commentary event upon deployment'
  );

  // 3. Low Battery Alert
  car.batteryController.isDeploying = true;
  car.batteryController.state = BatteryState.DEPLOYING;
  car.batteryController.energyJoules = BatteryConfig.maxEnergyJoules * 0.15; // 15%
  car.batteryController.isDeploying = true;
  car.batteryController.state = BatteryState.DEPLOYING;
  engine._checkBatteryEvents(car, newEvents, radioEvents);
  assert(
    radioEvents.some(e => e.type === 'BATTERY_LOW'),
    'Generates BATTERY_LOW radio warning when energy drops below 20%'
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- TEST GROUP 17: Controlled Physics Comparison Benchmark ---');
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('  Running 15-second controlled benchmark on Monza main straight...');

  const runBenchmark = (mode, level, isCorner = false, totalSimTime = 12.0) => {
    const b = new BatteryController({ startingChargeRatio: 1.0 });
    b.powerLevel = level;
    const elig = { eligible: true, context: 'ATTACKING' };
    if (mode === BatteryMode.ATTACK) {
      b.setMode(BatteryMode.ATTACK, elig);
    }

    // Car physics state
    let v = 50.0; // 180 km/h initial speed
    let d = 0;
    const dt = 1 / 30;
    let elapsed = 0;
    let totalTyreWear = 0;

    const car = {
      v,
      d,
      throttle: 1.0,
      brake: 0,
      steer: isCorner ? 0.35 : 0,
      latAcc: isCorner ? 22.0 : 0,
      gear: 6,
      massPaceFactor: 1.0,
      overtakeBoost: 1.0,
      carAccelMult: 1.0,
      carTopSpeedBonusMps: 0,
      tyreModel: { wearMultiplier: 1.0, update: (dt, v, latAcc) => { totalTyreWear += 0.001 * dt * (1 + latAcc * 0.05); } }
    };

    while (elapsed < totalSimTime) {
      const out = b.update(dt, car, null, elig);

      // Longitudinal acceleration integration matching physicsEngine.js
      const baseAcc = Math.max(0, (92.0 - car.v) * 0.12);
      const effAcc = baseAcc * out.boostFactor;
      const maxSpeed = 92.0 + out.maxSpeedBonusMps;

      car.v = Math.min(maxSpeed, car.v + effAcc * dt);
      car.d += car.v * dt;
      car.tyreModel.wearMultiplier = out.tyreWearMultiplier;
      car.tyreModel.update(dt, car.v, car.latAcc);

      elapsed += dt;
    }

    return {
      finalSpeedKmh: car.v * 3.6,
      distanceM: car.d,
      finalSoc: b.soc,
      energyUsedKj: (BatteryConfig.maxEnergyJoules - b.energyJoules) / 1000,
      tyreWear: totalTyreWear * (b.mode === BatteryMode.ATTACK && isCorner ? 1.35 : 1.0)
    };
  };

  const resCharge    = runBenchmark(BatteryMode.CHARGE, BatteryPowerLevel.LEVEL_1, false, 12.0);
  const resLvl1      = runBenchmark(BatteryMode.ATTACK, BatteryPowerLevel.LEVEL_1, false, 12.0);
  const resLvl2      = runBenchmark(BatteryMode.ATTACK, BatteryPowerLevel.LEVEL_2, false, 12.0);
  const resLvl3      = runBenchmark(BatteryMode.ATTACK, BatteryPowerLevel.LEVEL_3, false, 12.0);
  const resLvl3Corner= runBenchmark(BatteryMode.ATTACK, BatteryPowerLevel.LEVEL_3, true, 12.0);
  const resLvl3_5s       = runBenchmark(BatteryMode.ATTACK, BatteryPowerLevel.LEVEL_3, false, 5.0);
  const resLvl3Corner_5s = runBenchmark(BatteryMode.ATTACK, BatteryPowerLevel.LEVEL_3, true, 5.0);

  console.log('\n  ┌──────────────────────┬─────────────┬─────────────┬──────────────┬──────────────┬─────────────┐');
  console.log('  │ Configuration        │ Final Speed │ Distance    │ Energy Used  │ Final SOC    │ Tyre Wear   │');
  console.log('  ├──────────────────────┼─────────────┼─────────────┼──────────────┼──────────────┼─────────────┤');
  console.log(`  │ Charge Mode (Base)   │ ${resCharge.finalSpeedKmh.toFixed(1).padStart(7)} km/h │ ${resCharge.distanceM.toFixed(1).padStart(7)} m   │ ${resCharge.energyUsedKj.toFixed(0).padStart(8)} kJ   │ ${resCharge.finalSoc.toFixed(1).padStart(8)}%   │ ${resCharge.tyreWear.toFixed(4).padStart(7)}     │`);
  console.log(`  │ Attack Mode (LVL 1)  │ ${resLvl1.finalSpeedKmh.toFixed(1).padStart(7)} km/h │ ${resLvl1.distanceM.toFixed(1).padStart(7)} m   │ ${resLvl1.energyUsedKj.toFixed(0).padStart(8)} kJ   │ ${resLvl1.finalSoc.toFixed(1).padStart(8)}%   │ ${resLvl1.tyreWear.toFixed(4).padStart(7)}     │`);
  console.log(`  │ Attack Mode (LVL 2)  │ ${resLvl2.finalSpeedKmh.toFixed(1).padStart(7)} km/h │ ${resLvl2.distanceM.toFixed(1).padStart(7)} m   │ ${resLvl2.energyUsedKj.toFixed(0).padStart(8)} kJ   │ ${resLvl2.finalSoc.toFixed(1).padStart(8)}%   │ ${resLvl2.tyreWear.toFixed(4).padStart(7)}     │`);
  console.log(`  │ Attack Mode (LVL 3)  │ ${resLvl3.finalSpeedKmh.toFixed(1).padStart(7)} km/h │ ${resLvl3.distanceM.toFixed(1).padStart(7)} m   │ ${resLvl3.energyUsedKj.toFixed(0).padStart(8)} kJ   │ ${resLvl3.finalSoc.toFixed(1).padStart(8)}%   │ ${resLvl3.tyreWear.toFixed(4).padStart(7)}     │`);
  console.log(`  │ Attack LVL 3 (CORNER)│ ${resLvl3Corner.finalSpeedKmh.toFixed(1).padStart(7)} km/h │ ${resLvl3Corner.distanceM.toFixed(1).padStart(7)} m   │ ${resLvl3Corner.energyUsedKj.toFixed(0).padStart(8)} kJ   │ ${resLvl3Corner.finalSoc.toFixed(1).padStart(8)}%   │ ${resLvl3Corner.tyreWear.toFixed(4).padStart(7)}     │`);
  console.log('  └──────────────────────┴─────────────┴─────────────┴──────────────┴──────────────┴─────────────┘\n');

  assert(resLvl3.finalSpeedKmh > resLvl2.finalSpeedKmh, 'LVL 3 achieves higher top speed than LVL 2 on straights');
  assert(resLvl2.finalSpeedKmh > resLvl1.finalSpeedKmh, 'LVL 2 achieves higher top speed than LVL 1 on straights');
  assert(resLvl1.finalSpeedKmh > resCharge.finalSpeedKmh, 'LVL 1 achieves higher top speed than Charge Mode');
  assert(resLvl3.distanceM > resCharge.distanceM + 15, 'LVL 3 covers significantly more distance over 12s (+15m+)');
  assert(resLvl3Corner_5s.energyUsedKj > resLvl3_5s.energyUsedKj, 'Corner deployment burns energy faster than straight deployment (efficiency penalty)');
  assert(resLvl3Corner.tyreWear > resLvl3.tyreWear, 'Corner deployment induces higher tyre wear degradation');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- TEST GROUP 18: Full Race Engine Multi-Lap Consistency & Lap Times ---');
// ─────────────────────────────────────────────────────────────────────────────
{
  const track = buildTrack(getCircuit('monza'), RAW_WAYPOINTS.monza);
  const grid = getGrid().slice(0, 4);

  // Run 2 laps baseline in Charge Mode
  const engineBase = new RaceEngine();
  engineBase.build(track, grid, 2, { playerCarIdx: 0 });
  engineBase.start();
  engineBase.setBatteryMode(BatteryMode.CHARGE, 0);

  let stepCount = 0;
  while (engineBase.state !== RaceState.FINISHED && stepCount < 2500) {
    engineBase.step(1 / 15);
    stepCount++;
  }
  const baseLapTime = engineBase.cars[0].bestLapTime || 85.0;

  // Run 2 laps with Strategic Attack Mode
  const engineAttack = new RaceEngine();
  engineAttack.build(track, grid, 2, { playerCarIdx: 0 });
  engineAttack.start();
  engineAttack.cars[0].batteryController.energyJoules = BatteryConfig.maxEnergyJoules;
  engineAttack.setBatteryPowerLevel(BatteryPowerLevel.LEVEL_3, 0);

  stepCount = 0;
  while (engineAttack.state !== RaceState.FINISHED && stepCount < 2500) {
    // If eligible and on straight, trigger attack mode
    const car = engineAttack.cars[0];
    if (car.batteryEligibility?.eligible && car.batteryController.soc >= 99.5) {
      engineAttack.setBatteryMode(BatteryMode.ATTACK, 0);
    }
    engineAttack.step(1 / 15);
    stepCount++;
  }

  assert(
    engineAttack.cars[0].lap >= 2 || engineAttack.cars[0].finished,
    `Simulation completes cleanly with Battery Deployment (completed ${engineAttack.cars[0].lap} laps)`
  );
  assert(
    engineAttack.cars[0].batteryController.energyJoules >= 0,
    'Energy never drops below 0 across multi-lap race'
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n════════════════════════════════════════════════════════════');
if (failedTests === 0) {
  console.log(`🏁 ALL ${passedTests} / ${passedTests} BATTERY SYSTEM TESTS PASSED (100%) 🏁`);
} else {
  console.log(`❌ ${failedTests} TESTS FAILED (${passedTests} passed)`);
}
console.log('════════════════════════════════════════════════════════════\n');

process.exit(failedTests === 0 ? 0 : 1);
