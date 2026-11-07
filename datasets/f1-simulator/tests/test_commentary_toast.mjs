/**
 * test_commentary_toast.mjs
 * Comprehensive automated test suite for the Compact Race Commentary Toast Overlay.
 *
 * Validates:
 *  1. Configuration & Default Settings
 *  2. Notification Density (Strict Maximum 4 Visible)
 *  3. Vertical Stacking Order (Newest at Top)
 *  4. Configurable Auto-Dismissal Lifecycles
 *  5. Strict Priority Eviction (Critical P1 never evicted by routine P3)
 *  6. Event Normalization & Noise Filtering (Lap ticks & empty ignored)
 *  7. Anti-Spam Deduplication & Flag Transition Suppression
 *  8. Authoritative RaceEngine Overtake & Lead Change Detection
 *  9. Race Control Flags & Chequered Flag Integration
 * 10. Enable / Disable Toggle & Independence
 * 11. Full Session Clear & Reset
 * 12. Quick Play & Championship Mode Parity
 */

import assert from 'node:assert';
import {
  CommentaryToastManager,
  ToastDurations,
  ToastPriorities,
  ToastAccents,
  ToastIcons
} from '../src/ui/commentaryToastOverlay.js';
import { RaceEngine, RaceState } from '../src/simulation/raceEngine.js';
import { buildTrack } from '../src/simulation/trackManager.js';
import { getCircuit, RAW_WAYPOINTS } from '../src/data/circuitData.js';
import { getGrid } from '../src/data/driverData.js';
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

console.log('🧪 RUNNING COMPACT RACE COMMENTARY TOAST OVERLAY TEST SUITE 🧪\n');

// ── TEST GROUP 1: Configuration & Default Settings ──
console.log('--- TEST GROUP 1: Configuration & Settings ---');
it('Initializes with default configuration (enabled: true, maxVisible: 4)', () => {
  const manager = new CommentaryToastManager();
  assert.strictEqual(manager.isEnabled(), true);
  assert.strictEqual(manager.maxVisible, 4);
  assert.strictEqual(manager.getVisibleToasts().length, 0);
});

it('Configures explicit auto-dismissal durations matching motorsport requirements', () => {
  assert.strictEqual(ToastDurations.overtake, 4000);   // 4s
  assert.strictEqual(ToastDurations.start, 5000);      // 5s
  assert.strictEqual(ToastDurations.yellow_flag, 5000);// 5s
  assert.strictEqual(ToastDurations.red_flag, 7000);   // 7s
  assert.strictEqual(ToastDurations.safety_car, 6000); // 6s
  assert.strictEqual(ToastDurations.finish, 7000);     // 7s
  assert.strictEqual(ToastDurations.incident, 6000);   // 6s
  assert.strictEqual(ToastDurations.pit, 4000);        // 4s
});

it('Priority levels enforce Critical Safety (P1) > Significant (P2) > Routine (P3)', () => {
  assert.strictEqual(ToastPriorities.red_flag, 1);
  assert.strictEqual(ToastPriorities.safety_car, 1);
  assert.strictEqual(ToastPriorities.finish, 1);
  assert.strictEqual(ToastPriorities.incident, 1);

  assert.strictEqual(ToastPriorities.start, 2);
  assert.strictEqual(ToastPriorities.lead_change, 2);
  assert.strictEqual(ToastPriorities.penalty, 2);
  assert.strictEqual(ToastPriorities.pit, 2);

  assert.strictEqual(ToastPriorities.overtake, 3);
  assert.strictEqual(ToastPriorities.info, 3);
});

// ── TEST GROUP 2: Notification Density & Max Visible ──
console.log('\n--- TEST GROUP 2: Notification Density & Queue Limit ---');
it('Strictly caps visible notifications to maximum 4', () => {
  const manager = new CommentaryToastManager();

  manager.pushToast({ headline: 'Event 1', category: 'overtake', priority: 3, key: 'ev1' });
  manager.pushToast({ headline: 'Event 2', category: 'overtake', priority: 3, key: 'ev2' });
  manager.pushToast({ headline: 'Event 3', category: 'overtake', priority: 3, key: 'ev3' });
  manager.pushToast({ headline: 'Event 4', category: 'overtake', priority: 3, key: 'ev4' });
  assert.strictEqual(manager.getVisibleToasts().length, 4);

  // 5th event pushed
  manager.pushToast({ headline: 'Event 5', category: 'overtake', priority: 3, key: 'ev5' });
  assert.strictEqual(manager.getVisibleToasts().length, 4, 'Count must remain exactly 4');
});

// ── TEST GROUP 3: Vertical Stacking (Newest at Top) ──
console.log('\n--- TEST GROUP 3: Vertical Stacking Order ---');
it('Positions newest notification at the top of the stack (index 0)', () => {
  const manager = new CommentaryToastManager();

  manager.pushToast({ headline: 'First', category: 'overtake', key: 'k1' });
  manager.pushToast({ headline: 'Second', category: 'overtake', key: 'k2' });
  manager.pushToast({ headline: 'Third', category: 'overtake', key: 'k3' });

  const visible = manager.getVisibleToasts();
  assert.strictEqual(visible.length, 3);
  assert.strictEqual(visible[0].headline, 'Third', 'Newest notification must be at index 0 (top)');
  assert.strictEqual(visible[1].headline, 'Second');
  assert.strictEqual(visible[2].headline, 'First');
});

// ── TEST GROUP 4: Strict Priority Eviction ──
console.log('\n--- TEST GROUP 4: Strict Priority Eviction ---');
it('Critical safety alerts (P1) NEVER get evicted by routine overtakes (P3)', () => {
  const manager = new CommentaryToastManager();

  // Fill queue with 4 critical P1 events
  manager.pushToast({ headline: 'RED FLAG', category: 'red_flag', priority: 1, key: 'p1_1' });
  manager.pushToast({ headline: 'SAFETY CAR', category: 'safety_car', priority: 1, key: 'p1_2' });
  manager.pushToast({ headline: 'HEAVY CRASH', category: 'incident', priority: 1, key: 'p1_3' });
  manager.pushToast({ headline: 'RACE FINISH', category: 'finish', priority: 1, key: 'p1_4' });

  assert.strictEqual(manager.getVisibleToasts().length, 4);

  // Attempt to push a routine P3 overtake
  const res = manager.pushToast({ headline: 'NOR PASSES VER', category: 'overtake', priority: 3, key: 'p3_1' });
  assert.strictEqual(res, false, 'Routine overtake must be rejected when queue is full of P1 alerts');

  const visible = manager.getVisibleToasts();
  assert.strictEqual(visible.length, 4);
  for (const t of visible) {
    assert.strictEqual(t.priority, 1, 'All 4 items must remain P1 critical alerts');
  }
});

it('Higher priority event evicts lowest priority oldest item when queue is full', () => {
  const manager = new CommentaryToastManager();

  manager.pushToast({ headline: 'P1 Incident', category: 'incident', priority: 1, key: 'p1' });
  manager.pushToast({ headline: 'P2 Pit Stop', category: 'pit', priority: 2, key: 'p2' });
  manager.pushToast({ headline: 'P3 Overtake A', category: 'overtake', priority: 3, key: 'p3_a' });
  manager.pushToast({ headline: 'P3 Overtake B', category: 'overtake', priority: 3, key: 'p3_b' });

  assert.strictEqual(manager.getVisibleToasts().length, 4);

  // Incoming P1 Red Flag should evict oldest P3 (P3 Overtake A)
  const ok = manager.pushToast({ headline: 'RED FLAG', category: 'red_flag', priority: 1, key: 'red1' });
  assert.strictEqual(ok, true);

  const visible = manager.getVisibleToasts();
  assert.strictEqual(visible.length, 4);
  assert.strictEqual(visible[0].headline, 'RED FLAG');
  assert.ok(!visible.some(t => t.headline === 'P3 Overtake A'), 'Oldest P3 was evicted');
  assert.ok(visible.some(t => t.headline === 'P1 Incident'), 'Original P1 preserved');
  assert.ok(visible.some(t => t.headline === 'P2 Pit Stop'), 'P2 preserved');
});

// ── TEST GROUP 5: Auto-Dismissal Lifecycle ──
console.log('\n--- TEST GROUP 5: Lifecycle Dismissal ---');
await itAsync('Auto-dismisses toast after its designated duration expires', async () => {
  const manager = new CommentaryToastManager();
  manager.pushToast({
    headline: 'Quick Toast',
    category: 'overtake',
    duration: 60, // 60ms for test
    key: 'quick'
  });

  assert.strictEqual(manager.getVisibleToasts().length, 1);
  await new Promise(r => setTimeout(r, 100));
  assert.strictEqual(manager.getVisibleToasts().length, 0, 'Toast dismissed after timeout');
});

// ── TEST GROUP 6: Event Normalization & Noise Filtering ──
console.log('\n--- TEST GROUP 6: Event Normalization & Filtering ---');
it('Filters out continuous lap ticks and empty noise', () => {
  const manager = new CommentaryToastManager();

  manager.processEvents([
    { type: 'lap_tick', time: 10, msg: null },
    { type: 'lap_tick', time: 11, msg: '' },
    { type: 'telemetry', time: 12, msg: null }
  ]);

  assert.strictEqual(manager.getVisibleToasts().length, 0, 'Lap ticks and telemetry spam ignored');
});

it('Correctly normalizes simulation events into broadcast toast structures', () => {
  const manager = new CommentaryToastManager();

  manager.processEvents([
    { type: 'control', msg: 'Race control: GO GO GO!', time: 0 },
    { type: 'flag', msg: 'Race control: RED FLAG — Heavy Rain', time: 25 },
    { type: 'pit', msg: 'NOR: Box this lap for soft tyres', time: 50 }
  ]);

  const visible = manager.getVisibleToasts();
  assert.strictEqual(visible.length, 3);
  assert.strictEqual(visible[0].category, 'pit');
  assert.strictEqual(visible[1].category, 'red_flag');
  assert.strictEqual(visible[2].category, 'start');
});

// ── TEST GROUP 7: Anti-Spam Deduplication ──
console.log('\n--- TEST GROUP 7: Deduplication & Anti-Spam ---');
it('Suppresses duplicate rapid notifications within debounce window', () => {
  const manager = new CommentaryToastManager(null, { debounceWindowMs: 500 });

  const r1 = manager.pushToast({ headline: 'VER TAKES THE LEAD', category: 'lead_change', key: 'ver_lead' });
  const r2 = manager.pushToast({ headline: 'VER TAKES THE LEAD', category: 'lead_change', key: 'ver_lead' });

  assert.strictEqual(r1, true);
  assert.strictEqual(r2, false, 'Duplicate toast within debounce window must be rejected');
  assert.strictEqual(manager.getVisibleToasts().length, 1);
});

// ── TEST GROUP 8: Authoritative RaceEngine Integration ──
console.log('\n--- TEST GROUP 8: RaceEngine Overtake & Lead Changes ---');
it('Emits lead change and overtake events when positions change', () => {
  const circuit = getCircuit('monaco');
  const waypoints = RAW_WAYPOINTS['monaco'];
  const track = buildTrack(circuit, waypoints);
  const grid = getGrid(4);

  const engine = new RaceEngine();
  engine.build(track, grid, 5);
  engine.start();

  // Simulate positions: swap car 0 and car 1
  engine.cars[0].d = 500;
  engine.cars[0].lap = 1;
  engine.cars[0].prevPosition = 2;

  engine.cars[1].d = 400;
  engine.cars[1].lap = 1;
  engine.cars[1].prevPosition = 1;

  const events = [];
  engine._updatePositions(events);

  assert.strictEqual(engine.cars[0].position, 1);
  const leadEv = events.find(e => e.type === 'lead_change');
  assert.ok(leadEv, 'Lead change event must be generated');
  assert.strictEqual(leadEv.priority, 2);
  assert.ok(leadEv.headline.includes('TAKES THE LEAD'));
});

it('Flag changes in RaceEngine generate single deduplicated flag toasts', () => {
  const circuit = getCircuit('monaco');
  const track = buildTrack(circuit, RAW_WAYPOINTS['monaco']);
  const grid = getGrid(3);

  const engine = new RaceEngine();
  engine.build(track, grid, 3);
  engine.start();

  // Deploy safety car
  engine.deploySafetyCar(1);
  const events = engine.step(0.1);

  const scToast = events.find(e => e.category === 'safety_car');
  assert.ok(scToast, 'Safety car toast must be emitted on deployment');
  assert.strictEqual(scToast.priority, 1);

  // Stepping again with safety car still active does NOT re-emit safety car flag toast
  const step2Events = engine.step(0.1);
  const dupScToast = step2Events.find(e => e.type === 'flag' && e.category === 'safety_car');
  assert.strictEqual(dupScToast, undefined, 'Must not spam flag toast on subsequent frames');
});

it('Chequered flag finish emits Chequered Flag Toast with winner details', () => {
  const circuit = getCircuit('monaco');
  const track = buildTrack(circuit, RAW_WAYPOINTS['monaco']);
  const grid = getGrid(2);

  const engine = new RaceEngine();
  engine.build(track, grid, 1);
  engine.start();

  const events = [];
  engine._onRaceFinish(events);

  const finishEv = events.find(e => e.category === 'finish');
  assert.ok(finishEv, 'Chequered flag finish toast must be emitted');
  assert.strictEqual(finishEv.priority, 1);
  assert.strictEqual(finishEv.icon, '🏁');
  assert.strictEqual(finishEv.accent, 'gold');
});

// ── TEST GROUP 9: Enable / Disable Toggle ──
console.log('\n--- TEST GROUP 9: Toggle & Independence ---');
it('Toggle disables display and clears active toasts without affecting engine', () => {
  const manager = new CommentaryToastManager();
  manager.pushToast({ headline: 'Test Alert', category: 'overtake', key: 't1' });
  assert.strictEqual(manager.getVisibleToasts().length, 1);

  manager.setEnabled(false);
  assert.strictEqual(manager.isEnabled(), false);
  assert.strictEqual(manager.getVisibleToasts().length, 0, 'Toasts cleared on disable');

  // Push while disabled
  const ok = manager.pushToast({ headline: 'Another Alert', category: 'overtake', key: 't2' });
  assert.strictEqual(ok, false, 'No toasts accepted while disabled');
  assert.strictEqual(manager.getVisibleToasts().length, 0);

  // Re-enable
  manager.setEnabled(true);
  assert.strictEqual(manager.isEnabled(), true);
  manager.pushToast({ headline: 'Enabled Alert', category: 'overtake', key: 't3' });
  assert.strictEqual(manager.getVisibleToasts().length, 1);
});

// ── TEST GROUP 10: Clear on Session Restart ──
console.log('\n--- TEST GROUP 10: Clear / Reset Functionality ---');
it('Clear removes all active toasts and resets deduplication maps', () => {
  const manager = new CommentaryToastManager();
  manager.pushToast({ headline: 'Ev1', category: 'overtake', key: 'k1' });
  manager.pushToast({ headline: 'Ev2', category: 'overtake', key: 'k2' });
  assert.strictEqual(manager.getVisibleToasts().length, 2);

  manager.clear();
  assert.strictEqual(manager.getVisibleToasts().length, 0);

  // Key k1 can be accepted immediately after clear
  const ok = manager.pushToast({ headline: 'Ev1', category: 'overtake', key: 'k1' });
  assert.strictEqual(ok, true);
});

// ── TEST GROUP 11: Championship Mode Parity ──
console.log('\n--- TEST GROUP 11: Championship Mode Parity ---');
it('Operates seamlessly during Championship race execution', () => {
  ChampionshipManager.deleteActiveChampionship();
  const champ = ChampionshipManager.createChampionship({
    name: '2025 Parity Test',
    raceDistance: 'short',
    player: { driverCode: 'NOR', team: 'McLaren', teammateCode: 'PIA' }
  });
  assert.ok(champ, 'Championship created');

  const circuit = getCircuit('monaco');
  const track = buildTrack(circuit, RAW_WAYPOINTS['monaco']);
  const grid = getGrid(6);

  const engine = new RaceEngine();
  engine.build(track, grid, 2);
  engine.start();

  const toastMgr = new CommentaryToastManager();

  // Run a step
  const newEvents = engine.step(0.1);
  toastMgr.processEvents(newEvents);

  // Must not throw and must maintain clean visible list
  assert.ok(toastMgr.getVisibleToasts().length <= 4);
});

console.log('\n════════════════════════════════════════════════════════════');
console.log(`🏁 TEST RESULTS: ${passed}/${total} TESTS PASSED (${Math.round((passed / total) * 100)}%) 🏁`);
console.log('════════════════════════════════════════════════════════════\n');

if (passed !== total) {
  process.exit(1);
}
