/**
 * launchManager.js
 * Authoritative Formula 1 Race Start & Reaction Challenge System.
 *
 * Implements:
 *   - FIA 5-Red-Light Sequential Gantry (1 light per second)
 *   - Unpredictable randomized hold interval before lights extinguish (0.8s - 3.2s)
 *   - Authoritative simultaneous "LIGHTS OUT" start event
 *   - High-resolution millisecond reaction-time measurement via performance.now()
 *   - Configurable reaction performance classification bands:
 *       Exceptional (0-150ms), Excellent (151-220ms), Good (221-300ms),
 *       Slow (301-450ms), Very Slow (>450ms)
 *   - Physical launch translation: reaction delay before throttle application,
 *     traction limits, tyre grip coupling, mass inertia, and wheelspin
 *   - Independent AI opponent reaction modeling based on driver personality
 *   - False start / early press detection with anti-stall delay penalty
 *   - Opening lap position change tracking
 */

export const StartStates = {
  GRID:                  'grid',                  // Stationary on grid slots
  LIGHTS_1:              'lights_1',              // Light 1 ON
  LIGHTS_2:              'lights_2',              // Light 2 ON
  LIGHTS_3:              'lights_3',              // Light 3 ON
  LIGHTS_4:              'lights_4',              // Light 4 ON
  LIGHTS_5:              'lights_5',              // Light 5 ON
  WAITING_FOR_LIGHTS_OUT:'waiting_for_lights_out',// 5 lights ON, random hold
  LIGHTS_OUT:            'lights_out',            // Signal given, reaction timer active
  RACING:                'racing'                 // Field launched into Turn 1
};

export const REACTION_BANDS = [
  { maxMs: 150, rating: 'Exceptional', quality: 'Perfect Reaction & Maximum Traction', color: '#00e5ff' },
  { maxMs: 220, rating: 'Excellent',   quality: 'Clean Launch & Strong Drive',          color: '#00e676' },
  { maxMs: 300, rating: 'Good',        quality: 'Solid Start & Good Traction',          color: '#ffd60a' },
  { maxMs: 450, rating: 'Slow',        quality: 'Sluggish Reaction — Lost Momentum',    color: '#ff9900' },
  { maxMs: Infinity, rating: 'Very Slow', quality: 'Bogged Down — Vulnerable to Attack',color: '#ff3d00' },
];

export class LaunchManager {
  /**
   * @param {object} engine – reference to parent RaceEngine
   */
  constructor(engine) {
    this.engine = engine;
    this.state = StartStates.GRID;

    // 5 Red Lights boolean array
    this.lights = [false, false, false, false, false];

    // High-res monotonic timestamps
    this.sequenceStartTime = 0;
    this.lightsOutTimestamp = 0; // performance.now() when lights extinguished
    this.lightsOutSimTime = 0;   // simTime when lights extinguished
    this.randomHoldDurationMs = 0; // randomized hold interval

    // Player launch state
    this.playerCarIdx = 0;
    this.playerReacted = false;
    this.playerReactionMs = null;
    this.playerRating = null;
    this.playerLaunchQuality = null;
    this.playerRatingColor = '#888';
    this.playerLaunchSimTime = null; // simTime when player's throttle engages

    // Early press / False start
    this.earlyPressDetected = false;
    this.earlyPressWarning = '';
    this.earlyPenaltyDelayS = 0.50; // 500ms anti-stall hesitation penalty

    // AI drivers reaction map (carIndex -> reactionDelayS)
    this.aiReactions = new Map();

    // Position tracking at launch vs 5 seconds later
    this.gridPositionAtStart = 1;
    this.positionAfterLaunch = 1;

    // Optional event hook triggered when race start lights first appear
    this.onLightsStart = null;

    // Sequence timer handle
    this._sequenceTimer = null;
    this._pendingServerLightsOut = false;
  }

  /**
   * Reset launch system for grid formation.
   * @param {number} playerIdx – index of user's selected driver
   */
  reset(playerIdx = 0) {
    if (this._sequenceTimer) clearTimeout(this._sequenceTimer);
    this.state = StartStates.GRID;
    this.lights = [false, false, false, false, false];
    this.sequenceStartTime = 0;
    this.lightsOutTimestamp = 0;
    this.lightsOutSimTime = 0;
    this.randomHoldDurationMs = 0;

    this.playerCarIdx = playerIdx;
    this.playerReacted = false;
    this.playerReactionMs = null;
    this.playerRating = null;
    this.playerLaunchQuality = null;
    this.playerRatingColor = '#888';
    this.playerLaunchSimTime = null;

    this.earlyPressDetected = false;
    this.earlyPressWarning = '';
    this._pendingServerLightsOut = false;
    this.aiReactions.clear();

    const car = this.engine.cars[playerIdx];
    this.gridPositionAtStart = car ? car.position : 1;
    this.positionAfterLaunch = this.gridPositionAtStart;
  }

  /**
   * Cancel any scheduled lights out timer.
   */
  cancelSequence() {
    if (this._sequenceTimer) {
      clearTimeout(this._sequenceTimer);
      this._sequenceTimer = null;
    }
  }

  /**
   * Force transition into active racing mode (used for multiplayer synchronized start).
   */
  forceRacing() {
    this.cancelSequence();
    this.lights = [false, false, false, false, false];
    this.state = StartStates.RACING;
    this.playerReacted = true;
    this.lightsOutTimestamp = performance.now();
    this.lightsOutSimTime = this.engine ? this.engine.simTime : 0;
    this.playerLaunchSimTime = this.lightsOutSimTime;
  }

  /**
   * Begin the FIA 5-red-light starting sequence.
   */
  startSequence() {
    this.reset(this.engine.selectedCarIdx);
    this.state = StartStates.LIGHTS_1;
    this.sequenceStartTime = performance.now();

    // Trigger race start lights event hook (e.g. pause background menu soundtrack)
    if (typeof this.onLightsStart === 'function') {
      try { this.onLightsStart(); } catch (e) { console.warn('onLightsStart error:', e); }
    }

    // Randomized hold interval after 5th light (1.2s to 3.0s)
    this.randomHoldDurationMs = 1200 + Math.random() * 1800;

    // Generate independent reaction times for all AI drivers
    this._generateAIReactions();

    // Schedule 5 sequential red lights (1 second apart)
    this._scheduleNextLight(1);
  }

  _scheduleNextLight(step) {
    if (this._sequenceTimer) clearTimeout(this._sequenceTimer);

    if (step >= 1 && step <= 5) {
      this.lights[step - 1] = true;
      this.state = `lights_${step}`;

      if (step < 5) {
        this._sequenceTimer = setTimeout(() => this._scheduleNextLight(step + 1), 900);
      } else {
        // All 5 lights ON!
        this.state = StartStates.WAITING_FOR_LIGHTS_OUT;
        if (this.engine?.isMultiplayer) {
          // Server decides when the lights go out. If its message already arrived
          // (slow device), release shortly after light 5 so all five lights show.
          if (this._pendingServerLightsOut) {
            this._sequenceTimer = setTimeout(() => this._triggerLightsOut(), 300);
          } else {
            // Safety fallback: if server message is delayed or dropped, release after 4.5s max hold
            this._sequenceTimer = setTimeout(() => {
              if (this.state === StartStates.WAITING_FOR_LIGHTS_OUT) {
                this._triggerLightsOut();
              }
            }, 4500);
          }
        } else {
          this._sequenceTimer = setTimeout(() => this._triggerLightsOut(), this.randomHoldDurationMs);
        }
      }
    }
  }

  /** Multiplayer: called when the server says lights out. */
  triggerServerLightsOut() {
    if (this.state === StartStates.LIGHTS_OUT || this.state === StartStates.RACING) return;
    if (this.state === StartStates.WAITING_FOR_LIGHTS_OUT) {
      this.cancelSequence();
      this._triggerLightsOut();   // this already calls engine.start()
    } else {
      this._pendingServerLightsOut = true; // lights 1–5 still running, finish them first
    }
  }

  /**
   * Authoritative LIGHTS OUT event.
   * All 5 red lights extinguish simultaneously.
   */
  _triggerLightsOut() {
    this.lights = [false, false, false, false, false];
    this.state = StartStates.LIGHTS_OUT;
    this.lightsOutTimestamp = performance.now();

    // Start engine racing clock (engine.start resets simTime to 0)
    this.engine.start();

    // Align lightsOutSimTime with the new clock
    this.lightsOutSimTime = this.engine.simTime;

    // If player already committed an early press, penalize their launch
    if (this.earlyPressDetected) {
      this.playerReacted = true;
      this.playerReactionMs = 500;
      this.playerRating = 'Jump Start / Anti-Stall';
      this.playerLaunchQuality = 'Anti-Stall Triggered — Heavy Acceleration Penalty';
      this.playerRatingColor = '#ff3d00';
      this.playerLaunchSimTime = this.engine.simTime + this.earlyPenaltyDelayS;
    }
  }

  /**
   * Player presses LAUNCH button or Spacebar.
   *
   * @param {number} inputTimestamp – performance.now()
   * @returns {object} { success, early, reactionMs, rating, quality }
   */
  registerPlayerLaunch(inputTimestamp = performance.now()) {
    // 1. Check if pressed prematurely (before lights out)
    if (this.state !== StartStates.LIGHTS_OUT && this.state !== StartStates.RACING) {
      this.earlyPressDetected = true;
      this.earlyPressWarning = 'TOO EARLY! JUMP START DETECTED — Anti-stall penalty applied!';
      return {
        success: false,
        early: true,
        message: this.earlyPressWarning
      };
    }

    // 2. Prevent repeated clicks
    if (this.playerReacted) {
      return {
        success: true,
        alreadyLaunched: true,
        reactionMs: this.playerReactionMs,
        rating: this.playerRating
      };
    }

    // 3. Valid launch! Measure high-resolution reaction time
    const elapsedMs = Math.max(1, Math.round(inputTimestamp - this.lightsOutTimestamp));
    this.playerReacted = true;
    this.playerReactionMs = elapsedMs;

    // Classify performance band
    const band = REACTION_BANDS.find(b => elapsedMs <= b.maxMs) || REACTION_BANDS[REACTION_BANDS.length - 1];
    this.playerRating = band.rating;
    this.playerRatingColor = band.color;

    // Assess launch quality with vehicle traction and tyre grip
    const playerCar = this.engine.cars[this.playerCarIdx];
    const tyreGrip = playerCar?.currentGrip ?? 1.0;
    const isWet = (playerCar?.currentWetness ?? 0) > 0.20;

    let qualityDesc = band.quality;
    if (isWet && tyreGrip < 0.70) {
      qualityDesc += ' · Wheelspin on slippery surface!';
    } else if (tyreGrip > 1.05 && elapsedMs < 200) {
      qualityDesc += ' · Hooked up cleanly off the line!';
    }
    this.playerLaunchQuality = qualityDesc;

    // Translate reaction time into simulation launch delay
    // Reaction delay in sim seconds: effectiveReactionMs / 1000
    const mgrAssistMs = playerCar?.manager?.modifiers?.launchAssistMs ?? 0;
    const effectiveReactionMs = Math.max(120, elapsedMs - mgrAssistMs);
    const delayS = effectiveReactionMs / 1000;
    this.playerLaunchSimTime = this.lightsOutSimTime + delayS;

    return {
      success: true,
      early: false,
      reactionMs: elapsedMs,
      rating: this.playerRating,
      quality: this.playerLaunchQuality,
      color: this.playerRatingColor
    };
  }

  /**
   * Generate independent, realistic reaction times for AI opponents based on driver traits.
   */
  _generateAIReactions() {
    this.aiReactions.clear();
    const cars = this.engine.cars;

    cars.forEach(car => {
      // Driver traits: aggression and pace influence launch reaction
      const pace = car.driver?.pace ?? 0.85;
      const agg = car.driver?.personality?.aggression ?? 0.70;
      const consistency = car.driver?.personality?.consistency ?? 0.80;

      // Base human F1 reaction: 180ms - 290ms
      // Faster drivers (Verstappen, Hamilton, Norris, Alonso): ~170-220ms
      const baseMs = 280 - (pace * 70) - (agg * 30);
      // Random variance per start: ± 25ms scaled by consistency
      const jitterMs = (Math.random() - 0.5) * 50 * (1.3 - consistency * 0.4);

      const reactionMs = Math.max(160, Math.min(420, baseMs + jitterMs));
      this.aiReactions.set(car.i, reactionMs / 1000); // store as seconds
    });
  }

  /**
   * Called each physics step from RaceEngine.
   * Restricts vehicle throttle and movement until each car's reaction time has elapsed.
   *
   * @param {object} car     – current car state
   * @param {number} simTime – current simulation time
   * @returns {object} { canAccelerate, throttleModifier, isReacting }
   */
  evaluateCarLaunch(car, simTime) {
    // If not in starting phase, normal racing physics apply
    if (this.state !== StartStates.LIGHTS_OUT && this.state !== StartStates.WAITING_FOR_LIGHTS_OUT &&
        this.state !== StartStates.GRID && !this.state.startsWith('lights_')) {
      return { canAccelerate: true, throttleModifier: 1.0, isReacting: false };
    }

    // Pre-start: before lights out, NO car may move
    if (this.state !== StartStates.LIGHTS_OUT) {
      car.v = 0;
      car.throttle = 0;
      car.brake = 1;
      return { canAccelerate: false, throttleModifier: 0, isReacting: true };
    }

    // ── LIGHTS OUT ACTIVE ──
    const isPlayer = (car.i === this.playerCarIdx);

    let launchTime = 0;
    if (isPlayer) {
      // Auto-stall protection: If player has not reacted after 1.8s of lights out,
      // auto-release with anti-stall penalty so car is never permanently stuck on grid.
      if (this.state === StartStates.LIGHTS_OUT && !this.playerReacted && (simTime - this.lightsOutSimTime >= 1.8)) {
        this.playerReacted = true;
        this.playerReactionMs = 1800;
        this.playerRating = 'Very Slow';
        this.playerLaunchQuality = 'Anti-Stall Auto-Release — Delayed Start';
        this.playerRatingColor = '#ff3d00';
        this.playerLaunchSimTime = this.lightsOutSimTime + 1.8;
      }

      if (!this.playerReacted) {
        // Player has not pressed LAUNCH yet: car remains stationary on grid!
        car.v = 0;
        car.throttle = 0;
        car.brake = 1;
        return { canAccelerate: false, throttleModifier: 0, isReacting: true };
      }
      launchTime = this.playerLaunchSimTime;
    } else {
      // AI opponent reaction delay
      const delayS = this.aiReactions.get(car.i) || 0.22;
      launchTime = this.lightsOutSimTime + delayS;
    }

    // If car has not reached its reaction moment yet: hold on grid
    if (simTime < launchTime) {
      car.v = 0;
      car.throttle = 0;
      car.brake = 1;
      return { canAccelerate: false, throttleModifier: 0, isReacting: true };
    }

    // Car has reacted and is now launching!
    // Smooth throttle ramp off the line (0 -> 1 over 0.6s)
    const timeSinceLaunch = simTime - launchTime;
    const rampFactor = Math.min(1.0, timeSinceLaunch / 0.60);

    // If car launched smoothly, transition out of launch phase after 5 seconds
    if (simTime - this.lightsOutSimTime > 5.0 && this.state === StartStates.LIGHTS_OUT) {
      this.state = StartStates.RACING;
    }

    return {
      canAccelerate: true,
      throttleModifier: rampFactor,
      isReacting: false
    };
  }

  /**
   * Get telemetry payload for UI gantry and launch button.
   */
  getLaunchTelemetry() {
    const playerCar = this.engine.cars[this.playerCarIdx];
    return {
      state: this.state,
      lights: this.lights,
      inSequence: this.state !== StartStates.RACING && this.state !== StartStates.GRID,
      isLightsOut: this.state === StartStates.LIGHTS_OUT || this.state === StartStates.RACING,
      playerReacted: this.playerReacted,
      reactionMs: this.playerReactionMs,
      rating: this.playerRating,
      ratingColor: this.playerRatingColor,
      launchQuality: this.playerLaunchQuality,
      earlyPress: this.earlyPressDetected,
      earlyWarning: this.earlyPressWarning,
      gridPos: this.gridPositionAtStart,
      currentPos: playerCar ? playerCar.position : 1,
      posDelta: playerCar ? (this.gridPositionAtStart - playerCar.position) : 0
    };
  }
}
