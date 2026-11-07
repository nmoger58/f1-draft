/**
 * physicsEngine.js
 * Comprehensive Vehicle Physics Engine.
 *
 * Implements:
 *   - Fixed-step numerical integration
 *   - Integrated Tyre Grip & Thermal dynamics
 *   - Fuel Mass depletion & ERS hybrid power
 *   - Carbon Brake thermal fade & cold glazing
 *   - Aerodynamic wake: Downforce loss in Dirty Air & Drag reduction in Slipstream
 *   - Dynamic grip limits with progressive understeer sliding when over-driven
 *   - Pit limiter enforcement & stationary pit stop handling
 */

import { SimConfig } from '../config/simulationConfig.js';
import { sampleTrack, minSpeedAhead, maxSafeSpeedAhead } from './trackManager.js';

const cfg = SimConfig.physics;
const FIXED_DT = cfg.fixedStep;

/**
 * Advance a single car's physics by dt seconds.
 *
 * @param {object} car          – mutable car state
 * @param {object} track        – track geometry
 * @param {number} dt           – real elapsed seconds
 * @param {number} targetLat    – target lateral offset (SVG px) from AI
 * @param {number} paceFactor   – driver base pace scalar
 * @param {number} ramp         – warm-up ramp 0..1 for race start
 * @param {number} trackWetness – local surface wetness (0..1)
 * @param {number} trackTemp    – local track temperature (°C)
 */
export function stepCar(car, track, dt, targetLat, paceFactor, ramp, trackWetness = 0, trackTemp = 30, localTrackGrip = 1.0) {
  car._physRem = (car._physRem || 0) + dt;
  while (car._physRem >= FIXED_DT) {
    car._physRem -= FIXED_DT;
    _fixedStep(car, track, FIXED_DT, targetLat, paceFactor, ramp, trackWetness, trackTemp, localTrackGrip);
  }
}

function _fixedStep(car, track, dt, targetLat, paceFactor, ramp, trackWetness, trackTemp, localTrackGrip = 1.0) {
  const L = track.circuit.lengthM;

  // 1. Advance Fuel & Mass Model
  let massPaceFactor = 1.0;
  let ersBoost = 1.0;
  if (car.fuelModel) {
    const fuelState = car.fuelModel.update(dt, car.throttle, car.brake, car.v);
    massPaceFactor = fuelState.massPaceFactor;
    ersBoost = fuelState.ersBoost;
    car.fuelKg = fuelState.fuelKg;
    car.isOutOfFuel = fuelState.isOut;
  }

  // 1b. Advance Battery Energy & Deployment Model
  let batteryOutput = { boostFactor: 1.0, maxSpeedBonusMps: 0, tyreWearMultiplier: 1.0, isDeploying: false };
  if (car.batteryController) {
    batteryOutput = car.batteryController.update(dt, car, track, car.batteryEligibility);
    car.batteryOutput = batteryOutput;
    car.ersSoc = Math.round(batteryOutput.socPercent);
    if (car.fuelModel) {
      car.fuelModel.batterySoc = batteryOutput.socPercent / 100;
    }
  }

  // 2. Advance Brake Thermal Model
  let brakeEfficiency = 1.0;
  if (car.brakeModel) {
    const brakeState = car.brakeModel.update(dt, car.brake, car.v);
    brakeEfficiency = brakeState.efficiency;
    car.brakeTemp = brakeState.temp;
  }

  // 3. Advance Tyre Model & Available Grip
  let gripFactor = 1.0;
  if (car.tyreModel) {
    const wearScalar = (car.carModel?.modifiers?.tyreWearMult ?? 1.0) *
      (car.manager?.modifiers?.tyreDegMult ?? 1.0) *
      (batteryOutput.tyreWearMultiplier ?? 1.0);
    car.tyreModel.wearMultiplier = wearScalar;
    const gripEval = car.tyreModel.update(
      dt,
      car.v,
      car.latAcc || 0,
      car.acc || 0,
      trackWetness,
      trackTemp,
      car.driver?.personality?.tyreManagement ?? 0.75,
      {
        isWheelspinning: !!car.isWheelspinning,
        inDirtyAir: !!car.aeroState?.inDirtyAir,
        brake: car.brake || 0
      }
    );
    gripFactor = gripEval.totalGrip * (localTrackGrip || 1.0);
    car.tyreWear = gripEval.wear;
    car.tyreTemp = gripEval.temp;
    car.tyreSurfaceTemp = gripEval.surfaceTemp ?? gripEval.temp;
    car.tyreCarcassTemp = gripEval.carcassTemp ?? gripEval.temp;
    car.tyreAxles = gripEval.axles;
    car.tyreCorners = gripEval.corners;
    car.aquaplaning = gripEval.aquaplaning;
    car.currentGrip = gripFactor;
  }

  // 4. Aerodynamic Wake, Setup Downforce & Drag
  if (!car.damage) {
    car.damage = { frontWing: 0.0, floor: 0.0, sidepod: 0.0 };
  }
  const damageDfLoss = (car.damage.frontWing * 0.22) + (car.damage.floor * 0.12);
  const damageDragInc = (car.damage.frontWing * 0.08);

  const carDfMult     = car.carModel?.modifiers?.downforceMult ?? 1.0;
  const carDragMult   = car.carModel?.modifiers?.dragMult ?? 1.0;
  const setupDfMult   = car.setupModifiers?.downforceMult ?? 1.0;
  const setupDragMult = car.setupModifiers?.dragMult ?? 1.0;
  const setupTopSpeedBonus = car.setupModifiers?.topSpeedDeltaMps ?? 0.0;
  const setupMechGrip = car.setupModifiers?.mechanicalGripMult ?? 1.0;
  const setupTractionLock = car.setupModifiers?.tractionLockMult ?? 1.0;

  const downforceMult = Math.max(0.55, (car.aeroState?.downforceMult ?? 1.0) * carDfMult * setupDfMult * (1.0 - damageDfLoss));
  const aeroDragMult  = (car.aeroState?.dragMult ?? (car.drsActive ? 0.72 : 1.0)) * carDragMult * setupDragMult * (1.0 + damageDragInc);
  let dragCoeff = cfg.accelFalloff * aeroDragMult;
  if (car.tyreModel?.punctured) {
    dragCoeff *= 2.2; // heavy rolling resistance from shredded tyre carcass
  }

  // 5. Speed Planning & Kinematic Braking Zones
  // Corner speed limit is physically governed by tyre grip, front-end dirty air loss, and aerodynamic downforce
  const frontGripLoss = car.aeroState?.frontGripLoss ?? 0.0;
  const effectiveGrip = Math.max(0.20, (gripFactor - frontGripLoss) * setupMechGrip * Math.sqrt(downforceMult));
  const gripSpeedScale = Math.sqrt(effectiveGrip);

  const massFactor = car.fuelModel ? (798 / car.fuelModel.massKg) : 1.0;
  const aBrakeCap = cfg.brakeDecel * brakeEfficiency * massFactor * Math.min(1.0, gripFactor * setupMechGrip);

  // Look-ahead distance required to brake safely to upcoming corners
  const lookM = Math.max(30, (car.v * car.v) / (2 * Math.max(10, aBrakeCap * 0.85)) + 15);
  const safeKinematicV = maxSafeSpeedAhead(track, car.d, lookM, aBrakeCap * 0.86, gripSpeedScale);

  // Lift-and-coast fuel saving evaluation ahead of upcoming braking zones
  const isApproachingBrakingZone = safeKinematicV < car.v - 6.0;
  if (isApproachingBrakingZone && car.fuelModel) {
    car.fuelModel.shouldLiftAndCoast(lookM * 0.5, car.lap || 1, car.v);
  } else if (car.fuelModel) {
    car.fuelModel.isLiftingAndCoasting = false;
  }
  car.isLiftingAndCoasting = car.fuelModel?.isLiftingAndCoasting || false;

  const { v: targetV } = sampleTrack(track, car.d);

  const maxSpeedBonus = (car.carModel?.modifiers?.maxSpeedBonus ?? 0) + (batteryOutput.maxSpeedBonusMps ?? 0) + setupTopSpeedBonus;
  const effectiveMaxSpeed = cfg.maxSpeed + maxSpeedBonus;

  // Pit limiter override
  let speedCap = car.pitSpeedLimit !== undefined && car.pitSpeedLimit !== null
    ? car.pitSpeedLimit
    : effectiveMaxSpeed;

  // Race Control VSC / Safety Car field speed limit
  if (car.rcSpeedLimit !== undefined && car.rcSpeedLimit !== null) {
    speedCap = Math.min(speedCap, car.rcSpeedLimit);
  }

  // Limp mode if out of fuel
  if (car.isOutOfFuel) {
    speedCap = Math.min(speedCap, 8.5); // ~30 km/h crawl to pit
  }

  // Limp mode if tyre punctured
  if (car.tyreModel?.punctured) {
    speedCap = Math.min(speedCap, 15.0); // ~54 km/h crawl to pit
    car.drsActive = false;
  }

  // Desired speed accounts for kinematic braking limit, target track speed, DRS, and single-pass paceFactor
  const drsSpeedBonus = car.drsActive ? 1.055 : 1.0;
  const rawCornerDesired = Math.min(targetV * gripSpeedScale, safeKinematicV);
  let baseDesiredV = rawCornerDesired * paceFactor * ramp * drsSpeedBonus;

  // Fully Degraded Tyre Performance Penalty:
  // When tyre wear reaches 100% (wear >= 1.0), limit achievable speed to 75% (25% reduction)
  if (car.tyreModel && car.tyreModel.wear >= 1.0) {
    baseDesiredV *= 0.75;
    speedCap = Math.min(speedCap, effectiveMaxSpeed * 0.75);
  }

  const desiredV = Math.max(car.pitStationary ? 0 : cfg.minSpeed, Math.min(speedCap, baseDesiredV));
  car.desiredV = desiredV;

  // 6. Longitudinal Acceleration & Traction / Wheelspin Limits
  const carAccelMult = car.carModel?.modifiers?.accelMult ?? 1.0;
  const overtakeBoost = (car.drsActive && car.manager?.modifiers?.overtakePace) ? (1.0 + car.manager.modifiers.overtakePace) : 1.0;
  const batteryBoost = batteryOutput.boostFactor ?? 1.0;
  let acc = 0;
  if (car.pitStationary) {
    car.v = 0;
    car.throttle = 0;
    car.brake = 1;
    acc = 0;
    car.wheelspin = 0;
    car.isWheelspinning = false;
  } else if (car.isLiftingAndCoasting && car.v > 35) {
    // Lift and Coast: lift throttle before braking zone to save fuel with minimal lap time penalty
    acc = -Math.max(1.5, dragCoeff * car.v * 0.6);
    car.throttle = 0;
    car.brake = 0;
    car.wheelspin = 0;
    car.isWheelspinning = false;
  } else if (car.v < desiredV) {
    const rawAcc = Math.max(3, (cfg.accelMax * carAccelMult * overtakeBoost * (car.drsActive ? 1.04 : 1.0) * batteryBoost * ersBoost * massPaceFactor) - dragCoeff * car.v);
    
    // Physics-based traction limit on rear axle
    const vehicleMassKg = car.fuelModel ? car.fuelModel.massKg : 798;
    const rearAeroDownforceN = 0.5 * 1.225 * Math.pow(car.v, 2) * 1.8 * downforceMult;
    const rearAxleLoadN = (vehicleMassKg * 9.81 * 0.55) + (rearAeroDownforceN * 0.60);
    const maxTractionForceN = rearAxleLoadN * effectiveGrip * 1.45 * setupTractionLock;
    const maxTractionAcc = maxTractionForceN / vehicleMassKg;

    let targetAcc = Math.min(rawAcc, (desiredV - car.v) / dt);
    if (targetAcc > maxTractionAcc) {
      // Wheelspin occurs: slip limits achievable forward force
      const excessTorqueRatio = targetAcc / maxTractionAcc;
      car.wheelspin = Math.min(1.0, (excessTorqueRatio - 1.0) * 0.65);
      car.isWheelspinning = car.wheelspin > 0.08;
      targetAcc = maxTractionAcc * (1.0 - car.wheelspin * 0.15); // Traction loss under slip
    } else {
      car.wheelspin = 0;
      car.isWheelspinning = false;
    }

    acc = targetAcc;
    car.throttle = Math.min(1, acc / Math.max(1, rawAcc));
    car.brake = 0;
  } else {
    // Deceleration limited by brake efficiency, vehicle mass, and tyre grip
    acc = -Math.min(aBrakeCap, (car.v - desiredV) / dt);
    car.throttle = 0;
    car.brake = Math.min(1, -acc / Math.max(1, aBrakeCap));
    car.wheelspin = 0;
    car.isWheelspinning = false;
  }

  car.acc = acc;
  car.longitudinalAcc = acc;

  // Pitch & Roll approximation from dynamic weight transfer
  car.pitch = (acc / 9.81) * 0.083; // Forward pitch under braking, squat under acceleration
  car.roll = ((car.latAcc || 0) / 9.81) * (0.16 / (car.setupModifiers?.kerbCompliance || 1.0));

  // Safety auto-close: touching the brake snaps DRS rear wing shut
  if (car.brake > 0.05 && car.drsActive) {
    car.drsActive = false;
  }

  // 7. Velocity & Distance Integration
  if (!car.pitStationary) {
    const safeAcc = (typeof acc === 'number' && !isNaN(acc)) ? acc : 0;
    const safeV = (typeof car.v === 'number' && !isNaN(car.v)) ? car.v : 0;
    car.v = Math.max(0, Math.min(effectiveMaxSpeed, safeV + safeAcc * dt));
    car.prevD = (typeof car.d === 'number' && !isNaN(car.d)) ? car.d : 0;
    car.d = car.prevD + car.v * dt;
  } else {
    car.prevD = (typeof car.d === 'number' && !isNaN(car.d)) ? car.d : 0;
  }

  // 8. Lateral Movement & Combined Slip (Pacejka Friction Ellipse)
  const latDiff = targetLat - car.lat;
  const maxLatStep = 18 * dt; // SVG px per second under full grip

  // Friction circle: Heavy braking or throttle reduces available lateral grip
  let longGripRatio = 0;
  if (acc < 0) {
    longGripRatio = Math.min(1.0, -acc / Math.max(1, aBrakeCap));
  } else if (car.isWheelspinning) {
    longGripRatio = Math.min(1.0, car.wheelspin);
  }
  const frictionEllipseScale = Math.sqrt(Math.max(0.18, 1.0 - Math.pow(longGripRatio * 0.92, 2)));

  // If vehicle exceeds available grip in a corner, it suffers understeer drift
  let effectiveLatStep = maxLatStep * Math.min(1.2, gripFactor * setupMechGrip) * frictionEllipseScale;

  // Brake Lockup Detection: heavy braking with aggressive steering demands exceeds front tyre threshold
  const frontBias = car.setupModifiers?.frontBrakeBiasRatio ?? 0.56;
  if (longGripRatio > 0.88 && Math.abs(latDiff) > 1.8 * (track.k || 1) && frontBias > 0.54) {
    car.isFrontLocked = true;
    effectiveLatStep *= 0.52; // Front wheel lockup causes understeer wash-out
    if (car.tyreModel) {
      car.tyreModel.flatSpot = Math.min(1.0, (car.tyreModel.flatSpot || 0) + 0.0015 * dt);
    }
  } else {
    car.isFrontLocked = false;
  }

  if (effectiveGrip < 0.60 && car.v > 45) {
    // Insufficient grip on wet track or worn tyres causes understeer drift outwards
    const driftOutwards = (0.60 - effectiveGrip) * 12 * dt;
    car.lat += Math.sign(car.lat || 1) * driftOutwards;
  }

  car.lat += Math.sign(latDiff) * Math.min(Math.abs(latDiff), effectiveLatStep);
  car.steer = Math.tanh(latDiff * 0.06);
  car.latAcc = Math.abs(car.steer) * (car.v * car.v) / 60; // Estimated lateral load

  // 9. Track Limits, Kerbs & Physical Boundaries (Phase 5)
  const trackSample = sampleTrack(track, car.d);
  const trackAsphaltHalfW = trackSample.halfWidth || (13.5 * (track.k || 1));
  const kerbWidth = 3.2 * (track.k || 1);
  const barrierLimit = trackAsphaltHalfW + kerbWidth + 3.5 * (track.k || 1);

  // Track-relative positioning: distance from left and right boundaries
  car.distFromLeft = trackAsphaltHalfW - car.lat;
  car.distFromRight = trackAsphaltHalfW + car.lat;
  car.trackHalfWidth = trackAsphaltHalfW;

  if (Math.abs(car.lat) > trackAsphaltHalfW + kerbWidth) {
    // Fully off-track (in runoff / gravel / grass)
    car.isOnRunoff = true;
    car.isOffTrack = true;
    car.isOnKerb = false;
    car.onKerb = false;
    car.currentGrip = (car.currentGrip || 1.0) * 0.65;
    car.v = Math.max(0, car.v - 6.5 * dt); // Speed scrub in gravel/runoff
    if (Math.abs(car.lat) > barrierLimit) {
      car.lat = Math.sign(car.lat) * barrierLimit; // Hard barrier clamp
      car.v *= 0.88; // Kinetic energy loss on barrier contact
      if (car.v > 18) {
        car.damage.frontWing = Math.min(1.0, (car.damage.frontWing || 0) + 0.35);
        car.damage.floor = Math.min(1.0, (car.damage.floor || 0) + 0.15);
      }
    }
  } else if (Math.abs(car.lat) > trackAsphaltHalfW) {
    // Riding kerb / rumble strip
    car.isOnKerb = true;
    car.onKerb = true;
    car.isOnRunoff = false;
    car.isOffTrack = false;
    car.tyreWear = Math.min(1.0, (car.tyreWear || 0) + 0.00002 * dt);
  } else {
    car.isOnKerb = false;
    car.onKerb = false;
    car.isOnRunoff = false;
    car.isOffTrack = false;
  }

  // Update world SVG coordinates
  _updateWorldPos(car, track);
}

function _updateWorldPos(car, track) {
  const { i, fr, heading } = sampleTrack(track, car.d);
  const pts = track.pts;
  const a = pts[i], b = pts[(i + 1) % track.N];
  const nx = -Math.sin(heading), ny = Math.cos(heading);
  car.x = a[0] + (b[0] - a[0]) * fr + nx * car.lat;
  car.y = a[1] + (b[1] - a[1]) * fr + ny * car.lat;
  car.ang = heading;
  car._trackI = i;
}

export function placeCar(car, track, d, lat) {
  car.d = d;
  car.prevD = d;
  car.lat = lat;
  car.v = 0;
  car.throttle = 0;
  car.brake = 0;
  car.steer = 0;
  car._physRem = 0;
  _updateWorldPos(car, track);
}

/**
 * Resolves physical collisions, mutual impulse separation, and damage between cars (Phase 2 & 10).
 *
 * @param {object[]} cars   – active cars in race
 * @param {object}   track  – track geometry
 * @param {number}   dt     – simulation timestep
 * @returns {object[]} collision events
 */
export function resolveCarCollisions(cars, track, dt) {
  const events = [];
  const L = track.circuit.lengthM;
  const k = track.k || 1;
  const carWidthPx = 3.6 * k;
  const carLengthM = 5.6;

  for (let i = 0; i < cars.length; i++) {
    const c1 = cars[i];
    if (c1.finished || c1.retiredLap != null || c1.pitStationary) continue;

    for (let j = i + 1; j < cars.length; j++) {
      const c2 = cars[j];
      if (c2.finished || c2.retiredLap != null || c2.pitStationary) continue;

      const gapForwardM = (((c2.d - c1.d) % L) + L) % L;
      const longDistM = Math.min(gapForwardM, L - gapForwardM);

      if (longDistM < carLengthM) {
        const latDelta = c2.lat - c1.lat;
        const absLatDelta = Math.abs(latDelta);

        if (absLatDelta < carWidthPx * 0.92) {
          // Physical vehicle contact detected!
          const overlapPx = (carWidthPx * 0.92) - absLatDelta;
          const pushSign = latDelta >= 0 ? 1 : -1;

          // Mutual impulse push apart
          const impulseLat = Math.min(overlapPx * 0.5, 8.0 * dt);
          c1.lat -= pushSign * impulseLat;
          c2.lat += pushSign * impulseLat;

          // Velocity equalisation and scrub
          const vRel = Math.abs(c1.v - c2.v);
          const vAvg = (c1.v + c2.v) / 2;
          c1.v = c1.v * (1 - 1.2 * dt) + vAvg * (1.2 * dt);
          c2.v = c2.v * (1 - 1.2 * dt) + vAvg * (1.2 * dt);

          // Impact damage evaluation for hard impacts (vRel > 4.5 m/s)
          if (vRel > 4.5) {
            const trailing = (gapForwardM < L / 2) ? c1 : c2;
            const leading  = (trailing === c1) ? c2 : c1;

            if (!trailing.damage) trailing.damage = { frontWing: 0, floor: 0, sidepod: 0 };
            if (!leading.damage) leading.damage = { frontWing: 0, floor: 0, sidepod: 0 };

            trailing.damage.frontWing = Math.min(1.0, (trailing.damage.frontWing || 0) + 0.28);
            leading.damage.floor = Math.min(1.0, (leading.damage.floor || 0) + 0.10);

            events.push({
              time: c1.simTime || 0,
              type: 'contact',
              carA: c1.code,
              carB: c2.code,
              vRelKph: Math.round(vRel * 3.6),
              message: `Contact between ${c1.code} and ${c2.code}! ${trailing.code} suffers front wing damage.`
            });
          }
        }
      }
    }
  }

  return events;
}
