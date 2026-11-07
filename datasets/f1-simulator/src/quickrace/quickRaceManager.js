/**
 * quickRaceManager.js
 * Quick Race Session Coordinator & Results Computer.
 *
 * Coordinates:
 *   - Active Quick Race configuration
 *   - Starting grid generation (Qualifying, Random, Performance, Custom)
 *   - Syncing player choices with DraftEngine
 *   - Formatting RaceEngine launch parameters
 *   - Generating official post-race classification and time deltas
 */

import {
  DEFAULT_QUICK_RACE_CONFIG,
  calculateLapsFromDistance,
  validateQuickRaceConfig,
  buildStartingGrid,
  saveLastQuickRaceConfig,
  loadLastQuickRaceConfig
} from './quickRaceConfig.js';
import { getCircuit } from '../data/circuitData.js';
import { getDriver } from '../data/driverData.js';
import { getManager } from '../data/managerData.js';
import { getCar } from '../data/carData.js';
import { getSharedDraftEngine } from '../strategy/draftEngine.js';
import { QualifyingEngine } from '../championship/qualifyingEngine.js';
import { DRIVERS } from '../data/driverData.js';

export class QuickRaceManager {
  constructor(initialConfig = null) {
    this.config = initialConfig ? { ...DEFAULT_QUICK_RACE_CONFIG, ...initialConfig } : loadLastQuickRaceConfig();
    this.activeGridData = null;
    this.lastClassification = null;
  }

  /**
   * Set and validate the active configuration.
   *
   * @param {object} newConfig
   * @returns {{ valid: boolean, errors: string[] }}
   */
  setConfig(newConfig) {
    const merged = { ...this.config, ...newConfig };
    const validation = validateQuickRaceConfig(merged);
    if (validation.valid) {
      this.config = merged;
      saveLastQuickRaceConfig(this.config);
      this._syncWithDraftEngine();
    }
    return validation;
  }

  /**
   * Update partial config fields.
   *
   * @param {object} partial
   */
  updateConfig(partial) {
    return this.setConfig({ ...this.config, ...partial });
  }

  /**
   * Returns authoritative configuration.
   */
  getConfig() {
    return { ...this.config };
  }

  /**
   * Compute effective total laps based on mode (laps vs distance).
   *
   * @returns {{ laps: number, explanation: string, actualDistanceKm: number }}
   */
  getEffectiveLaps() {
    const circuit = getCircuit(this.config.circuitId);
    if (this.config.lapMode === 'distance') {
      const calc = calculateLapsFromDistance(circuit.lengthM, this.config.targetDistanceKm, circuit.name);
      return {
        laps: calc.laps,
        explanation: calc.explanation,
        actualDistanceKm: calc.actualDistanceKm
      };
    }

    const laps = Math.max(1, this.config.totalLaps || 5);
    const actualDistanceKm = Math.round(((laps * circuit.lengthM) / 1000) * 100) / 100;
    return {
      laps,
      explanation: `${circuit.name}: ${laps} laps (${actualDistanceKm.toFixed(2)} kilometres total distance).`,
      actualDistanceKm
    };
  }

  /**
   * Run authoritative full-field qualifying session for the active configuration.
   * Every eligible car participates, completes out-lap -> flying lap, and records S1/S2/S3.
   *
   * @param {number} [playerLapTime=null] - optional live lap time set by player
   * @returns {object[]} sorted array of qualifying results
   */
  runQualifyingSession(playerLapTime = null) {
    const fSize = Math.max(2, Math.min(this.config.fieldSize || 20, 20));
    const playerDriver = getDriver(this.config.playerDriverCode) || null;
    const poolDrivers = [playerDriver, ...DRIVERS.filter(d => d.code !== playerDriver?.code).slice(0, fSize - 1)];

    const results = QualifyingEngine.runQualifyingSession({
      circuitId: this.config.circuitId || 'silverstone',
      drivers: poolDrivers,
      difficulty: this.config.aiDifficulty || 'normal',
      playerCode: playerDriver?.code,
      playerTime: playerLapTime,
      seed: this.config.randomSeed ?? (Date.now() % 100000)
    });

    this.config.qualifyingResults = results;
    this.prepareStartingGrid();
    return results;
  }

  /**
   * Resets session-specific qualifying results without altering base settings.
   */
  resetQualifyingState() {
    this.config.qualifyingResults = null;
    this.activeGridData = null;
  }

  /**
   * Generate starting grid for the current configuration.
   *
   * @returns {{
   *   gridDrivers: object[],
   *   playerCarIdx: number,
   *   qualifyingResults?: object[]
   * }}
   */
  prepareStartingGrid() {
    this.activeGridData = buildStartingGrid(this.config);
    return this.activeGridData;
  }

  /**
   * Get options object ready to pass to RaceEngine.build()
   */
  getRaceEngineOptions() {
    if (!this.activeGridData) {
      this.prepareStartingGrid();
    }

    const { laps } = this.getEffectiveLaps();
    const playerCarModel = getCar(this.config.playerCarId);
    const playerManager = getManager(this.config.playerManagerId);

    // Sync with DraftEngine
    this._syncWithDraftEngine();

    return {
      totalLaps: laps,
      customGridDrivers: this.activeGridData.gridDrivers,
      playerCarIdx: this.activeGridData.playerCarIdx,
      playerCarModel,
      playerManager,
      startingCompound: this.config.startingCompound || 'medium',
      aiDifficulty: this.config.aiDifficulty || 'normal',
      weatherPreset: this.config.weatherPreset || 'DRY',
      safetyCarEnabled: this.config.safetyCarEnabled ?? true,
      vscEnabled: this.config.vscEnabled ?? true,
      damageEnabled: this.config.damageEnabled ?? true,
      penaltiesEnabled: this.config.penaltiesEnabled ?? true,
      batteryEnabled: this.config.batteryEnabled ?? true,
      drsEnabled: this.config.drsEnabled ?? true,
      playerCarSetup: this.config.carSetup || null,
      circuitId: this.config.circuitId
    };
  }

  /**
   * Calculates official post-race classification from the simulation engine.
   *
   * @param {object} engine - RaceEngine instance
   * @returns {Array<object>}
   */
  calculateFinalClassification(engine) {
    if (!engine || !engine.cars) return [];

    const standings = engine.standings || [];
    const totalLaps = engine.totalLaps || 1;

    // Find overall fastest lap across all cars
    let fastestLapTimeS = Infinity;
    let fastestLapDriverCode = null;
    engine.cars.forEach(car => {
      if (car.bestLap && car.bestLap > 0 && car.bestLap < fastestLapTimeS) {
        fastestLapTimeS = car.bestLap;
        fastestLapDriverCode = car.code;
      }
    });

    // Winner reference time
    const winnerCar = standings[0];
    const winnerTimeS = (winnerCar && winnerCar.finishTime) ? winnerCar.finishTime : (engine.simTime || 0);

    const classification = standings.map((car, idx) => {
      const position = car.finishPosition || (idx + 1);
      const isWinner = (position === 1);
      const isPlayer = !!car.isPlayer;

      const completedLaps = car.finishLap || Math.min(totalLaps, car.lap || 0);
      const lapsDown = totalLaps - completedLaps;

      let gapText = '';
      if (isWinner) {
        gapText = formatLapTime(winnerTimeS);
      } else if (lapsDown > 0 && !car.finished) {
        gapText = `+${lapsDown} ${lapsDown === 1 ? 'Lap' : 'Laps'}`;
      } else if (car.finishTime && winnerCar?.finishTime) {
        const delta = Math.max(0.001, car.finishTime - winnerCar.finishTime);
        gapText = `+${delta.toFixed(3)}s`;
      } else if (car.gapToLeader && car.gapToLeader > 0) {
        gapText = `+${car.gapToLeader.toFixed(3)}s`;
      } else {
        gapText = `+${(idx * 1.25).toFixed(3)}s`;
      }

      const bestLapS = car.bestLap && car.bestLap > 0 ? car.bestLap : null;
      const hasFastestLap = (car.code === fastestLapDriverCode && isFinite(fastestLapTimeS));

      // Penalties summary
      const penalties = Array.isArray(car.penalties) ? car.penalties : [];
      let penaltyText = '';
      if (penalties.length > 0) {
        const totalSecs = penalties.reduce((acc, p) => acc + (p.seconds || 0), 0);
        penaltyText = totalSecs > 0 ? `+${totalSecs}s Penalty` : 'Warning';
      }

      return {
        position,
        driverCode: car.code,
        name: car.name || car.driver?.name || car.code,
        number: car.number || car.driver?.number || '',
        team: car.team || car.driver?.team || 'Formula 1',
        teamColor: car.teamColor || car.color || '#e10600',
        carModelName: car.carModel?.name || car.team || 'Chassis',
        completedLaps,
        totalLaps,
        totalTimeS: car.finishTime || engine.simTime,
        gapText,
        bestLapS,
        bestLapFormatted: bestLapS ? formatLapTime(bestLapS) : '–',
        hasFastestLap,
        penalties,
        penaltyText,
        isPlayer,
        status: car.retiredLap ? 'DNF' : (car.finished || lapsDown === 0 ? (penaltyText ? `FINISHED (${penaltyText})` : 'FINISHED') : `+${lapsDown} ${lapsDown === 1 ? 'Lap' : 'Laps'}`)
      };
    });

    this.lastClassification = classification;
    return classification;
  }

  /**
   * Synchronize the selected driver, manager, and car with DraftEngine.
   * @private
   */
  _syncWithDraftEngine() {
    try {
      const draft = getSharedDraftEngine({ circuitId: this.config.circuitId });
      if (draft) {
        if (this.config.playerDriverCode) draft.selectEntity('driver', this.config.playerDriverCode);
        if (this.config.playerManagerId) draft.selectEntity('manager', this.config.playerManagerId);
        if (this.config.playerCarId) draft.selectEntity('car', this.config.playerCarId);
      }
    } catch (_) {}
  }
}

/**
 * Format seconds into mm:ss.sss
 *
 * @param {number} sec
 * @returns {string}
 */
export function formatLapTime(sec) {
  if (!sec || !isFinite(sec) || sec <= 0) return '–';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(3)}`;
}
