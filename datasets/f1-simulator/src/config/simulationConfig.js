/**
 * simulationConfig.js
 * Central configuration for the F1 Autonomous Racing Simulator.
 * Adjust these values to tune physics, AI behaviour, and race rules.
 */

export const SimConfig = {
  // ── Physics ──────────────────────────────────────────────────────────────
  physics: {
    fixedStep: 1 / 60,          // seconds per physics tick
    N: 720,                      // waypoints around the track (must match trackManager)
    lookahead: 12,               // waypoints to look ahead for speed planning
    brakeDecel: 55,              // m/s² peak deceleration (F1 ~5g)
    accelMax: 14,                // m/s² peak acceleration at low speed
    accelFalloff: 0.08,          // acceleration reduction per m/s of speed
    lateralG: 22,                // m/s² peak lateral acceleration (grip limit)
    minSpeed: 4,                 // m/s absolute floor (prevents division by zero)
    maxSpeed: 100,               // m/s absolute cap (≈360 km/h)
    cornerCurvKp: 0.003,         // curvature constant for corner-speed formula
    cornerA0: 22,                // lateral grip constant A0 (v = sqrt(A0/kap))
  },

  // ── AI driver behaviour ───────────────────────────────────────────────────
  ai: {
    // Look-ahead distance in metres for path-following
    pathLookaheadM: 25,
    // Gap threshold (m) to trigger overtake attempt
    overtakeGapThreshold: 60,
    // Minimum side clearance (m) to attempt a side-by-side pass
    sideClearanceMin: 0.9,
    // Maximum lateral offset from centreline (in track-width units 0..1)
    maxLateralOffset: 0.38,
    // Steer gain: how aggressively car steers towards target lateral position
    steerGain: 4.0,
    // Decision tick rate (every N physics steps)
    decisionInterval: 6,
    // Collision avoidance radius (m)
    collisionRadius: 7,
    // DRS activation gap (seconds behind car ahead)
    drsGap: 1.0,
  },

  // ── Race rules ────────────────────────────────────────────────────────────
  race: {
    totalLaps: null,             // null = use circuit default
    pitLaneDeltaS: 22,           // seconds added for a pit stop
    safetyCarDeltaPct: 0.4,      // speed limit during VSC/SC as fraction of normal
    gridSpacingM: 16,            // metres between grid slots (F1 regulations ~16m stagger)
    formationLapDuration: 0,     // seconds (0 = rolling start)
    randomVariance: 0.008,       // lap-to-lap pace variance fraction
  },

  // ── Warp Speed Multipliers ────────────────────────────────────────────────
  warpRates: {
    1: 2.5,                      // Elevated 1x base simulation speed (2.5× real-time)
    2: 5.0,                      // 2x warp
    5: 10.0,                     // 5x warp
    10: 20.0,                    // 10x warp
  },

  // ── Tyre model ────────────────────────────────────────────────────────────
  tyres: {
    compounds: {
      soft:         { colour: '#e8002d', degradPerLap: 0.028, perfBonus: 0.012 },
      medium:       { colour: '#ffd60a', degradPerLap: 0.018, perfBonus: 0.006 },
      hard:         { colour: '#f3f3f3', degradPerLap: 0.010, perfBonus: 0.000 },
      intermediate: { colour: '#39b54a', degradPerLap: 0.018, perfBonus: -0.015 },
      wet:          { colour: '#0072ce', degradPerLap: 0.022, perfBonus: -0.035 },
    },
    criticalWear: 0.70,          // fraction at which tyres become dangerous
    pitWindowOpen: 10,           // lap after which pits are considered
  },

  // ── Rendering ─────────────────────────────────────────────────────────────
  render: {
    boardUpdateMs: 160,          // how often to redraw leaderboard
    engineerLogMax: 12,          // messages kept in the engineer log
    carScale: 0.58,              // scale factor for car SVG sprite
    followZoom: 5,               // default zoom in follow mode
  },
};
