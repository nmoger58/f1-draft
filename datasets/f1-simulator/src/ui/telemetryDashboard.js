/**
 * telemetryDashboard.js
 * Comprehensive Live Telemetry & Race Cockpit HUD.
 *
 * Updates:
 *   - Speed, Throttle, Brake, Steering, Gear, ERS Battery SOC
 *   - Tyre Wear, Compound, Tyre Temperature, Brake Temperature
 *   - Available Grip, Aerodynamic Wake (Clean Air, Dirty Air, Slipstream Tow)
 *   - Dynamic Weather Metrics & Radar Projections
 *   - FIA Race Control Flags (Green, Yellow, VSC, Safety Car, Red)
 *   - FIA 5-Red-Light Gantry, Launch Reaction Timer & Quality Feedback
 *   - Tactical DRS & Pit Stop Controls
 *
 * CHANGELOG (multiplayer launch fix):
 *   - Launch UI extracted into updateLaunchUI() (single place to reason about
 *     button visibility for single player and multiplayer).
 *   - During 'lights_out' (not yet reacted / early press) the button now also
 *     removes 'btn-launch-hidden' and shows the gantry overlay. Previously a
 *     stale 'btn-launch-hidden' class (set by the 'racing' / idle branches)
 *     could keep the LAUNCH NOW button invisible if CSS hides that class.
 *   - tel.launch.lights is guarded (may be undefined before the first sequence).
 *   - Server/user-controlled strings (driver codes, penalty reasons) are
 *     HTML-escaped before being injected via innerHTML (multiplayer safety).
 *   - Fixed shadowed `code` variable in the mobile BOX tyre pill block.
 *   - updateFlag() now handles 'safetycar_in_lap' and unknown flags safely.
 */

import { BatteryHUD } from './batteryHUD.js';
import { getLandingAudio } from './landingAudio.js';

const $ = id => document.getElementById(id);
let batteryHudInstance = null;

export function initBatteryHUD(options = {}) {
  if (!batteryHudInstance) {
    batteryHudInstance = new BatteryHUD(options);
  }
  return batteryHudInstance;
}

export function getBatteryHUD() {
  return batteryHudInstance;
}

const fmtT = s => {
  if (s == null || s <= 0) return '0:00.000';
  const m = Math.floor(s / 60), r = s - m * 60;
  return m + ':' + (r < 10 ? '0' : '') + r.toFixed(3);
};

/** Escape text before inserting into innerHTML (names/reasons may come from peers). */
const esc = v => String(v ?? '').replace(/[&<>"']/g, ch => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[ch]));

/** Show/hide helper that keeps the class and inline style in sync. */
function setVisible(el, visible, hiddenClass) {
  if (!el) return;
  if (hiddenClass) el.classList.toggle(hiddenClass, !visible);
  el.style.display = visible ? '' : 'none';
}

/**
 * Update the FIA start-light gantry, launch button and reaction feedback.
 * Works identically for single player and multiplayer.
 *
 * State → UI:
 *   idle / pre-sequence      → everything hidden
 *   inSequence (lights 1-5)  → gantry visible, button "WAIT FOR LIGHTS OUT"
 *   lights_out, not reacted  → button "🚀 LAUNCH NOW! [SPACE]" (green)
 *   lights_out, early press  → button "JUMP START PENALTY"
 *   lights_out, reacted      → button + bar hidden, result shown in launchMs
 *   racing                   → button, bar and gantry hidden
 */
function updateLaunchUI(tel, code) {
  const l = tel.launch;
  if (!l) return;

  // Update 5 red light circles
  const lights = l.lights || [];
  let anyLightOn = false;
  for (let i = 0; i < 5; i++) {
    const isLit = !!lights[i];
    if (isLit) anyLightOn = true;
    const gEl = $(`gLight${i}`);
    if (gEl) gEl.classList.toggle('lit', isLit);
  }

  // Audio should be played until the race start light appears on the gantry;
  // strictly enforce soundtrack silence whenever racing is active on track
  try {
    const audioCtrl = getLandingAudio();
    if (audioCtrl && audioCtrl.isPlaying && (!audioCtrl.canPlay() || anyLightOn)) {
      audioCtrl.pause(true);
    }
  } catch (_) {}

  const gantryDriverTag = $('gantryDriverTag');
  if (gantryDriverTag) {
    gantryDriverTag.textContent = `${code} (P${tel.position})`;
  }

  const btnLaunch = $('btnLaunch');
  if (!btnLaunch) return;

  const btnLaunchLabel = $('btnLaunchLabel');
  const launchActionBar = $('launchActionBar');
  const launchMs = $('launchMs');
  const launchQuality = $('launchQuality');
  const gantryOverlay = $('gantryOverlay');

  const setLabel = t => { if (btnLaunchLabel) btnLaunchLabel.textContent = t; };
  const setMs = (t, color) => {
    if (!launchMs) return;
    launchMs.textContent = t;
    launchMs.style.color = color;
  };
  const setQuality = t => { if (launchQuality) launchQuality.textContent = t; };

  /** Show or hide the whole launch control group (button + action bar). */
  const showControls = visible => {
    setVisible(btnLaunch, visible, 'btn-launch-hidden');
    setVisible(launchActionBar, visible, 'launch-hidden');
  };
  const showGantry = visible => setVisible(gantryOverlay, visible, 'gantry-hidden');

  btnLaunch.classList.remove('btn-launch-wait', 'btn-launch-ready', 'btn-launch-launched', 'btn-launch-early');

  if (l.state === 'lights_out') {
    // Lights are out: the gantry must be visible so the player sees them go dark.
    showGantry(true);

    if (l.playerReacted) {
      // Hide launch controls completely once the player has reacted
      btnLaunch.classList.add('btn-launch-launched');
      showControls(false);
      setLabel(`LAUNCHED (${l.reactionMs} ms)`);
      setMs(`${l.reactionMs} ms`, l.ratingColor || '#00e5ff');
      setQuality(`${l.rating} · ${l.launchQuality}`);
    } else if (l.earlyPress) {
      btnLaunch.classList.add('btn-launch-early');
      showControls(true);
      setLabel('JUMP START PENALTY');
      setMs('EARLY!', '#ff3d00');
      setQuality(l.earlyWarning || 'Anti-stall penalty applied!');
    } else {
      // LAUNCH NOW window (also reached in multiplayer after the server lights-out)
      btnLaunch.classList.add('btn-launch-ready');
      showControls(true);
      setLabel('🚀 LAUNCH NOW! [SPACE]');
      setMs('REACT NOW!', '#00e676');
      setQuality('Press [SPACE] or Click LAUNCH!');
    }
  } else if (l.state === 'racing') {
    // Racing underway: hide launch controls and gantry
    btnLaunch.classList.add('btn-launch-launched');
    showControls(false);
    showGantry(false);
  } else if (l.inSequence) {
    // In 5-red-light sequence before lights out
    showGantry(true);
    showControls(true);
    btnLaunch.classList.add('btn-launch-wait');
    setLabel('WAIT FOR LIGHTS OUT');
    setMs('--- ms', '#00e5ff');
    setQuality('Wait for all 5 red lights to extinguish...');
  } else {
    // Pre-sequence grid waiting or uninitiated race: keep hidden
    showControls(false);
    showGantry(false);
  }
}

/**
 * Update all telemetry DOM elements for the selected car.
 * @param {object} tel  – from raceEngine.getTelemetry(selIdx)
 * @param {string} code – driver code for label
 * @param {number} L    – lap length in metres
 * @param {number} d    – car.d (distance along track, may wrap)
 */
export function updateTelemetry(tel, code, L, d) {
  if (!tel) return;

  // ── Primary Telemetry Strip ──
  $('tSpeed') && ($('tSpeed').textContent = tel.speed);
  $('tLabel') && ($('tLabel').textContent = code + ' speed (est.)');
  $('tTime')  && ($('tTime').textContent  = fmtT(tel.lapTime));
  $('tLap')   && ($('tLap').textContent   = Math.max(1, tel.lap));
  $('tGrip')  && ($('tGrip').textContent  = tel.currentGrip || 100);

  // Progress bar
  const prog = $('prog');
  if (prog && L > 0) {
    const pct = (100 * (((d % L) + L) % L) / L).toFixed(1);
    prog.style.width = pct + '%';
  }

  // ── Extended Telemetry Row ──
  $('tThrottle') && ($('tThrottle').textContent = Math.round(tel.throttle * 100));
  $('tBrake')    && ($('tBrake').textContent    = Math.round(tel.brake * 100));
  $('tGear')     && ($('tGear').textContent     = tel.gear);
  $('tErs')      && ($('tErs').textContent      = (tel.batterySoc ?? tel.ersSoc ?? 85) + '%');
  $('tTyre')     && ($('tTyre').textContent     = tel.tyre);
  $('tWear')     && ($('tWear').textContent     = Math.round(tel.tyreWear * 100));
  $('tTyreTemp') && ($('tTyreTemp').textContent = (tel.tyreTemp ?? 98) + '°C');
  $('tBrakeTemp')&& ($('tBrakeTemp').textContent= (tel.brakeTemp ?? 340) + '°C');
  $('tFuel')     && ($('tFuel').textContent     = tel.fuelRemaining ?? '85.0');
  $('tPos')      && ($('tPos').textContent      = 'P' + tel.position);
  $('tPits')     && ($('tPits').textContent     = tel.pitstops);
  $('tLastLap')  && ($('tLastLap').textContent  = fmtT(tel.lastLap));
  $('tBestLap')  && ($('tBestLap').textContent  = fmtT(tel.bestLap));

  // Update Live Battery HUD Component
  batteryHudInstance?.update(tel);

  // Aero Wake Status Pill
  const tAeroStatus = $('tAeroStatus');
  if (tAeroStatus) {
    if (tel.inSlipstream) {
      tAeroStatus.innerHTML = '<span class="aero-pill aero-tow">SLIPSTREAM TOW</span>';
    } else if (tel.inDirtyAir) {
      tAeroStatus.innerHTML = '<span class="aero-pill aero-dirty">DIRTY AIR</span>';
    } else {
      tAeroStatus.innerHTML = '<span class="aero-pill aero-clean">CLEAN AIR</span>';
    }
  }

  // Psychology, Confidence & Home Race Badge
  const tPsychBadge = $('tPsychBadge');
  if (tPsychBadge) {
    if (tel.isHomeRace && tel.isPreviousWinner) {
      tPsychBadge.innerHTML = '<span class="psych-pill psych-home-win" title="Home race & Previous Circuit Winner">🏠🏆 HOME & PREV WINNER</span>';
    } else if (tel.isHomeRace) {
      tPsychBadge.innerHTML = '<span class="psych-pill psych-home" title="Racing in front of home crowd">🏠 HOME GP</span>';
    } else if (tel.isPreviousWinner) {
      tPsychBadge.innerHTML = `<span class="psych-pill psych-winner" title="${esc(tel.psychContext || 'Previous Circuit Winner')}">🏆 ${tel.isDefendingWinner ? 'DEFENDING WINNER' : 'PREV WINNER'}</span>`;
    } else {
      tPsychBadge.innerHTML = '';
    }
  }

  // Throttle / brake bars
  const thBar = $('thBar');
  if (thBar) thBar.style.width = Math.round(tel.throttle * 100) + '%';
  const brBar = $('brBar');
  if (brBar) brBar.style.width = Math.round(tel.brake * 100) + '%';

  // Tyre badge background colour & status
  const tyreBadge = $('tyreBadge');
  if (tyreBadge && tel.tyreColour) {
    tyreBadge.style.background = tel.tyreColour;
    tyreBadge.textContent = tel.tyre;
  }
  $('tTyreAge') && ($('tTyreAge').textContent = `(${tel.tyreAge ?? 0}L)`);
  const tTyreCond = $('tTyreCond');
  if (tTyreCond && tel.tyreCondition) {
    tTyreCond.textContent = tel.tyreCondition;
    const condClass = {
      'OPTIMAL': 'tyre-cond-optimal',
      'WARMING UP': 'tyre-cond-warmup',
      'COLD': 'tyre-cond-cold',
      'OVERHEATING': 'tyre-cond-overheat',
      'CLIFF': 'tyre-cond-cliff',
      'PUNCTURED': 'tyre-cond-punctured',
      'BLISTERED': 'tyre-cond-overheat',
      'GRAINED': 'tyre-cond-cold',
      'FLAT SPOT': 'tyre-cond-overheat'
    }[tel.tyreCondition] || 'tyre-cond-optimal';
    tTyreCond.className = `tyre-cond-pill ${condClass}`;
  }

  // Strategic Advice Banner
  const advEl = $('tacticalAdviceTxt');
  if (advEl && tel.strategicAdvice) {
    advEl.textContent = tel.strategicAdvice.undercut?.recommendation || tel.strategicAdvice.reason || 'Optimal window.';
  }

  // ── Dynamic Weather & Radar HUD ──
  const wBadge = $('wBadge');
  if (wBadge && tel.weatherLabel) {
    wBadge.textContent = tel.weatherLabel.toUpperCase();
    wBadge.className = 'weather-badge ' + (tel.rainIntensity > 60 ? 'weather-monsoon' : (tel.rainIntensity > 15 ? 'weather-rain' : 'weather-dry'));
  }
  $('wRain')      && ($('wRain').textContent      = (tel.rainIntensity ?? 0) + '%');
  $('wTrackWet')  && ($('wTrackWet').textContent  = (tel.trackWetness ?? 0) + '%');
  $('wTrackTemp') && ($('wTrackTemp').textContent = (tel.trackTemp ?? 32) + '°C');
  $('wAirTemp')   && ($('wAirTemp').textContent   = (tel.ambientTemp ?? 24) + '°C');
  $('wRubber')    && ($('wRubber').textContent    = (tel.trackRubberLevel ?? 0) + '%');
  if ($('wDryingLine')) {
    const dl = tel.dryingLine;
    if (dl && dl.formed) {
      $('wDryingLine').textContent = 'FORMED';
      $('wDryingLine').style.color = '#39b54a';
    } else {
      $('wDryingLine').textContent = 'NO';
      $('wDryingLine').style.color = 'var(--muted)';
    }
  }

  if (tel.radar) {
    $('rad2m') && ($('rad2m').textContent = `${tel.radar.label} (${Math.round(tel.radar.rainIntensity * 100)}%)`);
    $('radRec2m') && ($('radRec2m').textContent = `Rec: ${tel.radar.recommendedCompound.toUpperCase()}`);
  }

  // ── FIA Race Control & Flag Status ──
  const rcFlagBadge = $('rcFlagBadge');
  if (rcFlagBadge && tel.flag) {
    const flagNames = {
      green: 'GREEN FLAG',
      yellow: 'YELLOW FLAG',
      vsc: 'VIRTUAL SAFETY CAR',
      safetycar: 'SAFETY CAR',
      safetycar_in_lap: 'SC IN THIS LAP',
      red: 'RED FLAG',
      chequered: 'CHEQUERED FLAG'
    };
    rcFlagBadge.textContent = flagNames[tel.flag] || (tel.flag.toUpperCase() + ' FLAG');
    rcFlagBadge.className = 'rc-flag-badge rc-' + (tel.flag.startsWith('safetycar') ? 'safetycar' : tel.flag);
  }

  // Safety Car Status Value
  const rcScStatusVal = $('rcScStatusVal');
  if (rcScStatusVal && tel.safetyCar) {
    if (tel.safetyCar.active) {
      rcScStatusVal.textContent = tel.safetyCar.inLap ? 'RETURNING TO PITS' : 'ON TRACK (140 KM/H)';
      rcScStatusVal.style.color = tel.safetyCar.inLap ? '#ffd60a' : '#ff9100';
    } else {
      rcScStatusVal.textContent = 'STANDBY (PIT LANE)';
      rcScStatusVal.style.color = 'var(--muted)';
    }
  }

  // Penalties & Investigations List
  const penaltyList = $('penaltyList');
  if (penaltyList) {
    const investigations = tel.investigations || [];
    const penalties = tel.penalties || [];

    if (!investigations.length && !penalties.length) {
      penaltyList.innerHTML = '<div class="penalty-none">No active penalties or investigations</div>';
    } else {
      const items = [];
      // Active investigations first
      investigations.filter(i => i.status === 'UNDER_REVIEW').forEach(i => {
        items.push(`
          <div class="penalty-item penalty-ongoing">
            🟡 <strong>${esc(i.driverCode)}</strong>: UNDER INVESTIGATION &middot; ${esc(i.reason)}
          </div>
        `);
      });
      // Penalties & decisions
      penalties.forEach(p => {
        items.push(`
          <div class="penalty-item">
            ⚖ <strong>${esc(p.driverCode)}</strong>: +${esc(p.penaltySeconds)}s — ${esc(p.reason)}
          </div>
        `);
      });
      // Concluded investigations with no penalty
      investigations.filter(i => i.status === 'RESOLVED' && i.penaltySeconds === 0).forEach(i => {
        items.push(`
          <div class="penalty-item penalty-cleared">
            🟢 <strong>${esc(i.driverCode)}</strong>: ${esc(i.decisionText || 'No Further Action')}
          </div>
        `);
      });
      penaltyList.innerHTML = items.join('');
    }
  }

  // ── Starting Lights Gantry & Launch Challenge ──
  updateLaunchUI(tel, code);

  // ── Tactical DRS HUD updates ───────────────────────────────────────────
  const btnDrs = $('btnDrs');
  const drsStatusTxt = $('drsStatusTxt');
  const drsReasonTxt = $('drsReasonTxt');
  const drsWingIcon = $('drsWingIcon');

  // Mobile Sticky Dock DRS Controls
  const mBtnDrs = $('mBtnDrs');
  const mDrsStatus = $('mDrsStatus');
  const mDrsReason = $('mDrsReason');
  const mDrsWingIcon = $('mDrsWingIcon');

  let drsStateClass = 'drs-disabled';
  let drsLabel = 'DRS UNAVAILABLE';
  let drsWingText = 'CLOSED';
  let drsPillText = 'DISABLED';

  if (tel.drsActive) {
    drsStateClass = 'drs-active';
    drsLabel = 'DRS ACTIVE';
    drsWingText = 'OPEN';
    drsPillText = 'ACTIVE';
  } else if (tel.drsEligible) {
    drsStateClass = 'drs-available';
    drsLabel = 'DEPLOY DRS [D]';
    drsWingText = 'READY';
    drsPillText = 'AVAILABLE';
  } else if (tel.inDrsZone) {
    drsStateClass = 'drs-unavailable';
    drsLabel = 'DRS BLOCKED';
    drsWingText = 'CLOSED';
    drsPillText = 'BLOCKED';
  } else {
    drsStateClass = 'drs-disabled';
    drsLabel = 'DRS UNAVAILABLE';
    drsWingText = 'CLOSED';
    const isRestricted = tel.drsReason && (tel.drsReason.startsWith('Disabled') || tel.drsReason.startsWith('Safety'));
    drsPillText = isRestricted ? 'RESTRICTED' : 'DISABLED';
  }

  if (btnDrs) {
    btnDrs.classList.remove('drs-active', 'drs-available', 'drs-unavailable', 'drs-disabled');
    btnDrs.classList.add(drsStateClass);
    drsStatusTxt && (drsStatusTxt.textContent = drsLabel);
    drsWingIcon && (drsWingIcon.textContent = drsWingText === 'OPEN' ? 'WING OPEN' : drsWingText);
    drsReasonTxt && (drsReasonTxt.textContent = tel.drsReason || 'Outside DRS Zone');
  }

  if (mBtnDrs) {
    mBtnDrs.classList.remove('drs-active', 'drs-available', 'drs-unavailable', 'drs-disabled');
    mBtnDrs.classList.add(drsStateClass);
    mDrsStatus && (mDrsStatus.textContent = drsPillText);
    mDrsWingIcon && (mDrsWingIcon.textContent = drsWingText);
    mDrsReason && (mDrsReason.textContent = tel.drsReason || (tel.inDrsZone ? 'In DRS Zone' : 'Outside Zone'));
  }

  // ── Tactical Pit Stop HUD & Live Tyre Degradation Progress Bar ───────────
  const btnBox = $('btnBox');
  const pitStatusBadge = $('pitStatusBadge');

  // Live Tyre Degradation Progress Component updates
  const tdwLifeVal = $('tdwLifeVal');
  const tdwWearVal = $('tdwWearVal');
  const tdwProgressFill = $('tdwProgressFill');
  const tdwWarningTxt = $('tdwWarningTxt');
  const tdwWarningIcon = $('tdwWarningIcon');
  const tdwCompoundName = $('tdwCompoundName');
  const tdwCompoundPill = $('tdwCompoundPill');

  if (tdwLifeVal || tdwProgressFill) {
    const rawWear = tel.tyreWear !== undefined ? tel.tyreWear : 0;
    const wearPct = Math.min(100, Math.max(0, Math.round(rawWear * 100)));
    const lifePct = Math.max(0, 100 - wearPct);

    let statusClass = 'tdw-healthy';
    let warningText = 'Tyres in good condition.';
    let warningIcon = '🟢';

    if (lifePct === 0) {
      statusClass = 'tdw-depleted';
      warningText = 'Tyres fully degraded — performance limited.';
      warningIcon = '⛔';
    } else if (lifePct <= 14) {
      statusClass = 'tdw-critical';
      warningText = 'Critical tyre wear — pit recommended.';
      warningIcon = '🔴';
    } else if (lifePct <= 39) {
      statusClass = 'tdw-high';
      warningText = 'High degradation — consider boxing.';
      warningIcon = '🟠';
    } else if (lifePct <= 69) {
      statusClass = 'tdw-moderate';
      warningText = 'Tyre wear increasing.';
      warningIcon = '🟡';
    } else {
      statusClass = 'tdw-healthy';
      warningText = 'Tyres in good condition.';
      warningIcon = '🟢';
    }

    if (tdwLifeVal) tdwLifeVal.textContent = `${lifePct}%`;
    if (tdwWearVal) tdwWearVal.textContent = `${wearPct}%`;
    if (tdwProgressFill) {
      tdwProgressFill.style.width = `${lifePct}%`;
      tdwProgressFill.className = `tdw-progress-fill ${statusClass}`;
    }
    if (tdwWarningTxt) tdwWarningTxt.textContent = warningText;
    if (tdwWarningIcon) tdwWarningIcon.textContent = warningIcon;

    if (tdwCompoundName) {
      const comp = (tel.tyreCompound || 'medium').toUpperCase();
      tdwCompoundName.textContent = comp;
    }
    if (tdwCompoundPill) {
      const c = (tel.tyreCompound || 'm')[0].toUpperCase();
      tdwCompoundPill.textContent = c;
      tdwCompoundPill.style.backgroundColor = tel.tyreColour || '#ffd60a';
      tdwCompoundPill.style.color = (tel.tyreCompound === 'hard' || tel.tyreCompound === 'medium') ? '#000' : '#fff';
    }
  }

  if (btnBox) {
    btnBox.classList.remove('btn-box-active', 'btn-box-req', 'btn-box-inpit');
    if (tel.pitState === 'servicing') {
      btnBox.classList.add('btn-box-inpit');
      btnBox.textContent = `SERVICING (${(tel.pitTimer || 2.4).toFixed(1)}s)`;
      btnBox.disabled = true;
    } else if (tel.pitState === 'entering' || tel.pitState === 'in_lane' || tel.pitState === 'exiting') {
      btnBox.classList.add('btn-box-inpit');
      btnBox.textContent = `IN PIT LANE (80 km/h)`;
      btnBox.disabled = true;
    } else if (tel.pitRequested) {
      btnBox.classList.add('btn-box-req');
      btnBox.textContent = `CANCEL BOX [B]`;
      btnBox.disabled = false;
    } else {
      btnBox.classList.add('btn-box-active');
      btnBox.textContent = `BOX THIS LAP [B]`;
      btnBox.disabled = false;
    }
  }

  // Mobile Sticky Dock Pit / BOX Button
  const mBtnBox = $('mBtnBox');
  const mBoxStatus = $('mBoxStatus');
  const mBoxTyrePill = $('mBoxTyrePill');
  if (mBtnBox) {
    mBtnBox.classList.remove('btn-box-req', 'btn-box-inpit');
    if (tel.pitState === 'servicing') {
      mBtnBox.classList.add('btn-box-inpit');
      mBoxStatus && (mBoxStatus.textContent = `${(tel.pitTimer || 2.4).toFixed(1)}s`);
      mBtnBox.disabled = true;
    } else if (tel.pitState === 'entering' || tel.pitState === 'in_lane' || tel.pitState === 'exiting') {
      mBtnBox.classList.add('btn-box-inpit');
      mBoxStatus && (mBoxStatus.textContent = 'IN PIT');
      mBtnBox.disabled = true;
    } else if (tel.pitRequested) {
      mBtnBox.classList.add('btn-box-req');
      mBoxStatus && (mBoxStatus.textContent = 'CANCEL');
      mBtnBox.disabled = false;
    } else {
      mBoxStatus && (mBoxStatus.textContent = 'READY');
      mBtnBox.disabled = false;
    }

    if (mBoxTyrePill) {
      const compoundLetter = (tel.tyre?.slice(0, 1) || 'M').toUpperCase();
      const rawWear = tel.tyreWear !== undefined ? tel.tyreWear : 0;
      const lifePct = Math.max(0, Math.round((1 - rawWear) * 100));
      mBoxTyrePill.textContent = `${compoundLetter} ${lifePct}%`;
      mBoxTyrePill.style.background = tel.tyreColour || '#ffd60a';
      mBoxTyrePill.style.color = (tel.tyreCompound === 'hard' || tel.tyreCompound === 'medium') ? '#000' : '#fff';
    }
  }

  if (pitStatusBadge) {
    const stateLabels = {
      ready:     'ON TRACK',
      requested: tel.pitLateRequest ? 'BOX NEXT LAP' : 'PIT CONFIRMED',
      in_lap:    'IN-LAP (APPROACH)',
      entering:  'ENTERING PIT LANE',
      in_lane:   'PIT LIMITER (80 km/h)',
      servicing: `TYRE SERVICE (${(tel.pitTimer || 2.4).toFixed(1)}s)`,
      exiting:   'EXITING PIT LANE',
      out_lap:   'REJOINING TRACK',
    };
    pitStatusBadge.textContent = stateLabels[tel.pitState] || 'ON TRACK';
    pitStatusBadge.className = 'pit-status-badge pit-status-' + (tel.pitState || 'ready');
  }
}

/** Update the flag indicator bar */
export function updateFlag(flag) {
  const el = $('flagBar');
  if (!el) return;
  el.className = 'flag-bar flag-' + flag;
  const labels = {
    green:            'GREEN FLAG — RACING',
    yellow:           '⚠ YELLOW FLAG (LOCAL HAZARD)',
    vsc:              '⚠ VIRTUAL SAFETY CAR — MAINTAIN DELTA',
    safetycar:        '🚨 PHYSICAL SAFETY CAR ON TRACK — QUEUE UP',
    safetycar_in_lap: '🚨 SAFETY CAR IN THIS LAP — NO OVERTAKING',
    red:              '⛔ RED FLAG — SESSION SUSPENDED',
    chequered:        '🏁 CHEQUERED FLAG — RACE FINISH'
  };
  el.textContent = labels[flag] || 'GREEN FLAG — RACING';
}