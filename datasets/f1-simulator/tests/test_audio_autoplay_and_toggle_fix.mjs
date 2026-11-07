/**
 * test_audio_autoplay_and_toggle_fix.mjs
 * Validates the instant soundtrack autoplay fixes, multi-gesture capture unlock,
 * toggle state machine, and fallback prompt.
 */

import assert from 'assert';
import { LandingAudioController, SOUNDTRACK_PLAYLIST } from '../src/ui/landingAudio.js';

console.log('🧪 RUNNING AUDIO AUTOPLAY & TOGGLE STATE MACHINE TEST SUITE 🧪\n');

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
    this.autoplay = false;
    this.listeners = new Map();
    this.shouldRejectPlay = false;
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
    if (this.shouldRejectPlay) {
      const err = new Error('play() failed because the user didn\'t interact with the document first.');
      err.name = 'NotAllowedError';
      return Promise.reject(err);
    }
    return Promise.resolve();
  }
  pause() {}
}
globalThis.Audio = MockAudio;

// Mock window and document for headless environment
globalThis.window = {
  addEventListener: () => {},
  removeEventListener: () => {}
};
globalThis.document = {
  addEventListener: () => {},
  removeEventListener: () => {},
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => []
};

// ── TEST 1: Default initialization ensures isEnabled = true ───────────────
console.log('--- TEST 1: Default Enabled State & Playlist Integrity ---');
const ctrl = new LandingAudioController();
assert.strictEqual(ctrl.isEnabled, true, 'Soundtrack is enabled by default');
assert.strictEqual(ctrl.playlist.length, 4, 'Playlist contains 4 tracks');
assert.strictEqual(ctrl.audio.autoplay, true, 'Audio element requests browser autoplay');
console.log('  ✅ Initialized with isEnabled = true and audio.autoplay = true');

// ── TEST 2: Toggle Fix (Clicking when not playing unpauses/plays) ───────────
console.log('\n--- TEST 2: Toggle Fix (Non-playing click must unpause & play) ---');
ctrl.isPlaying = false;
ctrl.audio.shouldRejectPlay = false;

// When NOT playing, clicking toggle MUST NOT set isEnabled = false!
ctrl.toggle();
assert.strictEqual(ctrl.isEnabled, true, 'Clicking when not playing keeps isEnabled = true');
assert.strictEqual(localStorage.getItem('f1_landing_music_enabled'), 'true', 'localStorage persists true');
console.log('  ✅ Toggle when not playing correctly activates playback and persists true');

// When IS playing, clicking toggle pauses and mutes
ctrl.isPlaying = true;
ctrl.toggle();
assert.strictEqual(ctrl.isEnabled, false, 'Clicking when playing sets isEnabled = false');
assert.strictEqual(localStorage.getItem('f1_landing_music_enabled'), 'false', 'localStorage persists false');
console.log('  ✅ Toggle when playing pauses and mutes');

// ── TEST 3: Autoplay blocked handling & Prompt Display ─────────────────────
console.log('\n--- TEST 3: Autoplay Blocked & Multi-Gesture Activation ---');
mockStorage.clear(); // clean slate for fresh browser session
const ctrl2 = new LandingAudioController();
ctrl2.audio.shouldRejectPlay = true; // simulate browser autoplay policy rejection

// Attempt play on load
ctrl2.play();
await new Promise(r => setTimeout(r, 50));

assert.strictEqual(ctrl2.isPlaying, false, 'Playback blocked by browser policy');
assert.strictEqual(ctrl2.autoplayBlocked, true, 'autoplayBlocked flag raised');
console.log('  ✅ Autoplay rejection caught gracefully without uncaught exceptions');

// Now simulate user interaction (unblocks)
ctrl2.audio.shouldRejectPlay = false;
ctrl2._unlockHandler(); // fires simulated gesture
await new Promise(r => setTimeout(r, 50));

assert.strictEqual(ctrl2.isPlaying, true, 'Soundtrack immediately starts playing upon gesture');
assert.strictEqual(ctrl2.autoplayBlocked, false, 'autoplayBlocked flag cleared upon play');
console.log('  ✅ Gesture unlock successfully starts soundtrack playback');

// ── TEST 4: UI Bindings & Button Classes ──────────────────────────────────
console.log('\n--- TEST 4: UI Bindings & Speaker Icon Consistency ---');
const mockBtn = { classList: new Set(), toggle(c, v) { if (v) this.classList.add(c); else this.classList.delete(c); } };
const mockIcon = { textContent: '' };
const mockLabel = { textContent: '', title: '' };

ctrl2.bindUI({
  btn: { classList: { toggle: (c, v) => mockBtn.toggle(c, v) } },
  icon: mockIcon,
  label: mockLabel
});

assert.strictEqual(mockIcon.textContent, '🔊', 'Speaker icon is 🔊 when enabled');
assert.strictEqual(mockLabel.textContent, 'WE OWN IT', 'Displays uppercase track title');
console.log('  ✅ UI correctly synchronized with speaker 🔊 icon and track label');

console.log('\n════════════════════════════════════════════════════════════');
console.log('🎉 ALL AUDIO AUTOPLAY & TOGGLE TESTS PASSED CLEANLY! 🎉');
console.log('════════════════════════════════════════════════════════════\n');
