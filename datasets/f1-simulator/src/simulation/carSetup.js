/**
 * carSetup.js
 * Authoritative Formula 1 Vehicle Setup & Aerodynamic Tuning Model (Phase 10).
 *
 * Implements physically consistent setup trade-offs across:
 *   1. Front Wing (0..10): Front downforce vs aerodynamic drag
 *   2. Rear Wing (0..10): High-speed cornering grip vs terminal straight-line speed
 *   3. Suspension Stiffness (1..5): Low-speed mechanical grip & kerb compliance vs high-speed roll control
 *   4. Ride Height (1..5): Ground-effect underfloor suction vs plank scrubbing on kerbs
 *   5. Brake Bias (50%..62% Front): Front braking stability vs rear car rotation & lockup tendencies
 *   6. Differential Lock (50%..90%): Traction acceleration out of slow corners vs turn-in understeer
 *   7. Tyre Pressures (21.5..25.5 psi): Contact patch grip vs rolling resistance & tyre carcass temperatures
 */

export const DEFAULT_CAR_SETUP = Object.freeze({
  frontWing: 6,         // 0 (Monza low aero) to 10 (Monaco high downforce)
  rearWing: 6,          // 0 to 10
  suspension: 3,        // 1 (soft) to 5 (stiff)
  rideHeight: 3,        // 1 (lowest, max ground effect) to 5 (highest, high kerb clearance)
  brakeBias: 56,        // % front (52% to 62%)
  differential: 70,     // % on-throttle lock (50% to 90%)
  tyrePressurePsi: 23.0 // 21.5 to 25.0 psi
});

export class CarSetup {
  /**
   * @param {object} [customConfig]
   */
  constructor(customConfig = {}) {
    this.frontWing = Math.max(0, Math.min(10, customConfig.frontWing ?? DEFAULT_CAR_SETUP.frontWing));
    this.rearWing = Math.max(0, Math.min(10, customConfig.rearWing ?? DEFAULT_CAR_SETUP.rearWing));
    this.suspension = Math.max(1, Math.min(5, customConfig.suspension ?? DEFAULT_CAR_SETUP.suspension));
    this.rideHeight = Math.max(1, Math.min(5, customConfig.rideHeight ?? DEFAULT_CAR_SETUP.rideHeight));
    this.brakeBias = Math.max(50, Math.min(62, customConfig.brakeBias ?? DEFAULT_CAR_SETUP.brakeBias));
    this.differential = Math.max(50, Math.min(90, customConfig.differential ?? DEFAULT_CAR_SETUP.differential));
    this.tyrePressurePsi = Math.max(21.0, Math.min(26.0, customConfig.tyrePressurePsi ?? DEFAULT_CAR_SETUP.tyrePressurePsi));

    this._computeModifiers();
  }

  /**
   * Recompute physical multipliers derived from setup trade-offs.
   * @private
   */
  _computeModifiers() {
    // 1. Aerodynamic Downforce: Front & Rear Wing + Ride Height Ground Effect
    // Baseline is setup 5/5
    const frontWingDelta = (this.frontWing - 5) * 0.015; // ±7.5% front aero
    const rearWingDelta = (this.rearWing - 5) * 0.022;   // ±11.0% rear aero
    const groundEffectDelta = (3 - this.rideHeight) * 0.018; // Lower ride height = stronger underfloor venturi

    this.downforceMult = Math.max(0.85, Math.min(1.20, 1.0 + frontWingDelta + rearWingDelta + groundEffectDelta));

    // Aero balance: ratio of front to rear downforce (0.45 to 0.55 optimal)
    this.aeroBalance = 0.50 + (frontWingDelta - rearWingDelta) * 0.5;

    // 2. Aerodynamic Drag: higher wings & ground effect induce induced drag
    const wingDrag = (this.frontWing * 0.008) + (this.rearWing * 0.016);
    this.dragMult = Math.max(0.88, Math.min(1.25, 0.88 + wingDrag));

    // 3. Terminal Velocity Delta: drag decreases top speed; low drag adds straight-line speed
    this.topSpeedDeltaMps = ((1.0 - this.dragMult) * 12.0); // ±2.5 m/s (~9 km/h)

    // 4. Mechanical Grip & Kerb Compliance (Suspension)
    // Soft suspension (1-2) absorbs kerbs cleanly and improves low-speed traction (+3%)
    // Stiff suspension (4-5) sharpens steering response and stabilizes aero platform at high speed (+3%)
    this.kerbCompliance = 1.0 + (3 - this.suspension) * 0.06;
    this.mechanicalGripMult = 1.0 + (3 - this.suspension) * 0.015;
    this.steeringSharpness = 1.0 + (this.suspension - 3) * 0.04;

    // 5. Plank Scrubbing Penalty: running lowest ride height (1) on high kerbs risks bottoming out
    this.bottomingRisk = Math.max(0, (2 - this.rideHeight) * 0.5);

    // 6. Brake Balance (Brake Bias)
    // Front bias (57-62%): stable straight-line braking, higher risk of front wheel lockup (understeer)
    // Rear bias (50-54%): aids corner turn-in rotation, higher risk of rear snap oversteer
    this.frontBrakeBiasRatio = this.brakeBias / 100.0;
    this.rearBrakeBiasRatio = 1.0 - this.frontBrakeBiasRatio;

    // 7. On-Throttle Traction & Turn-in (Differential)
    // High lock (80-90%): maximum straight-line traction out of slow corners, slight turn-in understeer
    // Low lock (50-65%): easy turn-in rotation, slight inside wheelspin on high-power exit
    this.tractionLockMult = 0.95 + (this.differential / 100.0) * 0.10; // 1.00 to 1.04x
    this.turnInAgility = 1.05 - (this.differential / 100.0) * 0.08;

    // 8. Tyre Pressure Effects
    // Lower pressure (21.5 psi): larger contact patch, higher mechanical grip (+1.5%), higher tyre temp build (+10%)
    // Higher pressure (25.5 psi): smaller contact patch, lower rolling resistance, lower temps (-8%)
    const pressDelta = this.tyrePressurePsi - 23.0;
    this.tyreGripMod = 1.0 - pressDelta * 0.008;
    this.tyreTempRateMod = 1.0 - pressDelta * 0.04;
    this.rollingResistanceMod = 1.0 + pressDelta * 0.015;
  }

  /**
   * Apply setup tuning to a car.
   * @param {object} car
   */
  applyToCar(car) {
    car.setup = this;
    car.setupModifiers = {
      downforceMult: this.downforceMult,
      dragMult: this.dragMult,
      topSpeedDeltaMps: this.topSpeedDeltaMps,
      mechanicalGripMult: this.mechanicalGripMult,
      kerbCompliance: this.kerbCompliance,
      steeringSharpness: this.steeringSharpness,
      frontBrakeBiasRatio: this.frontBrakeBiasRatio,
      rearBrakeBiasRatio: this.rearBrakeBiasRatio,
      tractionLockMult: this.tractionLockMult,
      tyreGripMod: this.tyreGripMod,
      tyreTempRateMod: this.tyreTempRateMod
    };
  }

  /**
   * Summary for UI display and telemetry.
   */
  getSummary() {
    return {
      aeroPackage: this.rearWing >= 8 ? 'High Downforce' : (this.rearWing <= 3 ? 'Low Drag' : 'Balanced Aero'),
      topSpeedEffect: `${this.topSpeedDeltaMps > 0 ? '+' : ''}${(this.topSpeedDeltaMps * 3.6).toFixed(1)} km/h`,
      downforcePct: `${Math.round(this.downforceMult * 100)}%`,
      brakeBiasFront: `${this.brakeBias}% Front`,
      diffLock: `${this.differential}% Lock`,
      pressures: `${this.tyrePressurePsi.toFixed(1)} PSI`
    };
  }
}
