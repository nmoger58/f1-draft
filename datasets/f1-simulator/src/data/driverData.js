/**
 * driverData.js
 * 2025 F1 grid: driver profiles with personality attributes derived from
 * game ratings (F1 23), career stats, and historical performance patterns.
 *
 * Extended with:
 *   nationality   – driver nationality (e.g. British, Monégasque)
 *   country       – country name (e.g. United Kingdom, Monaco)
 *   countryCode   – ISO alpha-3 code (e.g. GBR, MCO)
 *   homeCity      – home region/city
 *   homeCircuitIds– explicit circuit ID overrides for home events
 *   engineerName  – official race engineer name
 *
 * Personality attributes (0–1 scale):
 *   aggression    – likelihood to attempt bold overtakes
 *   consistency   – pace variance lap-to-lap
 *   racecraft     – defensive and positional awareness
 *   tyreManagement– ability to look after tyres
 *   wetSkill      – performance in rain / low-grip conditions
 *   attackSkill   – overtaking ability
 *   adaptability  – responds well to changing conditions
 *
 * pace: fractional speed modifier relative to the fastest car (1.000 = fastest)
 */

export const DRIVERS = [
  // McLaren
  {
    code: 'NOR', name: 'Lando Norris', team: 'McLaren', number: 4, color: '#FF8000', teamColor: '#FF8000',
    nationality: 'British', country: 'United Kingdom', countryCode: 'GBR', homeCity: 'Glastonbury',
    homeCircuitIds: ['silverstone'],
    engineerName: 'Will Joseph',
    pace: 1.000,
    personality: { aggression: 0.72, consistency: 0.88, racecraft: 0.82, tyreManagement: 0.75, wetSkill: 0.84, attackSkill: 0.80, adaptability: 0.85 }
  },
  {
    code: 'PIA', name: 'Oscar Piastri', team: 'McLaren', number: 81, color: '#FFB066', teamColor: '#FF8000',
    nationality: 'Australian', country: 'Australia', countryCode: 'AUS', homeCity: 'Melbourne',
    homeCircuitIds: [],
    engineerName: 'Tom Stallard',
    pace: 0.994,
    personality: { aggression: 0.58, consistency: 0.90, racecraft: 0.76, tyreManagement: 0.82, wetSkill: 0.78, attackSkill: 0.70, adaptability: 0.88 }
  },
  // Ferrari
  {
    code: 'LEC', name: 'Charles Leclerc', team: 'Ferrari', number: 16, color: '#E8002D', teamColor: '#E8002D',
    nationality: 'Monégasque', country: 'Monaco', countryCode: 'MCO', homeCity: 'Monte Carlo',
    homeCircuitIds: ['monaco'],
    engineerName: 'Bryan Bozzi',
    pace: 0.988,
    personality: { aggression: 0.68, consistency: 0.80, racecraft: 0.78, tyreManagement: 0.72, wetSkill: 0.80, attackSkill: 0.82, adaptability: 0.78 }
  },
  {
    code: 'HAM', name: 'Lewis Hamilton', team: 'Ferrari', number: 44, color: '#FF5A78', teamColor: '#E8002D',
    nationality: 'British', country: 'United Kingdom', countryCode: 'GBR', homeCity: 'Stevenage',
    homeCircuitIds: ['silverstone'],
    engineerName: 'Riccardo Adami',
    pace: 0.982,
    personality: { aggression: 0.62, consistency: 0.92, racecraft: 0.96, tyreManagement: 0.90, wetSkill: 0.95, attackSkill: 0.88, adaptability: 0.93 }
  },
  // Red Bull
  {
    code: 'VER', name: 'Max Verstappen', team: 'Red Bull Racing', number: 1, color: '#3671C6', teamColor: '#3671C6',
    nationality: 'Dutch', country: 'Netherlands', countryCode: 'NLD', homeCity: 'Hasselt',
    homeCircuitIds: ['spa'], // Max was born in Belgium and regards Spa alongside Zandvoort as his home event
    engineerName: 'Gianpiero Lambiase',
    pace: 0.976,
    personality: { aggression: 0.90, consistency: 0.95, racecraft: 0.94, tyreManagement: 0.85, wetSkill: 0.92, attackSkill: 0.96, adaptability: 0.94 }
  },
  {
    code: 'TSU', name: 'Yuki Tsunoda', team: 'Red Bull Racing', number: 22, color: '#5B9CF6', teamColor: '#3671C6',
    nationality: 'Japanese', country: 'Japan', countryCode: 'JPN', homeCity: 'Sagamihara',
    homeCircuitIds: ['suzuka'],
    engineerName: 'Mattia Spini',
    pace: 0.948,
    personality: { aggression: 0.78, consistency: 0.68, racecraft: 0.65, tyreManagement: 0.62, wetSkill: 0.70, attackSkill: 0.72, adaptability: 0.68 }
  },
  // Mercedes
  {
    code: 'RUS', name: 'George Russell', team: 'Mercedes', number: 63, color: '#27F4D2', teamColor: '#27F4D2',
    nationality: 'British', country: 'United Kingdom', countryCode: 'GBR', homeCity: "King's Lynn",
    homeCircuitIds: ['silverstone'],
    engineerName: 'Marcus Dudley',
    pace: 0.970,
    personality: { aggression: 0.65, consistency: 0.86, racecraft: 0.80, tyreManagement: 0.84, wetSkill: 0.82, attackSkill: 0.75, adaptability: 0.83 }
  },
  {
    code: 'ANT', name: 'Kimi Antonelli', team: 'Mercedes', number: 12, color: '#1AC8B0', teamColor: '#27F4D2',
    nationality: 'Italian', country: 'Italy', countryCode: 'ITA', homeCity: 'Bologna',
    homeCircuitIds: ['monza'],
    engineerName: 'Peter Bonnington',
    pace: 0.955,
    personality: { aggression: 0.60, consistency: 0.78, racecraft: 0.70, tyreManagement: 0.74, wetSkill: 0.76, attackSkill: 0.68, adaptability: 0.80 }
  },
  // Williams
  {
    code: 'ALB', name: 'Alex Albon', team: 'Williams', number: 23, color: '#64C8FF', teamColor: '#37BEDD',
    nationality: 'Thai', country: 'Thailand', countryCode: 'THA', homeCity: 'London',
    homeCircuitIds: [],
    engineerName: 'James Urwin',
    pace: 0.945,
    personality: { aggression: 0.60, consistency: 0.78, racecraft: 0.74, tyreManagement: 0.80, wetSkill: 0.75, attackSkill: 0.70, adaptability: 0.78 }
  },
  {
    code: 'SAI', name: 'Carlos Sainz', team: 'Williams', number: 55, color: '#96D8FF', teamColor: '#37BEDD',
    nationality: 'Spanish', country: 'Spain', countryCode: 'ESP', homeCity: 'Madrid',
    homeCircuitIds: [],
    engineerName: 'Gaetan Jego',
    pace: 0.960,
    personality: { aggression: 0.64, consistency: 0.84, racecraft: 0.82, tyreManagement: 0.86, wetSkill: 0.80, attackSkill: 0.76, adaptability: 0.82 }
  },
  // Aston Martin
  {
    code: 'ALO', name: 'Fernando Alonso', team: 'Aston Martin', number: 14, color: '#358C75', teamColor: '#358C75',
    nationality: 'Spanish', country: 'Spain', countryCode: 'ESP', homeCity: 'Oviedo',
    homeCircuitIds: [],
    engineerName: 'Hugh Bird',
    pace: 0.952,
    personality: { aggression: 0.74, consistency: 0.88, racecraft: 0.96, tyreManagement: 0.92, wetSkill: 0.90, attackSkill: 0.86, adaptability: 0.95 }
  },
  {
    code: 'STR', name: 'Lance Stroll', team: 'Aston Martin', number: 18, color: '#4DB68C', teamColor: '#358C75',
    nationality: 'Canadian', country: 'Canada', countryCode: 'CAN', homeCity: 'Montreal',
    homeCircuitIds: [],
    engineerName: 'Ben Michell',
    pace: 0.936,
    personality: { aggression: 0.55, consistency: 0.70, racecraft: 0.64, tyreManagement: 0.72, wetSkill: 0.68, attackSkill: 0.60, adaptability: 0.66 }
  },
  // Racing Bulls
  {
    code: 'LAW', name: 'Liam Lawson', team: 'Racing Bulls', number: 30, color: '#6B7FD4', teamColor: '#6B7FD4',
    nationality: 'New Zealander', country: 'New Zealand', countryCode: 'NZL', homeCity: 'Hastings',
    homeCircuitIds: [],
    engineerName: 'Pierre Hamelin',
    pace: 0.940,
    personality: { aggression: 0.68, consistency: 0.74, racecraft: 0.68, tyreManagement: 0.70, wetSkill: 0.72, attackSkill: 0.70, adaptability: 0.74 }
  },
  {
    code: 'HAD', name: 'Isack Hadjar', team: 'Racing Bulls', number: 6, color: '#8896E0', teamColor: '#6B7FD4',
    nationality: 'French', country: 'France', countryCode: 'FRA', homeCity: 'Paris',
    homeCircuitIds: [],
    engineerName: 'Marco Matassa',
    pace: 0.935,
    personality: { aggression: 0.62, consistency: 0.72, racecraft: 0.65, tyreManagement: 0.68, wetSkill: 0.68, attackSkill: 0.65, adaptability: 0.72 }
  },
  // Haas
  {
    code: 'OCO', name: 'Esteban Ocon', team: 'Haas', number: 31, color: '#B6BABD', teamColor: '#B6BABD',
    nationality: 'French', country: 'France', countryCode: 'FRA', homeCity: 'Évreux',
    homeCircuitIds: [],
    engineerName: 'Josh Peckett',
    pace: 0.938,
    personality: { aggression: 0.65, consistency: 0.76, racecraft: 0.74, tyreManagement: 0.78, wetSkill: 0.74, attackSkill: 0.70, adaptability: 0.74 }
  },
  {
    code: 'BEA', name: 'Oliver Bearman', team: 'Haas', number: 87, color: '#CACECE', teamColor: '#B6BABD',
    nationality: 'British', country: 'United Kingdom', countryCode: 'GBR', homeCity: 'Chelmsford',
    homeCircuitIds: ['silverstone'],
    engineerName: 'Ronnie Schouwink',
    pace: 0.930,
    personality: { aggression: 0.58, consistency: 0.70, racecraft: 0.65, tyreManagement: 0.68, wetSkill: 0.66, attackSkill: 0.62, adaptability: 0.70 }
  },
  // Kick Sauber
  {
    code: 'HUL', name: 'Nico Hülkenberg', team: 'Kick Sauber', number: 27, color: '#52E252', teamColor: '#52E252',
    nationality: 'German', country: 'Germany', countryCode: 'DEU', homeCity: 'Emmerich',
    homeCircuitIds: [],
    engineerName: 'Steven Petrik',
    pace: 0.934,
    personality: { aggression: 0.60, consistency: 0.80, racecraft: 0.78, tyreManagement: 0.80, wetSkill: 0.76, attackSkill: 0.70, adaptability: 0.78 }
  },
  {
    code: 'BOR', name: 'Gabriel Bortoleto', team: 'Kick Sauber', number: 5, color: '#7AEA7A', teamColor: '#52E252',
    nationality: 'Brazilian', country: 'Brazil', countryCode: 'BRA', homeCity: 'São Paulo',
    homeCircuitIds: ['interlagos'],
    engineerName: 'Alex Chan',
    pace: 0.925,
    personality: { aggression: 0.62, consistency: 0.68, racecraft: 0.62, tyreManagement: 0.65, wetSkill: 0.66, attackSkill: 0.65, adaptability: 0.70 }
  },
  // Alpine
  {
    code: 'GAS', name: 'Pierre Gasly', team: 'Alpine', number: 10, color: '#FF87BC', teamColor: '#FF87BC',
    nationality: 'French', country: 'France', countryCode: 'FRA', homeCity: 'Rouen',
    homeCircuitIds: [],
    engineerName: 'John Evenden',
    pace: 0.940,
    personality: { aggression: 0.64, consistency: 0.76, racecraft: 0.72, tyreManagement: 0.74, wetSkill: 0.72, attackSkill: 0.68, adaptability: 0.74 }
  },
  {
    code: 'COL', name: 'Franco Colapinto', team: 'Alpine', number: 43, color: '#FFB8D6', teamColor: '#FF87BC',
    nationality: 'Argentine', country: 'Argentina', countryCode: 'ARG', homeCity: 'Buenos Aires',
    homeCircuitIds: [],
    engineerName: 'Karel Loos',
    pace: 0.928,
    personality: { aggression: 0.66, consistency: 0.68, racecraft: 0.62, tyreManagement: 0.66, wetSkill: 0.64, attackSkill: 0.65, adaptability: 0.68 }
  },
];

/** Return the first N drivers sorted by pace descending (for default grid) */
export function getGrid(n = 6) {
  return DRIVERS.slice(0, Math.min(n, DRIVERS.length));
}

/** Get driver by 3-letter code */
export function getDriver(code) {
  return DRIVERS.find(d => d.code === code) || null;
}
