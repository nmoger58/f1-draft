/**
 * compare_benchmarks.mjs
 * Runs controlled before/after race comparisons on Monza, Silverstone, and Spa.
 */

import { RaceEngine, RaceState } from './src/simulation/raceEngine.js';
import { buildTrack } from './src/simulation/trackManager.js';
import { getCircuit, RAW_WAYPOINTS } from './src/data/circuitData.js';
import { getGrid } from './src/data/driverData.js';

function benchmarkRace(circuitId, fieldSize = 10, totalLaps = 3) {
  const circuit = getCircuit(circuitId);
  const track = buildTrack(circuit, RAW_WAYPOINTS[circuitId]);
  const grid = getGrid(fieldSize);
  const engine = new RaceEngine();
  engine.build(track, grid, totalLaps, { weatherPreset: 'DRY' });
  engine.state = RaceState.RACING;
  engine.flag = 'green';
  engine.raceControl.state = 'green';
  engine.launchManager.state = 'racing';

  let completedOvertakes = 0;
  let emergencyBrakes = 0;
  let sideBySideTicks = 0;
  let clearanceBreaches = 0;
  let prevPositions = engine.cars.map(c => c.code);

  const L = track.circuit.lengthM;
  const k = track.k;
  const carWidthPx = 3.6 * k;

  const dt = 0.05;
  const maxSteps = Math.round((totalLaps * circuit.rec * 1.35) / dt);

  for (let s = 0; s < maxSteps; s++) {
    if (engine.cars.every(c => c.lap >= totalLaps)) break;
    engine.step(dt);

    const currentOrder = engine.standings.map(c => c.code);
    for (let i = 0; i < currentOrder.length; i++) {
      if (prevPositions[i] && prevPositions[i] !== currentOrder[i]) {
        completedOvertakes++;
      }
    }
    prevPositions = currentOrder;

    for (let i = 0; i < engine.cars.length; i++) {
      const c1 = engine.cars[i];
      if (c1.drivingPlan?.emergencyBrakeTriggered) emergencyBrakes++;

      for (let j = i + 1; j < engine.cars.length; j++) {
        const c2 = engine.cars[j];
        const dDiff = (((c1.d - c2.d) % L) + L) % L;
        const forwardGap = Math.min(dDiff, L - dDiff);
        const latDiff = Math.abs(c1.lat - c2.lat);

        if (forwardGap < 8.0) {
          if (latDiff >= carWidthPx * 0.9) {
            sideBySideTicks++;
          } else {
            clearanceBreaches++;
          }
        }
      }
    }
  }

  const bestLap = Math.min(...engine.cars.map(c => c.bestLap || 999));

  return {
    circuit: circuitId,
    trackAvgWidth: Number((track.avgWidth / k).toFixed(1)),
    completedOvertakes: Math.round(completedOvertakes / 2),
    sideBySideSeconds: Number((sideBySideTicks * dt).toFixed(1)),
    clearanceBreaches,
    emergencyBrakes,
    bestLap: Number(bestLap.toFixed(2))
  };
}

console.log('🏁 RUNNING CONTROLLED BENCHMARK COMPARISON 🏁\n');
const results = [
  benchmarkRace('monza', 10, 3),
  benchmarkRace('silverstone', 10, 3),
  benchmarkRace('spa', 10, 3)
];

console.table(results);
