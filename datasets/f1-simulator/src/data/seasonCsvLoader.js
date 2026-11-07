/**
 * seasonCsvLoader.js
 * Loads and normalises historical F1 season CSV data from /data/seasons/
 * into driver, manager, and car pool objects compatible with DraftEngine.
 *
 * Supports seasons 2019–2025.
 */

import {
  enrichDriverWithML,
  enrichCarWithML,
  enrichManagerWithML,
  CAR_TECHNICAL_STRENGTHS,
  getDriverMLData
} from './mlIntelligence.js';

// ── Team colour palette keyed by canonical team name ─────────────────────────
const TEAM_COLOURS = {
  'McLaren':          '#FF8000',
  'Ferrari':          '#E8002D',
  'Red Bull':         '#3671C6',
  'Red Bull Racing':  '#3671C6',
  'Mercedes':         '#27F4D2',
  'Aston Martin':     '#358C75',
  'Alpine':           '#0093CC',
  'Williams':         '#64C4FF',
  'RB':               '#6692FF',
  'AlphaTauri':       '#6692FF',
  'Toro Rosso':       '#6692FF',
  'Haas':             '#B6BABD',
  'Haas F1 Team':     '#B6BABD',
  'Alfa Romeo':       '#B12039',
  'Sauber':           '#B12039',
  'Racing Point':     '#F596C8',
  'Force India':      '#F596C8',
  'Renault':          '#FFF500',
};

// ── Manager name → id lookup (matches managerData.js) ────────────────────────
const KNOWN_MANAGER_IDS = {
  'Andrea Stella':     'mgr_stella',
  'Christian Horner':  'mgr_horner',
  'Frédéric Vasseur':  'mgr_vasseur',
  'Frederic Vasseur':  'mgr_vasseur',
  'Toto Wolff':        'mgr_wolff',
  'Mike Krack':        'mgr_krack',
  'Bruno Famin':       'mgr_famin',
  'James Vowles':      'mgr_vowles',
  'Laurent Mekies':    'mgr_mekies',
  'Ayao Komatsu':      'mgr_komatsu',
};

// ── Team → default manager id fallback ────────────────────────────────────────
const TEAM_TO_MGR_ID = {
  'McLaren':          'mgr_stella',
  'Red Bull':         'mgr_horner',
  'Red Bull Racing':  'mgr_horner',
  'Ferrari':          'mgr_vasseur',
  'Mercedes':         'mgr_wolff',
  'Aston Martin':     'mgr_krack',
  'Alpine':           'mgr_famin',
  'Williams':         'mgr_vowles',
  'RB':               'mgr_mekies',
  'AlphaTauri':       'mgr_mekies',
  'Haas':             'mgr_komatsu',
  'Haas F1 Team':     'mgr_komatsu',
};

// ── Season highlight metadata ─────────────────────────────────────────────────
export const SEASON_META = {
  2019: { champion: 'Lewis Hamilton', tagline: "Hamilton's 6th World Title", color: '#00D2BE' },
  2020: { champion: 'Lewis Hamilton', tagline: "Hamilton's Record-Equalling 7th", color: '#00D2BE' },
  2021: { champion: 'Max Verstappen', tagline: 'Abu Dhabi Thriller — Verstappen Era Begins', color: '#3671C6' },
  2022: { champion: 'Max Verstappen', tagline: 'Ground-Effect Revolution — 15 Wins', color: '#3671C6' },
  2023: { champion: 'Max Verstappen', tagline: 'Dominant Record Season — 19 Wins', color: '#3671C6' },
  2024: { champion: 'Max Verstappen', tagline: 'Four-Time Champion — McLaren Rise', color: '#FF8000' },
  2025: { champion: 'Lando Norris', tagline: 'McLaren Supremacy — Norris Takes Title', color: '#FF8000' },
};

// ── Minimal RFC-4180 CSV parser ───────────────────────────────────────────────
function parseCsv(text) {
  const rows = [];
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const headers = splitCsvLine(lines[0]);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = splitCsvLine(line);
    const row = {};
    headers.forEach((h, idx) => {
      row[h.trim()] = (values[idx] ?? '').trim();
    });
    rows.push(row);
  }
  return rows;
}

function splitCsvLine(line) {
  const fields = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

// ── Safe numeric parser ───────────────────────────────────────────────────────
function num(val, fallback = 0) {
  if (val === null || val === undefined || val === '') return fallback;
  // strip parentheses like "1(x84)" → "1"
  const clean = String(val).replace(/\(.*\)/, '').replace(/[^0-9.]/g, '');
  const n = parseFloat(clean);
  return isNaN(n) ? fallback : n;
}

// ── Driver normalisation ──────────────────────────────────────────────────────
/**
 * Convert a raw CSV driver row to a DraftEngine-compatible driver object.
 * @param {object} row  raw CSV row
 * @param {number} year season year (affects field name mapping)
 * @param {number} rank driver ranking position (used for pace estimation)
 * @param {number} total total drivers in grid
 * @returns {object}
 */
function normaliseDriver(row, year, rank, total) {
  const name = row['Driver'] || row['driver'] || 'Unknown Driver';

  // Derive 3-letter code
  let code = row['Abbreviation'] || row['abbreviation'] || '';
  if (!code) {
    const parts = name.split(' ');
    const last = parts[parts.length - 1];
    code = last.slice(0, 3).toUpperCase();
  }

  // Race number
  const number = num(row['Race Number'] || row['Number'], rank + 1);

  // Team
  const team = row['Team'] || row['team'] || 'Unknown';
  const color = TEAM_COLOURS[team] || '#888888';

  // Career stats for personality derivation
  const championships = num(row['World Championships']);
  const podiums       = num(row['Podiums']);
  const polePositions = num(row['Pole Positions'] || row['Highest Grid Position']);
  const careerPoints  = num(row['Career Points'] || row['Points']);
  const gpsEntered    = num(row['Grand Prix Entered'] || row['Grands Prix Entered'], 1);
  const dnfs          = num(row['DNFs'], 0);
  const highestFinish = num(row['Highest Race Finish']);

  // Normalise stats relative to expected maxima
  const normPoints  = Math.min(careerPoints / 4500, 1);
  const normPodiums = Math.min(podiums / 110, 1);
  const normPoles   = Math.min(polePositions / 110, 1);
  const normChamps  = Math.min(championships / 7, 1);
  const dnfRate     = gpsEntered > 0 ? Math.min(dnfs / gpsEntered, 0.4) : 0.2;

  // Pace: top finishers score higher; rank 1 = fastest
  const pace = parseFloat((0.88 + 0.12 * (1 - (rank - 1) / Math.max(total - 1, 1))).toFixed(4));

  // Personality attributes from career stats
  const personality = {
    aggression:      clamp(0.45 + normPoles * 0.30 + normPoints * 0.20, 0.40, 0.95),
    consistency:     clamp(0.50 + normPoints * 0.30 + (1 - dnfRate * 2) * 0.15, 0.45, 0.95),
    racecraft:       clamp(0.45 + normPodiums * 0.30 + normPoints * 0.20, 0.40, 0.92),
    tyreManagement:  clamp(0.55 + normPoints * 0.20 + normChamps * 0.15, 0.48, 0.93),
    wetSkill:        clamp(0.50 + normChamps * 0.25 + normPoles * 0.15, 0.45, 0.92),
    attackSkill:     clamp(0.45 + normPoles * 0.25 + normPodiums * 0.25, 0.40, 0.94),
    adaptability:    clamp(0.52 + normChamps * 0.20 + normPoints * 0.15, 0.45, 0.93),
  };

  // Round all personality values to 2 dp
  Object.keys(personality).forEach(k => {
    personality[k] = parseFloat(personality[k].toFixed(2));
  });

  const rawDriver = {
    code,
    name,
    team,
    number,
    color,
    teamColor: color,
    nationality: row['Country'] || '',
    country: row['Country'] || '',
    countryCode: '',
    homeCity: row['Place of Birth'] || '',
    homeCircuitIds: [],
    engineerName: '',
    pace,
    personality,
    // Extra metadata shown in draft cards
    seasonYear: year,
    careerPoints,
    podiums,
    championships,
    polePositions,
  };

  return enrichDriverWithML(rawDriver);
}

function clamp(val, min, max) {
  return Math.min(Math.max(val, min), max);
}

// ── Team / Manager normalisation ──────────────────────────────────────────────
/**
 * Convert a CSV teams row to a minimal manager object compatible with DraftEngine.
 * @param {object} row      raw CSV row
 * @param {number} year     season year
 * @param {number} teamRank constructor championship rank (1 = winner)
 * @param {number} total    total teams
 * @returns {object}
 */
function normaliseManager(row, year, teamRank, total) {
  const teamName  = row['Team'] || row['team'] || 'Unknown';
  const chiefName = row['Team Chief'] || row['team_chief'] || teamName + ' Principal';
  const chassis   = row['Chassis'] || row['chassis'] || '';
  const pu        = row['Power Unit'] || row['power_unit'] || '';

  // Map to known manager id
  const knownId = KNOWN_MANAGER_IDS[chiefName] || TEAM_TO_MGR_ID[teamName];
  const id = knownId || ('mgr_' + chiefName.toLowerCase().replace(/[^a-z0-9]/g, '_'));

  // Performance modifiers scaled by team rank (rank 1 = best)
  const rankFrac = 1 - (teamRank - 1) / Math.max(total - 1, 1);
  const pitLossDelta  = parseFloat((-0.35 + (1 - rankFrac) * 0.45).toFixed(2));  // -0.35..+0.10
  const tyreDegMult   = parseFloat((0.94 + (1 - rankFrac) * 0.06).toFixed(3));   // 0.94..1.00
  const strategyBonus = parseFloat((0.03 + rankFrac * 0.06).toFixed(3));          // 0.03..0.09
  const rating        = Math.round(60 + rankFrac * 36);

  const rawManager = {
    id,
    name: chiefName,
    team: teamName,
    nationality: '',
    style: `${teamName} Tactical Command`,
    avatar: '👨‍💼',
    rating,
    chassis,
    powerUnit: pu,
    seasonYear: year,
    attributes: {
      strategy:       Math.round(60 + rankFrac * 36),
      tyreManagement: Math.round(58 + rankFrac * 36),
      pitCrew:        Math.round(60 + rankFrac * 34),
      leadership:     Math.round(62 + rankFrac * 30),
    },
    bio: `${chiefName} led ${teamName} during the ${year} Formula 1 World Championship season.`,
    perks: [
      `${teamName} ${year} Pit Crew (${chassis})`,
      `Power Unit: ${pu || 'Unknown'}`,
      `Constructor Rank: P${teamRank}`,
    ],
    modifiers: { pitLossDelta, tyreDegMult, strategyBonus, overtakePace: 0.008, launchAssistMs: 0 },
  };

  return enrichManagerWithML(rawManager);
}

// ── Car normalisation ─────────────────────────────────────────────────────────
/**
 * Convert a CSV teams row to a car object compatible with DraftEngine.
 * @param {object} row      raw CSV row
 * @param {number} year     season year
 * @param {number} teamRank constructor championship rank (1 = fastest)
 * @param {number} total    total constructors
 * @returns {object}
 */
function normaliseCar(row, year, teamRank, total) {
  const teamName = row['Team'] || row['team'] || 'Unknown';
  const chassis  = row['Chassis'] || row['chassis'] || teamName.slice(0, 3).toUpperCase() + year.toString().slice(2);
  const id = 'car_' + chassis.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + year;

  const rankFrac = 1 - (teamRank - 1) / Math.max(total - 1, 1);

  // Modifiers: rank-1 car is fastest/most-downforce, rank-last is slowest
  const maxSpeedBonus    = parseFloat((rankFrac * 12).toFixed(1));         // 0..12 km/h bonus
  const accelMult        = parseFloat((0.96 + rankFrac * 0.04).toFixed(4)); // 0.96..1.00
  const downforceMult    = parseFloat((0.94 + rankFrac * 0.06).toFixed(4)); // 0.94..1.00
  const dragMult         = parseFloat((1.04 - rankFrac * 0.06).toFixed(4)); // 0.98..1.04
  const tyreWearMult     = parseFloat((0.96 + (1 - rankFrac) * 0.06).toFixed(4)); // 0.96..1.02

  const tech = CAR_TECHNICAL_STRENGTHS[teamName] || CAR_TECHNICAL_STRENGTHS['McLaren'] || {
    strengths: `Authentic ${year} aerodynamic platform engineered for high-speed balance and tyre preservation.`,
    weaknesses: 'Requires precise mechanical ride-height tuning.',
    aeroBias: 'Championship Aero Package'
  };

  const rawCar = {
    id,
    name: `${chassis} (${year})`,
    shortName: chassis,
    team: teamName,
    seasonYear: year,
    color: TEAM_COLOURS[teamName] || '#888888',
    teamPoints: num(row['Team Points'] || row['team_points']),
    stats: {
      topSpeed:         Math.round(50 + rankFrac * 48),
      acceleration:     Math.round(52 + rankFrac * 44),
      cornering:        Math.round(48 + rankFrac * 48),
      tyrePreservation: Math.round(50 + rankFrac * 48),
      reliability:      Math.round(55 + rankFrac * 40),
    },
    strengths: tech.strengths,
    weaknesses: tech.weaknesses,
    aeroBias: tech.aeroBias,
    modifiers: { maxSpeedBonus, accelMult, downforceMult, dragMult, tyreWearMult },
    perks: [
      `${year} Constructor: P${teamRank} (${chassis})`,
      `Power Unit: ${row['Power Unit'] || 'Unknown'}`,
      `Top Speed Bonus: +${maxSpeedBonus.toFixed(0)} km/h`,
    ],
    description: `The ${chassis} was ${teamName}'s challenger for the ${year} FIA Formula 1 World Championship.`,
  };

  return enrichCarWithML(rawCar);
}

// ── CSV fetch helpers ─────────────────────────────────────────────────────────

async function fetchCsv(url) {
  let targetUrl = url;
  if (typeof window === 'undefined' && targetUrl.startsWith('/')) {
    targetUrl = 'http://localhost:8765' + targetUrl;
  }
  const res = await fetch(targetUrl);
  if (!res.ok) throw new Error(`CSV fetch failed: ${targetUrl} (${res.status})`);
  return parseCsv(await res.text());
}

/**
 * Fetch and normalise driver objects for a given season year.
 * @param {number} year  2019–2025
 * @returns {Promise<object[]>}  array of normalised driver objects
 */
export async function fetchSeasonDrivers(year) {
  const rows = await fetchCsv(`/data/seasons/${year}_drivers.csv`);
  return rows.map((row, idx) => normaliseDriver(row, year, idx + 1, rows.length));
}

/**
 * Fetch and normalise manager + car pool objects for a given season year.
 * Teams CSVs are available from 2021; for 2019–2020 we synthesise from driver data.
 *
 * @param {number} year  2019–2025
 * @param {object[]|null} driverRows  already-loaded driver rows (used as fallback for pre-2021)
 * @returns {Promise<{ managers: object[], cars: object[] }>}
 */
export async function fetchSeasonTeams(year) {
  let rows;
  try {
    rows = await fetchCsv(`/data/seasons/${year}_teams.csv`);
  } catch (_) {
    // Pre-2021 fallback: synthesise team rows from the driver CSV
    rows = null;
  }

  if (!rows) {
    // Fallback: load drivers and group by team
    const driverRows = await fetchCsv(`/data/seasons/${year}_drivers.csv`);
    const teamMap = {};
    driverRows.forEach(d => {
      const t = d['Team'] || d['team'];
      if (t && !teamMap[t]) teamMap[t] = d;
    });
    rows = Object.entries(teamMap).map(([team, d]) => ({
      Team: team,
      'Full Team Name': team,
      Base: '',
      'Team Chief': '',
      'Technical Chief': '',
      Chassis: team.slice(0, 3).toUpperCase() + String(year).slice(2),
      'Power Unit': '',
      'First Team Entry': '',
      'Grand Prix Entered': '',
      'Team Points': '',
    }));
  }

  const managers = rows.map((row, idx) => normaliseManager(row, year, idx + 1, rows.length));
  const cars     = rows.map((row, idx) => normaliseCar(row, year, idx + 1, rows.length));

  return { managers, cars };
}

/**
 * Load complete draft pools for a season.
 * @param {number} year
 * @returns {Promise<{ drivers, managers, cars }>}
 */
export async function loadSeasonPools(year) {
  const [drivers, { managers, cars }] = await Promise.all([
    fetchSeasonDrivers(year),
    fetchSeasonTeams(year),
  ]);
  return { drivers, managers, cars };
}
