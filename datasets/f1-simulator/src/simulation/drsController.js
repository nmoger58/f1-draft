/**
 * drsController.js
 * Drag Reduction System (DRS) Controller.
 *
 * Handles:
 *  - Dynamic DRS zone detection and wrapping around circuit geometry
 *  - FIA rule evaluation: Green flag, Lap >= 2, Gap to ahead <= 1.0s
 *  - Safety suspension (Yellow flag, SC, VSC, heavy braking)
 *  - Manual user control for selected car vs autonomous deployment for opponents
 *  - Aerodynamic drag modification states
 */

import { SimConfig } from '../config/simulationConfig.js';

export class DRSController {
  /**
   * Evaluate DRS eligibility for a car.
   *
   * @param {object}   car       – car state
   * @param {object}   track     – track geometry with drsZones
   * @param {object[]} allCars   – field of cars
   * @param {number}   simTime   – current race time (s)
   * @param {string}   raceFlag  – 'green' | 'yellow' | 'red' | 'chequered'
   * @returns {object} { eligible, inZone, zone, reason, gapS }
   */
  static evaluate(car, track, allCars, simTime, raceFlag) {
    const L = track.circuit.lengthM;
    const dInLap = (((car.d % L) + L) % L);

    // Rule 1: Flag status & safety car / VSC
    if (raceFlag !== 'green') {
      const reasonMap = {
        yellow: 'Disabled: Yellow Flag',
        vsc: 'Disabled: Virtual Safety Car',
        safetycar: 'Disabled: Safety Car',
        red: 'Disabled: Race Suspended',
        chequered: 'Disabled: Race Finished'
      };
      return {
        eligible: false,
        inZone: false,
        zone: null,
        gapS: null,
        reason: reasonMap[raceFlag] || 'Disabled: Race Not Active'
      };
    }

    // Rule 1b: Wet track safety (FIA disables DRS in wet running)
    if (car.currentWetness > 0.22 || car.tyreModel?.compound === 'wet' || car.tyreModel?.compound === 'intermediate') {
      return {
        eligible: false,
        inZone: false,
        zone: null,
        gapS: null,
        reason: 'Disabled: Wet Track Conditions'
      };
    }

    // Rule 2: Lap requirement (FIA standard: enabled from Lap 2 onwards)
    if (car.lap < 2) {
      return {
        eligible: false,
        inZone: false,
        zone: null,
        gapS: null,
        reason: 'Disabled: Available from Lap 2'
      };
    }

    // Rule 3: Check if vehicle is inside any DRS activation zone
    const zones = track.drsZones || [];
    let currentZone = null;
    for (const z of zones) {
      if (z.startD <= z.endD) {
        if (dInLap >= z.startD && dInLap <= z.endD) {
          currentZone = z;
          break;
        }
      } else {
        // Zone wraps across the Start/Finish line (d=0)
        if (dInLap >= z.startD || dInLap <= z.endD) {
          currentZone = z;
          break;
        }
      }
    }

    if (!currentZone) {
      return {
        eligible: false,
        inZone: false,
        zone: null,
        gapS: null,
        reason: 'Outside DRS Zone'
      };
    }

    // Rule 4: Gap to car ahead must be <= 1.0s
    const others = allCars.filter(c => c !== car && !c.finished && c.retiredLap === null);
    let carAhead = null;
    let minGapM = Infinity;

    for (const o of others) {
      const gapM = (((o.d - car.d) % L) + L) % L;
      if (gapM > 0 && gapM < 250 && gapM < minGapM) {
        minGapM = gapM;
        carAhead = o;
      }
    }

    if (!carAhead) {
      return {
        eligible: false,
        inZone: true,
        zone: currentZone,
        gapS: null,
        reason: 'Leading in Zone (No car ahead)'
      };
    }

    const avgV = Math.max(10, (car.v + carAhead.v) / 2);
    const gapS = minGapM / avgV;
    const permittedGap = SimConfig.ai.drsGap || 1.0;

    if (gapS > permittedGap) {
      return {
        eligible: false,
        inZone: true,
        zone: currentZone,
        gapS,
        reason: `Gap > ${permittedGap.toFixed(1)}s (+${gapS.toFixed(2)}s)`
      };
    }

    // Car is in zone and within 1.0s gap
    return {
      eligible: true,
      inZone: true,
      zone: currentZone,
      gapS,
      reason: 'DRS Available (+ ' + gapS.toFixed(2) + 's)'
    };
  }

  /**
   * Update a car's active DRS state.
   * Ensures selected car is manually operated by the user, while AI cars operate autonomously.
   *
   * @param {object}  car            – car state
   * @param {boolean} isSelected     – whether this is the user's selected driver
   * @param {object}  eligibility    – result from DRSController.evaluate
   * @param {boolean} userManualReq  – user manual toggle state
   */
  static apply(car, isSelected, eligibility, userManualReq) {
    car.drsEligible = eligibility.eligible;
    car.inDrsZone   = eligibility.inZone;
    car.drsReason   = eligibility.reason;
    car.drsGapS     = eligibility.gapS;
    car.currentDrsZone = eligibility.zone;

    // Safety auto-close: if car brakes, leaves zone, or becomes ineligible
    if (!eligibility.eligible || car.brake > 0.05 || car.v < 15) {
      car.drsActive = false;
      return false;
    }

    if (isSelected) {
      // User manual control for selected driver:
      // DRS only opens if user has requested it AND car is legally eligible
      car.drsActive = eligibility.eligible && !!userManualReq;
    } else {
      // AI opponent: auto-opens when legally eligible
      car.drsActive = eligibility.eligible;
    }

    return car.drsActive;
  }
}
