/**
 * aeroModel.js
 * Aerodynamic Wake, Dirty Air, and Slipstreaming Simulation.
 *
 * Implements:
 *   - Ground effect downforce & drag generation proportional to speed²
 *   - Turbulent wake (Dirty Air) in corners: up to 28% downforce loss when closely following
 *   - Slipstreaming (Tow) on straights: up to 26% aerodynamic drag reduction behind a leading car
 *   - Seamless DRS integration without violating energy or grip conservation
 */

export class AeroModel {
  /**
   * Evaluate aerodynamic wake effects on a car given its proximity to the car ahead.
   *
   * @param {object} car       – this car
   * @param {object} carAhead  – immediate leading car (or null if clear air)
   * @param {number} gapM      – distance in metres to car ahead
   * @param {number} latDiff   – lateral alignment delta in metres
   * @param {boolean} isCorner – whether current track section is a corner vs straight
   * @param {boolean} drsActive – whether DRS flap is currently open
   * @returns {object} { downforceMult, dragMult, inDirtyAir, inSlipstream, wakeIntensity }
   */
  static evaluateWake(car, carAhead, gapM, latDiff, isCorner, drsActive) {
    if (!carAhead || gapM <= 0 || gapM > 65 || car.v < 15) {
      return {
        downforceMult: 1.0,
        dragMult: drsActive ? 0.72 : 1.0,
        inDirtyAir: false,
        inSlipstream: false,
        wakeIntensity: 0.0
      };
    }

    // Lateral wake cone: wake expands outwards downstream (width ~ 2.2m near car, ~4.5m at 50m)
    const coneRadius = 2.0 + (gapM / 50.0) * 2.5;
    const lateralFactor = Math.max(0, 1.0 - Math.abs(latDiff) / coneRadius);

    if (lateralFactor <= 0.05) {
      // Out of the wake cone
      return {
        downforceMult: 1.0,
        dragMult: drsActive ? 0.72 : 1.0,
        inDirtyAir: false,
        inSlipstream: false,
        wakeIntensity: 0.0
      };
    }

    // Longitudinal wake decay: smooth cosine curve from 5m to 55m (no sudden force spikes)
    const normDist = Math.max(0, Math.min(1.0, (gapM - 5.0) / 50.0));
    const distFactor = Math.cos(normDist * Math.PI * 0.5);
    const wakeIntensity = distFactor * lateralFactor;

    let downforceMult = 1.0;
    let dragMult = 1.0;
    let frontGripLoss = 0.0;
    let inDirtyAir = false;
    let inSlipstream = false;

    if (isCorner) {
      // In corners: turbulent wake degrades aerodynamic downforce and front-end grip
      // Up to 28% total downforce loss and 18% front-end grip loss when following in gearbox
      downforceMult = Math.max(0.72, 1.0 - wakeIntensity * 0.28);
      frontGripLoss = wakeIntensity * 0.18;
      inDirtyAir = wakeIntensity > 0.12;
    } else {
      // On straights: low-pressure bubble reduces aerodynamic drag (Slipstream / Tow)
      // Up to 26% drag reduction behind leading car
      const slipstreamBenefit = wakeIntensity * 0.26;
      inSlipstream = wakeIntensity > 0.12;

      if (drsActive) {
        // Combined DRS + slipstream: diminishing returns to prevent unrealistic speeds
        dragMult = Math.max(0.54, (1.0 - slipstreamBenefit * 0.55) * 0.72);
      } else {
        dragMult = Math.max(0.74, 1.0 - slipstreamBenefit);
      }
    }

    return {
      downforceMult,
      dragMult,
      frontGripLoss,
      inDirtyAir,
      inSlipstream,
      wakeIntensity
    };
  }
}
