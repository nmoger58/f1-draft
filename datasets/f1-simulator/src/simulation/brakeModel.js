/**
 * brakeModel.js
 * Carbon-Carbon Brake System Thermal Simulation.
 *
 * Implements:
 *   - Operating window: 400°C to 850°C
 *   - Cold brake glazing penalty (< 250°C): 85% braking efficiency
 *   - Overheating brake fade penalty (> 1000°C): stopping distance extends up to 35%
 *   - Kinetic energy dissipation: rapid temperature rise proportional to brake force * speed²
 *   - Dynamic duct cooling: airflow cooling on straights proportional to vehicle speed
 */

export class BrakeModel {
  /**
   * @param {number} ambientTemp – air temperature in °C
   */
  constructor(ambientTemp = 25) {
    this.ambientTemp = ambientTemp;
    this.temp = 320; // Pre-heated to working temperature from formation lap
    this.fade = 0.0;
    this.peakTemp = 320;
  }

  /**
   * Advance brake thermal state for one physics tick.
   *
   * @param {number} dt       – time step (seconds)
   * @param {number} brake    – 0..1 brake application
   * @param {number} speedMps – vehicle speed
   * @returns {object} { temp, efficiency, isOverheating, isCold }
   */
  update(dt, brake, speedMps) {
    // 1. Friction heating: converts vehicle kinetic energy into thermal energy
    if (brake > 0.05 && speedMps > 5) {
      const energyRate = brake * Math.pow(speedMps / 50, 1.8) * 450; // °C/s at threshold
      this.temp = Math.min(1250, this.temp + energyRate * dt);
    }

    // 2. Airflow convective cooling through brake ducts
    const speedRatio = Math.max(0.2, speedMps / 40);
    const ductCoolingRate = 0.16 * speedRatio;
    const coolingDelta = (this.temp - this.ambientTemp) * ductCoolingRate * dt;
    this.temp = Math.max(this.ambientTemp, this.temp - coolingDelta);

    if (this.temp > this.peakTemp) this.peakTemp = this.temp;

    // 3. Braking Efficiency Calculation
    let efficiency = 1.0;

    // A. Cold brakes: carbon discs lack initial coefficient of friction
    if (this.temp < 250) {
      const coldDeficit = (250 - this.temp) / 200; // 0..1
      efficiency = Math.max(0.78, 1.0 - coldDeficit * 0.22);
    }
    // B. Overheating brake fade: disc and pad oxidation causes fading
    else if (this.temp > 950) {
      const heatExcess = (this.temp - 950) / 250; // 0..1
      this.fade = Math.min(0.40, heatExcess * 0.35);
      efficiency = Math.max(0.65, 1.0 - this.fade);
    } else {
      this.fade = Math.max(0, this.fade - 0.05 * dt);
      efficiency = 1.0;
    }

    return {
      temp: Math.round(this.temp),
      efficiency,
      isOverheating: this.temp > 950,
      isCold: this.temp < 250
    };
  }
}
