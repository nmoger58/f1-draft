# Intelligent Formula 1 Autonomous Racing Simulator 2.0

An intelligent, multi-car Formula 1 racing simulation powered by autonomous driver agents, real GPS track geometry, fixed-step physics, dynamic tyre strategy, and an interactive real-time motorsport control centre.

---

## 🏎️ Key Features

1. **Modular Native ES Architecture**: Zero build tools required; runs directly in the browser via standard ES modules.
2. **8 Real Formula 1 Circuits**: Monaco, Silverstone, Spa-Francorchamps, Monza, Marina Bay (Singapore), Suzuka, Interlagos (São Paulo), and Baku City Circuit.
3. **Multi-Car Grid (Up to 20 Cars)**: Full 2025/2026 driver grid with authentic liveries, car numbers, constructors, and power units.
4. **Autonomous AI Driver Agents**:
   - Track-aware lookahead speed planning (centripetal Catmull-Rom curvature modeling).
   - Adaptive Cruise Control (ACC) with Time-To-Collision (TTC) predictive avoidance.
   - Tactical racecraft: DRS detection, slipstreaming, defensive lines, and commit/abort overtake state machine.
   - Individual driver personalities (aggression, tyre management, consistency, racecraft, attack skill).
   - Reinforcement learning adaptive policy layer (tabular Q-learning with Bellman updates).
5. **Dynamic Race Strategy**:
   - Multi-compound tyre model (Soft, Medium, Hard) with wear degradation and performance bonus.
   - Pit stop timing decisions and distance-adjusted pit penalties.
6. **Live Motorsport Telemetry & Control Center**:
   - Real-time speedometer, digital gear indicator, throttle & brake pedal gauges.
   - Live leaderboard with dynamic intervals, sector splits, and tyre condition.
   - AI Race Engineer panel providing live voice-of-driver radio updates.
   - Overview, Follow, and Chase Camera modes with dynamic velocity-oriented zoom and rotation.

---

## 📂 Project Architecture

```
f1-simulator/
├── index.html                 # Modern Motorsport Dashboard UI shell
├── package.json               # NPM metadata & test runner scripts
├── server.js                  # Lightweight local static file server
├── validate.mjs               # 8-Circuit headless automated test suite
├── benchmark.mjs              # 20-car multi-car stress & performance benchmark
├── styles/
│   └── main.css               # Motorsport dark/light theme & dashboard layout
└── src/
    ├── app.js                 # Entry point: orchestration & animation loop
    ├── config/
    │   └── simulationConfig.js # Tunable physics, AI, and race parameters
    ├── data/
    │   ├── circuitData.js     # GPS centrelines, DRS zones & circuit metadata
    │   └── driverData.js      # 2025/2026 F1 grid & personality matrices
    ├── simulation/
    │   ├── trackManager.js    # Spline smoothing, relax solver & speed model
    │   ├── physicsEngine.js   # Fixed-step kinematics, lateral grip & braking
    │   └── raceEngine.js      # Race director state machine & pit manager
    ├── ai/
    │   ├── driverAgent.js     # Autonomous multi-car racecraft decision agent
    │   └── reinforcementLearning.js # Adaptive Q-learning policy optimizer
    ├── strategy/
    │   └── tyreStrategy.js    # Pirelli compound degradation & stint manager
    ├── visualization/
    │   ├── trackRenderer.js   # SVG track geometry, kerbs, trees & bridges
    │   ├── carRenderer.js     # Scaled vehicle sprites & driver tags
    │   └── cameraController.js# Smooth overview / follow / chase camera
    └── ui/
        ├── leaderboard.js     # Dynamic timing tower with live gaps & wear
        ├── telemetryDashboard.js # Real-time pedals, speed & flag status
        └── engineerLog.js     # AI decision feed & team radio messages
```

---

## 🚀 Quick Start Instructions

### Running with Node.js
```bash
cd f1-simulator
node server.js
```
Open **`http://localhost:8765/`** in your web browser.

### Running Automated Test Suites
```bash
# 8-Circuit comprehensive autonomous lap test
node validate.mjs

# 20-Car grid performance and personality benchmark
node benchmark.mjs
```

---

## 🎮 Keyboard & Simulation Controls

| Key / Control | Action |
|---|---|
| **Space** | Pause / Resume Race |
| **R** | Restart Current Grand Prix |
| **+ / −** or **Mouse Wheel** | Zoom in / out |
| **1** | Whole Track (Overview camera) |
| **2** | Follow Selected Car |
| **3** | Chase Cam (Oriented to car heading) |
| **Grid Selector** | Switch from 1 to 20 cars |
| **Speed (1× / 5× / 10×)** | Simulation speed warp |
| **Mode (Real / Sector / Speed)** | Heatmap speed & sector overlays |
