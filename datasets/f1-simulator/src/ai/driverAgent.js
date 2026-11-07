/**
 * driverAgent.js
 * Autonomous Driver Agent with Integrated Wheel-to-Wheel Racing Planner,
 * Conflict Predictor, Inside-Line Defence, and Collision Avoidance Safety.
 *
 * Responsibilities:
 *   1. Path planning: dynamically adjusts between geometric racing line, apex clipping, and traffic escape
 *   2. Overtaking: tactical evaluation of passing corridors and racing room
 *   3. Defence: inside-line protection without illegal double moves or weaving
 *   4. Tyre & weather management: adapts pace and braking margins to local track grip
 *   5. Collision avoidance: emergency deceleration and evasive corridor guidance
 *   6. Generating race commentary and engineer telemetry logs
 */

import { SimConfig } from '../config/simulationConfig.js';
import { maxCurvatureAhead } from '../simulation/trackManager.js';
import { RLDriverModel } from './reinforcementLearning.js';
import { WheelToWheelPlanner, OvertakeDecision } from './wheelToWheelPlanner.js';

const cfg = SimConfig.ai;

export class DriverAgent {
  /**
   * @param {object} driverProfile – from driverData.js (code, personality, pace, …)
   */
  constructor(driverProfile) {
    this.driver   = driverProfile;
    this.p        = driverProfile.personality || {};
    this.otState  = OvertakeDecision.NO_OPPORTUNITY;
    this.otTarget = null;
    this.otSide   = 0;
    this._tick    = 0;
    this._baselineLat = 0;
    this._drsActive = false;

    // Advanced Wheel-to-Wheel Planner
    this.w2wPlanner = new WheelToWheelPlanner(driverProfile);

    // Reinforcement Learning Adaptive Model
    this.rl = new RLDriverModel(driverProfile.code, true);
  }

  /**
   * Called once when the race is built or reset.
   * gridSide: -1 (left) | +1 (right)
   */
  init(gridSide, k) {
    this._baselineLat = gridSide * 3.6 * k;
    this.otState = OvertakeDecision.NO_OPPORTUNITY;
    this.otTarget = null;
    this._tick = 0;
    this._lastDecisionSimTime = undefined;
    if (this.w2wPlanner) {
      this.w2wPlanner.otState = OvertakeDecision.NO_OPPORTUNITY;
      this.w2wPlanner.otTarget = null;
    }
  }

  /**
   * Main decision tick executed for every car. Returns:
   *   { targetLat, paceFactor, message }
   *
   * @param {object} car          – this car's mutable state
   * @param {object[]} allCars    – all cars on circuit (including self)
   * @param {object} track        – track geometry
   * @param {number} simTime      – elapsed race time in seconds
   * @param {string} raceFlag     – 'green' | 'yellow' | 'vsc' | 'safetycar' | 'red'
   * @param {object} [trackCond]  – optional TrackConditionModel for local grip
   */
  decide(car, allCars, track, simTime, raceFlag, trackCond = null) {
    // Stable simulation time interval: evaluate AI decision every 100ms of sim time
    if (this._lastDecisionSimTime !== undefined && (simTime - this._lastDecisionSimTime) < 0.10 && car._agentOut) {
      // Hold previous smooth trajectory between simulated decision intervals
      return car._agentOut;
    }
    this._lastDecisionSimTime = simTime;

    const L = track.circuit.lengthM;
    const k = track.k || 1;

    // 1. Execute Wheel-to-Wheel Tactical Planning
    const planResult = this.w2wPlanner.plan(car, allCars, track, simTime, raceFlag, trackCond);
    let targetLat = planResult.targetLat;
    let paceFactor = planResult.paceFactor;
    let message = planResult.message;
    car.drivingPlan = planResult.drivingPlan;
    this.otState = planResult.drivingPlan.otDecision;

    // 2. Reinforcement Learning Fine-Tuning Layer
    if (this.rl) {
      const deltaD = car.prevD !== undefined ? car.d - car.prevD : 0;
      const isOT = planResult.drivingPlan.otDecision === OvertakeDecision.VIABLE_OPPORTUNITY;
      const gapM = car.carAhead ? (((car.carAhead.d - car.d) % L) + L) % L : 100;
      const hasRisk = !!planResult.drivingPlan.collisionThreat;
      const reward = RLDriverModel.computeReward(deltaD, gapM, isOT, hasRisk, car.tyreWear || 0);
      const kapAhead = maxCurvatureAhead(track, car.d, 35);
      const rlDelta = this.rl.step(car.v, kapAhead, gapM, car.tyreWear || 0, reward);

      // Dampen RL micro-adjustments so physics remains smooth and predictable
      paceFactor = Math.max(0.10, Math.min(1.06, paceFactor + rlDelta.paceDelta * 0.25));
      targetLat += rlDelta.latDelta * 0.2 * (k || 1);
    }

    // 3. DRS and event tracking
    if (car.drsActive && !car._wasDrs) {
      message = `${car.code} activates DRS wing flap in overtaking zone`;
    }
    car._wasDrs = car.drsActive;
    car._wasOT = (this.otState === OvertakeDecision.VIABLE_OPPORTUNITY);

    const out = { targetLat, paceFactor, message };
    car._agentOut = out;
    return out;
  }
}
