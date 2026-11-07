/**
 * raceEngine.js
 * Central Race State Machine & Integrated Simulation Coordinator.
 *
 * Coordinates:
 *   1. Simulation timeline & dynamic dt warp
 *   2. Dynamic Weather Engine & Radar
 *   3. Spatial Track Condition & Drying Line Model
 *   4. Vehicle Physics, Tyre Dynamics, Fuel Mass & Brake Thermal management
 *   5. Aerodynamic Wakes, Dirty Air & Slipstreaming
 *   6. FIA Race Control State Machine (Flags, VSC, Safety Car, Red Flag, Penalties)
 *   7. Track Incident Management (Spins, hazards, debris, local yellows)
 *   8. Weather-Aware AI Strategy & Undercut/Overcut calculations
 *   9. Contextual Race Engineer & Live Team Radio Event Generation
 *  10. Real-time Telemetry, Lap Progression & Race Classification
 *
 * CHANGELOG (multiplayer launch fix):
 *   - start() no longer calls launchManager.forceRacing() in multiplayer.
 *     That call flipped the launch state to 'racing' synchronously, so the UI
 *     never rendered a 'lights_out' frame and the LAUNCH button never appeared.
 *   - Launch-manager synchronisation is now identical for single player and
 *     multiplayer and lives in _syncLaunchManagerOnStart().
 *   - isMultiplayer is initialised in the constructor.
 *   - Null-safety guards added around launchManager / raceControl in start()
 *     and playerLaunch().
 */

import { SimConfig } from '../config/simulationConfig.js';
import { placeCar, stepCar, resolveCarCollisions } from './physicsEngine.js';
import { CarSetup } from './carSetup.js';
import { DriverAgent } from '../ai/driverAgent.js';
import { TyreStrategy, assignStartingCompounds } from '../strategy/tyreStrategy.js';
import { TyreModel } from './tyreModel.js';
import { FuelModel } from './fuelModel.js';
import { BrakeModel } from './brakeModel.js';
import { AeroModel } from './aeroModel.js';
import { WeatherEngine } from './weatherEngine.js';
import { TrackConditionModel } from './trackConditionModel.js';
import { RaceControl, FlagStates } from './raceControl.js';
import { IncidentManager } from './incidentManager.js';
import { StrategyAI } from '../strategy/strategyAI.js';
import { RaceEngineer } from '../strategy/raceEngineer.js';
import { DriverPsychology } from './driverPsychology.js';
import { DRSController } from './drsController.js';
import { PitStopManager, PitStates } from '../strategy/pitStopManager.js';
import { LaunchManager, StartStates } from './launchManager.js';
import { sampleTrack } from './trackManager.js';
import { commentaryEngine } from '../strategy/commentaryEngine.js';
import { getCarByTeam } from '../data/carData.js';
import { MANAGERS } from '../data/managerData.js';
import { resolveDriverFullName, resolveDriverSurname } from '../utils/driverResolver.js';
import { BatteryController, BatteryMode, BatteryPowerLevel, BatteryState } from './batteryController.js';

export const RaceState = {
  WAITING:  'waiting',
  RACING:   'racing',
  SC:       'safetycar',
  FINISHED: 'finished',
};

/** LCG seeded RNG — deterministic when seed is fixed */
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export class RaceEngine {
  constructor() {
    this.cars          = [];
    this.track         = null;
    this.state         = RaceState.WAITING;
    this.flag          = 'red';
    this.totalLaps     = 5;
    this.simTime       = 0;
    this.events        = [];
    this.latestRadio   = [];
    this.warp          = 5;
    this.seed          = 42;
    this._rand         = rng(42);
    this._acc          = 0;
    this._boardDirty   = true;
    this.selectedCarIdx = 0;
    this.userDRSActive  = false;
    this.isMultiplayer  = false;

    // Race finish & classification lifecycle
    this.playerCarIdx = 0;
    this._finishedCount = 0;
    this._leaderFinished = false;
    this._playerFinished = false;
    this._winnerCar = null;
    this._finishCommentaryEmitted = false;
    this._podiumCommentaryEmitted = false;

    // Integrated sub-systems
    this.weatherEngine   = new WeatherEngine('dry');
    this.trackCondition  = null;
    this.incidentManager = null;
    this.raceControl     = null;
    this.launchManager   = new LaunchManager(this);
    this.commentaryEngine = commentaryEngine;
    this.commentaryEngine.load().catch(() => {});
    this._startCommentaryPlayed = false;
  }

  /**
   * Initialise the engine for a circuit + driver list.
   * @param {object}   track       – from trackManager.buildTrack()
   * @param {object[]} driverList  – from driverData.getGrid()
   * @param {number}   totalLaps
   */
  build(track, driverList, totalLaps, options = {}) {
    this.track      = track;
    this.totalLaps  = totalLaps;
    this.options    = options || {};
    this.state      = RaceState.WAITING;
    this.flag       = 'red';
    this._lastToastFlag = 'red';
    this.simTime    = 0;
    this.events     = [];
    this.latestRadio = [];
    this._rand      = rng(this.seed);
    this._acc       = 0;
    this.userDRSActive = false;

    const L   = track.circuit.lengthM;
    const gM  = SimConfig.race.gridSpacingM;
    const k   = track.k || 1;

    // Instantiate track-coupled systems
    this.trackCondition  = new TrackConditionModel(L, 24, track.circuit?.id);
    this.incidentManager = new IncidentManager(L, 24);
    this.raceControl     = new RaceControl(track, {
      safetyCarEnabled: options.safetyCarEnabled ?? true,
      vscEnabled: options.vscEnabled ?? true,
      penaltiesEnabled: options.penaltiesEnabled ?? true
    });
    this.raceControl.setPlayerCarIndex(this.selectedCarIdx);
    this.raceControl.commentaryEngine = this.commentaryEngine;
    this._startCommentaryPlayed = false;
    this.commentaryEngine?.resetRace();

    if (options.weatherPreset && this.weatherEngine) {
      this.weatherEngine.setPreset(options.weatherPreset);
    }

    let aiDifficultyMult = 1.0;
    if (typeof options.aiDifficultyMult === 'number') {
      aiDifficultyMult = options.aiDifficultyMult;
    } else if (options.aiDifficulty) {
      const diffKey = String(options.aiDifficulty).toLowerCase();
      if (diffKey === 'easy') aiDifficultyMult = 0.96;
      else if (diffKey === 'normal') aiDifficultyMult = 1.00;
      else if (diffKey === 'hard') aiDifficultyMult = 1.025;
      else if (diffKey === 'expert' || diffKey === 'legend') aiDifficultyMult = 1.045;
    }

    const playerIdx = options.playerCarIdx ?? 0;
    this.playerCarIdx = playerIdx;
    this.isMultiplayer = !!options.isMultiplayer;
    if (typeof options.warp === 'number') {
      this.warp = options.warp;
    } else if (this.isMultiplayer) {
      this.warp = 2;
    }
    this.sessionType = options.sessionType || (options.isQualifying ? 'QUALIFYING' : 'RACE');
    this._finishedCount = 0;
    this._leaderFinished = false;
    this._playerFinished = false;
    this._winnerCar = null;
    this._finishCommentaryEmitted = false;
    this._podiumCommentaryEmitted = false;

    this.cars = driverList.map((driver, i) => {
      const gridSide = i % 2 === 0 ? -1 : 1;
      const isPlayer = (i === playerIdx);
      const aiPaceMult = isPlayer ? 1.0 : aiDifficultyMult;
      const carModel = isPlayer
        ? (options.playerCarModel || getCarByTeam(driver.team))
        : getCarByTeam(driver.team);
      const manager = isPlayer
        ? (options.playerManager || MANAGERS.find(m => m.team === driver.team) || null)
        : (MANAGERS.find(m => m.team === driver.team) || null);

      const car = {
        i, driver, code: driver.code, name: driver.name,
        team: driver.team, color: driver.color, teamColor: driver.teamColor, number: driver.number,
        isPlayer,
        participantId: driver.participantId || null,
        displayName: driver.displayName || driver.name,
        isAI: driver.isAI !== undefined ? driver.isAI : !driver.participantId,
        isRemotePeer: !isPlayer && !!driver.participantId && !driver.isAI,
        aiPaceMult,
        carModel,
        manager,
        // Physics state
        d: -(i + 1) * gM, lat: gridSide * 3.6 * k,
        v: 0, x: 0, y: 0, ang: 0,
        throttle: 0, brake: 0, steer: 0,
        acc: 0, latAcc: 0,
        _physRem: 0, _trackI: 0,
        // Race state
        lap: 0, lapStart: null, lastLap: null, bestLap: null,
        position: i + 1, prevPosition: i + 1, gapToLeader: 0,
        retiredLap: null, finished: false, finishTime: null,
        finishPosition: null, finishLap: null, finishTimestamp: null,
        qualifyingCompleted: false,
        qualifyingTime: null,
        qualifyingState: {
          phase: 'OUT_LAP',
          sector1: null,
          sector2: null,
          sector3: null,
          lapTime: null,
          valid: true
        },
        // Integrated Subsystems
        tyreWear: 0,
        tyreStrategy: null,
        tyreModel: null,
        fuelModel: new FuelModel(totalLaps, L),
        brakeModel: new BrakeModel(this.weatherEngine.ambientTemp),
        batteryController: new BatteryController({ startingEnergyJoules: 4000000 * 0.85 }),
        batteryEligibility: { eligible: false, battleType: 'NONE', context: 'CHARGING', reason: 'Normal energy recovery' },
        raceEngineer: null,
        aeroState: { downforceMult: 1.0, dragMult: 1.0, inDirtyAir: false, inSlipstream: false },
        currentGrip: 1.0,
        currentWetness: 0,
        penalties: [],
        strategicAdvice: null,
        isSpun: false,
        spinTimer: 0,
        // AI
        agent: new DriverAgent(driver),
        _agentOut: null, _wasDrs: false, _wasOT: false, _defended: 0,
        // DRS State
        drsEligible: false,
        drsActive: false,
        inDrsZone: false,
        drsReason: 'Evaluating...',
        drsGapS: null,
        currentDrsZone: null,
        // Pit Stop State
        pitState: PitStates.READY,
        pitRequested: false,
        pitLateRequest: false,
        targetCompound: 'medium',
        pitServiceTimer: 0,
        pitSpeedLimit: null,
        pitStationary: false,
        pitstops: 0,
        // Lap pace variance
        lapPaceVar: 1 + (this._rand() - 0.5) * SimConfig.race.randomVariance * 2,
      };

      car.agent.init(gridSide, k);
      car.psychology = DriverPsychology.createInitialState(driver, track.circuit, {
        homeAdvantageEnabled: this.options.homeAdvantageEnabled ?? true,
        previousWinnerEnabled: this.options.previousWinnerEnabled ?? true,
        archivedHistory: this.options.archivedHistory || null,
        currentSeasonCalendar: this.options.currentSeasonCalendar || null,
        currentRoundIndex: this.options.currentRoundIndex || null
      });
      car.raceEngineer = new RaceEngineer(car, {
        mode: this.options.radioMode || 'full'
      });

      // Car Setup & Mechanical Damage (Phase 2 & 10)
      car.damage = { frontWing: 0.0, floor: 0.0, sidepod: 0.0 };
      const customSetup = (isPlayer && this.options.playerCarSetup) ? this.options.playerCarSetup : (this.options.carSetup || {});
      const carSetup = new CarSetup(customSetup);
      carSetup.applyToCar(car);

      placeCar(car, track, car.d, car.lat);
      return car;
    });

    assignStartingCompounds(this.cars);
    // Link tyreModel for each car matching starting compound
    this.cars.forEach(car => {
      const cmp = car.tyreStrategy?.compound || 'medium';
      car.tyreModel = new TyreModel(cmp, 0, { punctureOnWear: false });
      car.compoundsUsed = new Set([cmp]);
    });

    if (options.startingCompound) {
      const pCar = this.cars[playerIdx];
      if (pCar) {
        pCar.targetCompound = options.startingCompound;
        if (pCar.tyreStrategy) pCar.tyreStrategy.compound = options.startingCompound;
        pCar.tyreModel = new TyreModel(options.startingCompound, 0, { punctureOnWear: false });
        pCar.compoundsUsed = new Set([options.startingCompound]);
      }
    }

    this._updatePositions();
    this.launchManager.reset(this.selectedCarIdx);
    this._log('Race control: All systems go. Grid set.', 'control');
  }

  /** Start the FIA 5-red-light sequence & user launch reaction challenge */
  startGridSequence() {
    this.state = RaceState.WAITING;
    this.flag = 'red';
    this.raceControl.state = FlagStates.RED;
    this.launchManager.startSequence();
    this._log('Race control: 5 Red Lights sequence initiated. Drivers prepare for launch.', 'control');
  }

  /** User presses LAUNCH button or spacebar */
  playerLaunch(timestamp = performance.now()) {
    if (!this.launchManager) return null;
    const res = this.launchManager.registerPlayerLaunch(timestamp);
    if (res && res.early) {
      const playerCar = this.cars[this.selectedCarIdx];
      if (playerCar && this.raceControl) {
        this.raceControl.openInvestigation(
          playerCar,
          'Jump start before lights out',
          'jump_start',
          1,
          1,
          { fault: true, early: true }
        );
      }
    }
    return res;
  }

  /**
   * Start or restart the race immediately.
   *
   * Called by LaunchManager._triggerLightsOut() when the lights go out (both
   * single player and multiplayer), and directly when the grid sequence is
   * bypassed.
   *
   * IMPORTANT: LaunchManager must already be in StartStates.LIGHTS_OUT when this
   * is called from the lights-out path. See _syncLaunchManagerOnStart().
   */
  start() {
    this.state  = RaceState.RACING;
    this.flag   = 'green';
    this._lastToastFlag = 'green';
    this.simTime = 0;
    this.userDRSActive = false;
    if (this.raceControl) {
      if (typeof this.raceControl.reset === 'function') {
        this.raceControl.reset();
      }
      this.raceControl.state = FlagStates.GREEN;
    }

    this._syncLaunchManagerOnStart();

    const startEv = {
      time: 0,
      type: 'start',
      category: 'start',
      priority: 2,
      headline: 'LIGHTS OUT AND AWAY WE GO!',
      detail: 'Race underway — all drivers on track',
      icon: '🚦',
      accent: 'green',
      key: 'race_start_lights_out'
    };
    this.events.push(startEv);
    this._log('Race control: GO GO GO!', 'control');
  }

  /**
   * Keep LaunchManager consistent with the engine when the race starts.
   *
   * - LIGHTS_OUT: preserve it. The player must see "LAUNCH NOW" for at least one
   *   render frame and be able to react. Forcing RACING here (the old multiplayer
   *   behaviour via forceRacing()) hid the launch button and froze the player
   *   car at v = 0 because playerReacted never became true.
   * - Any other state (bypassed sequence, restart, no launch challenge): mark
   *   the launch as resolved so cars are not clamped on the grid.
   * @private
   */
  _syncLaunchManagerOnStart() {
    const lm = this.launchManager;
    if (!lm) return;
    if (lm.state !== StartStates.LIGHTS_OUT) {
      lm.state = StartStates.RACING;
      lm.playerReacted = true;
    }
  }

  /** Reset to pre-race state */
  reset(track, driverList, totalLaps) {
    this.build(track, driverList, totalLaps);
  }

  /** Set selected car for manual control */
  setSelectedCar(idx) {
    this.selectedCarIdx = Math.max(0, Math.min(idx, this.cars.length - 1));
    this.userDRSActive = false;
    if (this.launchManager) {
      this.launchManager.playerCarIdx = this.selectedCarIdx;
    }
    if (this.raceControl) {
      this.raceControl.setPlayerCarIndex(this.selectedCarIdx);
    }
  }

  /**
   * Return the authoritative player vehicle instance.
   * @returns {object|null}
   */
  getPlayerCar() {
    if (!this.cars || this.cars.length === 0) return null;
    return this.cars.find(c => c.isPlayer) ?? this.cars[this.playerCarIdx] ?? this.cars[this.selectedCarIdx] ?? this.cars[0];
  }

  /**
   * Authoritatively retires a car (DNF), preserving official classification.
   * @param {number} [idx] - car index (defaults to player / selected car)
   * @param {string} [reason] - reason for retirement
   * @returns {boolean}
   */
  retireCar(idx, reason = 'Mechanical Failure') {
    const carIdx = (idx !== undefined) ? idx : this.selectedCarIdx;
    const car = this.cars[carIdx];
    if (!car || car.retiredLap !== null || car.finished) return false;

    car.retiredLap = Math.max(1, car.lap || 1);
    car.v = 0;
    car.throttle = 0;
    car.brake = 1;
    car.retirementReason = reason;

    const carFullName = resolveDriverFullName(car, car.code);
    const ev = {
      time: this.simTime,
      type: 'incident',
      category: 'incident',
      priority: 1,
      headline: `${car.code} RETIRED (DNF)`,
      detail: `${carFullName} has retired from the race (${reason})`,
      icon: '⚠️',
      accent: 'red',
      key: `retire_${car.code}_lap${car.retiredLap}`
    };
    this.events.push(ev);
    this._log(`Race control: ${car.code} retired (${reason})`, 'control');

    this._updatePositions();

    if (this.checkGlobalRaceFinished() && this.state !== RaceState.FINISHED) {
      this._onRaceFinish(this.events, this.latestRadio);
    }
    return true;
  }

  /**
   * Authoritative global race completion evaluation.
   * Under single-player rules, the race continues until the player finishes
   * or a legitimate race-ending condition occurs (e.g. player DNF + leader finished, or all cars complete).
   * @returns {boolean}
   */
  checkGlobalRaceFinished() {
    if (this.state === RaceState.FINISHED) return true;
    if (!this.cars || this.cars.length === 0) return false;

    // 1. If every car on the grid is finished or retired, the session is unconditionally complete
    const allComplete = this.cars.every(c => c.finished || c.qualifyingCompleted || c.retiredLap !== null);
    if (allComplete) return true;

    // In qualifying mode, session strictly finishes ONLY when ALL eligible cars have completed their flying laps!
    if (this.sessionType === 'QUALIFYING') {
      return allComplete;
    }

    // In multiplayer mode, the race MUST wait for ALL participants to finish or reach terminal state!
    if (this.isMultiplayer) {
      return allComplete;
    }

    // 2. Single-player mode: check the player car
    const playerCar = this.getPlayerCar();
    if (playerCar) {
      // Player crossed the finish line
      if (playerCar.finished) {
        return true;
      }
      // Player retired: conclude once the leader has finished (or if leader already finished)
      if (playerCar.retiredLap !== null) {
        if (this._leaderFinished) {
          return true;
        }
      }
      // Player is still actively racing: keep simulation running!
      return false;
    }

    // 3. Fallback for pure AI / spectator simulations without player car
    return allComplete;
  }

  /** Toggle manual DRS for the selected driver */
  toggleDRS(idx) {
    const carIdx = (idx !== undefined) ? idx : this.selectedCarIdx;
    const car = this.cars[carIdx];
    if (!car) return { success: false, reason: 'Invalid car' };

    const eligibility = DRSController.evaluate(car, this.track, this.cars, this.simTime, this.flag);

    if (this.userDRSActive) {
      this.userDRSActive = false;
      car.drsActive = false;
      return { success: true, active: false, reason: 'DRS Closed by Driver' };
    }

    if (!eligibility.eligible) {
      return { success: false, active: false, reason: eligibility.reason };
    }

    this.userDRSActive = true;
    car.drsActive = true;
    return { success: true, active: true, reason: 'DRS Deployed' };
  }

  /** Request pit stop for a car */
  requestPit(idx, targetCompound = 'medium') {
    const carIdx = (idx !== undefined) ? idx : this.selectedCarIdx;
    const car = this.cars[carIdx];
    if (!car) return { success: false, message: 'Invalid car' };

    const res = PitStopManager.requestPit(car, targetCompound, this.track);
    if (res.success) {
      this._log(res.message, 'pit');
    }
    return res;
  }

  /** Cancel an active pit stop request */
  cancelPit(idx) {
    const carIdx = (idx !== undefined) ? idx : this.selectedCarIdx;
    const car = this.cars[carIdx];
    if (!car) return { success: false, message: 'Invalid car' };

    const res = PitStopManager.cancelPit(car);
    if (res.success) {
      this._log(res.message, 'pit');
    }
    return res;
  }

  // ── Manual Battery Deployment & ERS Controller Methods ───────────────────

  /** Toggle battery mode between CHARGE and ATTACK */
  toggleBatteryMode(idx) {
    const carIdx = (idx !== undefined) ? idx : this.selectedCarIdx;
    const car = this.cars[carIdx];
    if (!car || !car.batteryController) return { success: false, reason: 'No battery controller' };

    const elig = car.batteryEligibility || car.batteryController.evaluateEligibility(car, this.cars, this.track, this.simTime, this.flag);
    const targetMode = car.batteryController.mode === BatteryMode.CHARGE ? BatteryMode.ATTACK : BatteryMode.CHARGE;
    const ok = car.batteryController.setMode(targetMode, elig);
    return {
      success: ok,
      mode: car.batteryController.mode,
      state: car.batteryController.state,
      reason: ok
        ? (targetMode === BatteryMode.ATTACK ? 'Attack Mode Activated' : 'Switched to Charge Mode')
        : (car.batteryController.isDepleted ? 'Battery Depleted (0%)' : (elig.reason || 'Attack Mode Unavailable'))
    };
  }

  /** Explicitly set battery mode */
  setBatteryMode(mode, idx) {
    const carIdx = (idx !== undefined) ? idx : this.selectedCarIdx;
    const car = this.cars[carIdx];
    if (!car || !car.batteryController) return false;
    const elig = car.batteryEligibility || car.batteryController.evaluateEligibility(car, this.cars, this.track, this.simTime, this.flag);
    return car.batteryController.setMode(mode, elig);
  }

  /** Set battery power level (1, 2, or 3) */
  setBatteryPowerLevel(level, idx) {
    const carIdx = (idx !== undefined) ? idx : this.selectedCarIdx;
    const car = this.cars[carIdx];
    if (!car || !car.batteryController) return false;
    return car.batteryController.setPowerLevel(level);
  }

  /** Authoritative evaluation of battery eligibility for a car */
  evaluateBatteryEligibility(idx) {
    const carIdx = (idx !== undefined) ? idx : this.selectedCarIdx;
    const car = this.cars[carIdx];
    if (!car || !car.batteryController) return { eligible: false, context: 'INELIGIBLE', reason: 'No car' };
    return car.batteryController.evaluateEligibility(car, this.cars, this.track, this.simTime, this.flag);
  }

  /** Autonomous AI battery deployment decision making */
  _stepAIBattery(car, battElig, dt) {
    const batt = car.batteryController;
    if (!batt) return;

    const cornering = batt.currentCorneringFactor;

    if (batt.mode === BatteryMode.ATTACK) {
      // While deploying: disengage or switch to charge if in corner, braking hard, or low energy
      if (cornering > 0.30 || car.brake > 0.15 || batt.socPercent < 10 || !battElig.eligible) {
        batt.setMode(BatteryMode.CHARGE);
      }
    } else {
      // In charge mode: deploy if fully charged and on straight with attacking or defending opportunity
      if (batt.isFullyCharged && battElig.eligible && cornering < 0.22 && car.throttle > 0.60) {
        const agg = car.driver?.personality?.aggression ?? 0.70;
        const tyreWear = car.tyreModel?.wear ?? 0.20;

        if (tyreWear > 0.65) {
          batt.setPowerLevel(BatteryPowerLevel.LEVEL_1);
        } else if (agg > 0.75 || battElig.gapS < 1.2) {
          batt.setPowerLevel(BatteryPowerLevel.LEVEL_3);
        } else {
          batt.setPowerLevel(BatteryPowerLevel.LEVEL_2);
        }

        batt.setMode(BatteryMode.ATTACK, battElig);
      }
    }
  }

  /** Check battery lifecycle events for commentary and radio */
  _checkBatteryEvents(car, newEvents, radioEvents) {
    const batt = car.batteryController;
    if (!batt) return;

    if (!this._battCooldowns) {
      this._battCooldowns = { ready: -99, deploy: -99, low: -99, depleted: -99, stress: -99 };
    }

    // Battery Full & Ready
    if (batt.isFullyCharged && (this.simTime - this._battCooldowns.ready > 40)) {
      this._battCooldowns.ready = this.simTime;
      const ev = {
        time: this.simTime,
        type: 'battery_ready',
        category: 'strategy',
        priority: 3,
        headline: 'BATTERY 100% — ATTACK READY',
        detail: 'ERS battery fully charged. Attack mode available when in range.',
        icon: '⚡',
        accent: 'green',
        key: `batt_ready_${car.lap}`
      };
      if (newEvents) newEvents.push(ev);
    }

    // Battery Attack Mode Deployment Active
    if (batt.state === BatteryState.DEPLOYING && (this.simTime - this._battCooldowns.deploy > 15)) {
      this._battCooldowns.deploy = this.simTime;
      const radioEv = {
        time: this.simTime,
        type: 'BATTERY_ATTACK_ACTIVE',
        driver: car.code,
        powerLevel: batt.powerLevel,
        msg: `Battery attack deployment active at Level ${batt.powerLevel}. Maximum hybrid torque available.`
      };
      if (radioEvents) radioEvents.push(radioEv);
    }

    // Low Battery Warning (< 20%)
    if ((batt.state === BatteryState.DEPLOYING || batt.isDeploying) && batt.socPercent < 20 && (this.simTime - this._battCooldowns.low > 25)) {
      this._battCooldowns.low = this.simTime;
      const radioEv = {
        time: this.simTime,
        type: 'BATTERY_LOW',
        driver: car.code,
        soc: Math.round(batt.socPercent),
        msg: `Battery low: ${Math.round(batt.socPercent)}% remaining. Energy harvest will resume soon.`
      };
      if (radioEvents) radioEvents.push(radioEv);
    }

    // Battery Depleted
    if (batt.isDepleted && (batt.lastState === BatteryState.DEPLOYING || this.simTime - this._battCooldowns.depleted > 20)) {
      this._battCooldowns.depleted = this.simTime;
      const ev = {
        time: this.simTime,
        type: 'battery_depleted',
        category: 'strategy',
        priority: 3,
        headline: 'BATTERY DEPLETED',
        detail: 'Battery energy exhausted. Returning to charge mode.',
        icon: '🔋',
        accent: 'amber',
        key: `batt_depleted_${car.lap}`
      };
      if (newEvents) newEvents.push(ev);
      if (radioEvents) {
        radioEvents.push({
          time: this.simTime,
          type: 'BATTERY_DEPLETED',
          driver: car.code,
          msg: 'Battery depleted. Hybrid boost disabled while harvesting.'
        });
      }
    }

    // High Tyre Stress Warning
    if (batt.currentTyreStress > 0.40 && (this.simTime - this._battCooldowns.stress > 30)) {
      this._battCooldowns.stress = this.simTime;
      const ev = {
        time: this.simTime,
        type: 'battery_stress',
        category: 'tyre',
        priority: 3,
        headline: 'HIGH TYRE SCRUBBING STRESS',
        detail: 'Aggressive deployment in corners is accelerating tyre degradation.',
        icon: '🛞',
        accent: 'red',
        key: `batt_stress_${car.lap}`
      };
      if (newEvents) newEvents.push(ev);
    }
  }

  // ── Race Control & Incident Triggers ──────────────────────────────────────

  deployVSC(duration = 30) {
    const ok = this.raceControl.deployVSC(duration);
    if (ok) {
      this.flag = FlagStates.VSC;
      this._log('Race control: VIRTUAL SAFETY CAR DEPLOYED', 'control');
    }
    return ok;
  }

  deploySafetyCar(laps = 2) {
    const leader = this.standings[0];
    const ok = this.raceControl.deploySafetyCar(laps, leader?.d || 0);
    if (ok) {
      this.flag = FlagStates.SAFETY_CAR;
      this._log('Race control: PHYSICAL SAFETY CAR DEPLOYED', 'control');
    }
    return ok;
  }

  deployRedFlag(reason = 'Hazardous Track Conditions') {
    const ok = this.raceControl.deployRedFlag(reason);
    if (ok) {
      this.flag = FlagStates.RED;
      this._log(`Race control: RED FLAG — ${reason}`, 'control');
    }
    return ok;
  }

  resumeRace() {
    const ok = this.raceControl.resumeRace();
    if (ok) {
      this.flag = FlagStates.GREEN;
      this.state = RaceState.RACING;
      this._log('Race control: GREEN FLAG — RACE RESUMED!', 'control');
    }
    return ok;
  }

  setWeatherPreset(key) {
    this.weatherEngine.setPreset(key);
    this._log(`Race control: Weather scenario set to ${this.weatherEngine.preset.name}`, 'info');
  }

  setManualRain(intensity) {
    this.weatherEngine.setManualRain(intensity);
  }

  triggerHazard(type = 'hazard') {
    const inc = this.incidentManager.triggerManualIncident(type, this.simTime, this.track.circuit.lengthM);
    this._log(`Incident: ${inc.description}`, 'control');
    return inc;
  }

  setRadioMode(mode) {
    this.options.radioMode = mode;
    this.cars.forEach(car => {
      if (car.raceEngineer) car.raceEngineer.setMode(mode);
    });
  }

  // ── Main Step Loop ────────────────────────────────────────────────────────

  /**
   * Advance the race by dt wall-clock seconds.
   * Returns array of new event messages (with attached .radio events).
   */
  step(dt) {
    if (this.state === RaceState.WAITING || this.state === RaceState.FINISHED) return [];
    const newEvents = [];
    const radioEvents = [];
    const ds = dt * this.warp;
    this.simTime += ds;
    const L = this.track.circuit.lengthM;

    // 1. Meteorological & Track Water Evolution
    const weatherState = this.weatherEngine.update(ds, this.simTime);
    this.trackCondition.update(ds, weatherState.rainIntensity, this.cars);
    const avgWetness = this.trackCondition.averageWetness;

    // 2. Incident & Race Control State Machine
    const incEvents = this.incidentManager.update(this.simTime, this.cars, avgWetness);
    newEvents.push(...incEvents);

    const rcEvents = this.raceControl.update(ds, this.simTime, this.cars, this.incidentManager, weatherState, this.trackCondition);
    newEvents.push(...rcEvents);

    // Sync flag state with race control and detect transitions
    const prevFlag = this._lastToastFlag;
    this.flag = this.raceControl.state;
    if (this.flag !== prevFlag) {
      this._lastToastFlag = this.flag;
      if (this.flag === FlagStates.YELLOW || this.flag === 'yellow') {
        newEvents.push({
          time: this.simTime,
          type: 'flag',
          category: 'yellow_flag',
          priority: 1,
          headline: 'YELLOW FLAG — CAUTION',
          detail: 'Hazard on track — no overtaking permitted',
          icon: '⚠️',
          accent: 'yellow',
          key: `flag_yellow_${Math.floor(this.simTime / 5)}`
        });
      } else if (this.flag === FlagStates.VSC || this.flag === 'vsc') {
        newEvents.push({
          time: this.simTime,
          type: 'flag',
          category: 'vsc',
          priority: 1,
          headline: 'VIRTUAL SAFETY CAR (VSC)',
          detail: 'Reduce speed — adhere to delta time',
          icon: '🟡',
          accent: 'amber',
          key: `flag_vsc_${Math.floor(this.simTime / 5)}`
        });
      } else if (this.flag === FlagStates.SAFETY_CAR || this.flag === 'safety_car') {
        newEvents.push({
          time: this.simTime,
          type: 'flag',
          category: 'safety_car',
          priority: 1,
          headline: 'SAFETY CAR DEPLOYED',
          detail: 'Full course yellow — pack up behind safety car',
          icon: '🚗',
          accent: 'amber',
          key: `flag_sc_${Math.floor(this.simTime / 5)}`
        });
      } else if (this.flag === FlagStates.SAFETY_CAR_IN_LAP || this.flag === 'safetycar_in_lap') {
        newEvents.push({
          time: this.simTime,
          type: 'flag',
          category: 'safety_car',
          priority: 1,
          headline: 'SAFETY CAR IN THIS LAP',
          detail: 'Leader to dictate pace — no overtaking until green flag',
          icon: '🚗',
          accent: 'amber',
          key: `flag_sc_in_${Math.floor(this.simTime / 5)}`
        });
      } else if (this.flag === FlagStates.RED || this.flag === 'red') {
        newEvents.push({
          time: this.simTime,
          type: 'flag',
          category: 'red_flag',
          priority: 1,
          headline: 'RED FLAG — SESSION STOPPED',
          detail: 'All cars return to pit lane',
          icon: '🚩',
          accent: 'red',
          key: `flag_red_${Math.floor(this.simTime / 5)}`
        });
      } else if ((this.flag === FlagStates.GREEN || this.flag === 'green') && prevFlag && prevFlag !== 'red') {
        newEvents.push({
          time: this.simTime,
          type: 'flag',
          category: 'green_flag',
          priority: 2,
          headline: 'GREEN FLAG — TRACK CLEAR',
          detail: 'Racing resumed',
          icon: '🟢',
          accent: 'green',
          key: `flag_green_${Math.floor(this.simTime / 5)}`
        });
      }

      // Dynamic CSV-driven commentary dialogue integration
      let flagEvType = null;
      if (this.flag === FlagStates.YELLOW || this.flag === 'yellow') flagEvType = 'YELLOW_FLAG';
      else if (this.flag === FlagStates.VSC || this.flag === 'vsc') flagEvType = 'VSC_DEPLOYED';
      else if (this.flag === FlagStates.SAFETY_CAR || this.flag === 'safety_car') flagEvType = 'SAFETY_CAR_DEPLOYED';
      else if (this.flag === FlagStates.SAFETY_CAR_IN_LAP || this.flag === 'safetycar_in_lap') flagEvType = 'SAFETY_CAR_IN_LAP';
      else if (this.flag === FlagStates.RED || this.flag === 'red') flagEvType = 'RED_FLAG';
      else if ((this.flag === FlagStates.GREEN || this.flag === 'green') && prevFlag && prevFlag !== 'red') {
        flagEvType = (prevFlag && (prevFlag.includes('safety') || prevFlag.includes('sc'))) ? 'RESTART' : 'GREEN_FLAG';
      }
      if (flagEvType) {
        const flagComm = this.commentaryEngine?.processEvent(flagEvType, { sector: 2, simTime: this.simTime });
        if (flagComm) radioEvents.push(flagComm);
      }
    }

    // Race Start lights-out commentary trigger
    if (this.launchManager.state === StartStates.LIGHTS_OUT && !this._startCommentaryPlayed) {
      this._startCommentaryPlayed = true;
      const startComm = this.commentaryEngine?.processEvent('RACE_START', { simTime: this.simTime });
      if (startComm) {
        radioEvents.push(startComm);
        newEvents.push(startComm);
      }
    }

    // Warm-up ramp
    const ramp = Math.min(1, 0.08 + this.simTime / 6);

    // 3. Aerodynamic Wake & Proximity Pre-pass
    for (let idx = 0; idx < this.cars.length; idx++) {
      const car = this.cars[idx];
      if (car.finished || car.retiredLap !== null) continue;

      let carAhead = null;
      let minGapM = Infinity;
      let carBehind = null;
      let minBehindM = Infinity;

      for (let j = 0; j < this.cars.length; j++) {
        if (j === idx) continue;
        const other = this.cars[j];
        if (other.finished || other.retiredLap !== null) continue;
        const gapM = (((other.d - car.d) % L) + L) % L;
        if (gapM > 0 && gapM < minGapM) {
          minGapM = gapM;
          carAhead = other;
        }
        const gapBehindM = (((car.d - other.d) % L) + L) % L;
        if (gapBehindM > 0 && gapBehindM < minBehindM) {
          minBehindM = gapBehindM;
          carBehind = other;
        }
      }

      const { curv } = sampleTrack(this.track, car.d);
      const isCorner = Math.abs(curv) > 0.0015;
      const latDiff = carAhead ? Math.abs(car.lat - carAhead.lat) : 0;

      car.aeroState = AeroModel.evaluateWake(car, carAhead, minGapM, latDiff, isCorner, car.drsActive);
      car.carAhead = carAhead;
      car.minGapM = minGapM;
      car.carBehind = carBehind;
      car.minBehindM = minBehindM;
    }

    // 4. Vehicle Physics, Strategy, AI Decisions & Track Progression
    const weatherRadar = this.weatherEngine.getForecast(180);

    this.cars.forEach(car => {
      if (car.retiredLap !== null) return;

      // Handle finished AI rollout and safe off-line parking
      if (car.finished) {
        const finishLineD = this.totalLaps * L;
        const distPastFinish = car.d - finishLineD;
        if (distPastFinish < 80 && car.v > 4) {
          car.throttle = 0;
          car.brake = 0.35;
          const targetLat = (car.lat >= 0 ? 1 : -1) * 12.0;
          stepCar(car, this.track, ds, targetLat, 0.25, ramp, 0, 30, 1.0);
        } else {
          car.v = 0;
          car.throttle = 0;
          car.brake = 1;
        }
        return;
      }

      const isSelected = (car.i === this.selectedCarIdx);

      // Local track segment surface wetness, temperature & evolution grip
      const localCond = this.trackCondition.getConditionAt(car.d, car.lat);
      car.currentWetness = localCond.wetness;
      car.currentRubber = localCond.rubberLevel;
      const rubberBonus = 1.0 + (localCond.rubberLevel * 0.042) * Math.max(0, 1.0 - localCond.wetness * 4.0);
      const standingWaterPenalty = localCond.standingWater ? 0.78 : 1.0;
      const localTrackGrip = rubberBonus * standingWaterPenalty;

      // DRS evaluation & application
      const drsEval = DRSController.evaluate(car, this.track, this.cars, this.simTime, this.flag);
      const wasDrsActive = car.drsActive;
      DRSController.apply(car, isSelected, drsEval, this.userDRSActive);

      if (isSelected && wasDrsActive && !car.drsActive) {
        this.userDRSActive = false;
      }

      // Battery ERS evaluation & state sync
      if (car.batteryController) {
        const battElig = car.batteryController.evaluateEligibility(car, this.cars, this.track, this.simTime, this.flag);
        car.batteryEligibility = battElig;

        if (!isSelected) {
          this._stepAIBattery(car, battElig, ds);
        } else {
          this._checkBatteryEvents(car, newEvents, radioEvents);
        }
      }

      // Strategic AI Evaluation (Weather, Crossover, Undercut/Overcut, SC Opportunity, FIA Rules)
      const stratEval = StrategyAI.evaluate(
        car,
        this.totalLaps,
        avgWetness,
        weatherRadar,
        SimConfig.race.pitLaneDeltaS,
        this.cars,
        this.flag,
        this.track,
        this.trackCondition,
        this.simTime
      );
      car.strategicAdvice = stratEval;

      // Autonomous pit strategy for opponents
      if (!isSelected && !car.pitRequested && car.pitState === PitStates.READY) {
        if (stratEval.shouldPit) {
          PitStopManager.requestPit(car, stratEval.recommendedCompound, this.track);
        }
      }

      // Pit Stop state machine & limiter
      const pitNav = PitStopManager.update(car, this.track, ds, this.simTime, newEvents);
      car.pitSpeedLimit = pitNav.speedLimitMps;
      car.pitStationary = pitNav.isStationary;

      // Autonomous Driver Agent Decision
      const { targetLat, paceFactor, message } = car.agent.decide(
        car, this.cars, this.track, this.simTime, this.flag, this.trackCondition
      );
      if (message) newEvents.push({ time: this.simTime, msg: message, type: 'ai' });

      // Effective lateral offset
      const effectiveLat = pitNav.latTarget !== null ? pitNav.latTarget : targetLat;

      // Race start launch evaluation
      const launchStatus = this.launchManager.evaluateCarLaunch(car, this.simTime);
      if (!launchStatus.canAccelerate) {
        car.v = 0;
        car.throttle = 0;
        car.brake = 1;
        return;
      }

      // Pace factor combines driver pace + lap variance + launch throttle ramp + difficulty multiplier
      const driverPace = (car.driver && typeof car.driver.pace === 'number' && !isNaN(car.driver.pace)) ? car.driver.pace : 1.0;
      const throttleMod = (launchStatus && typeof launchStatus.throttleModifier === 'number' && !isNaN(launchStatus.throttleModifier)) ? launchStatus.throttleModifier : 1.0;
      const lapVar = (typeof car.lapPaceVar === 'number' && !isNaN(car.lapPaceVar)) ? car.lapPaceVar : 1.0;
      const diffPace = car.isPlayer ? 1.0 : (car.aiPaceMult ?? 1.0);
      const totalPace = driverPace * (paceFactor || 1.0) * lapVar * throttleMod * diffPace;

      const prevD = car.d;

      // Race Control speed cap during VSC or Safety Car
      car.rcSpeedLimit = this.raceControl ? this.raceControl.getCarSpeedLimit(car, this.standings) : null;

      // Physical Step Integration with wetness, temperature, and dynamic track evolution grip
      stepCar(car, this.track, ds, effectiveLat, totalPace, ramp, localCond.wetness, localCond.trackTemp, localTrackGrip);

      // Lap detection
      if (prevD < 0 && car.d >= 0) {
        car.lap = 1;
        car.lapStart = this.simTime;
        if (car.qualifyingState) car.qualifyingState.phase = 'FLYING_LAP';
        newEvents.push({ time: this.simTime, msg: null, type: 'lap_tick' });
      } else if (car.lap >= 1 && !car.finished) {
        // Sector tracking for qualifying
        if (car.lapStart !== null && car.qualifyingState) {
          const dInLap = (((car.d % L) + L) % L);
          const prevDInLap = (((prevD % L) + L) % L);
          const s1Dist = L / 3;
          const s2Dist = (2 * L) / 3;

          if (prevDInLap < s1Dist && dInLap >= s1Dist && car.qualifyingState.sector1 === null) {
            car.qualifyingState.sector1 = Math.round((this.simTime - car.lapStart) * 1000) / 1000;
          } else if (prevDInLap < s2Dist && dInLap >= s2Dist && car.qualifyingState.sector2 === null && car.qualifyingState.sector1 !== null) {
            car.qualifyingState.sector2 = Math.round((this.simTime - car.lapStart - car.qualifyingState.sector1) * 1000) / 1000;
          }
        }

        const prevLap = Math.floor(prevD / L);
        const curLap  = Math.floor(car.d / L);
        if (curLap > prevLap) {
          this._onLapComplete(car, newEvents);
        }
      }

      // Driver Dynamic Psychology Update
      if (car.psychology) {
        DriverPsychology.update(car.psychology, ds, {
          overtakeSuccess: car._agentOut?.message && car._agentOut.message.includes('commits to overtake'),
          spinOrLockup: car.isSpun
        });
      }

      // Race Engineer Contextual Evaluation
      if (car.raceEngineer) {
        const rMsgs = car.raceEngineer.evaluate({
          simTime: this.simTime,
          flag: this.flag,
          weather: weatherState,
          trackWetness: avgWetness,
          carAhead: car.carAhead,
          carBehind: car.carBehind,
          strategy: stratEval,
          raceControl: this.raceControl,
          totalLaps: this.totalLaps,
          isSelected
        });

        if (rMsgs && rMsgs.length) {
          radioEvents.push(...rMsgs);
          if (isSelected) {
            newEvents.push(...rMsgs.map(r => ({ time: r.time, msg: r.msg, type: r.category || 'ai' })));
          }
        }
      }
    });

    // Physical multi-car collision resolution & impulse response (Phase 2 & 10)
    const colEvents = resolveCarCollisions(this.cars, this.track, ds);
    if (colEvents && colEvents.length > 0) {
      for (const ce of colEvents) {
        newEvents.push({ time: this.simTime, msg: ce.message, type: 'incident' });
      }
    }

    // Position update
    this._updatePositions(newEvents, radioEvents);
    this._boardDirty = true;
    this.latestRadio = radioEvents;
    newEvents.radio = radioEvents;

    // Authoritative global race completion check
    if (this.checkGlobalRaceFinished() && this.state !== RaceState.FINISHED) {
      this._onRaceFinish(newEvents, radioEvents);
    }

    return newEvents;
  }

  // ── Private ───────────────────────────────────────────────────────────────

  _onLapComplete(car, events) {
    if (car.lapStart !== null) {
      const lapTime = this.simTime - car.lapStart;
      car.lastLap = lapTime;
      if (car.bestLap === null || lapTime < car.bestLap) car.bestLap = lapTime;
    }
    car.lap++;
    car.lapStart = this.simTime;

    // Tyre degradation per lap
    if (car.tyreStrategy) {
      const delta = car.tyreStrategy.stepLap(car);
      car.lapPaceVar = 1 + delta + (this._rand() - 0.5) * SimConfig.race.randomVariance * 2;
    }
    if (car.tyreModel) {
      car.tyreModel.onLapEnd();
    }

    // Finish check for individual driver
    if (this.sessionType === 'QUALIFYING' && !car.qualifyingCompleted) {
      car.qualifyingCompleted = true;
      car.qualifyingTime = car.lastLap;
      car.finished = true;
      if (car.qualifyingState) {
        car.qualifyingState.phase = 'COMPLETED';
        car.qualifyingState.lapTime = car.lastLap;
        if (car.qualifyingState.sector1 !== null && car.qualifyingState.sector2 !== null && car.lastLap) {
          car.qualifyingState.sector3 = Math.round((car.lastLap - car.qualifyingState.sector1 - car.qualifyingState.sector2) * 1000) / 1000;
        }
      }
      this._finishedCount = (this._finishedCount || 0) + 1;
      car.finishPosition = this._finishedCount;
      car.finishTime = this.simTime;
      return;
    }

    if (car.lap > this.totalLaps && !car.finished) {
      car.finished = true;
      this._finishedCount = (this._finishedCount || 0) + 1;
      car.finishPosition = this._finishedCount;
      car.finishTime = this.simTime;
      car.finishLap = this.totalLaps;
      car.finishTimestamp = performance.now();
      car.position = car.finishPosition;

      const carFullName = resolveDriverFullName(car, car.code);

      if (car.finishPosition === 1) {
        this._leaderFinished = true;
        this._winnerCar = car;
        const winMsg = `${carFullName} crosses the line to win the race!`;
        const winEv = {
          time: this.simTime,
          type: 'finish',
          category: 'finish',
          priority: 1,
          headline: 'CHEQUERED FLAG — P1 WINNER',
          detail: winMsg,
          icon: '🏆',
          accent: 'gold',
          key: `winner_${car.code}`
        };
        if (events) events.push(winEv);
        this._log(`Race control: ${winMsg}`, 'control');

        const finComm = this.commentaryEngine?.processEvent('RACE_FINISH', { driver: carFullName, code: car.code, simTime: this.simTime });
        if (finComm && events) events.push(finComm);
        const winComm = this.commentaryEngine?.processEvent('RACE_WIN', { driver: carFullName, code: car.code, position: 1, simTime: this.simTime });
        if (winComm && events) events.push(winComm);
      } else {
        const finishEv = {
          time: this.simTime,
          type: 'finish',
          category: 'finish',
          priority: 2,
          headline: `${car.code} FINISHES P${car.finishPosition}`,
          detail: `${carFullName} finishes in P${car.finishPosition} (+${(car.finishTime - (this._winnerCar?.finishTime || car.finishTime)).toFixed(2)}s)`,
          icon: car.finishPosition <= 3 ? '🥈' : '🏁',
          accent: car.finishPosition <= 3 ? 'gold' : 'blue',
          key: `finish_${car.code}_p${car.finishPosition}`
        };
        if (events) events.push(finishEv);
      }

      if (car.isPlayer) {
        this._playerFinished = true;
      }
    }

    events.push({ time: this.simTime, msg: null, type: 'lap_tick' });
  }

  _updatePositions(events = null, radioEvents = null) {
    const sorted = this.cars.slice().sort((a, b) => {
      // 1. Finished cars ordered by official finishPosition
      if (a.finished && b.finished) {
        return (a.finishPosition ?? 999) - (b.finishPosition ?? 999);
      }
      if (a.finished && !b.finished) return -1;
      if (!a.finished && b.finished) return 1;

      // 2. Non-retired active cars before retired cars
      const aRet = a.retiredLap !== null;
      const bRet = b.retiredLap !== null;
      if (!aRet && bRet) return -1;
      if (aRet && !bRet) return 1;

      // 3. Retired cars ordered by laps completed, then distance
      if (aRet && bRet) {
        if (b.retiredLap !== a.retiredLap) return b.retiredLap - a.retiredLap;
        return b.d - a.d;
      }

      // 4. Active racing cars: lap first, then track distance
      if (b.lap !== a.lap) {
        return b.lap - a.lap;
      }
      return b.d - a.d;
    });

    const leader = sorted[0];
    const L = this.track.circuit.lengthM;
    const avgV = L / this.track.circuit.rec;

    sorted.forEach((car, idx) => {
      const newPos = idx + 1;
      if (car.finished && car.finishPosition != null) {
        car.position = car.finishPosition;
      } else {
        car.position = newPos;
      }

      if (car.prevPosition && car.prevPosition !== newPos) {
        if (newPos < car.prevPosition && car.lap >= 1 && this.state === RaceState.RACING && !car.finished) {
          // Check if overtaking was illegal under Yellow/VSC/Safety Car
          if (this.raceControl && !this.raceControl.isOvertakingPermitted(car.d)) {
            this.raceControl.openInvestigation(
              car,
              `Illegal overtaking under ${this.flag.replace('_', ' ').toUpperCase()} flag`,
              'illegal_overtake',
              car.lap,
              1,
              { fault: true, flag: this.flag }
            );
          }
          const prevOccupant = this.cars.find(c => c.position === newPos && c.i !== car.i);
          const opponentCode = prevOccupant ? prevOccupant.code : `P${newPos}`;
          const carFullName = resolveDriverFullName(car, car.code);
          const opponentFullName = prevOccupant ? resolveDriverFullName(prevOccupant, opponentCode) : `Position ${newPos}`;

          if (newPos === 1) {
            const ev = {
              time: this.simTime,
              type: 'lead_change',
              category: 'lead_change',
              priority: 2,
              driver: car.code,
              driverFullName: carFullName,
              headline: `${car.code} TAKES THE LEAD!`,
              detail: `Passes ${opponentFullName} for P1`,
              icon: '⚡',
              accent: 'gold',
              key: `lead_${car.code}_lap${car.lap}_${Math.floor(this.simTime / 4)}`
            };
            this.events.push(ev);
            if (events) events.push(ev);

            // CSV Dialogue for Lead Change
            const leadComm = this.commentaryEngine?.processEvent('LEAD_CHANGE', {
              driver: carFullName,
              code: car.code,
              rival: opponentFullName,
              position: 1,
              simTime: this.simTime
            });
            if (leadComm) {
              if (radioEvents) radioEvents.push(leadComm);
              if (events) events.push(leadComm);
            }
          } else {
            const ev = {
              time: this.simTime,
              type: 'overtake',
              category: 'overtake',
              priority: 3,
              driver: car.code,
              driverFullName: carFullName,
              headline: `${car.code} OVERTAKES ${opponentCode}`,
              detail: `Passes ${opponentFullName} for P${newPos}`,
              icon: '🏎️',
              accent: 'blue',
              key: `pass_${car.code}_${opponentCode}_lap${car.lap}`
            };
            this.events.push(ev);
            if (events) events.push(ev);

            // CSV Dialogue for Overtake Success
            const ovtComm = this.commentaryEngine?.processEvent('OVERTAKE_SUCCESS', {
              overtaker: carFullName,
              overtaken: opponentFullName,
              code: car.code,
              position: newPos,
              simTime: this.simTime
            });
            if (ovtComm) {
              if (radioEvents) radioEvents.push(ovtComm);
              if (events) events.push(ovtComm);
            }
          }
        }
        car.prevPosition = newPos;
      } else if (!car.prevPosition) {
        car.prevPosition = newPos;
      }

      car.position = newPos;
      if (idx === 0) {
        car.gapToLeader = 0;
      } else if (car.finished && leader?.finishTime != null && car.finishTime != null) {
        car.gapToLeader = Math.max(0.001, car.finishTime - leader.finishTime);
      } else if (leader?.finishTime != null) {
        car.gapToLeader = Math.max(0, (this.totalLaps * L - car.d) / avgV);
      } else {
        car.gapToLeader = Math.max(0, (leader.d - car.d) / avgV);
      }
    });
  }

  _onRaceFinish(events, radioEvents = null) {
    this.state = RaceState.FINISHED;
    this.flag  = 'chequered';
    this.raceControl.state = FlagStates.CHEQUERED;
    this._updatePositions(events, radioEvents);
    const winner = this.standings[0];
    const winnerFullName = resolveDriverFullName(winner, winner ? winner.code : 'Leader');
    const winMsg = `${winnerFullName} wins the race!`;
    const finishEv = {
      time: this.simTime,
      type: 'finish',
      category: 'finish',
      priority: 1,
      headline: 'CHEQUERED FLAG — RACE CONCLUDED',
      detail: winMsg,
      icon: '🏁',
      accent: 'gold',
      key: 'chequered_flag_concluded'
    };
    if (events) events.push(finishEv);
    this._log(`Race control: CHEQUERED FLAG! ${winMsg}`, 'control');

    // Dynamic CSV commentary for Chequered Flag & Victory
    if (!this._finishCommentaryEmitted) {
      this._finishCommentaryEmitted = true;
      const finComm = this.commentaryEngine?.processEvent('RACE_FINISH', { driver: winnerFullName, code: winner?.code, simTime: this.simTime });
      if (finComm) {
        if (events) events.push(finComm);
        if (radioEvents) radioEvents.push(finComm);
      }
      const winComm = this.commentaryEngine?.processEvent('RACE_WIN', { driver: winnerFullName, code: winner?.code, position: 1, simTime: this.simTime });
      if (winComm) {
        if (events) events.push(winComm);
        if (radioEvents) radioEvents.push(winComm);
      }
    }
    const p2 = this.standings[1];
    if (p2 && !this._podiumCommentaryEmitted) {
      this._podiumCommentaryEmitted = true;
      const p2FullName = resolveDriverFullName(p2, p2.code);
      const podComm = this.commentaryEngine?.processEvent('PODIUM', { driver: p2FullName, code: p2.code, position: 2, simTime: this.simTime });
      if (podComm) {
        if (events) events.push(podComm);
        if (radioEvents) radioEvents.push(podComm);
      }
    }
  }

  _log(msg, type = 'info') {
    this.events.push({ time: this.simTime, msg, type });
  }

  // ── Accessors for UI ──────────────────────────────────────────────────────

  get standings() {
    return this.cars.slice().sort((a, b) => a.position - b.position);
  }

  getTelemetry(carIndex) {
    const idx = (carIndex !== undefined) ? carIndex : this.selectedCarIdx;
    const car = this.cars[idx];
    if (!car) return null;

    const weather = this.weatherEngine;
    const trackCond = this.trackCondition;
    const radar = weather.getForecast(180);

    return {
      speed:          Math.round(car.v * 3.6),
      throttle:       car.throttle,
      brake:          car.brake,
      steer:          car.steer,
      lap:            car.lap,
      lapTime:        car.lapStart !== null ? this.simTime - car.lapStart : 0,
      lastLap:        car.lastLap,
      bestLap:        car.bestLap,
      gear:           this._estimateGear(car.v),
      tyre:           car.tyreModel?.label ?? car.tyreStrategy?.label ?? '?',
      tyreCompound:   car.tyreModel?.compound ?? car.tyreStrategy?.compound ?? 'medium',
      tyreColour:     car.tyreModel?.colour ?? car.tyreStrategy?.colour ?? '#ffd60a',
      tyreWear:       car.tyreWear,
      tyreTemp:       Math.round(car.tyreTemp || car.tyreModel?.temp || 98),
      tyreAge:        car.tyreModel?.ageLaps || 0,
      tyreCondition:  car.tyreModel?.getGrip(car.currentWetness || 0)?.condition || 'OPTIMAL',
      punctured:      car.tyreModel?.punctured || false,
      compoundsUsed:  car.compoundsUsed ? Array.from(car.compoundsUsed) : [car.tyreModel?.compound || 'medium'],
      twoDrySatisfied: car.strategicAdvice?.twoDrySatisfied ?? true,
      brakeTemp:      Math.round(car.brakeTemp || car.brakeModel?.temp || 340),
      fuelRemaining:  (car.fuelModel?.fuelRemainingKg || 0).toFixed(1),
      fuelLaps:       car.fuelModel?.lapsRemaining || '0',
      ersSoc:         Math.round(car.batteryController?.socPercent ?? (car.fuelModel?.batterySoc ? car.fuelModel.batterySoc * 100 : 85)),
      batterySoc:     car.batteryController ? Math.round(car.batteryController.socPercent) : 85,
      batteryEnergyJoules: car.batteryController?.energy ?? 0,
      batteryMaxEnergyJoules: car.batteryController?.maxEnergy ?? 4000000,
      batteryMode:    car.batteryController?.mode ?? 'CHARGE',
      batteryState:   car.batteryController?.state ?? 'CHARGING',
      batteryPowerLevel: car.batteryController?.powerLevel ?? 2,
      batteryDeploying: car.batteryController?.isDeploying ?? false,
      batteryHarvesting: car.batteryController?.isHarvesting ?? false,
      batteryEligibility: car.batteryEligibility || { eligible: false, battleType: 'NONE', context: 'CHARGING', reason: 'Normal energy recovery' },
      batteryCorneringFactor: car.batteryController?.currentCorneringFactor ?? 0,
      batteryTyreStress: car.batteryController?.currentTyreStress ?? 0,
      currentGrip:    Math.round((car.currentGrip || 1.0) * 100),
      inDirtyAir:     car.aeroState?.inDirtyAir || false,
      inSlipstream:   car.aeroState?.inSlipstream || false,
      downforceMult:  car.aeroState?.downforceMult || 1.0,
      dragMult:       car.aeroState?.dragMult || 1.0,
      position:       car.position,
      gapToLeader:    car.gapToLeader,
      drs:            car.drsActive,
      drsEligible:    car.drsEligible,
      drsActive:      car.drsActive,
      drsReason:      car.drsReason || (car.inDrsZone ? 'In DRS Zone' : 'Outside DRS Zone'),
      drsGapS:        car.drsGapS,
      inDrsZone:      car.inDrsZone,
      pitstops:       car.pitstops || 0,
      pitState:       car.pitState || PitStates.READY,
      pitRequested:   car.pitRequested || false,
      pitLateRequest: car.pitLateRequest || false,
      targetCompound: car.targetCompound || 'medium',
      pitTimer:       car.pitServiceTimer || 0,
      launch:         this.launchManager.getLaunchTelemetry(),
      // Weather & Track info
      weatherLabel:   weather.weatherLabel,
      rainIntensity:  Math.round(weather.rainIntensity * 100),
      trackWetness:   Math.round((car.currentWetness ?? trackCond.averageWetness) * 100),
      avgTrackWetness: Math.round(trackCond.averageWetness * 100),
      trackRubberLevel: Math.round((trackCond ? trackCond.averageRubberLevel : 0) * 100),
      carLocalRubber: Math.round((car.currentRubber || 0) * 100),
      dryingLine:     trackCond ? trackCond.getDryingLineState() : { formed: false, avgLineWetness: 0, avgOffLineWetness: 0 },
      tacticalState:  car.agent?.tacticalState || 'CRUISING',
      trackTemp:      Math.round(trackCond.trackTemp),
      ambientTemp:    Math.round(weather.ambientTemp),
      radar:          radar,
      // Race Control & Penalties
      flag:                 this.flag,
      safetyCar:            this.raceControl ? this.raceControl.safetyCar : null,
      investigations:       this.raceControl ? this.raceControl.investigations : [],
      activeInvestigations: this.raceControl ? this.raceControl.activeInvestigations : [],
      penalties:            car.penalties || [],
      penaltiesCount:       car.penalties?.length || 0,
      strategicAdvice: car.strategicAdvice,
      // Psychology & Track Context
      psychology:       car.psychology,
      confidence:       Math.round((car.psychology?.confidence ?? 0.5) * 100),
      isHomeRace:       car.psychology?.isHome ?? false,
      isPreviousWinner: car.psychology?.isPreviousWinner ?? false,
      isDefendingWinner: car.psychology?.isDefendingChampion ?? false,
      psychContext:     car.psychology?.contextMessage ?? null,
      psychBadgeType:   car.psychology?.badgeType ?? null
    };
  }

  /**
   * Authoritative Developer Diagnostics Telemetry Mode (Phase 8).
   * Exposes deep simulation telemetry separate from the player HUD:
   * vehicle dynamics, physical braking markers, tactical planning,
   * conflict predictions, dynamic grip, ERS deployment, and predictive pit strategy.
   *
   * @param {number} [carIndex] – car index to inspect (defaults to selectedCarIdx)
   * @returns {object|null} Developer diagnostics telemetry packet
   */
  getDeveloperTelemetry(carIndex) {
    const idx = (carIndex !== undefined) ? carIndex : this.selectedCarIdx;
    const car = this.cars[idx];
    if (!car) return null;

    const track = this.track;
    const L = track?.circuit?.lengthM || 1;
    const k = track?.k || 1;
    const plan = car.drivingPlan || {};
    const conflicts = plan.conflicts || {};
    const strat = car.strategicAdvice || {};
    const weather = this.weatherEngine;
    const trackCond = this.trackCondition;

    // Kinematic Braking Distance calculation
    const targetV = car.desiredV ?? car.v;
    const brakeEff = car.brakeModel?.efficiency ?? 1.0;
    const effectiveGrip = car.currentGrip ?? 1.0;
    const aBrakeCap = brakeEff * effectiveGrip * 44.0;
    const brakingDistanceM = car.v > targetV
      ? Math.max(0, (car.v * car.v - targetV * targetV) / (2 * Math.max(1.0, aBrakeCap)))
      : 0;

    // Lookahead target corner
    const lookAheadM = Math.min(180, Math.max(45, (car.v * car.v) / (2 * 40.0) + 20));
    const targetSample = track ? sampleTrack(track, car.d + lookAheadM) : null;
    const targetCurvature = (targetSample && track?.speedModel?.kap) ? track.speedModel.kap[targetSample.i] : 0;

    // Corridor classification
    let racingCorridor = 'RACING_LINE';
    if (plan.defensiveIntent) {
      racingCorridor = 'DEFENDING_INSIDE';
    } else if (plan.otDecision === 'VIABLE_OPPORTUNITY') {
      racingCorridor = car.lat < 0 ? 'ATTACK_INSIDE' : 'ATTACK_OUTSIDE';
    } else if (car.lat < -1.8 * k) {
      racingCorridor = 'INSIDE_LINE';
    } else if (car.lat > 1.8 * k) {
      racingCorridor = 'OUTSIDE_LINE';
    }

    // Nearby car predictions
    const opponentAhead = conflicts.ahead ? {
      code: conflicts.ahead.code,
      gapM: Number(conflicts.ahead.gapM.toFixed(1)),
      ttcS: conflicts.ahead.ttc < 99 ? Number(conflicts.ahead.ttc.toFixed(2)) : null,
      closingRateMps: Number(conflicts.ahead.closingRate.toFixed(2)),
      relLatPx: Number(conflicts.ahead.relLat.toFixed(2))
    } : null;

    const opponentBehind = conflicts.behind ? {
      code: conflicts.behind.code,
      gapM: Number(conflicts.behind.gapM.toFixed(1)),
      ttcS: conflicts.behind.ttc < 99 ? Number(conflicts.behind.ttc.toFixed(2)) : null,
      closingRateMps: Number(conflicts.behind.closingRate.toFixed(2))
    } : null;

    const sideBySide = (conflicts.sideBySide || []).map(c => ({
      code: c.code,
      overlapM: Number(c.overlapM.toFixed(1)),
      latDiffPx: Number(c.latDiffPx.toFixed(1)),
      side: c.side > 0 ? 'RIGHT' : 'LEFT'
    }));

    // Track sector evolution (24 spatial segments)
    const sectorIndex = trackCond ? trackCond.getSegmentIndex(car.d) : 0;
    const condAtCar = trackCond ? trackCond.getConditionAt(car.d, car.lat) : null;
    const sectorMoisture = condAtCar ? condAtCar.wetness : (car.currentWetness || 0);
    const sectorRubber = condAtCar ? condAtCar.rubberLevel : (car.currentRubber || 0);

    return {
      carIndex: idx,
      driverCode: car.code,
      team: car.team,
      position: car.position,
      lap: car.lap,
      d: Number(car.d.toFixed(1)),

      // 1. Vehicle Dynamics & Authoritative Physical State (MEASURED)
      speedKph: Math.round(car.v * 3.6),
      speedMps: Number(car.v.toFixed(2)),
      targetSpeedKph: Math.round(targetV * 3.6),
      targetSpeedMps: Number(targetV.toFixed(2)),
      accMps2: Number((car.acc || 0).toFixed(2)),
      longitudinalAccG: Number(((car.acc || 0) / 9.81).toFixed(2)),
      lateralAccG: Number(((car.latAcc || 0) / 9.81).toFixed(2)),
      throttlePct: Math.round((car.throttle || 0) * 100),
      brakePct: Math.round((car.brake || 0) * 100),
      steeringInput: Number((Math.max(-1.0, Math.min(1.0, ((car.targetLat || 0) - car.lat) / Math.max(1, 4.0 * k)))).toFixed(2)),
      steeringAngleDeg: Number(((car.latRate || ((car.targetLat - car.lat) * 0.25)) * 8.5).toFixed(1)),
      gear: this._estimateGear(car.v),
      pitchDeg: Number(((car.pitch || 0) * 57.3).toFixed(2)),
      rollDeg: Number(((car.roll || 0) * 57.3).toFixed(2)),
      wheelspin: Number((car.wheelspin || 0).toFixed(3)),
      isWheelspinning: !!car.isWheelspinning,
      isFrontLocked: !!car.isFrontLocked,
      frontWingDamagePct: Math.round((car.damage?.frontWing || 0) * 100),
      floorDamagePct: Math.round((car.damage?.floor || 0) * 100),
      setupPackage: car.setup ? car.setup.getSummary().aeroPackage : 'Standard Aero',

      // 2. Braking Distance & Lookahead Target (ESTIMATED)
      brakingDistanceM: Number(brakingDistanceM.toFixed(1)),
      brakingLimitDecelMps2: Number(aBrakeCap.toFixed(1)),
      lookAheadM: Number(lookAheadM.toFixed(1)),
      targetCornerCurvature: Number(targetCurvature.toFixed(4)),

      // 3. Current & Target Racing Line, Boundaries & Usable Corridor (MEASURED)
      currentLatPx: Number(car.lat.toFixed(2)),
      currentLatM: Number((car.lat / k).toFixed(2)),
      targetLatPx: Number((car.targetLat || 0).toFixed(2)),
      targetLatM: Number(((car.targetLat || 0) / k).toFixed(2)),
      referenceLatPx: Number((plan.referenceLat || 0).toFixed(2)),
      referenceLatM: Number(((plan.referenceLat || 0) / k).toFixed(2)),
      racingCorridor,
      distFromLeftM: Number((plan.distFromLeftM ?? ((car.distFromLeft || 0) / k)).toFixed(2)),
      distFromRightM: Number((plan.distFromRightM ?? ((car.distFromRight || 0) / k)).toFixed(2)),
      trackHalfWidthPx: Number(((plan.trackHalfWidth || 13.5 * k)).toFixed(2)),
      usableHalfWidthPx: Number(((plan.usableHalfWidth || 11.5 * k)).toFixed(2)),
      totalTrackWidthM: Number((plan.totalTrackWidthM ?? (((plan.trackHalfWidth || 13.5 * k) * 2) / k)).toFixed(2)),
      usableTrackWidthM: Number((plan.usableTrackWidthM ?? (((plan.usableHalfWidth || 11.5 * k) * 2) / k)).toFixed(2)),
      usableNetWidthM: Number((plan.netUsableWidthM ?? Math.max(0, (((plan.usableHalfWidth || 11.5 * k) * 2) - 3.6 * k - 3.24 * k) / k)).toFixed(2)),
      boundarySafetyMarginM: Number((plan.boundarySafetyMarginM ?? ((3.6 * k * 0.45) / k)).toFixed(2)),
      isTrackLimitViolation: Math.abs(car.lat) > (plan.usableHalfWidth || (11.5 * k)),
      isOnKerb: !!car.isOnKerb,

      // 4. AI Behavior State & Tactical Overtaking Intelligence (MEASURED / ESTIMATED)
      aiState: plan.aiState || 'FOLLOWING',
      overtakingState: plan.otDecision || 'NO_OPPORTUNITY',
      overtakingTarget: plan.targetCarCode || (opponentAhead ? opponentAhead.code : null),
      selectedPassingLine: plan.selectedPassingLine || 'NONE',
      selectionReason: plan.selectionReason || 'Tracking optimal racing line',
      rejectionReason: plan.rejectionReason || null,
      candidatePaths: plan.candidatePaths || [],
      isDefending: !!plan.defensiveIntent,
      defendingSide: car.agent?.w2wPlanner?.defendingSide || 0,
      hasDefendedThisStraight: !!car.agent?.w2wPlanner?.hasDefendedThisStraight,
      racingRoomGivenM: Number((plan.racingRoomGiven || (3.6 * k)).toFixed(1)),

      // 5. Nearby Car Predictions, TTC & Clearance (ESTIMATED)
      opponentAhead,
      opponentBehind,
      sideBySide,
      targetOpponent: opponentAhead ? {
        code: opponentAhead.code,
        gapM: opponentAhead.gapM,
        relativeSpeedKph: Math.round(opponentAhead.closingRateMps * 3.6),
        closingRateMps: opponentAhead.closingRateMps,
        ttcS: opponentAhead.ttcS
      } : null,
      timeToCollision: opponentAhead?.ttcS ?? null,
      minPredictedClearanceM: plan.minPredictedClearance ?? 99.0,
      predictedTrajectories: plan.predictedTrajectories || null,

      // 6. Collision Avoidance Safety Supervisor
      collisionAvoidanceActive: !!plan.avoidanceActive,
      collisionThreat: !!plan.collisionThreat,
      threatSeverity: plan.threatSeverity || 'NONE',
      emergencyBrakeTriggered: !!plan.emergencyBrakeTriggered,

      // 7. Tyre Condition & Dynamic Grip Evolution (MEASURED)
      compound: car.tyreModel?.compound || 'medium',
      tyreWearPct: Math.round((car.tyreWear || 0) * 100),
      tyreTempC: Math.round(car.tyreTemp || 98),
      brakeTempC: Math.round(car.brakeTemp || 340),
      effectiveGripMult: Number((car.currentGrip || 1.0).toFixed(3)),
      aquaplaning: !!car.aquaplaning,

      // 8. Aerodynamic Wake & Dirty Air State (MEASURED)
      inDirtyAir: !!car.aeroState?.inDirtyAir,
      inSlipstream: !!car.aeroState?.inSlipstream,
      dirtyAirState: car.aeroState?.inDirtyAir ? 'DIRTY_AIR' : (car.aeroState?.inSlipstream ? 'SLIPSTREAM' : 'CLEAN_AIR'),
      dirtyAirDownforceLossPct: car.aeroState ? Math.round((1.0 - (car.aeroState.downforceMult || 1.0)) * 100) : 0,
      slipstreamBenefitPct: car.aeroState ? Math.round((car.aeroState.inSlipstream ? (car.aeroState.wakeIntensity || 0) * 26 : 0)) : 0,

      // 9. Hybrid Powertrain Energy & DRS Deployment (MEASURED)
      batterySocPct: car.batteryController ? Math.round(car.batteryController.socPercent) : 85,
      batteryEnergyJoules: Math.round(car.batteryController?.energy || 0),
      batteryMaxEnergyJoules: car.batteryController?.maxEnergy || 4000000,
      batteryMode: car.batteryController?.mode || 'CHARGE',
      batteryState: car.batteryController?.state || 'CHARGING',
      batteryPowerKw: Math.round((car.batteryOutput?.effectivePowerWatts || 0) / 1000),
      batteryDeploying: !!car.batteryController?.isDeploying,
      batteryHarvesting: !!car.batteryController?.isHarvesting,
      drsEligible: !!car.drsEligible,
      drsActive: !!car.drsActive,
      drsReason: car.drsActive
        ? 'DRS Active: Flap Open (Terminal velocity boost)'
        : (car.drsEligible
          ? 'Eligible: In Zone (<1.0s gap at detection point)'
          : (this.track?.drsZones?.length ? 'Ineligible: Outside DRS Zone or gap > 1.0s' : 'No DRS zones on circuit')),

      // 9. Predictive Pit Strategy
      pitState: car.pitState || PitStates.READY,
      pitRequested: !!car.pitRequested,
      strategyAction: strat.action || 'STAY_OUT',
      strategyRecommendedCompound: strat.recommendedCompound || 'medium',
      strategyReason: strat.reason || 'Optimal stint progression',
      predictedPitLossS: Number((strat.pitLossS || SimConfig.race.pitLaneDeltaS || 22.0).toFixed(1)),
      undercutAdvantageS: strat.undercut?.netAdvantageS ? Number(strat.undercut.netAdvantageS.toFixed(2)) : null,
      rejoinTrafficRisk: strat.rejoinTraffic?.cleanAir ? 'CLEAN_AIR' : (strat.rejoinTraffic ? 'TRAFFIC' : 'CLEAR'),

      // 10. Weather & Track-Condition Spatial Evolution
      weatherLabel: weather.weatherLabel,
      rainIntensityPct: Math.round(weather.rainIntensity * 100),
      trackSector: sectorIndex + 1,
      sectorMoisturePct: Math.round(sectorMoisture * 100),
      sectorRubberPct: Math.round(sectorRubber * 100),
      avgTrackWetnessPct: Math.round((trackCond?.averageWetness || 0) * 100),
      dryingLineFormed: !!trackCond?.getDryingLineState?.()?.formed,
      trackTempC: Math.round(trackCond?.trackTemp || 32),
      ambientTempC: Math.round(weather.ambientTemp || 24),
      flag: this.flag
    };
  }

  _estimateGear(v) {
    const kmh = v * 3.6;
    if (kmh < 60)  return 1;
    if (kmh < 100) return 2;
    if (kmh < 145) return 3;
    if (kmh < 195) return 4;
    if (kmh < 240) return 5;
    if (kmh < 285) return 6;
    if (kmh < 330) return 7;
    return 8;
  }
}