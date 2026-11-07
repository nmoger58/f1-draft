/**
 * strategyAI.js
 * Weather-Aware Strategic Decision Engine, FIA Regulation Validator, & Pit Predictor.
 *
 * Implements:
 *   - Integration with PredictiveStrategyEngine (multi-compound pace forecasts & traffic rejoining)
 *   - Dynamic crossover point analysis (Slick <-> Inter <-> Wet)
 *   - FIA Sporting Regulation: Mandatory Two-Compound Rule in dry races (waived in wet)
 *   - Safety Car & VSC Opportunistic Pit Stop evaluation (cheap pit stop delta reduction ~11-13s)
 *   - Critical Tyre Puncture & Delamination emergency pit calls
 *   - Radar forecast integration (anticipates rain before it arrives)
 *   - Team strategy personalities: Gambler, Balanced, Conservative, Weather-Responsive
 *   - Mathematical Undercut and Overcut delta estimations with traffic awareness
 */

import { PredictiveStrategyEngine, PitAction, StrategyPersonality } from './predictiveStrategyEngine.js';

export const StrategyProfiles = {
  GAMBLER: {
    name: 'Aggressive / Gambler',
    crossoverBias: -0.06,
    wearTolerance: 0.60
  },
  BALANCED: {
    name: 'Balanced / Pragmatic',
    crossoverBias: 0.00,
    wearTolerance: 0.68
  },
  CONSERVATIVE: {
    name: 'Conservative / Safe',
    crossoverBias: 0.06,
    wearTolerance: 0.75
  }
};

const _sharedPredictor = new PredictiveStrategyEngine();

export class StrategyAI {
  /**
   * Determine optimal compound and pit timing for a car.
   *
   * @param {object}   car           – car state (including tyreModel, lap, position)
   * @param {number}   totalLaps     – race length
   * @param {number}   trackWetness  – current track average wetness (0..1)
   * @param {object}   weatherRadar  – forecast from weatherEngine
   * @param {number}   pitLossS      – pit lane time loss (e.g. 22s)
   * @param {object[]} allCars       – entire field for undercut/overcut analysis
   * @param {string}   flag          – current race control flag state
   * @param {object}   [track]       – optional track geometry
   * @param {object}   [trackCond]   – optional TrackConditionModel
   * @param {number}   [simTime]     – elapsed race time
   * @returns {object} { shouldPit, recommendedCompound, reason, undercut, overcut, rejoinTraffic, twoDrySatisfied, cheapPitWindow, action }
   */
  static evaluate(car, totalLaps, trackWetness, weatherRadar, pitLossS = 22, allCars = [], flag = 'green', track = null, trackCond = null, simTime = 0) {
    if (track) {
      // Use full predictive strategy engine
      const pred = _sharedPredictor.evaluateStrategy(car, totalLaps, track, trackCond, weatherRadar, allCars, flag, simTime);
      return {
        shouldPit: (pred.action === PitAction.PIT_THIS_LAP),
        recommendedCompound: pred.recommendedCompound,
        emergency: pred.reason?.includes('CRITICAL') || pred.reason?.includes('PUNCTURE') || pred.reason?.includes('Slicks lack grip'),
        reason: pred.reason,
        undercut: pred.undercut,
        overcut: pred.overcut,
        rejoinTraffic: pred.rejoinTraffic,
        twoDrySatisfied: pred.twoDrySatisfied,
        cheapPitWindow: (flag === 'safetycar' || flag === 'vsc'),
        action: pred.action,
        pitLossS: pred.pitLossS
      };
    }

    // Fallback if track geometry not passed directly
    const tyre = car.tyreModel;
    const lapsLeft = Math.max(0, totalLaps - (car.lap || 0));

    if (lapsLeft <= 1 && !tyre?.punctured) {
      return {
        shouldPit: false,
        recommendedCompound: tyre ? tyre.compound : 'medium',
        reason: 'Final lap — stay out!',
        undercut: null,
        overcut: null,
        twoDrySatisfied: true,
        action: PitAction.STAY_OUT
      };
    }

    // Initialize compoundsUsed set on car
    if (!car.compoundsUsed) {
      car.compoundsUsed = new Set([tyre?.compound || 'medium']);
    } else if (tyre) {
      car.compoundsUsed.add(tyre.compound);
    }

    let profile = StrategyProfiles.BALANCED;
    if (car.driver?.personality?.aggression > 0.80) {
      profile = StrategyProfiles.GAMBLER;
    } else if (car.driver?.personality?.consistency > 0.85) {
      profile = StrategyProfiles.CONSERVATIVE;
    }

    const slickToInter = Math.max(0.12, 0.20 + profile.crossoverBias);
    const interToWet   = Math.max(0.55, 0.65 + profile.crossoverBias);

    let targetCompound = 'medium';
    const futureRain = weatherRadar?.rainIntensity ?? 0;

    if (trackWetness > interToWet || (trackWetness > 0.50 && futureRain > 0.65)) {
      targetCompound = 'wet';
    } else if (trackWetness > slickToInter || (trackWetness > 0.12 && futureRain > 0.25)) {
      targetCompound = 'intermediate';
    } else {
      const usedWet = car.compoundsUsed.has('intermediate') || car.compoundsUsed.has('wet') || trackWetness >= 0.20;
      const twoDrySatisfied = usedWet || car.compoundsUsed.size >= 2;

      if (!usedWet && !twoDrySatisfied && car.compoundsUsed.size === 1) {
        const currentDry = Array.from(car.compoundsUsed)[0];
        if (currentDry === 'medium') targetCompound = lapsLeft <= 9 ? 'soft' : 'hard';
        else if (currentDry === 'soft') targetCompound = lapsLeft <= 16 ? 'medium' : 'hard';
        else if (currentDry === 'hard') targetCompound = lapsLeft <= 8 ? 'soft' : 'medium';
      } else {
        if (lapsLeft <= 8) targetCompound = 'soft';
        else if (lapsLeft <= 18) targetCompound = 'medium';
        else targetCompound = 'hard';
      }
    }

    const curCmp = tyre ? tyre.compound : 'medium';
    const isDryTyre = (curCmp === 'soft' || curCmp === 'medium' || curCmp === 'hard');
    const isWetTyre = (curCmp === 'intermediate' || curCmp === 'wet');

    let emergencyPit = false;
    let pitReason = '';

    if (tyre?.punctured) {
      emergencyPit = true;
      pitReason = `CRITICAL PUNCTURE! Structural failure on ${curCmp.toUpperCase()} tyre. Box immediately!`;
    } else if (isDryTyre && trackWetness >= 0.25) {
      emergencyPit = true;
      pitReason = `Track wet (${Math.round(trackWetness * 100)}%). Slicks lack grip — BOX for ${targetCompound.toUpperCase()}!`;
    } else if (isWetTyre && trackWetness < 0.10 && futureRain < 0.05) {
      emergencyPit = true;
      pitReason = `Track dry (${Math.round(trackWetness * 100)}%). Wet tyres destroying pace — BOX for slicks!`;
    }

    let wearPit = false;
    const curWear = tyre ? tyre.wear : 0;
    if (curWear >= 0.80 && lapsLeft > 1) {
      wearPit = true;
      pitReason = `Tyres severely degraded (${Math.round(curWear * 100)}% wear). Box immediately to avoid severe speed penalty!`;
    } else if (curWear > profile.wearTolerance && lapsLeft > 3) {
      wearPit = true;
      pitReason = `Tyre degradation critical (${Math.round(curWear * 100)}%). Box for fresh ${targetCompound.toUpperCase()}.`;
    }

    let safetyCarPit = false;
    const isSafetyCarActive = (flag === 'safety_car' || flag === 'vsc' || flag === 'safetycar');
    if (isSafetyCarActive && lapsLeft >= 3 && !emergencyPit) {
      if (curWear > 0.35 || (tyre && tyre.ageLaps >= 6)) {
        safetyCarPit = true;
        pitReason = `${flag.toUpperCase()} active: cheap pit stop window (-10s delta loss)! Box for fresh ${targetCompound.toUpperCase()}.`;
      }
    }

    const rivalAhead = allCars
      .filter(c => c !== car && !c.finished && c.d > car.d)
      .sort((a, b) => a.d - b.d)[0];

    const effectivePitLoss = isSafetyCarActive ? 12.0 : pitLossS;
    const undercutAnalysis = this.analyzeUndercut(car, rivalAhead, effectivePitLoss, lapsLeft);

    const shouldPit = emergencyPit || wearPit || safetyCarPit;
    const usedWetCompound = car.compoundsUsed.has('intermediate') || car.compoundsUsed.has('wet');
    const twoDrySatisfied = usedWetCompound || car.compoundsUsed.size >= 2;

    return {
      shouldPit,
      recommendedCompound: targetCompound,
      emergency: emergencyPit,
      reason: pitReason || 'Tyres performing in acceptable window.',
      undercut: undercutAnalysis,
      overcut: null,
      twoDrySatisfied,
      cheapPitWindow: isSafetyCarActive,
      action: shouldPit ? PitAction.PIT_THIS_LAP : PitAction.STAY_OUT
    };
  }

  /**
   * Analyze potential Undercut advantage against car ahead.
   */
  static analyzeUndercut(car, rival, pitLossS, lapsLeft) {
    if (!rival || lapsLeft < 3) return null;

    const gapM = rival.d - car.d;
    const gapS = gapM / Math.max(10, car.v);

    if (gapS > 6.0 || gapS < 0) return null;

    const freshTyrePaceDelta = 1.85;
    const rivalDegradLoss = (rival.tyreModel?.wear || 0) * 1.4;
    const expectedOutLapGain = freshTyrePaceDelta + rivalDegradLoss;

    const netAdvantageS = Math.round((expectedOutLapGain - 0.4) * 10) / 10;
    const isViable = gapS < 3.2 && netAdvantageS > 1.2;

    return {
      rivalCode: rival.code,
      gapS: gapS.toFixed(1),
      netAdvantageS: netAdvantageS.toFixed(1),
      isViable,
      recommendation: isViable
        ? `UNDERCUT VIABLE: Pitting now gains ~${netAdvantageS.toFixed(1)}s against ${rival.code} on fresh rubber!`
        : `OVERCUT PREFERRED: Stay out in clean air, tyres still have pace.`
    };
  }
}
