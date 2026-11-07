/**
 * radioAudioManager.js
 * Centralized Priority-Driven Team Radio Audio Manager & TTS Voice Controller.
 *
 * Implements:
 *   - Native Web Speech API integration with genuine system voice discovery.
 *   - Configurable speech parameters: Voice, Rate (Speed), Volume, Pitch, Delivery Style.
 *   - Motorsport Contextual Tone Modulation (Adaptive, Calm, Assertive, Urgent, Neutral).
 *   - Priority-based Queueing (1: Critical -> 6: Routine):
 *       * High-priority safety alerts preempt lower-priority speech immediately.
 *       * Non-preempting messages queue neatly without chaotic overlapping speech.
 *   - Staleness Discarding (e.g. discarding pit calls after the car has already pitted).
 *   - Message Deduplication and Cooldown Windows.
 *   - Realistic Cockpit Radio Squelch Frequency Chirp via Web Audio API.
 *   - Full Mute / Silence Controls.
 *   - Persistent settings storage in localStorage with graceful fallback for missing voices.
 */

const STORAGE_KEY_VOICE = 'f1_radio_voice_settings_v1';

import { formatForSpeech } from '../utils/speechFormatter.js';

export const VoiceDeliveryStyle = {
  ADAPTIVE:  'adaptive', // Context-aware pitch and tempo based on race urgency
  CALM:      'calm',     // Composed, steady endurance engineer
  ASSERTIVE: 'assertive',// Crisp, decisive tactical calls
  URGENT:    'urgent',   // High-tempo, direct safety delivery
  NEUTRAL:   'neutral'   // Uniform standard delivery
};

export const AudioPriority = {
  P1_SAFETY_CRITICAL: 1, // Red flag, severe debris, critical damage
  P2_RACE_CONTROL:    2, // Safety Car, VSC, Restart
  P3_INCIDENT:        3, // Collisions, local yellow, track limits
  P4_PIT_STRATEGY:    4, // Time-sensitive pit recommendations
  P5_TACTICAL:        5, // Overtaking, DRS, defending, weather change
  P6_ROUTINE:         6  // Gaps, lap times, tyre temps
};

export class RadioAudioManager {
  constructor() {
    this.audioCtx = null;
    this.voices = [];
    this.availableVoicesLoaded = false;
    this.currentUtterance = null;
    this.isPlaying = false;
    this.currentPriority = 99;
    this.queue = []; // Array of { id, text, priority, category, simTime, addedAt, options }
    this.maxQueueSize = 3;
    this.spokenInvestigationIds = new Set();
    this.recentSpokenHashes = new Map(); // hash -> timestamp
    this._noiseBuffer = null;
    this._carrierNodes = null;
    this._pendingSpeakTimer = null;

    // Default configuration
    this.settings = {
      voiceEnabled: true,
      voiceURI: '',
      voiceName: '',
      voiceLang: 'en',
      speed: 1.05,
      volume: 0.85,
      pitch: 0.95,
      style: VoiceDeliveryStyle.ADAPTIVE,
      squelchEnabled: true
    };

    this._loadSettings();
    this._initVoices();
    this._bindUserGestureUnlock();
  }

  _bindUserGestureUnlock() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const unlock = () => {
      this._ensureAudioContext().catch(() => {});
    };
    ['pointerdown', 'touchstart', 'keydown', 'click'].forEach(evt => {
      window.addEventListener(evt, unlock, { once: true, passive: true });
    });
  }

  _loadSettings() {
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(STORAGE_KEY_VOICE);
        if (raw) {
          const parsed = JSON.parse(raw);
          this.settings = { ...this.settings, ...parsed };
        }
      }
    } catch (e) {
      console.warn('Failed to load radio voice settings:', e);
    }
  }

  saveSettings(partial = {}) {
    this.settings = { ...this.settings, ...partial };
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY_VOICE, JSON.stringify(this.settings));
      }
    } catch (e) {
      console.warn('Failed to save radio voice settings:', e);
    }
    return this.settings;
  }

  _initVoices() {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;

    const populate = () => {
      try {
        const list = window.speechSynthesis.getVoices() || [];
        if (list.length > 0) {
          this.voices = list;
          this.availableVoicesLoaded = true;
          this._validateSelectedVoice();
        }
      } catch (_) {}
    };

    populate();
    if (typeof window.speechSynthesis.onvoiceschanged !== 'undefined') {
      window.speechSynthesis.onvoiceschanged = populate;
    }
  }

  _validateSelectedVoice() {
    if (!this.voices.length) return;

    let matched = null;
    if (this.settings.voiceURI) {
      matched = this.voices.find(v => v.voiceURI === this.settings.voiceURI);
    }
    if (!matched && this.settings.voiceName) {
      matched = this.voices.find(v => v.name === this.settings.voiceName);
    }

    if (!matched) {
      // Find optimal default: English (preferably UK or US natural voice)
      const enVoices = this.voices.filter(v => v.lang && v.lang.toLowerCase().startsWith('en'));
      matched = enVoices.find(v => v.name.toLowerCase().includes('natural') || v.name.toLowerCase().includes('online'))
        || enVoices.find(v => v.name.toLowerCase().includes('uk') || v.name.toLowerCase().includes('george') || v.name.toLowerCase().includes('ryan') || v.name.toLowerCase().includes('daniel'))
        || enVoices[0]
        || this.voices[0];

      if (matched) {
        this.settings.voiceURI = matched.voiceURI;
        this.settings.voiceName = matched.name;
        this.settings.voiceLang = matched.lang;
      }
    }
  }

  /**
   * Return array of genuinely available system voices.
   */
  getAvailableVoices() {
    if (typeof window !== 'undefined' && window.speechSynthesis && (!this.voices.length || !this.availableVoicesLoaded)) {
      try {
        this.voices = window.speechSynthesis.getVoices() || [];
      } catch (_) {}
    }
    return this.voices;
  }

  _initAudioContext() {
    if (!this.audioCtx && typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        this.audioCtx = new AudioCtx();
      } catch (_) {}
    }
  }

  /**
   * Ensure AudioContext is instantiated and resumed.
   */
  async _ensureAudioContext() {
    this._initAudioContext();
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      try {
        await this.audioCtx.resume();
      } catch (_) {}
    }
    return this.audioCtx;
  }

  /**
   * Generate or retrieve pre-computed 2-second white noise buffer for VHF carrier static.
   */
  _getNoiseBuffer() {
    if (!this.audioCtx) return null;
    if (this._noiseBuffer) return this._noiseBuffer;

    try {
      const sampleRate = this.audioCtx.sampleRate || 44100;
      const length = sampleRate * 2; // 2 seconds
      const buffer = this.audioCtx.createBuffer(1, length, sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) {
        // Uniform white noise
        data[i] = (Math.random() * 2 - 1) * 0.9;
      }
      this._noiseBuffer = buffer;
      return buffer;
    } catch (_) {
      return null;
    }
  }

  /**
   * Play authentic Formula 1 PTT Intro Chirp (dual frequency beep + RF squelch click).
   */
  playIntroChirp() {
    if (!this.settings.squelchEnabled) return;
    this._ensureAudioContext().then(ctx => {
      if (!ctx || ctx.state !== 'running') return;
      try {
        const now = ctx.currentTime;
        const masterVol = Math.max(0.1, Math.min(1.0, this.settings.volume || 0.85));

        // Primary PTT roger tone (2150 Hz)
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(2150, now);
        osc1.frequency.exponentialRampToValueAtTime(2550, now + 0.055);

        gain1.gain.setValueAtTime(0.001, now);
        gain1.gain.linearRampToValueAtTime(masterVol * 0.18, now + 0.006);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.065);

        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        osc1.start(now);
        osc1.stop(now + 0.065);

        // Secondary harmonic overtone (2600 Hz)
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(2600, now);
        osc2.frequency.setValueAtTime(2850, now + 0.035);

        gain2.gain.setValueAtTime(0.001, now);
        gain2.gain.linearRampToValueAtTime(masterVol * 0.09, now + 0.008);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.055);

        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start(now);
        osc2.stop(now + 0.055);

        // RF squelch gate micro-click
        const noiseBuf = this._getNoiseBuffer();
        if (noiseBuf) {
          const noiseSrc = ctx.createBufferSource();
          noiseSrc.buffer = noiseBuf;
          const bandpass = ctx.createBiquadFilter();
          bandpass.type = 'bandpass';
          bandpass.frequency.setValueAtTime(2800, now);
          bandpass.Q.setValueAtTime(2.5, now);

          const noiseGain = ctx.createGain();
          noiseGain.gain.setValueAtTime(0.001, now);
          noiseGain.gain.linearRampToValueAtTime(masterVol * 0.12, now + 0.003);
          noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.018);

          noiseSrc.connect(bandpass);
          bandpass.connect(noiseGain);
          noiseGain.connect(ctx.destination);
          noiseSrc.start(now);
          noiseSrc.stop(now + 0.020);
        }
      } catch (_) {}
    }).catch(() => {});
  }

  /**
   * Play authentic Formula 1 PTT Outro Release Chirp & Squelch Tail.
   * Roger beep descending in frequency + RF squelch gate release.
   */
  playOutroChirp() {
    if (!this.settings.squelchEnabled) return;
    this._ensureAudioContext().then(ctx => {
      if (!ctx || ctx.state !== 'running') return;
      try {
        const now = ctx.currentTime;
        const masterVol = Math.max(0.1, Math.min(1.0, this.settings.volume || 0.85));

        // Descending roger release beep (2100 Hz -> 1050 Hz)
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(2100, now);
        osc.frequency.exponentialRampToValueAtTime(1050, now + 0.060);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(masterVol * 0.16, now + 0.006);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.065);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.065);

        // RF squelch tail burst
        const noiseBuf = this._getNoiseBuffer();
        if (noiseBuf) {
          const noiseSrc = ctx.createBufferSource();
          noiseSrc.buffer = noiseBuf;
          const bandpass = ctx.createBiquadFilter();
          bandpass.type = 'bandpass';
          bandpass.frequency.setValueAtTime(2200, now);
          bandpass.Q.setValueAtTime(1.8, now);

          const noiseGain = ctx.createGain();
          noiseGain.gain.setValueAtTime(0.001, now);
          noiseGain.gain.linearRampToValueAtTime(masterVol * 0.14, now + 0.004);
          noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);

          noiseSrc.connect(bandpass);
          bandpass.connect(noiseGain);
          noiseGain.connect(ctx.destination);
          noiseSrc.start(now);
          noiseSrc.stop(now + 0.038);
        }
      } catch (_) {}
    }).catch(() => {});
  }

  /**
   * Start live VHF radio carrier static and cockpit turbo-hybrid V6 engine drone.
   * Runs concurrently while vocal transmission is active.
   */
  startRadioCarrier() {
    if (this._carrierNodes) return;
    if (!this.settings.squelchEnabled) return;

    this._ensureAudioContext().then(ctx => {
      if (!ctx || ctx.state !== 'running' || this._carrierNodes) return;
      try {
        const now = ctx.currentTime;
        const masterVol = Math.max(0.1, Math.min(1.0, this.settings.volume || 0.85));

        const masterCarrierGain = ctx.createGain();
        masterCarrierGain.gain.setValueAtTime(0.001, now);
        masterCarrierGain.gain.linearRampToValueAtTime(1.0, now + 0.040);
        masterCarrierGain.connect(ctx.destination);

        const nodesToStop = [];

        // 1. VHF Radio Carrier Static (bandpass filtered white noise)
        const noiseBuf = this._getNoiseBuffer();
        if (noiseBuf) {
          const noiseSrc = ctx.createBufferSource();
          noiseSrc.buffer = noiseBuf;
          noiseSrc.loop = true;

          const bpFilter = ctx.createBiquadFilter();
          bpFilter.type = 'bandpass';
          bpFilter.frequency.setValueAtTime(2200, now);
          bpFilter.Q.setValueAtTime(1.2, now);

          const noiseGain = ctx.createGain();
          noiseGain.gain.setValueAtTime(masterVol * 0.048, now);

          noiseSrc.connect(bpFilter);
          bpFilter.connect(noiseGain);
          noiseGain.connect(masterCarrierGain);
          noiseSrc.start(now);
          nodesToStop.push(noiseSrc);
        }

        // 2. Cockpit Turbo-Hybrid V6 Engine Drone & Helmet Resonance
        const engOsc = ctx.createOscillator();
        engOsc.type = 'sawtooth';
        engOsc.frequency.setValueAtTime(116, now); // V6 RPM fundamental

        const turboOsc = ctx.createOscillator();
        turboOsc.type = 'sine';
        turboOsc.frequency.setValueAtTime(348, now); // 3rd harmonic whine

        const lowpass = ctx.createBiquadFilter();
        lowpass.type = 'lowpass';
        lowpass.frequency.setValueAtTime(420, now);
        lowpass.Q.setValueAtTime(1.8, now);

        const droneGain = ctx.createGain();
        droneGain.gain.setValueAtTime(masterVol * 0.032, now);

        engOsc.connect(lowpass);
        turboOsc.connect(lowpass);
        lowpass.connect(droneGain);
        droneGain.connect(masterCarrierGain);

        engOsc.start(now);
        turboOsc.start(now);
        nodesToStop.push(engOsc, turboOsc);

        this._carrierNodes = {
          masterGain: masterCarrierGain,
          sources: nodesToStop,
          ctx
        };
      } catch (_) {}
    }).catch(() => {});
  }

  /**
   * Stop active radio carrier static and engine drone smoothly.
   */
  stopRadioCarrier() {
    if (!this._carrierNodes) return;
    const { masterGain, sources, ctx } = this._carrierNodes;
    this._carrierNodes = null;

    try {
      const now = ctx.currentTime;
      masterGain.gain.setValueAtTime(masterGain.gain.value, now);
      masterGain.gain.linearRampToValueAtTime(0.001, now + 0.045);
      setTimeout(() => {
        sources.forEach(s => {
          try { s.stop(); } catch (_) {}
          try { s.disconnect(); } catch (_) {}
        });
        try { masterGain.disconnect(); } catch (_) {}
      }, 50);
    } catch (_) {}
  }

  /**
   * Backward-compatible alias for playIntroChirp.
   */
  playSquelch() {
    this.playIntroChirp();
  }

  /**
   * Speak or queue an authentic race engineer team radio message.
   *
   * @param {string} text
   * @param {object} options – { priority, category, simTime, carState }
   */
  speak(text, options = {}) {
    if (!this.settings.voiceEnabled || typeof window === 'undefined' || !window.speechSynthesis) {
      return false;
    }
    if (!text || typeof text !== 'string') return false;

    // Format for natural speech pronunciation (durations, units, acronyms, placeholders)
    const formattedSpeech = options.spokenText || formatForSpeech(text, options);
    const cleanText = formattedSpeech.trim();
    if (!cleanText) return false;

    const priority = options.priority || AudioPriority.P5_TACTICAL;
    const now = Date.now();

    // Deduplication check: Avoid speaking identical text within 18 seconds
    const hash = cleanText.toLowerCase().replace(/[^a-z0-9]/g, '');
    const lastTime = this.recentSpokenHashes.get(hash);
    if (lastTime && (now - lastTime < 18000) && priority > AudioPriority.P1_SAFETY_CRITICAL) {
      return false;
    }

    // Staleness check for pit calls
    if (options.category === 'pit' && options.carState) {
      const pitState = options.carState.pitState;
      if (pitState && pitState !== 'ready') {
        return false; // Outdated pit recommendation after pit has commenced
      }
    }

    // Preemption evaluation:
    // If currently speaking a lower priority message, and an urgent alert arrives (P1 or P2),
    // preempt the current speech immediately!
    const isUrgent = (priority <= AudioPriority.P2_RACE_CONTROL);
    if (this.isPlaying && isUrgent && this.currentPriority > priority) {
      try {
        window.speechSynthesis.cancel();
      } catch (_) {}
      this.isPlaying = false;
      this.currentUtterance = null;
      this._playNow(cleanText, priority, options);
      this.recentSpokenHashes.set(hash, now);
      return true;
    }

    // If currently playing and cannot preempt, queue by priority
    if (this.isPlaying) {
      // Discard low priority messages if queue is saturated
      if (this.queue.length >= this.maxQueueSize) {
        // Drop lowest priority
        this.queue.sort((a, b) => a.priority - b.priority);
        if (priority < this.queue[this.queue.length - 1].priority) {
          this.queue.pop();
        } else {
          return false;
        }
      }

      this.queue.push({
        id: Math.random().toString(36).substr(2, 6),
        text: cleanText,
        priority,
        category: options.category || 'strategy',
        simTime: options.simTime || 0,
        addedAt: now,
        options
      });

      // Sort queue so highest priority (lowest number) is first
      this.queue.sort((a, b) => a.priority - b.priority);
      return true;
    }

    // Not playing: execute immediately
    this._playNow(cleanText, priority, options);
    this.recentSpokenHashes.set(hash, now);
    return true;
  }

  _playNow(cleanText, priority, options) {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;

    // Trigger authentic Formula 1 PTT Intro Chirp and live VHF carrier static + engine drone
    this.playIntroChirp();
    this.startRadioCarrier();

    try {
      const UtterClass = (typeof window !== 'undefined' && window.SpeechSynthesisUtterance)
        ? window.SpeechSynthesisUtterance
        : (typeof SpeechSynthesisUtterance !== 'undefined' ? SpeechSynthesisUtterance : null);
      if (!UtterClass) {
        this.stopRadioCarrier();
        return;
      }

      const utter = new UtterClass(cleanText);

      // Match voice
      const voices = this.getAvailableVoices();
      if (voices.length > 0) {
        let v = voices.find(x => x.voiceURI === this.settings.voiceURI || x.name === this.settings.voiceName);
        if (!v) {
          this._validateSelectedVoice();
          v = voices.find(x => x.voiceURI === this.settings.voiceURI);
        }
        if (v) utter.voice = v;
      }

      // Configure base speed, volume, and pitch
      let rate = this.settings.speed || 1.05;
      let pitch = this.settings.pitch || 0.95;
      const volume = Math.max(0.1, Math.min(1.0, this.settings.volume || 0.85));

      // Apply Contextual Tone Delivery Modulation
      const style = this.settings.style || VoiceDeliveryStyle.ADAPTIVE;
      if (style === VoiceDeliveryStyle.ADAPTIVE) {
        if (priority <= AudioPriority.P1_SAFETY_CRITICAL) {
          // Urgent, immediate safety tone
          rate = Math.min(1.35, rate * 1.12);
          pitch = Math.min(1.30, pitch * 1.08);
        } else if (priority === AudioPriority.P2_RACE_CONTROL) {
          rate = Math.min(1.25, rate * 1.06);
        } else if (priority === AudioPriority.P4_PIT_STRATEGY) {
          // Assertive, crisp pit call
          rate = Math.min(1.25, rate * 1.04);
          pitch = Math.max(0.85, pitch * 0.98);
        } else if (priority >= AudioPriority.P6_ROUTINE) {
          // Calm, relaxed pacing
          rate = Math.max(0.90, rate * 0.96);
          pitch = Math.max(0.80, pitch * 0.95);
        }
      } else if (style === VoiceDeliveryStyle.URGENT) {
        rate = Math.min(1.35, rate * 1.10);
        pitch = Math.min(1.25, pitch * 1.05);
      } else if (style === VoiceDeliveryStyle.CALM) {
        rate = Math.max(0.90, rate * 0.95);
        pitch = Math.max(0.80, pitch * 0.95);
      } else if (style === VoiceDeliveryStyle.ASSERTIVE) {
        rate = Math.min(1.25, rate * 1.05);
      }

      utter.rate = rate;
      utter.pitch = pitch;
      utter.volume = volume;

      this.isPlaying = true;
      this.currentPriority = priority;
      this.currentUtterance = utter;

      const finishSpeech = () => {
        this.stopRadioCarrier();
        this.playOutroChirp();
        this.isPlaying = false;
        this.currentUtterance = null;
        this.currentPriority = 99;
        this._processNextInQueue();
      };

      utter.onend = finishSpeech;
      utter.onerror = finishSpeech;

      window.speechSynthesis.speak(utter);
    } catch (err) {
      console.warn('Speech synthesis playback error:', err);
      this.stopRadioCarrier();
      this.isPlaying = false;
      this.currentUtterance = null;
      this.currentPriority = 99;
    }
  }

  _processNextInQueue() {
    if (!this.queue.length) {
      this.isPlaying = false;
      this.currentUtterance = null;
      this.currentPriority = 99;
      return;
    }

    const next = this.queue.shift();
    const now = Date.now();

    // Discard stale message if queued for > 12 seconds
    if (now - next.addedAt > 12000) {
      this._processNextInQueue();
      return;
    }

    // Check pit staleness
    if (next.category === 'pit' && next.options.carState?.pitState && next.options.carState.pitState !== 'ready') {
      this._processNextInQueue();
      return;
    }

    this._playNow(next.text, next.priority, next.options);
  }

  /**
   * Speak a voice preview sample using currently selected settings.
   */
  preview(customText = null) {
    const text = customText || 'Box this lap, confirm box. Fresh tyres are ready.';
    this.stop();
    this.speak(text, { priority: AudioPriority.P1_SAFETY_CRITICAL });
  }

  /**
   * Mute or silence active speech immediately and purge queue.
   */
  mute() {
    this.saveSettings({ voiceEnabled: false });
    this.stop();
  }

  /**
   * Stop active speech and clear pending queue without changing settings.
   */
  stop() {
    if (this._pendingSpeakTimer) {
      clearTimeout(this._pendingSpeakTimer);
      this._pendingSpeakTimer = null;
    }
    this.stopRadioCarrier();
    try {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    } catch (_) {}
    this.isPlaying = false;
    this.currentUtterance = null;
    this.currentPriority = 99;
    this.queue = [];
  }

  /**
   * Reset all voice parameters to default motorsport engineer settings.
   */
  resetToDefaults() {
    this.stop();
    this.settings = {
      voiceEnabled: true,
      voiceURI: '',
      voiceName: '',
      voiceLang: 'en',
      speed: 1.05,
      volume: 0.85,
      pitch: 0.95,
      style: VoiceDeliveryStyle.ADAPTIVE,
      squelchEnabled: true
    };
    this._validateSelectedVoice();
    this.saveSettings(this.settings);
    return this.settings;
  }

  /**
   * Session transition / track change cleanup.
   */
  cleanup() {
    this.stop();
    this.spokenInvestigationIds.clear();
    this.recentSpokenHashes.clear();
  }
}

export const radioAudioManager = new RadioAudioManager();
