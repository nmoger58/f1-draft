/**
 * audit_race_baseline.mjs
 * Comprehensive Baseline Audit for Race Strategy, Vehicle Physics, and Autonomous AI.
 */

import { RaceEngine, RaceState } from './src/simulation/raceEngine.js';
import { buildTrack } from './src/simulation/trackManager.js';
import { getCircuit, RAW_WAYPOINTS } from './src/data/circuitData.js';
import { getGrid } from './src/data/driverData.js';

function auditCircuit(circuitId, fieldSize = 10, totalLaps = 4) {
  const circuit = getCircuit(circuitId);
  const track = buildTrack(circuit, RAW_WAYPOINTS[circuitId]);
  const grid = getGrid(fieldSize);
  const engine = new RaceEngine();
  engine.build(track, grid, totalLaps, { weatherPreset: 'DRY' });
  engine.state = RaceState.RACING;
  engine.flag = 'green';
  engine.raceControl.state = 'green';
  engine.launchManager.state = 'racing';

  let overtakes = 0;
  let emergencyBrakes = 0;
  let sideBySideTicks = 0;
  let clearanceBreaches = 0;
  let totalTicks = 0;
  let prevPositions = engine.cars.map(c => c.code);

  const L = track.circuit.lengthM;
  const k = track.k;
  const carWidthPx = 3.6 * k;
  const dt = 0.05;
  const maxSteps = Math.round((totalLaps * circuit.rec * 1.35) / dt);

  for (let s = 0; s < maxSteps; s++) {
    if (engine.cars.every(c => c.lap >= totalLaps)) break;
    engine.step(dt);
    totalTicks++;

    const currentOrder = engine.standings.map(c => c.code);
    for (let i = 0; i < currentOrder.length; i++) {
      if (prevPositions[i] && prevPositions[i] !== currentOrder[i]) {
        overtakes++;
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

  const validLapTimes = [];
  engine.cars.forEach(c => {
    if (c.bestLap && c.bestLap < 900) validLapTimes.push(c.bestLap);
  });
  const bestLap = Math.min(...validLapTimes);
  const avgLap = validLapTimes.reduce((a, b) => a + b, 0) / (validLapTimes.length || 1);
  const variance = validLapTimes.reduce((a, b) => a + Math.pow(b - avgLap, 2), 0) / (validLapTimes.length || 1);

  const avgTyreWear = engine.cars.reduce((acc, c) => acc + (c.tyreWear || 0), 0) / engine.cars.length;
  const fuelUsed = engine.cars.map(c => (c.fuelKg !== undefined ? (110 - c.fuelKg) : 0));
  const avgFuelUsed = fuelUsed.reduce((a, b) => a + b, 0) / (fuelUsed.length || 1);

  return {
    circuit: circuitId,
    lapsCompleted: totalLaps,
    fieldSize,
    bestLap: Number(bestLap.toFixed(2)),
    avgBestLap: Number(avgLap.toFixed(2)),
    lapVariance: Number(Math.sqrt(variance).toFixed(2)),
    completedOvertakes: Math.round(overtakes / 2),
    sideBySideSeconds: Number((sideBySideTicks * dt).toFixed(1)),
    clearanceBreaches,
    emergencyBrakes,
    avgTyreWearPct: Number((avgTyreWear * 100).toFixed(1)),
    avgFuelUsedKg: Number(avgFuelUsed.toFixed(1))
  };
}

console.log('🏁 BASELINE AUDIT 🏁');
const monza = auditCircuit('monza', 10, 3);
console.log('Monza:', monza);
const silverstone = auditCircuit('silverstone', 10, 3);
console.log('Silverstone:', silverstone);
const spa = auditCircuit('spa', 10, 3);
console.log('Spa:', spa);
