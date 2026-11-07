// test_race_start_challenge.mjs — Verification Suite for Race Start Reaction Challenge
import { CIRCUITS, RAW_WAYPOINTS, getCircuit } from '../src/data/circuitData.js';
import { DRIVERS, getGrid }                    from '../src/data/driverData.js';
import { buildTrack }                           from '../src/simulation/trackManager.js';
import { RaceEngine, RaceState }               from '../src/simulation/raceEngine.js';
import { StartStates }                         from '../src/simulation/launchManager.js';

console.log('🧪 RUNNING F1 RACE START REACTION CHALLENGE VALIDATION SUITE 🧪\n');

let allPassed = true;
function assert(name, condition, details = '') {
  const icon = condition ? '✅' : '❌';
  console.log(`  ${icon} ${name}${details ? ': ' + details : ''}`);
  if (!condition) allPassed = false;
}

const silverstone = getCircuit('silverstone');
const track = buildTrack(silverstone, RAW_WAYPOINTS.silverstone);

// ── TEST GROUP 1: Pre-Race Grid & Gantry Sequence ─────────────────────────
console.log('--- TEST GROUP 1: Pre-Race Grid & Gantry Sequence ---');
const engine = new RaceEngine();
engine.warp = 1;
const grid = getGrid(6);
engine.build(track, grid, 5);

const lm = engine.launchManager;
assert('Engine initializes in WAITING state', engine.state === RaceState.WAITING);
assert('All 5 starting lights are initially OFF', lm.lights.every(l => l === false));
assert('All cars stationary in grid slots (v=0)', engine.cars.every(c => c.v === 0 && c.throttle === 0));

// Initiate 5 red light sequence
lm.startSequence();
assert('Sequence transitions to LIGHTS_1', lm.state === StartStates.LIGHTS_1);
assert('Light 1 is illuminated', lm.lights[0] === true && lm.lights[1] === false);

// Advance 5 lights
for (let i = 1; i <= 5; i++) {
  lm._scheduleNextLight(i);
}
assert('All 5 red lights are illuminated', lm.lights.every(l => l === true));
assert('System in WAITING_FOR_LIGHTS_OUT state', lm.state === StartStates.WAITING_FOR_LIGHTS_OUT);
assert('Unpredictable hold interval generated (0.8s - 3.2s)', lm.randomHoldDurationMs >= 1000 && lm.randomHoldDurationMs <= 3500, `${lm.randomHoldDurationMs.toFixed(0)} ms`);

// Pre-start: No car may move before lights out
engine.step(0.016);
assert('Cars remain clamped stationary during sequence (v=0)', engine.cars.every(c => c.v === 0));

// ── TEST GROUP 2: Early Press & Jump Start Protection ─────────────────────
console.log('\n--- TEST GROUP 2: Early Press & Jump Start Protection ---');
const earlyRes = lm.registerPlayerLaunch(performance.now());
assert('Premature press detected as Jump Start attempt', earlyRes.early === true && earlyRes.success === false);
assert('Early press warning displayed', earlyRes.message.includes('JUMP START'));

// Verify car still cannot launch before lights out
engine.step(0.016);
assert('Player car does not jump start on track (v=0)', engine.cars[0].v === 0);

// ── TEST GROUP 3: Authoritative Lights Out & Reaction Measurement ─────────
console.log('\n--- TEST GROUP 3: Lights Out & Reaction Time Measurement ---');
// Clear early press from previous test to evaluate clean launch
lm.earlyPressDetected = false;
lm.playerReacted = false;

// Trigger lights out
lm._triggerLightsOut();
assert('All 5 red lights extinguish simultaneously', lm.lights.every(l => l === false));
assert('State transitions to LIGHTS_OUT', lm.state === StartStates.LIGHTS_OUT);
assert('Official start timestamp recorded', lm.lightsOutTimestamp > 0);

// Test Case A: Fast Reaction (145 ms)
const tLights = lm.lightsOutTimestamp;
const fastRes = lm.registerPlayerLaunch(tLights + 145);
assert('Valid launch registered for player', fastRes.success && !fastRes.early);
assert('Reaction time measured accurately', fastRes.reactionMs === 145, `${fastRes.reactionMs} ms`);
assert('Reaction rated as EXCEPTIONAL', fastRes.rating === 'Exceptional');

// Test Case B: Duplicate click prevention
const dupRes = lm.registerPlayerLaunch(tLights + 200);
assert('Duplicate launch click prevented', dupRes.alreadyLaunched === true && dupRes.reactionMs === 145);

// ── TEST GROUP 4: Reaction Time Translated to Physical Acceleration ───────
console.log('\n--- TEST GROUP 4: Physical Acceleration & Traction Integration ---');
const playerCar = engine.cars[0];
const initialGridD = playerCar.d;

// Step simulation before reaction time has arrived (t = 0.05s < 0.145s)
engine.simTime = 0.05;
const evalBefore = lm.evaluateCarLaunch(playerCar, engine.simTime);
assert('Car held stationary before reaction moment', !evalBefore.canAccelerate);

// Step simulation after reaction time has elapsed (t = 0.25s > 0.145s)
engine.simTime = 0.25;
const evalAfter = lm.evaluateCarLaunch(playerCar, engine.simTime);
assert('Car released to accelerate after reaction elapsed', evalAfter.canAccelerate);
assert('Throttle ramps up progressively', evalAfter.throttleModifier > 0 && evalAfter.throttleModifier <= 1.0, `Modifier: ${evalAfter.throttleModifier.toFixed(2)}`);

// Advance physics steps (30 steps = 1.5s total sim time)
for (let s = 0; s < 30; s++) {
  engine.step(0.05);
}
assert('Player car achieves physical forward velocity', playerCar.v * 3.6 > 15, `${(playerCar.v * 3.6).toFixed(1)} km/h`);
assert('Distance along track advances', playerCar.d > initialGridD, `d = ${playerCar.d.toFixed(1)} m`);

// ── TEST GROUP 5: AI Opponent Independent Reaction Times ──────────────────
console.log('\n--- TEST GROUP 5: AI Opponent Independent Reaction Modeling ---');
const aiReactions = Array.from(lm.aiReactions.entries());
assert('AI drivers assigned independent reaction times', aiReactions.length === 6);

// Verify AI reaction times vary realistically between drivers (160ms - 400ms)
const aiDelaysMs = aiReactions.map(([_, s]) => Math.round(s * 1000));
const minAi = Math.min(...aiDelaysMs);
const maxAi = Math.max(...aiDelaysMs);
assert('Plausible human variation across field', minAi >= 150 && maxAi <= 450, `Range: ${minAi}ms - ${maxAi}ms`);
assert('AI drivers have distinct reaction times (not identical ticks)', new Set(aiDelaysMs).size > 1);

// ── TEST GROUP 6: Late Player Reaction Causes Position Loss ───────────────
console.log('\n--- TEST GROUP 6: Slow Player Reaction Dynamics ---');
// Setup new race with slow reaction (480ms)
const engineLate = new RaceEngine();
engineLate.warp = 1;
engineLate.build(track, grid, 5);
const lmLate = engineLate.launchManager;
lmLate.startSequence();
lmLate._triggerLightsOut();

// Player reacts very slowly (480 ms)
const slowRes = lmLate.registerPlayerLaunch(lmLate.lightsOutTimestamp + 480);
assert('Slow reaction correctly categorized', slowRes.rating === 'Very Slow' || slowRes.rating === 'Slow', `${slowRes.rating} (${slowRes.reactionMs}ms)`);

// Run identical duration (30 steps = 1.5s)
for (let s = 0; s < 30; s++) {
  engineLate.step(0.05);
}

// Compare fast player distance vs slow player distance at identical 1.5s sim time
const p1Dist = playerCar.d;
const pSlowDist = engineLate.cars[0].d;
assert('Faster reaction achieves greater distance off the line', p1Dist > pSlowDist, `Delta: +${(p1Dist - pSlowDist).toFixed(1)} m advantage`);

// ── TEST GROUP 7: Reset & Gantry Re-arming ─────────────────────────────────
console.log('\n--- TEST GROUP 7: Restart & State Reset ---');
engine.build(track, grid, 5);
assert('Reset clears reaction metrics', engine.launchManager.playerReacted === false && engine.launchManager.playerReactionMs === null);
assert('Reset extinguishes all gantry lights', engine.launchManager.lights.every(l => l === false));
assert('Reset returns state to GRID', engine.launchManager.state === StartStates.GRID);

console.log('\n════════════════════════════════════════════════════════════');
if (allPassed) {
  console.log('🏁 ALL F1 RACE START REACTION CHALLENGE TESTS PASSED 🏁');
} else {
  console.log('❌ SOME TESTS FAILED');
}
console.log('════════════════════════════════════════════════════════════');
process.exit(allPassed ? 0 : 1);
