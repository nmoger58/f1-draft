import { RaceEngine, RaceState } from './src/simulation/raceEngine.js';
import { buildTrack } from './src/simulation/trackManager.js';
import { getCircuit, RAW_WAYPOINTS } from './src/data/circuitData.js';
import { getGrid } from './src/data/driverData.js';

function runRaceBenchmark(circuitId, fieldSize = 10, totalLaps = 5) {
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
  const maxSteps = Math.round((totalLaps * circuit.rec * 1.3) / dt);

  for (let s = 0; s < maxSteps; s++) {
    if (engine.cars.every(c => c.lap >= totalLaps)) break;
    engine.step(dt);

    // Track position changes (clean passes)
    const currentOrder = engine.standings.map(c => c.code);
    for (let i = 0; i < currentOrder.length; i++) {
      if (prevPositions[i] && prevPositions[i] !== currentOrder[i]) {
        completedOvertakes++;
      }
    }
    prevPositions = currentOrder;

    // Track side-by-side instances and clearance
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
    completedOvertakes: Math.round(completedOvertakes / 2),
    sideBySideSeconds: Number((sideBySideTicks * dt).toFixed(1)),
    clearanceBreaches,
    emergencyBrakes,
    bestLap: Number(bestLap.toFixed(2))
  };
}

console.log('--- PRE-WIDENING BASELINE BENCHMARKS ---');
const monzaPre = runRaceBenchmark('monza', 10, 3);
console.log('Monza (10 cars, 3 laps):', monzaPre);
const silverstonePre = runRaceBenchmark('silverstone', 10, 3);
console.log('Silverstone (10 cars, 3 laps):', silverstonePre);
