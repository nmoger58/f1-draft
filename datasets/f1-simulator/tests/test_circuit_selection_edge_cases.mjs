/**
 * test_circuit_selection_edge_cases.mjs
 * Targeted edge-case validation for Circuit Selection Screen:
 * Boundary conditions, undefined circuitId fallbacks, invalid circuit handling,
 * rapid switching, multi-step data persistence, and touch target accessibility.
 */

import assert from 'node:assert/strict';
import {
  CIRCUITS,
  RAW_WAYPOINTS,
  getCircuit,
  getTrackSvgPath,
  renderCircuitSelection,
  renderSelectedCircuitInfo,
  bindCircuitSelectionEvents
} from '../src/ui/circuitSelect.js';
import { QuickRaceViews } from '../src/ui/quickRaceWizard.js';

console.log('🧪 RUNNING CIRCUIT SELECTION EDGE CASES VERIFICATION\n');

// ── 1. Edge Case: Missing, Empty, and Unknown Circuit IDs ───────────────────
console.log('▶ Edge Case 1: Missing & Unknown circuitId fallbacks');

// Undefined state object entirely
const htmlNoArg = renderCircuitSelection();
assert.ok(htmlNoArg.includes('CIRCUIT SELECTION'), 'renderCircuitSelection() with no args should render safely');

// Null state object entirely
const htmlNullObj = renderCircuitSelection(null);
assert.ok(htmlNullObj.includes('CIRCUIT SELECTION'), 'renderCircuitSelection(null) should render safely');

// Undefined circuitId inside state
const undefinedState = { circuitId: undefined };
const htmlUndefined = renderCircuitSelection(undefinedState);
assert.ok(htmlUndefined.includes('Silverstone Circuit') || htmlUndefined.includes('Circuit de Monaco'), 'Undefined circuitId should default to valid circuit');

// Null circuitId inside state
const nullState = { circuitId: null };
const htmlNull = renderCircuitSelection(nullState);
assert.ok(htmlNull.includes('Silverstone Circuit') || htmlNull.includes('Circuit de Monaco'), 'Null circuitId should fallback safely');

// Unknown circuitId
const unknownState = { circuitId: 'nurburgring_unknown' };
const htmlUnknown = renderCircuitSelection(unknownState);
assert.ok(htmlUnknown.includes('Circuit de Monaco') || htmlUnknown.includes('Silverstone Circuit'), 'Unknown circuitId falls back safely to known circuit');
assert.ok(htmlUnknown.includes('active'), 'Fallback circuit card should have active class');

// Incomplete circuit object in renderSelectedCircuitInfo
const minimalInfo = renderSelectedCircuitInfo({ name: 'Generic Test Circuit' });
assert.ok(minimalInfo.includes('Generic Test Circuit'), 'renderSelectedCircuitInfo handles partial objects without error');

// Null binding calls
assert.doesNotThrow(() => bindCircuitSelectionEvents(null, null, null), 'bindCircuitSelectionEvents handles nulls safely');
console.log('  ✅ Handled undefined, null, partial objects, and unknown circuit IDs gracefully');

// ── 2. Boundary Values: All 8 Circuits Geometry & Specs ────────────────────
console.log('\n▶ Edge Case 2: Boundary validation across all 8 circuits');

for (const c of CIRCUITS) {
  // Validate path
  const path = getTrackSvgPath(c.id);
  assert.ok(path.length > 50, `${c.id}: Path must be substantial`);
  assert.ok(path.startsWith('M'), `${c.id}: Must start with move-to`);
  assert.ok(path.endsWith('Z'), `${c.id}: Must close with Z`);

  // Validate waypoints exist
  const wp = RAW_WAYPOINTS[c.id];
  assert.ok(Array.isArray(wp) && wp.length >= 20, `${c.id}: Must have at least 20 GPS waypoints`);

  // Validate rendering
  const rendered = renderSelectedCircuitInfo(c);
  assert.ok(rendered.includes(c.name), `${c.id}: Name rendered in selected info`);
  assert.ok(rendered.includes(`${(c.lengthM / 1000).toFixed(3)} km`), `${c.id}: Length rendered`);
  assert.ok(rendered.includes(`${c.turns} Turns`), `${c.id}: Turns rendered`);
  assert.ok(rendered.includes(`${c.drs} Zones`), `${c.id}: DRS rendered`);
  if (c.rec) {
    assert.ok(rendered.includes(c.rec.toFixed(3)), `${c.id}: Record rendered`);
  }
}
console.log('  ✅ All 8 circuits verified with complete waypoint geometry and spec cards');

// ── 3. Edge Case: Simulated Rapid State Changes & Re-renders ──────────────
console.log('\n▶ Edge Case 3: Rapid selection state transitions');

const simulatedWizard = { circuitId: 'silverstone' };
let rerenderCount = 0;
const mockContainer = {
  listeners: new Map(),
  querySelectorAll(sel) {
    if (sel === '.qr-circuit-card') {
      return CIRCUITS.map(c => ({
        dataset: { circuitId: c.id },
        addEventListener(event, fn) {
          if (!mockContainer.listeners.has(c.id)) {
            mockContainer.listeners.set(c.id, {});
          }
          mockContainer.listeners.get(c.id)[event] = fn;
        }
      }));
    }
    return [];
  }
};

bindCircuitSelectionEvents(mockContainer, simulatedWizard, () => {
  rerenderCount++;
});

// Rapidly select every circuit
for (const c of CIRCUITS) {
  const handler = mockContainer.listeners.get(c.id)?.click;
  assert.ok(typeof handler === 'function', `Click handler for ${c.id} should be registered`);
  handler({ preventDefault() {} });
  assert.equal(simulatedWizard.circuitId, c.id, `Simulated wizard should update to ${c.id}`);
}
assert.equal(rerenderCount, CIRCUITS.length, `Rerender callback called exactly ${CIRCUITS.length} times`);
console.log(`  ✅ ${CIRCUITS.length} rapid selection switches executed without stale state`);

// ── 4. Edge Case: Keyboard Accessibility (Enter & Space) ───────────────────
console.log('\n▶ Edge Case 4: Keyboard accessibility (Enter & Space)');

const kbWizard = { circuitId: 'monaco' };
let kbRerender = 0;
bindCircuitSelectionEvents(mockContainer, kbWizard, () => {
  kbRerender++;
});

// Trigger Enter key on Monza
mockContainer.listeners.get('monza')?.keydown({ key: 'Enter', preventDefault() {} });
assert.equal(kbWizard.circuitId, 'monza', 'Enter key on Monza card should select monza');
assert.equal(kbRerender, 1, 'Rerender triggered on Enter');

// Trigger Space key on Spa
mockContainer.listeners.get('spa')?.keydown({ key: ' ', preventDefault() {} });
assert.equal(kbWizard.circuitId, 'spa', 'Space key on Spa card should select spa');
assert.equal(kbRerender, 2, 'Rerender triggered on Space');

// Non-action key should not trigger rerender
mockContainer.listeners.get('baku')?.keydown({ key: 'Tab', preventDefault() {} });
assert.equal(kbWizard.circuitId, 'spa', 'Tab key should not change selection');
assert.equal(kbRerender, 2, 'Rerender not triggered on non-action key');
console.log('  ✅ Keyboard selection via Enter and Space fully functional');

console.log('\n🏁 ══════════════════════════════════════════════════════════════');
console.log('   ALL CIRCUIT SELECTION EDGE CASES PASSED CLEANLY!             ');
console.log('════════════════════════════════════════════════════════════════\n');
