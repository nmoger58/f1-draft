/**
 * pitStopManager.js
 * Comprehensive Pit Stop and Strategy Management System.
 *
 * Coordinates:
 *   - User manual pit requests ("BOX / PIT NOW")
 *   - Autonomous AI strategy pit requests
 *   - Safe pit entry navigation and late-request deferral
 *   - Pit lane speed limiter enforcement (80 km/h / 60 km/h at Monaco)
 *   - 2.4s stationary pit-box tyre service
 *   - Seamless pit exit and track re-entry
 */

import { TyreStrategy } from './tyreStrategy.js';
import { TyreModel } from '../simulation/tyreModel.js';
import { SimConfig } from '../config/simulationConfig.js';

export const PitStates = {
  READY:     'ready',       // Racing on track normally
  REQUESTED: 'requested',   // Pit requested by user or AI, waiting for in-lap entry
  IN_LAP:    'in_lap',      // On in-lap approaching pit commit threshold
  ENTERING:  'entering',    // Transiting pit entry, slowing down to pit limiter
  IN_LANE:   'in_lane',     // Driving down pit lane under 80 km/h limit
  SERVICING: 'servicing',   // Stationary in pit box for tyre change (2.4s)
  EXITING:   'exiting',     // Accelerating out of pit box towards pit exit
  OUT_LAP:   'out_lap',     // Rejoining track, merging back onto racing line
};

export class PitStopManager {
  /**
   * Request a pit stop for a car.
   *
   * @param {object} car             – car state
   * @param {string} targetCompound  – 'soft' | 'medium' | 'hard'
   * @param {object} track           – track geometry
   * @returns {object} { success: boolean, message: string }
   */
  static requestPit(car, targetCompound = 'medium', track) {
    if (car.pitState === PitStates.ENTERING ||
        car.pitState === PitStates.IN_LANE ||
        car.pitState === PitStates.SERVICING ||
        car.pitState === PitStates.EXITING) {
      return { success: false, message: `${car.code} is already in the pit lane!` };
    }

    const L = track.circuit.lengthM;
    const dInLap = (((car.d % L) + L) % L);
    const pitCommitD = L - 50; // Too close to S/F to safely dive into pit lane

    car.targetCompound = targetCompound.toLowerCase();
    car.pitRequested   = true;

    if (dInLap > pitCommitD && dInLap < L) {
      // Past safe entry threshold on current lap; defer to end of next lap
      car.pitLateRequest = true;
      car.pitState = PitStates.REQUESTED;
      return {
        success: true,
        message: `Radio: "Copy ${car.code}. Too late for pit entry this lap — staying out! Boxing end of next lap for ${car.targetCompound.toUpperCase()} tyres."`
      };
    }

    car.pitLateRequest = false;
    car.pitState = PitStates.REQUESTED;
    return {
      success: true,
      message: `Radio: "BOX, BOX, BOX! Confirming pit stop for ${car.code}. Fitting ${car.targetCompound.toUpperCase()} tyres."`
    };
  }

  /**
   * Cancel a pending pit request if car has not yet entered pit lane.
   */
  static cancelPit(car) {
    if (car.pitState === PitStates.REQUESTED || car.pitState === PitStates.IN_LAP) {
      car.pitRequested   = false;
      car.pitLateRequest = false;
      car.pitState       = PitStates.READY;
      return { success: true, message: `Radio: "Pit stop cancelled for ${car.code}. Stay out, push now!"` };
    }
    return { success: false, message: `Cannot cancel pit stop: ${car.code} already committed to pit lane.` };
  }

  /**
   * Update pit lane state machine and navigation for one physics step.
   *
   * @param {object}   car      – car state
   * @param {object}   track    – track geometry
   * @param {number}   dt       – elapsed seconds
   * @param {number}   simTime  – race elapsed time
   * @param {object[]} events   – event log array to push messages
   * @returns {object} { latTarget, speedLimitMps, isStationary }
   */
  static update(car, track, dt, simTime, events) {
    const L = track.circuit.lengthM;
    const k = track.k || 1;
    const dInLap = (((car.d % L) + L) % L);

    const pitEntryD = L - 140; // 140m before S/F
    const pitCommitD = L - 40; // Commit line
    const pitBoxD   = 0;       // At Start/Finish line
    const pitExitD  = 110;     // 110m after S/F

    // Pit lane runs along inside of track (anchored to track.pitLane offset)
    const pitSide = track.circuit.direction === 'anticlockwise' ? -1 : 1;
    const pitLatTarget = track.pitLane ? track.pitLane.offsetPx : (pitSide * (track.avgHalfWidth ? track.avgHalfWidth + 3.0 * k : 11.5 * k));
    const pitSpeedLimitMps = track.circuit.id === 'monaco' ? 16.7 : 22.2; // 60 km/h or 80 km/h

    // Default return values (normal racing)
    let latTarget = null;
    let speedLimitMps = null;
    let isStationary = false;

    // Check in-lap approach
    if (car.pitRequested && (car.pitState === PitStates.REQUESTED || car.pitState === PitStates.READY)) {
      if (dInLap >= pitEntryD - 200 && dInLap < pitEntryD) {
        car.pitState = PitStates.IN_LAP;
      }
    }

    // State 1: ENTERING pit lane
    if (car.pitRequested && (car.pitState === PitStates.IN_LAP || car.pitState === PitStates.REQUESTED)) {
      if (!car.pitLateRequest && (dInLap >= pitEntryD || dInLap < 20)) {
        car.pitState = PitStates.ENTERING;
        events.push({
          time: simTime,
          msg: `Radio: "${car.code} entering pit lane. Speed limiter ON (80 km/h)."`,
          type: 'pit'
        });
      }
    }

    // Reset late request flag when car begins its new lap
    if (car.pitLateRequest && dInLap >= 50 && dInLap < 200) {
      car.pitLateRequest = false;
    }

    // State: ENTERING or IN_LANE
    if (car.pitState === PitStates.ENTERING || car.pitState === PitStates.IN_LANE) {
      latTarget = pitLatTarget;
      speedLimitMps = pitSpeedLimitMps;

      // Approaching pit box (near d=0 or within 8m of S/F)
      if (dInLap >= L - 10 || dInLap <= 10) {
        car.pitState = PitStates.SERVICING;
        const mgrPitDelta = car.manager?.modifiers?.pitLossDelta ?? 0;
        const hasWingDamage = car.damage && car.damage.frontWing > 0.15;
        const wingRepairTime = hasWingDamage ? 8.2 : 0;
        car.pitServiceTimer = Math.max(1.75, 2.4 + mgrPitDelta + wingRepairTime);
        car._hadWingDamageInStop = hasWingDamage;

        const extraInfo = hasWingDamage ? ' + replacing damaged front wing' : '';
        events.push({
          time: simTime,
          msg: `🔧 ${car.code} stops at pit box! Fitting ${car.targetCompound.toUpperCase()} tyres${extraInfo}...`,
          type: 'pit'
        });
      }
    }

    // State: SERVICING (stationary at pit box)
    if (car.pitState === PitStates.SERVICING) {
      latTarget = pitLatTarget;
      speedLimitMps = 0;
      isStationary = true;
      car.v = 0;
      car.throttle = 0;
      car.brake = 1;

      car.pitServiceTimer = (car.pitServiceTimer ?? 2.4) - dt;

      if (car.pitServiceTimer <= 0) {
        // Tyre swap completed!
        const newCompound = car.targetCompound || 'medium';
        car.tyreStrategy = new TyreStrategy(newCompound, car.lap);
        car.tyreModel    = new TyreModel(newCompound, car.lap, { punctureOnWear: false });
        car.tyreWear     = 0;

        // Repair damage if present
        if (car.damage) {
          car.damage.frontWing = 0;
          car.damage.floor = 0;
          car.damage.sidepod = 0;
        }

        if (!car.compoundsUsed) car.compoundsUsed = new Set();
        car.compoundsUsed.add(newCompound);
        car.pitstops     = (car.pitstops || 0) + 1;
        car.pitState     = PitStates.EXITING;

        const wingReport = car._hadWingDamageInStop ? ' (Front wing replaced)' : '';
        events.push({
          time: simTime,
          msg: `✅ ${car.code} pit service complete${wingReport}! Leaving on fresh ${newCompound.toUpperCase()} tyres.`,
          type: 'pit'
        });
        car._hadWingDamageInStop = false;
      }
    }

    // State: EXITING (driving out to pit exit)
    if (car.pitState === PitStates.EXITING) {
      latTarget = pitLatTarget;
      speedLimitMps = pitSpeedLimitMps;

      if (dInLap >= pitExitD) {
        // Cross pit exit line
        car.pitState = PitStates.OUT_LAP;
        car.pitRequested = false;
        speedLimitMps = null;
        events.push({
          time: simTime,
          msg: `Radio: "${car.code} pit exit clear. Limiter OFF — rejoining racing line!"`,
          type: 'pit'
        });
      }
    }

    // State: OUT_LAP (merging back onto track)
    if (car.pitState === PitStates.OUT_LAP) {
      // Smoothly blend back to normal racing line over next 80m
      if (dInLap >= pitExitD + 80 || dInLap < pitExitD) {
        car.pitState = PitStates.READY;
      }
    }

    return { latTarget, speedLimitMps, isStationary };
  }
}
