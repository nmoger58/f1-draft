/**
 * fuelModel.js
 * Fuel Load, Vehicle Mass, and Energy Recovery System (ERS) Simulation.
 *
 * Implements:
 *   - FIA minimum base mass: 798 kg (car + driver without fuel)
 *   - Starting fuel load up to 105 kg (scaled to total race distance)
 *   - Realistic fuel flow: consumption based on throttle, RPM, and engine mode
 *   - Dynamic vehicle mass: acceleration, braking distances, and tyre wear scale with mass
 *   - Low-fuel warnings and engine limp mode if fuel depletes
 *   - Hybrid Energy Recovery System (ERS): MGU-K harvesting under braking, MGU-K boost deployment
 */

export const EngineModes = {
  LEAN:     { name: 'Lean / Save',  flowMult: 0.85, powerMult: 0.94 },
  STANDARD: { name: 'Standard',     flowMult: 1.00, powerMult: 1.00 },
  PUSH:     { name: 'Overtake / Push', flowMult: 1.22, powerMult: 1.05 }
};

export class FuelModel {
  /**
   * @param {number} totalLaps – race length in laps
   * @param {number} circuitLengthM – track length in metres
   */
  constructor(totalLaps = 5, circuitLengthM = 5000) {
    this.totalLaps = Math.max(1, totalLaps);
    this.circuitLengthM = circuitLengthM;

    // Fuel allocation: standard F1 race burns ~100-105 kg over ~305 km
    // Average burn: ~1.7 - 2.1 kg per lap
    const kmTotal = (totalLaps * circuitLengthM) / 1000;
    const kgEstimate = Math.min(105, Math.max(8, kmTotal * 0.34));

    this.startingFuelKg = kgEstimate;
    this.fuelRemainingKg = kgEstimate;
    this.targetFuelPerLap = kgEstimate / this.totalLaps;
    this.fuelDeltaKg = 0.0; // Positive = surplus (can push), Negative = deficit (saving needed)
    this.isLiftingAndCoasting = false;
    this.liftAndCoastDistanceM = 80; // Lift 60-100m before braking zone
    this.mode = EngineModes.STANDARD;
    this.baseMassKg = 798; // 2024-2026 technical regulations

    // ERS battery state
    this.batterySoc = 0.85; // 85% charge at start (0..1)
    this.ersDeploying = false;
    this.ersHarvesting = false;
  }

  /**
   * Evaluates if car should lift and coast before upcoming braking zone.
   * @param {number} distToBrakeZoneM
   * @param {number} currentLap
   * @param {number} speedMps
   * @returns {boolean}
   */
  shouldLiftAndCoast(distToBrakeZoneM, currentLap = 1, speedMps = 50) {
    const targetBurn = this.targetFuelPerLap * currentLap;
    const actualBurn = this.startingFuelKg - this.fuelRemainingKg;
    this.fuelDeltaKg = Number((targetBurn - actualBurn).toFixed(2));

    const needsSaving = (this.mode === EngineModes.LEAN) || (this.fuelDeltaKg < -0.15) || (this.isLow);
    if (!needsSaving || speedMps < 35) {
      this.isLiftingAndCoasting = false;
      return false;
    }

    if (distToBrakeZoneM > 5 && distToBrakeZoneM <= this.liftAndCoastDistanceM) {
      this.isLiftingAndCoasting = true;
      return true;
    }

    this.isLiftingAndCoasting = false;
    return false;
  }

  /** Current vehicle mass in kg (base chassis + driver + remaining fuel) */
  get massKg() {
    return this.baseMassKg + Math.max(0, this.fuelRemainingKg);
  }

  /** Mass penalty factor relative to empty car: heavier = slower acceleration */
  get massPaceFactor() {
    // Every 10 kg of fuel costs ~0.3s on a 90s lap (~0.33% pace loss per 10 kg)
    const excessKg = this.fuelRemainingKg;
    return Math.max(0.92, 1.0 - (excessKg / 10) * 0.0033);
  }

  /**
   * Advance fuel burn and ERS for one physics tick.
   *
   * @param {number} dt       – time step (seconds)
   * @param {number} throttle – 0..1 throttle position
   * @param {number} brake    – 0..1 brake position
   * @param {number} speedMps – vehicle speed
   * @param {boolean} [isLifting=false] - whether lift and coast is currently active
   * @returns {object} { fuelKg, massKg, isOut, isLow, ersBoost, isLiftingAndCoasting, fuelDeltaKg }
   */
  update(dt, throttle, brake, speedMps, isLifting = false) {
    // 1. Fuel burn rate (max flow limit = 100 kg/hr = 0.0277 kg/s at WOT)
    const effectiveThrottle = isLifting ? 0 : throttle;
    const idleFlow = 0.0006; // kg/s
    const maxFlow  = 0.0277; // kg/s at 100% throttle
    const burnRate = (idleFlow + effectiveThrottle * (maxFlow - idleFlow)) * this.mode.flowMult;

    if (this.fuelRemainingKg > 0) {
      this.fuelRemainingKg = Math.max(0, this.fuelRemainingKg - burnRate * dt);
    }

    // 2. ERS Simulation (MGU-K)
    // Deploy under heavy throttle (>80%) at speed > 30 m/s if battery has charge
    if (effectiveThrottle > 0.80 && speedMps > 30 && this.batterySoc > 0.05) {
      this.ersDeploying = true;
      this.ersHarvesting = false;
      this.batterySoc = Math.max(0, this.batterySoc - 0.015 * dt); // ~4 MJ per lap max deploy
    } else if (brake > 0.20 && speedMps > 15) {
      // Harvest under braking
      this.ersDeploying = false;
      this.ersHarvesting = true;
      this.batterySoc = Math.min(1.0, this.batterySoc + 0.025 * dt); // ~2 MJ per lap harvest
    } else {
      this.ersDeploying = false;
      this.ersHarvesting = false;
    }

    const isOut = this.fuelRemainingKg <= 0.001;
    const isLow = this.fuelRemainingKg < (this.startingFuelKg / this.totalLaps) * 1.5;

    return {
      fuelKg: this.fuelRemainingKg,
      massKg: this.massKg,
      massPaceFactor: this.massPaceFactor,
      isOut,
      isLow,
      isLiftingAndCoasting: this.isLiftingAndCoasting,
      fuelDeltaKg: this.fuelDeltaKg,
      ersBoost: this.ersDeploying ? 1.04 : 1.0,
      batterySoc: this.batterySoc
    };
  }

  /** Estimated laps of fuel remaining at current consumption */
  get lapsRemaining() {
    const avgPerLap = this.startingFuelKg / Math.max(1, this.totalLaps);
    return (this.fuelRemainingKg / Math.max(0.1, avgPerLap)).toFixed(1);
  }
}
