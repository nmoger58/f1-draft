/**
 * managerData.js
 * Roster of authentic Formula 1 Team Principals and Race Managers.
 *
 * Each manager features distinct tactical attributes and bounded,
 * simulation-verified gameplay modifiers.
 *
 * Attributes (0–100 scale):
 *   strategy        – quality of undercut/overcut timing & weather detection
 *   tyreManagement  – tyre degradation preservation guidance
 *   pitCrew         – pit stop service execution speed & consistency
 *   leadership      – driver composure & psychological recovery
 *
 * Bounded Gameplay Modifiers:
 *   pitLossDelta    – stationary pit stop adjustment in seconds (-0.35s .. +0.10s)
 *   tyreDegMult     – scalar applied to tyre wear (0.94 .. 1.00)
 *   strategyBonus   – confidence scalar for pit window evaluation
 *   overtakePace    – fractional speed modifier during attack/DRS (+0.005 .. +0.015)
 *   launchAssistMs  – reaction time benefit off the grid (ms)
 */

export const MANAGERS = [
  {
    id: 'mgr_stella',
    name: 'Andrea Stella',
    team: 'McLaren',
    nationality: 'Italian',
    style: 'Analytical & Tactical Precision',
    avatar: '👨‍💼',
    rating: 95,
    attributes: {
      strategy: 96,
      tyreManagement: 92,
      pitCrew: 90,
      leadership: 94
    },
    bio: 'Former performance engineer renowned for data-driven strategic clarity and calm telemetry execution.',
    perks: [
      '+4% Tyre Longevity (0.96x tyre degradation)',
      '-0.20s Pit Stop Service Time',
      'Enhanced Undercut & Overcut Predictive Windows'
    ],
    modifiers: {
      pitLossDelta: -0.20,
      tyreDegMult: 0.96,
      strategyBonus: 0.08,
      overtakePace: 0.008,
      launchAssistMs: 0
    }
  },
  {
    id: 'mgr_horner',
    name: 'Christian Horner',
    team: 'Red Bull Racing',
    nationality: 'British',
    style: 'Relentless Attack & World-Record Pit Crew',
    avatar: '🎯',
    rating: 96,
    attributes: {
      strategy: 95,
      tyreManagement: 88,
      pitCrew: 99,
      leadership: 93
    },
    bio: 'Championship-winning principal famed for ultra-rapid pit stops and aggressive track position attacks.',
    perks: [
      '-0.35s Lightning Pit Stop Execution (World-Record Crew)',
      '+1.2% Overtaking Pace in DRS / Slipstream',
      'Aggressive Track Position Priority'
    ],
    modifiers: {
      pitLossDelta: -0.35,
      tyreDegMult: 0.99,
      strategyBonus: 0.06,
      overtakePace: 0.012,
      launchAssistMs: 5
    }
  },
  {
    id: 'mgr_vasseur',
    name: 'Frédéric Vasseur',
    team: 'Ferrari',
    nationality: 'French',
    style: 'Pragmatic Tyre Preservation & Composure',
    avatar: '🍷',
    rating: 94,
    attributes: {
      strategy: 91,
      tyreManagement: 96,
      pitCrew: 89,
      leadership: 92
    },
    bio: 'Veteran motorsport engineer who balances Italian passion with disciplined tyre management and recovery.',
    perks: [
      '+6% Tyre Degradation Resistance (0.94x wear)',
      '+10% Faster Composure Recovery after Spun/Lockup',
      'Optimal Wet/Dry Intermediate Strategy'
    ],
    modifiers: {
      pitLossDelta: -0.10,
      tyreDegMult: 0.94,
      strategyBonus: 0.07,
      overtakePace: 0.006,
      launchAssistMs: 0
    }
  },
  {
    id: 'mgr_wolff',
    name: 'Toto Wolff',
    team: 'Mercedes',
    nationality: 'Austrian',
    style: 'High-Performance Operations & Engine Mastery',
    avatar: '⚡',
    rating: 95,
    attributes: {
      strategy: 93,
      tyreManagement: 91,
      pitCrew: 92,
      leadership: 96
    },
    bio: 'Eight-time constructors champion managing operational perfection, aerodynamic balance and ERS deployment.',
    perks: [
      '+1.5 km/h Straight-Line Top Speed Deployment',
      '+5% ERS Acceleration Boost Efficiency',
      '-0.15s Pit Service Duration'
    ],
    modifiers: {
      pitLossDelta: -0.15,
      tyreDegMult: 0.97,
      strategyBonus: 0.06,
      overtakePace: 0.010,
      launchAssistMs: 0
    }
  },
  {
    id: 'mgr_vowles',
    name: 'James Vowles',
    team: 'Williams',
    nationality: 'British',
    style: 'Master Strategist & Weather Radar Architect',
    avatar: '📊',
    rating: 93,
    attributes: {
      strategy: 98,
      tyreManagement: 93,
      pitCrew: 88,
      leadership: 91
    },
    bio: 'Legendary strategy director celebrated for bold meteorological forecasts and tactical underdog victories.',
    perks: [
      '1 Lap Earlier Crossover Intelligence for Rain/Dry',
      '+8% Usable Grip on Fresh Out-Lap Tyres',
      '+5% Strategic Advice Accuracy'
    ],
    modifiers: {
      pitLossDelta: -0.12,
      tyreDegMult: 0.96,
      strategyBonus: 0.12,
      overtakePace: 0.005,
      launchAssistMs: 0
    }
  },
  {
    id: 'mgr_komatsu',
    name: 'Ayao Komatsu',
    team: 'Haas',
    nationality: 'Japanese',
    style: 'No-Nonsense Engineering & Brake Optimization',
    avatar: '🔧',
    rating: 90,
    attributes: {
      strategy: 88,
      tyreManagement: 90,
      pitCrew: 91,
      leadership: 89
    },
    bio: 'Respected race engineer turned principal focusing on mechanical efficiency, braking stability and direct comms.',
    perks: [
      '+8% Brake Thermal Cooling Efficiency',
      '-1.5% Aerodynamic Rolling Resistance',
      '-0.15s Consistent Pit Stop Time'
    ],
    modifiers: {
      pitLossDelta: -0.15,
      tyreDegMult: 0.98,
      strategyBonus: 0.05,
      overtakePace: 0.007,
      launchAssistMs: 5
    }
  },
  {
    id: 'mgr_krack',
    name: 'Mike Krack',
    team: 'Aston Martin',
    nationality: 'Luxembourgish',
    style: 'Endurance Craft & Resilient Defending',
    avatar: '🛡️',
    rating: 91,
    attributes: {
      strategy: 89,
      tyreManagement: 94,
      pitCrew: 89,
      leadership: 90
    },
    bio: 'Endurance racing specialist maximizing long-run stint endurance and wheel-to-wheel defensive consistency.',
    perks: [
      '+5% Extended Stint Tyre Durability',
      '+12% Defensive Resistance to Opponent Overtakes',
      '-0.10s Pit Stop Service Time'
    ],
    modifiers: {
      pitLossDelta: -0.10,
      tyreDegMult: 0.95,
      strategyBonus: 0.06,
      overtakePace: 0.005,
      launchAssistMs: 0
    }
  },
  {
    id: 'mgr_mekies',
    name: 'Laurent Mekies',
    team: 'Racing Bulls',
    nationality: 'French',
    style: 'Fast Reaction Launch & Safety Car Restarts',
    avatar: '🏁',
    rating: 90,
    attributes: {
      strategy: 89,
      tyreManagement: 89,
      pitCrew: 90,
      leadership: 88
    },
    bio: 'Former FIA safety director and Ferrari sporting director known for sharp restart timing and grid launches.',
    perks: [
      '-25ms Launch Reaction Assistance at Lights Out',
      '+1.5% Acceleration Spike on Safety Car Restarts',
      'Rapid Tactical Strategy Adaptation'
    ],
    modifiers: {
      pitLossDelta: -0.12,
      tyreDegMult: 0.98,
      strategyBonus: 0.07,
      overtakePace: 0.008,
      launchAssistMs: 25
    }
  }
];

export function getManagers() {
  return MANAGERS;
}

export function getManager(id) {
  return MANAGERS.find(m => m.id === id) || MANAGERS[0];
}
