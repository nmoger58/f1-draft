/**
 * raceEngineer.js
 * Intelligent, Event-Driven Contextual Race Engineer & Strategy Analyst.
 *
 * Implements:
 *   - Dedicated race engineer personality using official team personnel
 *     (e.g., Will Joseph for Norris, Gianpiero Lambiase for Verstappen, Bryan Bozzi for Leclerc)
 *   - Event-driven tactical communications with strict cooldowns & anti-spam suppression
 *   - Priority-based message routing:
 *       1. CRITICAL: Punctures, Red Flags, Safety Car deployments, Brake failures
 *       2. HIGH:     Box recommendations, Rain onset, Slick/Wet crossovers, Active pit windows
 *       3. TACTICAL: DRS overtaking opportunities, Opponent tyre deltas, Defending warnings
 *       4. ROUTINE:  Track clear, tyre warmup, weather clearing
 *   - 3 Radio Modes:
 *       'OFF':       Suppresses routine/tactical delivery; only critical safety alerts visible
 *       'ESSENTIAL': Important tyre, pit, weather, damage, and race control warnings (priority <= 2)
 *       'FULL':      All tactical suggestions, opponent deltas, and live engineer commentary
 *   - Actionable pit instructions:
 *       Explains exact reason and recommended compound with an immediate action payload.
 *       Never forces an automatic pit stop — full player autonomy is strictly preserved.
 */

import { TyreStrategy } from './tyreStrategy.js';
import { resolveDriverFullName } from '../utils/driverResolver.js';
import { formatForSpeech } from '../utils/speechFormatter.js';

export const RadioPriority = {
  CRITICAL: 1,
  HIGH:     2,
  TACTICAL: 3,
  ROUTINE:  4
};

export const RadioMode = {
  OFF:       'off',
  ESSENTIAL: 'essential',
  FULL:      'full'
};

export class RaceEngineer {
  /**
   * @param {object} car – car this engineer is assigned to
   * @param {object} [options]
   * @param {string} [options.mode='full'] – 'full' | 'essential' | 'off'
   */
  constructor(car, options = {}) {
    this.car = car;
    this.driver = car.driver;
    this.code = car.code;
    this.team = car.team;
    this.engineerName = car.driver?.engineerName || `${this.code} Engineer`;
    this.mode = options.mode || RadioMode.FULL;

    // Cooldown trackers (timestamps in sim seconds)
    this.cooldowns = {
      tyreTemp:     -100,
      tyreWear:     -100,
      brakes:       -100,
      fuel:         -100,
      drs:          -100,
      weather:      -100,
      undercut:     -100,
      gap:          -100,
      flag:         -100,
      overtake:     -100,
      defend:       -100,
      damage:       -100,
      homeCrowd:    -100,
      boxCall:      -100
    };

    this.lastWeatherState = 'Dry';
    this.lastFlag = 'green';
    this.wasPunctured = false;
    this.lastRecommendedCompound = null;
    this.lastReportedLap = 0;
  }

  /**
   * Set engineer radio delivery mode.
   * @param {string} mode – 'off' | 'essential' | 'full'
   */
  setMode(mode) {
    if (Object.values(RadioMode).includes(mode)) {
      this.mode = mode;
    }
  }

  /**
   * Evaluate simulation state and return array of new contextual radio messages.
   *
   * @param {object} stateContext – {
   *   simTime, flag, weather, trackWetness, carAhead, carBehind,
   *   strategy, raceControl, totalLaps, isSelected
   * }
   * @returns {object[]} array of radio events
   */
  evaluate(stateContext) {
    const {
      simTime,
      flag,
      weather,
      trackWetness = 0,
      carAhead,
      carBehind,
      strategy,
      totalLaps = 5,
      isSelected = false
    } = stateContext;

    const car = this.car;
    const msgs = [];
    const tyre = car.tyreModel;
    const isPlayer = isSelected;

    // ── 1. Critical Race Control Flags & Safety Procedures (Priority 1) ────────
    if (flag !== this.lastFlag) {
      this.lastFlag = flag;
      if (flag === 'vsc') {
        msgs.push(this._createMsg({
          simTime,
          category: 'control',
          priority: RadioPriority.CRITICAL,
          severity: 'alert',
          msg: `VSC DEPLOYED. Reduce speed, maintain positive delta. No overtaking permitted.`
        }));
      } else if (flag === 'safetycar' || flag === 'safety_car') {
        msgs.push(this._createMsg({
          simTime,
          category: 'control',
          priority: RadioPriority.CRITICAL,
          severity: 'alert',
          msg: `SAFETY CAR DEPLOYED! Reduce speed, form queue behind SC. Cheap pit stop window open (~12s loss saving).`,
          action: isPlayer ? {
            type: 'box',
            label: 'BOX UNDER SC [B]',
            compound: this._recommendPitCompound(weather, tyre, car, totalLaps),
            reason: 'Cheap pit stop under Safety Car'
          } : null
        }));
      } else if (flag === 'red') {
        msgs.push(this._createMsg({
          simTime,
          category: 'control',
          priority: RadioPriority.CRITICAL,
          severity: 'alert',
          msg: `RED FLAG! Session suspended. Drive slowly and return to the pit lane immediately.`
        }));
      } else if (flag === 'green') {
        msgs.push(this._createMsg({
          simTime,
          category: 'control',
          priority: RadioPriority.ROUTINE,
          severity: 'info',
          msg: `Track is CLEAR. Green flag, race restarted — push now!`
        }));
      }
    }

    // ── 2. Mechanical Damage & Punctures (Priority 1) ─────────────────────────
    if (tyre && tyre.punctured && !this.wasPunctured) {
      this.wasPunctured = true;
      this.cooldowns.damage = simTime;
      const recCompound = this._recommendPitCompound(weather, tyre, car, totalLaps);

      msgs.push(this._createMsg({
        simTime,
        category: 'damage',
        priority: RadioPriority.CRITICAL,
        severity: 'alert',
        msg: `CRITICAL: Puncture detected on ${tyre.compound.toUpperCase()} tyre! Limp mode active. BOX BOX BOX!`,
        action: isPlayer ? {
          type: 'box',
          label: `BOX FOR ${recCompound.toUpperCase()} [B]`,
          compound: recCompound,
          reason: 'Punctured tyre'
        } : null
      }));
    }

    // ── 3. Critical Brake Fade (Priority 1) ──────────────────────────────────
    const brake = car.brakeModel;
    if (brake && brake.isOverheating && (simTime - this.cooldowns.brakes > 32)) {
      this.cooldowns.brakes = simTime;
      msgs.push(this._createMsg({
        simTime,
        category: 'damage',
        priority: RadioPriority.CRITICAL,
        severity: 'alert',
        msg: `Brake temps in the danger zone (${Math.round(brake.temp)}°C). Lift and coast into Turn 1 to manage thermal fade.`
      }));
    }

    // ── 4. Weather Radar & Track Crossovers (Priority 2) ─────────────────────
    if (weather && weather.weatherLabel !== this.lastWeatherState && (simTime - this.cooldowns.weather > 25)) {
      this.lastWeatherState = weather.weatherLabel;
      this.cooldowns.weather = simTime;

      if (weather.isRaining) {
        const isHeavy = weather.rainIntensity > 0.55;
        const targetTyre = isHeavy ? 'wet' : 'intermediate';

        msgs.push(this._createMsg({
          simTime,
          category: 'weather',
          priority: RadioPriority.HIGH,
          severity: 'warning',
          msg: `Rain reported on circuit: ${weather.weatherLabel} (${Math.round(weather.rainIntensity * 100)}% intensity). Track wetness increasing.`,
          action: (isPlayer && !tyre?.isWetCompound) ? {
            type: 'box',
            label: `BOX FOR ${targetTyre.toUpperCase()} [B]`,
            compound: targetTyre,
            reason: 'Incoming wet weather'
          } : null
        }));
      } else {
        msgs.push(this._createMsg({
          simTime,
          category: 'weather',
          priority: RadioPriority.ROUTINE,
          severity: 'info',
          msg: `Rain has stopped. Track drying phase begins; prepare for slick crossover.`
        }));
      }
    }

    // Intermediate on dry track thermal shredding warning
    if (tyre && tyre.isWetCompound && trackWetness < 0.12 && (simTime - this.cooldowns.weather > 30)) {
      this.cooldowns.weather = simTime;
      const dryRec = this._recommendPitCompound(weather, tyre, car, totalLaps);

      msgs.push(this._createMsg({
        simTime,
        category: 'weather',
        priority: RadioPriority.HIGH,
        severity: 'warning',
        msg: `Track is drying rapidly! ${tyre.compound.toUpperCase()} tyres overheating (${Math.round(tyre.temp)}°C). Slick crossover is open.`,
        action: isPlayer ? {
          type: 'box',
          label: `BOX FOR ${dryRec.toUpperCase()} [B]`,
          compound: dryRec,
          reason: 'Track dry; change from wet compound'
        } : null
      }));
    }

    // ── 5. Tyre Degradation & Strategic Pit Box Calls (Priority 2) ───────────
    if (tyre && !tyre.punctured && tyre.wear > 0.72 && (simTime - this.cooldowns.boxCall > 35)) {
      this.cooldowns.boxCall = simTime;
      this.cooldowns.tyreWear = simTime; // suppress redundant wear alert when box call is issued
      const recCompound = this._recommendPitCompound(weather, tyre, car, totalLaps);

      msgs.push(this._createMsg({
        simTime,
        category: 'pit',
        priority: RadioPriority.HIGH,
        severity: 'alert',
        msg: `Tyres on the degradation cliff (${tyre.wearPct}% wear). Grip dropping rapidly. Box this lap for fresh ${recCompound.toUpperCase()} tyres!`,
        action: isPlayer ? {
          type: 'box',
          label: `BOX FOR ${recCompound.toUpperCase()} [B]`,
          compound: recCompound,
          reason: `High tyre degradation (${tyre.wearPct}% wear)`
        } : null
      }));
    } else if (tyre && !tyre.punctured && tyre.wear > 0.50 && (simTime - this.cooldowns.tyreWear > 40)) {
      this.cooldowns.tyreWear = simTime;
      msgs.push(this._createMsg({
        simTime,
        category: 'tyre',
        priority: RadioPriority.TACTICAL,
        severity: 'warning',
        msg: `Tyre degradation is increasing (${tyre.wearPct}% wear). Protect the rears on traction out of slow corners.`
      }));
    }

    // ── 6. Tyre Temperatures & Thermal Management (Priority 4) ───────────────
    if (tyre && !tyre.punctured && (simTime - this.cooldowns.tyreTemp > 30)) {
      if (tyre.isOverheating) {
        this.cooldowns.tyreTemp = simTime;
        msgs.push(this._createMsg({
          simTime,
          category: 'tyre',
          priority: RadioPriority.TACTICAL,
          severity: 'warning',
          msg: `Front tyres are overheating (${Math.round(tyre.temp)}°C). Back off through high-speed turns to prevent thermal blistering.`
        }));
      } else if (tyre.isCold && car.lap >= 1) {
        this.cooldowns.tyreTemp = simTime;
        msgs.push(this._createMsg({
          simTime,
          category: 'tyre',
          priority: RadioPriority.ROUTINE,
          severity: 'info',
          msg: `Tyres are cold (${Math.round(tyre.temp)}°C). We need more heat in the fronts before pushing to the limit.`
        }));
      }
    }

    // ── 7. Tactical Overtaking Opportunities (Priority 3) ───────────────────
    if (carAhead && (simTime - this.cooldowns.overtake > 22)) {
      const gapS = car.drsGapS ?? 2.0;
      const aheadDriverName = resolveDriverFullName(carAhead, carAhead.code);

      // DRS Zone & Close Gap
      if (car.drsEligible && gapS <= 1.0) {
        this.cooldowns.overtake = simTime;
        msgs.push(this._createMsg({
          simTime,
          category: 'overtake',
          priority: RadioPriority.TACTICAL,
          severity: 'info',
          msg: `Within overtaking range! Gap to ${aheadDriverName} is ${gapS.toFixed(2)}s. DRS is available — attack at the next corner!`
        }));
      } else if (gapS <= 1.5 && carAhead.tyreModel && tyre) {
        // Tyre Delta Advantage
        const wearDelta = Math.round((carAhead.tyreModel.wear - tyre.wear) * 100);
        if (wearDelta >= 20) {
          this.cooldowns.overtake = simTime;
          msgs.push(this._createMsg({
            simTime,
            category: 'overtake',
            priority: RadioPriority.TACTICAL,
            severity: 'info',
            msg: `${aheadDriverName} ahead has older tyres (+${wearDelta}% higher degradation). Opportunity to attack.`
          }));
        }
      }
    }

    // ── 8. Tactical Defending & Pressure Alerts (Priority 3) ─────────────────
    if (carBehind && (simTime - this.cooldowns.defend > 25)) {
      const behindGapS = (carBehind.v > 0)
        ? ((((car.d - carBehind.d) % 5000) + 5000) % 5000) / carBehind.v
        : 99;
      const behindDriverName = resolveDriverFullName(carBehind, carBehind.code);

      if (behindGapS <= 0.8) {
        this.cooldowns.defend = simTime;
        const rivalFresher = (carBehind.tyreModel?.wear < (tyre?.wear || 0) - 0.20);

        if (rivalFresher) {
          msgs.push(this._createMsg({
            simTime,
            category: 'defend',
            priority: RadioPriority.TACTICAL,
            severity: 'warning',
            msg: `${behindDriverName} is closing rapidly on fresher tyres. Defend the inside line at the next braking zone.`
          }));
        } else {
          msgs.push(this._createMsg({
            simTime,
            category: 'defend',
            priority: RadioPriority.TACTICAL,
            severity: 'info',
            msg: `Car behind is closing (${behindDriverName} within ${behindGapS.toFixed(1)}s). Hold your racing line.`
          }));
        }
      }
    }

    // ── 9. Fuel & Hybrid Engine Modes (Priority 3) ───────────────────────────
    const fuel = car.fuelModel;
    if (fuel && fuel.isLow && (simTime - this.cooldowns.fuel > 45)) {
      this.cooldowns.fuel = simTime;
      msgs.push(this._createMsg({
        simTime,
        category: 'damage',
        priority: RadioPriority.TACTICAL,
        severity: 'alert',
        msg: `Low fuel warning: ${fuel.lapsRemaining} laps of fuel remaining. Switch to Engine Mode LEAN and lift early.`
      }));
    }

    // ── 10. Home Race & Previous Winner Confidence Commentary (Priority 4) ──
    if (car.psychology && isPlayer && (simTime - this.cooldowns.homeCrowd > 80)) {
      this.cooldowns.homeCrowd = simTime;
      if (car.psychology.isHome && car.psychology.isPreviousWinner) {
        msgs.push(this._createMsg({
          simTime,
          category: 'strategy',
          priority: RadioPriority.ROUTINE,
          severity: 'info',
          msg: `Home crowd is cheering your every lap! You own this track — keep hitting those apexes.`
        }));
      } else if (car.psychology.isHome) {
        msgs.push(this._createMsg({
          simTime,
          category: 'strategy',
          priority: RadioPriority.ROUTINE,
          severity: 'info',
          msg: `Pace is strong. Look at that home grandstand cheering — keep the momentum going!`
        }));
      } else if (car.psychology.isPreviousWinner) {
        msgs.push(this._createMsg({
          simTime,
          category: 'strategy',
          priority: RadioPriority.ROUTINE,
          severity: 'info',
          msg: `Consistency is superb. Remember your previous win here — manage the gap and execute.`
        }));
      }
    }

    // ── Apply Radio Mode Filtering ───────────────────────────────────────────
    // 'off':       priority === 1 (Critical only)
    // 'essential': priority <= 2 (Critical + High)
    // 'full':      all priorities (<= 4)
    return msgs.filter(m => {
      if (this.mode === RadioMode.OFF) return m.priority <= RadioPriority.CRITICAL;
      if (this.mode === RadioMode.ESSENTIAL) return m.priority <= RadioPriority.HIGH;
      return true; // FULL
    });
  }

  // ── Helper: Format Radio Message ──────────────────────────────────────────

  _createMsg({ simTime, category, priority, severity, msg, action = null }) {
    const spokenText = formatForSpeech(msg, {
      type: 'radio',
      driver: this.code,
      category
    });

    return {
      id: `${this.code}_${Math.round(simTime * 1000)}_${Math.random().toString(36).substr(2, 4)}`,
      time: simTime,
      sender: `${this.engineerName} (${this.code})`,
      engineerName: this.engineerName,
      driverCode: this.code,
      team: this.team,
      category,
      priority,
      severity,
      msg,
      spokenText,
      action
    };
  }

  /**
   * Determine best tyre compound for next stint based on weather and FIA rules.
   */
  _recommendPitCompound(weather, tyre, car, totalLaps) {
    if (weather && weather.isRaining) {
      return weather.rainIntensity > 0.55 ? 'wet' : 'intermediate';
    }

    const lapsRemaining = Math.max(1, totalLaps - (car?.lap || 1));
    const used = car?.compoundsUsed || new Set();

    // Comply with two dry compound rule
    if (lapsRemaining <= 8) {
      if (!used.has('soft') && tyre?.compound !== 'soft') return 'soft';
      if (!used.has('medium') && tyre?.compound !== 'medium') return 'medium';
      return 'soft';
    } else {
      if (!used.has('hard') && tyre?.compound !== 'hard') return 'hard';
      if (!used.has('medium') && tyre?.compound !== 'medium') return 'medium';
      return 'hard';
    }
  }
}
