/**
 * raceControl.js
 * Centralized Autonomous FIA Race Control State Machine, Incident Evaluator & Penalty System.
 *
 * Implements:
 *   - Autonomous AI Race Control decision framework (escalation & de-escalation).
 *   - Authoritative Flag States: GREEN, YELLOW, VSC, SAFETY_CAR_DEPLOYING, SAFETY_CAR,
 *     SAFETY_CAR_IN_LAP, RED, CHEQUERED.
 *   - Physical Safety Car vehicle physics, positioning, and queue formation.
 *   - Virtual Safety Car (VSC) delta management without physical car.
 *   - Independent Investigation Lifecycle: OPEN -> UNDER_REVIEW -> RESOLVED.
 *   - Evidence evaluation for jump starts, collisions, illegal overtaking, VSC/SC speeding,
 *     track limits, and pit lane speeding.
 *   - Deterministic penalty assignment and enforcement.
 *   - Central player investigation notification synchronization.
 */

import { sampleTrack } from './trackManager.js';

export const FlagStates = {
  GREEN:                'green',
  YELLOW:               'yellow',
  VSC:                  'vsc',
  SAFETY_CAR_DEPLOYING: 'safetycar_deploying',
  SAFETY_CAR:           'safetycar',
  SAFETY_CAR_IN_LAP:    'safetycar_in_lap',
  RED:                  'red',
  CHEQUERED:            'chequered'
};

export const InvestigationStatus = {
  OPEN:         'OPEN',
  UNDER_REVIEW: 'UNDER_REVIEW',
  RESOLVED:     'RESOLVED'
};

export const PenaltyOutcome = {
  NO_ACTION:        'NO_ACTION',
  WARNING:          'WARNING',
  TIME_PENALTY_5S:  'TIME_PENALTY_5S',
  TIME_PENALTY_10S: 'TIME_PENALTY_10S'
};

export class RaceControl {
  /**
   * @param {object} track – track geometry
   */
  constructor(track, options = {}) {
    this.track = track;
    this.state = FlagStates.RED;
    this.previousState = FlagStates.GREEN;

    // Configurable Rule Toggles
    this.safetyCarEnabled = options.safetyCarEnabled ?? true;
    this.vscEnabled       = options.vscEnabled ?? true;
    this.penaltiesEnabled = options.penaltiesEnabled ?? true;

    // Physical Safety Car State
    this.safetyCar = {
      active: false,
      d: 0,
      lat: 0,
      v: 38.8, // 140 km/h standard pace (m/s)
      targetV: 38.8,
      x: 0,
      y: 0,
      ang: 0,
      beaconLightsActive: true,
      lapsRemaining: 0,
      inLap: false,
      state: 'OFF_TRACK' // 'OFF_TRACK' | 'DEPLOYING' | 'ON_TRACK' | 'IN_LAP'
    };

    // VSC state
    this.vscEnding = false;
    this.vscTimer = 0;

    // Restart & DRS Management
    this.drsLapsLocked = 0; // DRS locked for 1-2 laps after restart

    // Autonomous Incident & Escalation Tracking
    this.hazardCooldown = 0;
    this.yellowSegments = new Set();
    this.stoppedCarTimers = new Map(); // carIndex -> seconds stopped on track
    this.collisionDebounce = new Map(); // pairKey -> timestamp

    // Investigations & Penalties
    this.investigations = [];
    this.activeInvestigations = [];
    this.playerCarIndex = 0;
    this.penalties = [];
    this.trackLimitsStrikes = new Map();

    // Weather safety monitoring
    this.weatherSeverity = 0;
    this._lastWeatherBand = 'dry';

    // Player central notification hook
    this.onPlayerInvestigationUpdate = null;
  }

  setPlayerCarIndex(idx) {
    this.playerCarIndex = idx;
  }

  /**
   * Reset race control state cleanly for a new session or race start.
   */
  reset() {
    this.state = FlagStates.GREEN;
    this.previousState = FlagStates.GREEN;
    this.safetyCar = {
      active: false,
      d: 0,
      lat: 0,
      v: 38.8,
      targetV: 38.8,
      x: 0,
      y: 0,
      ang: 0,
      beaconLightsActive: true,
      lapsRemaining: 0,
      inLap: false,
      state: 'OFF_TRACK'
    };
    this.vscEnding = false;
    this.vscTimer = 0;
    this.drsLapsLocked = 0;
    this.hazardCooldown = 0;
    this.yellowSegments.clear();
    this.stoppedCarTimers.clear();
    this.collisionDebounce.clear();
    this.investigations = [];
    this.activeInvestigations = [];
    this.penalties = [];
    this.trackLimitsStrikes.clear();
    this.weatherSeverity = 0;
    this._lastWeatherBand = 'dry';
  }

  // ── Safety Car Physics & Positioning ──────────────────────────────────────

  /**
   * Deploy the physical Safety Car onto the circuit.
   * @param {number} laps – planned laps (typically 1-2 laps)
   * @param {number} leaderD – current track distance of race leader
   */
  deploySafetyCar(laps = 2, leaderD = 0) {
    if (this.state === FlagStates.CHEQUERED) return false;
    if (this.safetyCarEnabled === false) {
      this.state = FlagStates.YELLOW;
      return false;
    }

    this.previousState = this.state;
    this.state = FlagStates.SAFETY_CAR;

    const L = this.track.circuit.lengthM;
    // Spawn Safety Car ~60m ahead of leader or near pit exit
    this.safetyCar.active = true;
    this.safetyCar.d = (((leaderD + 60) % L) + L) % L;
    this.safetyCar.lat = 0;
    this.safetyCar.v = 38.8; // 140 km/h
    this.safetyCar.targetV = 38.8;
    this.safetyCar.beaconLightsActive = true;
    this.safetyCar.lapsRemaining = laps;
    this.safetyCar.inLap = false;
    this.safetyCar.state = 'ON_TRACK';

    this._updateSafetyCarCoordinates();
    return true;
  }

  /**
   * Deploy Virtual Safety Car.
   */
  deployVSC(durationS = 25) {
    if (this.state === FlagStates.CHEQUERED) return false;
    if (this.state === FlagStates.SAFETY_CAR || this.state === FlagStates.SAFETY_CAR_IN_LAP) return false;
    if (this.safetyCarEnabled === false && this.vscEnabled === false) {
      this.state = FlagStates.YELLOW;
      return false;
    }

    this.previousState = this.state;
    this.state = FlagStates.VSC;
    this.vscTimer = durationS;
    this.vscEnding = false;
    return true;
  }

  /**
   * Deploy Red Flag to suspend race session.
   */
  deployRedFlag(reason = 'Hazardous Track Conditions') {
    if (this.state === FlagStates.CHEQUERED) return false;
    this.previousState = this.state;
    this.state = FlagStates.RED;
    this.safetyCar.active = false;
    return true;
  }

  /**
   * Resume race under Green Flag conditions.
   */
  resumeRace() {
    if (this.state !== FlagStates.RED && this.state !== FlagStates.SAFETY_CAR_IN_LAP && this.state !== FlagStates.VSC) {
      return false;
    }
    this.state = FlagStates.GREEN;
    this.safetyCar.active = false;
    this.drsLapsLocked = 2; // Locked for 2 laps after restart
    return true;
  }

  // ── Investigation & Penalty System ────────────────────────────────────────

  /**
   * Open an authoritative investigation into an incident.
   */
  openInvestigation(car, reason, incidentType, lap, sector = 1, evidence = {}) {
    if (!car) return null;

    // Check for duplicate open investigation for the same car and reason
    const existing = this.activeInvestigations.find(inv =>
      inv.carIndex === car.i && inv.incidentType === incidentType && inv.status !== InvestigationStatus.RESOLVED
    );
    if (existing) return existing;

    const invId = `inv_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const isPlayer = (car.i === this.playerCarIndex);

    const inv = {
      id: invId,
      carIndex: car.i,
      driverCode: car.code,
      driverName: car.name || car.driver?.name || car.code,
      isPlayer,
      reason,
      incidentType,
      lap: lap || car.lap || 1,
      sector: sector || 1,
      timestamp: car.simTime || 0,
      status: InvestigationStatus.UNDER_REVIEW,
      reviewDurationS: 6.0 + Math.random() * 3.0, // 6-9 seconds of deliberation
      deliberationRemaining: 6.0 + Math.random() * 3.0,
      evidence: {
        speedAtIncident: Math.round((car.v || 0) * 3.6),
        ...evidence
      },
      decision: null,
      penaltySeconds: 0,
      decisionText: '',
      resolvedAt: null
    };

    this.investigations.unshift(inv);
    this.activeInvestigations.push(inv);

    // If player is involved, trigger central player notification
    if (isPlayer && this.onPlayerInvestigationUpdate) {
      this.onPlayerInvestigationUpdate(inv);
    }

    return inv;
  }

  /**
   * Resolve an investigation with authoritative ruling and apply penalty if warranted.
   */
  resolveInvestigation(inv, outcome = PenaltyOutcome.NO_ACTION, reason = '', penaltySeconds = 0) {
    if (!inv || inv.status === InvestigationStatus.RESOLVED) return;

    inv.status = InvestigationStatus.RESOLVED;
    inv.decision = outcome;
    inv.penaltySeconds = penaltySeconds;
    inv.decisionText = reason;
    inv.resolvedAt = Date.now();

    // Remove from active list
    const activeIdx = this.activeInvestigations.findIndex(a => a.id === inv.id);
    if (activeIdx !== -1) {
      this.activeInvestigations.splice(activeIdx, 1);
    }

    // Apply penalty to car if outcome includes time penalty
    if (penaltySeconds > 0) {
      const penaltyRecord = {
        id: this.penalties.length + 1,
        investigationId: inv.id,
        carIndex: inv.carIndex,
        driverCode: inv.driverCode,
        lap: inv.lap,
        reason: `${reason} (+${penaltySeconds}s)`,
        penaltySeconds,
        served: false
      };
      this.penalties.unshift(penaltyRecord);
    }

    // If player is involved, update the persistent central overlay
    if (inv.isPlayer && this.onPlayerInvestigationUpdate) {
      this.onPlayerInvestigationUpdate(inv);
    }

    return inv;
  }

  // ── Main Step Loop ────────────────────────────────────────────────────────

  /**
   * Autonomous Race Control update loop.
   *
   * @param {number} dt – elapsed simulation seconds
   * @param {number} simTime – total race time
   * @param {object[]} cars – all cars
   * @param {object} incidentManager – track incident engine
   * @param {object} weatherState – meteorological state
   * @param {object} trackCondition – water/track surface state
   * @returns {object[]} array of new Race Control events
   */
  update(dt, simTime, cars = [], incidentManager = null, weatherState = null, trackCondition = null) {
    const events = [];
    const L = this.track.circuit.lengthM;

    // 1. Advance Active Investigations
    this._updateInvestigations(dt, simTime, cars, events);

    // 2. Physical Safety Car Dynamics
    this._updateSafetyCar(dt, simTime, L, events);

    // 3. VSC Timer Countdown
    this._updateVSC(dt, simTime, events);

    // 4. Autonomous Incident & Hazard Monitoring (AI Decision Engine)
    this._evaluateAutonomousRaceControl(dt, simTime, cars, incidentManager, weatherState, trackCondition, L, events);

    // 5. Track Limits, Pit Speeding & Flag Compliance Checks
    this._evaluateDriverInfractions(simTime, cars, events);

    return events;
  }

  // ── Private Subsystems ───────────────────────────────────────────────────

  /**
   * Update active investigations and resolve expired deliberations.
   * @private
   */
  _updateInvestigations(dt, simTime, cars, events) {
    for (let i = this.activeInvestigations.length - 1; i >= 0; i--) {
      const inv = this.activeInvestigations[i];
      inv.deliberationRemaining -= dt;

      if (inv.deliberationRemaining <= 0) {
        // Resolve based on incident evidence
        let outcome = PenaltyOutcome.NO_ACTION;
        let penaltySec = 0;
        let decisionMsg = 'No Further Action (Racing Incident)';

        if (this.penaltiesEnabled === false) {
          outcome = PenaltyOutcome.NO_ACTION;
          penaltySec = 0;
          decisionMsg = 'No Further Action (Penalties Disabled in Session Rules)';
        } else if (inv.evidence?.fault === true) {
          outcome = PenaltyOutcome.TIME_PENALTY_5S;
          penaltySec = 5;
          decisionMsg = `5-Second Time Penalty (${inv.reason})`;
        } else if (inv.incidentType === 'jump_start') {
          outcome = PenaltyOutcome.TIME_PENALTY_5S;
          penaltySec = 5;
          decisionMsg = '5-Second Time Penalty (Jump Start)';
        } else if (inv.incidentType === 'pit_speeding') {
          outcome = PenaltyOutcome.TIME_PENALTY_5S;
          penaltySec = 5;
          decisionMsg = '5-Second Time Penalty (Speeding in Pit Lane)';
        } else if (inv.incidentType === 'illegal_overtake') {
          outcome = PenaltyOutcome.TIME_PENALTY_5S;
          penaltySec = 5;
          decisionMsg = '5-Second Time Penalty (Overtaking under yellow/safety flag)';
        } else if (inv.incidentType === 'track_limits') {
          outcome = PenaltyOutcome.TIME_PENALTY_5S;
          penaltySec = 5;
          decisionMsg = '5-Second Time Penalty (Exceeding Track Limits)';
        }

        this.resolveInvestigation(inv, outcome, decisionMsg, penaltySec);

        // Apply to car's internal penalties
        const targetCar = cars.find(c => c.i === inv.carIndex);
        if (targetCar && penaltySec > 0) {
          targetCar.penalties = (targetCar.penalties || []).concat({
            reason: decisionMsg,
            seconds: penaltySec
          });
        }

        // Broadcast toast
        events.push({
          time: simTime,
          type: 'penalty',
          category: 'penalty',
          priority: 2,
          headline: `DECISION: ${inv.driverCode}`,
          detail: decisionMsg,
          icon: penaltySec > 0 ? '⚖️' : '🟢',
          accent: penaltySec > 0 ? 'red' : 'green',
          key: `inv_res_${inv.id}`
        });
      }
    }
  }

  /**
   * Update Physical Safety Car movement and in-lap withdrawal.
   * @private
   */
  _updateSafetyCar(dt, simTime, L, events) {
    if (this.state === FlagStates.SAFETY_CAR || this.state === FlagStates.SAFETY_CAR_IN_LAP) {
      // Advance Safety Car distance along track at controlled cruising pace
      this.safetyCar.d = (this.safetyCar.d + this.safetyCar.v * dt) % L;
      this._updateSafetyCarCoordinates();

      // Decrement remaining laps
      this.safetyCar.lapsRemaining -= (this.safetyCar.v * dt) / L;

      // In-Lap Transition: when laps are expired and hazard is cleared
      if (this.safetyCar.lapsRemaining <= 0.05 && this.state === FlagStates.SAFETY_CAR) {
        this.state = FlagStates.SAFETY_CAR_IN_LAP;
        this.safetyCar.inLap = true;
        this.safetyCar.beaconLightsActive = false; // Authentic F1 rule: lights off = coming in this lap!
        this.safetyCar.state = 'IN_LAP';

        events.push({
          time: simTime,
          type: 'flag',
          category: 'safety_car',
          priority: 1,
          headline: 'SAFETY CAR IN THIS LAP',
          detail: 'Leader to dictate pace — no overtaking until green flag',
          icon: '🚗',
          accent: 'amber',
          key: `sc_in_lap_${Math.floor(simTime / 5)}`
        });
      }

      // Final Withdrawal: near the end of lap / pit entry
      const pitEntryD = this.track.pitLane?.entryD || (L - 140);
      const distToPit = Math.min(
        (((pitEntryD - this.safetyCar.d) % L) + L) % L,
        (((this.safetyCar.d - pitEntryD) % L) + L) % L
      );

      if (this.state === FlagStates.SAFETY_CAR_IN_LAP && distToPit < 40) {
        this.safetyCar.active = false;
        this.safetyCar.state = 'OFF_TRACK';
        this.state = FlagStates.GREEN;
        this.drsLapsLocked = 2; // Locked for 2 laps after restart

        events.push({
          time: simTime,
          type: 'flag',
          category: 'green_flag',
          priority: 1,
          headline: 'GREEN FLAG — RACING RESUMES!',
          detail: 'Track is clear — safety car returned to pit lane',
          icon: '🟢',
          accent: 'green',
          key: `sc_withdrawn_green_${Math.floor(simTime / 5)}`
        });
      }
    }
  }

  /**
   * Update VSC timer countdown.
   * @private
   */
  _updateVSC(dt, simTime, events) {
    if (this.state === FlagStates.VSC) {
      this.vscTimer -= dt;

      if (this.vscTimer <= 4.0 && !this.vscEnding) {
        this.vscEnding = true;
        events.push({
          time: simTime,
          type: 'flag',
          category: 'vsc',
          priority: 1,
          headline: 'VIRTUAL SAFETY CAR ENDING',
          detail: 'Prepare to resume normal racing speed',
          icon: '🟡',
          accent: 'amber',
          key: `vsc_ending_${Math.floor(simTime / 5)}`
        });
      }

      if (this.vscTimer <= 0) {
        this.state = FlagStates.GREEN;
        this.vscEnding = false;
        this.drsLapsLocked = 1;
        events.push({
          time: simTime,
          type: 'flag',
          category: 'green_flag',
          priority: 1,
          headline: 'GREEN FLAG — TRACK CLEAR',
          detail: 'VSC period ended — racing resumed',
          icon: '🟢',
          accent: 'green',
          key: `vsc_cleared_green_${Math.floor(simTime / 5)}`
        });
      }
    }
  }

  /**
   * Autonomous AI Race Control decision engine.
   * Evaluates live simulation incidents, debris, stopped cars, and weather safety.
   * Deterministically escalates and de-escalates flags.
   * @private
   */
  _evaluateAutonomousRaceControl(dt, simTime, cars, incidentManager, weatherState, trackCondition, L, events) {
    // Collect active hazards from incident manager
    this.yellowSegments.clear();
    const hazardSegments = incidentManager ? incidentManager.getHazardSegments() : [];
    hazardSegments.forEach(seg => this.yellowSegments.add(seg));

    // Monitor cars stopped on track (potential recovery hazard)
    let strandedCarsCount = 0;
    // Grace period during race start sequence / opening 12 seconds:
    // Cars are stationary on the starting grid or accelerating off the line.
    // In real racing and simulation, never flag cars as stranded during race launch.
    const isRaceStartGracePeriod = simTime < 12.0;

    for (const car of cars) {
      if (car.finished || car.pitStationary || car.pitState !== 'ready') continue;

      // During start sequence or while cars are clearing the starting grid box, skip stranded detection
      if (isRaceStartGracePeriod || (car.lap === 0 && car.d < 250)) {
        this.stoppedCarTimers.delete(car.i);
        continue;
      }

      if (car.v < 3.0) {
        const curTime = (this.stoppedCarTimers.get(car.i) || 0) + dt;
        this.stoppedCarTimers.set(car.i, curTime);

        // If stopped on track for > 2.5s outside start phase, it is a stranded hazard
        if (curTime > 2.5) {
          strandedCarsCount++;
          const segIdx = Math.floor((((car.d % L) + L) % L) / (L / 24));
          this.yellowSegments.add(segIdx);
        }
      } else {
        this.stoppedCarTimers.delete(car.i);
      }
    }

    // Weather safety assessment
    const avgWetness = trackCondition ? trackCondition.averageWetness : 0;
    const rainIntensity = weatherState ? weatherState.rainIntensity : 0;

    // Check weather band transition for toast notifications
    let curWeatherBand = 'dry';
    if (avgWetness > 0.75) curWeatherBand = 'monsoon';
    else if (avgWetness > 0.40) curWeatherBand = 'wet';
    else if (avgWetness > 0.15) curWeatherBand = 'damp';

    if (curWeatherBand !== this._lastWeatherBand) {
      const prev = this._lastWeatherBand;
      this._lastWeatherBand = curWeatherBand;

      if (curWeatherBand === 'monsoon') {
        events.push({
          time: simTime,
          type: 'info',
          category: 'info',
          priority: 2,
          headline: '🌧️ HEAVY MONSOON CONDITIONS',
          detail: 'Standing water on track — high aquaplaning risk',
          icon: '🌧️',
          accent: 'blue',
          key: `wx_monsoon_${Math.floor(simTime / 10)}`
        });
      } else if (curWeatherBand === 'wet') {
        events.push({
          time: simTime,
          type: 'info',
          category: 'info',
          priority: 3,
          headline: '🌧️ TRACK SURFACE WET',
          detail: 'Wet weather tyre compounds now optimal',
          icon: '🌧️',
          accent: 'blue',
          key: `wx_wet_${Math.floor(simTime / 10)}`
        });
      } else if (curWeatherBand === 'dry' && (prev === 'wet' || prev === 'monsoon' || prev === 'damp')) {
        events.push({
          time: simTime,
          type: 'info',
          category: 'info',
          priority: 3,
          headline: '☀️ TRACK DRYING',
          detail: 'Dry racing line emerging across all sectors',
          icon: '☀️',
          accent: 'green',
          key: `wx_drying_${Math.floor(simTime / 10)}`
        });
      }
    }

    // ── Autonomous Response Hierarchy & Escalation ──
    if (this.state === FlagStates.GREEN) {
      // 1. Critical Escalation: Catastrophic weather (wetness > 0.90) OR 2+ cars completely blocked
      if (avgWetness > 0.90 && rainIntensity > 0.85 && strandedCarsCount >= 2) {
        this.deployRedFlag('Severe flood and multiple stranded vehicles');
        events.push({
          time: simTime,
          type: 'flag',
          category: 'red_flag',
          priority: 1,
          headline: 'RED FLAG — RACE SUSPENDED',
          detail: 'Torrential conditions and blocked circuit',
          icon: '🚩',
          accent: 'red',
          key: `rf_auto_${Math.floor(simTime / 5)}`
        });
        return;
      }

      // 2. Severe Incident: Stranded car on racing line OR 2+ hazard sectors (guarded by race start grace period)
      if (!isRaceStartGracePeriod && (strandedCarsCount >= 1 || hazardSegments.length >= 2)) {
        // Deploy Physical Safety Car ahead of leader
        const leader = cars.slice().sort((a, b) => b.d - a.d)[0];
        const ok = this.deploySafetyCar(2, leader?.d || 0);
        if (ok) {
          events.push({
            time: simTime,
            type: 'flag',
            category: 'safety_car',
            priority: 1,
            headline: 'SAFETY CAR DEPLOYED',
            detail: strandedCarsCount > 0
              ? 'Stranded car on track — marshals attending'
              : 'Multiple track hazards — field neutralized',
            icon: '🚗',
            accent: 'amber',
            key: `sc_auto_${Math.floor(simTime / 5)}`
          });
        }
        return;
      }

      // 3. Moderate Hazard: Single debris incident
      if (!isRaceStartGracePeriod && hazardSegments.length === 1) {
        const ok = this.deployVSC(20);
        if (ok) {
          events.push({
            time: simTime,
            type: 'flag',
            category: 'vsc',
            priority: 1,
            headline: 'VIRTUAL SAFETY CAR (VSC)',
            detail: 'Track debris reported — adhere to delta time',
            icon: '🟡',
            accent: 'amber',
            key: `vsc_auto_${Math.floor(simTime / 5)}`
          });
        }
        return;
      }

      // 4. Local Yellow in sector
      if (this.yellowSegments.size > 0) {
        this.state = FlagStates.YELLOW;
      }
    } else if (this.state === FlagStates.YELLOW) {
      // Escalation from Yellow to VSC or SC if recovery is taking too long
      if (!isRaceStartGracePeriod && (strandedCarsCount >= 1 || hazardSegments.length >= 2)) {
        const leader = cars.slice().sort((a, b) => b.d - a.d)[0];
        this.deploySafetyCar(2, leader?.d || 0);
      } else if (hazardSegments.length === 0 && strandedCarsCount === 0) {
        // De-escalate from Yellow back to Green
        this.state = FlagStates.GREEN;
      }
    }
  }

  /**
   * Monitor driver infractions: collisions, track limits, pit speeding, illegal overtaking.
   * @private
   */
  _evaluateDriverInfractions(simTime, cars, events) {
    const L = this.track.circuit.lengthM;

    for (let i = 0; i < cars.length; i++) {
      const car = cars[i];
      if (car.finished || car.v < 10) continue;

      // 1. Proximity Collision Detection between Car pairs
      for (let j = i + 1; j < cars.length; j++) {
        const other = cars[j];
        if (other.finished || other.v < 10) continue;

        const forwardGap = (((other.d - car.d) % L) + L) % L;
        const reverseGap = (((car.d - other.d) % L) + L) % L;
        const distM = Math.min(forwardGap, reverseGap);
        const latDist = Math.abs(car.lat - other.lat);

        // Physical contact threshold
        if (distM < 3.2 && latDist < 1.8 && car.pitState === 'ready' && other.pitState === 'ready') {
          const pairKey = `${Math.min(car.i, other.i)}_${Math.max(car.i, other.i)}`;
          const lastCollision = this.collisionDebounce.get(pairKey) || 0;

          if (simTime - lastCollision > 5.0) {
            this.collisionDebounce.set(pairKey, simTime);

            // Determine fault based on approach speed and positioning
            const isCarBehind = (forwardGap < reverseGap);
            const behindCar = isCarBehind ? car : other;
            const aheadCar = isCarBehind ? other : car;
            const closingSpeed = behindCar.v - aheadCar.v;

            const isFault = closingSpeed > 4.5; // Rear-ending or dive-bombing at high delta
            const atFaultCar = isFault ? behindCar : null;

            const sector = Math.floor((((behindCar.d % L) + L) % L) / (L / 3)) + 1;

            if (atFaultCar) {
              this.openInvestigation(
                atFaultCar,
                `Causing a collision with ${isFault ? aheadCar.code : 'opponent'}`,
                'collision',
                atFaultCar.lap,
                sector,
                { fault: true, closingSpeedKmh: Math.round(closingSpeed * 3.6) }
              );
            } else {
              // Racing incident involving both cars
              this.openInvestigation(
                behindCar,
                `Incident involving ${aheadCar.code}`,
                'collision',
                behindCar.lap,
                sector,
                { fault: false }
              );
            }
          }
        }
      }

      // 2. Illegal Overtake under Yellow / VSC / Safety Car
      if (this.state === FlagStates.SAFETY_CAR || this.state === FlagStates.VSC || this.state === FlagStates.SAFETY_CAR_IN_LAP) {
        if (car.prevPosition && car.position < car.prevPosition && car.lap >= 1) {
          this.openInvestigation(
            car,
            `Illegal overtaking under ${this.state.replace('_', ' ').toUpperCase()}`,
            'illegal_overtake',
            car.lap,
            1,
            { fault: true }
          );
        }
      }

      // 3. Track limits check
      const maxLatThreshold = 18.0 * (this.track.k || 1.0);
      if (Math.abs(car.lat) > maxLatThreshold && !car.pitRequested && car.pitState === 'ready') {
        if (!car._offTrackDebounce) {
          car._offTrackDebounce = true;
          const strikes = (this.trackLimitsStrikes.get(car.i) || 0) + 1;
          this.trackLimitsStrikes.set(car.i, strikes);

          if (strikes === 3) {
            events.push({
              time: simTime,
              type: 'control',
              msg: `Race control: BLACK & WHITE FLAG for ${car.code} — FINAL TRACK LIMITS WARNING`,
              category: 'penalty',
              priority: 2,
              headline: `BLACK & WHITE FLAG: ${car.code}`,
              detail: 'Final warning for track limits violations',
              icon: '🏁',
              accent: 'yellow'
            });
          } else if (strikes >= 4) {
            this.openInvestigation(
              car,
              'Repeated track limits violations',
              'track_limits',
              car.lap,
              1,
              { fault: true }
            );
          }
        }
      } else {
        car._offTrackDebounce = false;
      }

      // 4. Pit Lane Speeding (> 80 km/h)
      if ((car.pitState === 'entering' || car.pitState === 'in_lane') && car.v > 23.5 && !car._pitSpeedingDebounce) {
        car._pitSpeedingDebounce = true;
        this.openInvestigation(
          car,
          `Speeding in the pit lane (${Math.round(car.v * 3.6)} km/h)`,
          'pit_speeding',
          car.lap,
          1,
          { fault: true, speedKmh: Math.round(car.v * 3.6) }
        );
      }
    }
  }

  /**
   * Calculate controlled target speed for a car during neutralization.
   * Enforces safe pack following distance and prevents collisions behind Safety Car.
   *
   * @param {object} car – car being evaluated
   * @param {object[]} standings – cars sorted P1..Pn
   * @returns {number|null} target speed cap in m/s, or null if full racing speed
   */
  getCarSpeedLimit(car, standings = []) {
    if (this.state === FlagStates.SAFETY_CAR || this.state === FlagStates.SAFETY_CAR_IN_LAP) {
      const L = this.track.circuit.lengthM;
      const isLeader = (car.position === 1);

      if (isLeader) {
        // Leader follows the Safety Car
        const gapToSC = (((this.safetyCar.d - car.d) % L) + L) % L;
        if (gapToSC < 45) {
          return this.safetyCar.v * 0.98; // ~38 m/s (137 km/h) Match SC pace
        } else if (gapToSC < 130) {
          return this.safetyCar.v * 1.05; // ~40.7 m/s (146 km/h) Gentle catch-up
        }
        return Math.min(44.4, this.safetyCar.v * 1.15); // ~160 km/h max catchup delta
      } else {
        // Trailing car follows car ahead in standings
        const aheadCar = standings[car.position - 2];
        if (aheadCar) {
          const gapToAhead = (((aheadCar.d - car.d) % L) + L) % L;
          if (gapToAhead < 20) {
            return Math.min(38.0, Math.max(15, aheadCar.v * 0.92)); // Brake to keep safe gap
          } else if (gapToAhead < 40) {
            return Math.min(42.0, aheadCar.v); // Match pace under SC ceiling
          }
        }
        return 44.0; // ~160 km/h controlled pack catchup
      }
    }

    if (this.state === FlagStates.VSC) {
      // VSC delta imposes a universal ~160 km/h ceiling
      return 44.4;
    }

    return null;
  }

  /**
   * Update Safety Car SVG world coordinates based on current d.
   * @private
   */
  _updateSafetyCarCoordinates() {
    if (!this.track) return;
    const { i, fr, heading } = sampleTrack(this.track, this.safetyCar.d);
    const pts = this.track.pts;
    const a = pts[i], b = pts[(i + 1) % this.track.N];
    const nx = -Math.sin(heading), ny = Math.cos(heading);
    this.safetyCar.x = a[0] + (b[0] - a[0]) * fr + nx * this.safetyCar.lat;
    this.safetyCar.y = a[1] + (b[1] - a[1]) * fr + ny * this.safetyCar.lat;
    this.safetyCar.ang = heading;
  }

  /** Check if DRS is permitted */
  isDRSPermitted(car) {
    if (this.state !== FlagStates.GREEN) return false;
    if (this.drsLapsLocked > 0) return false;
    return true;
  }

  /** Check if overtaking is permitted at distance d */
  isOvertakingPermitted(d) {
    if (this.state === FlagStates.RED || this.state === FlagStates.VSC ||
        this.state === FlagStates.SAFETY_CAR || this.state === FlagStates.SAFETY_CAR_IN_LAP) {
      return false;
    }
    const L = this.track.circuit.lengthM;
    const segIdx = Math.floor((((d % L) + L) % L) / (L / 24));
    if (this.yellowSegments.has(segIdx)) {
      return false;
    }
    return true;
  }
}
