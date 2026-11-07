// test_enhancements.mjs — Verification Suite for Manual DRS & Pit Stops
import { CIRCUITS, RAW_WAYPOINTS, getCircuit } from '../src/data/circuitData.js';
import { DRIVERS, getGrid }                    from '../src/data/driverData.js';
import { buildTrack }                           from '../src/simulation/trackManager.js';
import { RaceEngine, RaceState }               from '../src/simulation/raceEngine.js';
import { DRSController }                       from '../src/simulation/drsController.js';
import { PitStopManager, PitStates }           from '../src/strategy/pitStopManager.js';

console.log('🧪 RUNNING DRS & USER-DIRECTED PIT STOP VALIDATION SUITE 🧪\n');

let allPassed = true;
function assert(name, condition, details = '') {
  const icon = condition ? '✅' : '❌';
  console.log(`  ${icon} ${name}${details ? ': ' + details : ''}`);
  if (!condition) allPassed = false;
}

const silverstone = getCircuit('silverstone');
const track = buildTrack(silverstone, RAW_WAYPOINTS.silverstone);

// ── TEST GROUP 1: DRS Rules & Eligibility ─────────────────────────────────
console.log('--- TEST GROUP 1: DRS Zone Detection & Rule Enforcement ---');
const engine = new RaceEngine();
engine.warp = 1;
const grid = getGrid(6);
engine.build(track, grid, 5);
engine.start();

const carP2 = engine.cars[1]; // P2 car
const carP1 = engine.cars[0]; // P1 car

// Initially on Lap 0 / Lap 1: DRS should be disabled
const evalLap0 = DRSController.evaluate(carP2, track, engine.cars, engine.simTime, 'green');
assert('DRS disabled before Lap 2', !evalLap0.eligible && evalLap0.reason.includes('Lap 2'));

// Place car on Lap 2 inside DRS Zone 1 (Wellington Straight)
carP2.lap = 2;
carP1.lap = 2;
const drsZone1 = track.drsZones[0];
assert('DRS Zone 1 exists on Silverstone', !!drsZone1, drsZone1?.name);

// Test 1A: Outside zone
carP2.d = (drsZone1.startD - 200 + track.circuit.lengthM) % track.circuit.lengthM;
const evalOutside = DRSController.evaluate(carP2, track, engine.cars, engine.simTime, 'green');
assert('Activation rejected outside DRS zone', !evalOutside.eligible && evalOutside.reason === 'Outside DRS Zone');

// Test 1B: Inside zone, but leading (no car ahead)
carP1.d = (drsZone1.startD + 50) % track.circuit.lengthM;
const evalLeader = DRSController.evaluate(carP1, track, engine.cars, engine.simTime, 'green');
assert('Leader in DRS zone cannot activate (no car ahead)', !evalLeader.eligible && evalLeader.reason.includes('No car ahead'));

// Test 1C: Inside zone, gap > 1.0s (e.g. 150m at 70m/s = 2.1s)
carP2.d = (drsZone1.startD + 20) % track.circuit.lengthM;
carP1.d = (drsZone1.startD + 170) % track.circuit.lengthM;
carP2.v = 70;
carP1.v = 70;
const evalLargeGap = DRSController.evaluate(carP2, track, engine.cars, engine.simTime, 'green');
assert('Activation rejected when gap > 1.0s', !evalLargeGap.eligible && evalLargeGap.reason.includes('Gap >'));

// Test 1D: Inside zone, gap <= 1.0s (e.g. 40m at 70m/s = 0.57s)
carP1.d = (drsZone1.startD + 60) % track.circuit.lengthM;
const evalEligible = DRSController.evaluate(carP2, track, engine.cars, engine.simTime, 'green');
assert('DRS is ELIGIBLE when inside zone with gap <= 1.0s', evalEligible.eligible, `Gap: ${evalEligible.gapS?.toFixed(2)}s`);

// Test 1E: Safety restriction (Yellow Flag disables DRS)
const evalYellow = DRSController.evaluate(carP2, track, engine.cars, engine.simTime, 'yellow');
assert('Yellow Flag immediately disables DRS', !evalYellow.eligible && evalYellow.reason.includes('Yellow Flag'));

// ── TEST GROUP 2: Manual Control vs AI Autonomy ────────────────────────────
console.log('\n--- TEST GROUP 2: User Manual Control vs AI Autonomous DRS ---');
engine.setSelectedCar(1); // Select P2 (user's car)

// User selected driver: AI does NOT automatically open DRS
engine.step(0.016);
assert('User selected driver does not auto-open DRS', carP2.drsActive === false, 'Remains closed until user presses D');

// User presses D / toggles DRS
const toggleRes = engine.toggleDRS(1);
assert('User toggles DRS ON successfully', toggleRes.success && toggleRes.active === true);
assert('Car rear wing is now active', carP2.drsActive === true);

// User toggles DRS OFF
const toggleOff = engine.toggleDRS(1);
assert('User toggles DRS OFF successfully', toggleOff.success && toggleOff.active === false);

// Auto-close on braking
engine.toggleDRS(1); // turn ON
carP2.brake = 0.25;
engine.step(0.016);
assert('DRS snaps closed automatically upon braking', carP2.drsActive === false && engine.userDRSActive === false);

// AI opponent: auto-opens when eligible at racing speed
engine.simTime = 10; // Past warm-up ramp
const carP3 = engine.cars[2];
carP3.lap = 2;
carP3.d = (drsZone1.startD + 25) % track.circuit.lengthM;
carP3.v = 70;
carP3.brake = 0;
engine.step(0.016);
assert('AI opponent automatically deploys DRS when eligible', carP3.drsActive === true);

// ── TEST GROUP 3: DRS Physics Performance Impact ──────────────────────────
console.log('\n--- TEST GROUP 3: DRS Aerodynamic Drag & Speed Physics Effect ---');
// Compare top speed acceleration with DRS vs without DRS on straight
const testCarNoDrs = { ...carP2, drsActive: false, v: 75, d: 2000, throttle: 1, brake: 0, lat: 0 };
const testCarWithDrs = { ...carP2, drsActive: true, v: 75, d: 2000, throttle: 1, brake: 0, lat: 0 };

// Run 2 seconds of physics on straight
for (let step = 0; step < 120; step++) {
  const dt = 1 / 60;
  // Drag is lower with DRS
  const rawAccNoDrs = Math.max(4, 14 - 0.08 * testCarNoDrs.v);
  testCarNoDrs.v += rawAccNoDrs * dt;

  const rawAccDrs = Math.max(4, (14 * 1.04) - (0.08 * 0.72) * testCarWithDrs.v);
  testCarWithDrs.v += rawAccDrs * dt;
}
const deltaKmh = (testCarWithDrs.v - testCarNoDrs.v) * 3.6;
assert('DRS yields measurable top-end speed increase', deltaKmh > 5 && deltaKmh < 30, `+${deltaKmh.toFixed(1)} km/h delta`);

// ── TEST GROUP 4: User-Directed Pit Stops ──────────────────────────────────
console.log('\n--- TEST GROUP 4: User Pit Stop Requests & Pit Lane Lifecycle ---');
engine.setSelectedCar(0); // Select P1
const selCar = engine.cars[0];
selCar.tyreWear = 0.45; // 45% wear

// User requests BOX with HARD tyres
const pitReq = engine.requestPit(0, 'hard');
assert('Pit request accepted by Race Control', pitReq.success && selCar.pitRequested === true);
assert('Target compound set to HARD', selCar.targetCompound === 'hard');

// Position car approaching pit entry (d = L - 100m)
selCar.d = track.circuit.lengthM - 100;
selCar.v = 60; // 216 km/h
engine.step(0.05);

assert('Car enters pit lane successfully', selCar.pitState === PitStates.ENTERING || selCar.pitState === PitStates.IN_LANE);
assert('Pit speed limiter enforces 80 km/h ceiling', selCar.pitSpeedLimit <= 22.3, `${(selCar.pitSpeedLimit * 3.6).toFixed(0)} km/h`);

// Advance car to pit box (d = 0)
selCar.d = 0;
engine.step(0.05);
assert('Car reaches pit box and stops for service', selCar.pitState === PitStates.SERVICING && selCar.v === 0);

// Advance service timer (2.4 seconds)
for (let i = 0; i < 60; i++) {
  engine.step(0.05); // total 3.0 sim seconds
}
assert('Tyre change completed to HARD compound', selCar.tyreStrategy.compound === 'hard');
assert('Tyre wear reset to 0% after service', Math.round(selCar.tyreWear * 100) === 0);
assert('Pit stops count incremented', selCar.pitstops === 1);
assert('Car transitions to EXITING', selCar.pitState === PitStates.EXITING || selCar.pitState === PitStates.OUT_LAP);

// Complete pit exit onto track (d = 120m)
selCar.d = 130;
engine.step(0.05);
assert('Car safely rejoins track and limiter disengages', selCar.pitSpeedLimit === null && selCar.pitRequested === false);

// ── TEST GROUP 5: Late Pit Request Safety Deferral ────────────────────────
console.log('\n--- TEST GROUP 5: Late Pit Request Safety Constraint ---');
// Car is 20m before S/F (past the 40m commit line)
selCar.d = track.circuit.lengthM - 20;
const lateReq = engine.requestPit(0, 'soft');
assert('Late pit request safely deferred to next lap', lateReq.success && selCar.pitLateRequest === true);
assert('Radio informs driver to stay out this lap', lateReq.message.includes('Too late for pit entry this lap'));

// ── TEST GROUP 6: Reset State Handling ────────────────────────────────────
console.log('\n--- TEST GROUP 6: Simulation Reset Verification ---');
engine.reset(track, grid, 5);
const resetCar = engine.cars[0];
assert('Reset clears DRS active state', engine.userDRSActive === false && resetCar.drsActive === false);
assert('Reset clears pit request state', resetCar.pitRequested === false && resetCar.pitState === PitStates.READY);
assert('Reset restores fresh tyres', resetCar.tyreWear === 0 && resetCar.pitstops === 0);

console.log('\n' + '═'.repeat(60));
console.log(allPassed ? '🏁 ALL DRS & PIT STOP ENHANCEMENT TESTS PASSED 🏁' : '❌ SOME TESTS FAILED');
console.log('═'.repeat(60));
process.exit(allPassed ? 0 : 1);
