/**
 * trackConditionModel.js
 * Authoritative Spatial Track Surface Evolution, Rubber Buildup,
 * Water Accumulation, Drainage Variations, and Dynamic Drying Racing Line Model.
 *
 * Implements:
 *   - Spatial track segmentation (24 sectors around the circuit)
 *   - Separate wetness & grip states for the primary racing line vs off-line surface
 *   - Rubber deposition: dry running deposits rubber on the racing line (+4% max grip)
 *   - Rain washing effect: rain gradually degrades rubber and induces greasy film
 *   - Water displacement: passing cars physically dry out the racing line ("dry line")
 *   - Dynamic drainage & evaporation scaling with track temperature, sunlight, and sector exposure
 *   - Sector-specific microclimates (e.g. Monaco tunnel shelter)
 *   - Localized standing water, puddles, and off-line overtaking grip penalties
 *   - Unified physical grip calculation consumed by physics, AI, tyres, and strategy
 */

export class TrackConditionModel {
  /**
   * @param {number} circuitLengthM – total track length
   * @param {number} numSegments    – spatial resolution (default 24 sectors)
   * @param {string} [circuitId]    – circuit identifier for sector exposure variations
   */
  constructor(circuitLengthM = 5000, numSegments = 24, circuitId = '') {
    this.lengthM = circuitLengthM;
    this.numSegments = numSegments;
    this.segmentLengthM = circuitLengthM / numSegments;
    this.circuitId = circuitId || '';

    // Initialise 24 spatial track segments with authentic drainage and elevation variation
    this.segments = Array.from({ length: numSegments }, (_, i) => {
      const startD = i * this.segmentLengthM;
      const endD = (i + 1) * this.segmentLengthM;

      // Sector-specific drainage and shelter profiles:
      // Monaco tunnel section (~1150m - 1480m) is covered and protected from direct rain
      const isMonacoTunnel = this.circuitId === 'monaco' && startD >= 1100 && endD <= 1550;
      // Natural dips have lower drainage, elevated straights have higher drainage
      const drainageVariation = 0.00045 + (Math.sin(i * 1.3) * 0.00020) + (i % 3 === 0 ? 0.00015 : 0);

      return {
        id: i,
        startD,
        endD,
        wetness: 0.0,           // 0.0 (bone dry) to 1.0 (waterlogged)
        racingLineWetness: 0.0, // Dries faster due to car passage
        offLineWetness: 0.0,    // Retains water longer
        waterDepthMm: 0.0,      // Standing water depth in millimetres (0 to ~8mm)
        rubberLevel: 0.20,      // Baseline rubber grip deposit (0.0 to 1.0)
        drainageCapacity: isMonacoTunnel ? 0.0015 : Math.max(0.00025, drainageVariation),
        isSheltered: isMonacoTunnel,
        standingWater: false
      };
    });

    this.trackTemp = 34.0;   // °C
    this.ambientTemp = 24.0; // °C
    this.evaporationFactor = 1.0;
  }

  /**
   * Advance track moisture and rubber evolution for one simulation tick.
   *
   * @param {number}   dt            – elapsed seconds
   * @param {number}   rainIntensity – 0..1 current rain rate from weatherEngine
   * @param {object[]} cars          – active cars displacing water and depositing rubber
   */
  update(dt, rainIntensity, cars = []) {
    // Rain deposits water onto exposed segments
    const rainAccumulation = rainIntensity * 0.048 * dt;

    // Evaporation rate scales with track temperature, air warmth, and absence of heavy downpour
    const baseEvap = Math.max(0.00005, (this.trackTemp - 15) * 0.000015);
    const evaporationRate = baseEvap * (1.0 - rainIntensity * 0.75) * dt * this.evaporationFactor;

    // Track temperature evolution: cools with rainfall, warms with sun/friction
    if (rainIntensity > 0.05) {
      this.trackTemp = Math.max(this.ambientTemp - 3, this.trackTemp - rainIntensity * 0.14 * dt);
    } else {
      this.trackTemp = Math.min(48, this.trackTemp + 0.035 * dt);
    }

    // Step moisture and baseline drainage for each segment
    for (const seg of this.segments) {
      const effRain = seg.isSheltered ? 0 : rainAccumulation;

      // Accumulate rainfall
      seg.offLineWetness = Math.min(1.0, seg.offLineWetness + effRain - evaporationRate);
      seg.racingLineWetness = Math.min(1.0, seg.racingLineWetness + effRain - evaporationRate);

      // Natural drainage
      seg.offLineWetness = Math.max(0.0, seg.offLineWetness - seg.drainageCapacity * dt);
      seg.racingLineWetness = Math.max(0.0, seg.racingLineWetness - seg.drainageCapacity * 1.35 * dt);

      // Standing water depth (mm)
      seg.waterDepthMm = Math.max(0.0, seg.offLineWetness * 6.5);
      seg.standingWater = (seg.waterDepthMm > 3.8);

      // Rain washes away rubber deposits over time (rain cleans the line)
      if (rainIntensity > 0.15) {
        seg.rubberLevel = Math.max(0.05, seg.rubberLevel - rainIntensity * 0.003 * dt);
      }
    }

    // Car tyre interaction: water displacement & rubber deposition
    if (cars && cars.length > 0) {
      for (const car of cars) {
        if (car.finished || car.retiredLap !== null || car.v < 12) continue;

        const segIdx = this.getSegmentIndex(car.d);
        const seg = this.segments[segIdx];
        if (!seg) continue;

        // 1. Water displacement on the racing line
        if (seg.racingLineWetness > 0.005) {
          // Fast F1 cars disperse water outwards, carving a drier groove
          const speedFactor = Math.min(2.5, car.v / 45);
          const compoundDisplacement = (car.tyreModel?.compound === 'wet') ? 1.6
            : (car.tyreModel?.compound === 'intermediate') ? 1.3 : 1.0;
          const displacement = speedFactor * compoundDisplacement * 0.0022 * dt;
          seg.racingLineWetness = Math.max(0.0, seg.racingLineWetness - displacement);
          // Ejected water spray deposits onto off-line asphalt
          seg.offLineWetness = Math.min(1.0, seg.offLineWetness + displacement * 0.20);
        }

        // 2. Rubber deposition when track is predominantly dry (wetness < 0.18)
        if (seg.racingLineWetness < 0.18) {
          // Friction and cornering loads lay down rubber into micro-pores of asphalt
          const lateralLoad = car.latAcc || 1.0;
          const rubberDeposition = 0.00018 * Math.min(2.0, lateralLoad / 15) * dt;
          seg.rubberLevel = Math.min(1.0, seg.rubberLevel + rubberDeposition);
        }
      }
    }

    // Update overall segment average wetness
    for (const seg of this.segments) {
      seg.wetness = seg.racingLineWetness * 0.60 + seg.offLineWetness * 0.40;
    }
  }

  /**
   * Get the segment index for any distance along the circuit.
   *
   * @param {number} d - Distance in metres along track
   * @returns {number} 0 to (numSegments - 1)
   */
  getSegmentIndex(d) {
    const wrappedD = (((d % this.lengthM) + this.lengthM) % this.lengthM);
    return Math.floor(wrappedD / this.segmentLengthM) % this.numSegments;
  }

  /**
   * Query comprehensive track conditions at a specific track distance and lateral offset.
   *
   * @param {number} d   – distance along track
   * @param {number} lat – lateral offset (near 0 = on racing line)
   * @returns {object} local condition telemetry
   */
  getConditionAt(d, lat = 0) {
    const idx = this.getSegmentIndex(d);
    const seg = this.segments[idx];

    // Lateral interpolation: on-line (|lat| < 2.0) uses racingLineWetness; off-line is wetter
    const onLineRatio = Math.max(0, 1.0 - Math.abs(lat) / 4.2);
    const effectiveWetness = seg.racingLineWetness * onLineRatio + seg.offLineWetness * (1 - onLineRatio);

    // Rubber level: concentrated primarily on the racing line
    const effectiveRubber = seg.rubberLevel * (0.35 + onLineRatio * 0.65);

    // Standing water hazard off-line
    const standingWater = seg.standingWater && onLineRatio < 0.5;

    return {
      wetness: effectiveWetness,
      racingLineWetness: seg.racingLineWetness,
      offLineWetness: seg.offLineWetness,
      waterDepthMm: seg.waterDepthMm * (1.0 - onLineRatio * 0.5),
      rubberLevel: effectiveRubber,
      standingWater,
      trackTemp: this.trackTemp,
      ambientTemp: this.ambientTemp,
      segmentIndex: idx,
      isSheltered: seg.isSheltered
    };
  }

  /**
   * Calculate local available grip multiplier for a vehicle at a given point on track.
   * Consumed by vehicle physics, braking, and AI path evaluation.
   *
   * @param {number} d           – distance along track
   * @param {number} lat         – lateral offset
   * @param {string} [compound]  – 'soft' | 'medium' | 'hard' | 'intermediate' | 'wet'
   * @returns {number} physical grip multiplier (e.g. 0.25 to 1.05)
   */
  getLocalGripMultiplier(d, lat = 0, compound = 'medium') {
    const cond = this.getConditionAt(d, lat);
    const wet = cond.wetness;
    const rubber = cond.rubberLevel;

    // 1. Dry Rubber Grip Bonus (up to +4.2% on fully rubbered racing line)
    let grip = 1.0 + (rubber * 0.042);

    // 2. Wetness and Tyre Tread Crossover Dynamics
    if (compound === 'soft' || compound === 'medium' || compound === 'hard') {
      // Slicks: excellent in dry, catastrophic loss in standing water / heavy wet
      if (wet < 0.10) {
        grip *= (1.0 - wet * 0.35);
      } else if (wet < 0.30) {
        // Damp crossover: slick grip drops drastically (down to ~55%)
        grip *= Math.max(0.45, 1.0 - wet * 1.6);
      } else {
        // Heavy wet: slicks hydroplane, grip plunges to 25-35%
        grip = Math.max(0.22, 0.40 - (wet - 0.30) * 0.35);
      }
    } else if (compound === 'intermediate') {
      // Intermediates: optimal in damp/damp-drying conditions (0.15 - 0.50 wetness)
      if (wet < 0.10) {
        // Overheats on dry track, reduced grip and heavy degradation
        grip *= 0.88;
      } else if (wet <= 0.48) {
        // Prime operating window
        grip *= 0.96;
      } else {
        // Struggling in deep standing water
        grip *= Math.max(0.60, 0.96 - (wet - 0.48) * 0.70);
      }
    } else if (compound === 'wet') {
      // Full Wets: clears up to 85 L/s of standing water
      if (wet < 0.25) {
        // Severely overheats and squirmy tread blocks on dry track
        grip *= 0.80;
      } else if (wet <= 0.65) {
        grip *= 0.92;
      } else {
        // Maintains solid wet grip even in heavy monsoon
        grip *= Math.max(0.72, 0.92 - (wet - 0.65) * 0.45);
      }
    }

    // 3. Standing water off-line penalty
    if (cond.standingWater) {
      grip *= 0.78;
    }

    return Math.max(0.20, Math.min(1.08, grip));
  }

  /**
   * Indicates whether a distinct drying racing line has formed on the circuit.
   * Occurs when overall track is wet/damp, but car passages have dried the racing line.
   *
   * @returns {{ formed: boolean, avgLineWetness: number, avgOffLineWetness: number, description: string }}
   */
  getDryingLineState() {
    let sumLine = 0;
    let sumOff = 0;
    for (const seg of this.segments) {
      sumLine += seg.racingLineWetness;
      sumOff += seg.offLineWetness;
    }
    const avgLineWetness = sumLine / this.numSegments;
    const avgOffLineWetness = sumOff / this.numSegments;

    // A dry line is formed when off-line is significantly damper than on-line
    const formed = (avgOffLineWetness >= 0.18 && avgLineWetness < 0.18 && (avgOffLineWetness - avgLineWetness) >= 0.05);

    let description = 'Uniform Surface';
    if (this.averageWetness < 0.05) {
      description = 'Dry & Rubbered Racing Line';
    } else if (formed) {
      description = 'Drying Line Formed — High Off-Line Hazard';
    } else if (this.averageWetness > 0.60) {
      description = 'Standing Water & Heavy Spray';
    } else if (this.averageWetness > 0.25) {
      description = 'Damp Track Throughout';
    }

    return {
      formed,
      avgLineWetness,
      avgOffLineWetness,
      description
    };
  }

  /** Average circuit wetness across all segments (0..1) */
  get averageWetness() {
    const sum = this.segments.reduce((acc, s) => acc + s.wetness, 0);
    return sum / this.numSegments;
  }

  /** Average circuit rubber buildup (0..1) */
  get averageRubber() {
    const sum = this.segments.reduce((acc, s) => acc + s.rubberLevel, 0);
    return sum / this.numSegments;
  }

  get averageRubberLevel() {
    return this.averageRubber;
  }
}
