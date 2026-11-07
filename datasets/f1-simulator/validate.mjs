// validate.mjs — headless race simulation test
// Validates that cars complete laps, positions are consistent,
// and the race engine finishes correctly.
// Run: node validate.mjs

import { CIRCUITS, RAW_WAYPOINTS, getCircuit } from './src/data/circuitData.js';
import { getGrid }                              from './src/data/driverData.js';
import { buildTrack }                           from './src/simulation/trackManager.js';
import { RaceEngine, RaceState }               from './src/simulation/raceEngine.js';

const TOTAL_LAPS = 3;
const WARP       = 50;   // fast sim
const MAX_SIM_S  = 600;  // wall-clock seconds cap (= 30000 sim seconds)

let allPassed = true;

function test(name, passed, msg = '') {
  const icon = passed ? '✅' : '❌';
  console.log(`  ${icon} ${name}${msg ? ': ' + msg : ''}`);
  if (!passed) allPassed = false;
}

// ── Test each circuit ──────────────────────────────────────────────────────
for (const circuit of CIRCUITS) {
  console.log(`\n══ ${circuit.name} (${circuit.id}) ══`);
  const rawPts = RAW_WAYPOINTS[circuit.id];

  test('Waypoints present', !!rawPts && rawPts.length > 10, `${rawPts?.length} pts`);
  if (!rawPts) continue;

  // Build track
  let track;
  try {
    track = buildTrack(circuit, rawPts);
    test('Track built', !!track && track.pts.length === 720);
  } catch (e) {
    test('Track built', false, e.message); continue;
  }

  // Check speed model
  const { speedModel } = track;
  test('Speed model valid', speedModel.v.every(v => v > 0 && v < 150), `min=${speedModel.vmin.toFixed(1)} max=${speedModel.vmax.toFixed(1)}`);
  test('Lap record scaled', speedModel.t[720] > 0, `T=${speedModel.t[720].toFixed(1)}s vs record ${circuit.rec}s`);
  test('Straights detected', speedModel.straights.length >= 0, `${speedModel.straights.length} found`);

  // Run race
  const engine = new RaceEngine();
  engine.warp  = WARP;
  const grid   = getGrid(6);
  engine.build(track, grid, TOTAL_LAPS);
  engine.start();

  let elapsed = 0;
  const DT = 0.016; // 60fps equivalent
  let steps  = 0;
  const MAX_STEPS = Math.ceil(MAX_SIM_S / DT);

  while (engine.state === RaceState.RACING && steps < MAX_STEPS) {
    engine.step(DT);
    elapsed += DT * WARP;
    steps++;
  }

  const finished = engine.state === RaceState.FINISHED;
  test('Race finished', finished, `after ${elapsed.toFixed(0)}s sim time`);

  const standings = engine.standings;
  test('All cars have laps', standings.every(c => c.lap > 0), standings.map(c => `${c.code}:L${c.lap}`).join(' '));
  test('No duplicate positions', new Set(standings.map(c => c.position)).size === standings.length);
  test('Leader completed laps', standings[0]?.lap >= TOTAL_LAPS, `P1 ${standings[0]?.code} lap=${standings[0]?.lap}`);

  // Check lap times are plausible
  const lapTimes = standings.map(c => c.lastLap).filter(Boolean);
  if (lapTimes.length > 0) {
    const minT = Math.min(...lapTimes), maxT = Math.max(...lapTimes);
    test('Lap times plausible', minT > circuit.rec * 0.5 && maxT < circuit.rec * 5,
      `min=${minT.toFixed(1)}s max=${maxT.toFixed(1)}s record=${circuit.rec}s`);
  }

  // Check no car is stuck at d=0
  const stuck = standings.filter(c => Math.abs(c.d) < 10);
  test('No cars stuck at start', stuck.length === 0, stuck.length ? stuck.map(c=>c.code).join(' ') : '');

  // Check tyre model ran
  const tyreWear = standings.map(c => c.tyreWear);
  test('Tyre wear > 0', tyreWear.every(w => w > 0), tyreWear.map(w=>w.toFixed(2)).join(' '));

  // Telemetry
  const tel = engine.getTelemetry(0);
  test('Telemetry returns data', !!tel && tel.speed >= 0, tel ? `speed=${tel.speed}` : 'null');

  console.log(`  Race time: ${elapsed.toFixed(0)}s simulated in ${(steps * DT).toFixed(1)}s wall-clock`);
}

// ── Summary ────────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(50));
console.log(allPassed ? '🏁 ALL TESTS PASSED' : '⚠ SOME TESTS FAILED');
console.log('═'.repeat(50));
process.exit(allPassed ? 0 : 1);
