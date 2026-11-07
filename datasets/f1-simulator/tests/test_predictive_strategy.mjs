/**
 * test_predictive_strategy.mjs
 * Automated test suite for Predictive Pit Strategy Engine & Autonomous Execution.
 */

import { strict as assert } from 'assert';
import { PredictiveStrategyEngine, PitAction, StrategyPersonality } from '../src/strategy/predictiveStrategyEngine.js';
import { StrategyAI } from '../src/strategy/strategyAI.js';
import { PitStopManager, PitStates } from '../src/strategy/pitStopManager.js';
import { TyreModel } from '../src/simulation/tyreModel.js';
import { buildTrack } from '../src/simulation/trackManager.js';
import { getCircuit, RAW_WAYPOINTS } from '../src/data/circuitData.js';

console.log('🧪 Starting Predictive Pit Strategy Test Suite...\n');

const circuit = getCircuit('monza');
const track = buildTrack(circuit, RAW_WAYPOINTS.monza);
const L = track.circuit.lengthM;

// 1. Pit-Lane Time Loss Geometry (Green Flag vs Safety Car)
{
  console.log('Test 1: Circuit Pit-Lane Geometry Loss (Green vs SC/VSC)');
  const engine = new PredictiveStrategyEngine();

  const greenLoss = engine.calculateRealPitLoss(track, 'green');
  const scLoss = engine.calculateRealPitLoss(track, 'safetycar');
  const vscLoss = engine.calculateRealPitLoss(track, 'vsc');

  assert(greenLoss >= 17.0 && greenLoss <= 26.0, `Green flag pit loss should be ~17-25s, got ${greenLoss.toFixed(2)}s`);
  assert(scLoss >= 8.0 && scLoss <= 15.0, `SC pit loss should be ~8-14s, got ${scLoss.toFixed(2)}s`);
  assert(vscLoss >= 9.5 && vscLoss <= 17.0, `VSC pit loss should be ~10-16s, got ${vscLoss.toFixed(2)}s`);
  assert(scLoss < greenLoss, 'SC pit loss must be significantly cheaper than green flag');
  console.log(`  ✓ Pit loss geometry: Green = ${greenLoss.toFixed(1)}s, VSC = ${vscLoss.toFixed(1)}s, SC = ${scLoss.toFixed(1)}s (Saving: ${(greenLoss - scLoss).toFixed(1)}s)`);
}

// 2. Traffic-Aware Rejoin Prediction (Avoiding Traffic Knot & DRS Trains)
{
  console.log('Test 2: Rejoin Traffic Projection & Dirty Air / DRS Train Avoidance');
  const engine = new PredictiveStrategyEngine();

  const myCar = {
    code: 'LEC', d: 3000, v: 65, tyreModel: new TyreModel('medium', 0), lap: 12
  };

  // Scenario A: Clear track at projected rejoin window
  const clearGrid = [
    myCar,
    { code: 'VER', d: 3500, v: 65, lap: 12 },
    { code: 'HAM', d: 500, v: 65, lap: 12 }
  ];
  const clearEval = engine.predictRejoinTraffic(myCar, track, 22.0, clearGrid);
  assert(clearEval.clearAirAhead, 'Rejoin into clear air must have clearAirAhead = true');
  assert(!clearEval.hasHeavyTraffic, 'Must not flag heavy traffic in clear air');
  console.log(`  ✓ Rejoin into clean air: clearAirAhead = ${clearEval.clearAirAhead}, Traffic count = ${clearEval.trafficDensity}`);

  // Scenario B: Dense pack / DRS train at projected rejoin point
  const projectedExitD = (((myCar.d - 65 * 22.0) % L) + L) % L;
  const trafficGrid = [
    myCar,
    { code: 'TSU', d: projectedExitD + 8, v: 60, lap: 11 },
    { code: 'GAS', d: projectedExitD + 18, v: 60, lap: 11 },
    { code: 'OCO', d: projectedExitD + 26, v: 60, lap: 11 }
  ];
  const trafficEval = engine.predictRejoinTraffic(myCar, track, 22.0, trafficGrid);
  assert(trafficEval.hasHeavyTraffic, 'Rejoin into 3 closely bunched cars must be flagged as hasHeavyTraffic');
  assert.equal(trafficEval.blockingCarCode, 'TSU', 'Must identify blocking lead car');
  console.log(`  ✓ DRS train detected at rejoin exit: blockingCar = ${trafficEval.blockingCarCode}, Pack density = ${trafficEval.trafficDensity}`);
}

// 3. Mathematical Undercut & Overcut Forecast
{
  console.log('Test 3: Mathematical Undercut / Overcut Delta Models');
  const engine = new PredictiveStrategyEngine();

  const carBehind = {
    code: 'NOR', d: 2000, v: 64, lap: 15,
    tyreModel: new TyreModel('medium', 0)
  };
  carBehind.tyreModel.wear = 0.58; // worn tyres

  const carAhead = {
    code: 'PIA', d: 2040, v: 64, lap: 15, // 40m (~0.6s) ahead
    tyreModel: new TyreModel('medium', 0)
  };
  carAhead.tyreModel.wear = 0.55;

  const undercut = engine.analyzeUndercut(carBehind, carAhead, 22.0, 10);
  assert(undercut !== null, 'Undercut analysis must return result for close rival');
  assert(typeof undercut.netAdvantageS === 'string', 'Undercut net advantage must be formatted string');
  assert(typeof undercut.isViable === 'boolean', 'Undercut viability must be boolean');
  console.log(`  ✓ Undercut evaluation: Viable = ${undercut.isViable}, Projected Advantage = ${undercut.netAdvantageS}s against ${undercut.rivalCode}`);
}

// 4. Autonomous Pit Stop Request and Physical Execution
{
  console.log('Test 4: Autonomous Pit Stop State Machine & Mechanical Service');
  const car = {
    code: 'RUS',
    d: L - 160, // 20m before pit entry at L - 140m
    v: 60,
    lap: 10,
    pitState: PitStates.READY,
    pitRequested: false,
    pitLateRequest: false,
    targetCompound: 'medium',
    pitServiceTimer: 0,
    tyreModel: new TyreModel('soft', 0),
    compoundsUsed: new Set(['soft']),
    pitstops: 0
  };
  car.tyreModel.wear = 0.75; // heavy wear

  // 1. Request pit stop for Hard compound
  PitStopManager.requestPit(car, 'hard', track);
  assert.equal(car.pitRequested, true, 'Pit stop must be requested');
  assert.equal(car.targetCompound, 'hard', 'Target compound must be hard');

  // 2. Approach pit entry and trigger ENTERING
  const events = [];
  let nav = PitStopManager.update(car, track, 0.5, 100.0, events);
  car.d = L - 120; // inside pit lane
  nav = PitStopManager.update(car, track, 0.5, 100.5, events);
  assert.equal(car.pitState, PitStates.ENTERING, 'Car must transition to ENTERING');
  assert(Math.abs(nav.speedLimitMps - 22.2) < 0.1, 'Pit limiter must enforce 80 km/h');

  // 3. Arrive at pit box (d = 0) and undergo stationary tyre change
  car.d = 0;
  nav = PitStopManager.update(car, track, 0.5, 102.0, events);
  assert.equal(car.pitState, PitStates.SERVICING, 'Car must be SERVICING in pit box');
  assert.equal(nav.isStationary, true, 'Car must be physically stationary during tyre service');

  // Advance stationary service (takes ~2.4s)
  for (let t = 0; t < 6; t++) {
    PitStopManager.update(car, track, 0.5, 102.5 + t * 0.5, events);
  }

  // 4. Service complete: new tyres fitted
  assert.equal(car.tyreModel.compound, 'hard', 'Hard compound tyres must be physically mounted');
  assert(car.tyreModel.wear < 0.05, 'Fresh tyres must have near zero initial wear');
  assert(car.compoundsUsed.has('hard'), 'Compounds used set must record hard compound');
  assert.equal(car.pitstops, 1, 'Pitstop counter must increment to 1');
  console.log(`  ✓ Opponent pit executed autonomously: Compound = ${car.tyreModel.compound.toUpperCase()}, New wear = ${(car.tyreModel.wear * 100).toFixed(1)}%, Pitstops = ${car.pitstops}`);
}

// 5. Decision Stability Lock
{
  console.log('Test 5: Decision Stability Lock (Preventing Thrashing)');
  const engine = new PredictiveStrategyEngine();

  const car = {
    code: 'HAM', d: 1000, v: 65, lap: 5,
    tyreModel: new TyreModel('medium', 0)
  };
  car.tyreModel.wear = 0.88; // triggers PIT_THIS_LAP

  // First evaluation on Lap 5: triggers pit call and sets lockUntilLap = 6
  const eval1 = engine.evaluateStrategy(car, 25, track, null, { rainIntensity: 0 }, [car], 'green', 100.0);
  assert.equal(eval1.action, PitAction.PIT_THIS_LAP, 'Should commit to PIT_THIS_LAP on heavily worn tyres');
  
  const carDec = engine.carDecisions.get('HAM');
  assert(carDec !== null, 'Decision state must be recorded');
  assert.equal(carDec.lockUntilLap, 6, 'Decision must be locked until Lap 6');

  console.log(`  ✓ Strategy stability lock prevents flip-flopping: Committed on Lap ${car.lap}, Locked until Lap ${carDec.lockUntilLap}`);
}

console.log('\n✅ All Predictive Pit Strategy Tests Passed Successfully!\n');
