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
    this.frontTemp = 340; // Front discs take higher load
    this.rearTemp = 300;  // Rear discs
    this.temp = 320;      // Overall mean temperature
    this.fade = 0.0;
    this.frontFade = 0.0;
    this.rearFade = 0.0;
    this.peakTemp = 340;
    this.brakeBias = 0.58; // 58% front / 42% rear default brake bias
  }

  /**
   * Advance brake thermal state for one physics tick.
   *
   * @param {number} dt       – time step (seconds)
   * @param {number} brake    – 0..1 brake application
   * @param {number} speedMps – vehicle speed
   * @returns {object} { temp, frontTemp, rearTemp, efficiency, isOverheating, isCold, frontFade, rearFade }
   */
  update(dt, brake, speedMps) {
    const speedRatio = Math.max(0.2, speedMps / 40);
    const ductCoolingRate = 0.16 * speedRatio;

    // 1. Friction heating split by brake bias (58% front, 42% rear)
    if (brake > 0.05 && speedMps > 5) {
      const baseEnergyRate = brake * Math.pow(speedMps / 50, 1.8) * 450;
      const frontEnergyRate = baseEnergyRate * (this.brakeBias / 0.50);
      const rearEnergyRate = baseEnergyRate * ((1.0 - this.brakeBias) / 0.50);

      this.frontTemp = Math.min(1250, this.frontTemp + frontEnergyRate * dt);
      this.rearTemp = Math.min(1250, this.rearTemp + rearEnergyRate * dt);
    }

    // 2. Airflow convective cooling through brake ducts
    const frontCoolingDelta = (this.frontTemp - this.ambientTemp) * ductCoolingRate * dt;
    const rearCoolingDelta = (this.rearTemp - this.ambientTemp) * ductCoolingRate * dt;
    this.frontTemp = Math.max(this.ambientTemp, this.frontTemp - frontCoolingDelta);
    this.rearTemp = Math.max(this.ambientTemp, this.rearTemp - rearCoolingDelta);

    this.temp = Math.round(this.frontTemp * this.brakeBias + this.rearTemp * (1 - this.brakeBias));
    if (this.frontTemp > this.peakTemp) this.peakTemp = this.frontTemp;

    // 3. Braking Efficiency Calculation (Front & Rear)
    const calcDiscEff = (discTemp) => {
      let eff = 1.0;
      let fade = 0.0;
      if (discTemp < 250) {
        const coldDeficit = (250 - discTemp) / 200;
        eff = Math.max(0.78, 1.0 - coldDeficit * 0.22);
      } else if (discTemp > 950) {
        const heatExcess = (discTemp - 950) / 250;
        fade = Math.min(0.40, heatExcess * 0.35);
        eff = Math.max(0.65, 1.0 - fade);
      }
      return { eff, fade };
    };

    const frontRes = calcDiscEff(this.frontTemp);
    const rearRes = calcDiscEff(this.rearTemp);

    this.frontFade = frontRes.fade;
    this.rearFade = rearRes.fade;
    this.fade = Math.max(this.frontFade, this.rearFade);

    const overallEfficiency = Number((frontRes.eff * this.brakeBias + rearRes.eff * (1 - this.brakeBias)).toFixed(3));

    return {
      temp: this.temp,
      frontTemp: Math.round(this.frontTemp),
      rearTemp: Math.round(this.rearTemp),
      efficiency: overallEfficiency,
      frontEfficiency: frontRes.eff,
      rearEfficiency: rearRes.eff,
      frontFade: this.frontFade,
      rearFade: this.rearFade,
      isOverheating: this.frontTemp > 950 || this.rearTemp > 950,
      isCold: this.frontTemp < 250
    };
  }
}
