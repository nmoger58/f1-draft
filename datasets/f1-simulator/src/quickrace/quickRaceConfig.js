/**
 * quickRaceConfig.js
 * Authoritative Quick Race Configuration, Validation, Grid Generator,
 * Lap-Distance Converter, and Persistence Engine.
 *
 * Provides:
 *   - Preset options for field size (2..20) and lap/distance modes
 *   - Circuit and driver deduplication guarantees
 *   - Distance-to-whole-laps calculator with British English explanations
 *   - Grid generator supporting Qualifying, Random, Performance, and Custom positioning
 *   - Complete local persistence for last-used configuration and named presets
 */

import { CIRCUITS, getCircuit } from '../data/circuitData.js';
import { DRIVERS, getDriver } from '../data/driverData.js';
import { MANAGERS, getManager } from '../data/managerData.js';
import { CARS, getCar } from '../data/carData.js';
import { QualifyingEngine } from '../championship/qualifyingEngine.js';
import { AI_DIFFICULTY } from '../championship/championshipState.js';

// ── Presets & Options ────────────────────────────────────────────────────────

export const FIELD_SIZE_PRESETS = [
  { size: 2,  id: 'duel',     label: 'Duel (2 Cars)',          desc: 'Head-to-head sprint duel' },
  { size: 5,  id: 'small',    label: 'Compact (5 Cars)',       desc: 'Fast 5-car sprint pack' },
  { size: 10, id: 'medium',   label: 'Midfield (10 Cars)',     desc: 'Half-grid tactical Grand Prix' },
  { size: 15, id: 'large',    label: 'Feature (15 Cars)',      desc: 'Large championship field' },
  { size: 20, id: 'full',     label: 'Full Grid (20 Cars)',    desc: 'Authentic 20-car Formula 1 grid' }
];

export const LAP_PRESETS = [
  { laps: 3,  id: 'duel_sprint', label: 'Sprint Duel (3 Laps)', desc: 'Ultra-fast 3-lap shootout' },
  { laps: 5,  id: 'short',       label: 'Short (5 Laps)',       desc: 'Standard 5-lap quick race' },
  { laps: 10, id: 'standard',    label: 'Standard (10 Laps)',   desc: '10-lap tactical Grand Prix' },
  { laps: 25, id: 'extended',    label: 'Extended (25 Laps)',   desc: 'Endurance strategy race' }
];

export const DISTANCE_PRESETS = [
  { id: 'short',  label: 'Short (~25 km)',   targetKm: 25,  desc: 'Rapid sprint distance' },
  { id: 'medium', label: 'Medium (~50 km)',  targetKm: 50,  desc: 'Balanced intermediate distance' },
  { id: 'long',   label: 'Long (~100 km)',   targetKm: 100, desc: 'Feature distance with pit strategies' },
  { id: 'custom', label: 'Custom Distance',  targetKm: 30,  desc: 'User-specified target kilometres' }
];

export const GRID_MODES = [
  { id: 'qualifying',  label: 'Qualifying Shootout',  desc: 'Simulate high-stakes flying lap qualifying to earn grid slot' },
  { id: 'random',      label: 'Random Grid',          desc: 'Randomized starting order with optional reproducible seed' },
  { id: 'performance', label: 'Performance-Based',    desc: 'Ranked by driver pace and car constructor performance' },
  { id: 'custom',      label: 'Custom Position',      desc: 'Manually choose player starting slot (P1 Pole to back of grid)' }
];

export const WEATHER_OPTIONS = [
  { id: 'DRY',             label: 'Dry & Clear',      desc: 'Optimal track temperature and maximum aerodynamic grip' },
  { id: 'INCOMING_SHOWER', label: 'Incoming Shower',  desc: 'Race starts dry; rain arrives mid-race requiring tyre strategy' },
  { id: 'DRYING_TRACK',    label: 'Drying Track',     desc: 'Starts wet, drying rapidly into slick crossover window' },
  { id: 'DYNAMIC_MONSOON', label: 'Dynamic Monsoon',  desc: 'Heavy tropical storm with high safety car and spin probability' },
  { id: 'FULL_WET',        label: 'Full Wet',         desc: 'Torrential wet conditions throughout demanding Wet tyres' }
];

export const AI_DIFFICULTIES = [
  { id: 'easy',   label: 'Rookie (Easy)',       multiplier: 0.96, desc: 'Forgiving AI with conservative cornering and overtaking' },
  { id: 'normal', label: 'Challenger (Normal)', multiplier: 1.00, desc: 'Authentic real-world competitive pace' },
  { id: 'hard',   label: 'Pro (Hard)',          multiplier: 1.025, desc: 'Aggressive AI with optimized racing lines' },
  { id: 'expert', label: 'Legend (Expert)',     multiplier: 1.045, desc: 'Flawless pace demanding peak driver precision' }
];

export const TYRE_COMPOUNDS = [
  { id: 'soft',         label: 'Soft (C4/C5)',     badge: '🔴 SOFT', desc: 'Maximum single-lap grip, higher degradation' },
  { id: 'medium',       label: 'Medium (C3)',      badge: '🟡 MEDIUM', desc: 'Balanced race pace and versatile durability' },
  { id: 'hard',         label: 'Hard (C1/C2)',     badge: '⚪ HARD', desc: 'Endurance durability, slower warm-up' },
  { id: 'intermediate', label: 'Intermediate',     badge: '🟢 INTER', desc: 'Damp to light rain track conditions' },
  { id: 'wet',          label: 'Full Wet',         badge: '🔵 WET', desc: 'Standing water and extreme monsoon rain' }
];

export const DEFAULT_QUICK_RACE_CONFIG = Object.freeze({
  circuitId: 'silverstone',
  fieldSize: 20,
  lapMode: 'laps', // 'laps' | 'distance'
  totalLaps: 5,
  distancePreset: 'short',
  targetDistanceKm: 25,
  playerDriverCode: 'HAM',
  playerManagerId: 'mgr_wolff',
  playerCarId: 'car_w16',
  includeQualifying: false, // Default: OFF for new Quick Race configurations
  gridMode: 'random',
  customPlayerPosition: 1, // 1 to fieldSize
  randomSeed: null,
  weatherPreset: 'DRY',
  aiDifficulty: 'normal',
  startingCompound: 'medium',
  tyreStrategyMode: 'auto',
  safetyCarEnabled: true,
  vscEnabled: true,
  damageEnabled: true,
  penaltiesEnabled: true,
  batteryEnabled: true,
  drsEnabled: true,
  carSetup: {
    frontWing: 6,
    rearWing: 6,
    suspension: 3,
    rideHeight: 3,
    brakeBias: 56,
    differential: 70,
    tyrePressurePsi: 23.0
  }
});

// ── Distance-to-Laps Calculator ───────────────────────────────────────────

/**
 * Calculates whole laps from a target race distance in kilometres.
 * Uses British English in explanation output.
 *
 * @param {number} circuitLengthM - Lap length of circuit in metres
 * @param {number} distanceKm - Target distance in kilometres
 * @param {string} [circuitName] - Optional circuit name for description
 * @returns {{
 *   laps: number,
 *   targetDistanceKm: number,
 *   actualDistanceKm: number,
 *   circuitLengthM: number,
 *   circuitLengthKm: number,
 *   explanation: string
 * }}
 */
export function calculateLapsFromDistance(circuitLengthM, distanceKm, circuitName = 'Circuit') {
  const safeLengthM = Math.max(500, circuitLengthM || 5000);
  const safeKm = Math.max(1, distanceKm || 25);

  const laps = Math.max(1, Math.ceil((safeKm * 1000) / safeLengthM));
  const actualDistanceKm = Math.round(((laps * safeLengthM) / 1000) * 100) / 100;
  const circuitLengthKm = Math.round((safeLengthM / 1000) * 1000) / 1000;

  const explanation = `${circuitName} lap length is ${safeLengthM.toLocaleString()} metres (${circuitLengthKm.toFixed(3)} km). A target distance of ${safeKm.toFixed(1)} kilometres converts into ${laps} whole laps, yielding an actual race distance of ${actualDistanceKm.toFixed(2)} kilometres.`;

  return {
    laps,
    targetDistanceKm: safeKm,
    actualDistanceKm,
    circuitLengthM: safeLengthM,
    circuitLengthKm,
    explanation
  };
}

// ── Validation ────────────────────────────────────────────────────────────

/**
 * Validates a Quick Race configuration object.
 *
 * @param {object} config
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateQuickRaceConfig(config) {
  const errors = [];
  if (!config || typeof config !== 'object') {
    return { valid: false, errors: ['Configuration must be a valid object.'] };
  }

  // Circuit
  const circuit = CIRCUITS.find(c => c.id === config.circuitId);
  if (!circuit) {
    errors.push(`Invalid circuitId: '${config.circuitId}'. Must be one of: ${CIRCUITS.map(c => c.id).join(', ')}.`);
  }

  // Field size (bounded between 2 and available drivers, max 20)
  const maxDrivers = DRIVERS.length || 20;
  if (typeof config.fieldSize !== 'number' || config.fieldSize < 2 || config.fieldSize > maxDrivers) {
    errors.push(`fieldSize must be an integer between 2 and ${maxDrivers}. Received: ${config.fieldSize}.`);
  }

  // Lap count (1 to 100 laps)
  if (typeof config.totalLaps !== 'number' || config.totalLaps < 1 || config.totalLaps > 100) {
    errors.push(`totalLaps must be an integer between 1 and 100. Received: ${config.totalLaps}.`);
  }

  // Player Driver
  const driver = DRIVERS.find(d => d.code === config.playerDriverCode);
  if (!driver) {
    errors.push(`Invalid playerDriverCode: '${config.playerDriverCode}'.`);
  }

  // Grid Mode
  const validGridModes = ['qualifying', 'random', 'performance', 'custom'];
  if (!validGridModes.includes(config.gridMode)) {
    errors.push(`Invalid gridMode: '${config.gridMode}'. Must be one of: ${validGridModes.join(', ')}.`);
  }

  // Include Qualifying toggle
  if (config.includeQualifying !== undefined && typeof config.includeQualifying !== 'boolean') {
    errors.push(`includeQualifying must be a boolean (true or false). Received: ${config.includeQualifying}.`);
  }

  // Custom Position
  if (config.gridMode === 'custom') {
    const fSize = config.fieldSize || 20;
    if (typeof config.customPlayerPosition !== 'number' || config.customPlayerPosition < 1 || config.customPlayerPosition > fSize) {
      errors.push(`customPlayerPosition must be between 1 and fieldSize (${fSize}). Received: ${config.customPlayerPosition}.`);
    }
  }

  // AI Difficulty
  const validDifficulties = ['easy', 'normal', 'hard', 'expert', 'legend'];
  if (config.aiDifficulty && !validDifficulties.includes(config.aiDifficulty)) {
    errors.push(`Invalid aiDifficulty: '${config.aiDifficulty}'. Must be one of: ${validDifficulties.join(', ')}.`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

// ── Grid Generation ───────────────────────────────────────────────────────

/**
 * Builds a deduplicated starting grid of exact fieldSize.
 * Guarantees player driver is present exactly once, with remaining slots
 * filled by unique AI drivers.
 *
 * @param {object} config
 * @returns {{
 *   gridDrivers: object[],
 *   playerCarIdx: number,
 *   qualifyingResults?: object[]
 * }}
 */
export function buildStartingGrid(config) {
  const fSize = Math.max(2, Math.min(config.fieldSize || 20, DRIVERS.length));
  const playerDriver = getDriver(config.playerDriverCode) || DRIVERS[0];

  // Candidates: player + unique AI drivers
  const otherDrivers = DRIVERS.filter(d => d.code !== playerDriver.code);
  const neededAI = fSize - 1;
  const selectedAI = otherDrivers.slice(0, neededAI);
  const poolDrivers = [playerDriver, ...selectedAI];

  const shouldRunQuali = (config.includeQualifying === true) || (config.gridMode === 'qualifying');
  const gridMode = shouldRunQuali ? 'qualifying' : (config.gridMode === 'qualifying' ? 'random' : (config.gridMode || 'random'));

  if (shouldRunQuali) {
    // Use existing qualifying results if already finalized, or run authoritative full-field session
    const qualiResults = (Array.isArray(config.qualifyingResults) && config.qualifyingResults.length >= poolDrivers.length)
      ? config.qualifyingResults
      : QualifyingEngine.runQualifyingSession({
          circuitId: config.circuitId || 'silverstone',
          drivers: poolDrivers,
          difficulty: config.aiDifficulty || 'normal',
          playerCode: playerDriver.code,
          seed: config.randomSeed ?? null
        });

    // Map ordered qualifying positions back to driver objects
    const gridDrivers = qualiResults.map(r => poolDrivers.find(d => d.code === r.driverCode) || playerDriver);
    const playerCarIdx = gridDrivers.findIndex(d => d.code === playerDriver.code);

    return {
      gridDrivers,
      playerCarIdx: playerCarIdx >= 0 ? playerCarIdx : 0,
      qualifyingResults: qualiResults
    };
  }

  if (gridMode === 'random') {
    // Deterministic shuffle if seed provided, otherwise Math.random
    let seed = config.randomSeed ?? Math.floor(Math.random() * 100000);
    const rng = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };

    const shuffled = [...poolDrivers];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const playerCarIdx = shuffled.findIndex(d => d.code === playerDriver.code);
    return {
      gridDrivers: shuffled,
      playerCarIdx: playerCarIdx >= 0 ? playerCarIdx : 0
    };
  }

  if (gridMode === 'performance') {
    // Sort pool by driver pace + car modifiers
    const playerCar = getCar(config.playerCarId);
    const sorted = [...poolDrivers].sort((a, b) => {
      const aIsPlayer = (a.code === playerDriver.code);
      const bIsPlayer = (b.code === playerDriver.code);

      const aPace = (a.pace || 0.95) + (aIsPlayer && playerCar?.modifiers?.accelMult ? (playerCar.modifiers.accelMult - 1) : 0);
      const bPace = (b.pace || 0.95) + (bIsPlayer && playerCar?.modifiers?.accelMult ? (playerCar.modifiers.accelMult - 1) : 0);
      return bPace - aPace; // Highest pace first (Pole)
    });

    const playerCarIdx = sorted.findIndex(d => d.code === playerDriver.code);
    return {
      gridDrivers: sorted,
      playerCarIdx: playerCarIdx >= 0 ? playerCarIdx : 0
    };
  }

  // Custom positioning
  const targetPos = Math.max(1, Math.min(config.customPlayerPosition || 1, fSize));
  const targetIdx = targetPos - 1;

  const result = [];
  let aiIdx = 0;
  for (let pos = 0; pos < fSize; pos++) {
    if (pos === targetIdx) {
      result.push(playerDriver);
    } else {
      result.push(selectedAI[aiIdx++] || playerDriver);
    }
  }

  return {
    gridDrivers: result,
    playerCarIdx: targetIdx
  };
}

// ── Persistence & Presets ─────────────────────────────────────────────────

export const STORAGE_KEY_LAST_CONFIG = 'f1_quick_race_last_config';
export const STORAGE_KEY_PRESETS = 'f1_quick_race_presets';

export const BUILTIN_PRESETS = [
  {
    name: 'Sprint Duel',
    description: '2-car 3-lap head-to-head sprint duel at Silverstone from pole position',
    config: {
      circuitId: 'silverstone',
      fieldSize: 2,
      lapMode: 'laps',
      totalLaps: 3,
      targetDistanceKm: 18,
      playerDriverCode: 'HAM',
      playerCarId: 'car_w16',
      playerManagerId: 'mgr_wolff',
      includeQualifying: false,
      gridMode: 'custom',
      customPlayerPosition: 1,
      weatherPreset: 'DRY',
      aiDifficulty: 'hard',
      startingCompound: 'soft',
      tyreStrategyMode: 'auto',
      safetyCarEnabled: false,
      vscEnabled: false,
      damageEnabled: true,
      penaltiesEnabled: true,
      batteryEnabled: true,
      drsEnabled: true
    }
  },
  {
    name: 'Wet Spa Challenge',
    description: '10-car 5-lap wet weather survival through Eau Rouge and Ardennes rain',
    config: {
      circuitId: 'spa',
      fieldSize: 10,
      lapMode: 'laps',
      totalLaps: 5,
      targetDistanceKm: 35,
      playerDriverCode: 'VER',
      playerCarId: 'car_rb20',
      playerManagerId: 'mgr_horner',
      includeQualifying: true,
      gridMode: 'qualifying',
      weatherPreset: 'FULL_WET',
      aiDifficulty: 'expert',
      startingCompound: 'wet',
      tyreStrategyMode: 'auto',
      safetyCarEnabled: true,
      vscEnabled: true,
      damageEnabled: true,
      penaltiesEnabled: true,
      batteryEnabled: true,
      drsEnabled: true
    }
  },
  {
    name: 'Monza Temple of Speed',
    description: '20-car 10-lap full grid slipstream battle at the Autodromo Nazionale',
    config: {
      circuitId: 'monza',
      fieldSize: 20,
      lapMode: 'laps',
      totalLaps: 10,
      targetDistanceKm: 58,
      playerDriverCode: 'LEC',
      playerCarId: 'car_sf24',
      playerManagerId: 'mgr_vasseur',
      includeQualifying: false,
      gridMode: 'performance',
      weatherPreset: 'DRY',
      aiDifficulty: 'normal',
      startingCompound: 'medium',
      tyreStrategyMode: 'auto',
      safetyCarEnabled: true,
      vscEnabled: true,
      damageEnabled: true,
      penaltiesEnabled: true,
      batteryEnabled: true,
      drsEnabled: true
    }
  },
  {
    name: 'Monaco Street Precision',
    description: '20-car 5-lap street fight from midfield P10 through Monte Carlo tight barriers',
    config: {
      circuitId: 'monaco',
      fieldSize: 20,
      lapMode: 'laps',
      totalLaps: 5,
      targetDistanceKm: 17,
      playerDriverCode: 'NOR',
      playerCarId: 'car_mcl38',
      playerManagerId: 'mgr_stella',
      includeQualifying: false,
      gridMode: 'custom',
      customPlayerPosition: 10,
      weatherPreset: 'DRY',
      aiDifficulty: 'hard',
      startingCompound: 'soft',
      tyreStrategyMode: 'auto',
      safetyCarEnabled: true,
      vscEnabled: true,
      damageEnabled: true,
      penaltiesEnabled: true,
      batteryEnabled: true,
      drsEnabled: true
    }
  }
];

/**
 * Save the most recent Quick Race configuration to localStorage.
 *
 * @param {object} config
 */
export function saveLastQuickRaceConfig(config) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_LAST_CONFIG, JSON.stringify(config));
  } catch (e) {
    console.warn('Unable to persist Quick Race config to localStorage:', e);
  }
}

/**
 * Load the last-used Quick Race configuration or default fallback.
 *
 * @returns {object}
 */
export function loadLastQuickRaceConfig() {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_QUICK_RACE_CONFIG };
  try {
    const raw = localStorage.getItem(STORAGE_KEY_LAST_CONFIG);
    if (!raw) return { ...DEFAULT_QUICK_RACE_CONFIG };
    const parsed = JSON.parse(raw);
    const valid = validateQuickRaceConfig(parsed);
    return valid.valid ? { ...DEFAULT_QUICK_RACE_CONFIG, ...parsed } : { ...DEFAULT_QUICK_RACE_CONFIG };
  } catch (_) {
    return { ...DEFAULT_QUICK_RACE_CONFIG };
  }
}

/**
 * Retrieve all presets (built-in + saved user presets).
 *
 * @returns {Array<{ name: string, description: string, config: object, isUser?: boolean }>}
 */
export function getQuickRacePresets() {
  const list = [...BUILTIN_PRESETS];
  if (typeof localStorage === 'undefined') return list;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PRESETS);
    if (raw) {
      const userPresets = JSON.parse(raw);
      if (Array.isArray(userPresets)) {
        userPresets.forEach(p => {
          if (p && p.name && p.config) {
            list.push({ ...p, isUser: true });
          }
        });
      }
    }
  } catch (_) {}
  return list;
}

/**
 * Save a custom named preset to localStorage.
 *
 * @param {string} name
 * @param {object} config
 * @param {string} [description]
 */
export function saveQuickRacePreset(name, config, description = 'Custom User Preset') {
  if (typeof localStorage === 'undefined' || !name) return false;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PRESETS);
    let userPresets = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(userPresets)) userPresets = [];

    // Replace if existing name, otherwise push
    const idx = userPresets.findIndex(p => p.name.toLowerCase() === name.toLowerCase());
    const presetObj = { name, description, config, isUser: true };
    if (idx >= 0) {
      userPresets[idx] = presetObj;
    } else {
      userPresets.push(presetObj);
    }
    localStorage.setItem(STORAGE_KEY_PRESETS, JSON.stringify(userPresets));
    return true;
  } catch (e) {
    console.warn('Unable to save Quick Race preset:', e);
    return false;
  }
}

/**
 * Delete a user preset by name.
 *
 * @param {string} name
 */
export function deleteQuickRacePreset(name) {
  if (typeof localStorage === 'undefined' || !name) return false;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PRESETS);
    if (!raw) return false;
    let userPresets = JSON.parse(raw);
    if (!Array.isArray(userPresets)) return false;
    userPresets = userPresets.filter(p => p.name.toLowerCase() !== name.toLowerCase());
    localStorage.setItem(STORAGE_KEY_PRESETS, JSON.stringify(userPresets));
    return true;
  } catch (_) {
    return false;
  }
}
