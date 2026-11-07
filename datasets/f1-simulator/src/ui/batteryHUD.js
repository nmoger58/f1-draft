/**
 * batteryHUD.js
 * Interactive Vertical Battery Power Bar & Hybrid ERS HUD Controller.
 *
 * Implements:
 *   - Compact, vertical energy fill bar that fills from bottom to top (0% to 100%)
 *   - Current battery percentage and active charge state display
 *   - Dynamic Mode Toggle: CHARGE vs ATTACK with distinct visual identities
 *   - 3-Level Power Selector (LVL 1, LVL 2, LVL 3)
 *   - Smooth energy animation matching physics updates without lag
 *   - Attacking vs Defending eligibility context feedback
 *   - Live tyre scrubbing and cornering stress notice
 *   - Mobile touch-friendly sync with sticky race dock
 */

import { BatteryMode, BatteryState, BatteryPowerLevel } from '../simulation/batteryController.js';

export class BatteryHUD {
  constructor(options = {}) {
    this.onToggleMode = options.onToggleMode || (() => {});
    this.onSelectLevel = options.onSelectLevel || (() => {});

    // Cache DOM nodes
    this.el = {
      // Desktop elements
      widget: document.getElementById('batteryWidget'),
      fill: document.getElementById('batteryFill'),
      percentTxt: document.getElementById('batteryPercentTxt'),
      statePill: document.getElementById('batteryStatePill'),
      btnMode: document.getElementById('btnBatteryMode'),
      modeIcon: document.getElementById('batteryModeIcon'),
      modeLabel: document.getElementById('batteryModeLabel'),
      lvl1Btn: document.getElementById('btnBattLvl1'),
      lvl2Btn: document.getElementById('btnBattLvl2'),
      lvl3Btn: document.getElementById('btnBattLvl3'),
      contextTxt: document.getElementById('batteryContextTxt'),
      reasonTxt: document.getElementById('batteryReasonTxt'),
      stressRow: document.getElementById('batteryStressRow'),
      stressVal: document.getElementById('batteryStressVal'),

      // Mobile elements
      mBtn: document.getElementById('mBtnBattery'),
      mIcon: document.getElementById('mBatteryIcon'),
      mLabel: document.getElementById('mBatteryLabel'),
      mSocPill: document.getElementById('mBatterySocPill'),
      mStatus: document.getElementById('mBatteryStatus')
    };

    this._bindEvents();
  }

  _bindEvents() {
    // Direct click on battery widget / bar toggles mode
    this.el.widget?.addEventListener('click', (e) => {
      // Avoid re-triggering if the click came from inside btnMode itself
      if (e.target.closest('#btnBatteryMode')) return;
      this.onToggleMode();
    });

    // Mode toggle button click
    this.el.btnMode?.addEventListener('click', () => {
      this.onToggleMode();
    });

    // Mobile dock button click
    this.el.mBtn?.addEventListener('click', () => {
      this.onToggleMode();
    });

    // Power level buttons
    this.el.lvl1Btn?.addEventListener('click', () => this.onSelectLevel(BatteryPowerLevel.LEVEL_1));
    this.el.lvl2Btn?.addEventListener('click', () => this.onSelectLevel(BatteryPowerLevel.LEVEL_2));
    this.el.lvl3Btn?.addEventListener('click', () => this.onSelectLevel(BatteryPowerLevel.LEVEL_3));
  }

  /**
   * Update HUD from live telemetry.
   *
   * @param {object} tel – telemetry object with battery fields
   */
  update(tel) {
    if (!tel) return;

    const soc = typeof tel.batterySoc === 'number' ? tel.batterySoc : 85;
    const mode = tel.batteryMode || BatteryMode.CHARGE;
    const state = tel.batteryState || BatteryState.CHARGING;
    const level = tel.batteryPowerLevel || 2;
    const elig = tel.batteryEligibility || { eligible: false, context: 'CHARGING', reason: 'Normal recovery' };
    const isDeploying = Boolean(tel.batteryDeploying);
    const isHarvesting = Boolean(tel.batteryHarvesting);
    const tyreStress = tel.batteryTyreStress || 0;

    // 1. Vertical Battery Fill Bar (fills bottom to top)
    if (this.el.fill) {
      this.el.fill.style.height = `${Math.max(0, Math.min(100, soc))}%`;

      // Visual distinction between Charging and Deploying
      this.el.fill.classList.remove('fill-charging', 'fill-deploying', 'fill-harvesting', 'fill-depleted', 'fill-ready');
      if (isDeploying) {
        this.el.fill.classList.add('fill-deploying');
      } else if (soc >= 99.5) {
        this.el.fill.classList.add('fill-ready');
      } else if (isHarvesting) {
        this.el.fill.classList.add('fill-harvesting');
      } else if (soc <= 1.0) {
        this.el.fill.classList.add('fill-depleted');
      } else {
        this.el.fill.classList.add('fill-charging');
      }
    }

    // 2. Battery Percentage
    if (this.el.percentTxt) {
      this.el.percentTxt.textContent = `${Math.round(soc)}%`;
    }

    // 3. State Pill Badge
    if (this.el.statePill) {
      let stateLabel = 'CHARGING';
      let pillClass = 'state-charging';

      if (state === BatteryState.DEPLOYING) {
        stateLabel = `DEPLOYING (${tel.batteryCorneringFactor > 0.3 ? 'CORNER' : 'STRAIGHT'})`;
        pillClass = 'state-deploying';
      } else if (state === BatteryState.ATTACK_READY) {
        stateLabel = 'ATTACK READY';
        pillClass = 'state-ready';
      } else if (state === BatteryState.FULLY_CHARGED) {
        stateLabel = elig.eligible ? 'READY TO DEPLOY' : 'FULLY CHARGED';
        pillClass = 'state-full';
      } else if (state === BatteryState.DEPLETED) {
        stateLabel = 'DEPLETED';
        pillClass = 'state-depleted';
      } else if (state === BatteryState.RECHARGING_AFTER_DEPLOYMENT) {
        stateLabel = 'RECOVERING';
        pillClass = 'state-recharging';
      }

      this.el.statePill.textContent = stateLabel;
      this.el.statePill.className = `battery-state-pill ${pillClass}`;
    }

    // 4. Mode Toggle Button (CHARGE vs ATTACK)
    if (this.el.btnMode) {
      this.el.btnMode.classList.remove('btn-mode-charge', 'btn-mode-attack', 'btn-mode-deploying', 'btn-mode-locked');

      if (mode === BatteryMode.ATTACK) {
        if (isDeploying) {
          this.el.btnMode.classList.add('btn-mode-deploying');
          if (this.el.modeIcon) this.el.modeIcon.textContent = '⚡';
          if (this.el.modeLabel) this.el.modeLabel.textContent = 'DEPLOYING [E]';
        } else {
          this.el.btnMode.classList.add('btn-mode-attack');
          if (this.el.modeIcon) this.el.modeIcon.textContent = '⚡';
          if (this.el.modeLabel) this.el.modeLabel.textContent = 'ATTACK READY [E]';
        }
      } else {
        // Charge Mode
        if (soc < 99.5 && state !== BatteryState.ATTACK_READY) {
          this.el.btnMode.classList.add('btn-mode-locked');
          if (this.el.modeIcon) this.el.modeIcon.textContent = '🔋';
          if (this.el.modeLabel) this.el.modeLabel.textContent = 'CHARGING (100% REQ)';
        } else {
          this.el.btnMode.classList.add('btn-mode-charge');
          if (this.el.modeIcon) this.el.modeIcon.textContent = '⚡';
          if (this.el.modeLabel) this.el.modeLabel.textContent = 'ACTIVATE ATTACK [E]';
        }
      }
    }

    // 5. Power Level Buttons (LVL 1, LVL 2, LVL 3)
    [
      { el: this.el.lvl1Btn, lvl: BatteryPowerLevel.LEVEL_1 },
      { el: this.el.lvl2Btn, lvl: BatteryPowerLevel.LEVEL_2 },
      { el: this.el.lvl3Btn, lvl: BatteryPowerLevel.LEVEL_3 }
    ].forEach(({ el, lvl }) => {
      if (el) {
        if (level === lvl) {
          el.classList.add('active');
        } else {
          el.classList.remove('active');
        }
      }
    });

    // 6. Eligibility Context & Reason
    if (this.el.contextTxt) {
      this.el.contextTxt.textContent = elig.context || 'CHARGING';
      this.el.contextTxt.className = `battery-context-txt ${elig.eligible ? 'context-eligible' : 'context-ineligible'}`;
    }

    if (this.el.reasonTxt) {
      this.el.reasonTxt.textContent = elig.reason || 'Normal operation';
    }

    // 7. Tyre Stress Row
    if (this.el.stressRow && this.el.stressVal) {
      if (tyreStress > 0.15) {
        this.el.stressRow.style.display = 'flex';
        const pct = Math.round(tyreStress * 100);
        this.el.stressVal.textContent = `+${pct}% Tyre Wear`;
        if (tyreStress > 0.40) {
          this.el.stressRow.classList.add('stress-critical');
        } else {
          this.el.stressRow.classList.remove('stress-critical');
        }
      } else {
        this.el.stressRow.style.display = 'none';
      }
    }

    // 8. Mobile Sticky Race Control Dock Button Sync
    if (this.el.mBtn) {
      this.el.mBtn.classList.remove('m-batt-charge', 'm-batt-deploying', 'm-batt-ready', 'm-batt-locked');

      if (this.el.mSocPill) {
        this.el.mSocPill.textContent = `${Math.round(soc)}%`;
      }

      if (isDeploying) {
        this.el.mBtn.classList.add('m-batt-deploying');
        if (this.el.mIcon) this.el.mIcon.textContent = '⚡';
        if (this.el.mLabel) this.el.mLabel.textContent = `DEPLOY L${level}`;
        if (this.el.mStatus) this.el.mStatus.textContent = 'ACTIVE';
      } else if (mode === BatteryMode.ATTACK) {
        this.el.mBtn.classList.add('m-batt-ready');
        if (this.el.mIcon) this.el.mIcon.textContent = '⚡';
        if (this.el.mLabel) this.el.mLabel.textContent = 'ATTACK';
        if (this.el.mStatus) this.el.mStatus.textContent = 'READY';
      } else if (soc >= 99.5) {
        this.el.mBtn.classList.add('m-batt-ready');
        if (this.el.mIcon) this.el.mIcon.textContent = '⚡';
        if (this.el.mLabel) this.el.mLabel.textContent = 'ATTACK';
        if (this.el.mStatus) this.el.mStatus.textContent = 'READY';
      } else {
        this.el.mBtn.classList.add('m-batt-charge');
        if (this.el.mIcon) this.el.mIcon.textContent = '🔋';
        if (this.el.mLabel) this.el.mLabel.textContent = 'CHARGE';
        if (this.el.mStatus) this.el.mStatus.textContent = `${Math.round(soc)}%`;
      }
    }
  }
}
