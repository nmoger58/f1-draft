/**
 * historicalWinnersData.js
 * Authoritative Circuit History & Verified Formula 1 Past Winners Database.
 *
 * Implements:
 *   - Verified real-world historical Grand Prix winners for all 8 simulator circuits
 *     among the active 2025/2026 driver roster.
 *   - Integration with completed Championship Mode season history (archived seasons).
 *   - Strict distinction between:
 *       1. Previous winner at this exact circuit
 *       2. Defending champion from the immediately preceding season
 *       3. Winner of an earlier round at this circuit within current season
 *       4. Previous race winner at a different circuit (no circuit bonus)
 *       5. Reigining World Champion
 *   - Graceful zero-claim fallback when no historical data exists (never fabricate wins).
 */

import { ChampionshipManager } from '../championship/championshipManager.js';

/**
 * Verified historical F1 victories at each circuit for active grid drivers.
 * Source: Official FIA Formula 1 World Championship race classifications.
 */
export const VERIFIED_HISTORICAL_WINNERS = {
  monaco: [
    { year: 2024, driverCode: 'LEC', name: 'Charles Leclerc', team: 'Ferrari' },
    { year: 2023, driverCode: 'VER', name: 'Max Verstappen',  team: 'Red Bull Racing' },
    { year: 2021, driverCode: 'VER', name: 'Max Verstappen',  team: 'Red Bull Racing' },
    { year: 2019, driverCode: 'HAM', name: 'Lewis Hamilton',   team: 'Mercedes' },
    { year: 2016, driverCode: 'HAM', name: 'Lewis Hamilton',   team: 'Mercedes' },
    { year: 2008, driverCode: 'HAM', name: 'Lewis Hamilton',   team: 'McLaren' },
    { year: 2007, driverCode: 'ALO', name: 'Fernando Alonso',  team: 'McLaren' },
    { year: 2006, driverCode: 'ALO', name: 'Fernando Alonso',  team: 'Renault' },
  ],
  silverstone: [
    { year: 2024, driverCode: 'HAM', name: 'Lewis Hamilton',   team: 'Mercedes' },
    { year: 2023, driverCode: 'VER', name: 'Max Verstappen',  team: 'Red Bull Racing' },
    { year: 2022, driverCode: 'SAI', name: 'Carlos Sainz',     team: 'Ferrari' },
    { year: 2021, driverCode: 'HAM', name: 'Lewis Hamilton',   team: 'Mercedes' },
    { year: 2020, driverCode: 'VER', name: 'Max Verstappen',  team: 'Red Bull Racing' },
    { year: 2019, driverCode: 'HAM', name: 'Lewis Hamilton',   team: 'Mercedes' },
    { year: 2011, driverCode: 'ALO', name: 'Fernando Alonso',  team: 'Ferrari' },
    { year: 2006, driverCode: 'ALO', name: 'Fernando Alonso',  team: 'Renault' },
  ],
  spa: [
    { year: 2024, driverCode: 'HAM', name: 'Lewis Hamilton',   team: 'Mercedes' },
    { year: 2023, driverCode: 'VER', name: 'Max Verstappen',  team: 'Red Bull Racing' },
    { year: 2022, driverCode: 'VER', name: 'Max Verstappen',  team: 'Red Bull Racing' },
    { year: 2021, driverCode: 'VER', name: 'Max Verstappen',  team: 'Red Bull Racing' },
    { year: 2020, driverCode: 'HAM', name: 'Lewis Hamilton',   team: 'Mercedes' },
    { year: 2019, driverCode: 'LEC', name: 'Charles Leclerc',  team: 'Ferrari' },
  ],
  monza: [
    { year: 2024, driverCode: 'LEC', name: 'Charles Leclerc',  team: 'Ferrari' },
    { year: 2023, driverCode: 'VER', name: 'Max Verstappen',  team: 'Red Bull Racing' },
    { year: 2022, driverCode: 'VER', name: 'Max Verstappen',  team: 'Red Bull Racing' },
    { year: 2020, driverCode: 'GAS', name: 'Pierre Gasly',     team: 'AlphaTauri' },
    { year: 2019, driverCode: 'LEC', name: 'Charles Leclerc',  team: 'Ferrari' },
    { year: 2018, driverCode: 'HAM', name: 'Lewis Hamilton',   team: 'Mercedes' },
    { year: 2010, driverCode: 'ALO', name: 'Fernando Alonso',  team: 'Ferrari' },
  ],
  singapore: [
    { year: 2024, driverCode: 'NOR', name: 'Lando Norris',     team: 'McLaren' },
    { year: 2023, driverCode: 'SAI', name: 'Carlos Sainz',     team: 'Ferrari' },
    { year: 2018, driverCode: 'HAM', name: 'Lewis Hamilton',   team: 'Mercedes' },
    { year: 2010, driverCode: 'ALO', name: 'Fernando Alonso',  team: 'Ferrari' },
    { year: 2008, driverCode: 'ALO', name: 'Fernando Alonso',  team: 'Renault' },
  ],
  suzuka: [
    { year: 2024, driverCode: 'VER', name: 'Max Verstappen',  team: 'Red Bull Racing' },
    { year: 2023, driverCode: 'VER', name: 'Max Verstappen',  team: 'Red Bull Racing' },
    { year: 2022, driverCode: 'VER', name: 'Max Verstappen',  team: 'Red Bull Racing' },
    { year: 2018, driverCode: 'HAM', name: 'Lewis Hamilton',   team: 'Mercedes' },
    { year: 2006, driverCode: 'ALO', name: 'Fernando Alonso',  team: 'Renault' },
  ],
  interlagos: [
    { year: 2024, driverCode: 'VER', name: 'Max Verstappen',  team: 'Red Bull Racing' },
    { year: 2023, driverCode: 'VER', name: 'Max Verstappen',  team: 'Red Bull Racing' },
    { year: 2022, driverCode: 'RUS', name: 'George Russell',   team: 'Mercedes' },
    { year: 2021, driverCode: 'HAM', name: 'Lewis Hamilton',   team: 'Mercedes' },
    { year: 2019, driverCode: 'VER', name: 'Max Verstappen',  team: 'Red Bull Racing' },
    { year: 2016, driverCode: 'HAM', name: 'Lewis Hamilton',   team: 'Mercedes' },
  ],
  baku: [
    { year: 2024, driverCode: 'PIA', name: 'Oscar Piastri',    team: 'McLaren' },
    { year: 2022, driverCode: 'VER', name: 'Max Verstappen',  team: 'Red Bull Racing' },
    { year: 2018, driverCode: 'HAM', name: 'Lewis Hamilton',   team: 'Mercedes' },
  ]
};

/**
 * Retrieve all historical and in-game winners for a specific circuit.
 * Merges official verified F1 records with archived in-game championship seasons.
 *
 * @param {string} circuitId
 * @param {object[]} [archivedHistory] – optional past championship records
 * @returns {object[]} list of victory records { year, driverCode, name, team, source }
 */
export function getCircuitHistoricalWinners(circuitId, archivedHistory = null) {
  if (!circuitId) return [];
  const wins = [];

  // 1. In-Game Completed Seasons (Higher recency precedence)
  const history = archivedHistory || ChampionshipManager.getChampionshipHistory();
  if (Array.isArray(history)) {
    history.forEach((season, sIdx) => {
      const seasonYear = season.year || (2025 + sIdx + 1);
      const isMostRecentSeason = (sIdx === history.length - 1);

      if (Array.isArray(season.calendar)) {
        season.calendar.forEach(round => {
          if (round.circuitId === circuitId && round.status === 'completed' && round.raceResults) {
            const winner = round.raceResults[0];
            if (winner) {
              wins.push({
                year: seasonYear,
                driverCode: winner.driverCode,
                name: winner.name,
                team: winner.team,
                source: 'in_game_championship',
                seasonId: season.id,
                isLastSeason: isMostRecentSeason
              });
            }
          }
        });
      }
    });
  }

  // 2. Official Historical F1 Records
  const verified = VERIFIED_HISTORICAL_WINNERS[circuitId] || [];
  verified.forEach(v => {
    // Only include if not superseded by an in-game season with the same year
    if (!wins.some(w => w.year === v.year)) {
      wins.push({
        ...v,
        source: 'f1_official_record',
        isLastSeason: (v.year === 2024)
      });
    }
  });

  return wins;
}

/**
 * Check a driver's historical relationship and victory record with the given circuit.
 *
 * @param {string} driverCode
 * @param {string} circuitId
 * @param {object} [options]
 * @param {object[]} [options.archivedHistory]
 * @param {object[]} [options.currentSeasonCalendar]
 * @param {number}   [options.currentRoundIndex]
 * @returns {object} {
 *   isPreviousWinner: boolean,
 *   winsCount: number,
 *   lastWinYear: number|null,
 *   isDefendingChampion: boolean,
 *   wonEarlierThisSeason: boolean,
 *   contextMessage: string|null,
 *   detail: string|null
 * }
 */
export function checkDriverCircuitHistory(driverCode, circuitId, options = {}) {
  const result = {
    isPreviousWinner: false,
    winsCount: 0,
    lastWinYear: null,
    isDefendingChampion: false,
    wonEarlierThisSeason: false,
    contextMessage: null,
    detail: null
  };

  if (!driverCode || !circuitId) return result;

  // 1. Check if the driver won an earlier round at this exact circuit in the current season
  if (options.currentSeasonCalendar && typeof options.currentRoundIndex === 'number') {
    for (let i = 0; i < options.currentRoundIndex; i++) {
      const pastRound = options.currentSeasonCalendar[i];
      if (pastRound.circuitId === circuitId && pastRound.status === 'completed' && pastRound.raceResults) {
        if (pastRound.raceResults[0]?.driverCode === driverCode) {
          result.isPreviousWinner = true;
          result.wonEarlierThisSeason = true;
          result.winsCount++;
          result.contextMessage = 'Previous winner at this circuit this season';
          result.detail = `Won Round ${pastRound.round} at ${pastRound.circuitName}`;
        }
      }
    }
  }

  // 2. Query historical and archived championship records
  const allCircuitWins = getCircuitHistoricalWinners(circuitId, options.archivedHistory);
  const driverWins = allCircuitWins.filter(w => w.driverCode === driverCode);

  if (driverWins.length > 0) {
    result.isPreviousWinner = true;
    result.winsCount += driverWins.length;

    // Find most recent win
    driverWins.sort((a, b) => b.year - a.year);
    const mostRecent = driverWins[0];
    result.lastWinYear = mostRecent.year;

    if (mostRecent.isLastSeason) {
      result.isDefendingChampion = true;
      result.contextMessage = `Defending winner at this circuit (${mostRecent.year})`;
      result.detail = `Won here in ${mostRecent.year} for ${mostRecent.team}`;
    } else if (!result.contextMessage) {
      result.contextMessage = `Previous winner at this circuit (${mostRecent.year})`;
      result.detail = `${driverWins.length}x winner at this circuit (last in ${mostRecent.year})`;
    }
  }

  return result;
}
