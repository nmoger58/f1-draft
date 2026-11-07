/**
 * multiplayerClient.js
 * Client-Side Multiplayer Coordinator & WebSocket Adapter.
 *
 * Connects to the authoritative server, manages room lifecycle,
 * synchronizes the ready system, routes roulette animations, and transmits
 * high-frequency race telemetry and finish events.
 */

const WS = typeof WebSocket !== 'undefined'
  ? WebSocket
  : (typeof globalThis !== 'undefined' && globalThis.WebSocket ? globalThis.WebSocket : undefined);

function getWebSocketClass() {
  if (typeof WebSocket !== 'undefined') return WebSocket;
  if (typeof globalThis !== 'undefined' && globalThis.WebSocket) return globalThis.WebSocket;
  return WS;
}

const WS_OPEN = 1;
const WS_CONNECTING = 0;

export class MultiplayerClient {
  constructor(options = {}) {
    this.wsUrl = options.wsUrl || this._getDefaultWsUrl();
    this.ws = null;
    this.connected = false;
    this.currentRoom = null;
    this.myParticipant = null;
    this.sessionToken = null;
    this.savedSession = null;
    this.listeners = new Map();
    this._reconnectAttempts = 0;
    this._maxReconnectAttempts = 8;
    this._reconnectTimer = null;
    this._intentionalClose = false;
    this._pendingRequests = new Map();
    this._connectPromise = null;

    this._loadSavedSession();
  }

  _getDefaultWsUrl() {
    if (typeof window !== 'undefined' && window.location) {
      if (window.location.protocol === 'file:' || !window.location.hostname) {
        return 'ws://localhost:8765/';
      }
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.hostname;
      const port = window.location.port;

      if (port && port !== '8765' && ['5500', '3000', '5173', '8080', '8000'].includes(port)) {
        return `${proto}//${host}:8765/`;
      }
      return `${proto}//${window.location.host}/`;
    }
    return 'ws://localhost:8765/';
  }

  // ── Session persistence ────────────────────────────────────────────────────

  _loadSavedSession() {
    try {
      if (typeof sessionStorage !== 'undefined') {
        const raw = sessionStorage.getItem('f1_mp_session');
        if (raw) this.savedSession = JSON.parse(raw);
      }
    } catch (_) {}
  }

  _saveSession(roomId, participantId, sessionToken, displayName) {
    this.savedSession = { roomId, participantId, sessionToken, displayName };
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem('f1_mp_session', JSON.stringify(this.savedSession));
      }
    } catch (_) {}
  }

  _clearSession() {
    this.savedSession = null;
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem('f1_mp_session');
      }
    } catch (_) {}
  }

  // ── Connection Management ──────────────────────────────────────────────────

  connect() {
    const WSClass = getWebSocketClass();
    const wsOpen = WSClass ? WSClass.OPEN : WS_OPEN;
    const wsConnecting = WSClass ? WSClass.CONNECTING : WS_CONNECTING;

    if (this.ws && this.ws.readyState === wsOpen) {
      this.connected = true;
      return Promise.resolve();
    }

    if (this.ws && this.ws.readyState === wsConnecting && this._connectPromise) {
      return this._connectPromise;
    }

    this._intentionalClose = false;

    this._connectPromise = new Promise((resolve, reject) => {
      let settled = false;
      let ws;

      const fail = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this._connectPromise = null;
        reject(err);
      };

      const timeout = setTimeout(() => {
        fail(new Error(`WebSocket connection to ${this.wsUrl} timed out after 5000ms`));
        try { ws && ws.close(); } catch (_) {}
      }, 5000);

      // Detach the old socket so its late onclose can't clobber the new one
      if (this.ws) {
        const old = this.ws;
        old.onopen = old.onclose = old.onerror = old.onmessage = null;
        try { old.close(); } catch (_) {}
      }

      try {
        const ResolvedWS = getWebSocketClass();
        if (!ResolvedWS) throw new Error('WebSocket implementation not available');
        ws = new ResolvedWS(this.wsUrl);
      } catch (err) {
        return fail(err);
      }
      this.ws = ws;

      ws.onopen = () => {
        if (this.ws !== ws || settled) return;
        settled = true;
        clearTimeout(timeout);
        this.connected = true;
        this._reconnectAttempts = 0;
        this._connectPromise = null;
        this.emit('connected');
        resolve();
      };

      ws.onclose = (event) => {
        if (this.ws !== ws) return; // stale socket
        const wasConnected = this.connected;
        this.connected = false;
        this._rejectAllPending(new Error('WebSocket disconnected'));
        if (wasConnected) this.emit('disconnected');
        fail(new Error(`WebSocket closed before open (code: ${event?.code || 1006})`));
        if (wasConnected && !this._intentionalClose) this._scheduleReconnect();
      };

      ws.onerror = (err) => {
        if (this.ws !== ws) return;
        this.emit('error', err);
        fail(new Error(`WebSocket connection error to ${this.wsUrl}`));
      };

      ws.onmessage = (event) => {
        if (this.ws !== ws) return;
        this._handleMessage(event.data);
      };
    });

    return this._connectPromise;
  }

  _scheduleReconnect() {
    // Only auto-reconnect if we are actually in a room
    if (!this.currentRoom || !this.savedSession) return;
    if (this._reconnectTimer) return;
    if (this._reconnectAttempts >= this._maxReconnectAttempts) {
      this.emit('reconnectFailed');
      return;
    }

    const delay = Math.min(1000 * 2 ** this._reconnectAttempts, 8000);
    this._reconnectAttempts++;

    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;
      try {
        await this.connect();
        const s = this.savedSession;
        if (!s) return;
        const res = await this._send({
          type: 'JOIN_ROOM',
          roomId: s.roomId,
          displayName: s.displayName || '',
          participantId: s.participantId,
          sessionToken: s.sessionToken
        });
        if (res.success && res.reconnected) {
          this.currentRoom = res.room;
          this.myParticipant = res.participant;
          this._reconnectAttempts = 0;
          this.emit('reconnected', res.room);
          this.emit('roomUpdate', res.room);
        } else {
          // Session expired on the server (grace period over)
          this._clearSession();
          this.currentRoom = null;
          this.myParticipant = null;
          this.emit('kicked', { reason: res.error || 'Session expired' });
        }
      } catch (_) {
        this._scheduleReconnect();
      }
    }, delay);
  }

  _handleMessage(raw) {
    let data;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      console.warn('Error parsing WS message:', err);
      return;
    }

    switch (data.type) {
      case 'ROOM_UPDATE':
        this.currentRoom = data.room;
        if (this.myParticipant) {
          const updated = data.room.participants.find(
            p => p.participantId === this.myParticipant.participantId
          );
          if (updated) {
            this.myParticipant = updated;
          } else {
            // We are no longer in this room
            this._clearSession();
            this.currentRoom = null;
            this.myParticipant = null;
            this.emit('kicked', { reason: 'You are no longer in this room' });
            break;
          }
        }
        this.emit('roomUpdate', data.room);
        break;

      case 'ROULETTE_START':
        this.emit('rouletteStart', data);
        break;
      case 'ROULETTE_PHASE_CHANGE':
        this.emit('roulettePhaseChange', data);
        break;
      case 'SELECTION_CONFIRMED':
        this.emit('selectionConfirmed', data);
        break;
      case 'GRID_FORMATION_START':
        this.emit('gridFormationStart', data);
        break;
      case 'RACE_START_LIGHTS_OUT':
        this.emit('raceStartLightsOut', data);
        break;
      case 'PARTICIPANT_FINISHED':
        this.emit('participantFinished', data);
        break;
      case 'RACE_GLOBAL_FINISHED':
        this.emit('raceGlobalFinished', data);
        break;

      case 'RETURN_TO_WAITING_ROOM':
        this.currentRoom = data.room;
        if (this.myParticipant) {
          const me = data.room.participants.find(
            p => p.participantId === this.myParticipant.participantId
          );
          if (me) this.myParticipant = me;
        }
        this.emit('returnToWaitingRoom', data.room);
        break;

      case 'START_FAILED':
        // Server aborted the start sequence; room is back in WAITING
        this.emit('startFailed', data);
        break;

      case 'REMATCH_ACCEPTED':
        this.currentRoom = data.room;
        if (this.myParticipant) {
          const me = data.room.participants.find(
            p => p.participantId === this.myParticipant.participantId
          );
          if (me) this.myParticipant = me;
        }
        this.emit('rematchAccepted', data.room);
        break;

      case 'ROOM_SNAPSHOT':
        this.emit('roomSnapshot', data);
        break;

      case 'PONG':
        if (data.clientTimestamp) {
          const rtt = Math.max(1, Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - data.clientTimestamp));
          this.rtt = rtt;
          this.emit('ping', rtt);
        }
        break;

      case 'PARTICIPANT_RECONNECTED':
        this.emit('participantReconnected', data);
        break;

      case 'PEER_TELEMETRY':
        this.emit('peerTelemetry', data);
        break;
      case 'PUBLIC_ROOMS_UPDATE':
        this.emit('publicRoomsUpdate', data.rooms || []);
        break;

      case 'PUBLIC_ROOMS_RESPONSE':
      case 'JOIN_PUBLIC_ROOM_RESPONSE':
      case 'LEAVE_ROOM_RESPONSE':
      case 'CREATE_ROOM_RESPONSE':
      case 'JOIN_ROOM_RESPONSE':
      case 'SET_READY_RESPONSE':
      case 'UPDATE_CONFIG_RESPONSE':
      case 'START_RACE_RESPONSE':
      case 'FINISH_PARTICIPANT_RESPONSE':
      case 'RETURN_TO_LOBBY_RESPONSE':
      case 'REMATCH_RESPONSE':
        this._resolvePending(data.type, data);
        break;

      default:
        this.emit('message', data);
    }
  }

  _send(payload) {
    const wsOpen = getWebSocketClass() ? getWebSocketClass().OPEN : WS_OPEN;
    if (!this.ws || this.ws.readyState !== wsOpen) {
      return Promise.reject(new Error('WebSocket is not connected'));
    }
    return new Promise((resolve, reject) => {
      const responseType = payload.type === 'GET_PUBLIC_ROOMS'
        ? 'PUBLIC_ROOMS_RESPONSE'
        : `${payload.type}_RESPONSE`;

      // Don't silently overwrite an in-flight request of the same type
      const prev = this._pendingRequests.get(responseType);
      if (prev) {
        clearTimeout(prev.timer);
        prev.reject(new Error(`Superseded by a newer ${payload.type} request`));
      }

      const timer = setTimeout(() => {
        if (this._pendingRequests.get(responseType)?.timer === timer) {
          this._pendingRequests.delete(responseType);
        }
        reject(new Error(`Timeout waiting for ${responseType}`));
      }, 8000);

      this._pendingRequests.set(responseType, { resolve, reject, timer });

      try {
        this.ws.send(JSON.stringify(payload));
      } catch (err) {
        clearTimeout(timer);
        this._pendingRequests.delete(responseType);
        reject(err);
      }
    });
  }

  _resolvePending(type, data) {
    const pending = this._pendingRequests.get(type);
    if (!pending) return;
    clearTimeout(pending.timer);
    this._pendingRequests.delete(type);
    pending.resolve(data);
  }

  _rejectAllPending(err) {
    for (const { reject, timer } of this._pendingRequests.values()) {
      clearTimeout(timer);
      reject(err);
    }
    this._pendingRequests.clear();
  }

  // ── Public API Operations ──────────────────────────────────────────────────

  async createRoom(config) {
    await this.connect();
    const res = await this._send({ type: 'CREATE_ROOM', ...config });

    if (res.success) {
      this.currentRoom = res.room;
      this.myParticipant = res.host;
      this.sessionToken = res.sessionToken;
      this._saveSession(res.room.roomId, res.host.participantId, res.sessionToken, res.host.displayName);
    }
    return res;
  }

  async joinRoom(roomId, displayName, existingParticipantId, existingToken) {
    await this.connect();
    const res = await this._send({
      type: 'JOIN_ROOM',
      roomId: roomId ? roomId.trim().toUpperCase() : '',
      displayName: displayName ? displayName.trim() : '',
      participantId: existingParticipantId || this.savedSession?.participantId,
      sessionToken: existingToken || this.savedSession?.sessionToken
    });

    if (res.success) {
      this.currentRoom = res.room;
      this.myParticipant = res.participant;
      this.sessionToken = res.sessionToken;
      this._saveSession(res.room.roomId, res.participant.participantId, res.sessionToken, res.participant.displayName);
    }
    return res;
  }

  async setReady(ready) {
    if (!this.myParticipant) return { success: false, error: 'Not in a room' };
    return await this._send({
      type: 'SET_READY',
      participantId: this.myParticipant.participantId,
      ready: !!ready
    });
  }

  async updateConfig(config) {
    if (!this.myParticipant || !this.myParticipant.isHost) {
      return { success: false, error: 'Only the host can modify race settings' };
    }
    return await this._send({
      type: 'UPDATE_CONFIG',
      participantId: this.myParticipant.participantId,
      config
    });
  }

  /**
   * Host starts the race and initiates the roulette.
   * Always resolves to { success, error? } so the UI can show the reason.
   */
  async startRace() {
    if (!this.myParticipant || !this.myParticipant.isHost) {
      return { success: false, error: 'Only the host can start the race' };
    }
    try {
      const res = await this._send({
        type: 'START_RACE',
        participantId: this.myParticipant.participantId
      });
      if (!res.success) console.warn('START_RACE rejected:', res.error);
      return res;
    } catch (err) {
      console.error('START_RACE failed:', err);
      return { success: false, error: err.message };
    }
  }

  sendTelemetry(telemetry) {
    const wsOpen = getWebSocketClass() ? getWebSocketClass().OPEN : WS_OPEN;
    if (!this.connected || !this.myParticipant) return;
    if (!this.ws || this.ws.readyState !== wsOpen) return;
    try {
      this.ws.send(JSON.stringify({
        type: 'RACE_TELEMETRY',
        participantId: this.myParticipant.participantId,
        ...telemetry
      }));
    } catch (_) {}
  }

  sendPing() {
    const wsOpen = getWebSocketClass() ? getWebSocketClass().OPEN : WS_OPEN;
    if (!this.connected || !this.ws || this.ws.readyState !== wsOpen) return;
    try {
      this.ws.send(JSON.stringify({
        type: 'PING',
        clientTimestamp: (typeof performance !== 'undefined' ? performance.now() : Date.now())
      }));
    } catch (_) {}
  }

  startPing(intervalMs = 2000) {
    this.stopPing();
    this.sendPing();
    this._pingInterval = setInterval(() => this.sendPing(), Math.max(500, intervalMs));
  }

  stopPing() {
    if (this._pingInterval) {
      clearInterval(this._pingInterval);
      this._pingInterval = null;
    }
  }

  async finishRace(finishTime, bestLap) {
    return this.finishParticipant(this.myParticipant?.participantId, finishTime, bestLap);
  }

  async finishParticipant(participantId, finishTime, bestLap) {
    if (!this.currentRoom) return { success: false, error: 'No active room' };
    const pId = participantId || this.myParticipant?.participantId;
    if (!pId) return { success: false, error: 'Participant ID required' };
    try {
      return await this._send({
        type: 'FINISH_PARTICIPANT',
        roomId: this.currentRoom.roomId,
        participantId: pId,
        raceId: this.currentRoom.raceSession?.sessionId || this.currentRoom.raceId,
        sessionId: this.currentRoom.raceSession?.sessionId || this.currentRoom.raceId,
        finishTime,
        bestLap
      });
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async returnToLobby() {
    if (!this.currentRoom || !this.myParticipant) return { success: false, error: 'Not in room' };
    try {
      return await this._send({
        type: 'RETURN_TO_LOBBY',
        roomId: this.currentRoom.roomId,
        participantId: this.myParticipant.participantId
      });
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async rematch() {
    return this.returnToLobby();
  }

  async getPublicRooms() {
    try {
      await this.connect();
      const res = await this._send({ type: 'GET_PUBLIC_ROOMS' });
      return res.rooms || [];
    } catch (_) {
      try {
        const baseUrl = (typeof window !== 'undefined' && window.location && window.location.origin && window.location.origin !== 'null')
          ? window.location.origin
          : 'http://localhost:8765';
        const resp = await fetch(`${baseUrl}/api/multiplayer/public-rooms`);
        if (resp.ok) {
          const json = await resp.json();
          return json.rooms || [];
        }
      } catch (err) {
        console.warn('Failed to fetch public rooms:', err);
      }
      return [];
    }
  }

  async joinPublicRoom(roomId, displayName, existingParticipantId, existingToken) {
    await this.connect();
    const res = await this._send({
      type: 'JOIN_PUBLIC_ROOM',
      roomId: roomId ? roomId.trim().toUpperCase() : '',
      displayName: displayName ? displayName.trim() : '',
      participantId: existingParticipantId || this.savedSession?.participantId,
      sessionToken: existingToken || this.savedSession?.sessionToken
    });

    if (res.success) {
      this.currentRoom = res.room;
      this.myParticipant = res.participant;
      this.sessionToken = res.sessionToken;
      this._saveSession(res.room.roomId, res.participant.participantId, res.sessionToken, res.participant.displayName);
    }
    return res;
  }

  async leaveRoom() {
    // Stop any pending auto-reconnect: we are leaving on purpose
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    const wsOpen = getWebSocketClass() ? getWebSocketClass().OPEN : WS_OPEN;
    if (this.myParticipant && this.ws && this.ws.readyState === wsOpen) {
      try {
        await this._send({
          type: 'LEAVE_ROOM',
          participantId: this.myParticipant.participantId
        });
      } catch (_) {}
    }
    this._clearSession();
    this.currentRoom = null;
    this.myParticipant = null;
    this.sessionToken = null;
  }

  /** Fully close the socket (no auto-reconnect). */
  disconnect() {
    this._intentionalClose = true;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this.ws) {
      try { this.ws.close(); } catch (_) {}
    }
  }

  /** Convenience for UI code: current server-driven phase. */
  getPhase() {
    return this.currentRoom?.phase || 'waiting_for_players';
  }

  // ── Event Emitter ──────────────────────────────────────────────────────────

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(fn);
  }

  off(event, fn) {
    if (this.listeners.has(event)) {
      this.listeners.set(event, this.listeners.get(event).filter(f => f !== fn));
    }
  }

  emit(event, data) {
    if (this.listeners.has(event)) {
      for (const fn of this.listeners.get(event)) {
        try { fn(data); } catch (e) { console.warn(`Error in ${event} listener:`, e); }
      }
    }
  }
}

// Singleton helper
let _sharedClient = null;
export function getSharedMultiplayerClient() {
  if (!_sharedClient) {
    _sharedClient = new MultiplayerClient();
  }
  return _sharedClient;
}