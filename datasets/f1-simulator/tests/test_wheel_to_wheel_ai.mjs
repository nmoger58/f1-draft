/**
 * test_wheel_to_wheel_ai.mjs
 * Automated test suite for Wheel-to-Wheel Racing AI, Collision Avoidance, and Tactics.
 */

import { strict as assert } from 'assert';
import { WheelToWheelPlanner, OvertakeDecision } from '../src/ai/wheelToWheelPlanner.js';
import { DriverAgent } from '../src/ai/driverAgent.js';
import { BatteryController } from '../src/simulation/batteryController.js';
import { buildTrack } from '../src/simulation/trackManager.js';
import { getCircuit, RAW_WAYPOINTS } from '../src/data/circuitData.js';

console.log('🧪 Starting Wheel-to-Wheel Racing AI Test Suite...\n');

const circuit = getCircuit('monza');
const track = buildTrack(circuit, RAW_WAYPOINTS.monza);
const L = track.circuit.lengthM;

// 1. Dynamic Reference Line & Apex Geometry
{
  console.log('Test 1: Geometric Reference Line & Dynamic Apex Calculation');
  const planner = new WheelToWheelPlanner({ personality: { aggression: 0.7, consistency: 0.8 } });

  const car = { d: 500, lat: 0.0, v: 60 };
  const refLat = planner._computeReferenceRacingLine(car, track, L, track.k, null);
  assert(typeof refLat === 'number', 'Reference line must return a numeric target');
  assert(Math.abs(refLat) <= 6.8 * track.k, 'Reference line must stay within asphalt boundaries');
  console.log(`  ✓ Reference line computed smoothly: ${refLat.toFixed(2)} px`);
}

// 2. Conflict Predictor & Time-To-Collision (TTC)
{
  console.log('Test 2: Multi-car Conflict Predictor & TTC');
  const planner = new WheelToWheelPlanner({ personality: { aggression: 0.7 } });

  const carA = { d: 500, lat: 0.0, v: 70, isSpun: false, finished: false, retiredLap: null };
  const carB = { d: 520, lat: 0.2, v: 50, isSpun: false, finished: false, retiredLap: null }; // 20m ahead, 20 m/s closing delta
  const carC = { d: 480, lat: 0.0, v: 65, isSpun: false, finished: false, retiredLap: null }; // 20m behind

  const conflicts = planner._predictConflicts(carA, [carB, carC], L, track.k, null);
  assert.equal(conflicts.carAhead, carB, 'Car ahead must be Car B');
  assert.equal(conflicts.carBehind, carC, 'Car behind must be Car C');
  assert(Math.abs(conflicts.minGapAheadM - 20) < 1.0, 'Gap ahead must be approx 20m');
  assert(conflicts.collisionRisks.length > 0, 'Collision risk must be detected');
  assert(Math.abs(conflicts.collisionRisks[0].ttc - 1.0) < 0.1, `TTC should be 1.0s, got ${conflicts.collisionRisks[0].ttc}`);
  console.log(`  ✓ Conflict detected with Car B: gap = ${conflicts.minGapAheadM.toFixed(1)}m, TTC = ${conflicts.collisionRisks[0].ttc.toFixed(2)}s`);
}

// 3. 5-State Overtaking Planner Evaluation
{
  console.log('Test 3: 5-State Overtaking Decision FSM');
  const planner = new WheelToWheelPlanner({
    personality: { aggression: 0.85, overtakeAggression: 0.85, consistency: 0.85 }
  });

  const carA = {
    code: 'VER',
    d: 1000, lat: 0.0, v: 72, drsActive: true, isSpun: false, finished: false, retiredLap: null,
    batteryOutput: { isDeploying: true },
    batteryController: new BatteryController()
  };
  const carAhead = {
    code: 'HAM',
    d: 1014, lat: 1.5, v: 60, drsActive: false, isSpun: false, finished: false, retiredLap: null
  };

  const conflicts = planner._predictConflicts(carA, [carAhead], L, track.k, null);
  const otPlan = planner._evaluateOvertaking(carA, conflicts, track, 1.0, 'green', track.k, L);
  
  assert.equal(otPlan.state, OvertakeDecision.VIABLE_OPPORTUNITY, 'Must identify viable overtaking opportunity');
  assert(typeof otPlan.targetLat === 'number', 'Must assign target lateral corridor');
  assert(otPlan.targetLat < carAhead.lat, 'Should attack the open inside corridor');
  console.log(`  ✓ Overtake state evaluated: ${otPlan.state}, passing corridor target = ${otPlan.targetLat.toFixed(2)}`);

  // High Risk Abort (Poor grip and limited room)
  planner.personality.riskTolerance = 0.40;
  const highRiskPlan = planner._evaluateOvertaking(carA, conflicts, track, 0.45, 'green', track.k, L);
  assert.equal(highRiskPlan.state, OvertakeDecision.HIGH_RISK_OPPORTUNITY, 'Must abort and signal HIGH_RISK on low grip');
  assert(highRiskPlan.paceFactor < 1.0, 'Pace must be reduced to back out safely');
  console.log('  ✓ High-risk pass safely aborted due to slippery conditions off-line');
}

// 4. Inside-Line Defense & Anti-Weaving (One-Move Rule)
{
  console.log('Test 4: Inside-Line Defense & Anti-Weaving One-Move Rule');
  const planner = new WheelToWheelPlanner({
    personality: { aggression: 0.7, consistency: 0.85, racecraft: 0.9 }
  });

  const carDefender = {
    code: 'NOR',
    d: 2000, lat: 0.0, v: 65, isSpun: false, finished: false, retiredLap: null
  };
  const carAttacker = {
    code: 'LEC',
    d: 1988, lat: -1.2, v: 70, drsActive: true, isSpun: false, finished: false, retiredLap: null
  };

  const conflicts1 = planner._predictConflicts(carDefender, [carAttacker], L, track.k, null);
  const def1 = planner._evaluateDefending(carDefender, conflicts1, track, track.k, L, 'green');
  assert(def1.isDefending, 'Defender must initiate inside-line defense');
  assert(planner.defendCommitted, 'Defender must commit to one defensive move (FIA rule)');

  const lockedSide = planner.defendSide;

  // Attacker switches side - defender must NOT weave back and forth
  carAttacker.lat = 2.5;
  const conflicts2 = planner._predictConflicts(carDefender, [carAttacker], L, track.k, null);
  const def2 = planner._evaluateDefending(carDefender, conflicts2, track, track.k, L, 'green');
  assert.equal(planner.defendSide, lockedSide, 'Defender must hold locked line and not weave across');
  console.log(`  ✓ One-move anti-weaving verified: defensive line held without weaving at ${def2.targetLat.toFixed(2)}`);
}

// 5. Collision Avoidance Emergency Braking & Lateral Escape Corridors
{
  console.log('Test 5: Collision Avoidance Layer (Spun Vehicle Ahead)');
  const planner = new WheelToWheelPlanner({ personality: { consistency: 0.9 } });

  const carFast = {
    code: 'RUS',
    d: 1500, lat: 0.0, v: 72, isSpun: false, finished: false, retiredLap: null
  };
  const carSpun = {
    code: 'STR',
    d: 1520, lat: 0.0, v: 0, isSpun: true, finished: false, retiredLap: null
  };

  const conflicts = planner._predictConflicts(carFast, [carSpun], L, track.k, null);
  const avoidance = planner._applyCollisionAvoidance(carFast, 0.0, 1.0, conflicts, 1.0, 'green', track.k, L);
  
  assert.equal(avoidance.threat, 'SPUN_VEHICLE_AHEAD', 'Must flag spun vehicle threat');
  assert(avoidance.paceFactor <= 0.45, 'Pace must be slashed for emergency braking');
  assert(Math.abs(avoidance.targetLat) > 3.0, 'Evasive steering must diverge from spun car location');
  console.log(`  ✓ Spun vehicle evasion: Threat = ${avoidance.threat}, Evasion Lat = ${avoidance.targetLat.toFixed(2)}, Pace = ${avoidance.paceFactor}`);
}

// 6. Tactical Battery ERS Deployment Integration
{
  console.log('Test 6: Tactical Battery Attack / Charge Coordination');
  const driver = { personality: { aggression: 0.85, consistency: 0.85, attackSkill: 0.9 } };
  const agent = new DriverAgent(driver);
  agent.init(-1, track.k);

  const battery = new BatteryController({ startingEnergyJoules: 4000000 });
  const car = {
    code: 'PIA',
    d: 500, lat: 0.0, v: 68, drsActive: false, isPlayer: false, isSpun: false, finished: false, retiredLap: null,
    driver,
    batteryController: battery,
    batteryEligibility: { eligible: true, battleType: 'ATTACK', context: 'OVERTAKE_WINDOW' }
  };
  const mockAhead = {
    code: 'SAI',
    d: 512, lat: 1.5, v: 58, drsActive: false, isSpun: false, finished: false, retiredLap: null
  };

  agent.decide(car, [car, mockAhead], track, 10.0, 'green', null);
  assert.equal(car.batteryController.mode, 'ATTACK', 'Battery controller must engage ATTACK mode during viable pass');
  assert(agent.w2wPlanner.drivingPlan.tacticalBattery, 'Tactical battery deployment flag set');
  console.log(`  ✓ Battery synchronized with tactical overtake: Mode = ${car.batteryController.mode}, Deployment Level = ${car.batteryController.powerLevel}`);
}

console.log('\n✅ All Wheel-to-Wheel Racing AI Tests Passed Successfully!\n');
