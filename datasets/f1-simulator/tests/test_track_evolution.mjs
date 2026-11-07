/**
 * test_track_evolution.mjs
 * Automated test suite for Dynamic Track Evolution, Rubber Buildup, and Drying Line.
 */

import { strict as assert } from 'assert';
import { TrackConditionModel } from '../src/simulation/trackConditionModel.js';

console.log('🧪 Starting Track Evolution Test Suite...\n');

// 1. Basic Initialisation & Sector Spatial Segmentation
{
  console.log('Test 1: Sector Segmentation and Geometry');
  const model = new TrackConditionModel(4800, 24);
  assert.equal(model.numSegments, 24, 'Must have 24 segments');
  assert.equal(model.segmentLengthM, 200, 'Each segment must be 200m long for 4800m track');
  assert.equal(model.getSegmentIndex(0), 0);
  assert.equal(model.getSegmentIndex(199), 0);
  assert.equal(model.getSegmentIndex(200), 1);
  assert.equal(model.getSegmentIndex(4799), 23);
  assert.equal(model.getSegmentIndex(4801), 0, 'Wraps correctly around track loop');
  console.log('  ✓ 24 sectors correctly segmented and circular distance wrap verified');
}

// 2. Monaco Tunnel Shelter Protection
{
  console.log('Test 2: Monaco Tunnel Rain Shelter');
  const monacoModel = new TrackConditionModel(3337, 24, 'monaco');
  
  // Find sheltered segments
  const sheltered = monacoModel.segments.filter(s => s.isSheltered);
  assert(sheltered.length > 0, 'Monaco must have sheltered tunnel sectors');
  
  // Simulate rain
  monacoModel.update(10.0, 0.8, []);
  
  for (const s of sheltered) {
    assert.equal(s.racingLineWetness, 0, 'Sheltered tunnel segment must receive 0 rain');
    assert.equal(s.offLineWetness, 0, 'Sheltered tunnel segment off-line must receive 0 rain');
    assert.equal(s.waterDepthMm, 0, 'Sheltered tunnel segment must have 0 water depth');
  }

  const unsheltered = monacoModel.segments.filter(s => !s.isSheltered);
  for (const u of unsheltered) {
    assert(u.racingLineWetness > 0, 'Unsheltered segment must accumulate rain');
  }
  console.log(`  ✓ Monaco tunnel (${sheltered.length} sectors) confirmed completely sheltered from rain`);
}

// 3. Rubber Buildup and Dry Grip Enhancement (+4.2% Max)
{
  console.log('Test 3: Rubber Buildup on Racing Line in Dry Conditions');
  const model = new TrackConditionModel(5000, 24);
  assert(Math.abs(model.averageRubberLevel - 0.20) < 0.001, 'Starts with weekend baseline rubber (0.20)');

  const mockCars = [
    { d: 100, lat: 0.2, v: 65, latAcc: 12, tyreModel: { compound: 'soft' } },
    { d: 300, lat: -0.1, v: 70, latAcc: 14, tyreModel: { compound: 'medium' } },
    { d: 500, lat: 0.0, v: 60, latAcc: 10, tyreModel: { compound: 'hard' } },
  ];

  // Run dry laps (no rain)
  for (let t = 0; t < 200; t++) {
    model.update(1.0, 0.0, mockCars);
  }

  assert(model.averageRubberLevel > 0, 'Rubber must accumulate with car passage');
  
  // Check grip multiplier on rubbered racing line
  const seg0 = model.segments[0];
  seg0.rubberLevel = 1.0; // max rubber
  
  const gripOnLine = model.getLocalGripMultiplier(100, 0.0, 'soft');
  const gripOffLine = model.getLocalGripMultiplier(100, 4.0, 'soft');

  assert(gripOnLine > 1.035, `On-line rubbered grip must exceed 1.035 (got ${gripOnLine})`);
  assert(gripOnLine > gripOffLine, 'On-line grip must be greater than off-line rubber grip');
  console.log(`  ✓ Max rubber dry grip on racing line: ${(gripOnLine * 100).toFixed(2)}% vs off-line: ${(gripOffLine * 100).toFixed(2)}%`);
}

// 4. Rain Washing Away Rubber
{
  console.log('Test 4: Rain Washing Away Rubber');
  const model = new TrackConditionModel(5000, 24);
  model.segments.forEach(s => s.rubberLevel = 0.8);
  const initialRubber = model.averageRubberLevel;

  // Torrential rain with no cars running
  for (let t = 0; t < 50; t++) {
    model.update(1.0, 1.0, []);
  }

  assert(model.averageRubberLevel < initialRubber, 'Rain must wash away asphalt rubber');
  console.log(`  ✓ Rubber degraded by rainfall from ${(initialRubber * 100).toFixed(1)}% to ${(model.averageRubberLevel * 100).toFixed(1)}%`);
}

// 5. Water Displacement & Drying Racing Line Formation
{
  console.log('Test 5: Water Displacement & Drying Line Formation');
  const model = new TrackConditionModel(5000, 24);
  
  // Damp track after rain shower ceases
  model.segments.forEach(s => {
    s.racingLineWetness = 0.32;
    s.offLineWetness = 0.35;
    s.wetness = 0.33;
    s.waterDepthMm = 1.2;
  });

  // Cars running along racing line (|lat| < 1.0) with zero new rain
  const fastCars = [];
  for (let i = 0; i < 15; i++) {
    fastCars.push({
      d: i * 300,
      lat: 0.1,
      v: 60, // 216 km/h
      latAcc: 8,
      tyreModel: { compound: 'intermediate' }
    });
  }

  for (let step = 0; step < 160; step++) {
    for (const car of fastCars) {
      car.d = (car.d + car.v * 1.0) % 5000;
    }
    model.update(1.0, 0.0, fastCars);
  }

  const dryingLineState = model.getDryingLineState();
  assert(dryingLineState.formed, 'A distinct drying line must form from car displacement');
  assert(dryingLineState.avgLineWetness < dryingLineState.avgOffLineWetness, 'Racing line must be significantly drier than off-line');
  console.log(`  ✓ Drying line confirmed formed: On-line ${(dryingLineState.avgLineWetness * 100).toFixed(1)}% wet vs Off-line ${(dryingLineState.avgOffLineWetness * 100).toFixed(1)}% wet`);
}

// 6. Compound Grip Crossover Under Variable Conditions
{
  console.log('Test 6: Compound Grip Crossover Curves');
  const model = new TrackConditionModel(5000, 24);
  
  // Dry condition
  const slickDryGrip = model.getLocalGripMultiplier(100, 0, 'soft');
  const interDryGrip = model.getLocalGripMultiplier(100, 0, 'intermediate');
  const wetDryGrip = model.getLocalGripMultiplier(100, 0, 'wet');
  assert(slickDryGrip > interDryGrip, 'Slicks must beat intermediates on dry track');
  assert(interDryGrip > wetDryGrip, 'Intermediates must beat full wets on dry track');

  // Wet condition (wetness = 0.60)
  model.segments[0].racingLineWetness = 0.60;
  model.segments[0].offLineWetness = 0.70;
  model.segments[0].standingWater = true;
  
  const slickWetGrip = model.getLocalGripMultiplier(10, 0, 'soft');
  const interWetGrip = model.getLocalGripMultiplier(10, 0, 'intermediate');
  const wetWetGrip = model.getLocalGripMultiplier(10, 0, 'wet');
  assert(wetWetGrip > interWetGrip, 'Full wets must beat intermediates in heavy wet/standing water');
  assert(interWetGrip > slickWetGrip, 'Intermediates must beat slicks in wet');
  assert(slickWetGrip < 0.40, 'Slicks must suffer severe loss of traction in heavy wet');
  console.log(`  ✓ Grip progression verified: Dry [Soft: ${slickDryGrip.toFixed(2)}, Inter: ${interDryGrip.toFixed(2)}, Wet: ${wetDryGrip.toFixed(2)}] vs Wet [Soft: ${slickWetGrip.toFixed(2)}, Inter: ${interWetGrip.toFixed(2)}, Wet: ${wetWetGrip.toFixed(2)}]`);
}

console.log('\n✅ All Track Evolution Tests Passed Successfully!\n');
