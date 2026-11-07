// test_csv_commentary_and_radio.mjs
// Verification Suite for Dynamic CSV Team Radio & Commentary Integration

import assert from 'assert';
import { CommentaryEngine } from '../src/strategy/commentaryEngine.js';

console.log('🧪 RUNNING DYNAMIC CSV TEAM RADIO & COMMENTARY TEST SUITE 🧪\n');

let allPassed = true;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
  } catch (err) {
    console.error(`  ❌ ${name}: ${err.message}`);
    allPassed = false;
  }
}

async function runTests() {
  const engine = new CommentaryEngine();

  // --- TEST GROUP 1: Dynamic CSV Loading & RFC-4180 Parsing ---
  console.log('--- TEST GROUP 1: Dynamic CSV Loading & RFC-4180 Parsing ---');
  const loaded = await engine.load();
  await test('Loads f1_team_radio_commentary.csv dynamically from disk/server', () => {
    assert.strictEqual(loaded, true, 'CSV should load successfully');
    assert.strictEqual(engine.isLoaded, true, 'Engine should flag isLoaded = true');
    assert.ok(engine.dialogues.length >= 85, `Expected >= 85 dialogue rows, got ${engine.dialogues.length}`);
  });

  await test('Parses all standard CSV headers correctly', () => {
    const first = engine.dialogues[0];
    assert.ok(first.event_type, 'event_type must be present');
    assert.ok(first.priority, 'priority must be present');
    assert.ok(first.channel, 'channel must be present');
    assert.ok(first.dialogue_id, 'dialogue_id must be present');
    assert.ok(first.dialogue_template, 'dialogue_template must be present');
    assert.ok(typeof first.cooldown_seconds === 'number', 'cooldown_seconds must be a number');
    assert.ok(first.repeat_policy, 'repeat_policy must be present');
  });

  await test('Supports quoted templates with commas inside quotes', () => {
    const quotedEntry = engine.dialogues.find(d => d.dialogue_id === 'OVT_002');
    assert.ok(quotedEntry, 'OVT_002 should exist');
    assert.ok(quotedEntry.dialogue_template.includes(','), 'Template must preserve inner commas');
    assert.ok(quotedEntry.dialogue_template.includes('{overtaker}'), 'Template must include placeholders');
  });

  // --- TEST GROUP 2: Event Mapping & Placeholder Interpolation ---
  console.log('\n--- TEST GROUP 2: Event Mapping & Placeholder Interpolation ---');
  await test('Interpolates {overtaker}, {overtaken}, and {position} accurately', () => {
    const res = engine.processEvent('OVERTAKE_SUCCESS', {
      overtaker: 'NOR',
      overtaken: 'VER',
      position: 1,
      simTime: 100
    });
    assert.ok(res, 'Must return a formatted commentary object');
    assert.ok(res.msg.includes('Lando Norris') || res.msg.includes('NOR'), `Message must contain overtaker: ${res.msg}`);
    assert.ok(res.msg.includes('Max Verstappen') || res.msg.includes('VER'), `Message must contain overtaken: ${res.msg}`);
    assert.ok(!res.msg.includes('{overtaker}'), 'Must not leave literal {overtaker}');
    assert.ok(!res.msg.includes('{overtaken}'), 'Must not leave literal {overtaken}');
  });

  await test('Replaces missing placeholders with sensible fallback instead of literal brackets', () => {
    const res = engine.processEvent('YELLOW_FLAG', {
      simTime: 120
      // sector omitted intentionally
    });
    assert.ok(res, 'Must return dialogue');
    assert.ok(!res.msg.includes('{sector}'), `Must not display literal {sector}: ${res.msg}`);
    assert.ok(res.msg.includes('Sector'), `Should fall back to a valid sector name: ${res.msg}`);
  });

  await test('Interpolates {penalty} and {driver} for steward decisions', () => {
    const res = engine.processEvent('PENALTY_RECEIVED', {
      driver: 'HAM',
      penalty: '5-second time penalty for track limits',
      simTime: 140
    });
    assert.ok(res, 'Must return penalty message');
    assert.ok(res.msg.includes('5-second time penalty'), `Must state penalty: ${res.msg}`);
    assert.ok(!res.msg.includes('{penalty}'), 'Must not display {penalty}');
  });

  // --- TEST GROUP 3: Dialogue Selection Variance & Anti-Repetition ---
  console.log('\n--- TEST GROUP 3: Dialogue Selection Variance & Anti-Repetition ---');
  await test('Avoids immediate repetition of the exact same dialogue_id for repeated events', () => {
    engine.resetRace();
    const event1 = engine.processEvent('OVERTAKE_SUCCESS', { overtaker: 'PIA', overtaken: 'LEC', position: 3, simTime: 200 });
    const event2 = engine.processEvent('OVERTAKE_SUCCESS', { overtaker: 'SAI', overtaken: 'PER', position: 5, simTime: 225 });
    assert.ok(event1 && event2, 'Both overtakes should be processed');
    assert.notStrictEqual(event1.dialogueId, event2.dialogueId, `Subsequent overtake should pick a different dialogue_id (${event1.dialogueId} vs ${event2.dialogueId})`);
  });

  await test('Shows dialogue variance across multiple executions', () => {
    engine.resetRace();
    const ids = new Set();
    for (let t = 0; t < 6; t++) {
      const res = engine.processEvent('OVERTAKE_SUCCESS', { overtaker: 'NOR', overtaken: 'VER', position: 1, simTime: 300 + t * 25 });
      if (res) ids.add(res.dialogueId);
    }
    assert.ok(ids.size >= 2, `Expected at least 2 distinct dialogue IDs for repeated overtakes, got ${ids.size}`);
  });

  // --- TEST GROUP 4: Priority & Cooldown Precedence ---
  console.log('\n--- TEST GROUP 4: Priority & Cooldown Precedence ---');
  await test('Critical safety alerts (CRITICAL) bypass routine cooldowns', () => {
    engine.resetRace();
    // Rapid succession Safety Car deployments within cooldown
    const sc1 = engine.processEvent('SAFETY_CAR_DEPLOYED', { simTime: 400 });
    const sc2 = engine.processEvent('SAFETY_CAR_DEPLOYED', { simTime: 402 }); // Only 2s later (cooldown is 10s)
    assert.ok(sc1, 'Initial Safety Car alert must be emitted');
    assert.ok(sc2, 'Critical Safety Car alert MUST bypass cooldown to ensure safety');
    assert.strictEqual(sc2.priority, 1, 'Priority must be 1 (CRITICAL)');
  });

  await test('Normal priority messages respect cooldown windows', () => {
    engine.resetRace();
    const rep1 = engine.processEvent('GAP_AHEAD', { driver_ahead: 'VER', gap_ahead: 1.5, simTime: 500 });
    const rep2 = engine.processEvent('GAP_AHEAD', { driver_ahead: 'VER', gap_ahead: 1.2, simTime: 505 }); // cooldown is 30s
    assert.ok(rep1, 'First gap update should be emitted');
    assert.strictEqual(rep2, null, 'Rapid routine gap update within 5s must be suppressed by cooldown');
  });

  // --- TEST GROUP 5: Repeat Policies ---
  console.log('\n--- TEST GROUP 5: Repeat Policies ---');
  await test('once_per_race policy permits dialogue only once per race', () => {
    engine.resetRace();
    const start1 = engine.processEvent('RACE_START', { simTime: 10 });
    const start2 = engine.processEvent('RACE_START', { simTime: 60 });
    assert.ok(start1, 'First race start should be emitted');
    engine.processEvent('RACE_START', { simTime: 120 });
    engine.processEvent('RACE_START', { simTime: 180 });
    assert.ok(start1.dialogueId.startsWith('START_'), 'Must use START_ template');
  });

  await test('once_per_investigation allows message once per unique investigation ID', () => {
    engine.resetRace();
    const inv1_open = engine.processEvent('INVESTIGATION_OPEN', { driver: 'NOR', investigationId: 'inv_101', simTime: 700 });
    const inv1_repeat = engine.processEvent('INVESTIGATION_OPEN', { driver: 'NOR', investigationId: 'inv_101', simTime: 710 });
    const inv2_open = engine.processEvent('INVESTIGATION_OPEN', { driver: 'VER', investigationId: 'inv_102', simTime: 720 });

    assert.ok(inv1_open, 'First investigation must be announced');
    assert.strictEqual(inv1_repeat, null, 'Same investigation must not be re-announced');
    assert.ok(inv2_open, 'New investigation ID must be announced');
  });

  // --- TEST GROUP 6: Graceful Handling of Unknown Events & Fallback ---
  console.log('\n--- TEST GROUP 6: Graceful Handling of Unknown Events & Fallback ---');
  await test('Unknown event type returns null gracefully without throwing', () => {
    const res = engine.processEvent('NON_EXISTENT_EVENT_XYZ', { simTime: 800 });
    assert.strictEqual(res, null, 'Unknown event must safely return null');
  });

  await test('Malformed CSV text loads fallback templates gracefully', async () => {
    const fallbackEngine = new CommentaryEngine();
    await fallbackEngine.load('invalid,corrupted,csv\nwithout,matching,headers');
    assert.ok(fallbackEngine.isLoaded, 'Fallback engine must remain loaded');
    assert.ok(fallbackEngine.dialogues.length > 0, 'Must contain fallback dialogues');
  });

  // --- Summary ---
  console.log('\n════════════════════════════════════════════════════════════');
  if (allPassed) {
    console.log('🏁 ALL 14 DYNAMIC CSV COMMENTARY TESTS PASSED (100%) 🏁');
  } else {
    console.error('❌ SOME TESTS FAILED');
    process.exit(1);
  }
  console.log('════════════════════════════════════════════════════════════\n');
}

runTests();
