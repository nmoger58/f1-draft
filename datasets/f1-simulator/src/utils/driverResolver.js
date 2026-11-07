/**
 * driverResolver.js
 * Centralized Driver Name Resolver for Formula 1 Simulator.
 *
 * Resolves driver identifiers, driver codes, driver objects, and abbreviations
 * to canonical full display names, surnames, and 3-letter codes.
 *
 * Requirements:
 *   - resolveDriverFullName(identifierOrObject, fallback) -> "Max Verstappen"
 *   - resolveDriverSurname(identifierOrObject, fallback)  -> "Verstappen"
 *   - resolveDriverShortName(identifierOrObject, fallback)-> "VER"
 *   - getDriverProfile(identifier)                        -> Driver object
 *
 * Guarantees:
 *   - Never invents fake names.
 *   - Never uses dangerous fuzzy matching that risks wrong driver.
 *   - Works identically in Browser and Node.js environments.
 */

import { DRIVERS } from '../data/driverData.js';

// Canonical fallback dictionary of modern and historical F1 driver codes to full names and surnames.
// Covers the entire current grid plus reserve/recent drivers and legends.
export const CANONICAL_DRIVERS = {
  // Current Grid (2024-2025-2026)
  VER: { fullName: 'Max Verstappen', surname: 'Verstappen', code: 'VER', team: 'Red Bull Racing' },
  NOR: { fullName: 'Lando Norris', surname: 'Norris', code: 'NOR', team: 'McLaren' },
  LEC: { fullName: 'Charles Leclerc', surname: 'Leclerc', code: 'LEC', team: 'Ferrari' },
  HAM: { fullName: 'Lewis Hamilton', surname: 'Hamilton', code: 'HAM', team: 'Ferrari' },
  SAI: { fullName: 'Carlos Sainz', surname: 'Sainz', code: 'SAI', team: 'Williams' },
  PIA: { fullName: 'Oscar Piastri', surname: 'Piastri', code: 'PIA', team: 'McLaren' },
  RUS: { fullName: 'George Russell', surname: 'Russell', code: 'RUS', team: 'Mercedes' },
  PER: { fullName: 'Sergio Pérez', surname: 'Pérez', code: 'PER', team: 'Red Bull Racing' },
  ALO: { fullName: 'Fernando Alonso', surname: 'Alonso', code: 'ALO', team: 'Aston Martin' },
  STR: { fullName: 'Lance Stroll', surname: 'Stroll', code: 'STR', team: 'Aston Martin' },
  GAS: { fullName: 'Pierre Gasly', surname: 'Gasly', code: 'GAS', team: 'Alpine' },
  OCO: { fullName: 'Esteban Ocon', surname: 'Ocon', code: 'OCO', team: 'Haas' },
  ALB: { fullName: 'Alex Albon', surname: 'Albon', code: 'ALB', team: 'Williams' },
  COL: { fullName: 'Franco Colapinto', surname: 'Colapinto', code: 'COL', team: 'Alpine' },
  TSU: { fullName: 'Yuki Tsunoda', surname: 'Tsunoda', code: 'TSU', team: 'Racing Bulls' },
  LAW: { fullName: 'Liam Lawson', surname: 'Lawson', code: 'LAW', team: 'Racing Bulls' },
  HAD: { fullName: 'Isack Hadjar', surname: 'Hadjar', code: 'HAD', team: 'Racing Bulls' },
  BOT: { fullName: 'Valtteri Bottas', surname: 'Bottas', code: 'BOT', team: 'Kick Sauber' },
  ZHO: { fullName: 'Zhou Guanyu', surname: 'Zhou', code: 'ZHO', team: 'Kick Sauber' },
  HUL: { fullName: 'Nico Hülkenberg', surname: 'Hülkenberg', code: 'HUL', team: 'Kick Sauber' },
  MAG: { fullName: 'Kevin Magnussen', surname: 'Magnussen', code: 'MAG', team: 'Haas' },
  BEA: { fullName: 'Oliver Bearman', surname: 'Bearman', code: 'BEA', team: 'Haas' },
  BOR: { fullName: 'Gabriel Bortoleto', surname: 'Bortoleto', code: 'BOR', team: 'Kick Sauber' },
  DOO: { fullName: 'Jack Doohan', surname: 'Doohan', code: 'DOO', team: 'Alpine' },
  ANT: { fullName: 'Kimi Antonelli', surname: 'Antonelli', code: 'ANT', team: 'Mercedes' },

  // Recent Drivers & Notable F1 Personas
  SAR: { fullName: 'Logan Sargeant', surname: 'Sargeant', code: 'SAR', team: 'Williams' },
  RIC: { fullName: 'Daniel Ricciardo', surname: 'Ricciardo', code: 'RIC', team: 'RB' },
  DEV: { fullName: 'Nyck de Vries', surname: 'de Vries', code: 'DEV', team: 'AlphaTauri' },
  VET: { fullName: 'Sebastian Vettel', surname: 'Vettel', code: 'VET', team: 'Aston Martin' },
  RAI: { fullName: 'Kimi Räikkönen', surname: 'Räikkönen', code: 'RAI', team: 'Alfa Romeo' },
  LAT: { fullName: 'Nicholas Latifi', surname: 'Latifi', code: 'LAT', team: 'Williams' },
  MSC: { fullName: 'Mick Schumacher', surname: 'Schumacher', code: 'MSC', team: 'Haas' },
  GIO: { fullName: 'Antonio Giovinazzi', surname: 'Giovinazzi', code: 'GIO', team: 'Alfa Romeo' },
  KVY: { fullName: 'Daniil Kvyat', surname: 'Kvyat', code: 'KVY', team: 'AlphaTauri' },
  GRO: { fullName: 'Romain Grosjean', surname: 'Grosjean', code: 'GRO', team: 'Haas' },
  KUB: { fullName: 'Robert Kubica', surname: 'Kubica', code: 'KUB', team: 'Alfa Romeo' },
  SIR: { fullName: 'Sergey Sirotkin', surname: 'Sirotkin', code: 'SIR', team: 'Williams' },
  WEH: { fullName: 'Pascal Wehrlein', surname: 'Wehrlein', code: 'WEH', team: 'Sauber' },
  PAL: { fullName: 'Jolyon Palmer', surname: 'Palmer', code: 'PAL', team: 'Renault' },
  NAS: { fullName: 'Felipe Nasr', surname: 'Nasr', code: 'NAS', team: 'Sauber' },
  ERI: { fullName: 'Marcus Ericsson', surname: 'Ericsson', code: 'ERI', team: 'Sauber' },
  BUT: { fullName: 'Jenson Button', surname: 'Button', code: 'BUT', team: 'McLaren' },
  ROS: { fullName: 'Nico Rosberg', surname: 'Rosberg', code: 'ROS', team: 'Mercedes' },
  MAS: { fullName: 'Felipe Massa', surname: 'Massa', code: 'MAS', team: 'Williams' }
};

// Build index maps for fast and exact resolution
const codeMap = new Map();
const nameMap = new Map();
const surnameMap = new Map();
const idMap = new Map();

// Helper to normalize string for index lookups (lowercase, remove diacritics/accents)
function normalizeKey(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

// 1. Seed with CANONICAL_DRIVERS
Object.values(CANONICAL_DRIVERS).forEach(entry => {
  codeMap.set(entry.code.toUpperCase(), entry);
  nameMap.set(normalizeKey(entry.fullName), entry);
  surnameMap.set(normalizeKey(entry.surname), entry);
  idMap.set(`driver_${normalizeKey(entry.surname)}`, entry);
});

// 2. Supplement / override with active DRIVERS dataset if available
if (Array.isArray(DRIVERS)) {
  DRIVERS.forEach(d => {
    if (!d) return;
    const code = (d.code || '').toUpperCase();
    const fullName = d.name || d.fullName || '';
    // Extract surname
    let surname = '';
    if (fullName.includes('Zhou')) {
      surname = 'Zhou'; // Chinese naming convention: family name first
    } else {
      const parts = fullName.split(/\s+/);
      surname = parts[parts.length - 1] || fullName;
    }

    const record = {
      fullName,
      surname,
      code,
      team: d.team || '',
      profile: d
    };

    if (code) codeMap.set(code, record);
    if (fullName) nameMap.set(normalizeKey(fullName), record);
    if (surname) surnameMap.set(normalizeKey(surname), record);
    if (d.id) idMap.set(normalizeKey(d.id), record);
  });
}

/**
 * Extract candidate string from an object or value.
 */
function extractRawIdentifier(input) {
  if (input === null || input === undefined) return '';
  if (typeof input === 'object') {
    // If it's a driver/car object with explicit name
    if (input.fullName && typeof input.fullName === 'string') return input.fullName;
    if (input.name && typeof input.name === 'string') return input.name;
    if (input.driver && typeof input.driver === 'object') {
      if (input.driver.name) return input.driver.name;
      if (input.driver.fullName) return input.driver.fullName;
      if (input.driver.code) return input.driver.code;
    }
    if (input.code && typeof input.code === 'string') return input.code;
    if (input.id && typeof input.id === 'string') return input.id;
    if (input.driverCode && typeof input.driverCode === 'string') return input.driverCode;
    if (input.driverName && typeof input.driverName === 'string') return input.driverName;
    return '';
  }
  return String(input).trim();
}

/**
 * Resolve a driver identifier (code, object, ID, or name) to a canonical driver record.
 *
 * @param {string|object} identifierOrObject
 * @returns {object|null}
 */
export function getDriverProfile(identifierOrObject) {
  if (!identifierOrObject) return null;

  // If driver object directly passed with full profile
  if (typeof identifierOrObject === 'object' && identifierOrObject.personality && identifierOrObject.name) {
    return identifierOrObject;
  }

  const raw = extractRawIdentifier(identifierOrObject);
  if (!raw) return null;

  // 1. Exact 3-letter code lookup (e.g. 'VER', 'NOR', 'HAM')
  const upperRaw = raw.toUpperCase();
  if (codeMap.has(upperRaw)) {
    return codeMap.get(upperRaw);
  }

  // 2. Check if raw matches a pattern like "VER (P1)" or "Car 4 (NOR)"
  const codeInParens = raw.match(/\b([A-Z]{3})\b/);
  if (codeInParens && codeMap.has(codeInParens[1])) {
    return codeMap.get(codeInParens[1]);
  }

  const norm = normalizeKey(raw);

  // 3. Normalized full name lookup (e.g. "max verstappen", "charles leclerc")
  if (nameMap.has(norm)) {
    return nameMap.get(norm);
  }

  // 4. Normalized ID lookup (e.g. "driver_norris", "driver_hamilton")
  if (idMap.has(norm)) {
    return idMap.get(norm);
  }

  // 5. Exact surname lookup (e.g. "verstappen", "sainz", "leclerc")
  if (surnameMap.has(norm)) {
    return surnameMap.get(norm);
  }

  return null;
}

/**
 * Resolve identifier or object to full driver name (e.g. "Max Verstappen").
 *
 * @param {string|object} identifierOrObject
 * @param {string} [fallback='the driver']
 * @returns {string}
 */
export function resolveDriverFullName(identifierOrObject, fallback = 'the driver') {
  if (identifierOrObject === null || identifierOrObject === undefined) {
    return fallback;
  }

  const profile = getDriverProfile(identifierOrObject);
  if (profile) {
    return profile.fullName || profile.name || fallback;
  }

  const raw = extractRawIdentifier(identifierOrObject);
  if (!raw) return fallback;

  // If already a multi-word proper name (e.g. "Andrea Stella", "Safety Car"), keep it
  if (/\s+/.test(raw) && !raw.startsWith('{') && !raw.toLowerCase().includes('undefined')) {
    return raw;
  }

  // If raw is a single word but not a code, and not a curly placeholder
  if (!raw.startsWith('{') && !raw.endsWith('}') && raw.toLowerCase() !== 'undefined' && raw.toLowerCase() !== 'null') {
    return raw;
  }

  return fallback;
}

/**
 * Resolve identifier or object to driver surname (e.g. "Verstappen", "Norris").
 *
 * @param {string|object} identifierOrObject
 * @param {string} [fallback='Driver']
 * @returns {string}
 */
export function resolveDriverSurname(identifierOrObject, fallback = 'Driver') {
  if (identifierOrObject === null || identifierOrObject === undefined) {
    return fallback;
  }

  const profile = getDriverProfile(identifierOrObject);
  if (profile) {
    return profile.surname || profile.name || fallback;
  }

  const raw = extractRawIdentifier(identifierOrObject);
  if (!raw) return fallback;

  // Extract last word as surname if formatted as "First Last"
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length > 1) {
    if (raw.includes('Zhou')) return 'Zhou';
    return parts[parts.length - 1];
  }

  if (!raw.startsWith('{') && raw.toLowerCase() !== 'undefined' && raw.toLowerCase() !== 'null') {
    return raw;
  }

  return fallback;
}

/**
 * Resolve identifier or object to canonical 3-letter abbreviation (e.g. "VER", "NOR").
 *
 * @param {string|object} identifierOrObject
 * @param {string} [fallback='DRV']
 * @returns {string}
 */
export function resolveDriverShortName(identifierOrObject, fallback = 'DRV') {
  if (identifierOrObject === null || identifierOrObject === undefined) {
    return fallback;
  }

  if (typeof identifierOrObject === 'object' && identifierOrObject.code) {
    return identifierOrObject.code.toUpperCase();
  }

  const profile = getDriverProfile(identifierOrObject);
  if (profile) {
    return profile.code ? profile.code.toUpperCase() : fallback;
  }

  const raw = extractRawIdentifier(identifierOrObject);
  if (!raw) return fallback;

  // If raw is a 3-letter alphabetical code
  if (/^[A-Za-z]{3}$/.test(raw)) {
    return raw.toUpperCase();
  }

  return fallback;
}
