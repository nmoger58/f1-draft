/**
 * multiplayerServer.js
 * Server-Authoritative 2–20 Player Multiplayer Race Room Manager.
 *
 * Implements:
 *   - Room capacity enforcement (2 to 20 human players, atomic slot assignment)
 *   - Room creation & host configuration authority
 *   - Room-specific display name validation & sanitization
 *   - Real-time participant state & synchronized ready system
 *   - Host-only Start Race permissions (>= 2 players, 100% ready check)
 *   - Synchronized Server-Authoritative Driver, Car & Manager Roulette
 *   - Full-field race synchronization & independent finish tracking
 *   - Mandatory global race completion rule: waits for all participants to finish
 *   - Disconnect handling, reconnection grace periods & safe classifications
 *   - Rematch lifecycle & persistent race session history
 */

import { DRIVERS } from '../data/driverData.js';
import { CARS } from '../data/carData.js';
import { MANAGERS } from '../data/managerData.js';
import { CIRCUITS, getCircuit } from '../data/circuitData.js';

export const RoomStates = {
  CREATED:                 'created',
  WAITING:                 'waiting',
  READY_CHECK:             'ready_check',
  DRIVER_ROULETTE:         'driver_roulette',
  CAR_ROULETTE:            'car_roulette',
  MANAGER_ROULETTE:        'manager_roulette',
  SELECTION_CONFIRMATION:  'selection_confirmation',
  GRID_FORMATION:          'grid_formation',
  COUNTDOWN:               'countdown',
  RACING:                  'racing',
  FINALIZING_RESULTS:      'finalizing_results',
  RESULTS:                 'results',
  RETURNING_TO_LOBBY:      'returning_to_lobby'
};

export const ParticipantRaceStatus = {
  WAITING:                 'waiting',
  READY:                   'ready',
  RACING:                  'racing',
  FINISHED:                'finished',
  RETIRED:                 'retired',
  DNF:                     'dnf',
  DNS:                     'dns',
  DISCONNECTED:            'disconnected',
  DISCONNECTED_CLASSIFIED: 'disconnected_classified',
  CLASSIFIED:              'classified'
};

/**
 * Sanitizes and validates room-specific player display names.
 * @param {string} raw
 * @returns {{ valid: boolean, name: string, error?: string }}
 */
export function validateDisplayName(raw) {
  if (typeof raw !== 'string') {
    return { valid: false, name: '', error: 'Display name must be text' };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { valid: false, name: '', error: 'Display name cannot be empty' };
  }
  if (trimmed.length > 20) {
    return { valid: false, name: '', error: 'Display name cannot exceed 20 characters' };
  }
  // Strip dangerous control/markup characters
  const clean = trimmed.replace(/<\/?[^>]+(>|$)/g, '').replace(/[<>&"'\\\/]/g, '').trim();
  if (clean.length === 0) {
    return { valid: false, name: '', error: 'Display name contains invalid characters' };
  }
  return { valid: true, name: clean };
}

/**
 * Generates an alphanumeric room code (e.g. RACE-7K4P).
 */
export function generateRoomId() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `RACE-${code}`;
}

/**
 * Generates a stable unique participant identifier.
 */
export function generateParticipantId() {
  return `part_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

export class MultiplayerServerManager {
  constructor() {
    /** @type {Map<string, object>} roomId -> room */
    this.rooms = new Map();
    /** @type {Map<string, string>} participantId -> roomId */
    this.participantToRoom = new Map();
    /** @type {Map<any, string>} socket -> participantId */
    this.socketToParticipant = new Map();
    /** @type {Set<any>} connected sockets browsing lobby */
    this.lobbySockets = new Set();
  }

  registerLobbySocket(socket) {
    if (socket) this.lobbySockets.add(socket);
  }

  unregisterLobbySocket(socket) {
    if (socket) this.lobbySockets.delete(socket);
  }

  // ── Room Creation ──────────────────────────────────────────────────────────

  /**
   * Create a new multiplayer room.
   * @param {object} options
   * @param {string} options.hostName - Room display name for the host
   * @param {string} [options.roomName]
   * @param {'custom'|'public'} [options.roomType='custom'] - Custom (private) or Public (discoverable)
   * @param {number} [options.maxPlayers=20] - Capacity between 2 and 20
   * @param {string} [options.circuitId='silverstone']
   * @param {number} [options.laps=5]
   * @param {string} [options.weather='clear']
   * @param {object} [options.duplicatePolicy]
   * @param {object} [options.aiParticipation]
   * @param {any} socket - Host WebSocket connection
   * @returns {{ success: boolean, room?: object, host?: object, error?: string }}
   */
  createRoom(options, socket) {
    const nameCheck = validateDisplayName(options.hostName || 'Host');
    if (!nameCheck.valid) {
      return { success: false, error: nameCheck.error };
    }

    const maxPlayers = Math.max(2, Math.min(20, parseInt(options.maxPlayers, 10) || 20));
    const roomId = generateRoomId();
    const hostParticipantId = generateParticipantId();
    const sessionToken = `tok_${Math.random().toString(36).slice(2, 12)}`;

    const circuit = getCircuit(options.circuitId || 'silverstone') || getCircuit('silverstone') || CIRCUITS[0];

    const roomType = (options.roomType === 'public') ? 'public' : 'custom';

    const room = {
      roomId,
      roomName: (options.roomName || `${circuit.name} Grand Prix`).slice(0, 32).trim(),
      roomType,
      hostParticipantId,
      maxPlayers,
      circuitId: circuit.id,
      circuitName: circuit.name,
      includeQualifying: !!options.includeQualifying,
      laps: Math.max(1, Math.min(50, parseInt(options.laps, 10) || 5)),
      weather: options.weather || 'clear',
      duplicatePolicy: {
        drivers: options.duplicatePolicy?.drivers || 'unique', // 'unique' | 'allow'
        cars: options.duplicatePolicy?.cars || 'unique', // 'unique' | 'allow' (default unique so friend gets distinct car)
        managers: options.duplicatePolicy?.managers || 'unique' // 'unique' | 'allow' (default unique so friend gets distinct manager)
      },
      aiParticipation: {
        // If explicitly specified by user (UI toggle), respect user choice.
        // If omitted (e.g. legacy test suites), default to true for backward compatibility.
        enabled: options.aiParticipation?.enabled !== undefined
          ? !!options.aiParticipation.enabled
          : (options.aiParticipation?.fillToMax !== undefined ? !!options.aiParticipation.fillToMax : true),
        difficulty: options.aiParticipation?.difficulty || 'balanced',
        fillToMax: options.aiParticipation?.fillToMax !== undefined
          ? !!options.aiParticipation.fillToMax
          : (options.aiParticipation?.enabled !== undefined ? !!options.aiParticipation.enabled : true)
      },
      reconnectGraceMs: options.reconnectGraceMs || 60000,
      state: RoomStates.WAITING,
      phase: 'waiting_for_players',
      createdAt: Date.now(),
      slots: new Array(maxPlayers).fill(null),
      /** @type {Map<string, object>} */
      participants: new Map(),
      rouletteOutcomes: null,
      raceSession: null,
      history: []
    };

    const hostParticipant = {
      participantId: hostParticipantId,
      sessionToken,
      roomId,
      slotNumber: 1,
      displayName: nameCheck.name,
      isHost: true,
      ready: true, // Host is ready by default upon creating
      connectionStatus: 'connected',
      raceStatus: ParticipantRaceStatus.WAITING,
      finishPosition: null,
      finishTime: null,
      finalLap: 0,
      selectedDriver: null,
      selectedCar: null,
      selectedManager: null,
      lastActiveTimestamp: Date.now(),
      socket
    };

    room.slots[0] = hostParticipantId;
    room.participants.set(hostParticipantId, hostParticipant);

    this.rooms.set(roomId, room);
    this.participantToRoom.set(hostParticipantId, roomId);
    if (socket) this.socketToParticipant.set(socket, hostParticipantId);

    if (room.roomType === 'public') {
      this.broadcastPublicRooms();
    }

    return {
      success: true,
      room: this.serializeRoom(room),
      host: this.serializeParticipant(hostParticipant),
      sessionToken
    };
  }

  // ── Joining a Room ─────────────────────────────────────────────────────────

  /**
   * Join an existing room with a room-specific display name.
   * @param {string} roomId
   * @param {string} rawName
   * @param {any} socket
   * @param {string} [existingParticipantId]
   * @param {string} [existingToken]
   */
  joinRoom(roomId, rawName, socket, existingParticipantId, existingToken) {
    const room = this.rooms.get(roomId?.toUpperCase());
    if (!room) {
      return { success: false, error: `Room ${roomId} not found` };
    }

    // Reconnection handling: check if participant already exists in room
    if (existingParticipantId && room.participants.has(existingParticipantId)) {
      const existing = room.participants.get(existingParticipantId);
      if (existing.sessionToken === existingToken) {
        existing.connectionStatus = 'connected';
        existing.lastActiveTimestamp = Date.now();
        existing.socket = socket;
        if (socket) this.socketToParticipant.set(socket, existingParticipantId);
        if (existing._disconnectTimer) {
          clearTimeout(existing._disconnectTimer);
          existing._disconnectTimer = null;
        }

        // Restore active racing state if race is currently underway
        if (room.raceSession && room.raceSession.cars[existingParticipantId]) {
          const car = room.raceSession.cars[existingParticipantId];
          if (!car.finished && car.status !== ParticipantRaceStatus.DNF) {
            car.status = ParticipantRaceStatus.RACING;
            existing.raceStatus = ParticipantRaceStatus.RACING;
          }
        }

        this.broadcastRoomUpdate(room);
        this.broadcast(room, {
          type: 'PARTICIPANT_RECONNECTED',
          roomId: room.roomId,
          participantId: existingParticipantId,
          displayName: existing.displayName
        });

        return {
          success: true,
          reconnected: true,
          room: this.serializeRoom(room),
          participant: this.serializeParticipant(existing),
          sessionToken: existing.sessionToken,
          raceSession: room.raceSession ? this.serializeRaceSession(room) : null
        };
      }
    }

    // New participant join checks
    if (room.state !== RoomStates.WAITING && room.state !== RoomStates.READY_CHECK) {
      return { success: false, error: 'Room is already in progress or locked' };
    }

    const nameCheck = validateDisplayName(rawName);
    if (!nameCheck.valid) {
      return { success: false, error: nameCheck.error };
    }

    // Atomic slot assignment (find lowest available slot index)
    const slotIdx = room.slots.findIndex(s => s === null);
    if (slotIdx === -1 || slotIdx >= room.maxPlayers) {
      return {
        success: false,
        error: `Room is full (Capacity: ${room.maxPlayers} / ${room.maxPlayers} players)`
      };
    }

    const participantId = generateParticipantId();
    const sessionToken = `tok_${Math.random().toString(36).slice(2, 12)}`;

    const participant = {
      participantId,
      sessionToken,
      roomId: room.roomId,
      slotNumber: slotIdx + 1,
      displayName: nameCheck.name,
      isHost: false,
      ready: false,
      connectionStatus: 'connected',
      raceStatus: ParticipantRaceStatus.WAITING,
      finishPosition: null,
      finishTime: null,
      finalLap: 0,
      selectedDriver: null,
      selectedCar: null,
      selectedManager: null,
      lastActiveTimestamp: Date.now(),
      socket
    };

    room.slots[slotIdx] = participantId;
    room.participants.set(participantId, participant);
    this.participantToRoom.set(participantId, room.roomId);
    if (socket) this.socketToParticipant.set(socket, participantId);

    this.broadcastRoomUpdate(room);
    if (room.roomType === 'public') {
      this.broadcastPublicRooms();
    }

    return {
      success: true,
      room: this.serializeRoom(room),
      participant: this.serializeParticipant(participant),
      sessionToken
    };
  }

  /**
   * Directly join an eligible public room without needing an invitation code.
   * Validates room existence, public visibility, waiting status, and capacity.
   */
  joinPublicRoom(roomId, rawName, socket, existingParticipantId, existingToken) {
    if (!roomId) {
      return { success: false, error: 'Room ID is required to join' };
    }
    const cleanId = String(roomId).trim().toUpperCase();
    const room = this.rooms.get(cleanId);
    if (!room) {
      return { success: false, error: 'Room not found or no longer available' };
    }

    // 1. Strict Privacy: custom rooms cannot be joined via the public endpoint
    if (room.roomType !== 'public') {
      return {
        success: false,
        error: 'Access denied: This is a private Custom Room. Please use an invitation code to join.'
      };
    }

    // 2. Lifecycle check: only WAITING rooms accept direct joins
    if (room.state !== RoomStates.WAITING && room.state !== RoomStates.READY_CHECK) {
      return {
        success: false,
        error: 'Race is already in progress or room is locked'
      };
    }

    // 3. Capacity check
    const connectedCount = Array.from(room.participants.values())
      .filter(p => p.connectionStatus === 'connected').length;
    if (connectedCount >= room.maxPlayers) {
      return {
        success: false,
        error: `Room is full (Capacity: ${room.maxPlayers} / ${room.maxPlayers} players)`
      };
    }

    return this.joinRoom(cleanId, rawName, socket, existingParticipantId, existingToken);
  }

  /**
   * Cleanly leaves a room without breaking the lobby for other players.
   */
  leaveRoom(participantId) {
    const roomId = this.participantToRoom.get(participantId);
    if (!roomId) return { success: false, error: 'Participant not in a room' };
    const room = this.rooms.get(roomId);
    if (!room) return { success: false, error: 'Room not found' };

    const participant = room.participants.get(participantId);
    if (!participant) return { success: false, error: 'Participant not found in room' };

    if (participant._disconnectTimer) {
      clearTimeout(participant._disconnectTimer);
      participant._disconnectTimer = null;
    }

    // Free the slot
    const slotIdx = room.slots.indexOf(participantId);
    if (slotIdx !== -1) room.slots[slotIdx] = null;
    room.participants.delete(participantId);
    this.participantToRoom.delete(participantId);
    if (participant.socket) {
      this.socketToParticipant.delete(participant.socket);
    }

    // If host left, elect next connected participant
    if (room.hostParticipantId === participantId) {
      const nextHost = Array.from(room.participants.values()).find(p => p.connectionStatus === 'connected');
      if (nextHost) {
        room.hostParticipantId = nextHost.participantId;
        nextHost.isHost = true;
      } else {
        // All players left -> cleanly delete room
        this.rooms.delete(room.roomId);
        if (room.roomType === 'public') {
          this.broadcastPublicRooms();
        }
        return { success: true };
      }
    }

    this.broadcastRoomUpdate(room);
    if (room.roomType === 'public') {
      this.broadcastPublicRooms();
    }
    return { success: true };
  }

  // ── Readiness & Host Controls ──────────────────────────────────────────────

  /**
   * Toggle readiness status for a participant.
   */
  setReady(participantId, readyState) {
    const roomId = this.participantToRoom.get(participantId);
    if (!roomId) return { success: false, error: 'Participant not in a room' };
    const room = this.rooms.get(roomId);
    if (!room) return { success: false, error: 'Room not found' };

    if (room.state !== RoomStates.WAITING && room.state !== RoomStates.READY_CHECK) {
      return { success: false, error: 'Readiness locked once sequence begins' };
    }

    const participant = room.participants.get(participantId);
    if (!participant) return { success: false, error: 'Participant record missing' };

    participant.ready = !!readyState;
    participant.lastActiveTimestamp = Date.now();

    this.broadcastRoomUpdate(room);
    return { success: true, ready: participant.ready };
  }

  /**
   * Host configuration update.
   */
  updateConfig(participantId, config) {
    const roomId = this.participantToRoom.get(participantId);
    if (!roomId) return { success: false, error: 'Participant not in a room' };
    const room = this.rooms.get(roomId);
    if (!room) return { success: false, error: 'Room not found' };

    if (room.hostParticipantId !== participantId) {
      return { success: false, error: 'Host permissions required to change settings' };
    }
    if (room.state !== RoomStates.WAITING) {
      return { success: false, error: 'Configuration locked once race sequence starts' };
    }

    if (config.roomName && typeof config.roomName === 'string') {
      room.roomName = config.roomName.slice(0, 32).trim();
    }
    if (config.circuitId) {
      const c = getCircuit(config.circuitId);
      if (c) {
        room.circuitId = c.id;
        room.circuitName = c.name;
      }
    }
    if (config.laps) {
      room.laps = Math.max(1, Math.min(50, parseInt(config.laps, 10) || 5));
    }
    if (config.weather) {
      room.weather = config.weather;
    }
    if (config.maxPlayers) {
      const newMax = Math.max(2, Math.min(20, parseInt(config.maxPlayers, 10) || 20));
      if (newMax >= room.participants.size) {
        room.maxPlayers = newMax;
        room.slots.length = newMax;
        for (let i = 0; i < newMax; i++) {
          if (room.slots[i] === undefined) room.slots[i] = null;
        }
      }
    }
    if (config.duplicatePolicy) {
      room.duplicatePolicy = { ...room.duplicatePolicy, ...config.duplicatePolicy };
    }
    if (config.aiParticipation) {
      room.aiParticipation = { ...room.aiParticipation, ...config.aiParticipation };
    }
    if (config.includeQualifying !== undefined) {
      room.includeQualifying = !!config.includeQualifying;
    }

    this.broadcastRoomUpdate(room);
    if (room.roomType === 'public') {
      this.broadcastPublicRooms();
    }
    return { success: true, room: this.serializeRoom(room) };
  }

  // ── Synchronized Roulette & Start Race ─────────────────────────────────────

  /**
   * Validates if the room is eligible to start the race sequence.
   * @param {object} room
   * @returns {{ canStart: boolean, reason?: string, unreadyCount: number, connectedCount: number }}
   */
  canStartRace(room) {
    const connected = Array.from(room.participants.values()).filter(p => p.connectionStatus === 'connected');
    const connectedCount = connected.length;

    if (connectedCount < 2) {
      return {
        canStart: false,
        reason: 'At least 2 human players must be connected to start a multiplayer race',
        unreadyCount: 0,
        connectedCount
      };
    }

    const unready = connected.filter(p => !p.ready);
    if (unready.length > 0) {
      return {
        canStart: false,
        reason: `Waiting for ${unready.length} driver${unready.length > 1 ? 's' : ''} to ready up`,
        unreadyCount: unready.length,
        connectedCount
      };
    }

    if (room.state !== RoomStates.WAITING && room.state !== RoomStates.READY_CHECK) {
      return {
        canStart: false,
        reason: 'Race selection or session already in progress',
        unreadyCount: 0,
        connectedCount
      };
    }

    return { canStart: true, unreadyCount: 0, connectedCount };
  }

  /**
   * Host starts the race. Triggers synchronized roulette sequences.
   */
  startRace(participantId) {
    const roomId = this.participantToRoom.get(participantId);
    if (!roomId) return { success: false, error: 'Participant not in room' };
    const room = this.rooms.get(roomId);
    if (!room) return { success: false, error: 'Room not found' };

    if (room.hostParticipantId !== participantId) {
      return { success: false, error: 'Only the room host may initiate the race start' };
    }

    const check = this.canStartRace(room);
    if (!check.canStart) {
      return { success: false, error: check.reason };
    }

    // Lock room configuration and joins
    room.state = RoomStates.DRIVER_ROULETTE;
    room.phase = 'driver_roulette';

    if (room.roomType === 'public') {
      this.broadcastPublicRooms();
    }

    // 1. Authoritative Roulette Generation on Server
    const outcomes = this.generateRouletteOutcomes(room);
    room.rouletteOutcomes = outcomes;

    // Apply driver/car/manager assignments to participant records
    for (const [pId, assignment] of Object.entries(outcomes.participants)) {
      const p = room.participants.get(pId);
      if (p) {
        p.selectedDriver = assignment.driver;
        p.selectedCar = assignment.car;
        p.selectedManager = assignment.manager;
        p.raceStatus = ParticipantRaceStatus.READY;
      }
    }

    // Initialize authoritative race session immediately with stable sessionId
    this.initializeRaceSession(room);

    // 2. Broadcast Driver Roulette Start
    this.broadcast(room, {
      type: 'ROULETTE_START',
      phase: 'driver_roulette',
      outcomes: outcomes,
      durationMs: 4000
    });

    // 3. Orchestrate Sequential Roulette Transitions (Server-Timed)
    // Driver -> Car (after 4.2s)
    setTimeout(() => {
      if (room.state === RoomStates.DRIVER_ROULETTE) {
        room.state = RoomStates.CAR_ROULETTE;
        room.phase = 'car_roulette';
        this.broadcast(room, {
          type: 'ROULETTE_PHASE_CHANGE',
          phase: 'car_roulette',
          durationMs: 4000
        });
      }
    }, 4200);

    // Car -> Manager (after 8.4s)
    setTimeout(() => {
      if (room.state === RoomStates.CAR_ROULETTE) {
        room.state = RoomStates.MANAGER_ROULETTE;
        room.phase = 'manager_roulette';
        this.broadcast(room, {
          type: 'ROULETTE_PHASE_CHANGE',
          phase: 'manager_roulette',
          durationMs: 4000
        });
      }
    }, 8400);

    // Manager -> Selection Confirmation (after 12.6s)
    setTimeout(() => {
      if (room.state === RoomStates.MANAGER_ROULETTE) {
        room.state = RoomStates.SELECTION_CONFIRMATION;
        room.phase = 'selection_confirmation';
        this.broadcast(room, {
          type: 'SELECTION_CONFIRMED',
          roster: this.getAuthoritativeRoster(room),
          reviewDurationMs: 3500
        });
      }
    }, 12600);

    const GRID_AT_MS = 16200;
    const LIGHTS_SETUP_MS = 1500;      // time for clients to build the 20-car grid
    const LIGHTS_ON_MS = 5 * 900;      // must match LaunchManager's 900 ms per light
    const holdMs = 1200 + Math.random() * 1800;
    const lightsOutDelay = Math.round(LIGHTS_SETUP_MS + LIGHTS_ON_MS + holdMs);

    // Selection Confirmation -> Grid Formation & Countdown (after 16.2s)
    setTimeout(() => {
      if (room.state === RoomStates.SELECTION_CONFIRMATION) {
        room.state = RoomStates.GRID_FORMATION;
        room.phase = 'grid_formation';

        // Ensure authoritative race session is ready (reuse existing to maintain stable sessionId)
        if (!room.raceSession) {
          this.initializeRaceSession(room);
        }

        this.broadcast(room, {
          type: 'GRID_FORMATION_START',
          session: room.raceSession,
          countdownDurationMs: lightsOutDelay
        });
      }
    }, GRID_AT_MS);

    // Grid Formation -> Green Flag Racing (synchronized lights out)
    setTimeout(() => {
      if (room.state === RoomStates.GRID_FORMATION) {
        room.state = RoomStates.RACING;
        room.phase = 'racing';
        room.raceSession.startTime = Date.now();

        if (!room._snapshotInterval) {
          room._snapshotInterval = setInterval(() => this.broadcastRoomSnapshot(room), 50);
          if (room._snapshotInterval.unref) room._snapshotInterval.unref();
        }

        this.broadcast(room, {
          type: 'RACE_START_LIGHTS_OUT',
          startTime: room.raceSession.startTime
        });
      }
    }, GRID_AT_MS + lightsOutDelay);

    return { success: true, room: this.serializeRoom(room) };
  }

  /**
   * Generates server-authoritative roulette outcomes for all participants.
   * Enforces uniqueness rules and validates driver, car and manager existence.
   */
  generateRouletteOutcomes(room) {
    const participants = Array.from(room.participants.values())
      .filter(p => p.connectionStatus === 'connected')
      .sort((a, b) => a.slotNumber - b.slotNumber);

    // Available pools (cloned)
    const availDrivers = [...DRIVERS];
    const availCars = [...CARS];
    const availManagers = [...MANAGERS];

    // Shuffle helper (Fisher-Yates)
    const shuffle = (arr) => {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };

    const shuffledDrivers = shuffle(availDrivers);
    const shuffledCars = shuffle(availCars);
    const shuffledManagers = shuffle(availManagers);

    const outcomes = {
      participants: {},
      aiDrivers: []
    };

    // Assign for human participants
    participants.forEach((p, idx) => {
      let driver = room.duplicatePolicy.drivers === 'unique'
        ? shuffledDrivers[idx % shuffledDrivers.length]
        : availDrivers[Math.floor(Math.random() * availDrivers.length)];

      let car = room.duplicatePolicy.cars === 'unique'
        ? shuffledCars[idx % shuffledCars.length]
        : (CARS.find(c => c.team === driver.team) || availCars[idx % availCars.length]);

      let manager = room.duplicatePolicy.managers === 'unique'
        ? shuffledManagers[idx % shuffledManagers.length]
        : (MANAGERS.find(m => m.team === driver.team) || availManagers[idx % availManagers.length]);

      outcomes.participants[p.participantId] = {
        participantId: p.participantId,
        slotNumber: p.slotNumber,
        displayName: p.displayName,
        driver: {
          id: driver.id,
          code: driver.code,
          name: driver.name,
          team: driver.team,
          number: driver.number,
          color: driver.color || car.primaryColor || '#e10600',
          skill: driver.skill,
          aggression: driver.aggression,
          tyreManagement: driver.tyreManagement
        },
        car: {
          id: car.id,
          name: car.name,
          team: car.team,
          primaryColor: car.primaryColor,
          stats: car.stats
        },
        manager: {
          id: manager.id,
          name: manager.name,
          team: manager.team,
          modifiers: manager.modifiers
        }
      };
    });

    // If AI filling remaining grid positions up to max field size (e.g. 20)
    if (room.aiParticipation.enabled && room.aiParticipation.fillToMax) {
      const totalField = Math.max(room.maxPlayers, 20);
      const remainingSlots = totalField - participants.length;
      const assignedDriverCodes = new Set(Object.values(outcomes.participants).map(o => o.driver.code));

      let aiIdx = 0;
      for (const drv of DRIVERS) {
        if (aiIdx >= remainingSlots) break;
        if (!assignedDriverCodes.has(drv.code)) {
          const car = CARS.find(c => c.team === drv.team) || CARS[aiIdx % CARS.length];
          const manager = MANAGERS.find(m => m.team === drv.team) || MANAGERS[aiIdx % MANAGERS.length];
          outcomes.aiDrivers.push({
            slotNumber: participants.length + aiIdx + 1,
            displayName: `${drv.name} (AI)`,
            isAI: true,
            driver: {
              id: drv.id,
              code: drv.code,
              name: drv.name,
              team: drv.team,
              number: drv.number,
              color: drv.color || car.primaryColor || '#999999',
              skill: drv.skill,
              aggression: drv.aggression,
              tyreManagement: drv.tyreManagement
            },
            car: {
              id: car.id,
              name: car.name,
              team: car.team,
              primaryColor: car.primaryColor,
              stats: car.stats
            },
            manager: {
              id: manager.id,
              name: manager.name,
              team: manager.team,
              modifiers: manager.modifiers
            }
          });
          aiIdx++;
        }
      }
    }

    return outcomes;
  }

  // ── Authoritative Race Session & Full-Field Finish ─────────────────────────

  /**
   * Initializes the shared race session for all 20 grid positions.
   */
  initializeRaceSession(room) {
    const sessionId = `race_sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    room.raceId = sessionId;
    const roster = this.getAuthoritativeRoster(room);

    // AI difficulty pace multipliers
    const AI_DIFFICULTY_PACE = {
      easy:     0.93,
      balanced: 0.97,
      hard:     1.00,
      elite:    1.03
    };
    const aiDifficulty = room.aiParticipation?.difficulty || 'balanced';
    const aiPaceMult = AI_DIFFICULTY_PACE[aiDifficulty] ?? 0.97;

    const cars = {};
    roster.forEach((entry, idx) => {
      const id = entry.participantId || `ai_${entry.driver.code}`;
      const isAI = !!entry.isAI;
      cars[id] = {
        id,
        slotNumber: entry.slotNumber,
        gridPos: idx + 1,
        displayName: entry.displayName,
        isAI,
        driver: entry.driver,
        car: entry.car,
        manager: entry.manager,
        // Apply AI difficulty to pace so the race engine uses it
        aiPaceMultiplier: isAI ? aiPaceMult : 1.0,
        s: -idx * 14.0, // staggered grid slot offsets (14m apart)
        v: 0,
        lat: 0,
        lap: 1,
        tyreLife: 1.0,
        tyreCompound: 'medium',
        batteryLevel: 100,
        drsActive: false,
        status: ParticipantRaceStatus.RACING,
        finished: false,
        finishTime: null,
        finishPosition: null,
        gapToLeaderSec: 0,
        gapToAheadSec: 0,
        bestLapTime: null,
        penalties: 0
      };
    });

    room.raceSession = {
      sessionId,
      raceId: sessionId,
      circuitId: room.circuitId,
      circuitName: room.circuitName,
      totalLaps: room.laps,
      simSpeed: 2,
      startTime: 0,
      endTime: null,
      cars,
      totalParticipants: roster.length,
      finishedCount: 0,
      finalClassification: null,
      completed: false,
      completionEvaluated: false,
      sequenceNumber: 0,
      simulationTick: 0
    };
  }

  /**
   * Serializes active race session safely for network transmission and client hydration.
   * @param {object} room
   */
  serializeRaceSession(room) {
    if (!room || !room.raceSession) return null;
    const s = room.raceSession;
    return {
      sessionId: s.sessionId,
      raceId: s.sessionId,
      circuitId: s.circuitId,
      circuitName: s.circuitName,
      totalLaps: s.totalLaps,
      simSpeed: s.simSpeed || 2,
      startTime: s.startTime,
      endTime: s.endTime,
      cars: s.cars,
      totalParticipants: s.totalParticipants,
      finishedCount: s.finishedCount,
      completed: s.completed,
      finalClassification: s.finalClassification,
      sequenceNumber: s.sequenceNumber || 0,
      simulationTick: s.simulationTick || 0
    };
  }

  /**
   * Broadcast an authoritative timestamped snapshot to all room participants.
   * @param {object} room
   */
  broadcastRoomSnapshot(room) {
    if (!room || !room.raceSession || room.state !== RoomStates.RACING) return;
    const session = room.raceSession;
    session.sequenceNumber = (session.sequenceNumber || 0) + 1;
    session.simulationTick = (session.simulationTick || 0) + 1;

    const snapshot = {
      type: 'ROOM_SNAPSHOT',
      roomId: room.roomId,
      raceId: session.sessionId,
      sequenceNumber: session.sequenceNumber,
      serverTimestamp: Date.now(),
      simulationTick: session.simulationTick,
      cars: session.cars,
      flags: room.flags || 'green',
      vsc: room.vsc || null,
      safetyCar: room.safetyCar || null
    };

    this.broadcast(room, snapshot);
  }

  /**
   * Handle an individual participant completing the race distance.
   * Authoritative: Evaluates terminal state across all room participants.
   * @param {string} roomId
   * @param {string} participantId
   * @param {number} finishTime
   * @param {number} [bestLap]
   * @param {string} [raceId]
   */
  recordParticipantFinish(roomId, participantId, finishTime, bestLap, raceId) {
    const cleanId = String(roomId || '').trim().toUpperCase();
    const room = this.rooms.get(cleanId);
    if (!room || !room.raceSession) return { success: false, error: 'Active race session not found' };

    const session = room.raceSession;
    if (raceId && session.sessionId !== raceId && session.raceId !== raceId) {
      return { success: false, error: 'Stale race event: mismatched raceId' };
    }

    const car = session.cars[participantId];
    if (!car) return { success: false, error: 'Participant not in race session' };

    // Duplicate finish events must NOT increase the completion count
    if (car.finished) {
      return { success: true, alreadyFinished: true, finishPosition: car.finishPosition };
    }

    const nonRacingTerminal = [
      ParticipantRaceStatus.RETIRED,
      ParticipantRaceStatus.DNF,
      ParticipantRaceStatus.DNS,
      ParticipantRaceStatus.DISCONNECTED_CLASSIFIED
    ];
    if (nonRacingTerminal.includes(car.status)) {
      return { success: true, alreadyTerminal: true, finishPosition: car.finishPosition };
    }

    // 1. Mark participant as finished
    session.finishedCount++;
    car.finished = true;
    car.status = ParticipantRaceStatus.FINISHED;
    car.finishPosition = session.finishedCount;
    car.finishTime = Math.max(0.01, Number(finishTime) || 0);
    car.lap = session.totalLaps;
    if (bestLap) car.bestLapTime = Number(bestLap);

    const participant = room.participants.get(participantId);
    if (participant) {
      participant.raceStatus = ParticipantRaceStatus.FINISHED;
      participant.finishPosition = car.finishPosition;
      participant.finishTime = car.finishTime;
      participant.finalLap = session.totalLaps;
    }

    // When the leader crosses the line (P1), start a finish watchdog timer (e.g. 60s)
    // to ensure disconnected or stalled racers cannot hang the session indefinitely
    if (session.finishedCount === 1 && !room._finishWatchdogTimer) {
      room._finishWatchdogTimer = setTimeout(() => {
        if (room.state === RoomStates.RACING && room.raceSession && !room.raceSession.completed) {
          for (const c of Object.values(room.raceSession.cars)) {
            if (!c.finished && c.status === ParticipantRaceStatus.RACING) {
              c.status = ParticipantRaceStatus.DNF;
              const p = room.participants.get(c.id);
              if (p) p.raceStatus = ParticipantRaceStatus.DNF;
            }
          }
          this.evaluateGlobalRaceCompletion(room);
        }
      }, 60000);
      if (room._finishWatchdogTimer.unref) room._finishWatchdogTimer.unref();
    }

    // Broadcast individual finish notification to all room clients
    this.broadcast(room, {
      type: 'PARTICIPANT_FINISHED',
      roomId: room.roomId,
      raceId: session.sessionId,
      sessionId: session.sessionId,
      participantId,
      displayName: car.displayName,
      driverName: car.driver?.name || '',
      isAI: !!car.isAI,
      finishPosition: car.finishPosition,
      finishTime: car.finishTime,
      finishedCount: session.finishedCount,
      totalParticipants: session.totalParticipants,
      isGlobalFinish: false
    });

    // 2. Evaluate Global Completion Condition
    this.evaluateGlobalRaceCompletion(room);

    return {
      success: true,
      finishPosition: car.finishPosition,
      isGlobalFinish: session.completed
    };
  }

  /**
   * Evaluates if the entire field has reached a terminal state.
   * Generates and broadcasts the final official leaderboard once.
   */
  evaluateGlobalRaceCompletion(room) {
    const session = room.raceSession;
    if (!session || session.completed || session.completionEvaluated) return;
    if (room.state === RoomStates.FINALIZING_RESULTS || room.state === RoomStates.RESULTS || room.state === RoomStates.RETURNING_TO_LOBBY) return;

    const allCars = Object.values(session.cars);
    const terminalStates = [
      ParticipantRaceStatus.FINISHED,
      ParticipantRaceStatus.RETIRED,
      ParticipantRaceStatus.DNF,
      ParticipantRaceStatus.DNS,
      ParticipantRaceStatus.DISCONNECTED_CLASSIFIED,
      ParticipantRaceStatus.CLASSIFIED
    ];

    // Check all human participants
    const humanParticipants = Array.from(room.participants.values());
    const humansAllTerminal = humanParticipants.every(p => {
      const car = session.cars[p.participantId];
      const isCarTerminal = car ? (car.finished || terminalStates.includes(car.status)) : true;
      const isPartTerminal = terminalStates.includes(p.raceStatus);
      const isDisconnected = p.connectionStatus === 'disconnected';
      return isCarTerminal || isPartTerminal || isDisconnected;
    });

    // If human participants are still actively racing, keep the race going!
    if (!humansAllTerminal) {
      return;
    }

    // Once all human participants have finished/terminated:
    // Finalize any remaining AI cars or disconnected racers so the entire field is classified
    const leaderFinishTime = allCars.find(x => x.finishPosition === 1)?.finishTime || 95.0;
    for (const c of allCars) {
      if (!c.finished && !terminalStates.includes(c.status)) {
        if (c.isAI) {
          c.status = ParticipantRaceStatus.CLASSIFIED;
          session.finishedCount++;
          c.finishPosition = session.finishedCount;
          c.finishTime = leaderFinishTime + (session.finishedCount * 0.85);
          c.lap = session.totalLaps;
        } else {
          c.status = ParticipantRaceStatus.DISCONNECTED_CLASSIFIED;
          const p = room.participants.get(c.id);
          if (p) p.raceStatus = ParticipantRaceStatus.DISCONNECTED_CLASSIFIED;
        }
      }
    }

    const allTerminal = allCars.every(c => terminalStates.includes(c.status) || c.finished);
    if (!allTerminal) return;

    // Clear watchdog timer and snapshot broadcast interval
    if (room._finishWatchdogTimer) {
      clearTimeout(room._finishWatchdogTimer);
      room._finishWatchdogTimer = null;
    }
    if (room._snapshotInterval) {
      clearInterval(room._snapshotInterval);
      room._snapshotInterval = null;
    }

    session.completionEvaluated = true;
    session.completed = true;
    session.endTime = Date.now();
    room.state = RoomStates.FINALIZING_RESULTS;
    room.phase = 'finalizing_results';

    // ── Build Official Final Classification ──
    const finishers = allCars
      .filter(c => c.status === ParticipantRaceStatus.FINISHED || c.finished)
      .sort((a, b) => {
        if (a.finishPosition && b.finishPosition) return a.finishPosition - b.finishPosition;
        return (a.finishTime || 9999) - (b.finishTime || 9999);
      });

    const classified = allCars
      .filter(c => c.status === ParticipantRaceStatus.CLASSIFIED || c.status === ParticipantRaceStatus.DISCONNECTED_CLASSIFIED)
      .sort((a, b) => {
        const lapDiff = (b.lap || 0) - (a.lap || 0);
        if (lapDiff !== 0) return lapDiff;
        return (b.s || 0) - (a.s || 0);
      });

    const nonFinishers = allCars
      .filter(c => c.status === ParticipantRaceStatus.RETIRED || c.status === ParticipantRaceStatus.DNF || c.status === ParticipantRaceStatus.DNS)
      .sort((a, b) => (b.lap || 0) - (a.lap || 0));

    const orderedCars = [...finishers, ...classified, ...nonFinishers];

    // Find fastest lap across all cars
    let fastestLapTime = null;
    for (const c of orderedCars) {
      if (c.bestLapTime && typeof c.bestLapTime === 'number' && c.bestLapTime > 0) {
        if (fastestLapTime === null || c.bestLapTime < fastestLapTime) {
          fastestLapTime = c.bestLapTime;
        }
      }
    }

    const winnerTime = finishers[0]?.finishTime || orderedCars[0]?.finishTime || 0;

    const finalClassification = orderedCars.map((c, idx) => {
      const pos = idx + 1;
      c.finishPosition = pos;
      const isWinner = (idx === 0 && (c.finished || c.status === ParticipantRaceStatus.FINISHED));
      let gapText = '—';
      if (isWinner) {
        gapText = 'WINNER';
      } else if (c.finished || c.status === ParticipantRaceStatus.FINISHED) {
        if (c.finishTime && winnerTime) {
          const diff = Math.max(0, c.finishTime - winnerTime);
          gapText = `+${diff.toFixed(3)}s`;
        } else {
          gapText = `+${idx * 1.25}s`;
        }
      } else if (c.status === ParticipantRaceStatus.CLASSIFIED || c.status === ParticipantRaceStatus.DISCONNECTED_CLASSIFIED) {
        const lapsDown = Math.max(1, session.totalLaps - (c.lap || 0));
        gapText = `+${lapsDown} Lap${lapsDown > 1 ? 's' : ''}`;
      } else if (c.status === ParticipantRaceStatus.RETIRED) {
        gapText = 'RETIRED';
      } else if (c.status === ParticipantRaceStatus.DNS) {
        gapText = 'DNS';
      } else {
        gapText = 'DNF';
      }

      return {
        position: pos,
        participantId: c.id,
        displayName: c.displayName,
        isAI: !!c.isAI,
        driver: c.driver,
        car: c.car,
        manager: c.manager,
        status: c.status || (c.finished ? ParticipantRaceStatus.FINISHED : ParticipantRaceStatus.DNF),
        lapsCompleted: c.finished ? session.totalLaps : Math.min(session.totalLaps, Math.max(0, c.lap || 0)),
        totalLaps: session.totalLaps,
        finishTime: c.finishTime || null,
        bestLapTime: c.bestLapTime || null,
        isFastestLap: (fastestLapTime !== null && c.bestLapTime === fastestLapTime),
        gapToWinner: gapText,
        penalties: c.penalties || 0
      };
    });

    session.finalClassification = finalClassification;

    // Persist to room history
    room.history.push({
      sessionId: session.sessionId,
      raceId: session.sessionId,
      circuitId: room.circuitId,
      circuitName: room.circuitName,
      totalLaps: session.totalLaps,
      completedAt: Date.now(),
      classification: finalClassification
    });

    // Transition to RESULTS state
    room.state = RoomStates.RESULTS;
    room.phase = 'results';

    const RESULTS_DURATION_MS = 25000; // 25 seconds — give players time to read results
    const returnAt = Date.now() + RESULTS_DURATION_MS;

    // Broadcast official final results once to every player!
    this.broadcast(room, {
      type: 'RACE_GLOBAL_FINISHED',
      roomId: room.roomId,
      raceId: session.sessionId,
      sessionId: session.sessionId,
      finalClassification,
      durationMs: RESULTS_DURATION_MS,
      returnAt
    });

    // Authoritative return to waiting room scheduled on server
    if (room._returnToLobbyTimer) clearTimeout(room._returnToLobbyTimer);
    room._returnToLobbyTimer = setTimeout(() => {
      this.returnRoomToWaitingRoom(room.roomId);
    }, RESULTS_DURATION_MS);
    if (room._returnToLobbyTimer.unref) room._returnToLobbyTimer.unref();
  }

  // ── Automatic Return to Waiting Room & Rematch ──────────────────────────────

  /**
   * Automatically returns all peers to the original matchmaking waiting room.
   * Resets all participants' ready states (including host) to false.
   * @param {string} roomId
   * @param {string} [requestedByParticipantId]
   */
  returnRoomToWaitingRoom(roomId, requestedByParticipantId) {
    const cleanId = String(roomId || '').trim().toUpperCase();
    const room = this.rooms.get(cleanId);
    if (!room) return { success: false, error: 'Room not found' };

    // Prevent duplicate / race-condition resets
    if (room.state === RoomStates.WAITING && room.phase === 'waiting_for_players') {
      return { success: true, alreadyWaiting: true, room: this.serializeRoom(room) };
    }

    if (room._returnToLobbyTimer) {
      clearTimeout(room._returnToLobbyTimer);
      room._returnToLobbyTimer = null;
    }
    if (room._finishWatchdogTimer) {
      clearTimeout(room._finishWatchdogTimer);
      room._finishWatchdogTimer = null;
    }
    if (room._snapshotInterval) {
      clearInterval(room._snapshotInterval);
      room._snapshotInterval = null;
    }

    room.state = RoomStates.RETURNING_TO_LOBBY;
    room.phase = 'returning_to_lobby';

    // Clear session-specific temporary state
    room.rouletteOutcomes = null;
    room.raceSession = null;
    room.raceId = null;

    // RESET ALL HUMAN PARTICIPANTS' READY STATE TO FALSE (INCLUDING HOST!)
    for (const p of room.participants.values()) {
      p.ready = false;
      p.raceStatus = ParticipantRaceStatus.WAITING;
      p.finishPosition = null;
      p.finishTime = null;
      p.finalLap = 0;
      p.selectedDriver = null;
      p.selectedCar = null;
      p.selectedManager = null;
    }

    room.state = RoomStates.WAITING;
    room.phase = 'waiting_for_players';

    const serialized = this.serializeRoom(room);

    // Broadcast authoritative return to waiting room to all connected participants
    this.broadcast(room, {
      type: 'RETURN_TO_WAITING_ROOM',
      room: serialized
    });
    // Broadcast REMATCH_ACCEPTED for compatibility with existing tests
    this.broadcast(room, {
      type: 'REMATCH_ACCEPTED',
      room: serialized
    });
    this.broadcastRoomUpdate(room);

    if (room.roomType === 'public') {
      this.broadcastPublicRooms();
    }

    return { success: true, room: serialized };
  }

  /**
   * Rematch flow: invokes returnRoomToWaitingRoom.
   */
  rematch(participantId) {
    const roomId = this.participantToRoom.get(participantId);
    if (!roomId) return { success: false, error: 'Participant not in a room' };
    const room = this.rooms.get(roomId);
    if (!room) return { success: false, error: 'Room not found' };

    if (room.hostParticipantId !== participantId) {
      return { success: false, error: 'Only the host can initiate a rematch' };
    }

    return this.returnRoomToWaitingRoom(roomId, participantId);
  }

  // ── Disconnections & Reconnections ────────────────────────────────────────

  /**
   * Handles socket disconnect with a 60-second grace period.
   */
  handleDisconnect(socket) {
    const participantId = this.socketToParticipant.get(socket);
    if (!participantId) return;

    this.socketToParticipant.delete(socket);
    const roomId = this.participantToRoom.get(participantId);
    if (!roomId) return;
    const room = this.rooms.get(roomId);
    if (!room) return;

    const participant = room.participants.get(participantId);
    if (!participant) return;

    participant.connectionStatus = 'disconnected';
    participant.socket = null;

    // Track disconnection on active car without instantly aborting their race position
    if (room.state === RoomStates.RACING && room.raceSession) {
      const car = room.raceSession.cars[participant.participantId];
      if (car && !car.finished) {
        car.disconnected = true;
      }
    }

    // Start reconnection grace period timer (60s default)
    participant._disconnectTimer = setTimeout(() => {
      this.expireParticipantSession(room, participant);
    }, room.reconnectGraceMs || 60000);
    if (participant._disconnectTimer.unref) participant._disconnectTimer.unref();

    this.broadcastRoomUpdate(room);
  }

  /**
   * Cleanly handles expired disconnect or participant leaving.
   */
  expireParticipantSession(room, participant) {
    if (participant.connectionStatus !== 'disconnected') return;

    // If currently racing or finalizing, classify as DNF/disconnected rather than deleting
    if ((room.state === RoomStates.RACING || room.state === RoomStates.FINALIZING_RESULTS || room.state === RoomStates.RESULTS) && room.raceSession) {
      const car = room.raceSession.cars[participant.participantId];
      if (car && !car.finished) {
        car.status = ParticipantRaceStatus.DNF;
        participant.raceStatus = ParticipantRaceStatus.DNF;
        this.evaluateGlobalRaceCompletion(room);
      }
      return;
    }

    // In lobby/waiting room, free up the slot
    const slotIdx = room.slots.indexOf(participant.participantId);
    if (slotIdx !== -1) room.slots[slotIdx] = null;
    room.participants.delete(participant.participantId);
    this.participantToRoom.delete(participant.participantId);

    // If host left, migrate host to next connected participant
    if (room.hostParticipantId === participant.participantId) {
      const nextHost = Array.from(room.participants.values()).find(p => p.connectionStatus === 'connected');
      if (nextHost) {
        room.hostParticipantId = nextHost.participantId;
        nextHost.isHost = true;
      } else {
        // Destroy room if all participants left
        this.rooms.delete(room.roomId);
        if (room.roomType === 'public') {
          this.broadcastPublicRooms();
        }
        return;
      }
    }

    this.broadcastRoomUpdate(room);
    if (room.roomType === 'public') {
      this.broadcastPublicRooms();
    }
  }

  // ── Broadcasting & Serialization ──────────────────────────────────────────

  /**
   * Broadcast a message to all connected participants in a room.
   */
  broadcast(room, payload) {
    const msg = JSON.stringify(payload);
    for (const p of room.participants.values()) {
      if (p.socket && p.connectionStatus === 'connected') {
        try {
          if (p.socket.readyState === 1) { // WebSocket.OPEN
            p.socket.send(msg);
          }
        } catch (_) {}
      }
    }
  }

  /**
   * Broadcasts the current room and participant table state.
   */
  broadcastRoomUpdate(room) {
    this.broadcast(room, {
      type: 'ROOM_UPDATE',
      room: this.serializeRoom(room)
    });
  }

  /**
   * Retrieves list of discoverable public rooms currently in WAITING state.
   * Strictly filters out Custom Rooms to enforce server-side privacy.
   */
  getPublicRooms() {
    const list = [];
    for (const room of this.rooms.values()) {
      if (room.roomType === 'public' && (room.state === RoomStates.WAITING || room.state === RoomStates.READY_CHECK)) {
        const connectedCount = Array.from(room.participants.values())
          .filter(p => p.connectionStatus === 'connected').length;
        const host = room.participants.get(room.hostParticipantId);
        let status = 'WAITING';
        if (connectedCount >= room.maxPlayers) {
          status = 'FULL';
        } else if (room.maxPlayers >= 6 ? (connectedCount >= room.maxPlayers - 2) : (connectedCount >= room.maxPlayers - 1)) {
          status = 'ALMOST FULL';
        }
        list.push({
          roomId: room.roomId,
          roomName: room.roomName,
          roomType: 'public',
          hostDisplayName: host ? host.displayName : 'Host',
          circuitId: room.circuitId,
          circuitName: room.circuitName,
          maxPlayers: room.maxPlayers,
          connectedPlayersCount: connectedCount,
          laps: room.laps,
          includeQualifying: !!room.includeQualifying,
          weather: room.weather || 'clear',
          status,
          createdAt: room.createdAt || Date.now()
        });
      }
    }
    return list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  /**
   * Broadcasts public room updates to all clients currently connected to the lobby.
   */
  broadcastPublicRooms() {
    const rooms = this.getPublicRooms();
    const msg = JSON.stringify({
      type: 'PUBLIC_ROOMS_UPDATE',
      rooms
    });
    if (this.lobbySockets) {
      for (const socket of this.lobbySockets) {
        try {
          if (socket.readyState === 1) { // OPEN
            socket.send(msg);
          }
        } catch (_) {}
      }
    }
  }

  /**
   * Serializes room state safely without circular references or sockets.
   */
  serializeRoom(room) {
    const startCheck = this.canStartRace(room);
    const participantsList = Array.from(room.participants.values())
      .map(p => this.serializeParticipant(p))
      .sort((a, b) => a.slotNumber - b.slotNumber);

    return {
      roomId: room.roomId,
      roomName: room.roomName,
      roomType: room.roomType || 'custom',
      hostParticipantId: room.hostParticipantId,
      maxPlayers: room.maxPlayers,
      connectedPlayersCount: participantsList.filter(p => p.connectionStatus === 'connected').length,
      readyPlayersCount: participantsList.filter(p => p.ready && p.connectionStatus === 'connected').length,
      circuitId: room.circuitId,
      circuitName: room.circuitName,
      includeQualifying: room.includeQualifying ?? false,
      laps: room.laps,
      simSpeed: room.raceSession?.simSpeed || 2,
      weather: room.weather,
      duplicatePolicy: room.duplicatePolicy,
      aiParticipation: room.aiParticipation,
      state: room.state,
      phase: room.phase,
      canStartRace: startCheck.canStart,
      startBlockReason: startCheck.reason || '',
      unreadyCount: startCheck.unreadyCount,
      participants: participantsList,
      slots: room.slots.map((pId, idx) => {
        if (!pId) return { slotNumber: idx + 1, occupied: false };
        const p = room.participants.get(pId);
        return {
          slotNumber: idx + 1,
          occupied: true,
          participantId: pId,
          displayName: p ? p.displayName : 'Unknown',
          ready: p ? p.ready : false,
          isHost: p ? p.isHost : false,
          connectionStatus: p ? p.connectionStatus : 'disconnected'
        };
      })
    };
  }

  serializeParticipant(p) {
    return {
      participantId: p.participantId,
      slotNumber: p.slotNumber,
      displayName: p.displayName,
      isHost: p.isHost,
      ready: p.ready,
      connectionStatus: p.connectionStatus,
      raceStatus: p.raceStatus,
      finishPosition: p.finishPosition,
      finishTime: p.finishTime,
      selectedDriver: p.selectedDriver,
      selectedCar: p.selectedCar,
      selectedManager: p.selectedManager
    };
  }

  getAuthoritativeRoster(room) {
    if (room.rouletteOutcomes) {
      const humanRoster = Object.values(room.rouletteOutcomes.participants);
      const aiRoster = room.rouletteOutcomes.aiDrivers || [];
      return [...humanRoster, ...aiRoster].sort((a, b) => a.slotNumber - b.slotNumber);
    }
    return [];
  }
}
