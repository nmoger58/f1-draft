/**
 * multiplayerUIController.js
 * Workflow Coordinator and Screen Router for 2–20 Player Multiplayer.
 */

import { getSharedMultiplayerClient } from './multiplayerClient.js';
import { MultiplayerViews } from './multiplayerViews.js';
import { DRIVERS } from '../data/driverData.js';
import { ClientSnapshotAdapter } from './clientAdapter.js';

// ── Toast notification helper (non-blocking replacement for alert()) ─────────
function showToast(message, type = 'error', durationMs = 5000) {
  let container = document.getElementById('mpToastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'mpToastContainer';
    container.style.cssText = [
      'position:fixed', 'bottom:24px', 'right:24px', 'z-index:99999',
      'display:flex', 'flex-direction:column', 'gap:8px',
      'pointer-events:none', 'max-width:360px'
    ].join(';');
    document.body.appendChild(container);
  }

  const colors = { error: '#e10600', warning: '#ff9800', info: '#0066cc', success: '#28a745' };
  const icons  = { error: '⛔', warning: '⚠️', info: 'ℹ️', success: '✅' };

  const toast = document.createElement('div');
  toast.style.cssText = [
    `background:${colors[type] || colors.error}`,
    'color:#fff', 'padding:12px 16px', 'border-radius:8px',
    'font-size:13px', 'font-weight:600', 'line-height:1.4',
    'pointer-events:auto', 'box-shadow:0 4px 16px rgba(0,0,0,.5)',
    'opacity:0', 'transform:translateY(8px)',
    'transition:opacity .2s,transform .2s'
  ].join(';');
  toast.textContent = `${icons[type] || ''} ${message}`;
  container.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  });

  // Dismiss
  const dismiss = () => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    setTimeout(() => toast.isConnected && toast.remove(), 250);
  };
  toast.addEventListener('click', dismiss);
  setTimeout(dismiss, durationMs);
}

export class MultiplayerUIController {
  /**
   * @param {object} opts
   * @param {object|Function} opts.engine  RaceEngine instance, or a function returning the current one
   * @param {Function} opts.onStartRace    Called with grid config when the grid forms
   * @param {Function} opts.onReturnHome
   * @param {Function} [opts.onAbortRace]  Optional: stop/dispose the engine when leaving a race
   * @param {Function} opts.$
   */
  constructor({ engine, onStartRace, onReturnHome, onAbortRace, $ }) {
    this.engine = engine;
    this.onStartRace = onStartRace;
    this.onReturnHome = onReturnHome;
    this.onAbortRace = onAbortRace;
    this.$ = $;

    this.mountEl = $('multiplayerMount');
    this.timingTowerMount = null;
    this.client = getSharedMultiplayerClient();
    this.clientAdapter = new ClientSnapshotAdapter({ interpolationDelayMs: 100, maxBufferSizeMs: 2000 });
    this.active = false;
    this.inRace = false;
    this.currentOutcomes = null;
    this.raceSession = null;
    this.finalClassification = null;
    this.publicRooms = [];

    this._starting = false;
    this._finishReported = false;
    this._lastTelemetryAt = 0;

    this._bindClientEvents();
  }

  _getEngine() {
    return typeof this.engine === 'function' ? this.engine() : this.engine;
  }

  _bindClientEvents() {
    this.client.on('roomUpdate', (room) => {
      if (!this.active || this.inRace) return;
      if (room.state === 'waiting' || room.state === 'ready_check') {
        this.renderWaitingRoom();
      }
    });

    this.client.on('rouletteStart', (data) => {
      if (!this.active) return;
      this._starting = false;
      this.currentOutcomes = data.outcomes;
      this.renderRoulette('driver_roulette');
    });

    this.client.on('roulettePhaseChange', (data) => {
      if (!this.active) return;
      this.renderRoulette(data.phase);
    });

    this.client.on('selectionConfirmed', (data) => {
      if (!this.active) return;
      this.renderSelectionConfirmation(data.roster, data.reviewDurationMs);
    });

    this.client.on('gridFormationStart', (data) => {
      if (!this.active) return;
      this.raceSession = data.session;
      this._finishReported = false;
      this.launchMultiplayerRace(data.session);
    });

    this.client.on('raceStartLightsOut', () => {
      if (!this.inRace) return;
      const engine = this._getEngine();
      if (engine) {
        engine.state = 'racing';
        engine.flag = 'green';
        engine.warp = 2;
      }
      const lm = engine?.launchManager;
      if (lm?.triggerServerLightsOut) {
        lm.triggerServerLightsOut();
      } else {
        engine?.start?.();
      }
    });

    this.client.on('participantFinished', (data) => {
      this._handlePeerFinish(data);
    });

    this.client.on('raceGlobalFinished', (data) => {
      this.finalClassification = data.finalClassification;
      this.inRace = false;
      this.renderFinalResults(data);
    });

    this.client.on('returnToWaitingRoom', () => {
      this._clearResultsTimer();
      this._resetRaceState();
      this.renderWaitingRoom();
    });

    this.client.on('rematchAccepted', () => {
      this._clearResultsTimer();
      this._resetRaceState();
      this.renderWaitingRoom();
    });

    this.client.on('peerTelemetry', (data) => {
      if (this.clientAdapter && data && data.participantId) {
        const t = data.telemetry || data;
        this.clientAdapter.pushSnapshot({
          sequenceNumber: (this._clientSeq = (this._clientSeq || 0) + 1),
          serverTimestamp: Date.now(),
          cars: {
            [data.participantId]: {
              id: data.participantId,
              s: t.s,
              v: t.v,
              lat: t.lat,
              lap: t.lap,
              heading: t.heading,
              tyreLife: t.tyreLife
            }
          }
        });
      }
      this._handlePeerTelemetry(data);
    });

    this.client.on('roomSnapshot', (snapshot) => {
      if (this.clientAdapter && snapshot) {
        this.clientAdapter.pushSnapshot(snapshot);
      }
    });

    // Server aborted the start sequence; room is back in WAITING
    this.client.on('startFailed', ({ error }) => {
      this._starting = false;
      this._resetRaceState();
      showToast(`Race could not start: ${error || 'Unknown server error'}`, 'error');
      this.renderWaitingRoom();
    });

    // Removed from room, or session expired during a disconnect
    this.client.on('kicked', ({ reason }) => {
      if (!this.active) return;
      this._resetRaceState();
      showToast(reason || 'You were removed from the room', 'warning');
      this.openHub();
    });

    this.client.on('reconnected', (room) => {
      if (!this.active) return;
      if (room.state === 'waiting' || room.state === 'ready_check') {
        this._resetRaceState();
        this.renderWaitingRoom();
      }
      // Mid-race reconnects keep the current race screen
    });

    this.client.on('reconnectFailed', () => {
      if (!this.active) return;
      this._resetRaceState();
      showToast('Lost connection to the server and could not reconnect.', 'error');
      this.openHub();
    });

    this.client.on('publicRoomsUpdate', (rooms) => {
      this.publicRooms = rooms;
      if (this.active && !this.inRace && !this.client.currentRoom) {
        this._renderPublicGrid();
      }
    });
  }

  _renderPublicGrid() {
    const gridEl = this.mountEl.querySelector('#mpPublicRoomsGrid');
    if (gridEl) {
      MultiplayerViews.renderPublicRoomsList(
        gridEl,
        this.publicRooms,
        (roomId) => this.handleDirectJoin(roomId),
        () => this.openCreateModal('public')
      );
    }
  }

  _resetRaceState() {
    this._clearResultsTimer();
    this.client.stopPing?.();
    if (this.clientAdapter) this.clientAdapter.reset();
    const wasRacing = this.inRace;
    this.inRace = false;
    this.currentOutcomes = null;
    this.raceSession = null;
    this.finalClassification = null;
    this._finishReported = false;
    if (this.timingTowerMount) this.timingTowerMount.innerHTML = '';
    document.body.classList.remove('multiplayer-in-race');
    const simView = document.getElementById('simulatorView');
    if (simView) simView.style.display = 'none';
    const engine = this._getEngine();
    if (engine) {
      engine.state = 'waiting';
    }
    if (wasRacing && typeof this.onAbortRace === 'function') {
      try { this.onAbortRace(); } catch (err) { console.warn('onAbortRace failed:', err); }
    }
  }

  // ── Mode Entry & Hub ───────────────────────────────────────────────────────

  async openHub() {
    this.active = true;
    this.inRace = false;
    this._showMount();

    MultiplayerViews.renderHub(this.mountEl, {
      rooms: this.publicRooms || [],
      connected: this.client.connected,
      onCreateCustomClick: () => this.openCreateModal('custom'),
      onCreatePublicClick: () => this.openCreateModal('public'),
      onJoinPrivateClick: (prefillCode) => this.openJoinModal(prefillCode),
      onDirectJoinPublic: (roomId) => this.handleDirectJoin(roomId),
      onRefreshRooms: async () => {
        try {
          this.publicRooms = await this.client.getPublicRooms();
          return this.publicRooms;
        } catch (err) {
          console.warn('Could not refresh rooms:', err);
          return [];
        }
      },
      onBackClick: () => this.exitToMain()
    });

    try {
      this.publicRooms = await this.client.getPublicRooms();
      if (this.active && !this.inRace && !this.client.currentRoom) {
        this._renderPublicGrid();
      }
    } catch (err) {
      console.warn('Initial public rooms fetch failed:', err);
    }
  }

  handleDirectJoin(roomId) {
    const room = (this.publicRooms || []).find(r => r.roomId === roomId);
    if (!room) {
      showToast('Room is no longer available.', 'warning');
      this.openHub();
      return;
    }

    let savedName = this.client.savedSession?.displayName;
    if (!savedName && typeof localStorage !== 'undefined') {
      try { savedName = localStorage.getItem('f1_player_name') || ''; } catch (_) {}
    }

    if (savedName) {
      this._executeDirectJoin(roomId, savedName);
    } else {
      MultiplayerViews.renderDirectJoinModal(this.mountEl, {
        room,
        onJoin: async ({ roomId, displayName }) => {
          if (typeof localStorage !== 'undefined') {
            try { localStorage.setItem('f1_player_name', displayName); } catch (_) {}
          }
          await this._executeDirectJoin(roomId, displayName);
        },
        onCancel: () => this.openHub()
      });
    }
  }

  async _executeDirectJoin(roomId, displayName) {
    try {
      const res = await this.client.joinPublicRoom(roomId, displayName);
      if (res.success) {
        this.renderWaitingRoom();
      } else {
        const errBox = this.mountEl.querySelector('#mpDirectJoinError') || this.mountEl.querySelector('#mpCreateError');
        if (errBox) {
          errBox.textContent = res.error || 'Failed to join room';
          errBox.style.display = 'block';
        } else {
          alert(`Cannot join race: ${res.error || 'Unknown error'}`);
          this.openHub();
        }
      }
    } catch (err) {
      console.error('Error during direct join:', err);
      showToast(`Failed to connect to room server: ${err.message || ''}`, 'error');
    }
  }

  openCreateModal(defaultType = 'custom') {
    MultiplayerViews.renderCreateModal(this.mountEl, {
      defaultType,
      onSubmit: async (options) => {
        const errBox = this.mountEl.querySelector('#mpCreateError');
        const submitBtn = this.mountEl.querySelector('#btnMpCreateSubmit');
        const resetBtn = () => {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'CREATE & OPEN WAITING ROOM';
          }
        };
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'CREATING ROOM...';
        }
        try {
          const res = await this.client.createRoom(options);
          if (res && res.success) {
            this.renderWaitingRoom();
          } else {
            if (errBox) {
              errBox.textContent = (res && res.error) ? res.error : 'Failed to create room. Please try again.';
              errBox.style.display = 'block';
            }
            resetBtn();
          }
        } catch (err) {
          console.error('Error creating room:', err);
          if (errBox) {
            errBox.textContent = `Server connection error: ${err.message || 'Check if server is running on port 8765'}`;
            errBox.style.display = 'block';
          }
          resetBtn();
        }
      },
      onCancel: () => this.openHub()
    });
  }

  openJoinModal(prefillCode = '') {
    MultiplayerViews.renderJoinModal(this.mountEl, {
      prefillCode,
      onJoin: async ({ roomId, displayName }) => {
        const errBox = this.mountEl.querySelector('#mpJoinError');
        const submitBtn = this.mountEl.querySelector('#btnMpJoinSubmit');
        const resetBtn = () => {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'JOIN ROOM';
          }
        };
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'CONNECTING...';
        }
        try {
          const res = await this.client.joinRoom(roomId, displayName);
          if (res && res.success) {
            this.renderWaitingRoom();
          } else {
            if (errBox) {
              errBox.textContent = (res && res.error) ? res.error : 'Room not found or full';
              errBox.style.display = 'block';
            }
            resetBtn();
          }
        } catch (err) {
          console.error('Error joining room:', err);
          if (errBox) {
            errBox.textContent = `Server connection error: ${err.message || 'Check if server is running on port 8765'}`;
            errBox.style.display = 'block';
          }
          resetBtn();
        }
      },
      onCancel: () => this.openHub()
    });
  }

  // ── Waiting Room ───────────────────────────────────────────────────────────

  renderWaitingRoom() {
    this._clearResultsTimer();
    if (!this.client.currentRoom) {
      this.openHub();
      return;
    }

    this._showMount();
    const simView = document.getElementById('simulatorView');
    if (simView) simView.style.display = 'none';
    document.body.classList.remove('multiplayer-in-race');
    MultiplayerViews.renderWaitingRoom(this.mountEl, {
      room: this.client.currentRoom,
      myParticipant: this.client.myParticipant,
      onToggleReady: async (ready) => {
        try {
          const res = await this.client.setReady(ready);
          if (res && !res.success && res.error) showToast(res.error, 'warning');
        } catch (err) {
          showToast(`Could not update ready state: ${err.message}`, 'error');
        }
      },
      onStartRace: async () => {
        if (this._starting) return; // ignore double-clicks
        this._starting = true;
        try {
          const res = await this.client.startRace();
          if (!res.success) {
            this._starting = false;
            showToast(`Cannot start race: ${res.error || 'Unknown error'}`, 'error');
          }
          // On success, ROULETTE_START arrives and clears _starting.
          // Safety release in case that broadcast never arrives.
          setTimeout(() => { this._starting = false; }, 5000);
        } catch (err) {
          this._starting = false;
          showToast(`Cannot start race: ${err.message}`, 'error');
        }
      },
      onLeaveRoom: async () => {
        await this.client.leaveRoom();
        this._resetRaceState();
        this.openHub();
      }
    });
  }

  // ── Selection Roulette ─────────────────────────────────────────────────────

  renderRoulette(phase) {
    if (!this.currentOutcomes) return;
    this._showMount();

    const participants = Object.values(this.currentOutcomes.participants || {});
    let myIdx = participants.findIndex(p => p.participantId === this.client.myParticipant?.participantId);
    if (myIdx === -1) myIdx = 0;

    MultiplayerViews.renderRouletteScreen(this.mountEl, {
      phase,
      outcomes: this.currentOutcomes,
      currentParticipantIndex: myIdx,
      onBackToLobby: async () => {
        if (confirm('Leave current multiplayer room?')) {
          await this.client.leaveRoom();
          this._resetRaceState();
          this.openHub();
        }
      }
    });
  }

  renderSelectionConfirmation(roster, reviewDurationMs) {
    this._showMount();
    MultiplayerViews.renderSelectionConfirmation(this.mountEl, {
      roster,
      reviewDurationMs,
      onBackToLobby: async () => {
        if (confirm('Leave current multiplayer room?')) {
          await this.client.leaveRoom();
          this._resetRaceState();
          this.openHub();
        }
      }
    });
  }

  // ── Race Launch & Full-Field Finish ────────────────────────────────────────

  launchMultiplayerRace(session) {
    this.inRace = true;
    this._hideMount();

    const myId = this.client.myParticipant?.participantId;

    const customGridDrivers = Object.values(session.cars)
      .sort((a, b) => (a.gridPos || 0) - (b.gridPos || 0))
      .map(c => {
        const fullDriver = DRIVERS.find(d => d.code === c.driver?.code) || c.driver || {};
        return {
          ...fullDriver,
          ...c.driver,
          participantId: c.id,
          displayName: c.displayName,
          isAI: c.isAI,
          // Pass AI pace multiplier so the engine can apply difficulty correctly
          aiPaceMultiplier: c.aiPaceMultiplier ?? 1.0,
          // Engine must copy these onto its car objects:
          isLocalPlayer: !c.isAI && c.id === myId,
          isRemotePeer: !c.isAI && c.id !== myId
        };
      });

    let playerIdx = customGridDrivers.findIndex(d => d.isLocalPlayer);
    if (playerIdx === -1) playerIdx = 0;

    try {
      this.onStartRace({
        circuitId: session.circuitId,
        laps: session.totalLaps,
        customGridDrivers,
        playerCarIdx: playerIdx,
        isMultiplayer: true,
        warp: session.simSpeed || 2
      });
    } catch (err) {
      console.error('onStartRace failed:', err);
      showToast(`Could not set up the race: ${err.message}`, 'error');
      this._resetRaceState();
      this.renderWaitingRoom();
      return;
    }

    this._mountTimingTower();

    if (this.clientAdapter) {
      this.clientAdapter.reset();
      const engine = this._getEngine();
      if (engine?.track?.length) {
        this.clientAdapter.circuitLength = engine.track.length;
      }
    }
    this.client.startPing?.(2000);
  }

  _mountTimingTower() {
    let towerEl = document.getElementById('mpTimingTowerMount');
    if (!towerEl) {
      towerEl = document.createElement('div');
      towerEl.id = 'mpTimingTowerMount';
      const simView = document.getElementById('simulatorView');
      if (simView) simView.appendChild(towerEl);
    }
    this.timingTowerMount = towerEl;
  }

  updateLiveTiming(cars, currentLap, totalLaps) {
    if (!this.inRace || !this.timingTowerMount) return;
    MultiplayerViews.renderTimingTower(this.timingTowerMount, {
      cars,
      myParticipantId: this.client.myParticipant?.participantId,
      currentLap,
      totalLaps
    });
  }

  /**
   * Applies smooth Hermite spline interpolated positions and headings to remote peer cars.
   * Call once per frame in the main rendering/simulation loop.
   * @param {Array<object>} cars
   */
  applyInterpolatedState(cars) {
    if (!this.inRace || !Array.isArray(cars) || !this.clientAdapter) return;
    const interpCars = this.clientAdapter.evaluate();
    if (!interpCars) return;
    for (const car of cars) {
      if (car.isRemotePeer && car.participantId) {
        const state = interpCars[car.participantId];
        if (state) {
          car.d = state.s;
          car.s = state.s;
          car.v = state.v;
          car.lat = state.lat;
          car.lap = state.lap;
          if (typeof state.heading === 'number') {
            car.rot = state.heading;
          }
          if (typeof state.tyreLife === 'number' && car.tyreModel) {
            car.tyreModel.wearPercent = (1 - state.tyreLife) * 100;
          }
        }
      }
    }
  }

  /**
   * Returns live network diagnostics (RTT, jitter, packet loss %, buffer depth, etc.)
   * @returns {object|null}
   */
  getNetworkDiagnostics() {
    return this.clientAdapter ? this.clientAdapter.getDiagnostics() : null;
  }

  /**
   * Call from your engine when the LOCAL player crosses the finish line.
   * Without this the server never learns the human finished and the room
   * never reaches the results screen.
   */
  async reportLocalFinish(finishTime, bestLap) {
    if (!this.inRace || this._finishReported) return;
    this._finishReported = true;
    try {
      const res = await this.client.finishRace(finishTime, bestLap);
      if (!res || !res.success) {
        console.warn('Finish report rejected:', res?.error);
        this._finishReported = false; // allow a retry
      }
    } catch (err) {
      console.warn('Finish report failed:', err);
      this._finishReported = false;
    }
  }

  /**
   * Call every frame from your engine with the local car; sends ~10 times/sec.
   */
  sendLocalTelemetry(car) {
    if (!this.inRace || !car) return;
    const now = performance.now();
    if (now - this._lastTelemetryAt < 100) return;
    this._lastTelemetryAt = now;
    this.client.sendTelemetry({
      telemetry: { s: car.s, v: car.v, lat: car.lat, lap: car.lap }
    });
  }

  _handlePeerFinish(data) {
    const pos = data.finishPosition;
    const name = data.displayName || 'Unknown';
    const isAI = !!data.isAI;
    const finished = data.finishedCount;
    const total = data.totalParticipants;

    // Don't show toast for AI finishes to avoid spam
    if (!isAI && this.inRace) {
      const medal = pos === 1 ? '🥇' : pos === 2 ? '🥈' : pos === 3 ? '🥉' : `P${pos}`;
      showToast(`${medal} ${name} finished! (${finished}/${total} classified)`, 'info', 4000);
    }
    console.log(`🏁 ${name} finished P${pos} (${finished}/${total})`);
  }

  _handlePeerTelemetry(data) {
    if (!this.inRace) return;
    const engine = this._getEngine();
    if (!engine) return;
    // Accept both { telemetry: {...} } and top-level fields
    const t = data.telemetry || data;
    if (typeof t.s !== 'number') return;
    const car = engine.cars?.find(c => c.participantId === data.participantId);
    if (car && car.isRemotePeer) {
      car.s = t.s;
      car.d = t.s;
      car.v = t.v;
      car.lat = t.lat;
      car.lap = t.lap;
    }
  }

  // ── Results & Rematch ──────────────────────────────────────────────────────

  renderFinalResults(data = {}) {
    this._clearResultsTimer();
    this._showMount();
    if (this.timingTowerMount) {
      this.timingTowerMount.innerHTML = '';
    }

    const simView = document.getElementById('simulatorView');
    if (simView) simView.style.display = 'none';
    document.body.classList.remove('multiplayer-in-race');

    const durationMs = data.durationMs || 12000;
    const returnAt = data.returnAt || (Date.now() + durationMs);

    MultiplayerViews.renderFinalResults(this.mountEl, {
      classification: this.finalClassification || [],
      isHost: !!this.client.myParticipant?.isHost,
      myParticipantId: this.client.myParticipant?.participantId,
      durationMs,
      returnAt,
      onReturnToLobby: async () => {
        try {
          await this.client.returnToLobby();
        } catch (err) {
          console.warn('returnToLobby failed:', err);
        }
      },
      onRematch: async () => {
        try {
          await this.client.returnToLobby();
        } catch (err) {
          console.warn('returnToLobby failed:', err);
        }
      },
      onReturnHub: async () => {
        this._clearResultsTimer();
        await this.client.leaveRoom();
        this._resetRaceState();
        this.openHub();
      }
    });

    // Start local visual countdown
    this._resultsInterval = setInterval(() => {
      const timerEl = this.mountEl.querySelector('#mpResultsTimer');
      if (!timerEl) {
        this._clearResultsTimer();
        return;
      }
      const remaining = Math.max(0, Math.round((returnAt - Date.now()) / 1000));
      timerEl.textContent = remaining;
      if (remaining <= 0) {
        this._clearResultsTimer();
      }
    }, 500);
  }

  _clearResultsTimer() {
    if (this._resultsInterval) {
      clearInterval(this._resultsInterval);
      this._resultsInterval = null;
    }
  }

  async exitToMain() {
    this.active = false;
    this._resetRaceState();
    try { await this.client.leaveRoom(); } catch (_) {}
    this._hideMount();
    this.onReturnHome();
  }

  _showMount() {
    if (this.mountEl) this.mountEl.style.display = 'block';
  }

  _hideMount() {
    if (this.mountEl) this.mountEl.style.display = 'none';
  }
}

let _sharedController = null;
export function getSharedMultiplayerController(options) {
  if (!_sharedController && options) {
    _sharedController = new MultiplayerUIController(options);
  }
  return _sharedController;
}