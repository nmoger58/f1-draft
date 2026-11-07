/**
 * championshipState.js
 * Authoritative Championship State Model, Enums, and State Factory.
 *
 * Defines the single source of truth for season progression, weekend stages,
 * driver entries, standings caches, and event persistence.
 */

import { DRIVERS } from '../data/driverData.js';
import { CIRCUITS, getCircuit } from '../data/circuitData.js';
import { PointsSystem } from './pointsSystem.js';
import { getSharedDraftEngine } from '../strategy/draftEngine.js';

export const WeekendStage = {
  EVENT_OVERVIEW:       'EVENT_OVERVIEW',
  PRACTICE_PENDING:     'PRACTICE_PENDING',
  PRACTICE_COMPLETED:   'PRACTICE_COMPLETED',
  QUALIFYING_PENDING:   'QUALIFYING_PENDING',
  QUALIFYING_COMPLETED: 'QUALIFYING_COMPLETED',
  GRID_CONFIRMATION:    'GRID_CONFIRMATION',
  RACE_READY:           'RACE_READY',
  RACE_IN_PROGRESS:     'RACE_IN_PROGRESS',
  RESULTS_PENDING:      'RESULTS_PENDING',
  EVENT_COMPLETED:      'EVENT_COMPLETED',
};

export const SeasonStatus = {
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED:   'COMPLETED',
};

export const AI_DIFFICULTY = {
  easy:   { name: 'Rookie (Easy)',       paceMult: 0.96, variance: 0.012 },
  normal: { name: 'Challenger (Normal)', paceMult: 1.00, variance: 0.008 },
  hard:   { name: 'Pro (Hard)',          paceMult: 1.025, variance: 0.005 },
  legend: { name: 'World Champion (Legend)', paceMult: 1.045, variance: 0.003 },
};

export const RACE_DISTANCES = {
  short:  { name: 'Sprint Distance (5 Laps)', laps: 5 },
  medium: { name: 'Standard (12 Laps)',       laps: 12 },
  full:   { name: 'Grand Prix (Full Circuit Distance)', laps: null }, // uses circuit.laps
};

/**
 * Create a fresh, fully initialized authoritative Championship state.
 *
 * @param {object} options
 * @param {string} options.name             – Season title
 * @param {string} options.raceDistance     – 'short' | 'medium' | 'full'
 * @param {string} options.aiDifficulty     – 'easy' | 'normal' | 'hard' | 'legend'
 * @param {object} options.rules            – rule flags (practiceEnabled, qualifyingEnabled, weatherMode, etc.)
 * @param {object} options.player           – { driverCode, team, teammateCode }
 * @param {string[]} options.circuitIds     – array of circuit IDs for the calendar
 * @param {object[]} [options.competitors]  – optional custom grid of drivers, default all 20 DRIVERS
 * @returns {object} validated Championship State object
 */
export function createChampionshipState({
  name = '2025 FIA Formula One World Championship',
  raceDistance = 'short',
  aiDifficulty = 'normal',
  rules = {},
  player = null,
  circuitIds = ['monaco', 'silverstone', 'spa', 'monza'],
  competitors = null,
} = {}) {
  const id = 'champ_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
  const now = Date.now();

  // Grid of drivers: default to all 20 official DRIVERS
  const gridDrivers = (competitors && competitors.length) ? competitors : DRIVERS;

  // Selected player driver (uses draft selection if available, without forcing Norris)
  const draftEngine = getSharedDraftEngine();
  const draftedDriver = draftEngine?.getSelectedEntity('driver');
  const draftedManager = draftEngine?.getSelectedEntity('manager');
  const draftedCar = draftEngine?.getSelectedEntity('car');

  const targetCode = player?.driverCode || draftedDriver?.code || gridDrivers[0].code;
  const pDriver = gridDrivers.find(d => d.code === targetCode) || gridDrivers[0];
  const pTeam = pDriver.team;
  const pTeammate = gridDrivers.find(d => d.team === pTeam && d.code !== pDriver.code);

  const playerProfile = {
    driverCode: pDriver.code,
    driverName: pDriver.name,
    team: pTeam,
    number: pDriver.number,
    color: pDriver.color,
    teamColor: pDriver.teamColor,
    teammateCode: pTeammate?.code || null,
    managerId: player?.managerId || draftedManager?.id || 'mgr_stella',
    carId: player?.carId || draftedCar?.id || 'car_mcl38',
  };

  // Build Calendar Rounds
  const calendar = circuitIds.map((cid, idx) => {
    const circuit = getCircuit(cid);
    const laps = RACE_DISTANCES[raceDistance]?.laps ?? circuit.laps ?? 5;
    return {
      round: idx + 1,
      circuitId: cid,
      circuitName: circuit.name,
      location: circuit.loc,
      laps,
      status: idx === 0 ? 'in_progress' : 'upcoming', // first round is active
      stage: WeekendStage.EVENT_OVERVIEW,
      // Stored session results
      practiceResults: null,
      qualifyingResults: null,
      grid: null,
      raceResults: null,
      fastestLap: null,
      penalties: [],
      completedAt: null
    };
  });

  // Initial Driver Standings (0 points)
  const driverStandings = gridDrivers.map((d, i) => ({
    position: i + 1,
    driverCode: d.code,
    name: d.name,
    team: d.team,
    color: d.color,
    points: 0,
    wins: 0,
    podiums: 0,
    poles: 0,
    fastestLaps: 0,
    bestFinish: null,
    finishCounts: {}, // map of position -> count
    gapToLeader: 0,
    isPlayer: (d.code === pDriver.code)
  }));

  // Initial Constructor Standings
  const constructorStandings = PointsSystem.computeConstructorStandings(driverStandings);

  const state = {
    version: 2,
    id,
    name,
    createdAt: now,
    updatedAt: now,
    seasonLength: calendar.length,
    raceDistance,
    aiDifficulty,
    rules: {
      practiceEnabled: rules.practiceEnabled ?? true,
      qualifyingEnabled: rules.qualifyingEnabled ?? true,
      weatherMode: rules.weatherMode ?? 'dynamic', // 'dynamic' | 'fixed_dry' | 'fixed_wet'
      pointsSystem: 'fia_2025',
      fastestLapPoint: rules.fastestLapPoint ?? true,
      twoCompoundRule: rules.twoCompoundRule ?? true,
      mechanicalDamage: rules.mechanicalDamage ?? true,
      homeAdvantage: rules.homeAdvantage ?? true,
      previousWinnerConfidence: rules.previousWinnerConfidence ?? true,
      teamRadioMode: rules.teamRadioMode ?? 'full', // 'full' | 'essential' | 'off'
    },
    player: playerProfile,
    drivers: gridDrivers.map(d => ({
      code: d.code,
      name: d.name,
      team: d.team,
      number: d.number,
      color: d.color,
      teamColor: d.teamColor,
      pace: d.pace,
      personality: { ...d.personality }
    })),
    calendar,
    currentRoundIndex: 0,
    status: SeasonStatus.IN_PROGRESS,
    driverStandings,
    constructorStandings,
    history: []
  };

  validateChampionshipState(state);
  return state;
}

/**
 * Validate championship state structure and integrity.
 * Throws descriptive Error if corrupted or inconsistent.
 */
export function validateChampionshipState(state) {
  if (!state || typeof state !== 'object') {
    throw new Error('ChampionshipState: Invalid state object (null or non-object)');
  }
  if (!state.id || !state.name) {
    throw new Error('ChampionshipState: Missing id or name');
  }
  if (!Array.isArray(state.calendar) || state.calendar.length === 0) {
    throw new Error('ChampionshipState: Calendar must contain at least 1 round');
  }
  const maxRoundIdx = state.status === SeasonStatus.COMPLETED ? state.calendar.length : state.calendar.length - 1;
  if (state.currentRoundIndex < 0 || state.currentRoundIndex > maxRoundIdx) {
    throw new Error(`ChampionshipState: Invalid currentRoundIndex ${state.currentRoundIndex}`);
  }
  if (!state.player || !state.player.driverCode) {
    throw new Error('ChampionshipState: Missing player configuration');
  }
  if (!Array.isArray(state.driverStandings) || state.driverStandings.length === 0) {
    throw new Error('ChampionshipState: Missing driver standings');
  }
  return true;
}
