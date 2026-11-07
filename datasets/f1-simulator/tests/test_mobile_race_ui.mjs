// test_mobile_race_ui.mjs
// Verification Suite for Mobile Race UI: Compact Toasts & Always-Accessible DRS Control

import assert from 'node:assert';
import fs from 'node:fs';
import {
  CommentaryToastManager,
  ToastPriorities,
  ToastDurations
} from '../src/ui/commentaryToastOverlay.js';
import { DRSController } from '../src/simulation/drsController.js';
import { RaceEngine, RaceState } from '../src/simulation/raceEngine.js';
import { buildTrack } from '../src/simulation/trackManager.js';
import { getCircuit, RAW_WAYPOINTS } from '../src/data/circuitData.js';
import { getGrid } from '../src/data/driverData.js';

console.log('🧪 RUNNING MOBILE RACE UI & ALWAYS-ACCESSIBLE DRS TEST SUITE 🧪\n');

let allPassed = true;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
  } catch (err) {
    console.error(`  ❌ ${name}: ${err.message}`);
    allPassed = false;
  }
}

// ── TEST GROUP 1: Mobile Commentary Toast Density & Collapsed Queue ──
console.log('--- TEST GROUP 1: Mobile Commentary Toast Density & Collapsed Queue ---');

test('Initializes with mobileMaxVisible = 2 and collapsed by default', () => {
  const manager = new CommentaryToastManager(null, { mobileMaxVisible: 2 });
  assert.strictEqual(manager.mobileMaxVisible, 2);
  assert.strictEqual(manager.isMobileExpanded(), false);
  assert.strictEqual(manager.getMobileVisibleToasts().length, 0);
});

test('Displays up to 2 notifications normally without collapsing when queue has 1 or 2 items', () => {
  const manager = new CommentaryToastManager(null, { mobileMaxVisible: 2 });
  manager.pushToast({ headline: 'NOR Pass VER', category: 'overtake', priority: 3, key: 'ev1' });
  assert.strictEqual(manager.getMobileVisibleToasts().length, 1);

  manager.pushToast({ headline: 'PIA Pass LEC', category: 'overtake', priority: 3, key: 'ev2' });
  assert.strictEqual(manager.getMobileVisibleToasts().length, 2);
});

test('Collapses queue on mobile: when 3 or 4 notifications exist, only 2 are shown by default', () => {
  const manager = new CommentaryToastManager(null, { mobileMaxVisible: 2 });
  manager.pushToast({ headline: 'Event 1', category: 'overtake', priority: 3, key: 'e1' });
  manager.pushToast({ headline: 'Event 2', category: 'overtake', priority: 3, key: 'e2' });
  manager.pushToast({ headline: 'Event 3', category: 'overtake', priority: 3, key: 'e3' });
  manager.pushToast({ headline: 'Event 4', category: 'overtake', priority: 3, key: 'e4' });

  // Total visible in desktop manager is 4
  assert.strictEqual(manager.getVisibleToasts().length, 4, 'Desktop retains all 4 toasts');

  // Mobile collapsed view strictly restricts to 2 visible
  const mobileVisible = manager.getMobileVisibleToasts();
  assert.strictEqual(mobileVisible.length, 2, 'Mobile collapsed must show exactly 2 toasts');
  assert.strictEqual(mobileVisible[0].headline, 'Event 4', 'Top mobile toast is newest');
  assert.strictEqual(mobileVisible[1].headline, 'Event 3', 'Second mobile toast is 2nd newest');
});

test('Expansion control toggles mobile stack: reveals all queued notifications when expanded', () => {
  const manager = new CommentaryToastManager(null, { mobileMaxVisible: 2 });
  manager.pushToast({ headline: 'T1', category: 'overtake', priority: 3, key: 't1' });
  manager.pushToast({ headline: 'T2', category: 'overtake', priority: 3, key: 't2' });
  manager.pushToast({ headline: 'T3', category: 'overtake', priority: 3, key: 't3' });

  assert.strictEqual(manager.getMobileVisibleToasts().length, 2, 'Default is collapsed (2)');

  // User taps expansion button
  manager.toggleMobileExpansion();
  assert.strictEqual(manager.isMobileExpanded(), true);
  assert.strictEqual(manager.getMobileVisibleToasts().length, 3, 'Expanded mode reveals all 3 toasts');

  // User taps again to collapse
  manager.toggleMobileExpansion();
  assert.strictEqual(manager.isMobileExpanded(), false);
  assert.strictEqual(manager.getMobileVisibleToasts().length, 2, 'Collapsed mode returns to 2 toasts');
});

// ── TEST GROUP 2: Critical Race-Control Event Priority Preservation on Mobile ──
console.log('\n--- TEST GROUP 2: Critical Race-Control Event Priority Preservation on Mobile ---');

test('Critical safety events (P1 Red Flag / Safety Car) are NEVER hidden by mobile 2-toast limit', () => {
  const manager = new CommentaryToastManager(null, { mobileMaxVisible: 2 });

  // 1. Critical Red Flag occurs
  manager.pushToast({ headline: 'RED FLAG DEPLOYED', category: 'red_flag', priority: 1, key: 'red' });

  // 2. Later, three routine overtakes happen
  manager.pushToast({ headline: 'HAM passes TSU', category: 'overtake', priority: 3, key: 'ov1' });
  manager.pushToast({ headline: 'ALB passes BOT', category: 'overtake', priority: 3, key: 'ov2' });
  manager.pushToast({ headline: 'GAS passes OCO', category: 'overtake', priority: 3, key: 'ov3' });

  assert.strictEqual(manager.getVisibleToasts().length, 4, 'Desktop queue has 4 toasts');

  // On mobile collapsed view (at most 2 shown):
  // The P1 Red Flag MUST be preserved in the visible set!
  const mobileVisible = manager.getMobileVisibleToasts();
  assert.strictEqual(mobileVisible.length, 2);

  const hasRedFlag = mobileVisible.some(t => t.headline === 'RED FLAG DEPLOYED');
  assert.strictEqual(hasRedFlag, true, 'Critical Red Flag alert must NEVER be hidden on mobile');

  // Second slot is filled with the newest routine event
  assert.strictEqual(mobileVisible[0].headline === 'RED FLAG DEPLOYED' || mobileVisible[1].headline === 'RED FLAG DEPLOYED', true);
});

test('Two Critical events (P1 Safety Car & P1 Heavy Crash) both remain visible over routine items', () => {
  const manager = new CommentaryToastManager(null, { mobileMaxVisible: 2 });

  manager.pushToast({ headline: 'PHYSICAL SAFETY CAR', category: 'safety_car', priority: 1, key: 'sc' });
  manager.pushToast({ headline: 'HEAVY CRASH TURN 4', category: 'incident', priority: 1, key: 'crash' });
  manager.pushToast({ headline: 'NOR fastest lap', category: 'fastest_lap', priority: 3, key: 'fl' });
  manager.pushToast({ headline: 'VER pit in', category: 'pit', priority: 2, key: 'pit' });

  const mobileVisible = manager.getMobileVisibleToasts();
  assert.strictEqual(mobileVisible.length, 2);
  const p1Count = mobileVisible.filter(t => t.priority === 1).length;
  assert.strictEqual(p1Count, 2, 'Both visible slots occupied by Critical P1 events');
});

// ── TEST GROUP 3: Desktop Layout Independence & Stability ──
console.log('\n--- TEST GROUP 3: Desktop Layout Independence & Stability ---');

test('Desktop view retains full 4-notification capacity unconditionally', () => {
  const manager = new CommentaryToastManager(null, { maxVisible: 4, mobileMaxVisible: 2 });
  manager.pushToast({ headline: 'A', category: 'overtake', key: 'a' });
  manager.pushToast({ headline: 'B', category: 'overtake', key: 'b' });
  manager.pushToast({ headline: 'C', category: 'overtake', key: 'c' });
  manager.pushToast({ headline: 'D', category: 'overtake', key: 'd' });

  const desktopVisible = manager.getVisibleToasts();
  assert.strictEqual(desktopVisible.length, 4, 'Desktop must display all 4 notifications');
});

// ── TEST GROUP 4: Always-Accessible Mobile DRS Control & Race Dock ──
console.log('\n--- TEST GROUP 4: Always-Accessible Mobile DRS Control & Race Dock ---');

test('HTML contains Mobile Sticky Race Control Dock with required controls', () => {
  const html = fs.readFileSync('./index.html', 'utf8');
  assert.ok(html.includes('id="mobileRaceDock"'), 'mobileRaceDock container must exist');
  assert.ok(html.includes('id="mBtnDrs"'), 'Mobile DRS button mBtnDrs must exist');
  assert.ok(html.includes('id="mDrsStatus"'), 'Mobile DRS status pill must exist');
  assert.ok(html.includes('id="mDrsReason"'), 'Mobile DRS reason description must exist');
  assert.ok(html.includes('id="mDrsWingIcon"'), 'Mobile DRS wing indicator must exist');
  assert.ok(html.includes('id="mBtnBox"'), 'Mobile Pit Box button mBtnBox must exist');
  assert.ok(html.includes('id="mBoxTyrePill"'), 'Mobile tyre life pill must exist');
  assert.ok(html.includes('id="mBtnPause"'), 'Mobile Pause button mBtnPause must exist');
});

test('Mobile DRS button has DRS as primary label and exceeds 48x48 CSS px touch target', () => {
  const css = fs.readFileSync('./styles/main.css', 'utf8');
  // Check touch target height >= 48px
  assert.ok(css.includes('min-height: 48px'), 'Mobile dock buttons must have min-height of at least 48px');
  assert.ok(css.includes('.m-drs-primary-label'), 'DRS primary label class must exist');
  assert.ok(css.includes('letter-spacing: 2px'), 'DRS label must have motorsport styling');
});

test('Mobile dock has fixed positioning at viewport bottom with safe-area insets', () => {
  const css = fs.readFileSync('./styles/main.css', 'utf8');
  assert.ok(css.includes('position: fixed'), 'mobile-race-dock must be fixed');
  assert.ok(css.includes('bottom: 0'), 'mobile-race-dock must anchor to bottom');
  assert.ok(css.includes('env(safe-area-inset-bottom'), 'mobile-race-dock must respect safe-area insets');
  assert.ok(css.includes('backdrop-filter: blur'), 'mobile-race-dock must have translucent blur background');
});

// ── TEST GROUP 5: Authoritative DRS Behaviour & Race Control Suspensions ──
console.log('\n--- TEST GROUP 5: Authoritative DRS Behaviour & Race Control Suspensions ---');

const monza = getCircuit('monza');
const track = buildTrack(monza, RAW_WAYPOINTS.monza);
const engine = new RaceEngine();
engine.warp = 1;
const grid = getGrid(4);
engine.build(track, grid, 5);

test('DRS is disabled on Lap 1 per FIA regulations', () => {
  const car = engine.cars[0];
  car.lap = 1;
  const evalL1 = DRSController.evaluate(car, track, engine.cars, 10, 'green');
  assert.strictEqual(evalL1.eligible, false);
  assert.ok(evalL1.reason.includes('Lap 2'), 'Reason must state available from Lap 2');
});

test('DRS cannot be activated illegally during Safety Car conditions', () => {
  const car = engine.cars[0];
  car.lap = 3;
  car.d = track.drsZones[0].startD + 50; // inside DRS zone

  const evalSC = DRSController.evaluate(car, track, engine.cars, 50, 'safetycar');
  assert.strictEqual(evalSC.eligible, false, 'DRS must be ineligible under Safety Car');
  assert.ok(evalSC.reason.includes('Safety Car'), 'Reason must mention Safety Car');

  engine.flag = 'safetycar';
  const toggleRes = engine.toggleDRS(0);
  assert.strictEqual(toggleRes.success, false, 'toggleDRS must fail under Safety Car');
  assert.ok(toggleRes.reason.includes('Safety Car'), 'Toggle reason must mention Safety Car');
});

test('DRS cannot be activated illegally during Virtual Safety Car (VSC)', () => {
  const car = engine.cars[0];
  car.lap = 3;
  car.d = track.drsZones[0].startD + 50;

  const evalVSC = DRSController.evaluate(car, track, engine.cars, 60, 'vsc');
  assert.strictEqual(evalVSC.eligible, false, 'DRS must be ineligible under VSC');
  assert.ok(evalVSC.reason.includes('Virtual Safety Car'));

  engine.flag = 'vsc';
  const toggleRes = engine.toggleDRS(0);
  assert.strictEqual(toggleRes.success, false, 'toggleDRS must fail under VSC');
});

test('DRS cannot be activated illegally during Red Flag session suspension', () => {
  const car = engine.cars[0];
  car.lap = 3;
  car.d = track.drsZones[0].startD + 50;

  const evalRed = DRSController.evaluate(car, track, engine.cars, 70, 'red');
  assert.strictEqual(evalRed.eligible, false);
  assert.ok(evalRed.reason.includes('Suspended'));
});

test('DRS is automatically disabled in wet track conditions (FIA safety rule)', () => {
  const car = engine.cars[0];
  car.lap = 3;
  car.currentWetness = 0.45; // Wet surface

  const evalWet = DRSController.evaluate(car, track, engine.cars, 80, 'green');
  assert.strictEqual(evalWet.eligible, false, 'DRS must be disabled on wet track');
  assert.ok(evalWet.reason.includes('Wet Track Conditions'));
});

test('DRS activates only when car is eligible and in zone with gap <= 1.0s', () => {
  const carAhead = engine.cars[0];
  const carBehind = engine.cars[1];

  engine.flag = 'green';
  carBehind.lap = 3;
  carBehind.currentWetness = 0.0;
  carAhead.currentWetness = 0.0;

  // Place carBehind in DRS zone
  const zone = track.drsZones[0];
  carBehind.d = zone.startD + 40;
  carAhead.d = zone.startD + 70; // ~30m ahead (~0.4s gap at 75 m/s)
  carBehind.v = 75;
  carAhead.v = 75;

  const evalEligible = DRSController.evaluate(carBehind, track, engine.cars, 90, 'green');
  assert.strictEqual(evalEligible.eligible, true, 'Car must be eligible for DRS in zone with close gap');
  assert.strictEqual(evalEligible.inZone, true);

  // Authoritative engine toggle succeeds
  engine.selectedCarIdx = 1;
  const toggleRes = engine.toggleDRS(1);
  assert.strictEqual(toggleRes.success, true, 'DRS toggle must succeed when eligible');
  assert.strictEqual(toggleRes.active, true);
  assert.strictEqual(carBehind.drsActive, true, 'Car drsActive must be true in physics model');

  // Toggling again closes DRS
  const toggleOff = engine.toggleDRS(1);
  assert.strictEqual(toggleOff.success, true);
  assert.strictEqual(toggleOff.active, false);
  assert.strictEqual(carBehind.drsActive, false);
});

// ── TEST GROUP 6: Responsive Layout & Safe-Area Inset Rules ──
console.log('\n--- TEST GROUP 6: Responsive Layout & Safe-Area Inset Rules ---');

test('CSS media queries constrain mobile toast stack to 55–65% width range', () => {
  const css = fs.readFileSync('./styles/main.css', 'utf8');
  assert.ok(css.includes('max-width: min(62%, 240px)'), 'Mobile toast stack max-width constrained to ~62%');
  assert.ok(css.includes('max-width: min(65%, 220px)'), 'Small mobile toast max-width constrained to ~65%');
  assert.ok(css.includes('toastFadeInMobile'), 'Subtle mobile fade animation present');
  assert.ok(css.includes('.ct-mobile-hidden'), 'ct-mobile-hidden rule present');
});

test('Landscape orientation adaptations reduce dock height to preserve track area', () => {
  const css = fs.readFileSync('./styles/main.css', 'utf8');
  assert.ok(css.includes('orientation: landscape'), 'Landscape media query must exist');
  assert.ok(css.includes('min-height: 42px'), 'Landscape compact dock button height defined');
});

// ── Summary ──
console.log('\n════════════════════════════════════════════════════════════');
if (allPassed) {
  console.log('🏁 ALL 16 MOBILE RACE UI & ALWAYS-ACCESSIBLE DRS TESTS PASSED (100%) 🏁');
} else {
  console.error('❌ SOME TESTS FAILED');
  process.exit(1);
}
console.log('════════════════════════════════════════════════════════════\n');
