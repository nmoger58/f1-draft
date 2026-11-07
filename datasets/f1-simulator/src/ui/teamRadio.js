/**
 * teamRadio.js
 * Cockpit Team Radio Audio-Visual Presentation & Interactive HUD Card.
 *
 * Implements:
 *   - 3 Radio Modes: 'FULL', 'ESSENTIAL', 'OFF' with instant runtime switching
 *   - Persistent radio preferences in localStorage
 *   - Interactive Active Radio HUD Card:
 *       Pops up on cockpit view with engineer badge, category pill, message,
 *       and clickable action buttons (e.g., "[ BOX THIS LAP (B) ]")
 *   - Multi-channel Audio:
 *       1. Synthetic Web Audio radio squelch chirp
 *       2. Optional speech synthesis (Web Speech API) for authentic vocal engineer instructions
 *   - Live radio feed with timestamped history and category filter tabs
 */

import { RadioPriority, RadioMode } from '../strategy/raceEngineer.js';
import { radioAudioManager, AudioPriority, VoiceDeliveryStyle } from './radioAudioManager.js';

const STORAGE_KEY_RADIO = 'f1_radio_settings_v2';

class RadioSettingsManager {
  static load() {
    const defaults = {
      mode: RadioMode.FULL,
      soundEnabled: true,
      voiceEnabled: true,
      volume: 0.85
    };

    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(STORAGE_KEY_RADIO);
        if (raw) return { ...defaults, ...JSON.parse(raw) };
      }
    } catch (e) {
      console.warn('Radio settings read failed:', e);
    }
    return defaults;
  }

  static save(settings) {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY_RADIO, JSON.stringify(settings));
      }
    } catch (e) {
      console.warn('Radio settings save failed:', e);
    }
  }
}

class RadioSoundEngine {
  constructor() {
    this.settings = RadioSettingsManager.load();
    // Sync voiceEnabled with radioAudioManager
    if (this.settings.voiceEnabled !== undefined) {
      radioAudioManager.settings.voiceEnabled = this.settings.voiceEnabled;
    }
  }

  /** Play subtle radio communication squelch chirp */
  playChirp() {
    if (!this.settings.soundEnabled) return;
    radioAudioManager.playIntroChirp();
  }

  /** Vocalize message via centralized prioritized Radio Audio Manager */
  speak(text, options = {}) {
    if (!this.settings.voiceEnabled) return;
    radioAudioManager.speak(text, options);
  }
}

const soundEngine = new RadioSoundEngine();
const MAX_RADIO_MSGS = 28;
let radioHistory = [];
let activeCategory = 'all';
let actionCallback = null;
let activeCardTimeout = null;

/**
 * Configure callback when user clicks a radio action button.
 * @param {Function} callback – fn(action)
 */
export function setRadioActionCallback(callback) {
  actionCallback = callback;
}

/**
 * Get current radio settings.
 */
export function getRadioSettings() {
  return soundEngine.settings;
}

/**
 * Update and persist radio settings.
 * @param {object} partial
 */
export function updateRadioSettings(partial) {
  soundEngine.settings = { ...soundEngine.settings, ...partial };
  if (partial.voiceEnabled !== undefined) {
    radioAudioManager.settings.voiceEnabled = partial.voiceEnabled;
    radioAudioManager.saveSettings({ voiceEnabled: partial.voiceEnabled });
  }
  if (partial.volume !== undefined) {
    radioAudioManager.settings.volume = partial.volume;
    radioAudioManager.saveSettings({ volume: partial.volume });
  }
  RadioSettingsManager.save(soundEngine.settings);
  renderRadioControls();
  renderRadio();
  return soundEngine.settings;
}

/**
 * Post messages to the radio stream and display active HUD card.
 * @param {object[]} messages
 * @param {object} [options]
 * @param {string} [options.selectedDriverCode]
 */
export function postRadioMessages(messages, options = {}) {
  if (!messages || !messages.length) return;

  const currentMode = soundEngine.settings.mode;
  const selCode = options.selectedDriverCode || null;
  let latestPlayerMsg = null;
  let hasAlert = false;

  for (const m of messages) {
    if (!m.msg) continue;

    // Filter by mode
    if (currentMode === RadioMode.OFF && m.priority > RadioPriority.CRITICAL) {
      continue;
    }
    if (currentMode === RadioMode.ESSENTIAL && m.priority > RadioPriority.HIGH) {
      continue;
    }

    // Check duplicate of immediately preceding message
    const isDup = radioHistory.length > 0 && radioHistory[0].msg === m.msg;
    if (isDup) continue;

    const entry = {
      ...m,
      id: m.id || `${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      receivedAt: Date.now()
    };

    radioHistory.unshift(entry);

    if (m.priority <= RadioPriority.HIGH || m.severity === 'alert') {
      hasAlert = true;
    }

    // Track most relevant message for active HUD card display
    if (!selCode || m.driverCode === selCode || m.priority === RadioPriority.CRITICAL) {
      latestPlayerMsg = entry;
    }
  }

  if (radioHistory.length > MAX_RADIO_MSGS) {
    radioHistory = radioHistory.slice(0, MAX_RADIO_MSGS);
  }

  // Audio feedback:
  // If voice is enabled and message qualifies, soundEngine.speak handles
  // intro chirp -> live radio carrier static & engine drone -> speech -> outro chirp.
  // Otherwise, play standalone radio chirp cue so radio alerts are never missed.
  if (hasAlert || latestPlayerMsg) {
    const willSpeak = latestPlayerMsg &&
      (currentMode === RadioMode.FULL || latestPlayerMsg.priority <= RadioPriority.HIGH) &&
      soundEngine.settings.voiceEnabled;

    if (willSpeak) {
      soundEngine.speak(latestPlayerMsg.msg, {
        priority: latestPlayerMsg.priority,
        category: latestPlayerMsg.category,
        simTime: latestPlayerMsg.time,
        carState: options.carState || null
      });
    } else {
      soundEngine.playChirp();
    }
  }

  // Display active HUD popup card for player
  if (latestPlayerMsg) {
    renderActiveRadioCard(latestPlayerMsg);
  }

  renderRadio();
}

/**
 * Render the interactive Active Radio Card directly onto the cockpit HUD overlay.
 */
function renderActiveRadioCard(msg) {
  let card = document.getElementById('activeRadioCard');
  if (!card) {
    card = document.createElement('div');
    card.id = 'activeRadioCard';
    card.className = 'active-radio-card';

    // Mount inside mapwrap if present, else body
    const mount = document.querySelector('.mapwrap') || document.body;
    mount.appendChild(card);
  }

  const catIcons = {
    pit:      '🏁',
    tyre:     '🛞',
    overtake: '⚡',
    defend:   '🛡️',
    weather:  '🌧️',
    damage:   '⚠️',
    control:  '🚩',
    strategy: '🎯'
  };

  const icon = catIcons[msg.category] || '📻';
  const catLabel = (msg.category || 'RADIO').toUpperCase();

  card.innerHTML = `
    <div class="arc-header">
      <div class="arc-badge">
        <span class="arc-icon">${icon}</span>
        <span class="arc-category">${catLabel}</span>
      </div>
      <span class="arc-speaker">${msg.sender || 'Race Engineer'}</span>
      <button type="button" class="arc-close" id="btnArcClose" title="Dismiss radio message">✕</button>
    </div>
    <div class="arc-body">
      "${msg.msg}"
    </div>
    ${msg.action ? `
      <div class="arc-action-row">
        <button type="button" class="arc-action-btn" id="btnArcAction">
          ${msg.action.label || 'EXECUTE ACTION'}
        </button>
      </div>
    ` : ''}
  `;

  card.classList.remove('arc-hidden');
  card.classList.add('arc-visible');

  // Dismiss button
  card.querySelector('#btnArcClose')?.addEventListener('click', () => {
    dismissActiveRadioCard();
  });

  // Action button
  if (msg.action) {
    card.querySelector('#btnArcAction')?.addEventListener('click', () => {
      if (actionCallback) {
        actionCallback(msg.action);
      }
      dismissActiveRadioCard();
    });
  }

  // Auto-dismiss after 6.5 seconds
  if (activeCardTimeout) clearTimeout(activeCardTimeout);
  activeCardTimeout = setTimeout(() => {
    dismissActiveRadioCard();
  }, 6500);
}

/**
 * Dismiss active radio card.
 */
export function dismissActiveRadioCard() {
  const card = document.getElementById('activeRadioCard');
  if (card) {
    card.classList.remove('arc-visible');
    card.classList.add('arc-hidden');
  }
}

/**
 * Clear all radio history.
 */
export function clearRadio() {
  radioHistory = [];
  dismissActiveRadioCard();
  renderRadio();
}

/**
 * Set active filter category tab.
 */
export function setRadioFilter(category) {
  activeCategory = category;
  renderRadio();
}

/**
 * Render radio control buttons (Mode toggles, Sound, Voice).
 */
export function renderRadioControls() {
  const settings = soundEngine.settings;

  // Update mode buttons
  const modeBtns = document.querySelectorAll('.radio-mode-btn');
  modeBtns.forEach(btn => {
    const m = btn.getAttribute('data-mode');
    btn.classList.toggle('active', m === settings.mode);
  });

  // Sound toggle button
  const soundBtn = document.getElementById('radioSoundBtn');
  if (soundBtn) {
    soundBtn.textContent = settings.soundEnabled ? '🔊 SOUND ON' : '🔇 MUTED';
    soundBtn.classList.toggle('active', settings.soundEnabled);
  }

  // Voice toggle button
  const voiceBtn = document.getElementById('radioVoiceBtn');
  if (voiceBtn) {
    voiceBtn.textContent = settings.voiceEnabled ? '🗣️ VOICE ON' : '🗣️ VOICE OFF';
    voiceBtn.classList.toggle('active', settings.voiceEnabled);
  }
}

/**
 * Render live message stream inside the Team Radio panel.
 */
export function renderRadio() {
  const el = document.getElementById('teamRadioFeed');
  if (!el) return;

  const currentMode = soundEngine.settings.mode;

  let filtered = activeCategory === 'all'
    ? radioHistory
    : radioHistory.filter(m => m.category === activeCategory);

  // Apply mode filter
  if (currentMode === RadioMode.OFF) {
    filtered = filtered.filter(m => m.priority <= RadioPriority.CRITICAL);
  } else if (currentMode === RadioMode.ESSENTIAL) {
    filtered = filtered.filter(m => m.priority <= RadioPriority.HIGH);
  }

  const fmtTime = s => {
    const m = Math.floor(s / 60), r = Math.floor(s % 60);
    return m + ':' + (r < 10 ? '0' : '') + r;
  };

  const icons = {
    pit:      '🏁',
    tyre:     '🛞',
    overtake: '⚡',
    defend:   '🛡️',
    weather:  '🌧️',
    damage:   '⚠️',
    control:  '🚩',
    strategy: '🎯',
    technical:'⚙️',
    ai:       '📻'
  };

  if (!filtered.length) {
    const emptyNotice = currentMode === RadioMode.OFF
      ? '📻 Radio muted (OFF mode) &middot; critical safety alerts only'
      : '📻 Team radio frequency clear &middot; standing by';
    el.innerHTML = `<div class="radio-empty">${emptyNotice}</div>`;
    return;
  }

  el.innerHTML = filtered.map(m => `
    <div class="radio-msg radio-cat-${m.category || 'strategy'} radio-sev-${m.severity || 'info'} radio-pri-${m.priority || 3}">
      <div class="radio-msg-header">
        <span class="radio-icon">${icons[m.category] || '📻'}</span>
        <span class="radio-speaker">${m.sender || 'Race Engineer'}</span>
        <span class="radio-time">${fmtTime(m.time)}</span>
      </div>
      <div class="radio-msg-body">"${m.msg}"</div>
      ${m.action ? `
        <div class="radio-msg-action">
          <button type="button" class="radio-feed-action-btn" data-action='${JSON.stringify(m.action).replace(/'/g, "&apos;")}'>
            ${m.action.label || 'Action'}
          </button>
        </div>
      ` : ''}
    </div>
  `).join('');

  // Wire action buttons in feed
  el.querySelectorAll('.radio-feed-action-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      try {
        const raw = btn.getAttribute('data-action');
        if (raw && actionCallback) {
          const act = JSON.parse(raw);
          actionCallback(act);
        }
      } catch (err) {
        console.warn('Radio action click error:', err);
      }
    });
  });
}

// ── Voice Manager Exports for Settings Modal ────────────────────────────────
export { radioAudioManager, AudioPriority, VoiceDeliveryStyle };

export function getVoiceSettings() {
  return radioAudioManager.settings;
}

export function updateVoiceSettings(partial) {
  const updated = radioAudioManager.saveSettings(partial);
  if (partial.voiceEnabled !== undefined) {
    updateRadioSettings({ voiceEnabled: partial.voiceEnabled });
  }
  return updated;
}

export function getAvailableVoices() {
  return radioAudioManager.getAvailableVoices();
}

export function previewVoice(text) {
  return radioAudioManager.preview(text);
}

export function muteRadioVoice() {
  updateRadioSettings({ voiceEnabled: false });
  return radioAudioManager.mute();
}

export function resetVoiceDefaults() {
  const def = radioAudioManager.resetToDefaults();
  updateRadioSettings({ voiceEnabled: def.voiceEnabled });
  return def;
}
