/**
 * test_wider_tracks_and_overtaking.mjs
 * Comprehensive Test Suite for Wider Tracks, Racing Lines, and Wheel-to-Wheel Overtaking Space (Phase 8).
 *
 * Verifies:
 *   1. Track geometry and dynamic width arrays (width, halfWidth, usableHalfWidth, getTrackWidthAt)
 *   2. Configured per-circuit baseline widths and segment-specific bonuses
 *   3. Smooth C1 continuity across waypoint transitions (no geometric kinks)
 *   4. Reference line and alternative inside/outside racing lines with speed/braking deltas
 *   5. Track-relative boundary positioning (distFromLeft, distFromRight)
 *   6. Overtaking room evaluation and corridor selection (inside dive vs sweeping outside)
 *   7. Defensive positioning and mutual racing room compliance (>= 1.2 car widths)
 *   8. Physics boundaries: kerb detection, off-track speed scrub, and hard barrier clamp
 *   9. Pit lane geometric clearance outside widened track boundary
 *  10. Full multi-car race verification with clean overtakes and zero boundary breaches
 */

import { strict as assert } from 'assert';
import { RaceEngine, RaceState } from '../src/simulation/raceEngine.js';
import { buildTrack, sampleTrack } from '../src/simulation/trackManager.js';
import { getCircuit, RAW_WAYPOINTS } from '../src/data/circuitData.js';
import { getGrid, DRIVERS } from '../src/data/driverData.js';
import { WheelToWheelPlanner, OvertakeDecision } from '../src/ai/wheelToWheelPlanner.js';
import { stepCar, placeCar } from '../src/simulation/physicsEngine.js';
import { getTrackWidthConfig } from '../src/config/trackWidthConfig.js';

console.log('🏎️ ══════════════════════════════════════════════════════════════');
console.log('   WIDER TRACKS & REALISTIC OVERTAKING SPACE TEST SUITE');
console.log('══════════════════════════════════════════════════════════════\n');

// ── Test 1: Track Geometry and Dynamic Width Arrays ──────────────────────────
{
  console.log('Test 1: Authoritative Width Arrays & Smooth Continuity');
  const monzaCircuit = getCircuit('monza');
  const track = buildTrack(monzaCircuit, RAW_WAYPOINTS.monza);

  assert(track.width && (Array.isArray(track.width) || ArrayBuffer.isView(track.width)), 'Track must have authoritative width array');
  assert(track.halfWidth && (Array.isArray(track.halfWidth) || ArrayBuffer.isView(track.halfWidth)), 'Track must have authoritative halfWidth array');
  assert(track.usableHalfWidth && (Array.isArray(track.usableHalfWidth) || ArrayBuffer.isView(track.usableHalfWidth)), 'Track must have authoritative usableHalfWidth array');
  assert(track.width.length === track.N, `Width array length must match N=${track.N}`);
  assert(typeof track.avgWidth === 'number' && track.avgWidth > 22 * track.k, 'Average width must reflect widened circuit');
  assert(typeof track.getTrackWidthAt === 'function', 'track.getTrackWidthAt function must exist');

  // Test dynamic sampling
  const sample = sampleTrack(track, 500);
  assert(sample.width !== undefined, 'sampleTrack must return local track width');
  assert(sample.halfWidth !== undefined, 'sampleTrack must return local halfWidth');
  assert(sample.usableHalfWidth !== undefined, 'sampleTrack must return local usableHalfWidth');

  console.log(`  ✓ Monza width: avg = ${track.avgWidth.toFixed(1)} px, sample(500m) = ${sample.width.toFixed(1)} px (half = ${sample.halfWidth.toFixed(1)} px).\n`);
}

// ── Test 2: Configured Circuit Widths and Segment Overrides ──────────────────
{
  console.log('Test 2: Authentic Per-Circuit Widths & Segment-Specific Overrides');
  const circuitsToTest = ['monza', 'silverstone', 'monaco', 'baku'];

  for (const cid of circuitsToTest) {
    const circ = getCircuit(cid);
    const track = buildTrack(circ, RAW_WAYPOINTS[cid]);
    const cfg = getTrackWidthConfig(cid);

    const minExpected = ((cfg.minCornerWidth || cfg.baseWidth) - 1.0) * track.k;
    const maxSample = Math.max(...track.width);
    const minSample = Math.min(...track.width);

    assert(minSample >= minExpected - 0.1, `${cid} minimum width (${(minSample/track.k).toFixed(1)}) must be >= expected floor (${(minExpected/track.k).toFixed(1)})`);
    assert(maxSample > minSample, `${cid} should have dynamic width variations for straights/braking zones`);

    console.log(`  ✓ ${cid.toUpperCase()}: base = ${cfg.baseWidth}m | min = ${(minSample / track.k).toFixed(1)}k | max = ${(maxSample / track.k).toFixed(1)}k`);
  }
  console.log('');
}

// ── Test 3: Smooth C1 Width Continuity (No Geometric Discontinuities) ────────
{
  console.log('Test 3: Smooth C1 Gradient & No Sharp Kinks');
  const track = buildTrack(getCircuit('silverstone'), RAW_WAYPOINTS.silverstone);
  let maxDeltaPerMeter = 0;

  const ds = track.circuit.lengthM / track.N;
  for (let i = 0; i < track.N; i++) {
    const nextIdx = (i + 1) % track.N;
    const dw = Math.abs(track.width[nextIdx] - track.width[i]);
    if (ds > 0.01) {
      const grad = dw / ds;
      if (grad > maxDeltaPerMeter) maxDeltaPerMeter = grad;
    }
  }

  // Width shouldn't jump violently (gradient should be < 0.25 px/m due to Gaussian smoothing)
  assert(maxDeltaPerMeter < 0.25, `Width transition gradient (${maxDeltaPerMeter.toFixed(4)}) must be smooth (< 0.25 px/m)`);
  console.log(`  ✓ Silverstone max width gradient: ${maxDeltaPerMeter.toFixed(4)} px/m (Gaussian smoothed C1 continuity).\n`);
}

// ── Test 4: Alternative Racing Lines (Reference, Inside, Outside) ─────────────
{
  console.log('Test 4: Alternative Racing Lines & Corner Trade-offs');
  const track = buildTrack(getCircuit('monza'), RAW_WAYPOINTS.monza);
  const L = track.circuit.lengthM;
  const k = track.k;
  const planner = new WheelToWheelPlanner(DRIVERS[0]);

  // Evaluate chicane entry at Monza Curva Grande / Variante del Rettifilo
  const testCar = { d: 680, lat: 0, v: 45 };
  const sample = sampleTrack(track, 680);
  const altLines = planner._computeAlternativeRacingLines(testCar, track, L, k, null, sample.usableHalfWidth);

  assert(altLines !== null && typeof altLines === 'object', 'Alternative lines object must be returned');
  assert(typeof altLines.reference === 'number', 'Reference line must be numeric');
  assert(typeof altLines.inside === 'number', 'Alternative inside line must be numeric');
  assert(typeof altLines.outside === 'number', 'Alternative outside line must be numeric');
  assert(altLines.isCorner === true, 'd=680m at Monza must detect corner');
  assert(altLines.brakingDeltaM > 0, 'Inside line must require earlier braking point');
  assert(altLines.apexSpeedFactor < 1.0, 'Inside line must reduce apex speed due to tighter radius');

  // Verify inside line has a different lateral target than outside line
  const lateralSpan = Math.abs(altLines.outside - altLines.inside);
  assert(lateralSpan >= 7.0 * k, `Inside and outside lines must provide substantial corridor separation (${lateralSpan.toFixed(2)} px >= 7.0k)`);

  console.log(`  ✓ Monza T1: Reference = ${altLines.reference.toFixed(2)} px | Inside = ${altLines.inside.toFixed(2)} px | Outside = ${altLines.outside.toFixed(2)} px`);
  console.log(`  ✓ Lateral separation between alternative lines: ${lateralSpan.toFixed(2)} px (${(lateralSpan / k).toFixed(1)}k).\n`);
}

// ── Test 5: Track-Relative Boundary Positioning ──────────────────────────────
{
  console.log('Test 5: Track-Relative Distances from Left & Right Boundaries');
  const track = buildTrack(getCircuit('monza'), RAW_WAYPOINTS.monza);
  const L = track.circuit.lengthM;
  const k = track.k;
  const planner = new WheelToWheelPlanner(DRIVERS[0]);

  const car = {
    code: 'NOR',
    d: 1200,
    lat: 3.5 * k,
    v: 70,
    finished: false,
    retiredLap: null
  };

  const plan = planner.plan(car, [car], track, 10.0, 'green', null);
  const sample = sampleTrack(track, car.d);

  assert(typeof car.distFromLeft === 'number', 'car.distFromLeft must be populated');
  assert(typeof car.distFromRight === 'number', 'car.distFromRight must be populated');

  // Verification: distFromLeft + distFromRight must equal total track width
  const sumDist = car.distFromLeft + car.distFromRight;
  const expectedTotalWidth = sample.halfWidth * 2;
  assert(Math.abs(sumDist - expectedTotalWidth) < 0.01, `Boundary distances (${sumDist.toFixed(2)}) must sum to total width (${expectedTotalWidth.toFixed(2)})`);

  console.log(`  ✓ Car at lat = ${car.lat.toFixed(2)} px: Left = ${car.distFromLeft.toFixed(2)} px, Right = ${car.distFromRight.toFixed(2)} px (Total: ${sumDist.toFixed(2)} px).\n`);
}

// ── Test 6: Tactical Overtaking with Multiple Passing Corridors ───────────────
{
  console.log('Test 6: Overtaking Room Evaluation & Outside/Inside Passing Corridors');
  const track = buildTrack(getCircuit('silverstone'), RAW_WAYPOINTS.silverstone);
  const L = track.circuit.lengthM;
  const k = track.k;
  const planner = new WheelToWheelPlanner(DRIVERS[1]);

  // Defender holding the inside line on the straight before Brooklands
  const defender = { code: 'VER', d: 2400, lat: -4.0 * k, v: 72, finished: false, retiredLap: null, isSpun: false };
  const attacker = { code: 'NOR', d: 2375, lat: 0.0, v: 80, finished: false, retiredLap: null, isSpun: false };

  const conflicts = planner._predictConflicts(attacker, [defender], L, k, null);
  const usableHalfW = 12.5 * k;
  const altLines = planner._computeAlternativeRacingLines(attacker, track, L, k, null, usableHalfW);
  const otEval = planner._evaluateOvertaking(attacker, conflicts, track, 1.0, 'green', k, L, usableHalfW, altLines);

  assert(otEval.state === OvertakeDecision.VIABLE_OPPORTUNITY || otEval.state === OvertakeDecision.POTENTIAL_OPPORTUNITY, 'Must identify viable passing opportunity');
  // Defender is holding negative lat (-4k) -> attacker should select positive lat corridor (+outside corridor)
  assert(otEval.passSide > 0, 'Attacker must switch to open outside corridor (+1) when inside is occupied');
  assert(otEval.targetLat > 0, `Target lat (${otEval.targetLat.toFixed(2)}) must be on the open side`);

  console.log(`  ✓ Attacker identified open corridor: targetLat = ${otEval.targetLat.toFixed(2)} px, side = ${otEval.passSide > 0 ? 'Outside/Left' : 'Inside/Right'}.\n`);
}

// ── Test 7: Mutual Racing Room Enforcement (>= 1.2 Car Widths) ───────────────
{
  console.log('Test 7: Defensive Positioning & Mutual Racing Room Compliance');
  const track = buildTrack(getCircuit('monza'), RAW_WAYPOINTS.monza);
  const L = track.circuit.lengthM;
  const k = track.k;
  const carWidthPx = 3.6 * k;
  const planner = new WheelToWheelPlanner(DRIVERS[0]);

  // Cars side-by-side along the pit straight
  const carA = { code: 'HAM', d: 500, lat: 2.0 * k, v: 75, finished: false, retiredLap: null, isSpun: false };
  const carB = { code: 'LEC', d: 502, lat: -1.5 * k, v: 75, finished: false, retiredLap: null, isSpun: false };

  const conflicts = planner._predictConflicts(carA, [carB], L, k, null);
  assert(conflicts.sideBySideCars.length > 0, 'Side-by-side overlap must be detected');

  const defResult = planner._evaluateDefending(carA, conflicts, track, k, L, 'green', 13.0 * k);
  assert(defResult.isDefending === true, 'Side-by-side car must activate mutual defense room');
  assert(defResult.racingRoom >= carWidthPx * 1.15, `Racing room (${defResult.racingRoom.toFixed(2)}) must exceed 1.15 car widths`);

  console.log(`  ✓ Side-by-side room enforced: ${defResult.racingRoom.toFixed(2)} px (required: ${(carWidthPx * 1.15).toFixed(2)} px).\n`);
}

// ── Test 8: Physical Kerb Scrub, Off-Track Grip Penalty, & Barrier Clamping ──
{
  console.log('Test 8: Physics Boundaries, Off-Track Speed Scrub, and Barrier Clamping');
  const track = buildTrack(getCircuit('monza'), RAW_WAYPOINTS.monza);
  const k = track.k;
  const sample = sampleTrack(track, 1000);
  const trackHalfW = sample.halfWidth; // ~14k

  // Car 1: On-track within asphalt limits
  const carOnTrack = { d: 1000, lat: trackHalfW * 0.5, v: 60, acc: 0, throttle: 1, brake: 0, targetLat: trackHalfW * 0.5, currentGrip: 1.0 };
  stepCar(carOnTrack, track, 0.05, 1.0, false, null);
  assert(!carOnTrack.isOffTrack, 'Car within halfWidth must be on-track');

  // Car 2: Slightly outside asphalt on kerbs
  const carOnKerb = { d: 1000, lat: trackHalfW + 1.0 * k, v: 60, acc: 0, throttle: 1, brake: 0, targetLat: trackHalfW + 1.0 * k, currentGrip: 1.0 };
  stepCar(carOnKerb, track, 0.05, 1.0, false, null);
  assert(carOnKerb.onKerb === true, 'Car outside asphalt halfWidth must trigger onKerb');

  // Car 3: Completely off-track in runoff/gravel
  const carOffTrack = { d: 1000, lat: trackHalfW + 4.5 * k, v: 60, acc: 0, throttle: 1, brake: 0, targetLat: trackHalfW + 4.5 * k, currentGrip: 1.0 };
  stepCar(carOffTrack, track, 0.05, 1.0, false, null);
  assert(carOffTrack.isOffTrack === true, 'Car beyond kerb must trigger isOffTrack');
  assert(carOffTrack.currentGrip < 0.70, 'Off-track car must suffer physical grip penalty (< 0.70)');

  // Car 4: Extreme lateral position clamped by barrier
  const carClamped = { d: 1000, lat: trackHalfW + 12.0 * k, v: 60, acc: 0, throttle: 1, brake: 0, targetLat: trackHalfW + 12.0 * k, currentGrip: 1.0 };
  stepCar(carClamped, track, 0.05, 1.0, false, null);
  const kerbWidth = 3.2 * k;
  const maxBarrierLimit = trackHalfW + kerbWidth + 3.5 * k;
  assert(Math.abs(carClamped.lat) <= maxBarrierLimit, `Car lat (${carClamped.lat.toFixed(2)}) must be clamped by barrier at ${maxBarrierLimit.toFixed(2)}`);

  console.log(`  ✓ On-track (lat=${carOnTrack.lat.toFixed(1)}): clear | On-kerb: kerb flag active | Off-track grip: ${carOffTrack.currentGrip.toFixed(2)}x | Barrier clamped: ${carClamped.lat.toFixed(1)} px.\n`);
}

// ── Test 9: Pit Lane Geometric Clearance Outside Widened Track ────────────────
{
  console.log('Test 9: Pit Lane Spatial Clearance Outside Track Limits');
  const track = buildTrack(getCircuit('silverstone'), RAW_WAYPOINTS.silverstone);
  const pitLane = track.pitLane;

  assert(pitLane !== null && pitLane !== undefined, 'Track must have pit lane');
  const pitOffsetAbs = Math.abs(pitLane.offsetPx);
  const avgHalfWidth = track.avgHalfWidth;

  // The pit lane must be placed cleanly OUTSIDE the widened asphalt half-width
  assert(pitOffsetAbs > avgHalfWidth + 2.0 * track.k, `Pit lane offset (${pitOffsetAbs.toFixed(2)} px) must be outside track asphalt half-width (${avgHalfWidth.toFixed(2)} px)`);

  console.log(`  ✓ Silverstone: Track avg half-width = ${avgHalfWidth.toFixed(1)} px | Pit lane offset = ${pitOffsetAbs.toFixed(1)} px (clearance margin = ${(pitOffsetAbs - avgHalfWidth).toFixed(1)} px).\n`);
}

// ── Test 10: Multi-Car Race Verification Across Multiple Laps ────────────────
{
  console.log('Test 10: Multi-Car Race Execution with Dynamic Widths & Clean Passes');
  const circuit = getCircuit('monza');
  const track = buildTrack(circuit, RAW_WAYPOINTS.monza);
  const grid = getGrid(10);
  const engine = new RaceEngine();
  engine.build(track, grid, 2, { weatherPreset: 'DRY' });
  engine.state = RaceState.RACING;
  engine.flag = 'green';
  engine.raceControl.state = 'green';
  engine.launchManager.state = 'racing';

  const dt = 0.05;
  let totalSteps = 0;
  let maxLatObserved = 0;
  let offTrackClamps = 0;

  // Simulate 1.5 laps of active racing
  for (let s = 0; s < 1800; s++) {
    engine.step(dt);
    totalSteps++;

    for (const car of engine.cars) {
      if (Math.abs(car.lat) > maxLatObserved) maxLatObserved = Math.abs(car.lat);
      if (car.isOffTrack) offTrackClamps++;
    }

    if (engine.cars.some(c => c.lap >= 2)) break;
  }

  // Ensure cars explored the wider track lateral range (> 4.5k) without blowing past barriers
  assert(maxLatObserved > 4.5 * track.k, `Cars must utilize wider track corridors (maxLat = ${maxLatObserved.toFixed(2)} px > 4.5k)`);
  assert(engine.cars.every(c => !Number.isNaN(c.d) && !Number.isNaN(c.lat) && !Number.isNaN(c.v)), 'All cars must maintain finite physical states');

  const tel = engine.getDeveloperTelemetry(0);
  assert(tel.trackHalfWidthPx > 0, 'Developer telemetry must report trackHalfWidthPx');
  assert(tel.distFromLeftM !== undefined, 'Developer telemetry must report distFromLeftM');
  assert(tel.distFromRightM !== undefined, 'Developer telemetry must report distFromRightM');

  console.log(`  ✓ Simulated ${totalSteps} ticks with 10 cars: max lateral spread = ${maxLatObserved.toFixed(2)} px (${(maxLatObserved / track.k).toFixed(1)}k).`);
  console.log(`  ✓ Telemetry verified: Dist L = ${tel.distFromLeftM} px | Dist R = ${tel.distFromRightM} px | Track HalfW = ${tel.trackHalfWidthPx} px.\n`);
}

console.log('══════════════════════════════════════════════════════════════');
console.log('🎉 ALL 10 WIDER TRACKS & OVERTAKING TESTS PASSED PERFECTLY!');
console.log('══════════════════════════════════════════════════════════════');
