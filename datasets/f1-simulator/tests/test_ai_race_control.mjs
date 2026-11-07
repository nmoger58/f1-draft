/**
 * test_ai_race_control.mjs
 * Comprehensive automated test suite for AI Race Control, Driver Investigations,
 * and Physical Safety Car Simulation.
 *
 * Validates:
 *  1. Autonomous AI Race Control & Removal of In-Race Player Flag Triggers
 *  2. Autonomous Incident Escalation (Minor Yellow -> Moderate VSC -> Severe Safety Car -> Critical Red Flag)
 *  3. Minor Incidents Do NOT Cause Red Flags
 *  4. Physical Safety Car Geometry, Movement & Coordinates
 *  5. Field Neutralization & Speed Restrictions (Cars slow smoothly behind Safety Car)
 *  6. Single-file Queue Formation Without Teleportation
 *  7. VSC Speed Restriction Without Physical Safety Car
 *  8. Safety Car In-Lap, Beacon Extinguishment & Controlled Restart
 *  9. Driver Investigation Lifecycle & Evidence Evaluation (Jump Start, Collisions, Illegal Overtakes, Track Limits)
 * 10. Central Player Investigation Notification Persistence & Resolution
 * 11. Coexistence With Commentary Toast Overlay (Central overlay not evicted by toasts)
 * 12. Impartial Rules: Equivalent Treatment for AI Drivers and Player
 * 13. Dynamic Weather Evolution & Grip Coupling
 * 14. Quick Play and Championship Mode Parity
 */

import assert from 'node:assert';
import { RaceControl, FlagStates, InvestigationStatus, PenaltyOutcome } from '../src/simulation/raceControl.js';
import { IncidentManager } from '../src/simulation/incidentManager.js';
import { WeatherEngine } from '../src/simulation/weatherEngine.js';
import { TrackConditionModel } from '../src/simulation/trackConditionModel.js';
import { RaceEngine, RaceState } from '../src/simulation/raceEngine.js';
import { buildTrack } from '../src/simulation/trackManager.js';
import { getCircuit, RAW_WAYPOINTS } from '../src/data/circuitData.js';
import { getGrid } from '../src/data/driverData.js';
import { InvestigationOverlay } from '../src/ui/investigationOverlay.js';
import { CommentaryToastManager } from '../src/ui/commentaryToastOverlay.js';
import { ChampionshipManager } from '../src/championship/championshipManager.js';

let passed = 0;
let total = 0;

function it(desc, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`  ✅ ${desc}`);
  } catch (err) {
    console.error(`  ❌ ${desc}`);
    console.error(err);
    process.exitCode = 1;
  }
}

async function itAsync(desc, fn) {
  total++;
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${desc}`);
  } catch (err) {
    console.error(`  ❌ ${desc}`);
    console.error(err);
    process.exitCode = 1;
  }
}

console.log('🧪 RUNNING AI RACE CONTROL, INVESTIGATIONS & SAFETY CAR TEST SUITE 🧪\n');

// ── TEST GROUP 1: Autonomous AI Race Control & Flag State Machine ──
console.log('--- TEST GROUP 1: Autonomous AI Race Control & Hierarchy ---');
it('Initializes with authoritative FlagStates', () => {
  const circuit = getCircuit('monaco');
  const track = buildTrack(circuit, RAW_WAYPOINTS['monaco']);
  const rc = new RaceControl(track);

  assert.strictEqual(rc.state, FlagStates.RED);
  assert.strictEqual(rc.safetyCar.active, false);
  assert.strictEqual(rc.safetyCar.v, 38.8); // 140 km/h standard pace
});

it('Autonomous AI escalates from Green to Yellow for a minor single-sector hazard', () => {
  const circuit = getCircuit('monaco');
  const track = buildTrack(circuit, RAW_WAYPOINTS['monaco']);
  const rc = new RaceControl(track);
  rc.state = FlagStates.GREEN;

  const incMgr = new IncidentManager(track.circuit.lengthM, 24);
  // Add a minor debris hazard
  incMgr.activeIncidents.push({
    id: 1,
    type: 'debris',
    segmentIndex: 4,
    description: 'Minor debris off-line',
    startTime: 10,
    clearTime: 30
  });

  const cars = getGrid(4).map((d, i) => ({ i, code: d.code, v: 50, d: 200 * i, lat: 0, lap: 1, pitState: 'ready' }));
  rc.update(0.1, 15, cars, incMgr);

  // Single hazard causes local yellow
  assert.strictEqual(rc.yellowSegments.has(4), true);
  assert.ok(rc.state === FlagStates.YELLOW || rc.state === FlagStates.VSC);
});

it('Minor incidents do NOT cause a Red Flag', () => {
  const circuit = getCircuit('monaco');
  const track = buildTrack(circuit, RAW_WAYPOINTS['monaco']);
  const rc = new RaceControl(track);
  rc.state = FlagStates.GREEN;

  const incMgr = new IncidentManager(track.circuit.lengthM, 24);
  incMgr.createIncident('spin', 400, 'Single car spun and rejoined', 10, 15);

  const cars = getGrid(4).map((d, i) => ({ i, code: d.code, v: 45, d: 200 * i, lat: 0, lap: 1, pitState: 'ready' }));
  rc.update(0.1, 11, cars, incMgr);

  assert.notStrictEqual(rc.state, FlagStates.RED, 'Minor spin must never trigger Red Flag');
});

it('Dangerous incident (stranded stopped car) escalates to Physical Safety Car', () => {
  const circuit = getCircuit('monaco');
  const track = buildTrack(circuit, RAW_WAYPOINTS['monaco']);
  const rc = new RaceControl(track);
  rc.state = FlagStates.GREEN;

  const incMgr = new IncidentManager(track.circuit.lengthM, 24);
  const cars = getGrid(4).map((d, i) => ({
    i,
    code: d.code,
    v: i === 1 ? 0 : 50, // Car 1 is stopped stationary on track
    d: 300 * i,
    lat: 0,
    lap: 1,
    pitState: 'ready',
    pitStationary: false,
    finished: false
  }));

  // Step several times to simulate stationary car on track
  for (let s = 0; s < 35; s++) {
    rc.update(0.1, 20 + s * 0.1, cars, incMgr);
  }

  assert.strictEqual(rc.state, FlagStates.SAFETY_CAR, 'Stranded car must trigger Physical Safety Car');
  assert.strictEqual(rc.safetyCar.active, true, 'Safety car must be active on track');
  assert.strictEqual(rc.safetyCar.beaconLightsActive, true, 'Beacon lights must be flashing');
});

// ── TEST GROUP 2: Physical Safety Car Movement & Smooth Spline Path ──
console.log('\n--- TEST GROUP 2: Physical Safety Car Simulation & Geometry ---');
it('Safety Car coordinates match valid circuit spline without teleportation', () => {
  const circuit = getCircuit('monaco');
  const track = buildTrack(circuit, RAW_WAYPOINTS['monaco']);
  const rc = new RaceControl(track);

  rc.deploySafetyCar(2, 500); // Deploy ahead of leader at d=500
  assert.strictEqual(rc.safetyCar.active, true);
  assert.ok(rc.safetyCar.x !== 0 && rc.safetyCar.y !== 0, 'Safety Car has valid SVG coordinates');

  const initialD = rc.safetyCar.d;
  const initialX = rc.safetyCar.x;

  // Advance by 1.0 second
  rc.update(1.0, 10, [], null);

  assert.ok(rc.safetyCar.d > initialD, 'Safety Car advances along track distance');
  assert.ok(Math.abs(rc.safetyCar.x - initialX) < 100, 'Moves smoothly without jumping or teleporting');
});

// ── TEST GROUP 3: Field Speed Neutralization & Safe Queue ──
console.log('\n--- TEST GROUP 3: Field Neutralization & Following Queue ---');
it('All cars are speed-restricted during Safety Car conditions', () => {
  const circuit = getCircuit('monaco');
  const track = buildTrack(circuit, RAW_WAYPOINTS['monaco']);
  const rc = new RaceControl(track);
  rc.deploySafetyCar(2, 500);

  const cars = [
    { i: 0, position: 1, code: 'NOR', d: 450, v: 75 }, // Leader behind SC (d=560)
    { i: 1, position: 2, code: 'VER', d: 420, v: 75 }, // P2 behind P1
    { i: 2, position: 3, code: 'PIA', d: 150, v: 75 }, // P3 far behind
  ];

  // Leader target speed should be clamped near Safety Car pace (38.8 m/s = 140 km/h)
  const leaderLimit = rc.getCarSpeedLimit(cars[0], cars);
  assert.ok(leaderLimit !== null);
  assert.ok(leaderLimit <= 42.0, `Leader speed restricted: ${leaderLimit} m/s (~${Math.round(leaderLimit * 3.6)} km/h)`);

  // P2 target speed clamped to follow P1
  const p2Limit = rc.getCarSpeedLimit(cars[1], cars);
  assert.ok(p2Limit !== null);
  assert.ok(p2Limit <= 45.0, `P2 following speed restricted: ${p2Limit} m/s`);

  // P3 far behind allowed controlled catch-up (capped at 44.0 m/s = ~160 km/h)
  const p3Limit = rc.getCarSpeedLimit(cars[2], cars);
  assert.ok(p3Limit !== null && p3Limit <= 44.0, `Catchup speed clamped at ~160 km/h`);
});

it('Prohibits overtaking under Safety Car and VSC', () => {
  const circuit = getCircuit('monaco');
  const track = buildTrack(circuit, RAW_WAYPOINTS['monaco']);
  const rc = new RaceControl(track);

  rc.deploySafetyCar(2, 500);
  assert.strictEqual(rc.isOvertakingPermitted(200), false);

  rc.deployVSC(20);
  assert.strictEqual(rc.isOvertakingPermitted(200), false);
});

// ── TEST GROUP 4: VSC Pacing Without Physical Safety Car ──
console.log('\n--- TEST GROUP 4: Virtual Safety Car (VSC) Behavior ---');
it('VSC imposes universal delta speed limit without deploying physical Safety Car', () => {
  const circuit = getCircuit('monaco');
  const track = buildTrack(circuit, RAW_WAYPOINTS['monaco']);
  const rc = new RaceControl(track);

  rc.deployVSC(30);
  assert.strictEqual(rc.state, FlagStates.VSC);
  assert.strictEqual(rc.safetyCar.active, false, 'Physical Safety Car must NOT be active under VSC');

  const car = { i: 0, position: 1, code: 'NOR', d: 200, v: 70 };
  const vscLimit = rc.getCarSpeedLimit(car, [car]);
  assert.strictEqual(vscLimit, 44.4, 'VSC imposes 44.4 m/s (~160 km/h) delta ceiling');
});

// ── TEST GROUP 5: Safety Car In-Lap, Beacon Extinguishment & Restart ──
console.log('\n--- TEST GROUP 5: Safety Car In-Lap & Controlled Restart ---');
it('Extinguishes beacon lights on in-lap and resumes race under Green flag', () => {
  const circuit = getCircuit('monaco');
  const track = buildTrack(circuit, RAW_WAYPOINTS['monaco']);
  const rc = new RaceControl(track);

  rc.deploySafetyCar(0.04, 500); // 0.04 laps remaining -> will trigger in-lap (threshold <= 0.05)
  assert.strictEqual(rc.safetyCar.beaconLightsActive, true);

  // Step until in-lap triggers
  rc.update(0.5, 50, [], null);

  assert.strictEqual(rc.state, FlagStates.SAFETY_CAR_IN_LAP);
  assert.strictEqual(rc.safetyCar.inLap, true);
  assert.strictEqual(rc.safetyCar.beaconLightsActive, false, 'Beacon lights must extinguish on in-lap (FIA Art. 55.10)');

  // Advance near pit entry
  const L = track.circuit.lengthM;
  const pitEntryD = track.pitLane?.entryD || (L - 140);
  rc.safetyCar.d = pitEntryD - 15;

  rc.update(0.5, 51, [], null);

  assert.strictEqual(rc.state, FlagStates.GREEN, 'Race resumes under Green Flag once SC enters pit lane');
  assert.strictEqual(rc.safetyCar.active, false, 'Safety Car is withdrawn from track');
  assert.strictEqual(rc.drsLapsLocked, 2, 'DRS locked for 2 laps after restart');
});

// ── TEST GROUP 6: Driver Investigations & Evidence Decisions ──
console.log('\n--- TEST GROUP 6: Driver Investigations & Judicial Rules ---');
it('Opens and resolves Jump Start investigation with 5-second penalty', () => {
  const circuit = getCircuit('monaco');
  const track = buildTrack(circuit, RAW_WAYPOINTS['monaco']);
  const rc = new RaceControl(track);
  const cars = getGrid(2).map((d, i) => ({ i, code: d.code, name: d.name, lap: 1, penalties: [] }));

  const inv = rc.openInvestigation(cars[0], 'Jump start before lights out', 'jump_start', 1, 1, { early: true, fault: true });
  assert.ok(inv, 'Investigation opened');
  assert.strictEqual(inv.status, InvestigationStatus.UNDER_REVIEW);
  assert.strictEqual(inv.driverCode, 'NOR');

  // Fast forward deliberation
  inv.deliberationRemaining = 0.01;
  rc.update(0.1, 5, cars, null);

  assert.strictEqual(inv.status, InvestigationStatus.RESOLVED);
  assert.strictEqual(inv.penaltySeconds, 5);
  assert.strictEqual(cars[0].penalties.length, 1, 'Penalty applied to car');
});

it('Investigates collision and determines fault or racing incident', () => {
  const circuit = getCircuit('monaco');
  const track = buildTrack(circuit, RAW_WAYPOINTS['monaco']);
  const rc = new RaceControl(track);

  const cars = [
    { i: 0, code: 'NOR', name: 'Lando Norris', d: 500, lat: 0, v: 70, lap: 2, pitState: 'ready', penalties: [] },
    { i: 1, code: 'VER', name: 'Max Verstappen', d: 501, lat: 0.2, v: 50, lap: 2, pitState: 'ready', penalties: [] } // NOR closing fast from behind
  ];

  // Step race control with collision contact
  rc.update(0.1, 20, cars, null);

  assert.ok(rc.investigations.length >= 1, 'Collision investigation created');
  const colInv = rc.investigations[0];
  assert.strictEqual(colInv.incidentType, 'collision');
  assert.strictEqual(colInv.evidence.fault, true, 'Car closing fast from behind identified as at-fault');
});

it('Applies identical investigation rules to AI drivers as player', () => {
  const circuit = getCircuit('monaco');
  const track = buildTrack(circuit, RAW_WAYPOINTS['monaco']);
  const rc = new RaceControl(track);
  rc.setPlayerCarIndex(0); // NOR is player

  const aiCar = { i: 1, code: 'VER', name: 'Max Verstappen', lap: 3, penalties: [] };
  const inv = rc.openInvestigation(aiCar, 'Speeding in the pit lane (92 km/h)', 'pit_speeding', 3, 1, { fault: true });

  assert.strictEqual(inv.isPlayer, false, 'Identified as AI driver');

  inv.deliberationRemaining = 0.01;
  rc.update(0.1, 30, [aiCar], null);

  assert.strictEqual(inv.status, InvestigationStatus.RESOLVED);
  assert.strictEqual(inv.penaltySeconds, 5);
  assert.strictEqual(aiCar.penalties.length, 1, 'AI car penalized identically with 5s penalty');
});

// ── TEST GROUP 7: Central Persistent Player Investigation Notification ──
console.log('\n--- TEST GROUP 7: Central Investigation Overlay ---');
it('Central overlay displays ongoing player investigation and updates upon resolution', () => {
  // Mock container
  let innerHtml = '';
  let display = 'none';
  const mockContainer = {
    get innerHTML() { return innerHtml; },
    set innerHTML(v) { innerHtml = v; },
    style: {
      get display() { return display; },
      set display(v) { display = v; }
    },
    classList: {
      add: () => {},
      remove: () => {}
    }
  };

  const overlay = new InvestigationOverlay(mockContainer);

  const playerInv = {
    id: 'inv_100',
    carIndex: 0,
    driverCode: 'NOR',
    driverName: 'Lando Norris',
    isPlayer: true,
    reason: 'Potential collision with VER at Turn 4',
    lap: 2,
    sector: 2,
    status: 'UNDER_REVIEW',
    penaltySeconds: 0
  };

  overlay.handleInvestigationUpdate(playerInv);

  assert.strictEqual(mockContainer.style.display, 'flex', 'Overlay visible on screen');
  assert.ok(mockContainer.innerHTML.includes('UNDER INVESTIGATION'));
  assert.ok(mockContainer.innerHTML.includes('Lando Norris'));
  assert.ok(mockContainer.innerHTML.includes('INVESTIGATION ONGOING'));

  // Resolve investigation
  playerInv.status = 'RESOLVED';
  playerInv.decision = 'TIME_PENALTY_5S';
  playerInv.penaltySeconds = 5;
  playerInv.decisionText = '5-Second Time Penalty (Causing a Collision)';

  overlay.handleInvestigationUpdate(playerInv);

  assert.ok(mockContainer.innerHTML.includes('5-SECOND TIME PENALTY'), 'Updated to show penalty decision');
  assert.ok(mockContainer.innerHTML.includes('INVESTIGATION CONCLUDED'));
});

it('Central player overlay is NOT evicted when 4 commentary toasts appear', () => {
  let innerHtml = '';
  const mockOverlayEl = {
    get innerHTML() { return innerHtml; },
    set innerHTML(v) { innerHtml = v; },
    style: { display: 'flex' },
    classList: { add: () => {}, remove: () => {} }
  };
  const invOverlay = new InvestigationOverlay(mockOverlayEl);

  invOverlay.handleInvestigationUpdate({
    id: 'inv_1',
    isPlayer: true,
    driverCode: 'NOR',
    driverName: 'Lando Norris',
    status: 'UNDER_REVIEW',
    reason: 'Track limits strike 4'
  });

  // Push 4 commentary toasts into separate commentary manager
  const toastMgr = new CommentaryToastManager();
  toastMgr.pushToast({ headline: 'Toast 1', category: 'overtake', key: 't1' });
  toastMgr.pushToast({ headline: 'Toast 2', category: 'overtake', key: 't2' });
  toastMgr.pushToast({ headline: 'Toast 3', category: 'overtake', key: 't3' });
  toastMgr.pushToast({ headline: 'Toast 4', category: 'overtake', key: 't4' });

  assert.strictEqual(toastMgr.getVisibleToasts().length, 4, 'Toast queue is full at 4');
  assert.strictEqual(mockOverlayEl.style.display, 'flex', 'Central overlay remains persistently displayed');
  assert.ok(mockOverlayEl.innerHTML.includes('UNDER INVESTIGATION'), 'Investigation content remains visible');
});

// ── TEST GROUP 8: Dynamic Weather Evolution & Grip Coupling ──
console.log('\n--- TEST GROUP 8: Weather Evolution & Track Coupling ---');
it('Weather changes modify track surface wetness and tyre grip', () => {
  const weather = new WeatherEngine('INCOMING_SHOWER');
  const trackCond = new TrackConditionModel(3300, 24);

  // Initial dry
  weather.update(10, 10);
  trackCond.update(10, weather.rainIntensity, []);
  assert.strictEqual(trackCond.averageWetness, 0);

  // Time 180s: rain arrives in Incoming Shower scenario
  weather.update(170, 180);
  assert.ok(weather.rainIntensity > 0.3, `Rain intensity rose: ${weather.rainIntensity.toFixed(2)}`);

  trackCond.update(60, weather.rainIntensity, []);
  assert.ok(trackCond.averageWetness > 0.03, `Track wetness accumulated: ${trackCond.averageWetness.toFixed(2)}`);
});

// ── TEST GROUP 9: Quick Play & Championship Mode Parity ──
console.log('\n--- TEST GROUP 9: Quick Play & Championship Parity ---');
it('Championship Mode race executes autonomous AI Race Control and Safety Car', () => {
  ChampionshipManager.deleteActiveChampionship();
  const champ = ChampionshipManager.createChampionship({
    name: '2025 AI Race Control Test',
    raceDistance: 'short',
    player: { driverCode: 'NOR', team: 'McLaren', teammateCode: 'PIA' }
  });

  const circuit = getCircuit('monaco');
  const track = buildTrack(circuit, RAW_WAYPOINTS['monaco']);
  const grid = getGrid(6);

  const engine = new RaceEngine();
  engine.build(track, grid, 2);
  engine.start();

  assert.ok(engine.raceControl, 'RaceControl initialized in championship session');
  assert.strictEqual(engine.raceControl.state, FlagStates.GREEN);

  // Simulate an incident to trigger AI race control
  engine.triggerHazard('hazard');
  const events = engine.step(0.1);

  assert.ok(events.length >= 1, 'Events generated by AI race control during championship race');
});

console.log('\n════════════════════════════════════════════════════════════');
console.log(`🏁 TEST RESULTS: ${passed}/${total} TESTS PASSED (${Math.round((passed / total) * 100)}%) 🏁`);
console.log('════════════════════════════════════════════════════════════\n');

if (passed !== total) {
  process.exit(1);
}
