/**
 * test_quick_race_setup.mjs
 * Authoritative Automated Test Suite for F1 Quick Race Mode Setup Wizard,
 * Field Size, Lap/Distance Conversions, Grid Modes, Persistence, Rules & Classification.
 */

import assert from 'assert';
import {
  FIELD_SIZE_PRESETS,
  LAP_PRESETS,
  DISTANCE_PRESETS,
  GRID_MODES,
  WEATHER_OPTIONS,
  AI_DIFFICULTIES,
  DEFAULT_QUICK_RACE_CONFIG,
  calculateLapsFromDistance,
  validateQuickRaceConfig,
  buildStartingGrid,
  saveLastQuickRaceConfig,
  loadLastQuickRaceConfig,
  getQuickRacePresets,
  saveQuickRacePreset,
  deleteQuickRacePreset,
  STORAGE_KEY_LAST_CONFIG,
  STORAGE_KEY_PRESETS
} from '../src/quickrace/quickRaceConfig.js';
import { QuickRaceManager, formatLapTime } from '../src/quickrace/quickRaceManager.js';
import { CIRCUITS, RAW_WAYPOINTS, getCircuit } from '../src/data/circuitData.js';
import { DRIVERS, getDriver } from '../src/data/driverData.js';
import { MANAGERS, getManager } from '../src/data/managerData.js';
import { CARS, getCar } from '../src/data/carData.js';
import { buildTrack } from '../src/simulation/trackManager.js';
import { RaceEngine, RaceState } from '../src/simulation/raceEngine.js';
import { getSharedDraftEngine } from '../src/strategy/draftEngine.js';

let totalTests = 0;
let passedTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ✓ [TEST ${totalTests}] ${name}`);
  } catch (err) {
    console.error(`  ✗ [FAIL ${totalTests}] ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

// Mock localStorage for Node.js test environment
const mockStorage = new Map();
globalThis.localStorage = {
  getItem: (k) => mockStorage.get(k) || null,
  setItem: (k, v) => mockStorage.set(k, String(v)),
  removeItem: (k) => mockStorage.delete(k),
  clear: () => mockStorage.clear()
};

console.log('🏁 Starting Quick Race Setup Mode Verification Suite...\n');

// ── 1. Default Configuration & Schema ────────────────────────────────────────

runTest('Default configuration generation produces valid config with all required keys', () => {
  const cfg = DEFAULT_QUICK_RACE_CONFIG;
  assert.ok(cfg, 'Default config must exist');
  assert.strictEqual(cfg.circuitId, 'silverstone');
  assert.strictEqual(cfg.fieldSize, 20);
  assert.strictEqual(cfg.totalLaps, 5);
  assert.strictEqual(cfg.lapMode, 'laps');
  assert.strictEqual(cfg.playerDriverCode, 'HAM');
  assert.strictEqual(cfg.aiDifficulty, 'normal');
  assert.strictEqual(cfg.weatherPreset, 'DRY');
  assert.strictEqual(cfg.startingCompound, 'medium');
  assert.strictEqual(cfg.safetyCarEnabled, true);

  const res = validateQuickRaceConfig(cfg);
  assert.strictEqual(res.valid, true, 'Default config must pass validation');
  assert.strictEqual(res.errors.length, 0);
});

// ── 2. Validation Bounds ──────────────────────────────────────────────────

runTest('Configuration validation correctly rejects invalid field sizes (< 2 or > 20)', () => {
  const invalidLow = { ...DEFAULT_QUICK_RACE_CONFIG, fieldSize: 1 };
  const resLow = validateQuickRaceConfig(invalidLow);
  assert.strictEqual(resLow.valid, false);
  assert.ok(resLow.errors.some(e => e.includes('fieldSize')));

  const invalidHigh = { ...DEFAULT_QUICK_RACE_CONFIG, fieldSize: 25 };
  const resHigh = validateQuickRaceConfig(invalidHigh);
  assert.strictEqual(resHigh.valid, false);
  assert.ok(resHigh.errors.some(e => e.includes('fieldSize')));
});

runTest('Configuration validation correctly rejects invalid lap counts (< 1 or > 100)', () => {
  const invalidZero = { ...DEFAULT_QUICK_RACE_CONFIG, totalLaps: 0 };
  const resZero = validateQuickRaceConfig(invalidZero);
  assert.strictEqual(resZero.valid, false);
  assert.ok(resZero.errors.some(e => e.includes('totalLaps')));

  const invalidOver = { ...DEFAULT_QUICK_RACE_CONFIG, totalLaps: 105 };
  const resOver = validateQuickRaceConfig(invalidOver);
  assert.strictEqual(resOver.valid, false);
  assert.ok(resOver.errors.some(e => e.includes('totalLaps')));
});

runTest('Configuration validation validates circuitId against known circuits', () => {
  const invalidCircuit = { ...DEFAULT_QUICK_RACE_CONFIG, circuitId: 'nurburgring' };
  const resCircuit = validateQuickRaceConfig(invalidCircuit);
  assert.strictEqual(resCircuit.valid, false);
  assert.ok(resCircuit.errors.some(e => e.includes('circuitId')));
});

// ── 3. Distance-to-Laps Calculator ────────────────────────────────────────

runTest('Distance-to-laps calculation accurately computes whole laps and explanation in British English', () => {
  // Monaco: 3337m. Target: 25km. 25000 / 3337 = 7.491 -> ceil = 8 laps. 8 * 3337 = 26696m = 26.70km
  const monacoCalc = calculateLapsFromDistance(3337, 25, 'Circuit de Monaco');
  assert.strictEqual(monacoCalc.laps, 8, 'Monaco 25km target must equal 8 laps');
  assert.strictEqual(monacoCalc.actualDistanceKm, 26.70);
  assert.ok(monacoCalc.explanation.includes('metres'), 'Must use British English "metres"');
  assert.ok(monacoCalc.explanation.includes('kilometres'), 'Must use British English "kilometres"');
  assert.ok(monacoCalc.explanation.includes('8 whole laps'));

  // Silverstone: 5891m. Target: 50km. 50000 / 5891 = 8.487 -> ceil = 9 laps. 9 * 5891 = 53019m = 53.02km
  const silverstoneCalc = calculateLapsFromDistance(5891, 50, 'Silverstone Circuit');
  assert.strictEqual(silverstoneCalc.laps, 9);
  assert.strictEqual(silverstoneCalc.actualDistanceKm, 53.02);

  // Spa: 7004m. Target: 100km. 100000 / 7004 = 14.277 -> ceil = 15 laps. 15 * 7004 = 105060m = 105.06km
  const spaCalc = calculateLapsFromDistance(7004, 100, 'Circuit de Spa-Francorchamps');
  assert.strictEqual(spaCalc.laps, 15);
  assert.strictEqual(spaCalc.actualDistanceKm, 105.06);
});

// ── 4. Field Size Presets & Deduplication ──────────────────────────────────

runTest('Field size presets (2, 5, 10, 15, 20) generate grids of exact size', () => {
  const sizes = [2, 5, 10, 15, 20];
  sizes.forEach(size => {
    const config = { ...DEFAULT_QUICK_RACE_CONFIG, fieldSize: size };
    const gridData = buildStartingGrid(config);
    assert.strictEqual(gridData.gridDrivers.length, size, `Grid must contain exactly ${size} drivers`);
  });
});

runTest('Grid generation guarantees player driver is included and never duplicated in AI opponents', () => {
  const playerCodes = ['VER', 'HAM', 'NOR', 'LEC', 'ALO', 'PIA'];
  playerCodes.forEach(code => {
    const config = { ...DEFAULT_QUICK_RACE_CONFIG, playerDriverCode: code, fieldSize: 10 };
    const gridData = buildStartingGrid(config);

    // Player exists
    const occurrences = gridData.gridDrivers.filter(d => d.code === code).length;
    assert.strictEqual(occurrences, 1, `Player driver ${code} must appear exactly once in the grid`);

    // All driver codes are unique
    const uniqueCodes = new Set(gridData.gridDrivers.map(d => d.code));
    assert.strictEqual(uniqueCodes.size, 10, 'All 10 drivers on the grid must have unique driver codes');

    // PlayerCarIdx accurately points to player driver
    assert.strictEqual(gridData.gridDrivers[gridData.playerCarIdx].code, code);
  });
});

// ── 5. Grid Modes ─────────────────────────────────────────────────────────

runTest('Qualifying grid mode integrates QualifyingEngine and produces ordered starting positions', () => {
  const config = {
    ...DEFAULT_QUICK_RACE_CONFIG,
    gridMode: 'qualifying',
    circuitId: 'silverstone',
    playerDriverCode: 'HAM',
    aiDifficulty: 'normal',
    fieldSize: 10,
    randomSeed: 42
  };

  const gridData = buildStartingGrid(config);
  assert.strictEqual(gridData.gridDrivers.length, 10);
  assert.ok(gridData.qualifyingResults, 'Qualifying results must be attached');
  assert.strictEqual(gridData.qualifyingResults.length, 10);

  // Results should be ascending by lap time
  for (let i = 0; i < gridData.qualifyingResults.length - 1; i++) {
    assert.ok(gridData.qualifyingResults[i].lapTimeS <= gridData.qualifyingResults[i + 1].lapTimeS, 'Qualifying times must be ordered ascending');
  }

  // Pole position check
  assert.strictEqual(gridData.qualifyingResults[0].position, 1);
  assert.strictEqual(gridData.qualifyingResults[0].isPole, true);
  assert.strictEqual(gridData.qualifyingResults[0].gapS, 0);

  // Player index aligns
  assert.strictEqual(gridData.gridDrivers[gridData.playerCarIdx].code, 'HAM');
});

runTest('Random grid mode shuffles starting positions deterministically when seed is provided', () => {
  const configA = {
    ...DEFAULT_QUICK_RACE_CONFIG,
    gridMode: 'random',
    fieldSize: 10,
    playerDriverCode: 'VER',
    randomSeed: 12345
  };
  const configB = {
    ...DEFAULT_QUICK_RACE_CONFIG,
    gridMode: 'random',
    fieldSize: 10,
    playerDriverCode: 'VER',
    randomSeed: 12345
  };

  const gridA = buildStartingGrid(configA);
  const gridB = buildStartingGrid(configB);

  assert.deepStrictEqual(
    gridA.gridDrivers.map(d => d.code),
    gridB.gridDrivers.map(d => d.code),
    'Deterministic seed must generate identical random grid order'
  );
  assert.strictEqual(gridA.playerCarIdx, gridB.playerCarIdx);
});

runTest('Performance grid mode ranks drivers based on driver pace and car modifiers', () => {
  const config = {
    ...DEFAULT_QUICK_RACE_CONFIG,
    gridMode: 'performance',
    fieldSize: 10,
    playerDriverCode: 'VER',
    playerCarId: 'car_rb20'
  };

  const gridData = buildStartingGrid(config);
  assert.strictEqual(gridData.gridDrivers.length, 10);

  // The top cars should have high pace ratings
  const topCar = gridData.gridDrivers[0];
  const bottomCar = gridData.gridDrivers[gridData.gridDrivers.length - 1];
  assert.ok((topCar.pace || 0.95) >= (bottomCar.pace || 0.95), 'Top car pace should be >= bottom car pace in performance mode');
});

runTest('Custom grid mode allows placing player at specified position (P1 pole, P10 midfield, P20 back)', () => {
  // Test P1
  const configP1 = {
    ...DEFAULT_QUICK_RACE_CONFIG,
    gridMode: 'custom',
    customPlayerPosition: 1,
    fieldSize: 20,
    playerDriverCode: 'NOR'
  };
  const gridP1 = buildStartingGrid(configP1);
  assert.strictEqual(gridP1.playerCarIdx, 0);
  assert.strictEqual(gridP1.gridDrivers[0].code, 'NOR');

  // Test P10
  const configP10 = {
    ...DEFAULT_QUICK_RACE_CONFIG,
    gridMode: 'custom',
    customPlayerPosition: 10,
    fieldSize: 20,
    playerDriverCode: 'NOR'
  };
  const gridP10 = buildStartingGrid(configP10);
  assert.strictEqual(gridP10.playerCarIdx, 9);
  assert.strictEqual(gridP10.gridDrivers[9].code, 'NOR');

  // Test P20
  const configP20 = {
    ...DEFAULT_QUICK_RACE_CONFIG,
    gridMode: 'custom',
    customPlayerPosition: 20,
    fieldSize: 20,
    playerDriverCode: 'NOR'
  };
  const gridP20 = buildStartingGrid(configP20);
  assert.strictEqual(gridP20.playerCarIdx, 19);
  assert.strictEqual(gridP20.gridDrivers[19].code, 'NOR');
});

// ── 6. Circuit Metadata & Driver Selection ────────────────────────────────

runTest('Circuit metadata completeness for all 8 circuits', () => {
  assert.strictEqual(CIRCUITS.length, 8, 'There must be exactly 8 official circuits');
  CIRCUITS.forEach(c => {
    assert.ok(c.id, 'Circuit must have id');
    assert.ok(c.name, 'Circuit must have full name');
    assert.ok(c.country, 'Circuit must have country');
    assert.ok(c.lengthM > 1000, 'Circuit lengthM must be > 1000m');
    assert.ok(c.turns > 5, 'Circuit turns must be > 5');
    assert.ok(RAW_WAYPOINTS[c.id]?.length > 20, 'Circuit must have GPS waypoints');
  });
});

runTest('Driver, manager, and car selection metadata properly loaded from authentic rosters', () => {
  assert.strictEqual(DRIVERS.length, 20, '20 Authentic 2025 drivers');
  assert.strictEqual(MANAGERS.length, 8, '8 Authentic team principals');
  assert.strictEqual(CARS.length, 10, '10 Authentic constructor cars');

  // Check specific entities
  const leclerc = getDriver('LEC');
  assert.ok(leclerc && leclerc.name === 'Charles Leclerc');

  const stella = getManager('mgr_stella');
  assert.ok(stella && stella.name === 'Andrea Stella');

  const mclaren = getCar('car_mcl38');
  assert.ok(mclaren && mclaren.name === 'McLaren MCL38');
});

runTest('DraftEngine sync correctly updates when player picks driver, car, or manager', () => {
  const draftEngine = getSharedDraftEngine();
  const qrm = new QuickRaceManager();

  qrm.setConfig({
    playerDriverCode: 'PIA',
    playerCarId: 'car_mcl38',
    playerManagerId: 'mgr_stella'
  });

  const summary = draftEngine.getSummary();
  assert.strictEqual(summary.driver?.code, 'PIA');
  assert.strictEqual(summary.car?.id, 'car_mcl38');
  assert.strictEqual(summary.manager?.id, 'mgr_stella');
});

// ── 7. Race Engine Integration ────────────────────────────────────────────

runTest('AI difficulty multiplier applied properly to AI cars in RaceEngine without altering player pace', () => {
  const circuit = getCircuit('monza');
  const rawPts = RAW_WAYPOINTS.monza;
  const track = buildTrack(circuit, rawPts);

  const engine = new RaceEngine();
  const grid = DRIVERS.slice(0, 5); // 5 cars: player is index 0

  // Easy Difficulty (0.96)
  engine.build(track, grid, 5, {
    playerCarIdx: 0,
    aiDifficulty: 'easy'
  });

  assert.strictEqual(engine.cars[0].isPlayer, true);
  assert.strictEqual(engine.cars[0].aiPaceMult, 1.0, 'Player car pace multiplier must remain 1.0');
  assert.strictEqual(engine.cars[1].isPlayer, false);
  assert.strictEqual(engine.cars[1].aiPaceMult, 0.96, 'AI car pace multiplier must be 0.96 for easy');

  // Expert Difficulty (1.045)
  engine.build(track, grid, 5, {
    playerCarIdx: 0,
    aiDifficulty: 'expert'
  });
  assert.strictEqual(engine.cars[0].aiPaceMult, 1.0, 'Player car pace multiplier must remain 1.0');
  assert.strictEqual(engine.cars[1].aiPaceMult, 1.045, 'AI car pace multiplier must be 1.045 for expert');
});

runTest('Starting tyre compound assigned properly to player car', () => {
  const circuit = getCircuit('monaco');
  const track = buildTrack(circuit, RAW_WAYPOINTS.monaco);
  const engine = new RaceEngine();
  const qrm = new QuickRaceManager();

  qrm.setConfig({ startingCompound: 'soft', playerDriverCode: 'HAM' });
  const gridData = qrm.prepareStartingGrid();
  const opts = qrm.getRaceEngineOptions();

  engine.build(track, gridData.gridDrivers, opts.totalLaps, opts);

  // Player car index
  const pCar = engine.cars[opts.playerCarIdx];
  assert.ok(pCar, 'Player car must exist in engine');
  assert.strictEqual(pCar.code, 'HAM');
  assert.strictEqual(pCar.targetCompound, 'soft');
});

runTest('Weather presets are recognized and configured in RaceEngine', () => {
  const circuit = getCircuit('silverstone');
  const track = buildTrack(circuit, RAW_WAYPOINTS.silverstone);
  const engine = new RaceEngine();

  // Test FULL_WET
  engine.build(track, DRIVERS.slice(0, 4), 3, { weatherPreset: 'FULL_WET' });
  assert.strictEqual(engine.weatherEngine.presetKey, 'FULL_WET');

  // Test DRY
  engine.build(track, DRIVERS.slice(0, 4), 3, { weatherPreset: 'DRY' });
  assert.strictEqual(engine.weatherEngine.presetKey, 'DRY');
});

runTest('Safety car and penalties configuration options passed to engine raceControl', () => {
  const circuit = getCircuit('spa');
  const track = buildTrack(circuit, RAW_WAYPOINTS.spa);
  const engine = new RaceEngine();

  engine.build(track, DRIVERS.slice(0, 4), 3, {
    safetyCarEnabled: false,
    penaltiesEnabled: false
  });

  assert.strictEqual(engine.raceControl.safetyCarEnabled, false);
  assert.strictEqual(engine.raceControl.penaltiesEnabled, false);

  // Deploy safety car should fail gracefully to yellow when safetyCarEnabled is false
  const ok = engine.raceControl.deploySafetyCar(2, 0);
  assert.strictEqual(ok, false, 'deploySafetyCar must return false when safetyCarEnabled is false');
  assert.strictEqual(engine.raceControl.state, 'yellow', 'State should fallback to yellow');
});

// ── 8. Persistence & Presets ──────────────────────────────────────────────

runTest('LocalStorage persistence saves and retrieves last configuration', () => {
  mockStorage.clear();
  const customConfig = {
    ...DEFAULT_QUICK_RACE_CONFIG,
    circuitId: 'suzuka',
    fieldSize: 15,
    totalLaps: 12,
    playerDriverCode: 'ALO',
    aiDifficulty: 'hard'
  };

  saveLastQuickRaceConfig(customConfig);
  assert.ok(mockStorage.has(STORAGE_KEY_LAST_CONFIG));

  const loaded = loadLastQuickRaceConfig();
  assert.strictEqual(loaded.circuitId, 'suzuka');
  assert.strictEqual(loaded.fieldSize, 15);
  assert.strictEqual(loaded.totalLaps, 12);
  assert.strictEqual(loaded.playerDriverCode, 'ALO');
  assert.strictEqual(loaded.aiDifficulty, 'hard');
});

runTest('Named presets system allows saving, listing, loading, and deleting custom presets', () => {
  mockStorage.clear();
  const initialPresets = getQuickRacePresets();
  assert.ok(initialPresets.length >= 4, 'Must have at least 4 built-in presets');

  const customPresetConfig = {
    ...DEFAULT_QUICK_RACE_CONFIG,
    circuitId: 'interlagos',
    fieldSize: 8,
    totalLaps: 7
  };

  const saved = saveQuickRacePreset('Interlagos Sprint', customPresetConfig, '8-car wet sprint');
  assert.strictEqual(saved, true);

  const updatedPresets = getQuickRacePresets();
  const found = updatedPresets.find(p => p.name === 'Interlagos Sprint');
  assert.ok(found, 'Saved user preset must be present');
  assert.strictEqual(found.config.circuitId, 'interlagos');
  assert.strictEqual(found.isUser, true);

  // Delete preset
  const deleted = deleteQuickRacePreset('Interlagos Sprint');
  assert.strictEqual(deleted, true);

  const afterDelete = getQuickRacePresets();
  assert.strictEqual(afterDelete.find(p => p.name === 'Interlagos Sprint'), undefined);
});

// ── 9. Post-Race Classification Calculation ───────────────────────────────

runTest('Classification calculation from finished race correctly computes positions, time gaps, completed laps, and fastest lap', () => {
  const circuit = getCircuit('monaco');
  const track = buildTrack(circuit, RAW_WAYPOINTS.monaco);
  const engine = new RaceEngine();
  const qrm = new QuickRaceManager();

  qrm.setConfig({ circuitId: 'monaco', totalLaps: 3, fieldSize: 4, playerDriverCode: 'HAM' });
  const opts = qrm.getRaceEngineOptions();
  engine.build(track, opts.customGridDrivers, 3, opts);

  // Mock race finish state
  engine.cars[0].finishTime = 220.500;
  engine.cars[0].lap = 3;
  engine.cars[0].bestLap = 73.200;

  engine.cars[1].finishTime = 222.100;
  engine.cars[1].lap = 3;
  engine.cars[1].bestLap = 72.850; // Fastest lap!

  engine.cars[2].finishTime = 225.800;
  engine.cars[2].lap = 3;
  engine.cars[2].bestLap = 74.100;
  engine.cars[2].penalties = [{ reason: 'Jump start', seconds: 5 }];

  engine.cars[3].finishTime = null;
  engine.cars[3].lap = 2; // 1 lap down
  engine.cars[3].bestLap = 75.300;

  engine.cars[0].position = 1;
  engine.cars[1].position = 2;
  engine.cars[2].position = 3;
  engine.cars[3].position = 4;
  engine.state = RaceState.FINISHED;

  const classification = qrm.calculateFinalClassification(engine);
  assert.strictEqual(classification.length, 4);

  // Winner
  assert.strictEqual(classification[0].position, 1);
  assert.strictEqual(classification[0].completedLaps, 3);
  assert.strictEqual(classification[0].hasFastestLap, false);

  // P2: Gap ~ +1.600s, Fastest Lap
  assert.strictEqual(classification[1].position, 2);
  assert.strictEqual(classification[1].gapText, '+1.600s');
  assert.strictEqual(classification[1].hasFastestLap, true);

  // P3: Penalty note
  assert.strictEqual(classification[2].position, 3);
  assert.ok(classification[2].status.includes('+5s Penalty'));

  // P4: 1 Lap down
  assert.strictEqual(classification[3].position, 4);
  assert.strictEqual(classification[3].gapText, '+1 Lap');
});

runTest('Format lap time helper formats seconds correctly', () => {
  assert.strictEqual(formatLapTime(72.909), '1:12.909');
  assert.strictEqual(formatLapTime(87.097), '1:27.097');
  assert.strictEqual(formatLapTime(5.123), '0:05.123');
  assert.strictEqual(formatLapTime(0), '–');
});

runTest('Distance mode dynamically updates total laps based on circuit length', () => {
  const qrm = new QuickRaceManager();

  // Test Distance Mode at Spa (7004m) with 35km target -> ceil(35000/7004) = 5 laps
  qrm.setConfig({
    circuitId: 'spa',
    lapMode: 'distance',
    targetDistanceKm: 35
  });

  const spaLaps = qrm.getEffectiveLaps();
  assert.strictEqual(spaLaps.laps, 5);
  assert.ok(spaLaps.explanation.includes('Spa'));

  // Switch circuit to Monaco (3337m) with same 35km target -> ceil(35000/3337) = 11 laps
  qrm.setConfig({
    circuitId: 'monaco',
    lapMode: 'distance',
    targetDistanceKm: 35
  });

  const monacoLaps = qrm.getEffectiveLaps();
  assert.strictEqual(monacoLaps.laps, 11);
  assert.ok(monacoLaps.explanation.includes('Monaco'));
});

// ── Summary ───────────────────────────────────────────────────────────────

console.log(`\n==================================================`);
console.log(`RESULTS: ${passedTests}/${totalTests} tests passed.`);
console.log(`==================================================\n`);

if (passedTests === totalTests) {
  console.log('✅ ALL QUICK RACE SETUP SUITE TESTS PASSED CLEANLY!');
} else {
  console.error('❌ SOME TESTS FAILED');
  process.exit(1);
}
