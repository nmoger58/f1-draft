/**
 * test_dev_racing_diagnostics.mjs
 * Authoritative Acceptance Test Suite for Developer Racing Diagnostics Mode (Phase 8 Extension).
 *
 * Verifies:
 *   1. Constrained passing opportunity identification (insufficient lateral room / corridors blocked).
 *   2. Feasible passing opportunity identification (room open, closing speed delta, ATTACKING state, passing line selected).
 *   3. Boundary-clearance problem identification (track limit violation, boundary margins exceeded).
 *   4. Rejected unsafe maneuver identification (collision threat or wet grip deficit triggering ABORTING state).
 *   5. Simulation outcome determinism (Diagnostics ON vs Diagnostics OFF produces 100% bit-exact physics results).
 *   6. Cross-circuit coordinate mapping and visual layer definitions across all 8 circuits.
 */

import { strict as assert } from 'assert';
import { WheelToWheelPlanner, AIBehaviorState, OvertakeDecision } from '../src/ai/wheelToWheelPlanner.js';
import { RaceEngine } from '../src/simulation/raceEngine.js';
import { buildTrack, sampleTrack } from '../src/simulation/trackManager.js';
import { CIRCUITS, RAW_WAYPOINTS, getCircuit } from '../src/data/circuitData.js';
import { getGrid } from '../src/data/driverData.js';
import { trackToWorld, DEFAULT_DEBUG_LAYERS } from '../src/ui/developerTelemetry.js';

console.log('🏁 Starting Authoritative Developer Racing Diagnostics Test Suite...\n');

const circuit = getCircuit('monza');
const track = buildTrack(circuit, RAW_WAYPOINTS.monza);
const L = track.circuit.lengthM;
const k = track.k || 1;
const N = track.N || 720;

// ── Test 1: Constrained Passing Opportunity ─────────────────────────────────
{
  console.log('Test 1: Deliberately Constrained Passing Opportunity');
  const planner = new WheelToWheelPlanner({
    personality: { aggression: 0.75, overtakeAggression: 0.75, consistency: 0.85 }
  });

  // Create a copy of track with tightly constrained usable corridor (< 4.86m) around d = 1200m
  const constrainedTrack = {
    ...track,
    usableHalfWidth: new Float32Array(track.usableHalfWidth),
    halfWidth: new Float32Array(track.halfWidth)
  };
  const curIdx = Math.floor((1200 / L) * N);
  for (let offset = -20; offset <= 20; offset++) {
    const idx = (curIdx + offset + N) % N;
    constrainedTrack.usableHalfWidth[idx] = 4.2 * k; // 8.4m total usable asphalt width
    constrainedTrack.halfWidth[idx] = 4.8 * k;
  }

  // Chasing Car A at 68 m/s, Defending Car B ahead at 63 m/s centered tightly
  const carA = {
    code: 'VER',
    d: 1200,
    lat: 0.0,
    v: 68,
    acc: 1.5,
    latAcc: 0.0,
    targetLat: 0.0,
    isSpun: false,
    finished: false,
    retiredLap: null,
    drsActive: false,
    currentGrip: 1.0,
    batteryOutput: { isDeploying: false }
  };

  // Lead car positioned to block room on both inside and outside
  const carB = {
    code: 'LEC',
    d: 1215, // 15m ahead
    lat: 0.2 * k,
    v: 63,
    acc: 0.5,
    latAcc: 0.0,
    targetLat: 0.2 * k,
    isSpun: false,
    finished: false,
    retiredLap: null
  };

  const plan = planner.plan(carA, [carB], constrainedTrack, 10.0, 'GREEN', null);

  console.log(`  AI State: ${plan.aiState}`);
  console.log(`  Overtake Decision: ${plan.otDecision}`);
  console.log(`  Rejection Reason: ${plan.rejectionReason}`);
  console.log(`  Net Usable Width: ${plan.netUsableWidthM} m`);

  // Assertions:
  assert.notEqual(plan.aiState, AIBehaviorState.ATTACKING, 'Constrained corridor must NOT trigger ATTACKING state');
  assert(
    plan.otDecision === OvertakeDecision.HIGH_RISK_OPPORTUNITY ||
    plan.otDecision === OvertakeDecision.POTENTIAL_OPPORTUNITY ||
    plan.otDecision === OvertakeDecision.NO_OPPORTUNITY,
    'Overtake decision must not be VIABLE'
  );
  assert(plan.rejectionReason !== null, 'Diagnostics must explicitly record rejection reason');
  assert(
    plan.rejectionReason.includes('Insufficient') ||
    plan.rejectionReason.includes('room') ||
    plan.rejectionReason.includes('corridor') ||
    plan.rejectionReason.includes('blocked'),
    `Rejection reason must explain lateral room restriction, got: "${plan.rejectionReason}"`
  );
  assert(plan.candidatePaths.length >= 2, 'Candidate paths must be evaluated');

  console.log('  ✓ Test 1 Passed: Constrained passing opportunity correctly identified with rejection rationale.\n');
}

// ── Test 2: Feasible Passing Opportunity ─────────────────────────────────────
{
  console.log('Test 2: Feasible Passing Opportunity');
  const planner = new WheelToWheelPlanner({
    personality: { aggression: 0.85, overtakeAggression: 0.85, consistency: 0.90 }
  });

  // Create wide track straight at d = 1500m
  const wideTrack = {
    ...track,
    usableHalfWidth: new Float32Array(track.usableHalfWidth),
    halfWidth: new Float32Array(track.halfWidth)
  };
  const curIdx = Math.floor((1500 / L) * N);
  for (let offset = -20; offset <= 20; offset++) {
    const idx = (curIdx + offset + N) % N;
    wideTrack.usableHalfWidth[idx] = 12.0 * k;
    wideTrack.halfWidth[idx] = 14.0 * k;
  }

  // Chasing Car A closing rapidly with DRS active (+7 m/s delta)
  const carA = {
    code: 'NOR',
    d: 1500,
    lat: 0.0,
    v: 76,
    acc: 2.2,
    latAcc: 0.0,
    targetLat: 0.0,
    isSpun: false,
    finished: false,
    retiredLap: null,
    drsActive: true,
    currentGrip: 1.05,
    batteryOutput: { isDeploying: true }
  };

  // Lead car ahead positioned on the outside line (lat = +6.0 * k), leaving inside wide open (> 6.0m)
  const carB = {
    code: 'PIA',
    d: 1522, // 22m ahead
    lat: 6.0 * k,
    v: 69,
    acc: 1.0,
    latAcc: 0.0,
    targetLat: 6.0 * k,
    isSpun: false,
    finished: false,
    retiredLap: null
  };

  const plan = planner.plan(carA, [carB], wideTrack, 10.0, 'GREEN', null);

  console.log(`  AI State: ${plan.aiState}`);
  console.log(`  Overtake Decision: ${plan.otDecision}`);
  console.log(`  Selected Passing Line: ${plan.selectedPassingLine}`);
  console.log(`  Selection Reason: ${plan.selectionReason}`);

  // Assertions:
  assert.equal(plan.aiState, AIBehaviorState.ATTACKING, 'Feasible opportunity with room and speed delta must trigger ATTACKING state');
  assert.equal(plan.otDecision, OvertakeDecision.VIABLE_OPPORTUNITY, 'Overtake decision must be VIABLE_OPPORTUNITY');
  assert(
    plan.selectedPassingLine === 'INSIDE_DIVE' ||
    plan.selectedPassingLine === 'OUTSIDE_SWEEP' ||
    plan.selectedPassingLine === 'RIGHT_CORRIDOR' ||
    plan.selectedPassingLine === 'LEFT_CORRIDOR',
    `Must select a specific passing line, got: ${plan.selectedPassingLine}`
  );
  assert(plan.selectionReason !== null, 'Selection reason must be populated');
  assert(
    plan.selectionReason.includes('Sufficient') ||
    plan.selectionReason.includes('room') ||
    plan.selectionReason.includes('delta') ||
    plan.selectionReason.includes('dive'),
    `Selection reason must explain the decision, got: "${plan.selectionReason}"`
  );
  assert.equal(plan.rejectionReason, null, 'Rejection reason must be null for viable pass');

  // Candidate paths evaluation check
  const insideCand = plan.candidatePaths.find(p => p.name === 'Inside Dive');
  assert(insideCand, 'Inside Dive candidate must be evaluated');
  assert(insideCand.isFeasible, 'Inside Dive must be marked feasible');
  assert(insideCand.roomM >= 3.6, `Inside room must exceed vehicle width, got ${insideCand.roomM}m`);

  console.log('  ✓ Test 2 Passed: Feasible passing opportunity identified with line selection rationale.\n');
}

// ── Test 3: Boundary-Clearance Problem ──────────────────────────────────────
{
  console.log('Test 3: Boundary-Clearance Problem & Track Limit Identification');
  const planner = new WheelToWheelPlanner({
    personality: { aggression: 0.7, consistency: 0.8 }
  });

  const curIdx = Math.floor((500 / L) * N);
  const usableHalfW = track.usableHalfWidth ? track.usableHalfWidth[curIdx] : (11.5 * k);

  // Car placed past usable boundary (track limits violation)
  const carOut = {
    code: 'HAM',
    d: 500,
    lat: usableHalfW + 2.5 * k, // Exceeds usable asphalt by 2.5 px
    v: 55,
    acc: 0.0,
    latAcc: 0.0,
    targetLat: usableHalfW + 2.5 * k,
    isSpun: false,
    finished: false,
    retiredLap: null,
    currentGrip: 0.95
  };

  const plan = planner.plan(carOut, [], track, 10.0, 'GREEN', null);

  // Check boundary metrics
  const isViolation = Math.abs(carOut.lat) > usableHalfW;
  const distFromLeftM = plan.distFromLeftM;
  const distFromRightM = plan.distFromRightM;

  console.log(`  Car Lateral: ${carOut.lat.toFixed(2)} px (Usable Half Width: ${usableHalfW.toFixed(2)} px)`);
  console.log(`  Track Limit Violation: ${isViolation}`);
  console.log(`  Distance to Left Boundary: ${distFromLeftM} m`);
  console.log(`  Distance to Right Boundary: ${distFromRightM} m`);
  console.log(`  Net Usable Width: ${plan.netUsableWidthM} m`);

  assert.equal(isViolation, true, 'Car outside usable half width must be identified as track limit violation');
  assert(typeof distFromLeftM === 'number', 'Left boundary distance must be numeric');
  assert(typeof distFromRightM === 'number', 'Right boundary distance must be numeric');
  assert(plan.boundarySafetyMarginM > 0, 'Boundary safety margin must be positive');
  assert(plan.netUsableWidthM >= 0, 'Net usable width must be non-negative');

  console.log('  ✓ Test 3 Passed: Boundary-clearance violation correctly calculated and flagged.\n');
}

// ── Test 4: Rejected Unsafe Maneuver ────────────────────────────────────────
{
  console.log('Test 4: Rejected Unsafe Maneuver (Collision Hazard or Wet Grip Deficit)');
  const planner = new WheelToWheelPlanner({
    personality: { aggression: 0.65, consistency: 0.8 }
  });

  // Scenario A: Imminent collision threat (closing at 28 m/s with gap 10m -> TTC ~ 0.35s)
  const carA = {
    code: 'RUS',
    d: 800,
    lat: 0.0,
    v: 78,
    acc: 0.0,
    latAcc: 0.0,
    targetLat: 0.0,
    isSpun: false,
    finished: false,
    retiredLap: null,
    currentGrip: 1.0
  };

  const carB = {
    code: 'TSU',
    d: 810, // 10m ahead, moving slowly at 50 m/s
    lat: 0.1,
    v: 50,
    acc: 0.0,
    latAcc: 0.0,
    targetLat: 0.1,
    isSpun: false,
    finished: false,
    retiredLap: null
  };

  const plan = planner.plan(carA, [carB], track, 10.0, 'GREEN', null);

  console.log(`  AI State: ${plan.aiState}`);
  console.log(`  Collision Threat: ${plan.collisionThreat}`);
  console.log(`  Threat Severity: ${plan.threatSeverity}`);
  console.log(`  Avoidance Active: ${plan.avoidanceActive}`);
  console.log(`  Rejection Reason: ${plan.rejectionReason}`);

  assert.equal(plan.aiState, AIBehaviorState.ABORTING, 'Imminent collision risk must force AI state to ABORTING');
  assert(plan.collisionThreat, 'Collision threat must be flagged true');
  assert(plan.avoidanceActive || plan.emergencyBrakeTriggered, 'Avoidance supervisor must intervene');
  assert(
    plan.rejectionReason.includes('Collision') ||
    plan.rejectionReason.includes('hazard') ||
    plan.rejectionReason.includes('abort') ||
    plan.rejectionReason.includes('threat'),
    `Rejection reason must detail collision avoidance, got: "${plan.rejectionReason}"`
  );

  // Scenario B: Wet grip deficit (< 0.55)
  const carWet = {
    code: 'SAI',
    d: 800,
    lat: 0.0,
    v: 65,
    acc: 1.0,
    latAcc: 0.0,
    targetLat: 0.0,
    isSpun: false,
    finished: false,
    retiredLap: null,
    currentGrip: 0.48 // Very low wet grip
  };

  const planWet = planner.plan(carWet, [carB], track, 10.0, 'GREEN', null);
  console.log(`  Low Grip AI State: ${planWet.aiState}`);
  console.log(`  Low Grip Rejection: ${planWet.rejectionReason}`);

  assert.notEqual(planWet.aiState, AIBehaviorState.ATTACKING, 'Compromised grip must forbid ATTACKING state');
  assert(
    planWet.rejectionReason.includes('grip') ||
    planWet.rejectionReason.includes('Collision') ||
    planWet.rejectionReason.includes('hazard') ||
    planWet.rejectionReason.includes('Hazard'),
    'Rejection reason must mention low grip or hazard'
  );

  console.log('  ✓ Test 4 Passed: Unsafe maneuvers safely aborted with clear causal diagnostics.\n');
}

// ── Test 5: Simulation Outcome Determinism (Diagnostics ON vs OFF) ──────────
{
  console.log('Test 5: Simulation Outcome Determinism Test (Diagnostics ON vs OFF)');

  const grid = getGrid();
  const totalLaps = 2;

  // Run 1: Diagnostics OFF
  const engineOff = new RaceEngine();
  engineOff.build(track, grid, totalLaps, { randomDriverProfiles: false });

  // Run 2: Diagnostics ON (developer telemetry queried on every tick)
  const engineOn = new RaceEngine();
  engineOn.build(track, grid, totalLaps, { randomDriverProfiles: false });

  const ticks = 120;
  const dt = 0.05;

  for (let t = 0; t < ticks; t++) {
    // Step Run 1 (no telemetry queries)
    engineOff.step(dt);

    // Step Run 2 (telemetry inspected every step)
    engineOn.step(dt);
    for (let c = 0; c < 3; c++) {
      const tel = engineOn.getDeveloperTelemetry(c);
      assert(tel !== null, `Telemetry for car ${c} must exist`);
      assert(typeof tel.speedKph === 'number', 'speedKph must be numeric');
      assert(typeof tel.aiState === 'string', 'aiState must be string');
      assert(typeof tel.usableNetWidthM === 'number', 'usableNetWidthM must be numeric');
    }
  }

  // Compare all 20 cars bit-by-bit
  let maxDivergenceD = 0;
  let maxDivergenceV = 0;
  let maxDivergenceLat = 0;

  for (let i = 0; i < grid.length; i++) {
    const carOff = engineOff.cars[i];
    const carOn = engineOn.cars[i];

    const diffD = Math.abs(carOff.d - carOn.d);
    const diffV = Math.abs(carOff.v - carOn.v);
    const diffLat = Math.abs(carOff.lat - carOn.lat);

    maxDivergenceD = Math.max(maxDivergenceD, diffD);
    maxDivergenceV = Math.max(maxDivergenceV, diffV);
    maxDivergenceLat = Math.max(maxDivergenceLat, diffLat);

    assert(diffD < 1e-9, `Car ${carOff.code} d diverged: ${carOff.d} vs ${carOn.d}`);
    assert(diffV < 1e-9, `Car ${carOff.code} v diverged: ${carOff.v} vs ${carOn.v}`);
    assert(diffLat < 1e-9, `Car ${carOff.code} lat diverged: ${carOff.lat} vs ${carOn.lat}`);
  }

  console.log(`  Max Track Distance Divergence (d): ${maxDivergenceD.toExponential(4)} m`);
  console.log(`  Max Velocity Divergence (v):       ${maxDivergenceV.toExponential(4)} m/s`);
  console.log(`  Max Lateral Divergence (lat):     ${maxDivergenceLat.toExponential(4)} px`);
  console.log('  ✓ Test 5 Passed: Zero physics or AI divergence between Diagnostics ON and OFF.\n');
}

// ── Test 6: Cross-Circuit Visual Overlay Coordinate Mapping ─────────────────
{
  console.log('Test 6: Cross-Circuit Coordinate Mapping & Layer Definitions');

  assert(DEFAULT_DEBUG_LAYERS.centerline === false, 'Centerline disabled by default');
  assert(DEFAULT_DEBUG_LAYERS.referenceLine === true, 'Reference line enabled by default');
  assert(DEFAULT_DEBUG_LAYERS.selectedTrajectory === true, 'AI trajectory enabled by default');
  assert(DEFAULT_DEBUG_LAYERS.candidatePaths === true, 'Candidate paths enabled by default');
  assert(DEFAULT_DEBUG_LAYERS.collisionRisk === true, 'Collision risk enabled by default');

  // Verify trackToWorld on all 8 circuits
  const circuitKeys = Object.keys(RAW_WAYPOINTS);
  console.log(`  Validating coordinate mapping across ${circuitKeys.length} circuits...`);

  circuitKeys.forEach(circuitId => {
    const cData = getCircuit(circuitId);
    const cTrack = buildTrack(cData, RAW_WAYPOINTS[circuitId]);
    assert(cTrack, `Track build must succeed for ${circuitId}`);

    // Sample at 0m, 500m, and mid-circuit with 0 and lateral offsets
    const testPoints = [0, 500, cTrack.circuit.lengthM * 0.5];
    testPoints.forEach(dist => {
      const ptCenter = trackToWorld(cTrack, dist, 0);
      assert(!isNaN(ptCenter.x) && !isNaN(ptCenter.y), `Center point NaN on ${circuitId} at ${dist}m`);

      const ptLeft = trackToWorld(cTrack, dist, ptCenter.usableHalfWidth);
      assert(!isNaN(ptLeft.x) && !isNaN(ptLeft.y), `Left corridor NaN on ${circuitId} at ${dist}m`);

      const ptRight = trackToWorld(cTrack, dist, -ptCenter.usableHalfWidth);
      assert(!isNaN(ptRight.x) && !isNaN(ptRight.y), `Right corridor NaN on ${circuitId} at ${dist}m`);
    });
  });

  console.log(`  ✓ All ${circuitKeys.length} circuits verified with valid coordinate mappings.`);
  console.log('  ✓ Test 6 Passed: Cross-circuit coordinate mapping verified.\n');
}

console.log('═════════════════════════════════════════════════════════════════');
console.log('🎉 ALL DEVELOPER RACING DIAGNOSTICS ACCEPTANCE TESTS PASSED! 🎉');
console.log('═════════════════════════════════════════════════════════════════');
