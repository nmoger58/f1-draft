/**
 * test_physics_and_strategy_upgrades.mjs
 * Authoritative Validation Suite for Stage 2 (Priority 3) Racing Physics & Strategy:
 *
 * 1. Dirty Air Aerodynamics (AeroModel & PhysicsEngine):
 *    - Cornering in turbulent wake suffers up to 28% downforce reduction and 18% front-end grip loss
 *    - Lateral displacement out of wake cone restores clean air downforce
 *    - Straightaway wake acts as slipstream tow reducing drag by up to 26%
 *    - DRS synergy with slipstream
 *
 * 2. Dual-Axle & 4-Corner Tyre Thermal Model (TyreModel):
 *    - Surface vs carcass temperature tracking for front and rear axles
 *    - Front surface heats up from steering scrub, cornering slip, and dirty air
 *    - Rear surface heats up from traction acceleration and wheelspin
 *    - Operating windows (Soft 90-108°C, Med 95-112°C, Hard 100-118°C, Inter 65-85°C, Wet 55-75°C)
 *    - Cold glazing grip loss below window; overheating blistering & wear acceleration above window
 *
 * 3. Carbon Brake Thermal Model (BrakeModel):
 *    - Front vs rear disc temperature with 58/42 brake bias split
 *    - Kinetic energy conversion heating during heavy braking
 *    - Airflow cooling through ducts on straights
 *    - Brake fade above 950°C reducing deceleration capability
 *
 * 4. Lift-and-Coast Fuel Management (FuelModel & Physics):
 *    - Lap consumption target and fuelDeltaKg tracking
 *    - Throttle lift before braking zones drops consumption to idle flow
 *    - Saves 15-25% fuel per lap
 *
 * 5. Authoritative VSC Delta Timing & 5s Penalty Enforcement (RaceControl):
 *    - Reference pace delta (t_actual - t_reference)
 *    - Compliant pace maintains positive delta
 *    - Speeding (< -1.0s for > 3.0s) triggers automated 5-second time penalty
 */

import assert from 'node:assert/strict';
import { AeroModel } from '../src/simulation/aeroModel.js';
import { TyreModel, TYRE_COMPOUNDS } from '../src/simulation/tyreModel.js';
import { BrakeModel } from '../src/simulation/brakeModel.js';
import { FuelModel, EngineModes } from '../src/simulation/fuelModel.js';
import { RaceControl, FlagStates, PenaltyOutcome } from '../src/simulation/raceControl.js';

console.log('🏎️ ══════════════════════════════════════════════════════════════════════');
console.log('   STAGE 2: ADVANCED RACING PHYSICS & STRATEGY UPGRADE TEST SUITE        ');
console.log('══════════════════════════════════════════════════════════════════════════\n');

async function run() {
  // ── TEST 1: Dirty Air Downforce Loss vs Slipstream Drag Reduction ──────────
  console.log('--- TEST 1: Dirty Air Wake vs Slipstream Tow (AeroModel) ---');
  {
    const leadCar = { d: 500, lat: 0, v: 60 };
    const chasingCar = { d: 480, lat: 0, v: 60 }; // 20m behind directly in wake

    // A. In Corners: Turbulent Wake causes Downforce Loss & Front Grip Loss
    const cornerWake = AeroModel.evaluateWake(chasingCar, leadCar, 20, 0, true, false);
    assert.equal(cornerWake.inDirtyAir, true, 'Car 20m behind in corner is flagged in dirty air');
    assert.equal(cornerWake.inSlipstream, false, 'Corner wake is not slipstream');
    assert.ok(cornerWake.downforceMult < 0.90, `Downforce reduced by wake: ${cornerWake.downforceMult}`);
    assert.ok(cornerWake.frontGripLoss > 0.05, `Front-end grip loss present: ${cornerWake.frontGripLoss}`);

    // Moving off-line by 4.5m escapes dirty air
    const offLineWake = AeroModel.evaluateWake(chasingCar, leadCar, 20, 4.5, true, false);
    assert.equal(offLineWake.inDirtyAir, false, 'Moving 4.5m off-line escapes the turbulent wake cone');
    assert.equal(offLineWake.downforceMult, 1.0, 'Full downforce restored in clean air');

    // B. On Straights: Low pressure bubble gives Slipstream Tow (Drag Reduction)
    const straightWake = AeroModel.evaluateWake(chasingCar, leadCar, 20, 0, false, false);
    assert.equal(straightWake.inDirtyAir, false, 'Straightaway wake is not dirty air');
    assert.equal(straightWake.inSlipstream, true, 'Straightaway wake gives slipstream');
    assert.ok(straightWake.dragMult < 0.85, `Drag reduced by slipstream tow: ${straightWake.dragMult}`);

    // Combined Slipstream + DRS
    const drsTowWake = AeroModel.evaluateWake(chasingCar, leadCar, 20, 0, false, true);
    assert.ok(drsTowWake.dragMult < straightWake.dragMult, 'DRS combined with slipstream provides additional drag reduction');
    assert.ok(drsTowWake.dragMult >= 0.54, 'Drag reduction respects physical floor to prevent unrealistic speeds');

    console.log('  ✅ Verified: Downforce & front grip loss in corners; Slipstream tow & DRS synergy on straights.');
  }

  // ── TEST 2: Dual-Axle & 4-Corner Tyre Thermal Model ────────────────────────
  console.log('\n--- TEST 2: Dual-Axle & 4-Corner Tyre Thermal Model (TyreModel) ---');
  {
    const tyre = new TyreModel('soft', 1);

    // Initial state check
    assert.ok(tyre.axles.front.surf > 70, 'Front axle initialised with surface temperature');
    assert.ok(tyre.axles.rear.surf > 70, 'Rear axle initialised with surface temperature');
    assert.ok(tyre.corners.FL.surf > 70, 'Corner FL surface temperature present');
    assert.ok(tyre.corners.RR.surf > 70, 'Corner RR surface temperature present');

    // Simulate aggressive cornering in dirty air: front surface heats up faster
    const startFrontSurf = tyre.axles.front.surf;
    const startRearSurf = tyre.axles.rear.surf;

    for (let i = 0; i < 20; i++) {
      tyre.update(0.1, 55, 18.0, 2.0, 0, 30, 0.75, {
        inDirtyAir: true,
        isWheelspinning: false,
        brake: 0.1
      });
    }

    const heatedFrontSurf = tyre.axles.front.surf;
    const heatedRearSurf = tyre.axles.rear.surf;
    assert.ok(heatedFrontSurf > startFrontSurf, 'Front surface temperature increased under cornering in dirty air');
    assert.ok(heatedFrontSurf > heatedRearSurf, 'Front tyres heated more than rears due to cornering scrub and dirty air');

    // Simulate wheelspin traction: rear surface heats up rapidly
    const preWheelspinRear = tyre.axles.rear.surf;
    for (let i = 0; i < 20; i++) {
      tyre.update(0.1, 40, 2.0, 15.0, 0, 30, 0.75, {
        inDirtyAir: false,
        isWheelspinning: true,
        brake: 0
      });
    }
    assert.ok(tyre.axles.rear.surf > preWheelspinRear + 5, 'Rear tyres heated up rapidly from wheelspin traction');

    // Conduction check: carcass temperature lagged surface but absorbed heat
    assert.ok(tyre.axles.front.carcass > startFrontSurf, 'Front carcass absorbed heat from surface via conduction');

    // Operating window validation for all compounds
    for (const [compKey, spec] of Object.entries(TYRE_COMPOUNDS)) {
      const testTyre = new TyreModel(compKey, 1);
      // Set to optimal peak temperature
      testTyre.temp = spec.optTempPeak;
      testTyre.surfaceTemp = spec.optTempPeak;
      const peakGrip = testTyre.getGrip(0).thermalFactor;

      // Set to cold temperature (below window)
      testTyre.temp = spec.optTempMin - 20;
      testTyre.surfaceTemp = spec.optTempMin - 20;
      const coldGrip = testTyre.getGrip(0).thermalFactor;
      assert.ok(coldGrip < peakGrip, `Cold ${compKey} tyre has lower grip (${coldGrip.toFixed(2)} vs ${peakGrip.toFixed(2)})`);

      // Set to overheating temperature (above window)
      testTyre.temp = spec.optTempMax + 20;
      testTyre.surfaceTemp = spec.optTempMax + 20;
      const hotGrip = testTyre.getGrip(0).thermalFactor;
      assert.ok(hotGrip < peakGrip, `Overheated ${compKey} tyre has lower grip (${hotGrip.toFixed(2)} vs ${peakGrip.toFixed(2)})`);
    }

    console.log('  ✅ Verified: Dual-axle surface vs carcass temperatures, scrub/wheelspin heating, and compound windows.');
  }

  // ── TEST 3: Carbon-Carbon Brake Thermal Model & Fade ───────────────────────
  console.log('\n--- TEST 3: Carbon Brake Thermal Model & Fade (BrakeModel) ---');
  {
    const brakes = new BrakeModel(25);
    assert.equal(brakes.frontTemp, 340, 'Initial front disc temperature 340°C');
    assert.equal(brakes.rearTemp, 300, 'Initial rear disc temperature 300°C');

    // Heavy braking from high speed (e.g. Monza Turn 1)
    for (let i = 0; i < 8; i++) {
      brakes.update(0.1, 1.0, 70); // 100% brake application at 70 m/s (~250 km/h)
    }

    assert.ok(brakes.frontTemp > 700, `Front discs heated to ${brakes.frontTemp}°C under heavy braking`);
    assert.ok(brakes.frontTemp > brakes.rearTemp, 'Front discs run hotter than rears due to front brake bias');

    // Continue braking to induce brake fade (> 950°C)
    for (let i = 0; i < 20; i++) {
      brakes.update(0.1, 1.0, 60);
    }

    assert.ok(brakes.frontTemp > 950, `Front brake temperature exceeds 950°C (${brakes.frontTemp}°C)`);
    const fadeState = brakes.update(0.1, 1.0, 50);
    assert.equal(fadeState.isOverheating, true, 'Brake overheating flag triggered');
    assert.ok(fadeState.efficiency < 0.90, `Brake fade reduces stopping efficiency (${fadeState.efficiency})`);

    // High speed straightaway cooling through ducts
    const preCoolTemp = brakes.frontTemp;
    for (let i = 0; i < 40; i++) {
      brakes.update(0.1, 0.0, 80); // 0% brake at 80 m/s (~288 km/h)
    }
    assert.ok(brakes.frontTemp < preCoolTemp - 50, 'Airflow through ducts cooled discs on the straight');

    console.log('  ✅ Verified: Brake bias load split, kinetic friction heating, duct cooling, and thermal fade.');
  }

  // ── TEST 4: Lift-and-Coast Fuel Management ─────────────────────────────────
  console.log('\n--- TEST 4: Lift-and-Coast Fuel Management (FuelModel) ---');
  {
    const fuel = new FuelModel(5, 5000); // 5-lap race
    const targetBurnPerLap = fuel.targetFuelPerLap;

    // Normal full-throttle burn:
    const normalBurnState = fuel.update(1.0, 1.0, 0, 60, false);
    const normalBurnRate = fuel.startingFuelKg - fuel.fuelRemainingKg;

    // Reset fuel
    fuel.fuelRemainingKg = fuel.startingFuelKg;

    // When lifting and coasting:
    const liftBurnState = fuel.update(1.0, 1.0, 0, 60, true); // isLifting = true
    const liftBurnRate = fuel.startingFuelKg - fuel.fuelRemainingKg;

    assert.ok(liftBurnRate < normalBurnRate * 0.20, `Lift and coast reduced fuel burn rate by >80% (${liftBurnRate.toFixed(4)} vs ${normalBurnRate.toFixed(4)} kg/s)`);

    // Trigger shouldLiftAndCoast when fuel delta is negative
    fuel.fuelRemainingKg = fuel.startingFuelKg - (targetBurnPerLap * 2.5); // Burned 2.5 laps worth of fuel on lap 2
    const shouldLift = fuel.shouldLiftAndCoast(50, 2, 55); // Approaching braking zone (50m out)
    assert.equal(shouldLift, true, 'AI initiates lift-and-coast when running negative on fuel delta');
    assert.ok(fuel.fuelDeltaKg < 0, `Fuel delta is negative: ${fuel.fuelDeltaKg} kg`);

    console.log('  ✅ Verified: Lift-and-coast fuel saving mechanics, delta tracking, and idle flow reduction.');
  }

  // ── TEST 5: Authoritative VSC Delta & Automated 5s Penalty ─────────────────
  console.log('\n--- TEST 5: Authoritative VSC Delta Timing & 5s Penalty (RaceControl) ---');
  {
    const mockTrack = { circuit: { lengthM: 5000 }, pitLane: { entryD: 4800 }, pts: [[0,0],[100,0]], N: 2 };
    const rc = new RaceControl(mockTrack);

    const carCompliant = { code: 'VER', d: 1000, penalties: 0 };
    const carSpeeding  = { code: 'HAM', d: 1000, penalties: 0 };
    const cars = [carCompliant, carSpeeding];

    // Deploy VSC for 20 seconds
    const deployed = rc.deployVSC(20);
    assert.equal(deployed, true, 'VSC deployed');
    assert.equal(rc.state, FlagStates.VSC, 'Flag state is VSC');

    // Simulate 6.5 seconds of VSC running (allowing delta to accumulate and persist past 3s)
    const events = [];
    for (let tick = 1; tick <= 65; tick++) {
      const dt = 0.1;
      const simTime = 100.0 + tick * dt;

      // Compliant car drives at 40 m/s (below 44.4 m/s limit)
      carCompliant.d += 40.0 * dt;

      // Speeding car drives at 65 m/s (violating VSC pace!)
      carSpeeding.d += 65.0 * dt;

      rc.update(dt, simTime, cars, null, null, null);
    }

    // Check VSC deltas
    assert.ok(carCompliant.vscDelta > 0, `Compliant car maintained positive VSC delta (+${carCompliant.vscDelta}s)`);
    assert.ok(carSpeeding.vscDelta < -1.0, `Speeding car has negative VSC delta (${carSpeeding.vscDelta}s)`);

    // Speeding car persistently exceeded delta for >3s -> MUST receive 5-second penalty
    assert.equal(carSpeeding.penalties, 5, 'Speeding car was assessed an authoritative 5-second time penalty');
    assert.equal(carCompliant.penalties, 0, 'Compliant car has 0 penalties');

    // Verify investigation record in RaceControl
    const inv = rc.investigations.find(i => i.driverCode === 'HAM');
    assert.ok(inv, 'Investigation recorded for HAM');
    assert.equal(inv.decision, PenaltyOutcome.TIME_PENALTY_5S, 'Ruling was TIME_PENALTY_5S');

    console.log('  ✅ Verified: Authoritative VSC delta timing and automated 5s penalty enforcement.');
  }

  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log('🎉 ALL STAGE 2 RACING PHYSICS & STRATEGY TESTS PASSED (100% GREEN)   ');
  console.log('══════════════════════════════════════════════════════════════════════════\n');
  process.exit(0);
}

run().catch(err => {
  console.error('❌ STAGE 2 TEST SUITE FAILED:', err);
  process.exit(1);
});
