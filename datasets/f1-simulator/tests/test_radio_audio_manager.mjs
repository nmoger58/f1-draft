// test_radio_audio_manager.mjs
// Verification Suite for Centralized Team Radio Audio Manager & Voice Settings

import assert from 'assert';
import { RadioAudioManager, AudioPriority, VoiceDeliveryStyle } from '../src/ui/radioAudioManager.js';

console.log('🧪 RUNNING TEAM RADIO AUDIO MANAGER & VOICE SETTINGS TEST SUITE 🧪\n');

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

// Mock window and speech synthesis for headless Node.js testing
class MockSpeechSynthesisUtterance {
  constructor(text) {
    this.text = text;
    this.rate = 1.0;
    this.pitch = 1.0;
    this.volume = 1.0;
    this.voice = null;
    this.onend = null;
    this.onerror = null;
  }
}

class MockSpeechSynthesis {
  constructor() {
    this.speaking = false;
    this.paused = false;
    this.pending = false;
    this.lastSpoken = null;
    this.cancelCount = 0;
    this.voices = [
      { name: 'Microsoft Ryan Online (Natural) - English (United Kingdom)', voiceURI: 'ms-ryan-uk', lang: 'en-GB' },
      { name: 'Microsoft George - English (United Kingdom)', voiceURI: 'ms-george-uk', lang: 'en-GB' },
      { name: 'Google UK English Male', voiceURI: 'google-uk-male', lang: 'en-GB' },
      { name: 'Microsoft David - English (United States)', voiceURI: 'ms-david-us', lang: 'en-US' }
    ];
  }

  getVoices() {
    return this.voices;
  }

  speak(utter) {
    this.speaking = true;
    this.lastSpoken = utter;
  }

  cancel() {
    this.speaking = false;
    this.cancelCount++;
  }
}

globalThis.window = {
  speechSynthesis: new MockSpeechSynthesis(),
  SpeechSynthesisUtterance: MockSpeechSynthesisUtterance
};

// --- TEST GROUP 1: Voice Discovery & Settings Validation ---
console.log('--- TEST GROUP 1: Voice Discovery & Settings Validation ---');
const audioMgr = new RadioAudioManager();

test('Discovers genuine system voices from speech synthesis provider', () => {
  const voices = audioMgr.getAvailableVoices();
  assert.ok(voices.length >= 4, `Expected at least 4 mock voices, got ${voices.length}`);
  assert.ok(voices.some(v => v.name.includes('Ryan') || v.name.includes('George')), 'Found UK engineer voice');
});

test('Validates and selects optimal natural English motorsport default voice', () => {
  audioMgr._validateSelectedVoice();
  assert.ok(audioMgr.settings.voiceURI.includes('uk') || audioMgr.settings.voiceURI.includes('ryan'),
    `Selected voice should be UK natural engineer: ${audioMgr.settings.voiceURI}`);
});

test('Falls back gracefully if saved voice URI is unavailable', () => {
  audioMgr.settings.voiceURI = 'non-existent-fantasy-voice-404';
  audioMgr.settings.voiceName = 'non-existent-fantasy-voice-404';
  audioMgr._validateSelectedVoice();
  assert.notStrictEqual(audioMgr.settings.voiceURI, 'non-existent-fantasy-voice-404');
  assert.ok(audioMgr.settings.voiceURI.length > 0, 'Must fall back to valid existing voice');
});

// --- TEST GROUP 2: Priority Preemption & Non-Overlapping Queue ---
console.log('\n--- TEST GROUP 2: Priority Preemption & Non-Overlapping Queue ---');
test('Urgent safety alert (P1) preempts lower priority speech immediately', () => {
  audioMgr.stop();
  window.speechSynthesis.cancelCount = 0;

  // 1. Routine status is currently playing
  audioMgr.speak('The gap to the car ahead is 2.4 seconds.', {
    priority: AudioPriority.P6_ROUTINE,
    category: 'strategy'
  });
  assert.strictEqual(audioMgr.isPlaying, true, 'Routine speech should be playing');

  // 2. Critical Red Flag arrives
  const preempted = audioMgr.speak('RED FLAG! RED FLAG! All cars return to pit lane immediately.', {
    priority: AudioPriority.P1_SAFETY_CRITICAL,
    category: 'control'
  });

  assert.strictEqual(preempted, true, 'Preemption should succeed');
  assert.ok(window.speechSynthesis.cancelCount >= 1, 'Previous speech must be cancelled');
  assert.strictEqual(audioMgr.currentPriority, AudioPriority.P1_SAFETY_CRITICAL, 'Current priority must be P1');
  assert.ok(window.speechSynthesis.lastSpoken.text.includes('RED FLAG'), 'Last spoken text must be the Red Flag alert');
});

test('Equal or lower priority messages queue without overlapping speech', () => {
  audioMgr.stop();
  audioMgr.speak('Active message playing.', { priority: AudioPriority.P3_INCIDENT });
  assert.strictEqual(audioMgr.isPlaying, true);

  // Send P4 pit recommendation
  audioMgr.speak('Box this lap for hard tyres.', { priority: AudioPriority.P4_PIT_STRATEGY, category: 'pit' });
  assert.strictEqual(audioMgr.queue.length, 1, 'P4 message should be queued behind P3');
  assert.strictEqual(audioMgr.queue[0].text, 'Box this lap for hard tyres.');
});

// --- TEST GROUP 3: Staleness Discarding ---
console.log('\n--- TEST GROUP 3: Staleness Discarding ---');
test('Outdated pit recommendation is discarded after car enters pits', () => {
  audioMgr.stop();
  audioMgr.isPlaying = true; // simulate busy audio

  // Queue pit recommendation
  audioMgr.speak('Box this lap, pit window is open.', {
    priority: AudioPriority.P4_PIT_STRATEGY,
    category: 'pit',
    carState: { pitState: 'ready' }
  });
  assert.strictEqual(audioMgr.queue.length, 1);

  // Now car pits: pitState becomes 'servicing'
  audioMgr.queue[0].options.carState = { pitState: 'servicing' };

  // Dequeue
  audioMgr._processNextInQueue();
  assert.strictEqual(audioMgr.queue.length, 0, 'Stale pit call must be dequeued and discarded');
  assert.strictEqual(audioMgr.isPlaying, false, 'Stale message was not spoken');
});

// --- TEST GROUP 4: Contextual Delivery Tone Modulation ---
console.log('\n--- TEST GROUP 4: Contextual Delivery Tone Modulation ---');
test('Adaptive delivery increases rate and pitch for safety-critical alerts', () => {
  audioMgr.stop();
  audioMgr.settings.style = VoiceDeliveryStyle.ADAPTIVE;
  audioMgr.settings.speed = 1.05;
  audioMgr.settings.pitch = 0.95;

  audioMgr.speak('Safety Car deployed! Hold your delta.', {
    priority: AudioPriority.P1_SAFETY_CRITICAL,
    category: 'control'
  });

  const spoken = window.speechSynthesis.lastSpoken;
  assert.ok(spoken.rate > 1.05, `Rate should be elevated for urgent alert: ${spoken.rate}`);
  assert.ok(spoken.pitch > 0.95, `Pitch should be heightened for urgent alert: ${spoken.pitch}`);
});

// --- TEST GROUP 5: Mute, Silence & Cleanup ---
console.log('\n--- TEST GROUP 5: Mute, Silence & Cleanup ---');
test('Mute immediately cancels active speech, clears queue, and disables voice', () => {
  audioMgr.speak('Testing speech.', { priority: AudioPriority.P5_TACTICAL });
  audioMgr.queue.push({ id: 'dummy', text: 'queued', priority: 5 });

  audioMgr.mute();
  assert.strictEqual(audioMgr.isPlaying, false, 'isPlaying must be false');
  assert.strictEqual(audioMgr.queue.length, 0, 'Queue must be empty');
  assert.strictEqual(audioMgr.settings.voiceEnabled, false, 'voiceEnabled must be false');
});

test('Reset to defaults restores professional engineer configuration', () => {
  audioMgr.settings.speed = 0.8;
  audioMgr.settings.volume = 0.2;
  audioMgr.resetToDefaults();

  assert.strictEqual(audioMgr.settings.voiceEnabled, true);
  assert.strictEqual(audioMgr.settings.speed, 1.05);
  assert.strictEqual(audioMgr.settings.volume, 0.85);
  assert.strictEqual(audioMgr.settings.pitch, 0.95);
  assert.strictEqual(audioMgr.settings.style, VoiceDeliveryStyle.ADAPTIVE);
});

// --- Summary ---
console.log('\n════════════════════════════════════════════════════════════');
if (allPassed) {
  console.log('🏁 ALL 9 RADIO AUDIO MANAGER TESTS PASSED (100%) 🏁');
} else {
  console.error('❌ SOME TESTS FAILED');
  process.exit(1);
}
console.log('════════════════════════════════════════════════════════════\n');
