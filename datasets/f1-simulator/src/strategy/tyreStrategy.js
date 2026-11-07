/**
 * tyreStrategy.js
 * Models tyre wear, performance, and pit-stop timing decisions.
 * Data-informed by the pit_stops.csv dataset patterns.
 */

import { SimConfig } from '../config/simulationConfig.js';

const compounds = SimConfig.tyres.compounds;

export class TyreStrategy {
  /**
   * @param {string} compound – 'soft' | 'medium' | 'hard'
   * @param {number} startLap
   */
  constructor(compound, startLap = 0) {
    this.compound = compound;
    this.startLap = startLap;
    this.wear = 0;       // 0 = new, 1 = worn out
    this.age  = 0;       // laps on this set
  }

  /** Degrade tyres by one lap. Returns performance delta (negative = slower) */
  stepLap(car) {
    const spec = compounds[this.compound];
    // Degradation scaled by driver tyre management skill
    const skill = car.driver?.personality?.tyreManagement ?? 0.75;
    const deg = spec.degradPerLap * (1.2 - skill * 0.4);
    this.wear = Math.min(1, this.wear + deg);
    this.age++;
    // Performance: compound bonus fades as tyres wear
    const perfPct = Math.max(0, 1 - this.wear);
    return spec.perfBonus * perfPct - this.wear * 0.04;
  }

  /** Returns a pace multiplier 0..1 */
  get perfMultiplier() {
    const spec = compounds[this.compound];
    return Math.max(0.7, 1 + spec.perfBonus * Math.max(0, 1 - this.wear) - this.wear * 0.04);
  }

  /** Should we pit? Decision based on wear and strategy window. */
  shouldPit(currentLap, totalLaps, position, nCars) {
    if (this.wear < SimConfig.tyres.criticalWear * 0.7) return false;
    if (currentLap < SimConfig.tyres.pitWindowOpen) return false;
    if (currentLap > totalLaps - 6) return false; // too late to benefit
    // Adjust for race position: leaders pit slightly later
    const positionBias = 1 - (position / nCars) * 0.15;
    return this.wear > SimConfig.tyres.criticalWear * positionBias;
  }

  /** Choose next compound to fit */
  static nextCompound(currentCompound, lapsRemaining) {
    if (lapsRemaining < 15) return 'soft';
    if (currentCompound === 'soft') return 'medium';
    return 'hard';
  }

  get label() {
    const labels = { soft: 'S', medium: 'M', hard: 'H', intermediate: 'I', wet: 'W' };
    return labels[this.compound] || '?';
  }

  get colour() {
    return compounds[this.compound]?.colour || '#888';
  }

  get wearPct() {
    return Math.round(this.wear * 100);
  }
}

/** Assign starting compounds staggered across the grid for variety */
export function assignStartingCompounds(cars) {
  const pools = ['soft', 'medium', 'medium', 'hard', 'soft', 'medium', 'hard', 'soft', 'medium', 'hard'];
  cars.forEach((car, i) => {
    car.tyreStrategy = new TyreStrategy(pools[i % pools.length]);
    car.tyreWear = 0;
  });
}
