/**
 * landingAudio.js
 * Cinematic Landing Page Soundtrack & Ambient Audio Controller.
 *
 * Implements:
 *   - Continuous looping playlist of installed soundtrack audios:
 *       1. 2 Chainz & Wiz Khalifa - "We Own It"
 *       2. Don Toliver ft. Doja Cat - "Lose My Mind" (From F1® The Movie)
 *       3. Jake Gyllenhaal - "'Till I Collapse"
 *       4. Machine Gun Kelly ft. Ester Dean - "Invincible"
 *   - Automatic track advancement on track end (loops infinitely 1 -> 2 -> 3 -> 4 -> 1)
 *   - Next (⏭) and Previous (⏮) interactive track navigation
 *   - Autoplay policy compliance with graceful activation on first user gesture
 *   - Smooth volume fading on view transitions (pauses during live racing)
 *   - Persistent track and mute preference across sessions (localStorage)
 *   - Interactive visualizer with animated equalizer bars
 */

export const SOUNDTRACK_PLAYLIST = [
  {
    id: 0,
    title: 'We Own It',
    artist: '2 Chainz & Wiz Khalifa',
    tag: 'FAST & FURIOUS ANTHEM',
    src: '/assets/track1_we_own_it.mp3'
  },
  {
    id: 1,
    title: 'Lose My Mind',
    artist: 'Don Toliver ft. Doja Cat',
    tag: 'F1® THE MOVIE SOUNDTRACK',
    src: '/assets/track2_lose_my_mind.mp3'
  },
  {
    id: 2,
    title: "'Till I Collapse",
    artist: 'Jake Gyllenhaal',
    tag: 'HIGH-TEMPO ADRENALINE',
    src: '/assets/track3_till_i_collapse.mp3'
  },
  {
    id: 3,
    title: 'Invincible',
    artist: 'MGK ft. Ester Dean',
    tag: 'MOTORSPORT PODIUM ANTHEM',
    src: '/assets/track4_invincible.mp3'
  }
];

const STORAGE_KEY_ENABLED = 'f1_landing_music_enabled';
const STORAGE_KEY_TRACK = 'f1_landing_music_track_idx';
const DEFAULT_VOLUME = 0.45;

export class LandingAudioController {
  constructor() {
    this.audio = null;
    this.playlist = SOUNDTRACK_PLAYLIST;
    this.currentIndex = 0;
    this.isEnabled = true;
    this.isPlaying = false;
    this.hasUserInteracted = false;
    this.autoplayBlocked = false;
    this.uiBindings = [];
    this._fadeInterval = null;
    this._unlockHandler = null;

    if (typeof window !== 'undefined') {
      // By default ensure soundtrack is enabled so it starts playing immediately
      const storedEnabled = localStorage.getItem(STORAGE_KEY_ENABLED);
      this.isEnabled = storedEnabled !== null ? storedEnabled === 'true' : true;

      const storedTrack = parseInt(localStorage.getItem(STORAGE_KEY_TRACK), 10);
      if (!isNaN(storedTrack) && storedTrack >= 0 && storedTrack < this.playlist.length) {
        this.currentIndex = storedTrack;
      }

      this._initAudio();
    }
  }

  _initAudio() {
    try {
      this.audio = new Audio();
      this.audio.preload = 'auto';
      this.audio.autoplay = true; // Request immediate autoplay from the browser
      this.audio.loop = false;    // We handle track looping sequentially
      this.audio.volume = DEFAULT_VOLUME;

      this._setAudioSource(this.currentIndex);

      this.audio.addEventListener('play', () => {
        this.isPlaying = true;
        this.autoplayBlocked = false;
        this._removeAutoplayPrompt();
        this._updateUI();
      });

      this.audio.addEventListener('pause', () => {
        this.isPlaying = false;
        this._updateUI();
      });

      // Loop to next track automatically when current song finishes
      this.audio.addEventListener('ended', () => {
        this.next(true);
      });

      this.audio.addEventListener('error', (e) => {
        console.warn('Audio playback error on track', this.currentIndex, e);
        const curTrack = this.playlist[this.currentIndex];
        if (curTrack && curTrack.fallbackSrc && this.audio.src !== curTrack.fallbackSrc) {
          this.audio.src = curTrack.fallbackSrc;
          if (this.isEnabled) this.audio.play().catch(() => {});
        }
      });

      // Comprehensive user gesture listeners for instant autoplay unlock
      const unlockEvents = [
        'click', 'pointerdown', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'keydown', 'wheel', 'scroll', 'pointermove'
      ];

      this._unlockHandler = (e) => {
        this.hasUserInteracted = true;
        if (this.canPlay()) {
          if (this.isEnabled && !this.isPlaying) {
            this.play(true);
          }
        } else {
          // If racing is underway, strictly enforce soundtrack silence
          if (this.isPlaying) {
            this.pause(true);
          }
        }
      };

      for (const ev of unlockEvents) {
        window.addEventListener(ev, this._unlockHandler, { capture: true, passive: true });
        document.addEventListener(ev, this._unlockHandler, { capture: true, passive: true });
      }

      // Also check immediately when window gains focus
      window.addEventListener('focus', () => {
        if (this.canPlay()) {
          if (this.isEnabled && !this.isPlaying) {
            this.play(true);
          }
        } else {
          if (this.isPlaying) {
            this.pause(true);
          }
        }
      }, { passive: true });
    } catch (e) {
      console.warn('Landing audio initialization error:', e);
    }
  }

  _removeUnlockListeners() {
    if (!this._unlockHandler || typeof window === 'undefined') return;
    const unlockEvents = [
      'click', 'pointerdown', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'keydown', 'wheel', 'scroll', 'pointermove'
    ];
    for (const ev of unlockEvents) {
      window.removeEventListener(ev, this._unlockHandler, { capture: true });
      document.removeEventListener(ev, this._unlockHandler, { capture: true });
    }
    this._unlockHandler = null;
  }

  _showAutoplayPrompt() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('lpAutoplayPrompt')) return;

    // Only display prompt on the landing page view if not already playing
    const landingView = document.getElementById('landingView');
    if (!landingView || landingView.style.display === 'none') return;

    const prompt = document.createElement('div');
    prompt.id = 'lpAutoplayPrompt';
    prompt.className = 'lp-autoplay-prompt';
    prompt.setAttribute('role', 'button');
    prompt.setAttribute('tabindex', '0');
    prompt.setAttribute('title', 'Click to activate soundtrack');
    prompt.innerHTML = `
      <span class="lp-prompt-pulse">🔊</span>
      <span class="lp-prompt-text">Formula 1 Soundtrack Ready — Click anywhere to play</span>
      <button type="button" class="lp-prompt-btn" id="lpPromptBtn">▶ PLAY NOW</button>
    `;

    const handlePromptClick = (e) => {
      e.stopPropagation();
      this.hasUserInteracted = true;
      this.isEnabled = true;
      this.play(true);
      this._removeAutoplayPrompt();
    };

    prompt.addEventListener('click', handlePromptClick);
    prompt.querySelector('#lpPromptBtn')?.addEventListener('click', handlePromptClick);

    document.body.appendChild(prompt);
  }

  _removeAutoplayPrompt() {
    if (typeof document === 'undefined') return;
    const prompt = document.getElementById('lpAutoplayPrompt');
    if (prompt) {
      prompt.style.opacity = '0';
      prompt.style.transform = 'translateX(-50%) translateY(20px)';
      prompt.style.transition = 'all 0.3s ease';
      setTimeout(() => {
        prompt.remove();
      }, 300);
    }
  }

  _setAudioSource(index) {
    if (!this.audio) return;
    const track = this.playlist[index];
    if (!track) return;

    this.audio.src = track.src;
    this.audio.load();
  }

  /**
   * Returns true if soundtrack audio is allowed to play.
   * Plays during menus, setup wizards, and pre-race until the race start lights appear on the gantry.
   */
  /**
   * Returns true if soundtrack audio is allowed to play.
   * Plays during menus, setup wizards, and pre-race before the race start sequence.
   * STRICTLY PROHIBITED anytime racing is going on or active on track!
   */
  canPlay() {
    if (typeof document === 'undefined' || !document.getElementById) return true;

    // 1. If simulator view is active, inspect on-track race status
    const simView = document.getElementById('simulatorView');
    if (simView && simView.style.display !== 'none') {
      // 1a. Starting gantry sequence active -> Race is starting/ongoing on track
      const gantry = document.getElementById('gantryOverlay');
      if (gantry && gantry.style.display !== 'none' && !gantry.classList.contains('gantry-hidden')) {
        return false;
      }

      // 1b. Check if setup modal (Quick Race wizard / entry portal) is open
      const qrMount = document.getElementById('quickRaceMount');
      const isWizardOpen = qrMount && qrMount.style.display !== 'none' && qrMount.querySelector('.qr-entry-card, .qr-wizard-card, .f1-modal-backdrop, .qr-portal-container, .qr-wizard-container, .qr-step-container');
      // If on simulator view and setup wizard modal is NOT open, racing is active on track!
      if (!isWizardOpen) {
        return false;
      }
    }

    // 2. Global engine / simulation state flags
    if (typeof window !== 'undefined') {
      if (window._isRaceActive) return false;
      if (window.raceEngine) {
        const s = window.raceEngine.state;
        if (s === 'racing' || s === 'safety_car' || s === 'virtual_safety_car' || s === 'yellow' || s === 'starting') {
          return false;
        }
      }
    }

    return true;
  }

  getCurrentTrack() {
    return this.playlist[this.currentIndex] || this.playlist[0];
  }

  /**
   * Start or resume soundtrack playback with smooth fade-in.
   * @param {boolean} [immediate=false]
   */
  play(immediate = false) {
    if (!this.audio || !this.isEnabled || !this.canPlay()) return;
    clearInterval(this._fadeInterval);

    this.audio.volume = immediate ? DEFAULT_VOLUME : 0.05;
    const playPromise = this.audio.play();

    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          this.isPlaying = true;
          this.autoplayBlocked = false;
          this._removeUnlockListeners();
          this._removeAutoplayPrompt();
          this._updateUI();

          if (!immediate) {
            let cur = this.audio.volume;
            this._fadeInterval = setInterval(() => {
              if (!this.audio || !this.isPlaying) {
                clearInterval(this._fadeInterval);
                return;
              }
              cur = Math.min(DEFAULT_VOLUME, cur + 0.04);
              this.audio.volume = cur;
              if (cur >= DEFAULT_VOLUME) clearInterval(this._fadeInterval);
            }, 50);
          }
        })
        .catch((err) => {
          console.warn('Audio play rejection:', err?.name, err?.message);
          this.isPlaying = false;
          if (err && (err.name === 'NotAllowedError' || err.name === 'AbortError')) {
            this.autoplayBlocked = true;
            this._showAutoplayPrompt();
          }
          this._updateUI();
        });
    }
  }

  /**
   * Pause soundtrack immediately.
   * @param {boolean} [immediate=true]
   */
  pause(immediate = true) {
    if (!this.audio) return;
    clearInterval(this._fadeInterval);

    if (immediate) {
      this.audio.pause();
      this.isPlaying = false;
      this._updateUI();
      return;
    }

    let cur = this.audio.volume;
    this._fadeInterval = setInterval(() => {
      if (!this.audio) {
        clearInterval(this._fadeInterval);
        return;
      }
      cur = Math.max(0, cur - 0.10);
      this.audio.volume = cur;
      if (cur <= 0) {
        clearInterval(this._fadeInterval);
        this.audio.pause();
        this.isPlaying = false;
        this._updateUI();
      }
    }, 30);
  }

  /**
   * Toggle music enabled/disabled.
   * If currently playing, clicking pauses/mutes.
   * If not playing (either paused or blocked by autoplay), clicking UNMUTES and starts playing!
   * @returns {boolean}
   */
  toggle() {
    if (this.isPlaying) {
      this.pause(true);
      this.isEnabled = false;
    } else {
      if (!this.canPlay()) {
        // Racing is active on track: soundtrack music is strictly prohibited
        this.pause(true);
        return false;
      }
      this.isEnabled = true;
      this.play(true);
    }
    try {
      localStorage.setItem(STORAGE_KEY_ENABLED, String(this.isEnabled));
    } catch (_) {}
    this._updateUI();
    return this.isEnabled;
  }

  /**
   * Skip to the next track in the playlist.
   * @param {boolean} [autoPlay=true]
   */
  next(autoPlay = true) {
    this.currentIndex = (this.currentIndex + 1) % this.playlist.length;
    this._onTrackChange(autoPlay);
  }

  /**
   * Go to the previous track in the playlist.
   * @param {boolean} [autoPlay=true]
   */
  prev(autoPlay = true) {
    if (this.audio && this.audio.currentTime > 3.0) {
      // If played for more than 3 seconds, restart current track
      this.audio.currentTime = 0;
      if (this.isEnabled && autoPlay) this.play(true);
      return;
    }
    this.currentIndex = (this.currentIndex - 1 + this.playlist.length) % this.playlist.length;
    this._onTrackChange(autoPlay);
  }

  /**
   * Select and play a specific track by index.
   * @param {number} index
   * @param {boolean} [autoPlay=true]
   */
  selectTrack(index, autoPlay = true) {
    if (index >= 0 && index < this.playlist.length) {
      this.currentIndex = index;
      this._onTrackChange(autoPlay);
    }
  }

  _onTrackChange(autoPlay) {
    try {
      localStorage.setItem(STORAGE_KEY_TRACK, String(this.currentIndex));
    } catch (_) {}

    this._setAudioSource(this.currentIndex);
    this._updateUI();

    if (this.isEnabled && (autoPlay || this.isPlaying)) {
      this.play(true);
    }
  }

  /**
   * Bind DOM buttons to sync with audio and playlist state.
   * @param {object} elements
   */
  bindUI(elements) {
    if (typeof document !== 'undefined') {
      this.uiBindings = this.uiBindings.filter(b => b.btn && b.btn.isConnected);
    }
    this.uiBindings.push(elements);
    this._updateUI();
  }

  _updateUI() {
    const curTrack = this.getCurrentTrack();

    for (const b of this.uiBindings) {
      if (b.btn) {
        b.btn.classList.toggle('playing', this.isPlaying);
        b.btn.classList.toggle('muted', !this.isEnabled);
        b.btn.classList.toggle('autoplay-pending', this.autoplayBlocked && !this.isPlaying);
      }
      if (b.label) {
        b.label.textContent = this.isEnabled
          ? curTrack.title.toUpperCase()
          : 'MUTED';
        b.label.title = `${curTrack.title} — ${curTrack.artist}`;
      }
      if (b.icon) {
        // Speaker ON by default (🔊), muted (🔇)
        b.icon.textContent = this.isEnabled ? '🔊' : '🔇';
      }
      if (b.drawerBtn) {
        b.drawerBtn.textContent = this.isEnabled
          ? `🔊 Soundtrack (${curTrack.title})`
          : '🔇 Soundtrack (Muted)';
      }
      if (b.trackTag) {
        b.trackTag.textContent = curTrack.tag;
      }
      if (b.trackArtist) {
        b.trackArtist.textContent = curTrack.artist;
      }
    }
  }
}

let _landingAudioInstance = null;

export function getLandingAudio() {
  if (!_landingAudioInstance) {
    _landingAudioInstance = new LandingAudioController();
  }
  return _landingAudioInstance;
}
