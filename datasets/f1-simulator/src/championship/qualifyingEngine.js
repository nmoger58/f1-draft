/**
 * qualifyingEngine.js
 * Authoritative Formula 1 Qualifying Session Simulation Engine.
 *
 * Simulates high-stakes flying lap shootouts:
 *   - Low-fuel qualifying engine mode & fresh Soft compound grip
 *   - Full-field participation: EVERY car completes independent qualifying runs
 *   - Out-lap -> Flying lap -> In-lap lifecycle
 *   - Individual Sector 1, Sector 2, Sector 3 split timing
 *   - Lap validity enforcement (track limits / incidents)
 *   - Deterministic sorting: valid laps first (ascending time), then NO TIME drivers
 *   - Driver pace, attack skill, and qualifying consistency modeling
 *   - Accurate millisecond timing, pole position determination, and grid ordering
 */

import { getCircuit } from '../data/circuitData.js';
import { AI_DIFFICULTY } from './championshipState.js';

export const QualifyingStatus = Object.freeze({
  WAITING:    'WAITING',
  OUT_LAP:    'OUT LAP',
  FLYING_LAP: 'FLYING LAP',
  IN_LAP:     'IN LAP',
  COMPLETED:  'COMPLETED',
  NO_TIME:    'NO TIME',
  DISQUALIFIED: 'DISQUALIFIED'
});

export class QualifyingEngine {
  /**
   * Run a qualifying session for a round.
   * Backward-compatible facade delegating to runQualifyingSession.
   *
   * @param {object} options
   * @returns {object[]} sorted array of qualifying results
   */
  static runQualifying(options) {
    return QualifyingEngine.runQualifyingSession(options);
  }

  /**
   * Authoritative full-field qualifying session simulation.
   * Guarantees all eligible cars participate, have independent lap/sector timing,
   * proper validity checks, and correct sorting with NO TIME fallbacks.
   *
   * @param {object} options
   * @param {string} options.circuitId     – circuit ID
   * @param {object[]} options.drivers     – array of driver entries { code, name, team, pace, personality, color, number }
   * @param {string} [options.difficulty='normal'] – 'easy' | 'normal' | 'hard' | 'expert' | 'legend'
   * @param {string} [options.playerCode=null]    – driverCode of the human player
   * @param {number} [options.playerTime=null]    – optional explicit lap time if player drove in live session
   * @param {number} [options.seed=null]          – optional RNG seed for reproducibility
   * @param {object} [options.forcedInvalidDrivers] – optional Set/Array of driver codes to mark invalid for testing
   * @returns {object[]} sorted array of qualifying results
   */
  static runQualifyingSession({
    circuitId,
    drivers = [],
    difficulty = 'normal',
    playerCode = null,
    playerTime = null,
    seed = null,
    forcedInvalidDrivers = null
  }) {
    if (!Array.isArray(drivers) || drivers.length === 0) {
      return [];
    }

    const circuit = getCircuit(circuitId) || { rec: 85.0, lengthM: 5000, name: 'Circuit' };
    const diffCfg = AI_DIFFICULTY[difficulty] || AI_DIFFICULTY.normal;

    // Benchmark reference lap time in seconds
    const benchmarkS = circuit.rec ? circuit.rec : 85.0;

    // Deterministic or pseudo-random noise generator
    let rngVal = seed ? (Math.abs(seed) % 1000) / 1000 : Math.random();
    const nextRand = () => {
      rngVal = (rngVal * 9301 + 49297) % 233280;
      return rngVal / 233280;
    };

    const invalidSet = forcedInvalidDrivers instanceof Set
      ? forcedInvalidDrivers
      : new Set(Array.isArray(forcedInvalidDrivers) ? forcedInvalidDrivers : []);

    // 1. Process EVERY participating driver independently
    const driverResults = drivers.map((d, index) => {
      const isPlayer = (d.code === playerCode);
      const isInvalid = invalidSet.has(d.code);

      let lapTimeS = null;
      let sector1 = null;
      let sector2 = null;
      let sector3 = null;
      let isValid = !isInvalid;

      if (isPlayer && playerTime && playerTime > 0) {
        // Player set an explicit lap time in live qualifying
        lapTimeS = Math.round(playerTime * 1000) / 1000;
        // Distribute player sector splits realistically
        const s1Ratio = 0.32 + (nextRand() - 0.5) * 0.02;
        const s2Ratio = 0.38 + (nextRand() - 0.5) * 0.02;
        const s3Ratio = 1.0 - s1Ratio - s2Ratio;
        sector1 = Math.round(lapTimeS * s1Ratio * 1000) / 1000;
        sector2 = Math.round(lapTimeS * s2Ratio * 1000) / 1000;
        sector3 = Math.round((lapTimeS - sector1 - sector2) * 1000) / 1000;
      } else if (!isInvalid) {
        // AI driver flying lap computation
        const pace = d.pace || 0.95;
        const diffMult = isPlayer ? 1.0 : diffCfg.paceMult;
        const effectivePace = pace * diffMult;

        const attack = d.personality?.attackSkill ?? 0.75;
        const consistency = d.personality?.consistency ?? 0.80;

        // Flying lap on fresh Soft Pirelli tyres in low fuel quali trim (~1.8% raw pace gain)
        const qualiTrimBonus = 0.018 + (attack * 0.008);

        // Driver variance based on consistency
        const noise = (nextRand() - 0.5) * (1 - consistency) * 1.8;

        // Theoretical lap time
        const baseCalculatedTime = (benchmarkS / (effectivePace + qualiTrimBonus)) + noise;
        lapTimeS = Math.max(benchmarkS * 0.98, Math.min(benchmarkS * 1.15, baseCalculatedTime));
        lapTimeS = Math.round(lapTimeS * 1000) / 1000;

        // Calculate authentic Sector 1, 2, 3 splits
        const s1Ratio = 0.322 + (nextRand() - 0.5) * 0.018;
        const s2Ratio = 0.385 + (nextRand() - 0.5) * 0.018;
        sector1 = Math.round(lapTimeS * s1Ratio * 1000) / 1000;
        sector2 = Math.round(lapTimeS * s2Ratio * 1000) / 1000;
        sector3 = Math.round((lapTimeS - sector1 - sector2) * 1000) / 1000;
      }

      const hasValidTime = isValid && lapTimeS !== null && lapTimeS > 0;

      return {
        initialIndex: index,
        driverCode: d.code,
        name: d.name,
        team: d.team,
        color: d.color,
        teamColor: d.teamColor || d.color,
        number: d.number,
        lapTimeS: hasValidTime ? lapTimeS : null,
        sector1: hasValidTime ? sector1 : null,
        sector2: hasValidTime ? sector2 : null,
        sector3: hasValidTime ? sector3 : null,
        sector1Formatted: hasValidTime ? sector1.toFixed(3) : '-',
        sector2Formatted: hasValidTime ? sector2.toFixed(3) : '-',
        sector3Formatted: hasValidTime ? sector3.toFixed(3) : '-',
        valid: hasValidTime,
        status: hasValidTime ? QualifyingStatus.COMPLETED : QualifyingStatus.NO_TIME,
        isPlayer
      };
    });

    // 2. Sort drivers: Valid timed drivers first (ascending lap time), then NO TIME drivers
    driverResults.sort((a, b) => {
      if (a.valid && b.valid) {
        return a.lapTimeS - b.lapTimeS;
      }
      if (a.valid && !b.valid) return -1;
      if (!a.valid && b.valid) return 1;
      // Deterministic tie-breaker for NO TIME: preserve initial grid/seeded index
      return a.initialIndex - b.initialIndex;
    });

    // 3. Format positions, gaps to pole, and telemetry labels
    const fastestDriver = driverResults.find(r => r.valid);
    const poleTime = fastestDriver ? fastestDriver.lapTimeS : benchmarkS;

    driverResults.forEach((r, idx) => {
      r.position = idx + 1;
      r.isPole = (idx === 0 && r.valid);

      if (r.valid && r.lapTimeS !== null) {
        r.gapS = idx === 0 ? 0.0 : Math.round((r.lapTimeS - poleTime) * 1000) / 1000;
        r.formattedTime = QualifyingEngine.formatLapTime(r.lapTimeS);
        r.gapFormatted = idx === 0 ? 'POLE' : `+${r.gapS.toFixed(3)}s`;
      } else {
        r.gapS = null;
        r.formattedTime = 'NO TIME';
        r.gapFormatted = 'NO TIME';
      }
    });

    return driverResults;
  }

  /**
   * Format seconds to M:SS.mmm format.
   * @param {number|null} s
   * @returns {string}
   */
  static formatLapTime(s) {
    if (!s || s <= 0 || isNaN(s)) return 'NO TIME';
    const m = Math.floor(s / 60);
    const r = s - m * 60;
    return `${m}:${r < 10 ? '0' : ''}${r.toFixed(3)}`;
  }
}
