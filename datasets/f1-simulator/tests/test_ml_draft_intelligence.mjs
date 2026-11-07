/**
 * test_ml_draft_intelligence.mjs
 * Validates the ML Intelligence system, driver capabilities, sample size confidence,
 * car strengths, and manager tactical capabilities across all seasons (2019–2025).
 */

import {
  initMLIntelligence,
  getRarity,
  getDriverMLData,
  evaluateDriverTrackConfidence,
  enrichDriverWithML,
  enrichCarWithML,
  enrichManagerWithML,
  TRACK_WINS,
  CAR_TECHNICAL_STRENGTHS
} from '../src/data/mlIntelligence.js';

import { loadSeasonPools } from '../src/data/seasonCsvLoader.js';
import { DraftEngine }     from '../src/strategy/draftEngine.js';
import { DRIVERS }         from '../src/data/driverData.js';
import { CARS }            from '../src/data/carData.js';
import { MANAGERS }        from '../src/data/managerData.js';

console.log('=== Starting ML Draft Intelligence Tests ===\n');

// 1. Test Rarity Classification
console.log('Test 1: Rarity Classification Engine');
const leg = getRarity(93);
const epic = getRarity(88);
const rare = getRarity(84);
const unc = getRarity(79);
const com = getRarity(74);

if (leg.name !== 'LEGENDARY' || epic.name !== 'EPIC' || rare.name !== 'RARE' || unc.name !== 'UNCOMMON' || com.name !== 'COMMON') {
  throw new Error(`Rarity tier failure: ${leg.name}, ${epic.name}, ${rare.name}, ${unc.name}, ${com.name}`);
}
console.log('  ✓ 5 Rarity tiers verified (LEGENDARY, EPIC, RARE, UNCOMMON, COMMON)');

// 2. Test Driver ML Capabilities
console.log('Test 2: Driver ML Capabilities from 181,608-lap trained model');
const verML = getDriverMLData('VER');
const hamML = getDriverMLData('HAM');
const vetML = getDriverMLData('VET');

if (!verML.hasML || verML.confidencePct < 90 || verML.laps_in_data < 9000) {
  throw new Error(`Verstappen ML data invalid: ${JSON.stringify(verML)}`);
}
if (!hamML.hasML || hamML.tyre_z <= 1.0 || hamML.laps_in_data < 9000) {
  throw new Error(`Hamilton tyre_z ML invalid: ${JSON.stringify(hamML)}`);
}
if (!vetML.hasML || vetML.rating < 85) {
  throw new Error(`Vettel ML rating invalid: ${JSON.stringify(vetML)}`);
}
console.log(`  ✓ VER: ML Rating ${verML.rating}, Raw Pace ${verML.raw_pace_pct}%, Laps: ${verML.laps_in_data}, Confidence: ${verML.confidencePct}%`);
console.log(`  ✓ HAM: ML Rating ${hamML.rating}, Tyre Z: +${hamML.tyre_z}z, Deg/Lap: ${hamML.deg_per_lap}, Confidence: ${hamML.confidencePct}%`);
console.log(`  ✓ VET: ML Rating ${vetML.rating}, Consistency Z: ${vetML.consistency_z}z`);

// 3. Test Circuit Specialist & Home Soil Boost
console.log('Test 3: Circuit Specialist & Home Soil Edge');
const hamSilverstone = evaluateDriverTrackConfidence('HAM', 'British', 'silverstone');
const verSpa = evaluateDriverTrackConfidence('VER', 'Dutch', 'spa');
const lecMonaco = evaluateDriverTrackConfidence('LEC', 'Monegasque', 'monaco');

if (!hamSilverstone.isHome || hamSilverstone.wins < 8 || hamSilverstone.boost < 10) {
  throw new Error(`Hamilton Silverstone specialist check failed: ${JSON.stringify(hamSilverstone)}`);
}
if (verSpa.wins < 3 || verSpa.boost < 8) {
  throw new Error(`Verstappen Spa specialist check failed: ${JSON.stringify(verSpa)}`);
}
if (!lecMonaco.isHome || lecMonaco.boost < 5) {
  throw new Error(`Leclerc Monaco home soil check failed: ${JSON.stringify(lecMonaco)}`);
}
console.log(`  ✓ Hamilton at Silverstone: ${hamSilverstone.wins} Wins, Boost: +${hamSilverstone.boost}%, Badges: ${hamSilverstone.badges.map(b=>b.label).join(', ')}`);
console.log(`  ✓ Leclerc at Monaco: Home soil = ${lecMonaco.isHome}, Boost: +${lecMonaco.boost}%`);

// 4. Test Car Technical Strengths & Machinery Rating
console.log('Test 4: Car Technical Strengths & Machinery Rating');
const mclarenStrengths = CAR_TECHNICAL_STRENGTHS['McLaren'];
const ferrariStrengths = CAR_TECHNICAL_STRENGTHS['Ferrari'];
const williamsStrengths = CAR_TECHNICAL_STRENGTHS['Williams'];

if (!mclarenStrengths.strengths.includes('aerodynamic downforce balance')) {
  throw new Error('McLaren technical strengths missing aero description');
}
if (!williamsStrengths.aeroBias.includes('Low Drag')) {
  throw new Error('Williams technical strengths missing low drag profile');
}
const enrichedCar = enrichCarWithML(CARS[0]);
if (!enrichedCar.strengths || !enrichedCar.carRating || !enrichedCar.stats.topSpeed) {
  throw new Error(`Enriched car invalid: ${JSON.stringify(enrichedCar)}`);
}
console.log(`  ✓ McLaren: Machinery Rating ${enrichedCar.carRating} OVR, Rarity: ${enrichedCar.rarity.name}`);
console.log(`    Strengths: "${enrichedCar.strengths}"`);

// 5. Test Manager Tactical Attributes
console.log('Test 5: Manager Tactical Attributes');
const enrichedMgr = enrichManagerWithML(MANAGERS[0]);
if (!enrichedMgr.attributes.strategy || !enrichedMgr.attributes.pitCrew || !enrichedMgr.rarity) {
  throw new Error(`Enriched manager invalid: ${JSON.stringify(enrichedMgr)}`);
}
console.log(`  ✓ ${enrichedMgr.name}: Rating ${enrichedMgr.rating}, Pit Crew: ${enrichedMgr.attributes.pitCrew}, Strategy: ${enrichedMgr.attributes.strategy}`);

// 6. Test Default DraftEngine ML Infusion
console.log('Test 6: Default DraftEngine Infusion');
const eng = new DraftEngine({ circuitId: 'silverstone', autoRestore: false });
const d0 = eng.driverPool.find(d => d.code === 'HAM');
if (!d0 || !d0.confidencePct || !d0.trackBadges || d0.trackBadges.length === 0) {
  throw new Error(`HAM in DraftEngine not enriched with track badges at Silverstone`);
}
const c0 = eng.carPool[0];
if (!c0.strengths || !c0.carRating) {
  throw new Error(`Car 0 in DraftEngine not enriched with strengths`);
}
eng.selectEntity('driver', 'HAM');
eng.selectEntity('manager', MANAGERS[0].id);
eng.selectEntity('car', c0.id);
const summary = eng.getSummary();
if (!summary.teamOvr || !summary.carStrengths || !summary.confidencePct) {
  throw new Error(`DraftEngine summary missing ML fields: ${JSON.stringify(summary)}`);
}
console.log(`  ✓ DraftEngine Summary: Team OVR: ${summary.teamOvr}, Driver Confidence: ${summary.confidencePct}%, Strengths: "${summary.carStrengths}"`);

// 7. Test Historical Season CSV Loading & ML Infusion (2019 and 2025)
console.log('Test 7: Historical Seasons ML Enrichment (2019 and 2025)');
const season2019 = await loadSeasonPools(2019);
if (!season2019.drivers.length || !season2019.cars.length || !season2019.managers.length) {
  throw new Error('Season 2019 failed to load');
}
const ham2019 = season2019.drivers.find(d => d.code === 'HAM');
if (!ham2019 || !ham2019.confidencePct || !ham2019.rarity) {
  throw new Error(`2019 Hamilton not enriched with ML: ${JSON.stringify(ham2019)}`);
}
console.log(`  ✓ 2019 Season: ${season2019.drivers.length} drivers, ${season2019.cars.length} cars, ${season2019.managers.length} managers`);
console.log(`    HAM (2019): OVR ${ham2019.overallRating}, Rarity: ${ham2019.rarity.name}, Confidence: ${ham2019.confidencePct}%`);

const season2025 = await loadSeasonPools(2025);
if (!season2025.drivers.length || !season2025.cars.length || !season2025.managers.length) {
  throw new Error('Season 2025 failed to load');
}
const nor2025 = season2025.drivers.find(d => d.code === 'NOR');
if (!nor2025 || !nor2025.confidencePct) {
  throw new Error(`2025 Norris not enriched with ML`);
}
console.log(`  ✓ 2025 Season: ${season2025.drivers.length} drivers, ${season2025.cars.length} cars`);
console.log(`    NOR (2025): OVR ${nor2025.overallRating}, Rarity: ${nor2025.rarity.name}, Confidence: ${nor2025.confidencePct}%`);

console.log('\n=== ALL 7 ML DRAFT INTELLIGENCE TESTS PASSED! ===');
