/**
 * batteryController.js
 * Manual Battery Deployment, Energy Recovery, Attack Mode & Cornering Trade-offs.
 *
 * Implements:
 *   - 6 Explicit Battery States:
 *       1. CHARGING
 *       2. FULLY_CHARGED
 *       3. ATTACK_READY
 *       4. DEPLOYING
 *       5. DEPLETED
 *       6. RECHARGING_AFTER_DEPLOYMENT
 *   - 2 Modes: CHARGE & ATTACK
 *   - 3 Adjustable Power Levels:
 *       Level 1 (Conserve / Low):    0.50x power, 25s continuous deployment
 *       Level 2 (Balanced / Medium): 0.75x power, 14s continuous deployment
 *       Level 3 (Maximum Attack):    1.00x power, 10s continuous deployment
 *   - Configurable Full-Charge Threshold (100% by default)
 *   - Attacking (< 5.0s) & Defending (< 2.0s) Eligibility Rules with smooth disengagement
 *   - Cornering Efficiency Penalty & Straight-vs-Corner differential
 *   - Driven-Wheel Torque & Tyre Wear Stress Coupling
 *   - Symmetric Shared Implementation for Player and AI Drivers
 */

export const BatteryState = {
  CHARGING:                     'CHARGING',
  FULLY_CHARGED:                'FULLY_CHARGED',
  ATTACK_READY:                 'ATTACK_READY',
  DEPLOYING:                    'DEPLOYING',
  DEPLETED:                     'DEPLETED',
  RECHARGING_AFTER_DEPLOYMENT:  'RECHARGING_AFTER_DEPLOYMENT'
};

export const BatteryMode = {
  CHARGE: 'CHARGE',
  ATTACK: 'ATTACK'
};

export const BatteryPowerLevel = {
  LEVEL_1: 1, // Conserve / Low
  LEVEL_2: 2, // Balanced / Medium
  LEVEL_3: 3  // Maximum Attack
};

export const BatteryConfig = {
  // Capacity: FIA 4.0 MJ (Megajoules) standard usable ERS buffer
  maxEnergyJoules:       4000000,
  startingEnergyJoules:  4000000 * 0.85, // 85% starting SOC
  fullChargeThreshold:   0.999,          // 100% required to unlock Attack mode
  fullChargeRequired:    true,

  // Eligibility Thresholds
  attackGapThreshold:    5.0, // Pursuing car ahead within 5.0s
  defendGapThreshold:    2.0, // Defending against pursuing car within 2.0s
  disengageDuration:     1.5, // 1.5s smooth power fade-out on loss of gap eligibility

  // Recovery Rates (takes ~32-35s of simulation time to recharge 0 -> 100%)
  baseRecoveryWatts:     125000, // 125 kW baseline MGU-H/engine harvesting
  brakingHarvestMax:     320000, // Up to 320 kW MGU-K regenerative braking harvesting

  // Deployment Power Levels & Drain Rates (100% drains in 10s at L3, 14s at L2, 25s at L1)
  powerLevels: {
    1: {
      name: 'Conserve (Low)',
      code: 'LVL 1',
      powerMult: 0.50,
      baseWatts: 160000, // ~25s total drain
      accelBonus: 0.055, // +5.5% longitudinal acceleration boost
      topSpeedBonusKmh: 6.0,
      baseTyreStress: 0.15
    },
    2: {
      name: 'Balanced (Med)',
      code: 'LVL 2',
      powerMult: 0.75,
      baseWatts: 285000, // ~14s total drain
      accelBonus: 0.095, // +9.5% longitudinal acceleration boost
      topSpeedBonusKmh: 11.0,
      baseTyreStress: 0.35
    },
    3: {
      name: 'Max Attack (High)',
      code: 'LVL 3',
      powerMult: 1.00,
      baseWatts: 400000, // ~10s total drain
      accelBonus: 0.150, // +15.0% longitudinal acceleration boost
      topSpeedBonusKmh: 18.0,
      baseTyreStress: 0.65
    }
  },

  // Cornering Penalty Factors
  cornerEfficiencyPenalty: 0.65, // In tight corners, up to +65% more energy burned per second
  cornerBoostDampening:    0.70, // In tight corners, useful acceleration boost is dampened by up to 70%
  cornerTyreStressFactor:  1.60  // Corner lateral load multiplies deployment tyre scrubbing stress
};

export class BatteryController {
  constructor(options = {}) {
    this.config = { ...BatteryConfig, ...options };

    this.maxEnergy = this.config.maxEnergyJoules;
    const startRatio = (options.startingChargeRatio !== undefined)
      ? options.startingChargeRatio
      : (this.config.startingEnergyJoules / this.maxEnergy);
    this.energy = Math.max(0, Math.min(this.maxEnergy, this.maxEnergy * startRatio));

    this.mode = BatteryMode.CHARGE;
    this.state = this.energy >= this.maxEnergy * this.config.fullChargeThreshold
      ? BatteryState.FULLY_CHARGED
      : BatteryState.CHARGING;
    this.powerLevel = BatteryPowerLevel.LEVEL_2; // Default to Level 2 (Balanced)

    // Dynamic runtime state
    this.isDeploying = false;
    this.isHarvesting = false;
    this.isDisengaging = false;
    this.disengageTimer = 0;
    this.smoothBoost = 0; // 0..1 smooth deployment multiplier

    // Tracking for statistics and commentary triggers
    this.hasDeployed = false;
    this.totalDeployedJoules = 0;
    this.totalRecoveredJoules = 0;
    this.lastState = this.state;
    this.lastEligibility = { eligible: false, context: 'NONE', reason: 'Initializing' };
    this.currentCorneringFactor = 0;
    this.currentTyreStress = 0;
    this.currentEffectiveBoost = 1.0;
  }

  /**
   * Energy state of charge as a percentage (0.0 to 100.0%).
   */
  get socPercent() {
    return Math.max(0, Math.min(100, (this.energy / this.maxEnergy) * 100));
  }

  get soc() {
    return this.socPercent;
  }

  get energyJoules() {
    return this.energy;
  }

  set energyJoules(v) {
    this.energy = Math.max(0, Math.min(this.maxEnergy, v));
    this._updateInternalState();
  }

  get maxEnergyJoules() {
    return this.maxEnergy;
  }

  get isFullyCharged() {
    return this.energy >= this.maxEnergy * this.config.fullChargeThreshold;
  }

  get isDepleted() {
    return this.energy <= 0.001;
  }

  /**
   * Set user/AI selected operating mode (CHARGE or ATTACK).
   *
   * @param {string} mode – 'CHARGE' | 'ATTACK'
   * @param {object} eligibility – current evaluated eligibility
   * @returns {boolean} Whether mode switch succeeded
   */
  setMode(mode, eligibility = null) {
    if (mode === BatteryMode.CHARGE) {
      this.mode = BatteryMode.CHARGE;
      this.isDeploying = false;
      this.isDisengaging = false;
      this.disengageTimer = 0;
      this.smoothBoost = 0;
      this._updateInternalState();
      return true;
    }

    if (mode === BatteryMode.ATTACK) {
      // Must meet full-charge requirement to unlock attack mode initially
      if (this.config.fullChargeRequired && !this.isFullyCharged && this.state !== BatteryState.ATTACK_READY && this.state !== BatteryState.DEPLOYING) {
        return false;
      }

      // Must not be empty
      if (this.isDepleted) {
        return false;
      }

      // Check eligibility if provided
      if (eligibility && !eligibility.eligible && !this.isDeploying) {
        return false;
      }

      this.mode = BatteryMode.ATTACK;
      this.hasDeployed = true;
      this.isDeploying = true;
      this._updateInternalState(eligibility);
      return true;
    }

    return false;
  }

  /**
   * Toggle between CHARGE and ATTACK modes.
   */
  toggleMode(eligibility = null) {
    if (this.mode === BatteryMode.CHARGE) {
      return this.setMode(BatteryMode.ATTACK, eligibility);
    } else {
      return this.setMode(BatteryMode.CHARGE, eligibility);
    }
  }

  /**
   * Set power level (1, 2, or 3).
   */
  setPowerLevel(level) {
    const l = parseInt(level, 10);
    if (l === 1 || l === 2 || l === 3) {
      this.powerLevel = l;
      return true;
    }
    return false;
  }

  /**
   * Single authoritative eligibility evaluator shared by HUD, AI, and race engine.
   *
   * @param {object}   car       – car state
   * @param {object[]} allCars   – full field of cars
   * @param {object}   track     – track geometry
   * @param {number}   simTime   – current race elapsed time (s)
   * @param {string}   raceFlag  – 'green' | 'yellow' | 'red' | 'safetycar' | 'vsc' | 'chequered'
   * @returns {object} { eligible, battleType, context, gapS, targetDriver, reason }
   */
  evaluateEligibility(car, allCars, track, simTime, raceFlag) {
    // 1. Race Control Safety & Status Restrictions
    if (raceFlag !== 'green') {
      const flagReasons = {
        yellow: 'Disabled: Yellow Flag in Sector',
        vsc: 'Disabled: Virtual Safety Car Delta Active',
        safetycar: 'Disabled: Safety Car Neutralization',
        red: 'Disabled: Red Flag Session Suspended',
        chequered: 'Disabled: Chequered Flag - Race Finished'
      };
      return {
        eligible: false,
        battleType: 'NONE',
        context: 'SAFETY_RESTRICTION',
        gapS: null,
        targetDriver: null,
        reason: flagReasons[raceFlag] || 'Disabled: Safety State'
      };
    }

    // 2. Wet weather safety (MGU-K high attack torque restricted in saturated standing water)
    if (car.aquaplaning || car.currentWetness > 0.85) {
      return {
        eligible: false,
        battleType: 'NONE',
        context: 'WET_RESTRICTION',
        gapS: null,
        targetDriver: null,
        reason: 'Disabled: Standing Water / Aquaplaning Risk'
      };
    }

    // 3. Pit lane limiter active
    if (car.pitSpeedLimit !== undefined && car.pitSpeedLimit !== null) {
      return {
        eligible: false,
        battleType: 'NONE',
        context: 'PIT_RESTRICTION',
        gapS: null,
        targetDriver: null,
        reason: 'Disabled: Pit Lane Speed Limiter Active'
      };
    }

    // 4. Calculate actual timing gaps to car ahead and car behind
    const L = track?.circuit?.lengthM || 5000;
    const avgV = Math.max(15, car.v || 45);
    const others = (allCars || []).filter(c => c !== car && !c.finished && (c.retiredLap == null || c.retiredLap === false));

    let carAhead = null;
    let minAheadDist = Infinity;
    let carBehind = null;
    let minBehindDist = Infinity;

    for (const o of others) {
      // Forward distance along track spline
      const fwdDist = (((o.d - car.d) % L) + L) % L;
      if (fwdDist > 0 && fwdDist < minAheadDist) {
        minAheadDist = fwdDist;
        carAhead = o;
      }

      // Backward distance along track spline
      const bwdDist = (((car.d - o.d) % L) + L) % L;
      if (bwdDist > 0 && bwdDist < minBehindDist) {
        minBehindDist = bwdDist;
        carBehind = o;
      }
    }

    const gapAheadS = carAhead ? Math.max(0, minAheadDist / avgV) : 99;
    const gapBehindS = carBehind ? Math.max(0, minBehindDist / Math.max(15, carBehind.v || avgV)) : 99;

    const isAttackEligible = carAhead !== null && gapAheadS < this.config.attackGapThreshold;
    const isDefendEligible = carBehind !== null && gapBehindS < this.config.defendGapThreshold;

    // Both eligible: prefer the most immediate, critical battle (smaller gap)
    if (isAttackEligible && isDefendEligible) {
      if (gapBehindS <= 1.2 || gapBehindS < gapAheadS * 0.5) {
        return {
          eligible: true,
          battleType: 'DEFENDING',
          context: `DEFENDING vs ${carBehind.code || 'Rival'} (+${gapBehindS.toFixed(1)}s)`,
          gapS: gapBehindS,
          targetDriver: carBehind.code,
          reason: `Eligible: Defending under pressure (${gapBehindS.toFixed(1)}s)`
        };
      } else {
        return {
          eligible: true,
          battleType: 'ATTACKING',
          context: `ATTACKING ${carAhead.code || 'Target'} (-${gapAheadS.toFixed(1)}s)`,
          gapS: gapAheadS,
          targetDriver: carAhead.code,
          reason: `Eligible: Attacking car ahead (${gapAheadS.toFixed(1)}s)`
        };
      }
    }

    // Only attacking eligible
    if (isAttackEligible) {
      return {
        eligible: true,
        battleType: 'ATTACKING',
        context: `ATTACKING ${carAhead.code || 'Target'} (-${gapAheadS.toFixed(1)}s)`,
        gapS: gapAheadS,
        targetDriver: carAhead.code,
        reason: `Eligible: In attack range (${gapAheadS.toFixed(1)}s < ${this.config.attackGapThreshold.toFixed(1)}s)`
      };
    }

    // Only defending eligible
    if (isDefendEligible) {
      return {
        eligible: true,
        battleType: 'DEFENDING',
        context: `DEFENDING vs ${carBehind.code || 'Rival'} (+${gapBehindS.toFixed(1)}s)`,
        gapS: gapBehindS,
        targetDriver: carBehind.code,
        reason: `Eligible: Defending position (${gapBehindS.toFixed(1)}s < ${this.config.defendGapThreshold.toFixed(1)}s)`
      };
    }

    // Neither eligible: provide precise feedback
    let failReason = 'ATTACK UNAVAILABLE — NO CAR IN RANGE';
    if (carBehind && (gapBehindS < gapAheadS || !carAhead)) {
      failReason = `DEFENCE UNAVAILABLE — GAP BEHIND ABOVE ${this.config.defendGapThreshold.toFixed(1)}s (+${gapBehindS.toFixed(1)}s)`;
    } else if (carAhead && gapAheadS >= this.config.attackGapThreshold) {
      failReason = `ATTACK UNAVAILABLE — GAP ABOVE ${this.config.attackGapThreshold.toFixed(1)}s (+${gapAheadS.toFixed(1)}s)`;
    } else if (carBehind && gapBehindS >= this.config.defendGapThreshold) {
      failReason = `DEFENCE UNAVAILABLE — GAP BEHIND ABOVE ${this.config.defendGapThreshold.toFixed(1)}s (+${gapBehindS.toFixed(1)}s)`;
    }

    return {
      eligible: false,
      battleType: 'NONE',
      context: 'INELIGIBLE',
      gapS: Math.min(gapAheadS, gapBehindS),
      targetDriver: null,
      reason: failReason
    };
  }

  /**
   * Advance battery simulation step.
   * Integrates energy drain, recovery, cornering efficiency, tyre stress, and disengagement.
   *
   * @param {number} dt             – time step (seconds)
   * @param {object} car            – car object
   * @param {object} track          – track object
   * @param {object} eligibility    – result from evaluateEligibility
   * @returns {object} { boostFactor, maxSpeedBonusMps, tyreWearMultiplier, isDeploying, state }
   */
  update(dt, car, track, eligibility = null) {
    if (dt <= 0) return this._getOutput();

    const spec = this.config.powerLevels[this.powerLevel] || this.config.powerLevels[2];

    // 1. Calculate continuous Cornering Factor (0.0 = Straight, 1.0 = Max Cornering)
    this.currentCorneringFactor = this._computeCorneringFactor(car, track);

    // 2. Evaluate Mode and Deployment Validity
    if (this.mode === BatteryMode.ATTACK) {
      if (this.isDepleted) {
        // Battery exhausted -> Automatic stop
        this.mode = BatteryMode.CHARGE;
        this.isDeploying = false;
        this.isDisengaging = false;
        this.smoothBoost = 0;
      } else if (!eligibility || eligibility.eligible) {
        // Fully valid deployment
        this.isDeploying = true;
        this.isDisengaging = false;
        this.disengageTimer = 0;
        // Smooth ramp up (0.25s ramp to prevent instantaneous jerk)
        this.smoothBoost = Math.min(1.0, this.smoothBoost + dt / 0.25);
      } else {
        // Ineligible gap while in attack mode: execute smooth disengagement
        if (this.isDeploying && !this.isDisengaging) {
          this.isDisengaging = true;
          this.disengageTimer = this.config.disengageDuration;
        }

        if (this.isDisengaging) {
          this.disengageTimer -= dt;
          this.smoothBoost = Math.max(0, this.disengageTimer / this.config.disengageDuration);
          if (this.disengageTimer <= 0) {
            this.isDeploying = false;
            this.isDisengaging = false;
            this.mode = BatteryMode.CHARGE;
            this.smoothBoost = 0;
          }
        } else {
          this.isDeploying = false;
          this.smoothBoost = 0;
        }
      }
    } else {
      this.isDeploying = false;
      this.isDisengaging = false;
      this.disengageTimer = 0;
      this.smoothBoost = Math.max(0, this.smoothBoost - dt / 0.25);
    }

    // 3. Energy Drain and Recovery Accounting
    if (this.isDeploying && this.smoothBoost > 0) {
      // Cornering efficiency penalty: aggressive deployment in corners drains energy faster
      const cornerDrainPenalty = 1.0 + this.currentCorneringFactor * this.config.cornerEfficiencyPenalty;
      const drainWatts = spec.baseWatts * cornerDrainPenalty * this.smoothBoost;
      const energyUsed = drainWatts * dt;

      this.energy = Math.max(0, this.energy - energyUsed);
      this.totalDeployedJoules += energyUsed;
      this.isHarvesting = false;

      if (this.isDepleted) {
        this.isDeploying = false;
        this.mode = BatteryMode.CHARGE;
        this.smoothBoost = 0;
      }
    } else {
      // 4. Energy Recovery in Charge Mode
      let harvestWatts = this.config.baseRecoveryWatts;

      // Regenerative braking harvesting from MGU-K
      if (car.brake > 0.15 && car.v > 12) {
        const brakeHarvest = this.config.brakingHarvestMax * Math.min(1.0, car.brake * 1.3) * Math.min(1.0, car.v / 60);
        harvestWatts += brakeHarvest;
        this.isHarvesting = true;
      } else {
        this.isHarvesting = false;
      }

      const recovered = harvestWatts * dt;
      this.energy = Math.min(this.maxEnergy, this.energy + recovered);
      this.totalRecoveredJoules += recovered;
    }

    // 5. Calculate Acceleration Boost & Top Speed Bonus
    // Straights vs Corners: acceleration boost is maximized on straights and reduced in corners
    const straightEfficiency = Math.max(0.15, 1.0 - this.currentCorneringFactor * this.config.cornerBoostDampening);
    const effectiveAccelBonus = spec.accelBonus * straightEfficiency * this.smoothBoost;
    this.currentEffectiveBoost = 1.0 + effectiveAccelBonus;

    const maxSpeedBonusMps = (spec.topSpeedBonusKmh / 3.6) * straightEfficiency * this.smoothBoost;

    // 6. Connect Deployment to Tyre Wear & Traction Stress
    // Higher torque under battery deployment accelerates tyre wear, especially in corners
    if (this.isDeploying && this.smoothBoost > 0 && car.throttle > 0.20) {
      const gripDeficit = Math.max(0, 1.0 - (car.currentGrip || 1.0));
      const cornerStress = this.currentCorneringFactor * this.config.cornerTyreStressFactor;
      this.currentTyreStress = spec.baseTyreStress * car.throttle * (1.0 + cornerStress) * (1.0 + gripDeficit * 1.5) * this.smoothBoost;
    } else {
      this.currentTyreStress = 0;
    }

    this._updateInternalState(eligibility);
    return this._getOutput(maxSpeedBonusMps);
  }

  /**
   * Compute smooth cornering factor (0.0 = pure straight, 1.0 = severe tight hairpin/corner).
   * Blends steering angle, lateral acceleration, and track curvature.
   */
  _computeCorneringFactor(car, track) {
    if (!car) return 0;

    // A. Local track curvature (kap)
    let localKap = 0;
    if (track && track.speedModel && Array.isArray(track.speedModel.kap) && track.speedModel.kap.length > 0) {
      const L = track.circuit?.lengthM || 5000;
      const N = track.speedModel.kap.length;
      const d = (((car.d % L) + L) % L);
      const idx = Math.floor((d / L) * N) % N;
      localKap = track.speedModel.kap[idx] || 0;
    }

    // B. Lateral load and steering angle
    const latAcc = Math.abs(car.latAcc || 0);
    const steer = Math.abs(car.steer || 0);

    // Continuous smooth combination without binary discontinuities
    const kapNorm = Math.min(1.0, localKap * 45);
    const latAccNorm = Math.min(1.0, latAcc / 32);
    const steerNorm = Math.min(1.0, steer * 1.2);

    return Math.max(0, Math.min(1.0, kapNorm * 0.45 + latAccNorm * 0.35 + steerNorm * 0.20));
  }

  /**
   * Update state machine according to operating rules.
   */
  _updateInternalState(eligibility = null) {
    this.lastState = this.state;

    if (this.isDepleted) {
      this.state = BatteryState.DEPLETED;
      this.mode = BatteryMode.CHARGE;
      this.isDeploying = false;
      this.isDisengaging = false;
      this.smoothBoost = 0;
      this.hasDeployed = true;
      return;
    }

    if (this.isDeploying) {
      this.state = BatteryState.DEPLOYING;
      return;
    }

    if (this.isFullyCharged) {
      if (eligibility && eligibility.eligible) {
        this.state = BatteryState.ATTACK_READY;
      } else if (this.mode === BatteryMode.ATTACK) {
        this.state = BatteryState.ATTACK_READY;
      } else {
        this.state = BatteryState.FULLY_CHARGED;
      }
      return;
    }

    if (this.mode === BatteryMode.ATTACK && (!eligibility || eligibility.eligible) && (!this.config.fullChargeRequired || this.state === BatteryState.ATTACK_READY)) {
      this.state = BatteryState.ATTACK_READY;
      return;
    }

    if ((this.hasDeployed || this.totalDeployedJoules > 0) && this.socPercent < 90) {
      this.state = BatteryState.RECHARGING_AFTER_DEPLOYMENT;
    } else {
      this.state = BatteryState.CHARGING;
    }
  }

  /**
   * Package output metrics for physics step.
   */
  _getOutput(maxSpeedBonusMps = 0) {
    // Tyre wear multiplier: expands existing tyreModel wearMultiplier cleanly
    // High deployment in corners increases tyre wear by up to +40-80%
    const tyreWearMultiplier = 1.0 + (this.currentTyreStress * 0.85);

    return {
      boostFactor: this.currentEffectiveBoost,
      maxSpeedBonusMps,
      tyreWearMultiplier,
      isDeploying: this.isDeploying,
      isHarvesting: this.isHarvesting,
      socPercent: this.socPercent,
      state: this.state,
      mode: this.mode,
      powerLevel: this.powerLevel,
      corneringFactor: this.currentCorneringFactor,
      tyreStress: this.currentTyreStress
    };
  }

  /**
   * Reset battery state during session restart.
   */
  reset(startingSoc = 0.85) {
    this.energy = this.maxEnergy * Math.max(0.05, Math.min(1.0, startingSoc));
    this.mode = BatteryMode.CHARGE;
    this.state = BatteryState.CHARGING;
    this.isDeploying = false;
    this.isDisengaging = false;
    this.disengageTimer = 0;
    this.smoothBoost = 0;
    this.totalDeployedJoules = 0;
    this.totalRecoveredJoules = 0;
    this._updateInternalState();
  }
}
