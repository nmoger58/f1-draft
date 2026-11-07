/**
 * wheelToWheelPlanner.js
 * Authoritative Wheel-to-Wheel Racing Planner, Conflict Predictor,
 * Tactical Overtaking Engine, Inside-Line Defence & Collision Avoidance Safety Layer.
 *
 * Implements:
 *   - Shared reference racing line with dynamic out-in-out apex geometry
 *   - Multi-car look-ahead trajectory prediction (TTC & spatial corridor reservation)
 *   - 5-state overtaking planner (NO_OPPORTUNITY, POTENTIAL, VIABLE, HIGH_RISK, COMPLETED)
 *   - Inside-line defensive positioning with one-move rule (no weaving)
 *   - Minimum 1-car-width racing room enforcement
 *   - Collision avoidance safety supervisor (emergency braking & evasive escape corridors)
 *   - Dynamic battery deployment and DRS tactical coordination
 *   - Driver psychological personality profiles governing risk and decision thresholds
 */

import { SimConfig } from '../config/simulationConfig.js';
import { sampleTrack, maxCurvatureAhead } from '../simulation/trackManager.js';

export const OvertakeDecision = {
  NO_OPPORTUNITY:        'NO_OPPORTUNITY',
  POTENTIAL_OPPORTUNITY: 'POTENTIAL_OPPORTUNITY',
  VIABLE_OPPORTUNITY:    'VIABLE_OPPORTUNITY',
  HIGH_RISK_OPPORTUNITY: 'HIGH_RISK_OPPORTUNITY',
  PASS_COMPLETED:        'PASS_COMPLETED'
};
export const OvertakeState = OvertakeDecision;

/**
 * Authoritative AI Behavior State Machine.
 * Explains exact tactical posture of the driver agent.
 */
export const AIBehaviorState = {
  FOLLOWING:    'FOLLOWING',     // Tracking in slipstream / clean air on racing line
  APPROACHING:  'APPROACHING',   // Closing in on car ahead, assessing passing lanes
  ATTACKING:    'ATTACKING',     // Committed to overtake maneuver (inside dive or outside sweep)
  DEFENDING:    'DEFENDING',     // Protecting inside line against pursuing rival
  SIDE_BY_SIDE: 'SIDE_BY_SIDE',  // Running wheel-to-wheel with lateral overlap
  ABORTING:     'ABORTING',      // Backed out / rejected unsafe maneuver due to squeeze or threat
  RECOVERING:   'RECOVERING'     // Recovering control from lockup, spin, or off-track trip
};

export class WheelToWheelPlanner {
  /**
   * @param {object} driverProfile - driver profile with personality stats
   */
  constructor(driverProfile) {
    this.driver = driverProfile;
    this.personality = this._buildDriverPersonality(driverProfile);

    // Overtaking State Machine
    this.otState = OvertakeDecision.NO_OPPORTUNITY;
    this.otTarget = null;
    this.otSide = 0;       // -1 = right (inside right turn), +1 = left (inside left turn)
    this.otTicks = 0;
    this.lastPassSide = 0;

    // Defensive State
    this.isDefending = false;
    this.defendSide = 0;
    this.defendCommitted = false;
    this.weaveTimer = 0;

    // Driving Plan & Telemetry
    this.drivingPlan = {
      referenceLat: 0,
      targetLat: 0,
      paceFactor: 1.0,
      brakeMarginM: 0,
      otDecision: OvertakeDecision.NO_OPPORTUNITY,
      defensiveIntent: false,
      riskEstimate: 0.0,
      collisionThreat: null,
      escapePath: null,
      tacticalBattery: false,
      racingRoomLeftM: 0
    };

    this.decisionCooldown = 0;
  }

  /**
   * Builds an extended psychological profile from driver attributes.
   * @private
   */
  _buildDriverPersonality(dp) {
    const p = dp?.personality || {};
    const aggression = p.aggression ?? 0.75;
    const consistency = p.consistency ?? 0.80;
    const racecraft = p.racecraft ?? 0.80;
    const tyreMgmt = p.tyreManagement ?? 0.75;
    const attackSkill = p.attackSkill ?? 0.75;

    return {
      aggression,
      consistency,
      racecraft,
      tyreMgmt,
      attackSkill,
      riskTolerance: Math.max(0.1, Math.min(1.0, aggression * 0.70 + (1 - consistency) * 0.30)),
      defensiveSkill: Math.max(0.2, Math.min(1.0, racecraft * 0.85 + (1 - aggression) * 0.15)),
      patience: Math.max(0.1, Math.min(1.0, consistency * 0.60 + tyreMgmt * 0.40)),
      wetConfidence: Math.max(0.2, Math.min(1.0, racecraft * 0.50 + attackSkill * 0.50)),
      overtakeAggression: p.overtakeAggression ?? aggression
    };
  }

  /**
   * Main tactical plan generation executed for every simulation step.
   *
   * @param {object} car          – Subject vehicle state
   * @param {object[]} allCars    – All vehicles on track
   * @param {object} track        – Track geometry & properties
   * @param {number} simTime      – Elapsed simulation time in seconds
   * @param {string} raceFlag     – Race control flag state
   * @param {object} trackCond    – Local TrackConditionModel instance
   * @returns {object} updated driving plan { targetLat, paceFactor, message, drivingPlan }
   */
  plan(car, allCars, track, simTime, raceFlag, trackCond) {
    const L = track.circuit.lengthM;
    const k = track.k || 1;
    const N = track.N || 720;
    const carWidthPx = 3.6 * k; // Standard F1 car lateral width in SVG pixels

    // Dynamic track width query from authoritative track model (Phase 2 & 5)
    const curIdx = Math.floor((((car.d % L) + L) % L) / L * N);
    const maxTrackHalfWidth = (track.usableHalfWidth ? track.usableHalfWidth[curIdx] : (11.5 * k));
    const totalHalfWidth = (track.halfWidth ? track.halfWidth[curIdx] : (13.5 * k));

    // Track-relative positioning: distance from left and right boundaries (Phase 3)
    const distFromLeft = totalHalfWidth - car.lat;
    const distFromRight = totalHalfWidth + car.lat;
    car.distFromLeft = distFromLeft;
    car.distFromRight = distFromRight;
    this.drivingPlan.distFromLeft = distFromLeft;
    this.drivingPlan.distFromRight = distFromRight;
    this.drivingPlan.distFromLeftM = Number((distFromLeft / k).toFixed(2));
    this.drivingPlan.distFromRightM = Number((distFromRight / k).toFixed(2));
    this.drivingPlan.trackHalfWidth = totalHalfWidth;
    this.drivingPlan.usableHalfWidth = maxTrackHalfWidth;

    // 1. Compute Geometric Reference & Alternative Racing Lines (Phase 3)
    const altLines = this._computeAlternativeRacingLines(car, track, L, k, trackCond, maxTrackHalfWidth);
    this.drivingPlan.alternativeLines = altLines;
    const refLat = altLines.reference;
    this.drivingPlan.referenceLat = refLat;

    // 2. Multi-Car Conflict Detection & Trajectory Prediction
    const opponents = allCars.filter(c => c !== car && !c.finished && c.retiredLap === null);
    const conflicts = this._predictConflicts(car, opponents, L, k, trackCond);

    // 3. Local Track Grip & Wetness Look-ahead
    const localGrip = (trackCond && typeof trackCond.getLocalGripMultiplier === 'function')
      ? trackCond.getLocalGripMultiplier(car.d, car.lat, car.tyreModel?.compound || 'medium')
      : (typeof car.currentGrip === 'number' ? car.currentGrip : 1.0);
    this.drivingPlan.availableGrip = localGrip;

    // 4. Tactical Overtaking Evaluation with Multiple Passing Corridors (Phase 4)
    const otResult = this._evaluateOvertaking(car, conflicts, track, localGrip, raceFlag, k, L, maxTrackHalfWidth, altLines);

    // 5. Tactical Defensive Positioning (Inside-Line Defense & Racing Room)
    const defResult = this._evaluateDefending(car, conflicts, track, k, L, raceFlag, maxTrackHalfWidth);

    // 6. Base Lateral Intention (Blends Optimal Line, Inside Attack, and Outside Sweep)
    let intendedLat = refLat;
    let intendedPace = otResult.paceFactor;
    let tacticalMessage = null;

    if (defResult.isDefending) {
      intendedLat = defResult.targetLat;
      this.drivingPlan.defensiveIntent = true;
    } else if (otResult.state === OvertakeDecision.VIABLE_OPPORTUNITY || otResult.state === OvertakeDecision.POTENTIAL_OPPORTUNITY) {
      intendedLat = otResult.targetLat;
      intendedPace = otResult.paceFactor;
      if (otResult.state === OvertakeDecision.VIABLE_OPPORTUNITY && !car._wasOT) {
        tacticalMessage = `${car.code} commits to overtake on ${otResult.targetCar?.code} (${otResult.passSide > 0 ? 'Outside' : 'Inside'})`;
      }
    } else if (otResult.state === OvertakeDecision.PASS_COMPLETED) {
      intendedLat = otResult.targetLat;
      this.otState = OvertakeDecision.NO_OPPORTUNITY;
    }

    // 7. Authoritative Collision Avoidance & Safety Override Layer
    const safetyOut = this._applyCollisionAvoidance(
      car,
      intendedLat,
      intendedPace,
      conflicts,
      localGrip,
      raceFlag,
      k,
      L,
      maxTrackHalfWidth
    );

    // 8. Dynamic Tactical Battery Coordination
    this._coordinateBatteryAndDRS(car, conflicts, otResult, defResult, raceFlag);

    // 9. Keep within authoritative asphalt limits
    const finalTargetLat = Math.max(-maxTrackHalfWidth, Math.min(maxTrackHalfWidth, safetyOut.targetLat));
    const finalPace = Math.max(0.10, Math.min(1.06, safetyOut.paceFactor));

    // Determine Canonical AI Behavior State
    let aiState = AIBehaviorState.FOLLOWING;
    if (car.isSpun || car.isOffTrack || car.isFrontLocked || (car.recoveryTimer && car.recoveryTimer > 0)) {
      aiState = AIBehaviorState.RECOVERING;
    } else if (safetyOut.threat || otResult.state === OvertakeDecision.HIGH_RISK_OPPORTUNITY) {
      aiState = AIBehaviorState.ABORTING;
    } else if (conflicts.sideBySideCars && conflicts.sideBySideCars.length > 0) {
      aiState = AIBehaviorState.SIDE_BY_SIDE;
    } else if (defResult.isDefending || this.drivingPlan.defensiveIntent) {
      aiState = AIBehaviorState.DEFENDING;
    } else if (otResult.state === OvertakeDecision.VIABLE_OPPORTUNITY) {
      aiState = AIBehaviorState.ATTACKING;
    } else if (otResult.state === OvertakeDecision.POTENTIAL_OPPORTUNITY || (conflicts.carAhead && conflicts.minGapAheadM <= 48.0 && (car.v - conflicts.carAhead.v) > 0)) {
      aiState = AIBehaviorState.APPROACHING;
    } else {
      aiState = AIBehaviorState.FOLLOWING;
    }

    // Usable Track Width calculation after vehicle clearance & safety margins
    const boundarySafetyMarginPx = carWidthPx * 0.45;
    const netUsableWidthPx = Math.max(0, (maxTrackHalfWidth * 2) - carWidthPx - (boundarySafetyMarginPx * 2));
    const netUsableWidthM = Number((netUsableWidthPx / k).toFixed(2));

    // Multi-horizon trajectory lookahead (1.0s, 2.0s, 3.0s)
    const predictedTrajectories = {
      self: [1.0, 2.0, 3.0].map(t => {
        const futD = (((car.d + car.v * t) % L) + L) % L;
        const futLat = car.lat + (finalTargetLat - car.lat) * (1 - Math.exp(-t / 0.8));
        const sample = sampleTrack(track, futD);
        const pts = track.pts;
        const a = pts[sample.i], b = pts[(sample.i + 1) % track.N];
        const nx = -Math.sin(sample.heading), ny = Math.cos(sample.heading);
        const x = a[0] + (b[0] - a[0]) * sample.fr + nx * futLat;
        const y = a[1] + (b[1] - a[1]) * sample.fr + ny * futLat;
        return { t, d: Number(futD.toFixed(1)), lat: Number(futLat.toFixed(2)), x: Number(x.toFixed(1)), y: Number(y.toFixed(1)), heading: Number(sample.heading.toFixed(3)) };
      }),
      rivals: (conflicts.carAhead ? [conflicts.carAhead] : [])
        .concat(conflicts.sideBySideCars ? conflicts.sideBySideCars.map(s => s.car) : [])
        .concat(conflicts.carBehind ? [conflicts.carBehind] : [])
        .slice(0, 3)
        .map(opp => {
          return {
            code: opp.code,
            points: [1.0, 2.0, 3.0].map(t => {
              const futD = (((opp.d + opp.v * t) % L) + L) % L;
              const targetL = opp.targetLat ?? opp.lat;
              const futLat = opp.lat + (targetL - opp.lat) * (1 - Math.exp(-t / 0.8));
              const sample = sampleTrack(track, futD);
              const pts = track.pts;
              const a = pts[sample.i], b = pts[(sample.i + 1) % track.N];
              const nx = -Math.sin(sample.heading), ny = Math.cos(sample.heading);
              const x = a[0] + (b[0] - a[0]) * sample.fr + nx * futLat;
              const y = a[1] + (b[1] - a[1]) * sample.fr + ny * futLat;
              return { t, d: Number(futD.toFixed(1)), lat: Number(futLat.toFixed(2)), x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) };
            })
          };
        })
    };

    let minPredictedClearance = 99.0;
    if (conflicts.carAhead) {
      const closingV = Math.max(0, car.v - conflicts.carAhead.v);
      const minLongitudinal = Math.max(0, conflicts.minGapAheadM - (closingV * 3.0));
      const latDiffM = Math.abs(finalTargetLat - conflicts.carAhead.lat) / k;
      minPredictedClearance = Number(Math.max(0, Math.hypot(minLongitudinal, latDiffM) - (carWidthPx / k)).toFixed(2));
    }

    this.drivingPlan.targetLat = finalTargetLat;
    this.drivingPlan.paceFactor = finalPace;
    this.drivingPlan.aiState = aiState;
    this.drivingPlan.otDecision = otResult.state;
    this.drivingPlan.targetCarCode = otResult.targetCar?.code || null;
    this.drivingPlan.selectedPassingLine = otResult.selectedPassingLine || 'NONE';
    this.drivingPlan.selectionReason = otResult.selectionReason || 'Tracking optimal racing line';
    this.drivingPlan.rejectionReason = otResult.rejectionReason || (safetyOut.threat ? `Aborted unsafe maneuver: proximity threat (TTC ${(safetyOut.threat.ttc || 0).toFixed(2)}s)` : null);
    this.drivingPlan.candidatePaths = otResult.candidatePaths || [];
    this.drivingPlan.predictedTrajectories = predictedTrajectories;
    this.drivingPlan.minPredictedClearance = minPredictedClearance;
    this.drivingPlan.netUsableWidthM = netUsableWidthM;
    this.drivingPlan.boundarySafetyMarginM = Number((boundarySafetyMarginPx / k).toFixed(2));
    this.drivingPlan.usableTrackWidthM = Number(((maxTrackHalfWidth * 2) / k).toFixed(2));
    this.drivingPlan.totalTrackWidthM = Number(((totalHalfWidth * 2) / k).toFixed(2));
    this.drivingPlan.defensiveIntent = !!defResult.isDefending;
    this.drivingPlan.collisionThreat = safetyOut.threat;
    this.drivingPlan.avoidanceActive = !!safetyOut.threat;
    this.drivingPlan.threatSeverity = safetyOut.threat ? (safetyOut.threat.ttc < 1.0 ? 'CRITICAL' : 'WARNING') : 'NONE';
    this.drivingPlan.emergencyBrakeTriggered = !!(safetyOut.threat && safetyOut.threat.ttc < 1.0);
    this.drivingPlan.racingRoomGiven = defResult.racingRoom || (3.6 * k);
    this.drivingPlan.conflicts = {
      ahead: conflicts.carAhead ? {
        code: conflicts.carAhead.code,
        gapM: conflicts.minGapAheadM,
        ttc: conflicts.collisionRisks.find(r => r.target === conflicts.carAhead)?.ttc ?? (conflicts.minGapAheadM / Math.max(0.1, car.v - conflicts.carAhead.v)),
        closingRate: car.v - conflicts.carAhead.v,
        relLat: conflicts.carAhead.lat - car.lat
      } : null,
      behind: conflicts.carBehind ? {
        code: conflicts.carBehind.code,
        gapM: conflicts.minGapBehindM,
        ttc: conflicts.carBehind.v > car.v ? (conflicts.minGapBehindM / Math.max(0.1, conflicts.carBehind.v - car.v)) : 99,
        closingRate: conflicts.carBehind.v - car.v
      } : null,
      sideBySide: (conflicts.sideBySideCars || []).map(s => ({
        code: s.car.code,
        overlapM: s.gapM,
        latDiffPx: s.latDiff,
        side: Math.sign(s.relativeLat) || 1
      }))
    };

    return {
      targetLat: finalTargetLat,
      paceFactor: finalPace,
      message: tacticalMessage || safetyOut.message,
      drivingPlan: this.drivingPlan,
      ...this.drivingPlan
    };
  }

  // ── 1. Reference & Alternative Racing Lines ─────────────────────────────

  /**
   * Computes geometric reference, inside, and outside racing lines adapted to track width (Phase 3).
   * @param {object} car
   * @param {object} track
   * @param {number} L
   * @param {number} k
   * @param {object} trackCond
   * @param {number} usableHalfWidth
   * @returns {{ reference: number, inside: number, outside: number, isCorner: boolean, turnSign: number, brakingDeltaM: number, apexSpeedFactor: number }}
   * @private
   */
  _computeAlternativeRacingLines(car, track, L, k, trackCond, usableHalfWidth) {
    const N = track.N || 720;
    const curIdx = Math.floor((((car.d % L) + L) % L) / L * N);
    const lookAheadIdx = (curIdx + 16) % N; // ~40m ahead

    // Determine upcoming corner direction from heading differential
    const hCur = track.heading[curIdx];
    const hNext = track.heading[lookAheadIdx];
    let dh = hNext - hCur;
    while (dh > Math.PI) dh -= 2 * Math.PI;
    while (dh < -Math.PI) dh += 2 * Math.PI;

    const kapCur = track.speedModel?.kap ? track.speedModel.kap[curIdx] : 0;
    const kapAhead = maxCurvatureAhead(track, car.d, 45);
    const isCorner = kapAhead > 0.0025;
    const turnSign = Math.sign(dh || 1); // +1 right turn (inside is -lat), -1 left turn (inside is +lat)

    const halfW = usableHalfWidth || (11.5 * k);
    const edgeMargin = 2.2 * k;
    const maxLineLat = Math.max(4.0 * k, halfW - edgeMargin);

    let reference = 0;
    let inside = 0;
    let outside = 0;
    let brakingDeltaM = 0;
    let apexSpeedFactor = 1.0;

    if (isCorner) {
      // In SVG coordinates, normal vector N points left for positive lat.
      // If turnSign > 0 (right turn): inside is -lat, outside is +lat.
      // If turnSign < 0 (left turn): inside is +lat, outside is -lat.
      const insideApexLat = -turnSign * Math.min(halfW - 2.0 * k, 8.5 * k);
      const outsideSweepLat = turnSign * Math.min(halfW - 2.0 * k, 8.5 * k);

      if (kapCur < 0.0020) {
        // Corner Entry: Reference swings wide to outside to maximize turn radius
        reference = turnSign * 4.2 * k;
      } else {
        // Corner Apex / Mid-corner: Reference clips inside apex
        reference = -turnSign * 4.8 * k;
      }

      // Alternative inside line: commits directly to the inside kerb corridor
      inside = insideApexLat;
      // Alternative outside line: holds wider perimeter around the corner
      outside = outsideSweepLat;

      // Inside line has tighter effective radius: requires earlier braking (delta ~ +5m) and slightly lower apex speed (0.96)
      // Outside line has larger radius: can brake slightly later (delta ~ -3m) and carry higher rolling momentum (1.045)
      brakingDeltaM = 5.0;
      apexSpeedFactor = 0.96;
    } else {
      // On straights:
      // Reference line tracks the rubbered racing line near centre
      reference = 0;
      // Straights allow flexible positioning: inside/outside map to left/right passing lanes
      inside = -Math.min(halfW - 2.0 * k, 7.5 * k);
      outside = Math.min(halfW - 2.0 * k, 7.5 * k);
      brakingDeltaM = 0;
      apexSpeedFactor = 1.0;
    }

    // In drying conditions, bias toward the dry racing line if off-line is soaked
    if (trackCond && typeof trackCond.getDryingLineState === 'function') {
      const dryingState = trackCond.getDryingLineState();
      if (dryingState && dryingState.formed) {
        reference *= 0.65;
      }
    }

    return {
      reference,
      inside,
      outside,
      isCorner,
      turnSign,
      brakingDeltaM,
      apexSpeedFactor
    };
  }

  /**
   * Calculates smooth "out-in-out" geometric racing line with local grip modulation.
   * @private
   */
  _computeReferenceRacingLine(car, track, L, k, trackCond) {
    const alt = this._computeAlternativeRacingLines(car, track, L, k, trackCond, 11.5 * k);
    return alt.reference;
  }

  // ── 2. Multi-Car Conflict Prediction ─────────────────────────────────────

  /**
   * Predicts opponent trajectories and evaluates Time-To-Collision (TTC) & corridor overlap.
   * @private
   */
  _predictConflicts(car, opponents, L, k, trackCond) {
    const carWidthPx = 3.6 * k;
    const carLengthM = 6.0;

    let carAhead = null;
    let minGapAheadM = Infinity;
    let carBehind = null;
    let minGapBehindM = Infinity;

    const sideBySideCars = [];
    const collisionRisks = [];

    for (const opp of opponents) {
      const gapForwardM = (((opp.d - car.d) % L) + L) % L;
      const gapBackwardM = (((car.d - opp.d) % L) + L) % L;

      // Track closest car ahead (within 100m)
      if (gapForwardM > 0 && gapForwardM < 100 && gapForwardM < minGapAheadM) {
        minGapAheadM = gapForwardM;
        carAhead = opp;
      }

      // Track closest car behind (within 70m)
      if (gapBackwardM > 0 && gapBackwardM < 70 && gapBackwardM < minGapBehindM) {
        minGapBehindM = gapBackwardM;
        carBehind = opp;
      }

      // Detect Side-by-Side Overlap (longitudinal gap < 12m)
      const longitudinalDist = Math.min(gapForwardM, gapBackwardM);
      if (longitudinalDist < 12.0) {
        sideBySideCars.push({
          car: opp,
          gapM: longitudinalDist,
          latDiff: Math.abs(car.lat - opp.lat),
          relativeLat: opp.lat - car.lat,
          relativeSpeed: car.v - opp.v
        });
      }

      // Predict Time-To-Collision for approaching cars in same lateral corridor
      if (gapForwardM > 0 && gapForwardM < 50) {
        const latOverlap = Math.abs(car.lat - opp.lat) < carWidthPx * 1.15;
        const closingV = car.v - opp.v;
        if (closingV > 1.0 && latOverlap) {
          const ttc = gapForwardM / closingV;
          if (ttc < 3.0) {
            collisionRisks.push({
              target: opp,
              gapM: gapForwardM,
              ttc,
              closingV
            });
          }
        }
      }
    }

    // Sort collision risks by urgency (lowest TTC first)
    collisionRisks.sort((a, b) => a.ttc - b.ttc);

    return {
      carAhead,
      minGapAheadM,
      carBehind,
      minGapBehindM,
      sideBySideCars,
      collisionRisks
    };
  }

  // ── 3. Tactical Overtaking Decisions ──────────────────────────────────────

  /**
   * Evaluates overtaking opportunities based on pace delta, available room, and personality (Phase 4).
   * Supports multiple passing corridors (inside dive vs sweeping outside line).
   * @private
   */
  _evaluateOvertaking(car, conflicts, track, localGrip, raceFlag, k, L, usableHalfW, altLines) {
    const ahead = conflicts.carAhead;
    const gapM = conflicts.minGapAheadM;
    const p = this.personality;
    const carWidthPx = 3.6 * k;
    const maxTrackHalfWidth = usableHalfW || (11.5 * k);

    // No passing permitted under VSC, Safety Car, or Red Flag
    if (raceFlag === 'vsc' || raceFlag === 'safetycar' || raceFlag === 'red' || !ahead) {
      this.otState = OvertakeDecision.NO_OPPORTUNITY;
      const rejReason = (!ahead)
        ? 'No opponent ahead (clean air)'
        : `Overtaking prohibited under race control flag (${raceFlag.toUpperCase()})`;
      return {
        state: OvertakeDecision.NO_OPPORTUNITY,
        paceFactor: 1.0,
        targetLat: car.lat,
        selectedPassingLine: 'NONE',
        selectionReason: 'Holding position on racing line',
        rejectionReason: rejReason
      };
    }

    // Check if pass was previously completed (now well ahead)
    if (this.otTarget && this.otTarget === ahead) {
      const diffD = (((car.d - ahead.d) % L) + L) % L;
      if (diffD > 9.0 && diffD < L / 2) {
        this.otTarget = null;
        this.otState = OvertakeDecision.PASS_COMPLETED;
        return {
          state: OvertakeDecision.PASS_COMPLETED,
          paceFactor: 1.0,
          targetLat: (altLines ? altLines.reference : this.drivingPlan.referenceLat),
          selectedPassingLine: 'NONE',
          selectionReason: 'Overtake completed; returning to racing line',
          rejectionReason: null
        };
      }
    }

    // 1. Identify closing rate and speed advantage
    const speedDelta = car.v - ahead.v;
    const hasTowOrDRS = car.drsActive || (car.batteryOutput?.isDeploying) || (speedDelta > 1.2);
    const aggMod = 1.0 + (p.overtakeAggression - 0.75) * 0.4;
    const commitThresholdM = 22.0 * aggMod;

    // Room evaluation: determine available space to left and right of ahead car
    const leftRoom = maxTrackHalfWidth - ahead.lat;
    const rightRoom = maxTrackHalfWidth + ahead.lat;
    const minSafePassingRoom = carWidthPx * 1.35; // ~4.86k

    const canPassLeft = leftRoom >= minSafePassingRoom;
    const canPassRight = rightRoom >= minSafePassingRoom;

    // Tactical Corridor Selection:
    // If upcoming corner exists, identify inside vs outside corridors
    let preferredSide = 0; // +1 = left, -1 = right
    let passingLineType = 'NONE';
    let selReason = 'Tracking reference line';
    let rejReason = null;

    if (altLines && altLines.isCorner) {
      // turnSign > 0 (right turn) => inside is negative lat (right corridor: -1)
      // turnSign < 0 (left turn) => inside is positive lat (left corridor: +1)
      const insideCorridorSign = (altLines.turnSign > 0) ? -1 : 1;
      // If defender leaves inside corridor open, seize the inside line!
      if (insideCorridorSign === -1 && canPassRight) {
        preferredSide = -1;
        passingLineType = 'INSIDE_DIVE';
        selReason = `Inside line open into ${altLines.turnSign > 0 ? 'Right' : 'Left'} turn (+${(rightRoom/k).toFixed(1)}m room, turn radius advantage)`;
      } else if (insideCorridorSign === 1 && canPassLeft) {
        preferredSide = 1;
        passingLineType = 'INSIDE_DIVE';
        selReason = `Inside line open into ${altLines.turnSign > 0 ? 'Right' : 'Left'} turn (+${(leftRoom/k).toFixed(1)}m room, turn radius advantage)`;
      } else if (insideCorridorSign === -1 && canPassLeft) {
        // Inside is defended/blocked! Sweep around the outside corridor!
        preferredSide = 1;
        passingLineType = 'OUTSIDE_SWEEP';
        selReason = `Defender covering inside; sweeping around outside perimeter (+${(leftRoom/k).toFixed(1)}m room, carrying momentum)`;
      } else if (insideCorridorSign === 1 && canPassRight) {
        preferredSide = -1;
        passingLineType = 'OUTSIDE_SWEEP';
        selReason = `Defender covering inside; sweeping around outside perimeter (+${(rightRoom/k).toFixed(1)}m room, carrying momentum)`;
      }
    }

    if (preferredSide === 0) {
      // On straights, choose side with more room
      if (canPassLeft && canPassRight) {
        preferredSide = (leftRoom >= rightRoom) ? 1 : -1;
        passingLineType = preferredSide > 0 ? 'LEFT_CORRIDOR' : 'RIGHT_CORRIDOR';
        selReason = `Straightline draft in ${preferredSide > 0 ? 'left' : 'right'} corridor with DRS/tow advantage (+${((preferredSide > 0 ? leftRoom : rightRoom)/k).toFixed(1)}m room)`;
      } else if (canPassLeft) {
        preferredSide = 1;
        passingLineType = 'LEFT_CORRIDOR';
        selReason = `Left corridor clear for passing (+${(leftRoom/k).toFixed(1)}m room)`;
      } else if (canPassRight) {
        preferredSide = -1;
        passingLineType = 'RIGHT_CORRIDOR';
        selReason = `Right corridor clear for passing (+${(rightRoom/k).toFixed(1)}m room)`;
      } else {
        preferredSide = (leftRoom >= rightRoom) ? 1 : -1;
        passingLineType = preferredSide > 0 ? 'LEFT_CORRIDOR' : 'RIGHT_CORRIDOR';
        selReason = 'Attempting corridor squeeze';
      }
    }

    let chosenTargetLat = 0;
    if (preferredSide > 0) {
      // Attack on Left: ahead.lat + clearance
      chosenTargetLat = ahead.lat + carWidthPx * 1.35;
    } else {
      // Attack on Right: ahead.lat - clearance
      chosenTargetLat = ahead.lat - carWidthPx * 1.35;
    }

    // Clamp target within track boundaries with safety margin
    const boundarySafetyMargin = carWidthPx * 0.45;
    const clampedTargetLat = Math.max(-maxTrackHalfWidth + boundarySafetyMargin, Math.min(maxTrackHalfWidth - boundarySafetyMargin, chosenTargetLat));
    const isBoundaryConstrained = Math.abs(chosenTargetLat) > (maxTrackHalfWidth - boundarySafetyMargin);
    chosenTargetLat = clampedTargetLat;

    // Verify chosen corridor has room
    const isRoomSafe = (preferredSide > 0 ? canPassLeft : canPassRight) && !isBoundaryConstrained;

    const curTrackIdx = Math.floor((((car.d % L) + L) % L) / L * (track?.N || 720));
    const totalHalfWidth = (track?.halfWidth ? track.halfWidth[curTrackIdx] : (maxTrackHalfWidth * 1.15));

    // Candidate Paths evaluation table for diagnostics
    const candidatePaths = [
      {
        id: 'reference',
        name: 'Reference Line',
        targetLat: Number((altLines ? altLines.reference : this.drivingPlan.referenceLat).toFixed(2)),
        targetLatM: Number(((altLines ? altLines.reference : this.drivingPlan.referenceLat) / k).toFixed(2)),
        roomM: Number(((totalHalfWidth - Math.abs(altLines ? altLines.reference : 0)) / k).toFixed(2)),
        isFeasible: true,
        feasible: true,
        rationale: 'Optimal geometric out-in-out apex line',
        reason: 'Optimal geometric out-in-out apex line',
        score: 1.0
      },
      {
        id: 'inside',
        name: 'Inside Dive',
        targetLat: Number((altLines?.inside ?? (-maxTrackHalfWidth * 0.5)).toFixed(2)),
        targetLatM: Number(((altLines?.inside ?? (-maxTrackHalfWidth * 0.5)) / k).toFixed(2)),
        roomM: Number(((altLines?.turnSign > 0 ? rightRoom : leftRoom) / k).toFixed(2)),
        isFeasible: (altLines?.turnSign > 0 ? canPassRight : canPassLeft) && !isBoundaryConstrained,
        feasible: (altLines?.turnSign > 0 ? canPassRight : canPassLeft) && !isBoundaryConstrained,
        rationale: (altLines?.turnSign > 0 ? canPassRight : canPassLeft)
          ? ((altLines?.turnSign > 0 ? rightRoom : leftRoom) >= minSafePassingRoom ? 'Inside apex corridor open for braking attack' : 'Inside line clearance tight')
          : 'Inside line blocked by defender or track boundary',
        reason: (altLines?.turnSign > 0 ? canPassRight : canPassLeft)
          ? ((altLines?.turnSign > 0 ? rightRoom : leftRoom) >= minSafePassingRoom ? 'Inside apex corridor open for braking attack' : 'Inside line clearance tight')
          : 'Inside line blocked by defender or track boundary',
        score: (altLines?.turnSign > 0 ? canPassRight : canPassLeft) ? 1.05 : 0.2
      },
      {
        id: 'outside',
        name: 'Outside Sweep',
        targetLat: Number((altLines?.outside ?? (maxTrackHalfWidth * 0.5)).toFixed(2)),
        targetLatM: Number(((altLines?.outside ?? (maxTrackHalfWidth * 0.5)) / k).toFixed(2)),
        roomM: Number(((altLines?.turnSign > 0 ? leftRoom : rightRoom) / k).toFixed(2)),
        isFeasible: (altLines?.turnSign > 0 ? canPassLeft : canPassRight) && !isBoundaryConstrained,
        feasible: (altLines?.turnSign > 0 ? canPassLeft : canPassRight) && !isBoundaryConstrained,
        rationale: (altLines?.turnSign > 0 ? canPassLeft : canPassRight)
          ? 'Outside perimeter available to carry momentum'
          : 'Outside line squeezed against track boundary',
        reason: (altLines?.turnSign > 0 ? canPassLeft : canPassRight)
          ? 'Outside perimeter available to carry momentum'
          : 'Outside line squeezed against track boundary',
        score: (altLines?.turnSign > 0 ? canPassLeft : canPassRight) ? 0.95 : 0.2
      }
    ];

    if (gapM > 48.0) {
      this.otState = OvertakeDecision.NO_OPPORTUNITY;
      return {
        state: OvertakeDecision.NO_OPPORTUNITY,
        paceFactor: 1.0,
        targetLat: (altLines ? altLines.reference : this.drivingPlan.referenceLat),
        selectedPassingLine: 'NONE',
        selectionReason: 'Tracking reference racing line in clean air',
        rejectionReason: `Insufficient proximity: gap ${gapM.toFixed(1)}m > 48.0m evaluation threshold`,
        candidatePaths
      };
    }

    if (gapM <= 48.0 && gapM > commitThresholdM) {
      // Potential Opportunity: close up in slipstream, step laterally into passing lane
      this.otState = OvertakeDecision.POTENTIAL_OPPORTUNITY;
      this.otTarget = ahead;
      this.otSide = preferredSide;
      return {
        state: OvertakeDecision.POTENTIAL_OPPORTUNITY,
        paceFactor: 1.025,
        targetLat: chosenTargetLat,
        targetCar: ahead,
        passSide: preferredSide,
        selectedPassingLine: passingLineType,
        selectionReason: `Approaching in tow; ${selReason}`,
        rejectionReason: null,
        candidatePaths
      };
    }

    if (gapM <= commitThresholdM && (hasTowOrDRS || speedDelta > 0.35)) {
      if (!canPassLeft && !canPassRight) {
        // Deliberately constrained passing opportunity: both sides blocked
        this.otState = OvertakeDecision.HIGH_RISK_OPPORTUNITY;
        return {
          state: OvertakeDecision.HIGH_RISK_OPPORTUNITY,
          paceFactor: 0.94,
          targetLat: ahead.lat,
          targetCar: ahead,
          selectedPassingLine: 'NONE',
          selectionReason: 'Aborted attack due to corridor squeeze',
          rejectionReason: `Constrained passing opportunity: lateral corridors squeezed (Left: ${(leftRoom/k).toFixed(1)}m, Right: ${(rightRoom/k).toFixed(1)}m < safe width ${(minSafePassingRoom/k).toFixed(1)}m)`,
          candidatePaths
        };
      }

      if (isBoundaryConstrained) {
        // Boundary-clearance problem: target passing line violates usable track edge
        this.otState = OvertakeDecision.HIGH_RISK_OPPORTUNITY;
        return {
          state: OvertakeDecision.HIGH_RISK_OPPORTUNITY,
          paceFactor: 0.94,
          targetLat: clampedTargetLat,
          targetCar: ahead,
          selectedPassingLine: passingLineType,
          selectionReason: 'Attack compromised by track edge',
          rejectionReason: `Boundary-clearance problem: target passing line violates usable road corridor (lateral margin < ${(boundarySafetyMargin/k).toFixed(2)}m)`,
          candidatePaths
        };
      }

      if (localGrip < 0.55 && p.riskTolerance < 0.65) {
        // Rejected unsafe maneuver: slippery wet off-line asphalt
        this.otState = OvertakeDecision.HIGH_RISK_OPPORTUNITY;
        return {
          state: OvertakeDecision.HIGH_RISK_OPPORTUNITY,
          paceFactor: 0.94,
          targetLat: ahead.lat,
          targetCar: ahead,
          selectedPassingLine: 'NONE',
          selectionReason: 'Aborted attack due to low grip off-line',
          rejectionReason: `Rejected unsafe maneuver: off-line wet surface grip (${Math.round(localGrip*100)}%) below driver risk tolerance`,
          candidatePaths
        };
      }

      // Viable Opportunity: Commit to controlled wheel-to-wheel pass
      this.otState = OvertakeDecision.VIABLE_OPPORTUNITY;
      this.otTarget = ahead;
      this.otSide = preferredSide;

      // Adjust corner pace factor: if taking outside line, carry momentum (1.045); inside line (1.03)
      const cornerBonus = (altLines && altLines.isCorner)
        ? ((preferredSide === (altLines.turnSign > 0 ? 1 : -1)) ? 1.045 : 1.03)
        : 1.04;

      return {
        state: OvertakeDecision.VIABLE_OPPORTUNITY,
        paceFactor: cornerBonus,
        targetLat: chosenTargetLat,
        targetCar: ahead,
        passSide: preferredSide,
        selectedPassingLine: passingLineType,
        selectionReason: selReason,
        rejectionReason: null,
        candidatePaths
      };
    }

    // Insufficient closing speed delta to commit
    this.otState = OvertakeDecision.NO_OPPORTUNITY;
    const rejInsufficientSpeed = `Insufficient pace delta: closing speed ${(speedDelta * 3.6).toFixed(1)} km/h insufficient to complete pass before braking zone`;
    return {
      state: OvertakeDecision.NO_OPPORTUNITY,
      paceFactor: 1.0,
      targetLat: (altLines ? altLines.reference : this.drivingPlan.referenceLat),
      selectedPassingLine: 'NONE',
      selectionReason: 'Tracking reference racing line',
      rejectionReason: rejInsufficientSpeed,
      candidatePaths
    };
  }

  // ── 4. Tactical Inside-Line Defence & Racing Room ─────────────────────────

  /**
   * Implements inside-line defence and enforces >= 1.2 car-width racing room (Phase 4).
   * @private
   */
  _evaluateDefending(car, conflicts, track, k, L, raceFlag, usableHalfW) {
    const behind = conflicts.carBehind;
    const gapBehindM = conflicts.minGapBehindM;
    const p = this.personality;
    const carWidthPx = 3.6 * k;
    const maxTrackHalfWidth = usableHalfW || (11.5 * k);

    // If cars are side-by-side, enforce mutual racing room (>= 1.20 car widths)
    if (conflicts.sideBySideCars.length > 0) {
      const rival = conflicts.sideBySideCars[0];
      let rivalSide = Math.sign(rival.relativeLat);
      if (rivalSide === 0) {
        rivalSide = ((car.i ?? 0) < (rival.car.i ?? 0)) ? -1 : 1;
      }
      // Leave at least 1.20 car widths (4.32k) between us and rival
      const roomRequired = carWidthPx * 1.20;
      let safeLat = rival.car.lat - (rivalSide * roomRequired);

      // Bound within track limits while preserving room
      safeLat = Math.max(-maxTrackHalfWidth + carWidthPx * 0.5, Math.min(maxTrackHalfWidth - carWidthPx * 0.5, safeLat));

      return {
        isDefending: true,
        targetLat: safeLat,
        sideBySide: true,
        racingRoom: roomRequired
      };
    }

    // Defensive move before braking zone: protect the inside line
    if (behind && gapBehindM < 26.0 && raceFlag === 'green') {
      const closingRate = behind.v - car.v;
      if (closingRate > 0.5 || behind.drsActive) {
        // Find inside line of upcoming corner to protect the apex
        const curIdx = Math.floor((((car.d % L) + L) % L) / L * 720);
        const nextIdx = (curIdx + 25) % 720;
        const dh = track.heading[nextIdx] - track.heading[curIdx];
        const insideSign = dh > 0 ? -1 : 1;

        // F1 Rule: Driver may make one decisive defensive move, no weaving!
        if (!this.defendCommitted) {
          this.defendSide = insideSign;
          this.defendCommitted = true;
          this.isDefending = true;
        }

        // Move to cover inside line, but leave at least 1.5 car widths of room on the outside for attacker
        const defensiveLat = this.defendSide * Math.min(maxTrackHalfWidth - carWidthPx * 1.5, maxTrackHalfWidth * 0.55);
        return {
          isDefending: true,
          targetLat: defensiveLat,
          sideBySide: false,
          racingRoom: carWidthPx * 1.5
        };
      }
    }

    this.defendCommitted = false;
    this.isDefending = false;
    return { isDefending: false, targetLat: car.lat, sideBySide: false, racingRoom: 3.6 * k };
  }

  // ── 5. Authoritative Collision Avoidance Layer ────────────────────────────

  /**
   * Collision avoidance supervisor: acts as a safety layer overriding unsafe targets (Phase 4).
   * @private
   */
  _applyCollisionAvoidance(car, intendedLat, intendedPace, conflicts, localGrip, raceFlag, k, L, usableHalfW) {
    const carWidthPx = 3.6 * k;
    const maxTrackHalfWidth = usableHalfW || (11.5 * k);
    let safeLat = intendedLat;
    let safePace = intendedPace;
    let threatInfo = null;
    let safetyMsg = null;

    // Emergency check for stopped or spun cars ahead
    if (conflicts.carAhead && conflicts.carAhead.isSpun) {
      const gapM = conflicts.minGapAheadM;
      if (gapM < 32.0) {
        // Immediate evasive action! Steer away from spun car's lateral position into available corridor
        const escapeSide = conflicts.carAhead.lat > 0 ? -1 : 1;
        safeLat = escapeSide * Math.min(maxTrackHalfWidth - carWidthPx * 0.5, 6.0 * k);
        safePace = Math.min(safePace, 0.45);
        return {
          targetLat: safeLat,
          paceFactor: safePace,
          threat: 'SPUN_VEHICLE_AHEAD',
          message: `${car.code} takes evasive action around spun car ${conflicts.carAhead.code}!`
        };
      }
    }

    // Look at imminent collision threats (TTC < 2.0s)
    if (conflicts.collisionRisks.length > 0) {
      const primaryThreat = conflicts.collisionRisks[0];
      const gapM = primaryThreat.gapM;
      const ttc = primaryThreat.ttc;
      threatInfo = primaryThreat;

      // Wet braking adjustment: in wet conditions, braking distances are 50-100% longer
      const wetBrakeScale = Math.max(1.0, 1.8 - localGrip * 0.8);
      const criticalGap = (10.0 * wetBrakeScale);

      if (gapM < criticalGap || ttc < 1.0) {
        // Severe collision danger: brake immediately to prevent bumper-to-bumper impact
        const targetSpeedRatio = Math.max(0.20, (primaryThreat.target.v / Math.max(1, car.v)) * 0.88);
        safePace = Math.min(safePace, targetSpeedRatio);

        // Check if an escape path exists to the side
        const leftClear = !this._isCorridorOccupied(car, car.lat + carWidthPx * 1.25, conflicts, k);
        const rightClear = !this._isCorridorOccupied(car, car.lat - carWidthPx * 1.25, conflicts, k);

        if (leftClear && car.lat + carWidthPx * 1.25 <= maxTrackHalfWidth) {
          safeLat = car.lat + carWidthPx * 1.25;
        } else if (rightClear && car.lat - carWidthPx * 1.25 >= -maxTrackHalfWidth) {
          safeLat = car.lat - carWidthPx * 1.25;
        }
      } else if (gapM < criticalGap * 1.8 || ttc < 2.0) {
        // Proactive lift-and-coast to manage closing gap smoothly
        safePace = Math.min(safePace, 0.86);
      }
    }

    // Speed caps under yellow flag and Safety Car
    if (raceFlag === 'yellow') safePace = Math.min(safePace, 0.75);
    if (raceFlag === 'vsc') safePace = Math.min(safePace, 0.60);
    if (raceFlag === 'safetycar') safePace = Math.min(safePace, 0.50);
    if (raceFlag === 'red') safePace = 0.0;

    // Mutual side-by-side lateral separation enforcement if overlapping closely in lane
    for (const sbs of conflicts.sideBySideCars) {
      if (sbs.gapM < 5.0 && sbs.latDiff < carWidthPx * 1.05) {
        let side = Math.sign(sbs.relativeLat);
        if (side === 0) {
          side = ((car.i ?? 0) < (sbs.car.i ?? 0)) ? -1 : 1;
        }
        safeLat = sbs.car.lat - (side * carWidthPx * 1.20);
        safeLat = Math.max(-maxTrackHalfWidth, Math.min(maxTrackHalfWidth, safeLat));
      }
    }

    return {
      targetLat: safeLat,
      paceFactor: safePace,
      threat: threatInfo,
      message: safetyMsg
    };
  }

  /**
   * Helper to check if a lateral corridor is occupied by another car.
   * @private
   */
  _isCorridorOccupied(car, testLat, conflicts, k) {
    const carWidthPx = 3.6 * k;
    for (const opp of conflicts.sideBySideCars) {
      if (Math.abs(opp.car.lat - testLat) < carWidthPx) return true;
    }
    if (conflicts.carAhead && conflicts.minGapAheadM < 16) {
      if (Math.abs(conflicts.carAhead.lat - testLat) < carWidthPx) return true;
    }
    return false;
  }

  // ── 6. Tactical Battery & DRS Coordination ────────────────────────────────

  /**
   * Integrates battery deployment and DRS tactics into wheel-to-wheel decisions.
   * @private
   */
  _coordinateBatteryAndDRS(car, conflicts, otResult, defResult, raceFlag) {
    if (!car.batteryController) return;

    // Check battery eligibility from controller
    const batt = car.batteryController;
    const isEligible = car.batteryEligibility?.eligible ?? (batt.soc >= 99.5);

    // Deploy battery during viable overtake on a straight
    if (isEligible && otResult.state === OvertakeDecision.VIABLE_OPPORTUNITY && raceFlag === 'green') {
      if (batt.mode !== 'ATTACK') {
        batt.setMode('ATTACK', car.batteryEligibility);
        batt.setPowerLevel?.(3);
        this.drivingPlan.tacticalBattery = true;
      }
    } else if (isEligible && defResult.isDefending && conflicts.minGapBehindM < 15.0 && raceFlag === 'green') {
      // Deploy battery to defend against close pursuer on a straight
      if (batt.mode !== 'ATTACK') {
        batt.setMode('ATTACK', car.batteryEligibility);
        batt.setPowerLevel?.(2);
        this.drivingPlan.tacticalBattery = true;
      }
    }
  }
}
