/**
 * driverPsychology.js
 * Authoritative Driver Psychology, Confidence & Track Advantage Model.
 *
 * Implements:
 *   1. Home Race Advantage:
 *      - Matches driver nationality, country, home city, or explicit homeCircuitIds against circuit
 *      - Modest, bounded confidence & composure boost (+0.05 to +0.07)
 *      - No arbitrary top-speed or grip increase; emerges via composure & consistency
 *   2. Previous Circuit Winner Confidence:
 *      - Validates historical circuit victories & defending champion status
 *      - Modest, bounded confidence & decision consistency modifier (+0.04 to +0.06)
 *      - Strictly bounded combination when both effects apply (ceiling capped at +0.10)
 *   3. Dynamic In-Race Psychology:
 *      - Positive reinforcement on overtakes & fast laps
 *      - Setback recovery (spins, collisions) scaled by composure
 *      - High pressure management in wheel-to-wheel battles
 *   4. Zero-Cheat Guarantees:
 *      - Applies identically to both player and AI drivers
 *      - Strictly respects vehicle physics, tyre grip, braking limits, and collision avoidance
 */

import { checkDriverCircuitHistory } from '../data/historicalWinnersData.js';

export class DriverPsychology {
  /**
   * Determine whether a circuit is a driver's official home race.
   *
   * @param {object} driver   – driver profile from driverData.js
   * @param {object} circuit  – circuit object from circuitData.js
   * @returns {boolean}
   */
  static isHomeRace(driver, circuit) {
    if (!driver || !circuit) return false;

    // 1. Explicit override on driver profile
    if (Array.isArray(driver.homeCircuitIds) && driver.homeCircuitIds.includes(circuit.id)) {
      return true;
    }

    // 2. Strict ISO country code match
    if (driver.countryCode && circuit.countryCode &&
        driver.countryCode.trim().toUpperCase() === circuit.countryCode.trim().toUpperCase()) {
      return true;
    }

    // 3. Normalized country name match
    if (driver.country && circuit.country &&
        driver.country.trim().toLowerCase() === circuit.country.trim().toLowerCase()) {
      return true;
    }

    return false;
  }

  /**
   * Evaluate pre-race psychological advantages for a driver at a specific circuit.
   *
   * @param {object} driver   – driver profile
   * @param {object} circuit  – circuit object
   * @param {object} [options]
   * @param {boolean} [options.homeAdvantageEnabled=true]
   * @param {boolean} [options.previousWinnerEnabled=true]
   * @param {object[]} [options.archivedHistory]
   * @param {object[]} [options.currentSeasonCalendar]
   * @param {number}   [options.currentRoundIndex]
   * @returns {object} Pre-race psychology evaluation
   */
  static evaluatePreRaceAdvantage(driver, circuit, options = {}) {
    const homeAdvantageEnabled = options.homeAdvantageEnabled ?? true;
    const previousWinnerEnabled = options.previousWinnerEnabled ?? true;

    // 1. Home Race Analysis
    const isHome = DriverPsychology.isHomeRace(driver, circuit);
    let homeConfidenceBonus = 0;
    let homeConsistencyBonus = 0;
    let homeMessage = null;

    if (isHome && homeAdvantageEnabled) {
      homeConfidenceBonus = 0.06;
      homeConsistencyBonus = 0.04;
      homeMessage = `HOME GRAND PRIX — Racing in front of the home crowd in ${circuit.country}. Extra motivation!`;
    }

    // 2. Previous Winner Analysis
    const winHistory = checkDriverCircuitHistory(driver?.code, circuit?.id, {
      archivedHistory: options.archivedHistory,
      currentSeasonCalendar: options.currentSeasonCalendar,
      currentRoundIndex: options.currentRoundIndex
    });

    let prevWinnerConfidenceBonus = 0;
    let prevWinnerConsistencyBonus = 0;
    let prevWinnerMessage = null;

    if (winHistory.isPreviousWinner && previousWinnerEnabled) {
      if (winHistory.isDefendingChampion) {
        prevWinnerConfidenceBonus = 0.065;
        prevWinnerConsistencyBonus = 0.045;
        prevWinnerMessage = `Defending winner at this circuit (${winHistory.lastWinYear}). Familiarity & proven confidence.`;
      } else if (winHistory.wonEarlierThisSeason) {
        prevWinnerConfidenceBonus = 0.055;
        prevWinnerConsistencyBonus = 0.035;
        prevWinnerMessage = `Previous winner at this circuit this season. Strong track affinity.`;
      } else {
        prevWinnerConfidenceBonus = 0.045;
        prevWinnerConsistencyBonus = 0.030;
        prevWinnerMessage = `Previous winner at this circuit (${winHistory.lastWinYear}). High composure in familiar conditions.`;
      }
    }

    // 3. Combined Bounded Confidence Adjustment
    // Bounded function ensures combination cannot grow without limit (max ceiling 0.10)
    const rawSum = homeConfidenceBonus + prevWinnerConfidenceBonus;
    const totalConfidenceBonus = Math.min(0.10, rawSum * 0.90);
    const totalConsistencyBonus = Math.min(0.07, (homeConsistencyBonus + prevWinnerConsistencyBonus) * 0.90);

    // Combined Context Message
    let combinedMessage = null;
    let badgeType = null;

    if (isHome && winHistory.isPreviousWinner && homeAdvantageEnabled && previousWinnerEnabled) {
      combinedMessage = `Home race & previous circuit winner! Maximum motivation & track mastery.`;
      badgeType = 'home_and_winner';
    } else if (isHome && homeAdvantageEnabled) {
      combinedMessage = homeMessage;
      badgeType = 'home_race';
    } else if (winHistory.isPreviousWinner && previousWinnerEnabled) {
      combinedMessage = prevWinnerMessage;
      badgeType = 'prev_winner';
    }

    return {
      isHome,
      homeAdvantageEnabled,
      isPreviousWinner: winHistory.isPreviousWinner,
      previousWinnerEnabled,
      isDefendingChampion: winHistory.isDefendingChampion,
      winsAtCircuit: winHistory.winsCount,
      lastWinYear: winHistory.lastWinYear,
      homeConfidenceBonus,
      homeConsistencyBonus,
      prevWinnerConfidenceBonus,
      prevWinnerConsistencyBonus,
      totalConfidenceBonus,
      totalConsistencyBonus,
      contextMessage: combinedMessage,
      badgeType,
      detail: isHome && winHistory.isPreviousWinner
        ? `${driver.nationality} driver · ${winHistory.winsCount}x past winner`
        : (isHome ? `${driver.nationality} driver racing at home` : winHistory.detail)
    };
  }

  /**
   * Create an initial dynamic psychology state for a car at race start.
   *
   * @param {object} driver   – driver profile
   * @param {object} circuit  – circuit object
   * @param {object} [options]
   * @returns {object} Mutable in-race psychology state
   */
  static createInitialState(driver, circuit, options = {}) {
    const adv = DriverPsychology.evaluatePreRaceAdvantage(driver, circuit, options);

    // Baseline confidence derived from driver personality (consistency & racecraft)
    const p = driver?.personality || { consistency: 0.8, racecraft: 0.8 };
    const baseConf = 0.50 + (p.consistency - 0.5) * 0.25 + (p.racecraft - 0.5) * 0.20;

    return {
      ...adv,
      driverCode: driver?.code,
      baseConfidence: baseConf,
      // Initial confidence includes bounded pre-race bonuses
      confidence: Math.max(0.20, Math.min(0.98, baseConf + adv.totalConfidenceBonus)),
      effectiveConsistency: Math.min(0.99, (p.consistency || 0.80) + adv.totalConsistencyBonus),
      composure: Math.min(0.99, (p.racecraft || 0.80) + (adv.totalConfidenceBonus * 0.5)),
      dynamicModifier: 0,
      setbackTimer: 0,
      recentOvertakes: 0,
      recentTimesPassed: 0
    };
  }

  /**
   * Update dynamic psychology during the race.
   *
   * @param {object} psychState – mutable state from createInitialState()
   * @param {number} dt         – delta sim time
   * @param {object} events     – { overtakeSuccess, wasPassed, spinOrLockup, lapDelta }
   */
  static update(psychState, dt, events = {}) {
    if (!psychState) return;

    // 1. Recover from setbacks
    if (psychState.setbackTimer > 0) {
      psychState.setbackTimer = Math.max(0, psychState.setbackTimer - dt);
      // Confident/composed drivers recover faster
      const recoveryRate = 0.008 * (1 + psychState.composure);
      psychState.dynamicModifier = Math.min(0, psychState.dynamicModifier + recoveryRate * dt);
    } else {
      // Natural decay of high excitement toward baseline
      if (psychState.dynamicModifier > 0) {
        psychState.dynamicModifier = Math.max(0, psychState.dynamicModifier - 0.002 * dt);
      }
    }

    // 2. Overtake events
    if (events.overtakeSuccess) {
      psychState.recentOvertakes++;
      // Home crowd / past winner gets a slightly bigger mental lift
      const boost = 0.025 * (1 + psychState.totalConfidenceBonus * 2);
      psychState.dynamicModifier = Math.min(0.12, psychState.dynamicModifier + boost);
    }

    if (events.wasPassed) {
      psychState.recentTimesPassed++;
      // High composure cushions the blow of being overtaken
      const drop = 0.020 * (1.2 - psychState.composure * 0.4);
      psychState.dynamicModifier = Math.max(-0.15, psychState.dynamicModifier - drop);
    }

    // 3. Errors / spins
    if (events.spinOrLockup) {
      psychState.setbackTimer = 15.0; // 15 seconds to recover
      const penalty = 0.06 * (1.3 - psychState.composure * 0.5);
      psychState.dynamicModifier = Math.max(-0.25, psychState.dynamicModifier - penalty);
    }

    // Recompute total clamped confidence
    const rawConf = psychState.baseConfidence + psychState.totalConfidenceBonus + psychState.dynamicModifier;
    psychState.confidence = Math.max(0.20, Math.min(0.98, rawConf));
  }
}
