/**
 * test_in_race_audio_silence.mjs
 * Authoritative test suite verifying that soundtrack music:
 * 1. Plays freely during all menu flows (Landing, Draft, Championship, Quick Race Wizard).
 * 2. Is STRICTLY SILENCED and prohibited during all on-track racing sessions.
 * 3. Cannot be triggered during racing by user gestures (DRS key, ERS key, pause, clicks).
 * 4. Resumes properly when returning to menus.
 */

import assert from 'assert';
import { LandingAudioController, SOUNDTRACK_PLAYLIST } from '../src/ui/landingAudio.js';

console.log('🏎️ RUNNING IN-RACE AUDIO SILENCE & MENU PLAYBACK TEST SUITE 🏎️\n');

// Mock localStorage
const mockStorage = new Map();
globalThis.localStorage = {
  getItem: (k) => mockStorage.get(k) || null,
  setItem: (k, v) => mockStorage.set(k, String(v)),
  removeItem: (k) => mockStorage.delete(k),
  clear: () => mockStorage.clear()
};

// Mock Audio element
class MockAudio {
  constructor() {
    this.src = '';
    this.volume = 0.5;
    this.currentTime = 0;
    this.autoplay = true;
    this.paused = true;
    this.listeners = new Map();
  }
  load() {}
  addEventListener(ev, fn) {
    if (!this.listeners.has(ev)) this.listeners.set(ev, []);
    this.listeners.get(ev).push(fn);
  }
  removeEventListener(ev, fn) {
    if (this.listeners.has(ev)) {
      this.listeners.set(ev, this.listeners.get(ev).filter(f => f !== fn));
    }
  }
  play() {
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
}
globalThis.Audio = MockAudio;

// Dynamic mock DOM elements
const elements = {
  landingView: { id: 'landingView', style: { display: 'block' }, classList: new Set() },
  simulatorView: { id: 'simulatorView', style: { display: 'none' }, classList: new Set() },
  quickRaceMount: { id: 'quickRaceMount', style: { display: 'none' }, classList: new Set(), _hasWizard: false, querySelector(s) { return this._hasWizard ? {} : null; } },
  gantryOverlay: { id: 'gantryOverlay', style: { display: 'none' }, classList: new Set(['gantry-hidden']), classList: { contains: (c) => c === 'gantry-hidden' } },
  championshipMount: { id: 'championshipMount', style: { display: 'none' }, classList: new Set() },
  draftModeMount: { id: 'draftModeMount', style: { display: 'none' }, classList: new Set() }
};

globalThis.window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  _isRaceActive: false,
  raceEngine: { state: 'waiting' },
  simulatorState: { playing: false }
};

globalThis.document = {
  addEventListener: () => {},
  removeEventListener: () => {},
  getElementById: (id) => elements[id] || null,
  querySelector: () => null,
  querySelectorAll: () => []
};

// --- TEST 1: Menu states allow soundtrack playback ---
console.log('--- TEST 1: Menus Allow Music Playback ---');
const ctrl = new LandingAudioController();

// 1a. Landing View
elements.landingView.style.display = 'block';
elements.simulatorView.style.display = 'none';
window.raceEngine.state = 'waiting';
assert.strictEqual(ctrl.canPlay(), true, 'Landing page allows music playback');

ctrl.play(true);
await new Promise(r => setTimeout(r, 10));
assert.strictEqual(ctrl.isPlaying, true, 'Music plays on Landing page');
console.log('  ✅ Landing view allows soundtrack playback');

// 1b. Quick Race Setup Wizard / Entry Portal (Menu phase before lights)
elements.landingView.style.display = 'none';
elements.simulatorView.style.display = 'block'; // in background
elements.quickRaceMount.style.display = 'block';
elements.quickRaceMount._hasWizard = true; // modal open
assert.strictEqual(ctrl.canPlay(), true, 'Quick Race setup wizard allows music playback');
console.log('  ✅ Quick Race setup wizard modal allows soundtrack playback');

// --- TEST 2: Race Start Sequence (Gantry countdown) Silences Music ---
console.log('\n--- TEST 2: Gantry Countdown Immediately Silences Music ---');
elements.quickRaceMount.style.display = 'none';
elements.quickRaceMount._hasWizard = false;
elements.gantryOverlay.style.display = 'block';
elements.gantryOverlay.classList = { contains: () => false }; // not hidden

assert.strictEqual(ctrl.canPlay(), false, 'Gantry active strictly forbids music playback');

// When gantry lights start, music is paused immediately
ctrl.pause(true);
assert.strictEqual(ctrl.isPlaying, false, 'Music paused during gantry countdown');

// Attempting to play during gantry countdown is strictly rejected
ctrl.play(true);
assert.strictEqual(ctrl.isPlaying, false, 'play() is strictly rejected during gantry countdown');
console.log('  ✅ Starting gantry countdown silences music and prevents play');

// --- TEST 3: Active On-Track Racing Strictly Prohibits Music ---
console.log('\n--- TEST 3: Active On-Track Racing Strictly Prohibits Music ---');
elements.gantryOverlay.style.display = 'none';
elements.gantryOverlay.classList = { contains: (c) => c === 'gantry-hidden' };
elements.simulatorView.style.display = 'block';
elements.landingView.style.display = 'none';
window.raceEngine.state = 'racing';
window._isRaceActive = true;
window.simulatorState.playing = true;

assert.strictEqual(ctrl.canPlay(), false, 'canPlay() is false while racing on track');

// Try calling play() directly
ctrl.play(true);
assert.strictEqual(ctrl.isPlaying, false, 'play() does nothing during active race');

// Test fresh controller with active _unlockHandler entering race
const inRaceCtrl = new LandingAudioController();
assert.strictEqual(typeof inRaceCtrl._unlockHandler, 'function', 'Unlock handler attached');
for (let i = 0; i < 5; i++) {
  inRaceCtrl._unlockHandler();
}
assert.strictEqual(inRaceCtrl.isPlaying, false, 'User gestures (DRS, ERS, steer, clicks) DO NOT trigger music');

// Try toggle() during race
const toggleResult = ctrl.toggle();
assert.strictEqual(toggleResult, false, 'toggle() rejects activation during active race');
assert.strictEqual(ctrl.isPlaying, false, 'toggle() does not play music during active race');
console.log('  ✅ In-race keypresses and UI clicks never trigger soundtrack playback');

// --- TEST 4: Safety Car / Yellow Flag racing states also prohibit music ---
console.log('\n--- TEST 4: Safety Car & Yellow Flag On-Track States ---');
for (const scState of ['safety_car', 'virtual_safety_car', 'yellow', 'starting']) {
  window.raceEngine.state = scState;
  assert.strictEqual(ctrl.canPlay(), false, `canPlay() is false during ${scState}`);
  ctrl.play(true);
  assert.strictEqual(ctrl.isPlaying, false, `Soundtrack strictly silenced during ${scState}`);
}
console.log('  ✅ Safety car and flag interventions maintain strict soundtrack silence');

// --- TEST 5: Return to Landing Page Resumes Music Availability ---
console.log('\n--- TEST 5: Returning Home Restores Soundtrack Availability ---');
elements.simulatorView.style.display = 'none';
elements.landingView.style.display = 'block';
window.raceEngine.state = 'waiting';
window._isRaceActive = false;
window.simulatorState.playing = false;

assert.strictEqual(ctrl.canPlay(), true, 'canPlay() is true when returning home to landing view');
ctrl.play(true);
await new Promise(r => setTimeout(r, 10));
assert.strictEqual(ctrl.isPlaying, true, 'Soundtrack resumes playback upon returning home');
console.log('  ✅ Soundtrack cleanly resumes when returning to landing page');

console.log('\n════════════════════════════════════════════════════════════');
console.log('🎉 ALL IN-RACE AUDIO SILENCE & MENU TESTS PASSED CLEANLY! 🎉');
console.log('════════════════════════════════════════════════════════════\n');
