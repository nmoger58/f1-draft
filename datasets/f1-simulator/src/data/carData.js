/**
 * carData.js
 * Roster of authentic Formula 1 constructor cars for the Draft Selection System.
 *
 * Each car features distinct performance statistics (0–100) and authoritative,
 * bounded physical modifiers that integrate directly with physicsEngine and tyreModel.
 *
 * Modifiers:
 *   maxSpeedBonus   – straight-line terminal velocity delta in m/s (-1.0 .. +1.5 m/s)
 *   accelMult       – longitudinal power and traction multiplier (0.97 .. 1.03)
 *   downforceMult   – aerodynamic cornering grip multiplier (0.96 .. 1.05)
 *   dragMult        – aerodynamic drag penalty/benefit (0.96 .. 1.04)
 *   tyreWearMult    – tyre wear rate scalar (0.93 .. 1.05; lower is better preservation)
 */

export const CARS = [
  {
    id: 'car_mcl38',
    name: 'McLaren MCL38',
    team: 'McLaren',
    color: '#FF8000',
    secondaryColor: '#1A1A1A',
    badge: '🟠',
    stats: {
      topSpeed: 93,
      acceleration: 96,
      cornering: 98,
      tyrePreservation: 97
    },
    strengths: 'Benchmark high-speed aero balance and class-leading tyre preservation in all temperatures.',
    weaknesses: 'Requires precise suspension tuning over high kerbs.',
    modifiers: {
      maxSpeedBonus: 0.5,
      accelMult: 1.025,
      downforceMult: 1.045,
      dragMult: 0.985,
      tyreWearMult: 0.94
    }
  },
  {
    id: 'car_rb20',
    name: 'Red Bull RB20',
    team: 'Red Bull Racing',
    color: '#3671C6',
    secondaryColor: '#CC1E4A',
    badge: '🔵',
    stats: {
      topSpeed: 98,
      acceleration: 97,
      cornering: 95,
      tyrePreservation: 92
    },
    strengths: 'Unrivalled aerodynamic efficiency, DRS straight-line punch, and extreme high-speed stability.',
    weaknesses: 'Slightly stiffer ride on aggressive chicane kerbs.',
    modifiers: {
      maxSpeedBonus: 1.4,
      accelMult: 1.028,
      downforceMult: 1.030,
      dragMult: 0.965,
      tyreWearMult: 0.98
    }
  },
  {
    id: 'car_sf24',
    name: 'Ferrari SF-24',
    team: 'Ferrari',
    color: '#E8002D',
    secondaryColor: '#FFF200',
    badge: '🔴',
    stats: {
      topSpeed: 94,
      acceleration: 98,
      cornering: 96,
      tyrePreservation: 95
    },
    strengths: 'Explosive low-speed corner traction, benign handling characteristics, and predictable tyre thermal window.',
    weaknesses: 'Slightly higher drag profile at extreme terminal velocity.',
    modifiers: {
      maxSpeedBonus: 0.6,
      accelMult: 1.030,
      downforceMult: 1.035,
      dragMult: 0.995,
      tyreWearMult: 0.95
    }
  },
  {
    id: 'car_w15',
    name: 'Mercedes W15',
    team: 'Mercedes',
    color: '#27F4D2',
    secondaryColor: '#808080',
    badge: '⚪',
    stats: {
      topSpeed: 95,
      acceleration: 94,
      cornering: 94,
      tyrePreservation: 93
    },
    strengths: 'High-speed downforce consistency, rapid ERS deployment, and powerful braking stability.',
    weaknesses: 'Sensitive to rising track surface temperatures on rear tyre deg.',
    modifiers: {
      maxSpeedBonus: 0.8,
      accelMult: 1.015,
      downforceMult: 1.020,
      dragMult: 0.985,
      tyreWearMult: 0.97
    }
  },
  {
    id: 'car_amr24',
    name: 'Aston Martin AMR24',
    team: 'Aston Martin',
    color: '#229971',
    secondaryColor: '#CEDC00',
    badge: '🟢',
    stats: {
      topSpeed: 92,
      acceleration: 93,
      cornering: 93,
      tyrePreservation: 94
    },
    strengths: 'Sharp front-end bite on slow corner entry, strong mechanical grip, and durable tyre life.',
    weaknesses: 'Higher aerodynamic drag on long straightaways.',
    modifiers: {
      maxSpeedBonus: 0.2,
      accelMult: 1.008,
      downforceMult: 1.015,
      dragMult: 1.010,
      tyreWearMult: 0.96
    }
  },
  {
    id: 'car_fw46',
    name: 'Williams FW46',
    team: 'Williams',
    color: '#64C8FF',
    secondaryColor: '#002B49',
    badge: '🔷',
    stats: {
      topSpeed: 99,
      acceleration: 92,
      cornering: 88,
      tyrePreservation: 90
    },
    strengths: 'Ultra-low drag straight-line weapon with blistering top speed, devastating in slipstream.',
    weaknesses: 'Lower downforce levels in long, sustained medium-speed corners.',
    modifiers: {
      maxSpeedBonus: 1.5,
      accelMult: 0.995,
      downforceMult: 0.975,
      dragMult: 0.955,
      tyreWearMult: 1.01
    }
  },
  {
    id: 'car_vcarb01',
    name: 'Racing Bulls VCARB 01',
    team: 'Racing Bulls',
    color: '#6692FF',
    secondaryColor: '#FFFFFF',
    badge: '🐂',
    stats: {
      topSpeed: 93,
      acceleration: 93,
      cornering: 91,
      tyrePreservation: 91
    },
    strengths: 'Agile direction changes in tight chicanes and responsive throttle pickup.',
    weaknesses: 'Moderate high-speed downforce sensitivity in turbulent dirty air.',
    modifiers: {
      maxSpeedBonus: 0.4,
      accelMult: 1.010,
      downforceMult: 0.995,
      dragMult: 0.995,
      tyreWearMult: 0.99
    }
  },
  {
    id: 'car_vf24',
    name: 'Haas VF-24',
    team: 'Haas',
    color: '#B6BABD',
    secondaryColor: '#E8002D',
    badge: '🏁',
    stats: {
      topSpeed: 95,
      acceleration: 92,
      cornering: 90,
      tyrePreservation: 89
    },
    strengths: 'Potent straight-line terminal velocity and robust mechanical brake stability.',
    weaknesses: 'Elevated tyre thermal degradation during long stints.',
    modifiers: {
      maxSpeedBonus: 0.9,
      accelMult: 1.005,
      downforceMult: 0.985,
      dragMult: 0.985,
      tyreWearMult: 1.03
    }
  },
  {
    id: 'car_a524',
    name: 'Alpine A524',
    team: 'Alpine',
    color: '#FF87BC',
    secondaryColor: '#0090FF',
    badge: '🌸',
    stats: {
      topSpeed: 91,
      acceleration: 91,
      cornering: 91,
      tyrePreservation: 92
    },
    strengths: 'Predictable balance over bumps and solid kinetic energy recovery under braking.',
    weaknesses: 'Power deficit on uphill acceleration zones.',
    modifiers: {
      maxSpeedBonus: 0.1,
      accelMult: 0.990,
      downforceMult: 0.995,
      dragMult: 1.005,
      tyreWearMult: 0.98
    }
  },
  {
    id: 'car_c44',
    name: 'Kick Sauber C44',
    team: 'Kick Sauber',
    color: '#52E252',
    secondaryColor: '#000000',
    badge: '🟢',
    stats: {
      topSpeed: 93,
      acceleration: 90,
      cornering: 89,
      tyrePreservation: 90
    },
    strengths: 'Slippery aero package yielding respectable speed trap figures with open DRS.',
    weaknesses: 'Lower peak downforce ceiling in high-speed sweeps.',
    modifiers: {
      maxSpeedBonus: 0.5,
      accelMult: 0.985,
      downforceMult: 0.970,
      dragMult: 0.980,
      tyreWearMult: 1.02
    }
  }
];

export function getCars() {
  return CARS;
}

export function getCar(id) {
  return CARS.find(c => c.id === id) || CARS[0];
}

export function getCarByTeam(teamName) {
  if (!teamName) return CARS[0];
  const normalized = teamName.toLowerCase();
  const match = CARS.find(c =>
    c.team.toLowerCase().includes(normalized) ||
    normalized.includes(c.team.toLowerCase())
  );
  return match || CARS[0];
}
