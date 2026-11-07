/**
 * tyreModel.js
 * Comprehensive Formula 1 Tyre Simulation Model.
 *
 * Implements:
 *   - 5 Compounds: Soft, Medium, Hard, Intermediate, Full Wet
 *   - Thermal thermodynamics: heating from cornering/braking loads, cooling from airflow and track water
 *   - Temperature grip curves: cold tyre penalty, optimal operating window, blistering/overheating penalty
 *   - Progressive wear mechanics: linear phase, degradation cliff (>65%), and critical fatigue
 *   - Mechanical damage & punctures: critical degradation (>90% wear) triggers puncture and limp mode
 *   - Flat-spotting from high-deceleration wheel lockups
 *   - Out-of-pit scrub-in warm-up curve (blanket temp -> operating window over initial ~350m)
 *   - Dynamic weather & continuous water interaction:
 *       * Slicks lose grip exponentially as wetness > 0.12
 *       * Intermediates optimal in damp (0.12 - 0.60), overheat rapidly on dry asphalt (up to 5x degradation)
 *       * Full Wets optimal in heavy rain / standing water (0.50 - 1.00), severe tread squirm and overheating on dry
 *       * Water cooling vs air cooling on tread temperature
 *       * Aquaplaning risk at speed when standing water exceeds compound drainage capacity
 */

export const TYRE_COMPOUNDS = {
  soft: {
    name: 'Soft',
    code: 'S',
    colour: '#e8002d',
    baseGrip: 1.08,
    degradBase: 0.030,
    optTempMin: 90,
    optTempMax: 108,
    optTempPeak: 100,
    heatGenRate: 1.15,
    coolingRate: 0.045,
    blanketTemp: 82,
    minWetness: 0.0,
    maxWetness: 0.15,
    aquaplaneThreshold: 0.35,
    description: 'Maximum dry grip, fastest warm-up, high degradation.'
  },
  medium: {
    name: 'Medium',
    code: 'M',
    colour: '#ffd60a',
    baseGrip: 1.00,
    degradBase: 0.018,
    optTempMin: 95,
    optTempMax: 112,
    optTempPeak: 104,
    heatGenRate: 1.00,
    coolingRate: 0.042,
    blanketTemp: 84,
    minWetness: 0.0,
    maxWetness: 0.15,
    aquaplaneThreshold: 0.40,
    description: 'Balanced performance and durability, versatile working range.'
  },
  hard: {
    name: 'Hard',
    code: 'H',
    colour: '#f3f3f3',
    baseGrip: 0.94,
    degradBase: 0.010,
    optTempMin: 100,
    optTempMax: 118,
    optTempPeak: 110,
    heatGenRate: 0.88,
    coolingRate: 0.038,
    blanketTemp: 85,
    minWetness: 0.0,
    maxWetness: 0.15,
    aquaplaneThreshold: 0.45,
    description: 'Maximum durability, slower warm-up, resistant to degradation.'
  },
  intermediate: {
    name: 'Intermediate',
    code: 'I',
    colour: '#39b54a',
    baseGrip: 0.86,
    degradBase: 0.018,
    optTempMin: 65,
    optTempMax: 85,
    optTempPeak: 75,
    heatGenRate: 1.25,
    coolingRate: 0.065,
    blanketTemp: 62,
    minWetness: 0.12,
    maxWetness: 0.65,
    aquaplaneThreshold: 0.70,
    description: 'Grooved tread evacuating 30L/s; optimal for damp to moderately wet.'
  },
  wet: {
    name: 'Full Wet',
    code: 'W',
    colour: '#0072ce',
    baseGrip: 0.78,
    degradBase: 0.022,
    optTempMin: 55,
    optTempMax: 75,
    optTempPeak: 65,
    heatGenRate: 1.35,
    coolingRate: 0.085,
    blanketTemp: 55,
    minWetness: 0.50,
    maxWetness: 1.00,
    aquaplaneThreshold: 0.90,
    description: 'Deep tread evacuating 85L/s; essential for standing water and torrential rain.'
  }
};

export class TyreModel {
  /**
   * @param {string} compound – 'soft' | 'medium' | 'hard' | 'intermediate' | 'wet'
   * @param {number} startLap
   */
  constructor(compound = 'medium', startLap = 0, options = {}) {
    this.compound = (compound || 'medium').toLowerCase();
    if (!TYRE_COMPOUNDS[this.compound]) this.compound = 'medium';

    this.spec = TYRE_COMPOUNDS[this.compound];
    this.startLap = startLap;
    this.wear = 0.0;           // 0.0 = brand new, 1.0 = fully depleted
    this.ageLaps = 0;
    this.distanceM = 0;        // distance rolled on this set
    this.temp = this.spec.blanketTemp || (this.spec.optTempPeak - 15); // Blanket tyre warmer temp
    this.blistering = 0.0;
    this.graining = 0.0;
    this.flatSpot = 0.0;
    this.punctured = false;
    this.punctureOnWear = (options && options.punctureOnWear !== undefined) ? options.punctureOnWear : true;
    this.aquaplaning = false;
  }

  /**
   * Advance tyre thermodynamics and degradation for a physics tick.
   *
   * @param {number} dt               – time step (seconds)
   * @param {number} speedMps         – vehicle speed
   * @param {number} lateralLoad      – lateral acceleration / cornering load (m/s²)
   * @param {number} longitudinalLoad – acceleration/braking force (m/s²)
   * @param {number} trackWetness     – surface water level (0..1)
   * @param {number} trackTemp        – track temperature (°C)
   * @param {number} driverManagement – driver skill modifier (0.5..1.0)
   */
  update(dt, speedMps, lateralLoad, longitudinalLoad, trackWetness, trackTemp, driverManagement = 0.75) {
    const spec = this.spec;
    const isWetCompound = (this.compound === 'intermediate' || this.compound === 'wet');

    this.distanceM += speedMps * dt;

    // ── 1. Heat Generation ────────────────────────────────────────────────────
    // Load energy: friction work done by tyre from cornering and traction
    const loadFactor = (Math.abs(lateralLoad) * 0.7 + Math.abs(longitudinalLoad) * 0.5) / 25;
    const speedRatio = Math.min(1.5, speedMps / 60);

    // Wet tyres on dry asphalt generate enormous friction and heat from tread block squirm
    let compoundMismatchFriction = 1.0;
    if (isWetCompound && trackWetness < spec.minWetness) {
      const deficit = spec.minWetness - trackWetness;
      compoundMismatchFriction = 1.0 + deficit * 1.8;
    }

    const heatGen = loadFactor * speedRatio * spec.heatGenRate * compoundMismatchFriction * 18 * dt;

    // ── 2. Heat Dissipation ──────────────────────────────────────────────────
    // Airflow convective cooling
    const airflowCool = (this.temp - Math.max(15, trackTemp - 5)) * spec.coolingRate * (1 + speedMps / 50) * dt;

    // Water cooling: water conducts heat away rapidly. Slicks in heavy rain cool excessively
    const waterCoolingFactor = trackWetness * (isWetCompound ? 1.8 : 4.5);
    const waterCool = (this.temp - (trackTemp - 3)) * waterCoolingFactor * 0.15 * (1 + speedMps / 40) * dt;

    // Temperature update
    this.temp = Math.max(15, Math.min(150, this.temp + heatGen - airflowCool - waterCool));

    // Overheating penalties: blistering if pushed too hot for too long
    if (this.temp > spec.optTempMax + 8) {
      this.blistering = Math.min(0.40, this.blistering + 0.0035 * dt);
    } else {
      this.blistering = Math.max(0, this.blistering - 0.0005 * dt);
    }

    // Graining if driven aggressively while cold
    if (this.temp < spec.optTempMin - 15 && loadFactor > 0.5) {
      this.graining = Math.min(0.35, this.graining + 0.0025 * dt);
    } else {
      this.graining = Math.max(0, this.graining - 0.0004 * dt);
    }

    // Flat spot accumulation from heavy wheel lockups (longitudinal decel < -42 m/s²)
    if (longitudinalLoad < -42 && speedMps > 15) {
      this.flatSpot = Math.min(0.40, this.flatSpot + 0.05 * dt);
    }

    // ── 3. Wear Accumulation ─────────────────────────────────────────────────
    // Severe wear multiplier if wet tyre is driven on dry track (thermal shredding)
    let dryTrackPenalty = 1.0;
    if (isWetCompound && trackWetness < spec.minWetness) {
      const deficit = spec.minWetness - trackWetness;
      dryTrackPenalty = 1.0 + deficit * 4.5; // Up to 5.5x degradation rate!
    }

    // Thermal wear factor: tyres wear exponentially faster when overheated
    const tempDelta = Math.max(0, this.temp - spec.optTempPeak);
    const thermalWearFactor = 1.0 + Math.pow(tempDelta / 14, 2) * 0.45;

    // Driver skill attenuation (0.8x for high skill down to 1.25x for low skill)
    const skillMultiplier = 1.25 - driverManagement * 0.45;

    // Distance-based tick wear
    const baseWearRate = (spec.degradBase / 5000) * (speedMps * dt); // scaled by distance travelled
    const wearMultiplier = this.wearMultiplier ?? 1.0;
    const wearDelta = baseWearRate * thermalWearFactor * dryTrackPenalty * skillMultiplier * (1 + this.blistering) * wearMultiplier;
    this.wear = Math.min(1.0, this.wear + wearDelta);

    // Mechanical puncture trigger: catastrophic delamination if wear exceeds 92% (when punctureOnWear is enabled)
    if (this.punctureOnWear && this.wear >= 0.92 && !this.punctured) {
      this.punctured = true;
    }

    // ── 4. Aquaplaning Assessment ────────────────────────────────────────────
    // Occurs when water layer exceeds tread drainage capacity at speed
    const aquaplaneSpeed = 150 / 3.6; // ~150 km/h threshold
    if (trackWetness > spec.aquaplaneThreshold && speedMps > aquaplaneSpeed) {
      const severity = (trackWetness - spec.aquaplaneThreshold) / (1 - spec.aquaplaneThreshold);
      const speedExcess = (speedMps - aquaplaneSpeed) / 30;
      this.aquaplaning = (severity * speedExcess > 0.22);
    } else {
      this.aquaplaning = false;
    }

    return this.getGrip(trackWetness);
  }

  /**
   * Calculate instantaneous grip coefficient and condition.
   *
   * @param {number} trackWetness – 0..1
   * @returns {object} { totalGrip, baseGrip, wearFactor, thermalFactor, wetnessFactor, temp, wear, condition, ... }
   */
  getGrip(trackWetness = 0) {
    const spec = this.spec;

    // Puncture condition override: complete loss of pneumatic structure & grip
    if (this.punctured) {
      return {
        totalGrip: 0.20,
        baseGrip: spec.baseGrip,
        wearFactor: 0.20,
        thermalFactor: 0.50,
        wetnessFactor: 1.0,
        temp: this.temp,
        wear: this.wear,
        ageLaps: this.ageLaps,
        isOverheating: false,
        isCold: false,
        aquaplaning: false,
        punctured: true,
        flatSpot: this.flatSpot,
        condition: 'PUNCTURED'
      };
    }

    // A. Wear Grip Factor (0.0 to 1.0)
    // Up to 65% wear: mild linear wear loss. Above 65%: "The Cliff"
    let wearFactor = 1.0;
    if (this.wear < 0.65) {
      wearFactor = 1.0 - this.wear * 0.20; // 1.0 -> 0.87
    } else {
      const cliff = (this.wear - 0.65) / 0.35; // 0..1
      wearFactor = 0.87 - cliff * 0.45; // 0.87 -> 0.42
    }

    // B. Thermal Grip Factor
    // Optimal bell curve around optTempPeak
    let thermalFactor = 1.0;
    if (this.temp < spec.optTempMin) {
      // Cold tyres: reduced grip
      const coldDelta = spec.optTempMin - this.temp;
      thermalFactor = Math.max(0.55, 1.0 - (coldDelta / 50) * 0.45);
    } else if (this.temp > spec.optTempMax) {
      // Overheating tyres: loss of traction & sliding
      const hotDelta = this.temp - spec.optTempMax;
      thermalFactor = Math.max(0.60, 1.0 - (hotDelta / 40) * 0.40);
    }

    // Deduct blistering, graining, and flat-spotting
    thermalFactor = Math.max(0.35, thermalFactor - this.blistering * 0.30 - this.graining * 0.20 - this.flatSpot * 0.25);

    // Out-of-pit scrub-in warm-up factor (first ~350m of fresh tyre)
    const scrubInFactor = Math.min(1.0, 0.90 + (this.distanceM / 350) * 0.10);
    thermalFactor *= scrubInFactor;

    // C. Wetness Interaction Factor
    let wetnessFactor = 1.0;
    const isWetCompound = (this.compound === 'intermediate' || this.compound === 'wet');

    if (!isWetCompound) {
      // Slick tyres on wet track: grip plummets as water increases
      if (trackWetness > 0.10) {
        const excess = trackWetness - 0.10;
        wetnessFactor = Math.max(0.25, 1.0 - excess * 1.55);
      }
    } else if (this.compound === 'intermediate') {
      // Intermediates: optimal in 0.15 - 0.55 range
      if (trackWetness < 0.12) {
        wetnessFactor = 0.85; // Too dry
      } else if (trackWetness > 0.65) {
        wetnessFactor = Math.max(0.50, 1.0 - (trackWetness - 0.65) * 1.6); // Waterlogged
      } else {
        wetnessFactor = 1.0; // Sweet spot
      }
    } else if (this.compound === 'wet') {
      // Full Wets: optimal in 0.50 - 1.00 range
      if (trackWetness < 0.35) {
        wetnessFactor = 0.72; // Way too dry, sluggish tread block squirm
      } else if (trackWetness < 0.50) {
        wetnessFactor = 0.90;
      } else {
        wetnessFactor = 1.0; // Perfect water clearing
      }
    }

    // Aquaplaning: catastrophic loss of contact patch friction
    if (this.aquaplaning) {
      wetnessFactor *= 0.35;
    }

    const totalGrip = spec.baseGrip * wearFactor * thermalFactor * wetnessFactor;

    // Evaluate descriptive condition label
    let condition = 'OPTIMAL';
    if (this.punctured) condition = 'PUNCTURED';
    else if (this.distanceM < 350) condition = 'WARMING UP';
    else if (this.wear > 0.65) condition = 'CLIFF';
    else if (this.blistering > 0.15) condition = 'BLISTERED';
    else if (this.graining > 0.15) condition = 'GRAINED';
    else if (this.flatSpot > 0.15) condition = 'FLAT SPOT';
    else if (this.temp > spec.optTempMax) condition = 'OVERHEATING';
    else if (this.temp < spec.optTempMin) condition = 'COLD';

    return {
      totalGrip: Math.max(0.20, totalGrip),
      baseGrip: spec.baseGrip,
      wearFactor,
      thermalFactor,
      wetnessFactor,
      temp: this.temp,
      wear: this.wear,
      ageLaps: this.ageLaps,
      isOverheating: this.temp > spec.optTempMax,
      isCold: this.temp < spec.optTempMin,
      aquaplaning: this.aquaplaning,
      punctured: this.punctured,
      flatSpot: this.flatSpot,
      condition
    };
  }

  /** Advance lap counter and compute lap-end statistics */
  onLapEnd() {
    this.ageLaps++;
  }

  get label() {
    return this.spec.code;
  }

  get colour() {
    return this.spec.colour;
  }

  get wearPct() {
    return Math.round(this.wear * 100);
  }
}
