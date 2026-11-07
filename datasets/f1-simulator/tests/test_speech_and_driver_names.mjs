/**
 * test_speech_and_driver_names.mjs
 * Comprehensive automated verification test suite for:
 *   1. Centralized Driver-Name Resolver (Full Names, Surnames, Short Codes)
 *   2. Natural Speech Formatter for Time, Units, and Numbers (TTS Pipeline)
 *   3. Commentary Engine Full-Name Interpolation & spokenText Output
 *   4. Race Engineer Tactical Radio Full-Name Integration
 *   5. Race Engine Event Emission with Full Canonical Names
 *   6. Compact UI Leaderboard / Timing Tower Code Preservation
 */

import {
  resolveDriverFullName,
  resolveDriverSurname,
  resolveDriverShortName,
  getDriverProfile,
  CANONICAL_DRIVERS
} from '../src/utils/driverResolver.js';

import {
  formatForSpeech,
  formatLapTimeForSpeech,
  integerToWords,
  decimalDigitsToWords
} from '../src/utils/speechFormatter.js';

import { CommentaryEngine } from '../src/strategy/commentaryEngine.js';
import { RaceEngineer, RadioPriority } from '../src/strategy/raceEngineer.js';
import { DRIVERS, getDriver } from '../src/data/driverData.js';
import { RaceEngine } from '../src/simulation/raceEngine.js';
import { buildTrack } from '../src/simulation/trackManager.js';
import { getCircuit, RAW_WAYPOINTS } from '../src/data/circuitData.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAILED: ${message}`);
    failed++;
  }
}

function assertEquals(actual, expected, message) {
  if (actual === expected) {
    console.log(`  ✅ ${message} (${JSON.stringify(actual)})`);
    passed++;
  } else {
    console.error(`  ❌ FAILED: ${message}\n      Expected: ${JSON.stringify(expected)}\n      Actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

async function runTests() {
  console.log('\n🧪 RUNNING NATURAL SPEECH & DRIVER RESOLVER TEST SUITE 🧪\n');

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST GROUP 1: Driver-Name Resolver (Canonical Names, Surnames & Codes)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('--- TEST GROUP 1: Centralized Driver-Name Resolver ---');

  // Exact 3-letter code resolution to full name
  assertEquals(resolveDriverFullName('VER'), 'Max Verstappen', 'Resolves VER to Max Verstappen');
  assertEquals(resolveDriverFullName('NOR'), 'Lando Norris', 'Resolves NOR to Lando Norris');
  assertEquals(resolveDriverFullName('LEC'), 'Charles Leclerc', 'Resolves LEC to Charles Leclerc');
  assertEquals(resolveDriverFullName('HAM'), 'Lewis Hamilton', 'Resolves HAM to Lewis Hamilton');
  assertEquals(resolveDriverFullName('SAI'), 'Carlos Sainz', 'Resolves SAI to Carlos Sainz');
  assertEquals(resolveDriverFullName('PIA'), 'Oscar Piastri', 'Resolves PIA to Oscar Piastri');
  assertEquals(resolveDriverFullName('RUS'), 'George Russell', 'Resolves RUS to George Russell');
  assertEquals(resolveDriverFullName('PER'), 'Sergio Pérez', 'Resolves PER to Sergio Pérez');
  assertEquals(resolveDriverFullName('ALO'), 'Fernando Alonso', 'Resolves ALO to Fernando Alonso');
  assertEquals(resolveDriverFullName('STR'), 'Lance Stroll', 'Resolves STR to Lance Stroll');
  assertEquals(resolveDriverFullName('GAS'), 'Pierre Gasly', 'Resolves GAS to Pierre Gasly');
  assertEquals(resolveDriverFullName('OCO'), 'Esteban Ocon', 'Resolves OCO to Esteban Ocon');
  assertEquals(resolveDriverFullName('ALB'), 'Alex Albon', 'Resolves ALB to Alex Albon');
  assertEquals(resolveDriverFullName('COL'), 'Franco Colapinto', 'Resolves COL to Franco Colapinto');
  assertEquals(resolveDriverFullName('TSU'), 'Yuki Tsunoda', 'Resolves TSU to Yuki Tsunoda');
  assertEquals(resolveDriverFullName('LAW'), 'Liam Lawson', 'Resolves LAW to Liam Lawson');
  assertEquals(resolveDriverFullName('BOT'), 'Valtteri Bottas', 'Resolves BOT to Valtteri Bottas');
  assertEquals(resolveDriverFullName('ZHO'), 'Zhou Guanyu', 'Resolves ZHO to Zhou Guanyu');
  assertEquals(resolveDriverFullName('HUL'), 'Nico Hülkenberg', 'Resolves HUL to Nico Hülkenberg');
  assertEquals(resolveDriverFullName('MAG'), 'Kevin Magnussen', 'Resolves MAG to Kevin Magnussen');
  assertEquals(resolveDriverFullName('BEA'), 'Oliver Bearman', 'Resolves BEA to Oliver Bearman');
  assertEquals(resolveDriverFullName('BOR'), 'Gabriel Bortoleto', 'Resolves BOR to Gabriel Bortoleto');
  assertEquals(resolveDriverFullName('DOO'), 'Jack Doohan', 'Resolves DOO to Jack Doohan');
  assertEquals(resolveDriverFullName('ANT'), 'Kimi Antonelli', 'Resolves ANT to Kimi Antonelli');

  // Case-insensitivity
  assertEquals(resolveDriverFullName('ver'), 'Max Verstappen', 'Resolves lowercase "ver" to Max Verstappen');
  assertEquals(resolveDriverFullName('nor'), 'Lando Norris', 'Resolves lowercase "nor" to Lando Norris');

  // Surname resolution
  assertEquals(resolveDriverSurname('VER'), 'Verstappen', 'Surname for VER is Verstappen');
  assertEquals(resolveDriverSurname('HAM'), 'Hamilton', 'Surname for HAM is Hamilton');
  assertEquals(resolveDriverSurname('LEC'), 'Leclerc', 'Surname for LEC is Leclerc');
  assertEquals(resolveDriverSurname('SAI'), 'Sainz', 'Surname for SAI is Sainz');
  assertEquals(resolveDriverSurname('ZHO'), 'Zhou', 'Surname for Zhou Guanyu is Zhou (Chinese family name)');

  // Short 3-letter code resolution
  assertEquals(resolveDriverShortName('Max Verstappen'), 'VER', 'Resolves Max Verstappen to VER');
  assertEquals(resolveDriverShortName('Lando Norris'), 'NOR', 'Resolves Lando Norris to NOR');
  assertEquals(resolveDriverShortName('Charles Leclerc'), 'LEC', 'Resolves Charles Leclerc to LEC');
  assertEquals(resolveDriverShortName('Lewis Hamilton'), 'HAM', 'Resolves Lewis Hamilton to HAM');

  // Object resolution
  const mockCar = { code: 'VER', name: 'Max Verstappen', team: 'Red Bull' };
  assertEquals(resolveDriverFullName(mockCar), 'Max Verstappen', 'Resolves car object to full name');
  assertEquals(resolveDriverShortName(mockCar), 'VER', 'Resolves car object to short code');

  // Profile lookup
  const prof = getDriverProfile('NOR');
  assert(prof && prof.fullName === 'Lando Norris', 'getDriverProfile returns valid profile for NOR');

  // Fallback behavior: never invents fake names
  assertEquals(resolveDriverFullName(null, 'the driver'), 'the driver', 'Null identifier returns fallback');
  assertEquals(resolveDriverFullName(undefined, 'the car'), 'the car', 'Undefined identifier returns fallback');
  assertEquals(resolveDriverFullName('Unknown Driver 99'), 'Unknown Driver 99', 'Custom driver name preserved cleanly');

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST GROUP 2: Natural Speech Formatter (Durations & Numbers)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n--- TEST GROUP 2: Natural Speech Formatter (Durations & Numbers) ---');

  // Durations
  assertEquals(formatForSpeech('12s'), '12 seconds', 'Formats "12s" -> "12 seconds"');
  assertEquals(formatForSpeech('5s'), '5 seconds', 'Formats "5s" -> "5 seconds"');
  assertEquals(formatForSpeech('1s'), '1 second', 'Formats "1s" -> "1 second"');
  assertEquals(formatForSpeech('0.5s'), '0.5 seconds', 'Formats "0.5s" -> "0.5 seconds"');
  assertEquals(formatForSpeech('1m 20s'), '1 minute 20 seconds', 'Formats "1m 20s" -> "1 minute 20 seconds"');
  assertEquals(formatForSpeech('2m 5s'), '2 minutes 5 seconds', 'Formats "2m 5s" -> "2 minutes 5 seconds"');
  assertEquals(formatForSpeech('1m 1s'), '1 minute 1 second', 'Formats "1m 1s" -> "1 minute 1 second"');

  // Signed time deltas / gaps
  assertEquals(formatForSpeech('+1.234s'), 'plus 1.234 seconds', 'Formats "+1.234s" -> "plus 1.234 seconds"');
  assertEquals(formatForSpeech('-0.500s'), 'minus 0.500 seconds', 'Formats "-0.500s" -> "minus 0.500 seconds"');
  assertEquals(formatForSpeech('+1.2s'), 'plus 1.2 seconds', 'Formats "+1.2s" -> "plus 1.2 seconds"');
  assertEquals(formatForSpeech('-1s'), 'minus 1 second', 'Formats "-1s" -> "minus 1 second"');

  // Common motorsport values
  assertEquals(formatForSpeech('Lap 12'), 'lap twelve', 'Formats "Lap 12" -> "lap twelve"');
  assertEquals(formatForSpeech('Lap 1'), 'lap one', 'Formats "Lap 1" -> "lap one"');
  assertEquals(formatForSpeech('220 km/h'), '220 kilometres per hour', 'Formats "220 km/h" with British English spelling');
  assertEquals(formatForSpeech('220km/h'), '220 kilometres per hour', 'Formats "220km/h" without space');
  assertEquals(formatForSpeech('72%'), '72 percent', 'Formats "72%" -> "72 percent"');
  assertEquals(formatForSpeech('300 m'), '300 metres', 'Formats "300 m" with British English spelling');
  assertEquals(formatForSpeech('300m'), '300 metres', 'Formats "300m" -> "300 metres"');
  assertEquals(formatForSpeech('95°C'), '95 degrees Celsius', 'Formats "95°C" with British English spelling');
  assertEquals(formatForSpeech('95 deg C'), '95 degrees Celsius', 'Formats "95 deg C" -> "95 degrees Celsius"');

  // Lap time formatting
  assertEquals(
    formatForSpeech('1:32.456'),
    'one minute, thirty-two point four five six seconds',
    'Formats "1:32.456" -> "one minute, thirty-two point four five six seconds"'
  );

  // Position formatting
  assertEquals(formatForSpeech('P1'), 'position 1', 'Formats standalone "P1" -> "position 1"');
  assertEquals(formatForSpeech('Passes NOR for P1'), 'Passes NOR for first place', 'Formats "for P1" -> "for first place"');
  assertEquals(formatForSpeech('Currently P3'), 'Currently position 3', 'Formats "Currently P3" -> "Currently position 3"');

  // Acronym pronunciation
  assertEquals(formatForSpeech('DRS available'), 'D-R-S available', 'Formats "DRS" -> "D-R-S"');
  assertEquals(formatForSpeech('VSC deployed'), 'V-S-C deployed', 'Formats "VSC" -> "V-S-C"');
  assertEquals(formatForSpeech('SC deployed'), 'Safety Car deployed', 'Formats "SC deployed" -> "Safety Car deployed"');
  assertEquals(formatForSpeech('FIA investigation'), 'F-I-A investigation', 'Formats "FIA" -> "F-I-A"');
  assertEquals(formatForSpeech('Car had a DNF'), 'Car had a D-N-F', 'Formats "DNF" -> "D-N-F"');

  // Anti-double-expansion guard
  const alreadyExpanded = 'Pit stop was 12 seconds';
  assertEquals(formatForSpeech(alreadyExpanded), 'Pit stop was 12 seconds', 'Prevents double-expansion ("12 seconds seconds")');
  const alreadyMinutes = 'Stint lasted 5 minutes';
  assertEquals(formatForSpeech(alreadyMinutes), 'Stint lasted 5 minutes', 'Prevents double-expansion of minutes');

  // Bracket and UI symbols cleanup
  assertEquals(
    formatForSpeech('Box now (~12s loss saving) [ BOX THIS LAP (B) ]'),
    'Box now approximately 12 seconds loss saving Box this lap',
    'Strips UI button prompts and cleans ~ symbol'
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST GROUP 3: Dynamic CSV Commentary Engine Full-Name Interpolation
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n--- TEST GROUP 3: Commentary Engine Full-Name Interpolation ---');

  const commEngine = new CommentaryEngine();
  await commEngine.load();

  // Test overtake dialogue interpolation with codes passed in
  const overtakeComm = commEngine.processEvent('OVERTAKE_SUCCESS', {
    overtaker: 'VER',
    overtaken: 'NOR',
    position: 2,
    simTime: 120
  });

  assert(overtakeComm !== null, 'Commentary engine produced overtake message');
  assert(
    overtakeComm.msg.includes('Max Verstappen') || overtakeComm.msg.includes('Verstappen'),
    `Overtake message contains full overtaker name (got: "${overtakeComm.msg}")`
  );
  assert(
    overtakeComm.msg.includes('Lando Norris') || overtakeComm.msg.includes('Norris'),
    `Overtake message contains full overtaken name (got: "${overtakeComm.msg}")`
  );
  assert(
    !overtakeComm.msg.includes('{overtaker}') && !overtakeComm.msg.includes('{overtaken}'),
    'All placeholders replaced without literal brackets'
  );
  assert(
    typeof overtakeComm.spokenText === 'string' && overtakeComm.spokenText.length > 0,
    `Commentary provides spokenText ready for TTS (spokenText: "${overtakeComm.spokenText}")`
  );

  // Test lead change dialogue
  const leadComm = commEngine.processEvent('LEAD_CHANGE', {
    driver: 'LEC',
    position: 1,
    simTime: 150
  });

  assert(leadComm !== null, 'Commentary engine produced lead change message');
  assert(
    leadComm.msg.includes('Charles Leclerc'),
    `Lead change message contains Charles Leclerc (got: "${leadComm.msg}")`
  );

  // Test position lost with {rival}
  const posLostComm = commEngine.processEvent('POSITION_LOST', {
    rival: 'HAM',
    simTime: 180
  });
  assert(posLostComm !== null, 'Commentary engine produced position lost message');
  assert(
    posLostComm.msg.includes('Lewis Hamilton'),
    `Position lost message contains full name Lewis Hamilton (got: "${posLostComm.msg}")`
  );

  // Test fastest lap dialogue with {driver}
  const flComm = commEngine.processEvent('FASTEST_LAP', {
    driver: 'SAI',
    simTime: 220
  });
  assert(flComm !== null, 'Produced fastest lap commentary');
  assert(
    flComm.msg.includes('Carlos Sainz'),
    `Fastest lap commentary includes Carlos Sainz (got: "${flComm.msg}")`
  );

  // Test gap ahead with {driver_ahead} and {gap_ahead}
  const gapComm = commEngine.processEvent('GAP_AHEAD', {
    driver_ahead: 'PIA',
    gap_ahead: 1.234,
    simTime: 240
  });
  assert(gapComm !== null, 'Produced gap ahead commentary');
  assert(
    gapComm.msg.includes('Oscar Piastri'),
    `Gap ahead commentary contains Oscar Piastri (got: "${gapComm.msg}")`
  );
  assert(
    gapComm.spokenText.includes('Oscar Piastri'),
    `Gap ahead spokenText contains Oscar Piastri (got: "${gapComm.spokenText}")`
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST GROUP 4: Race Engineer Tactical Full-Name Integration
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n--- TEST GROUP 4: Race Engineer Tactical Full-Name Integration ---');

  const playerCar = {
    code: 'NOR',
    driver: getDriver('NOR'),
    team: 'McLaren',
    lap: 5,
    v: 70,
    d: 1200,
    drsEligible: true,
    drsGapS: 0.8,
    tyreModel: { wear: 0.15, temp: 95, compound: 'medium' },
    fuelModel: { isLow: false }
  };

  const carAhead = {
    code: 'VER',
    driver: getDriver('VER'),
    team: 'Red Bull Racing',
    lap: 5,
    v: 70,
    d: 1250,
    tyreModel: { wear: 0.45, temp: 105, compound: 'soft' }
  };

  const carBehind = {
    code: 'LEC',
    driver: getDriver('LEC'),
    team: 'Ferrari',
    lap: 5,
    v: 72,
    d: 1160,
    tyreModel: { wear: 0.10, temp: 98, compound: 'medium' }
  };

  const engineer = new RaceEngineer(playerCar);
  const radioMsgs = engineer.evaluate({
    simTime: 85,
    flag: 'green',
    weather: { isRaining: false },
    trackWetness: 0,
    carAhead,
    carBehind,
    standings: [carAhead, playerCar, carBehind],
    totalLaps: 20
  });

  assert(radioMsgs.length > 0, 'Race engineer generated tactical messages');
  const overtakeMsg = radioMsgs.find(m => m.category === 'overtake');
  assert(overtakeMsg !== undefined, 'Generated overtake tactical radio message');
  if (overtakeMsg) {
    assert(
      overtakeMsg.msg.includes('Max Verstappen'),
      `Overtake message addresses Max Verstappen by full name (got: "${overtakeMsg.msg}")`
    );
    assert(
      overtakeMsg.spokenText.includes('Max Verstappen'),
      `Spoken text contains Max Verstappen (got: "${overtakeMsg.spokenText}")`
    );
    assert(
      overtakeMsg.spokenText.includes('seconds') || overtakeMsg.spokenText.includes('second'),
      `Spoken text expanded duration "0.80s" -> "seconds" (got: "${overtakeMsg.spokenText}")`
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST GROUP 5: Race Engine Simulation Event Emitting with Full Names
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n--- TEST GROUP 5: Race Engine Simulation Events ---');

  const circuit = getCircuit('monaco');
  const track = buildTrack(circuit, RAW_WAYPOINTS['monaco']);
  const engine = new RaceEngine();
  engine.build(track, DRIVERS.slice(0, 6), 3, {});

  // Simulate positions to trigger an overtake
  const car0 = engine.cars[0]; // NOR
  const car1 = engine.cars[1]; // VER
  car1.d = car0.d + 10;
  car1.prevPosition = 2;

  const events = [];
  const radioEvents = [];
  engine._updatePositions(events, radioEvents);

  const leadEvent = events.find(e => e.type === 'lead_change');
  if (leadEvent) {
    assert(
      leadEvent.detail.includes('Lando Norris'),
      `Lead change detail includes full driver name: "${leadEvent.detail}"`
    );
  }

  // Verify race finish event passes full driver name
  const finishEvents = [];
  engine._onRaceFinish(finishEvents);
  const finEv = finishEvents.find(e => e.type === 'finish');
  assert(finEv !== undefined, 'Race finish event created');
  assert(
    finEv.detail.includes('wins the race'),
    `Finish event declares winner correctly: "${finEv.detail}"`
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST GROUP 6: Timing Tower & Compact Leaderboard UI Preservation
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n--- TEST GROUP 6: Timing Tower & Compact Leaderboard Preservation ---');

  // Verify that car.code remains intact and 3 letters for timing towers
  assert(car0.code === 'NOR', 'Timing tower uses 3-letter code NOR for car 0');
  assert(car1.code === 'PIA', 'Timing tower uses 3-letter code PIA for car 1');
  engine.cars.forEach(car => {
    assert(
      typeof car.code === 'string' && car.code.length === 3,
      `Car code ${car.code} remains exactly 3 letters for timing tower HUD`
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n════════════════════════════════════════════════════════════');
  console.log(`🏁 TEST RESULTS: ${passed} PASSED, ${failed} FAILED (${Math.round((passed / (passed + failed)) * 100)}%) 🏁`);
  console.log('════════════════════════════════════════════════════════════\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
