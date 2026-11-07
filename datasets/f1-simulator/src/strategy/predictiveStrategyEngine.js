/**
 * predictiveStrategyEngine.js
 * Authoritative Predictive Race Strategy Engine, Tyre Degradation Model,
 * Traffic-Aware Pit Rejoining Projector, Undercut/Overcut Predictor & SC Evaluator.
 *
 * Implements:
 *   - Multi-compound pace forecasting over remaining race distance
 *   - Total race time estimation comparing 0-stop, 1-stop, and 2-stop strategies
 *   - Dynamic weather & crossover window prediction (Slick <-> Inter <-> Wet)
 *   - Real circuit-based pit lane time loss calculation (Green Flag vs SC/VSC)
 *   - Traffic-aware pit exit projection (rejoining into clear air vs DRS trains)
 *   - Mathematical undercut and overcut delta modeling
 *   - Strategy personalities: Gambler, Balanced, Conservative, Weather-Responsive
 *   - Decision stability & cooldowns to prevent strategy oscillation
 */

export const PitAction = {
  STAY_OUT:           'STAY_OUT',
  PIT_THIS_LAP:       'PIT_THIS_LAP',
  PIT_NEXT_LAP:       'PIT_NEXT_LAP',
  DELAY_FOR_TRAFFIC:  'DELAY_FOR_TRAFFIC'
};

export const StrategyPersonality = {
  GAMBLER:            'GAMBLER',
  BALANCED:           'BALANCED',
  CONSERVATIVE:       'CONSERVATIVE',
  WEATHER_RESPONSIVE: 'WEATHER_RESPONSIVE'
};

export class PredictiveStrategyEngine {
  constructor() {
    // Decision cooldown tracker by car code to prevent frame-by-frame oscillation
    this.carDecisions = new Map();
  }

  /**
   * Evaluates comprehensive race strategy for a vehicle.
   *
   * @param {object} car          – Subject vehicle state
   * @param {number} totalLaps    – Total race laps
   * @param {object} track        – Track geometry
   * @param {object} trackCond    – Spatial track condition model
   * @param {object} weatherRadar – Weather forecast
   * @param {object[]} allCars    – All vehicles on track
   * @param {string} flag         – Race control flag state
   * @param {number} simTime      – Elapsed simulation time in seconds
   * @returns {object} strategic recommendation & prediction telemetry
   */
  evaluateStrategy(car, totalLaps, track, trackCond, weatherRadar, allCars, flag, simTime) {
    const lapsLeft = Math.max(0, totalLaps - (car.lap || 0));
    const currentTyre = car.tyreModel;
    const currentCompound = currentTyre ? currentTyre.compound : 'medium';
    const currentWear = currentTyre ? (currentTyre.wear || 0) : 0;
    const isPunctured = currentTyre ? !!currentTyre.punctured : false;
    const avgWetness = trackCond?.averageWetness ?? weatherRadar?.trackWetness ?? 0.0;
    const futureRain = weatherRadar?.rainIntensity ?? 0;

    // Retrieve or establish decision state for this car
    let carDec = this.carDecisions.get(car.code);
    if (!carDec) {
      carDec = {
        lastEvalLap: car.lap || 0,
        currentAction: PitAction.STAY_OUT,
        targetCompound: currentCompound,
        reason: 'Initial strategy active',
        lockUntilLap: 0,
        personality: this._derivePersonality(car)
      };
      this.carDecisions.set(car.code, carDec);
    }

    // 1. Calculate Real Pit-Lane Time Loss based on Circuit Geometry
    const pitLossS = this.calculateRealPitLoss(track, flag, car.manager);

    // Final lap: stay out unless tyre is punctured
    if (lapsLeft <= 1 && !isPunctured) {
      return {
        action: PitAction.STAY_OUT,
        recommendedCompound: currentCompound,
        reason: 'Final lap of the Grand Prix — stay out and defend position!',
        pitLossS,
        undercut: null,
        overcut: null,
        rejoinTraffic: null,
        twoDrySatisfied: true
      };
    }

    // 2. Determine Optimal Target Tyre Compound (Weather & Degradation)
    const targetCompound = this.predictOptimalCompound(currentCompound, avgWetness, futureRain, carDec.personality);

    // 3. Emergency Pit Checks (Puncture, Wrong Tyre in Severe Weather)
    const isDryTyre = (currentCompound === 'soft' || currentCompound === 'medium' || currentCompound === 'hard');
    const isWetTyre = (currentCompound === 'intermediate' || currentCompound === 'wet');

    if (isPunctured) {
      return this._commitDecision(carDec, car.lap, PitAction.PIT_THIS_LAP, targetCompound,
        `CRITICAL PUNCTURE! Structural failure on ${currentCompound.toUpperCase()} tyre. Box immediately!`, pitLossS);
    }

    if (isDryTyre && avgWetness >= 0.26) {
      return this._commitDecision(carDec, car.lap, PitAction.PIT_THIS_LAP, targetCompound,
        `Track wet (${Math.round(avgWetness * 100)}%). Slicks lack grip — BOX for ${targetCompound.toUpperCase()}!`, pitLossS);
    }

    if (currentCompound === 'intermediate' && avgWetness >= 0.60) {
      return this._commitDecision(carDec, car.lap, PitAction.PIT_THIS_LAP, 'wet',
        `Torrential rain (${Math.round(avgWetness * 100)}% wetness). Inters aquaplaning — BOX for WETS!`, pitLossS);
    }

    if (currentCompound === 'wet' && avgWetness < 0.40 && futureRain < 0.25) {
      return this._commitDecision(carDec, car.lap, PitAction.PIT_THIS_LAP, 'intermediate',
        `Track drying (${Math.round(avgWetness * 100)}% wetness). Wet tyres overheating — BOX for INTERS!`, pitLossS);
    }

    if (isWetTyre && avgWetness < 0.10 && futureRain < 0.05) {
      return this._commitDecision(carDec, car.lap, PitAction.PIT_THIS_LAP, targetCompound,
        `Track dry (${Math.round(avgWetness * 100)}%). Wet tyres overheating — BOX for slicks!`, pitLossS);
    }

    if (currentWear >= 0.85 && lapsLeft > 1) {
      return this._commitDecision(carDec, car.lap, PitAction.PIT_THIS_LAP, targetCompound,
        `Tyres severely degraded (${Math.round(currentWear * 100)}% wear). Box to prevent massive lap-time bleed!`, pitLossS);
    }

    // 4. Safety Car / VSC Opportunistic "Cheap Pit Window"
    const isSafetyCar = (flag === 'safetycar' || flag === 'safety_car' || flag === 'vsc');
    if (isSafetyCar && lapsLeft >= 3) {
      if (currentWear > 0.32 || (currentTyre && currentTyre.ageLaps >= 5)) {
        return this._commitDecision(carDec, car.lap, PitAction.PIT_THIS_LAP, targetCompound,
          `${flag.toUpperCase()} active: cheap pit window (-10.5s loss delta)! Box for fresh ${targetCompound.toUpperCase()}.`, pitLossS);
      }
    }

    // 5. Traffic-Aware Pit Rejoining Projection
    const rejoinAnalysis = this.predictRejoinTraffic(car, track, pitLossS, allCars);

    // 6. Undercut & Overcut Evaluation
    const rivalAhead = this._findRivalAhead(car, allCars, track.circuit.lengthM);
    const undercutAnalysis = this.analyzeUndercut(car, rivalAhead, pitLossS, lapsLeft);
    const overcutAnalysis = this.analyzeOvercut(car, rivalAhead, lapsLeft, currentWear, rejoinAnalysis);

    // 7. Mandatory Two-Compound Rule Check (FIA Sporting Regulations for dry races)
    const compoundsUsedCount = car.compoundsUsed ? car.compoundsUsed.size : 1;
    const isDryRace = avgWetness < 0.15 && futureRain < 0.10;
    const needsSecondCompound = totalLaps >= 8 && isDryRace && (compoundsUsedCount < 2) && (lapsLeft <= 2) && (car.lap >= 2);

    if (needsSecondCompound && lapsLeft > 1) {
      const alternateCompound = (currentCompound === 'soft') ? 'medium' : ((currentCompound === 'medium') ? 'hard' : 'soft');
      return this._commitDecision(carDec, car.lap, PitAction.PIT_THIS_LAP, alternateCompound,
        `MANDATORY STOP: FIA Two-Compound Rule requires fitting alternate ${alternateCompound.toUpperCase()} before finish!`, pitLossS);
    }

    // 8. Total Race Time Simulation Comparison (Stay Out vs Pit Now)
    const baseLapS = (track.circuit.rec || 85.0);
    const timeStayOut = this.estimateRemainingRaceTime(car, currentCompound, false, lapsLeft, pitLossS, avgWetness, baseLapS);
    const timePitNow = this.estimateRemainingRaceTime(car, targetCompound, true, lapsLeft, pitLossS, avgWetness, baseLapS);
    const netTimeSavingS = Math.round((timeStayOut - timePitNow) * 10) / 10;

    // 9. Degradation & Mathematical Race Time Pit Evaluation
    let wearThreshold = 0.68;
    if (carDec.personality === StrategyPersonality.GAMBLER) wearThreshold = 0.60;
    else if (carDec.personality === StrategyPersonality.CONSERVATIVE) wearThreshold = 0.74;

    const isFasterToPit = (netTimeSavingS > 2.5) && (lapsLeft >= 3);

    if ((currentWear >= wearThreshold || isFasterToPit) && lapsLeft > 2) {
      // Check if rejoining directly into heavy traffic
      if (rejoinAnalysis.hasHeavyTraffic && carDec.personality !== StrategyPersonality.GAMBLER && currentWear < 0.80 && !isFasterToPit) {
        return {
          action: PitAction.DELAY_FOR_TRAFFIC,
          recommendedCompound: targetCompound,
          reason: `Traffic warning: pitting now rejoins into a DRS train behind ${rejoinAnalysis.blockingCarCode}. Extend 1 lap!`,
          pitLossS,
          netTimeSavingS,
          undercut: undercutAnalysis,
          overcut: overcutAnalysis,
          rejoinTraffic: rejoinAnalysis,
          twoDrySatisfied: compoundsUsedCount >= 2
        };
      }

      const savingReason = isFasterToPit ? ` (Estimated race time saving: ~${netTimeSavingS}s)` : '';
      return this._commitDecision(carDec, car.lap, PitAction.PIT_THIS_LAP, targetCompound,
        `Tyre wear at ${Math.round(currentWear * 100)}%. Box for fresh ${targetCompound.toUpperCase()}!${savingReason}`, pitLossS, netTimeSavingS);
    }

    // 10. Strategic Undercut Trigger
    if (undercutAnalysis && undercutAnalysis.isViable && carDec.personality === StrategyPersonality.GAMBLER) {
      if (!rejoinAnalysis.hasHeavyTraffic) {
        return this._commitDecision(carDec, car.lap, PitAction.PIT_THIS_LAP, targetCompound,
          `Undercut window open: pitting now gains ~${undercutAnalysis.netAdvantageS}s on ${undercutAnalysis.rivalCode}!`, pitLossS, undercutAnalysis.netAdvantageS);
      }
    }

    // Default: Stay Out
    return {
      action: PitAction.STAY_OUT,
      recommendedCompound: targetCompound,
      reason: 'Tyres performing in optimal operating window. Maintain target lap delta.',
      pitLossS,
      netTimeSavingS,
      undercut: undercutAnalysis,
      overcut: overcutAnalysis,
      rejoinTraffic: rejoinAnalysis,
      twoDrySatisfied: compoundsUsedCount >= 2
    };
  }

  // ── Helpers & Mathematical Models ─────────────────────────────────────────

  /**
   * Estimate total remaining race time (seconds) for a strategy scenario (Phase 6).
   */
  estimateRemainingRaceTime(car, nextCompound, pitThisLap, lapsRemaining, pitLossS, avgWetness, baseLapTimeS) {
    if (lapsRemaining <= 0) return 0;

    let totalTime = 0;
    const currentWear = car.tyreModel?.wear || 0;

    if (pitThisLap) {
      // Pit loss incurred on this lap
      totalTime += pitLossS;
      // Out-lap warm-up delta (+1.2s)
      totalTime += 1.2;
      // Stint on fresh compound
      for (let l = 1; l <= lapsRemaining; l++) {
        const estWear = (l / Math.max(12, lapsRemaining)) * 0.45;
        const degPenalty = estWear > 0.65 ? (estWear - 0.65) * 6.5 : estWear * 1.8;
        const compoundGripDelta = (nextCompound === 'soft' ? -0.7 : (nextCompound === 'hard' ? 0.8 : 0.0));
        totalTime += (baseLapTimeS + degPenalty + compoundGripDelta);
      }
    } else {
      // Staying out on current tyres
      for (let l = 1; l <= lapsRemaining; l++) {
        const projectedWear = Math.min(1.0, currentWear + (l * 0.045));
        const degPenalty = projectedWear > 0.65
          ? (0.65 * 1.8 + (projectedWear - 0.65) * 8.5)
          : projectedWear * 1.8;
        totalTime += (baseLapTimeS + degPenalty);
      }
    }

    return totalTime;
  }

  /**
   * Calculates realistic pit-lane time loss from track geometry and speed limits.
   */
  calculateRealPitLoss(track, flag, manager = null) {
    const circuit = track.circuit;
    const pitLane = track.pitLane || {
      entryD: circuit.lengthM - 140,
      exitD: 110,
      speedLimit: circuit.id === 'monaco' ? 16.7 : 22.2
    };

    const pitDistM = (circuit.lengthM - pitLane.entryD) + pitLane.exitD; // ~250m
    const pitSpeedMps = pitLane.speedLimit || 22.2;
    const transitTimeS = pitDistM / pitSpeedMps; // ~11.25s

    // Base stationary service time (2.4s) modulated by team principal perk
    const mgrDelta = manager?.modifiers?.pitLossDelta ?? 0;
    const serviceTimeS = Math.max(1.8, 2.4 + mgrDelta);

    // On-track travel time for the same distance at racing speeds (~65 m/s)
    const onTrackSpeedMps = (circuit.rec && circuit.lengthM) ? (circuit.lengthM / circuit.rec) : 62.0;
    const onTrackTimeS = pitDistM / onTrackSpeedMps; // ~4.0s

    // Deceleration onto pit entry and acceleration back up to racing speed out of pit exit (~7.5s)
    const transitionLossS = 7.5;

    // Net green-flag pit loss
    const greenPitLoss = (transitTimeS + serviceTimeS + transitionLossS) - onTrackTimeS;

    // Under Safety Car or VSC, cars on track are restricted, slashing pit loss delta
    if (flag === 'safetycar') {
      return Math.round((greenPitLoss * 0.52) * 10) / 10; // ~11.5s
    } else if (flag === 'vsc') {
      return Math.round((greenPitLoss * 0.60) * 10) / 10; // ~13.2s
    }

    return Math.round(greenPitLoss * 10) / 10; // ~21.5s to 23.0s
  }

  /**
   * Determines optimal tyre compound based on current wetness, radar forecast, and personality.
   */
  predictOptimalCompound(currentCompound, trackWetness, futureRain, personality) {
    let crossoverOffset = 0.0;
    if (personality === StrategyPersonality.GAMBLER) crossoverOffset = -0.04; // Pits earlier
    else if (personality === StrategyPersonality.CONSERVATIVE) crossoverOffset = 0.05; // Waits for confirmed rain

    const slickToInter = Math.max(0.12, 0.18 + crossoverOffset);
    const interToWet   = Math.max(0.50, 0.60 + crossoverOffset);

    if (trackWetness > interToWet || (trackWetness > 0.45 && futureRain > 0.65)) {
      return 'wet';
    } else if (trackWetness > slickToInter || (trackWetness > 0.10 && futureRain > 0.30)) {
      return 'intermediate';
    } else {
      // Dry track selection: if currently on soft, transition to medium or hard
      if (currentCompound === 'soft') return 'medium';
      if (currentCompound === 'hard') return 'medium';
      return 'medium';
    }
  }

  /**
   * Predicts where the car will rejoin relative to the field after completing a pit stop.
   */
  predictRejoinTraffic(car, track, pitLossS, allCars) {
    const L = track.circuit.lengthM;
    const avgRacingSpeed = Math.max(20, car.v || 55);

    // Distance lost while stopped/in-lane
    const distLostM = pitLossS * avgRacingSpeed;
    const projectedRejoinD = (((car.d - distLostM) % L) + L) % L;

    // Scan for cars within a 25m envelope of projected rejoining point
    const trafficEnvelopeM = 28.0;
    let blockingCar = null;
    let trafficCount = 0;

    for (const other of allCars) {
      if (other === car || other.finished || other.retiredLap != null) continue;
      const gapM = (((other.d - projectedRejoinD) % L) + L) % L;
      const directDist = Math.min(gapM, L - gapM);
      if (directDist < trafficEnvelopeM) {
        trafficCount++;
        if (!blockingCar) blockingCar = other;
      }
    }

    return {
      projectedRejoinD: Math.round(projectedRejoinD),
      hasHeavyTraffic: trafficCount >= 2,
      trafficDensity: trafficCount,
      blockingCarCode: blockingCar?.code || null,
      clearAirAhead: trafficCount === 0
    };
  }

  /**
   * Mathematical undercut prediction against car ahead.
   */
  analyzeUndercut(car, rival, pitLossS, lapsLeft) {
    if (!rival || lapsLeft < 3) return null;

    const gapM = rival.d - car.d;
    const gapS = gapM / Math.max(12, car.v);

    if (gapS > 5.5 || gapS < 0) return null;

    // Fresh tyres provide ~1.8s pace advantage on out-lap
    const freshRubberDelta = 1.85;
    const rivalDegradLoss = (rival.tyreModel?.wear || 0) * 1.5;
    const expectedOutLapAdvantage = freshRubberDelta + rivalDegradLoss;

    const netAdvantageS = Math.round((expectedOutLapAdvantage - 0.4) * 10) / 10;
    const isViable = gapS < 3.0 && netAdvantageS > 1.2;

    return {
      rivalCode: rival.code,
      gapS: gapS.toFixed(1),
      netAdvantageS: netAdvantageS.toFixed(1),
      isViable,
      recommendation: isViable
        ? `UNDERCUT VIABLE: Fresh tyres projected to gain ~${netAdvantageS.toFixed(1)}s on ${rival.code} on out-lap.`
        : `UNDERCUT RISKY: Gap to ${rival.code} is too wide (${gapS.toFixed(1)}s).`
    };
  }

  /**
   * Overcut analysis evaluating clear air pace vs pitting early.
   */
  analyzeOvercut(car, rival, lapsLeft, currentWear, rejoinAnalysis) {
    if (!rival || lapsLeft < 3) return null;

    const isViable = (currentWear < 0.55 && rejoinAnalysis.hasHeavyTraffic);
    return {
      rivalCode: rival.code,
      isViable,
      recommendation: isViable
        ? `OVERCUT VIABLE: Clean air ahead while rivals hit pit exit traffic. Extend stint!`
        : `OVERCUT MARGINAL: Degradation will negate clean air advantage.`
    };
  }

  _findRivalAhead(car, allCars, L) {
    let closest = null;
    let minGap = Infinity;
    for (const other of allCars) {
      if (other === car || other.finished || other.retiredLap != null) continue;
      const gap = (((other.d - car.d) % L) + L) % L;
      if (gap > 0 && gap < 60 && gap < minGap) {
        minGap = gap;
        closest = other;
      }
    }
    return closest;
  }

  _derivePersonality(car) {
    const p = car.driver?.personality || {};
    if (p.aggression > 0.82) return StrategyPersonality.GAMBLER;
    if (p.consistency > 0.85) return StrategyPersonality.CONSERVATIVE;
    if (p.racecraft > 0.82) return StrategyPersonality.WEATHER_RESPONSIVE;
    return StrategyPersonality.BALANCED;
  }

  _commitDecision(carDec, currentLap, action, compound, reason, pitLossS, netTimeSavingS = 0) {
    carDec.lastEvalLap = currentLap;
    carDec.currentAction = action;
    carDec.targetCompound = compound;
    carDec.reason = reason;
    carDec.lockUntilLap = currentLap + 1; // 1-lap decision stability lock

    return {
      action,
      recommendedCompound: compound,
      reason,
      pitLossS,
      netTimeSavingS,
      undercut: null,
      overcut: null,
      rejoinTraffic: null,
      twoDrySatisfied: true
    };
  }
}
