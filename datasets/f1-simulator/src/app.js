/**
 * app.js
 * Main application entry point.
 * Wires all modules together and runs the animation loop.
 *
 * Module dependencies (all ES module imports — no bundler required):
 *   circuitData   → trackManager → raceEngine
 *   driverData    → raceEngine
 *   trackRenderer → carRenderer → cameraController
 *   leaderboard, telemetryDashboard, engineerLog, teamRadio
 */

import { CIRCUITS, RAW_WAYPOINTS, getCircuit } from './data/circuitData.js';
import { DRIVERS, getGrid }                    from './data/driverData.js';
import { buildTrack }                           from './simulation/trackManager.js';
import { RaceEngine, RaceState }               from './simulation/raceEngine.js';
import { renderTrack, applyTrackMode }          from './visualization/trackRenderer.js';
import { createCarElements, drawCars, orderCarElements, createSafetyCarElement, drawSafetyCar } from './visualization/carRenderer.js';
import { CameraController }                     from './visualization/cameraController.js';
import { renderLeaderboard }                    from './ui/leaderboard.js';
import { updateTelemetry, updateFlag, initBatteryHUD } from './ui/telemetryDashboard.js';
import { initDeveloperTelemetry, getDeveloperTelemetry } from './ui/developerTelemetry.js';
import { logEvents, clearLog }                  from './ui/engineerLog.js';
import { CommentaryToastManager }               from './ui/commentaryToastOverlay.js';
import { InvestigationOverlay }                 from './ui/investigationOverlay.js';
import {
  postRadioMessages,
  setRadioFilter,
  getRadioSettings,
  updateRadioSettings,
  renderRadioControls,
  setRadioActionCallback,
  getVoiceSettings,
  updateVoiceSettings,
  getAvailableVoices,
  previewVoice,
  muteRadioVoice,
  resetVoiceDefaults
} from './ui/teamRadio.js';
import { SimConfig }                            from './config/simulationConfig.js';
import { ChampionshipUIController }             from './championship/championshipUIController.js';
import { QuickRaceUIController }                from './quickrace/quickRaceUIController.js';
import { TyreModel }                            from './simulation/tyreModel.js';
import { getSharedDraftEngine }                 from './strategy/draftEngine.js';
import { getDraftModal }                        from './ui/draftModal.js';
import { getManager }                           from './data/managerData.js';
import { getCar }                               from './data/carData.js';
import { getLandingPage }                       from './ui/landingPage.js';
import { getLandingAudio }                      from './ui/landingAudio.js';
import { getDraftModeController }               from './ui/f1DraftMode.js';
import { getSharedMultiplayerController }       from './multiplayer/multiplayerUIController.js';

// ── State ─────────────────────────────────────────────────────────────────

export const WARP_RATES = SimConfig.warpRates;

const state = {
  circuitId:        'monaco',
  mode:             'real',        // 'real' | 'sector' | 'speed'
  warp:             WARP_RATES[1], // Start with accelerated 1x baseline (2.5x)
  rawWarp:          1,
  playing:          true,
  selIdx:           0,             // selected car index (into engine.cars[])
  gridSize:         6,             // how many drivers to put on grid
  selectedCompound: 'medium',      // user-selected tyre compound for pit stop
};

const cam       = new CameraController();
const engine    = new RaceEngine();
if (typeof window !== 'undefined') {
  window.simulatorState = state;
  window.raceEngine = engine;
}
let champCtrl   = null;
export let quickRaceCtrl = null;
export let multiplayerCtrl = null;
export let toastOverlay = null;
export let investigationOverlay = null;

let track    = null;
let scene    = null;    // SVG scene refs from trackRenderer
let sprites  = null;    // car SVG elements
let scSprite = null;    // Safety Car SVG sprite refs

let lastTS   = 0;
let boardTS  = 0;
let rafId    = 0;

// ── $ helpers ────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const fmtT = s => {
  if (!s || s <= 0) return '–';
  const m = Math.floor(s / 60), r = s - m * 60;
  return m + ':' + (r < 10 ? '0' : '') + r.toFixed(3);
};

// ── Build circuit ─────────────────────────────────────────────────────────

function buildCircuit(id, options = {}) {
  const circuitId = id;
  state.circuitId = id;
  const circuit = getCircuit(id);
  const rawPts  = RAW_WAYPOINTS[id];
  if (!rawPts) { console.warn('No waypoint data for', id); return; }

  // Build track geometry
  track = buildTrack(circuit, rawPts);

  // Build SVG scene (replaces inner SVG content)
  const svgEl = $('map');
  scene = renderTrack(svgEl, track);
  applyTrackMode(scene, state.mode);

  // Build race engine with current grid or custom championship grid
  const totalLaps = options.totalLaps ?? SimConfig.race.totalLaps ?? circuit.laps;

  const draftEngine = getSharedDraftEngine({ circuitId });
  const draftSummary = draftEngine.getSummary();

  let grid = options.customGridDrivers;
  let playerCarModel = options.playerCarModel;
  let playerManager = options.playerManager;
  let playerCarIdx = options.playerCarIdx;

  if (!grid) {
    // Quick Race: build grid using draft engine so selected driver is in slot 0 and NOT duplicated in AI grid
    grid = draftEngine.buildRaceGrid(state.gridSize);
    playerCarIdx = 0;
    if (draftSummary.car) playerCarModel = draftSummary.car;
    if (draftSummary.manager) playerManager = draftSummary.manager;
  }

  const engineOpts = {
    radioMode: options.radioMode || getRadioSettings().mode,
    homeAdvantageEnabled: options.homeAdvantageEnabled ?? true,
    previousWinnerEnabled: options.previousWinnerEnabled ?? true,
    archivedHistory: options.archivedHistory || null,
    currentSeasonCalendar: options.currentSeasonCalendar || null,
    currentRoundIndex: options.currentRoundIndex || null,
    playerCarIdx: playerCarIdx !== undefined ? playerCarIdx : 0,
    playerCarModel,
    playerManager,
    ...options
  };

  engine.build(track, grid, totalLaps, engineOpts);
  getDeveloperTelemetry()?.setEngine(engine, scene, track);

  if (playerCarIdx !== undefined) {
    state.selIdx = Math.max(0, Math.min(playerCarIdx, engine.cars.length - 1));
  } else {
    state.selIdx = Math.max(0, Math.min(state.selIdx, engine.cars.length - 1));
  }
  engine.setSelectedCar(state.selIdx);

  // Sync draft pill display & HUD tags
  updateDraftPillDisplay(draftSummary);
  updateTacticalHUD();

  if (options.startingCompound) {
    const selCar = engine.cars[state.selIdx];
    if (selCar) {
      selCar.targetCompound = options.startingCompound;
      selCar.tyreModel = new TyreModel(options.startingCompound, 0, { punctureOnWear: false });
      selCar.compoundsUsed = new Set([options.startingCompound]);
    }
  }

  // Create car SVG elements and Physical Safety Car
  sprites = createCarElements(engine.cars, scene, track.k, selectCar);
  scSprite = createSafetyCarElement(scene, track.k);

  // Hook central player investigation overlay to Race Control & Voice Radio
  if (investigationOverlay) {
    investigationOverlay.clear();
    if (engine.raceControl) {
      engine.raceControl.onPlayerInvestigationUpdate = inv => {
        investigationOverlay.handleInvestigationUpdate(inv);
        // Announce investigation once via team radio from CSV
        if (engine.commentaryEngine) {
          let evType = null;
          const ctx = { driver: inv.driverCode, investigationId: inv.id, simTime: engine.simTime };
          if (inv.status === 'under_review' || inv.status === 'open') {
            evType = (inv.incidentType === 'jump_start') ? 'JUMP_START_INVESTIGATION' : 'INVESTIGATION_OPEN';
          } else if (inv.status === 'resolved') {
            if (inv.penaltySeconds > 0) {
              evType = 'PENALTY_RECEIVED';
              ctx.penalty = `${inv.penaltySeconds}-second time penalty for ${inv.decisionText || inv.reason}`;
            } else if (inv.decision === 'warning') {
              evType = 'WARNING_RECEIVED';
            } else {
              evType = 'INVESTIGATION_NO_ACTION';
            }
          }
          if (evType) {
            const comm = engine.commentaryEngine.processEvent(evType, ctx);
            if (comm) {
              postRadioMessages([comm], {
                selectedDriverCode: engine.cars[state.selIdx]?.code,
                carState: engine.cars[state.selIdx]
              });
            }
          }
        }
      };
    }
  }

  // Camera reset
  cam.setOverview();
  cam.z   = 1;
  cam.w   = 0;
  cam.rot = 0;

  // UI
  renderSidePanel();
  renderChrome();
  updateTacticalHUD();
  clearLog();
  toastOverlay?.clear();
  updateFlag('red');

  const btnLaunch = $('btnLaunch');
  const launchActionBar = $('launchActionBar');
  const gantryOverlay = $('gantryOverlay');
  const shouldStartSequence = (options.autoStartSequence === true || (options.autoStartSequence !== false && state.playing)) && !options.skipGridSequence;

  if (shouldStartSequence) {
    if (btnLaunch) {
      btnLaunch.classList.remove('btn-launch-hidden');
      btnLaunch.style.display = '';
    }
    if (launchActionBar) {
      launchActionBar.classList.remove('launch-hidden');
      launchActionBar.style.display = '';
    }
    if (gantryOverlay) {
      gantryOverlay.classList.remove('gantry-hidden');
      gantryOverlay.style.display = '';
    }
    // Initiate FIA 5-red-light starting sequence
    engine.startGridSequence();
    getLandingAudio().pause(true);
    logEvents([{ time: 0, msg: `🏁 ${circuit.name} assembled. 5 Red Lights sequence starting...`, type: 'control' }]);
    toastOverlay?.processEvents([{
      category: 'info',
      headline: `${circuit.name.toUpperCase()} ASSEMBLED`,
      detail: 'Grid formed — starting sequence initiated',
      priority: 3,
      icon: '🏁',
      accent: 'blue'
    }]);
  } else {
    if (btnLaunch) {
      btnLaunch.classList.add('btn-launch-hidden');
      btnLaunch.style.display = 'none';
    }
    if (launchActionBar) {
      launchActionBar.classList.add('launch-hidden');
      launchActionBar.style.display = 'none';
    }
    if (gantryOverlay) {
      gantryOverlay.classList.add('gantry-hidden');
      gantryOverlay.style.display = 'none';
    }
  }
}

// ── Animation loop ────────────────────────────────────────────────────────

function frame(ts) {
  rafId = requestAnimationFrame(frame);
  if (!lastTS) lastTS = ts;
  const dt = Math.min((ts - lastTS) / 1000, 0.1);
  lastTS = ts;

  // STRICT AUDIO SILENCE ENFORCEMENT: Never allow background soundtrack during any active racing session
  try {
    const landingAudio = getLandingAudio();
    if (landingAudio && landingAudio.isPlaying && !landingAudio.canPlay()) {
      landingAudio.pause(true);
    }
  } catch (_) {}

  if (track) {
    // Physics + AI step
    if (state.playing && engine.state === RaceState.RACING) {
      if (multiplayerCtrl && multiplayerCtrl.inRace) {
        state.warp = 2;
        state.rawWarp = 2;
      }
      engine.warp = state.warp;
      const newEvents = engine.step(dt);
      if (newEvents && newEvents.length) {
        logEvents(newEvents);
        toastOverlay?.processEvents(newEvents);
        updateFlag(engine.flag);
      }
      if (newEvents && newEvents.radio && newEvents.radio.length) {
        postRadioMessages(newEvents.radio, {
          selectedDriverCode: engine.cars[state.selIdx]?.code,
          carState: engine.cars[state.selIdx]
        });
      }

      // Live Championship Projections HUD update
      if (champCtrl && champCtrl.active) {
        champCtrl.updateInRaceProjection();
      }

      // Live Multiplayer Timing Tower & Telemetry Sync
      if (multiplayerCtrl && multiplayerCtrl.inRace) {
        const myCar = engine.cars[state.selIdx];
        multiplayerCtrl.updateLiveTiming(engine.cars, myCar?.lap || 1, engine.totalLaps || 5);
        if (myCar) {
          multiplayerCtrl.client.sendTelemetry({
            s: myCar.d,
            v: myCar.v,
            lat: myCar.lat,
            lap: myCar.lap,
            tyreLife: myCar.tyreModel?.wearPercent !== undefined ? 1 - myCar.tyreModel.wearPercent / 100 : 1,
            batteryLevel: myCar.batteryLevel || 100,
            drsActive: myCar.drsActive || false
          });
          if (myCar.finished && !myCar._mpFinishReported) {
            myCar._mpFinishReported = true;
            multiplayerCtrl.client.finishRace(myCar.finishTime, myCar.bestLap);
          }
        }

        // Host client reports AI car finishes as they cross the chequered line
        if (multiplayerCtrl.client.myParticipant?.isHost && Array.isArray(engine.cars)) {
          for (const car of engine.cars) {
            if (car.isAI && car.finished && !car._mpFinishReported) {
              car._mpFinishReported = true;
              const aiId = car.participantId || `ai_${car.driver?.code || car.code}`;
              multiplayerCtrl.client.finishParticipant(aiId, car.finishTime, car.bestLap || car.lastLap);
            }
          }
        }
      }
    }

    // Camera
    const selCar = engine.cars[state.selIdx];
    cam.update(scene, selCar, dt, state.warp);

    // Draw cars and Physical Safety Car
    drawCars(engine.cars, sprites, cam, track.k, state.selIdx);
    drawSafetyCar(engine.raceControl?.safetyCar, scSprite, cam, track.k);

    // Telemetry
    const tel = engine.getTelemetry(state.selIdx);
    if (selCar) {
      updateTelemetry(tel, selCar.code, track.circuit.lengthM, selCar.d);
      updateTacticalHUD();
    }

    // HUD
    const hud = $('hud');
    if (hud) hud.textContent = selCar
      ? (cam.mode === 'follow' ? `Following ${selCar.code} · ${cam.hudText}` : 'Whole track')
      : '';

    // Leaderboard (throttled)
    if (ts - boardTS > SimConfig.render.boardUpdateMs) {
      boardTS = ts;
      renderLeaderboard(engine.standings, state.selIdx, engine.totalLaps, selectCar);
    }

    // Race finished
    if (engine.state === RaceState.FINISHED && state.playing) {
      state.playing = false;
      $('playBtn').textContent = 'Play';
      $('mPauseIcon') && ($('mPauseIcon').textContent = '▶️');
      $('mPauseLabel') && ($('mPauseLabel').textContent = 'RESUME');
      updateFlag('chequered');

      // Chequered Flag Finish & Results Notification
      if (multiplayerCtrl && multiplayerCtrl.inRace) {
        // Full-field finish handled authoritatively by multiplayerCtrl
      } else if (champCtrl && champCtrl.active) {
        champCtrl.handleRaceFinished();
      } else if (quickRaceCtrl) {
        quickRaceCtrl.handleRaceFinished();
      }
    }
  } else if (track && engine.state === RaceState.WAITING) {
    // When waiting for lights out, still update telemetry & gantry display
    const tel = engine.getTelemetry(state.selIdx);
    const selCar = engine.cars[state.selIdx];
    if (selCar) {
      updateTelemetry(tel, selCar.code, track.circuit.lengthM, selCar.d);
      updateTacticalHUD();
    }
  }

  // Update Authoritative Developer Telemetry Diagnostics Overlay (Phase 8)
  getDeveloperTelemetry()?.update();
}

// ── UI callbacks ─────────────────────────────────────────────────────────

function selectCar(idx, focusFollow = false) {
  state.selIdx = Math.max(0, Math.min(idx, engine.cars.length - 1));
  engine.setSelectedCar(state.selIdx);
  if (focusFollow) cam.setFollow();
  orderCarElements(sprites, scene, state.selIdx);
  syncCamUI();
  updateTacticalHUD();
  renderSidePanel();
  renderLeaderboard(engine.standings, state.selIdx, engine.totalLaps, selectCar);
}

function updateDraftPillDisplay(summary = null) {
  const label = $('draftPillLabel');
  if (!label) return;
  const draftEngine = getSharedDraftEngine();
  const sum = summary || draftEngine.getSummary();
  if (sum.driver) {
    const drv = sum.driver.code;
    const car = sum.car?.name?.split(' ').pop() || 'Car';
    const mgr = sum.manager?.name?.split(' ').pop() || 'Principal';
    label.innerHTML = `<span class="draft-pill-driver">${drv}</span> · <span class="draft-pill-tag">${car}</span> · <span class="draft-pill-tag">${mgr}</span>`;
  } else {
    label.textContent = 'DRAFT TEAM';
  }
}

function updateTacticalHUD() {
  const selCar = engine.cars[state.selIdx];
  if (!selCar) return;
  const label = $('tacticalDriver');
  if (label) {
    label.textContent = `${selCar.code} (${selCar.team}) · P${selCar.position}`;
  }
  const radioTag = $('radioDriverTag');
  if (radioTag) {
    radioTag.textContent = `${selCar.code} (${selCar.team})`;
  }
  const gantryTag = $('gantryDriverTag');
  if (gantryTag) {
    gantryTag.textContent = `${selCar.code} (P${selCar.position})`;
  }
}

function handleLaunch() {
  const res = engine.playerLaunch(performance.now());
  if (res.early) {
    const ev = { time: engine.simTime, msg: `⚠️ JUMP START: ${res.message}`, type: 'control' };
    logEvents([ev]);
    toastOverlay?.pushToast({
      category: 'penalty',
      headline: '⚠️ JUMP START DETECTED',
      detail: res.message,
      priority: 2,
      accent: 'red',
      icon: '⚠️'
    });
  } else if (res.reactionMs) {
    const driverCode = engine.cars[state.selIdx]?.code || 'DRIVER';
    const ev = {
      time: engine.simTime,
      msg: `🚀 ${driverCode} LAUNCHED in ${res.reactionMs} ms (${res.rating})!`,
      type: 'control'
    };
    logEvents([ev]);
    toastOverlay?.pushToast({
      category: 'start',
      headline: `${driverCode} LAUNCH: ${res.rating.toUpperCase()}!`,
      detail: `Reaction time: ${res.reactionMs} ms`,
      priority: 2,
      accent: 'green',
      icon: '🚀'
    });
  }

  // Completely remove/hide the launch button once user has reacted!
  if (res.reactionMs || res.alreadyLaunched) {
    const btn = $('btnLaunch');
    if (btn) {
      btn.classList.add('btn-launch-hidden');
      btn.style.display = 'none';
    }
    const bar = $('launchActionBar');
    if (bar) {
      bar.classList.add('launch-hidden');
      bar.style.display = 'none';
    }
  }
}

let lastDrsActionTime = 0;
function handleToggleDRS() {
  const now = Date.now();
  if (now - lastDrsActionTime < 250) {
    return; // Debounce rapid double-taps on touchscreens
  }
  lastDrsActionTime = now;
  const res = engine.toggleDRS(state.selIdx);
  if (!res.success) {
    logEvents([{
      time: engine.simTime,
      msg: `DRS Unavailable for ${engine.cars[state.selIdx]?.code}: ${res.reason}`,
      type: 'ai'
    }]);
  }
}

let lastBoxActionTime = 0;
function handleBox() {
  const now = Date.now();
  if (now - lastBoxActionTime < 250) {
    return; // Debounce rapid double-taps on touchscreens
  }
  lastBoxActionTime = now;
  const car = engine.cars[state.selIdx];
  if (!car) return;
  if (car.pitRequested) {
    const res = engine.cancelPit(state.selIdx);
    logEvents([{ time: engine.simTime, msg: res.message, type: 'pit' }]);
  } else {
    const res = engine.requestPit(state.selIdx, state.selectedCompound);
    logEvents([{ time: engine.simTime, msg: res.message, type: 'pit' }]);
  }
}

let lastBatteryActionTime = 0;
function handleToggleBattery() {
  const now = Date.now();
  if (now - lastBatteryActionTime < 250) {
    return; // Debounce
  }
  lastBatteryActionTime = now;
  const res = engine.toggleBatteryMode(state.selIdx);
  if (res && res.reason) {
    logEvents([{
      time: engine.simTime,
      msg: `⚡ Battery [${engine.cars[state.selIdx]?.code || 'P1'}]: ${res.reason}`,
      type: 'strategy'
    }]);
  }
}

function handleSetBatteryLevel(level) {
  const res = engine.setBatteryPowerLevel(level, state.selIdx);
  if (res) {
    logEvents([{
      time: engine.simTime,
      msg: `⚡ Battery Power Level set to LVL ${level} for ${engine.cars[state.selIdx]?.code || 'P1'}`,
      type: 'strategy'
    }]);
  }
}

function selectCompound(compound) {
  state.selectedCompound = compound.toLowerCase();
  document.querySelectorAll('#compoundSeg button').forEach(b => {
    b.classList.toggle('active', b.dataset.compound === state.selectedCompound);
  });
  const reasonEl = $('pitReasonTxt');
  if (reasonEl) {
    reasonEl.textContent = `Fitting ${state.selectedCompound.toUpperCase()} tyres on next stop`;
  }
}

function syncCamUI() {
  document.querySelectorAll('#viewSeg button').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.v === cam.mode)));
  $('chaseBtn')?.setAttribute('aria-pressed', String(cam.chase));
}

function renderChrome() {
  const c = track?.circuit;
  if (!c) return;
  $('circuitName') && ($('circuitName').textContent = c.name);
  $('circuitLoc')  && ($('circuitLoc').textContent  = c.loc);
  document.querySelectorAll('.tab').forEach(t =>
    t.setAttribute('aria-selected', String(t.dataset.id === state.circuitId)));
  document.querySelectorAll('#warpSeg button').forEach(b =>
    b.setAttribute('aria-pressed', String(+b.dataset.w === state.warp)));
  $('playBtn') && ($('playBtn').textContent = state.playing ? 'Pause' : 'Play');
  $('mPauseIcon') && ($('mPauseIcon').textContent = state.playing ? '⏸️' : '▶️');
  $('mPauseLabel') && ($('mPauseLabel').textContent = state.playing ? 'PAUSE' : 'RESUME');
  syncCamUI();
}

function renderSidePanel() {
  const c = track?.circuit, md = track?.speedModel;
  if (!c || !md) return;

  const st = md.straights.map((s, i) =>
    `<div class="row"><span class="k"><span class="num">${i+1}</span>~${Math.round(s.len/10)*10} m</span><span class="v">${Math.round(s.top)} km/h</span></div>`
  ).join('');

  const selCar = engine.cars[state.selIdx];
  const psych = selCar?.psychology;

  const sideInfo = $('sideInfo');
  if (!sideInfo) return;
  sideInfo.innerHTML = `
    ${psych ? `
      <div class="panel">
        <h2>Driver Track Profile &middot; ${selCar.code}</h2>
        <div class="row"><span class="k">Driver</span><span class="v">${selCar.name} (#${selCar.number})</span></div>
        <div class="row"><span class="k">Nationality</span><span class="v">${selCar.driver?.nationality || '–'} (${selCar.driver?.country || '–'})</span></div>
        <div class="row"><span class="k">Race Engineer</span><span class="v">${selCar.driver?.engineerName || 'Team Engineer'}</span></div>
        <div class="row"><span class="k">Home Race</span><span class="v ${psych.isHome ? 'green' : ''}">${psych.isHome ? 'YES — Home Crowd Support' : 'No'}</span></div>
        <div class="row"><span class="k">Track Record</span><span class="v ${psych.isPreviousWinner ? 'green' : ''}">${psych.isPreviousWinner ? `${psych.winsAtCircuit}x Circuit Victor` : 'No previous wins'}</span></div>
        <div class="row"><span class="k">Composure</span><span class="v">${Math.round(psych.composure * 100)}%</span></div>
        <div class="row"><span class="k">Starting Confidence</span><span class="v" style="color:var(--gold);font-weight:700">${Math.round(psych.confidence * 100)}%</span></div>
        ${psych.contextMessage ? `<div class="note" style="color:var(--gold);margin-top:6px"><strong>${psych.isHome ? '🏠' : '🏆'} ${psych.contextMessage}</strong></div>` : ''}
      </div>
    ` : ''}
    <div class="panel">
      <h2>Circuit facts</h2>
      <div class="row"><span class="k">Length</span><span class="v">${(c.lengthM/1000).toFixed(3)} km</span></div>
      <div class="row"><span class="k">Country</span><span class="v">${c.country || '–'} (${c.countryCode || '–'})</span></div>
      <div class="row"><span class="k">Race laps</span><span class="v">${engine.totalLaps}</span></div>
      <div class="row"><span class="k">Turns</span><span class="v">${c.turns}</span></div>
      <div class="row"><span class="k">DRS zones</span><span class="v">${c.drs}</span></div>
      <div class="row"><span class="k">Direction</span><span class="v">${c.direction}</span></div>
      <div class="row"><span class="k">Lap record</span><span class="v red">${fmtT(c.rec)}</span></div>
      <div class="row"><span class="k">Held by</span><span class="v">${c.who}, ${c.year}</span></div>
    </div>
    <div class="panel">
      <h2>Longest straights</h2>
      ${st || '<div class="note">No long straights detected.</div>'}
      <div class="note">Slowest corner: ~${Math.round(md.vmin * 3.6)} km/h (estimate).</div>
    </div>
    <div class="panel"><h2>Character</h2><div class="note">${c.note}</div></div>`;
}

// ── Mobile Navigation & Sidebar Drawer Wiring ──────────────────────────────

function initMobileControls() {
  const simHeader = $('simHeader');
  const btnNavToggle = $('btnNavToggle');
  btnNavToggle?.addEventListener('click', (e) => {
    e.stopPropagation();
    simHeader?.classList.toggle('nav-open');
  });

  // Close mobile nav when clicking any nav button or outside
  document.querySelectorAll('.f1-mode-nav-btn, .header-actions button, .header-actions select').forEach(btn => {
    btn.addEventListener('click', () => {
      simHeader?.classList.remove('nav-open');
    });
  });

  document.addEventListener('click', (e) => {
    if (simHeader?.classList.contains('nav-open') && !simHeader.contains(e.target)) {
      simHeader.classList.remove('nav-open');
    }
  });

  // Mobile Sidebar Toggle & Drawer
  const side = $('side');
  const sideBackdrop = $('sideBackdrop');
  const btnSideToggle = $('btnMobileSideToggle');
  const btnSideClose = $('btnSideMobileClose');

  function openMobileSide() {
    side?.classList.add('side-open');
    if (sideBackdrop) sideBackdrop.style.display = 'block';
  }

  function closeMobileSide() {
    side?.classList.remove('side-open');
    if (sideBackdrop) sideBackdrop.style.display = 'none';
  }

  btnSideToggle?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (side?.classList.contains('side-open')) {
      closeMobileSide();
    } else {
      openMobileSide();
    }
  });

  btnSideClose?.addEventListener('click', (e) => {
    e.stopPropagation();
    closeMobileSide();
  });

  sideBackdrop?.addEventListener('click', (e) => {
    e.stopPropagation();
    closeMobileSide();
  });
}

// ── Wiring ────────────────────────────────────────────────────────────────

function init() {
  // ── Compact Race Commentary Toast Overlay ──
  toastOverlay = new CommentaryToastManager($('commentaryToastOverlay'));
  if (typeof window !== 'undefined') {
    window.commentaryToastManager = toastOverlay;
  }

  // ── Central Persistent Player Investigation Notification Overlay ──
  investigationOverlay = new InvestigationOverlay($('centralInvestigationOverlay'));
  if (typeof window !== 'undefined') {
    window.investigationOverlay = investigationOverlay;
  }

  // ── Manual Battery Deployment & Hybrid ERS HUD ──
  initBatteryHUD({
    onToggleMode: () => handleToggleBattery(),
    onSelectLevel: (lvl) => handleSetBatteryLevel(lvl)
  });

  // ── Mobile Responsive Navigation & Sidebar Drawer Controls ──
  initMobileControls();

  // ── Authoritative Developer Diagnostics Telemetry Mode (Phase 8) ──
  initDeveloperTelemetry(engine, scene, track);

  $('toastOverlayBtn')?.addEventListener('click', () => {
    if (!toastOverlay) return;
    const isNowEnabled = toastOverlay.toggleEnabled();
    const btn = $('toastOverlayBtn');
    if (btn) {
      btn.textContent = isNowEnabled ? '💬 TOASTS: ON' : '💬 TOASTS: OFF';
      btn.style.opacity = isNowEnabled ? '1' : '0.6';
    }
  });

  // ── Championship Mode Controller Integration ──
  champCtrl = new ChampionshipUIController({
    engine,
    $,
    onStartChampionshipRace: ({ round, champ, prepSettings }) => {
      // Find driver objects in qualifying grid order
      const gridDrivers = round.grid.map(g => {
        const dObj = DRIVERS.find(d => d.code === g.driverCode);
        return dObj || {
          code: g.driverCode,
          name: g.name,
          team: g.team,
          color: g.color,
          teamColor: g.color,
          number: g.number,
          pace: 0.96,
          personality: { aggression: 0.7, consistency: 0.8, racecraft: 0.8, tyreManagement: 0.75, wetSkill: 0.75 }
        };
      });

      const playerIdx = gridDrivers.findIndex(d => d.code === champ.player.driverCode);
      const playerManager = champ.player.managerId ? getManager(champ.player.managerId) : null;
      const playerCarModel = champ.player.carId ? getCar(champ.player.carId) : null;

      state.circuitId = round.circuitId;
      state.gridSize = gridDrivers.length;
      state.playing = true;
      if (champCtrl) champCtrl.active = true;
      if (quickRaceCtrl) quickRaceCtrl.active = false;
      $('landingView') && ($('landingView').style.display = 'none');
      $('championshipMount') && ($('championshipMount').style.display = 'none');
      $('quickRaceMount') && ($('quickRaceMount').style.display = 'none');
      $('quickRaceFinishedBanner') && ($('quickRaceFinishedBanner').style.display = 'none');
      $('raceFinishedBanner') && ($('raceFinishedBanner').style.display = 'none');
      $('simHeader') && ($('simHeader').style.display = 'flex');
      $('simulatorView') && ($('simulatorView').style.display = 'block');
      $('navHome')?.classList.remove('active');
      $('navQuickPlay')?.classList.remove('active');
      $('navChampionship')?.classList.add('active');

      buildCircuit(round.circuitId, {
        totalLaps: round.laps,
        customGridDrivers: gridDrivers,
        playerCarIdx: playerIdx >= 0 ? playerIdx : 0,
        playerCarModel,
        playerManager,
        startingCompound: prepSettings?.startingCompound || 'medium',
        homeAdvantageEnabled: champ.rules.homeAdvantage ?? true,
        previousWinnerEnabled: champ.rules.previousWinnerConfidence ?? true,
        radioMode: champ.rules.teamRadioMode || getRadioSettings().mode,
        archivedHistory: champ.history,
        currentSeasonCalendar: champ.calendar,
        currentRoundIndex: champ.currentRoundIndex,
        autoStartSequence: true
      });
    },
    onSwitchToQuickPlay: () => {
      $('simulatorView') && ($('simulatorView').style.display = 'block');
      $('simHeader') && ($('simHeader').style.display = 'flex');
      buildCircuit(state.circuitId || 'monaco', { autoStartSequence: false });
    },
    onReturnHome: () => showLanding()
  });

  // ── Quick Race Mode Controller Integration ──
  quickRaceCtrl = new QuickRaceUIController({
    engine,
    $,
    onStartRace: (options) => {
      state.circuitId = options.circuitId || state.circuitId;
      state.gridSize = options.customGridDrivers?.length || state.gridSize;
      state.playing = true;
      $('landingView') && ($('landingView').style.display = 'none');
      $('championshipMount') && ($('championshipMount').style.display = 'none');
      $('quickRaceMount') && ($('quickRaceMount').style.display = 'none');
      $('quickRaceFinishedBanner') && ($('quickRaceFinishedBanner').style.display = 'none');
      $('raceFinishedBanner') && ($('raceFinishedBanner').style.display = 'none');
      $('simHeader') && ($('simHeader').style.display = 'flex');
      $('simulatorView') && ($('simulatorView').style.display = 'block');
      $('navHome')?.classList.remove('active');
      $('navChampionship')?.classList.remove('active');
      $('navQuickPlay')?.classList.add('active');
      champCtrl?.switchToQuickPlay();
      buildCircuit(state.circuitId, options);
    },
    onSwitchToChampionship: () => showChampionship(),
    onReturnHome: () => showLanding()
  });
  if (typeof window !== 'undefined') {
    window.quickRaceCtrl = quickRaceCtrl;
  }

  // ── Multiplayer Mode Controller Integration ──
  multiplayerCtrl = getSharedMultiplayerController({
    engine,
    $,
    onStartRace: (options) => {
      state.circuitId = options.circuitId || state.circuitId;
      state.gridSize = options.customGridDrivers?.length || state.gridSize;
      state.playing = true;
      state.rawWarp = 2;
      state.warp = options.warp ?? 2;
      engine.warp = state.warp;
      engine.isMultiplayer = true;
      document.body.classList.add('multiplayer-in-race');
      $('landingView') && ($('landingView').style.display = 'none');
      $('championshipMount') && ($('championshipMount').style.display = 'none');
      $('quickRaceMount') && ($('quickRaceMount').style.display = 'none');
      $('multiplayerMount') && ($('multiplayerMount').style.display = 'none');
      $('quickRaceFinishedBanner') && ($('quickRaceFinishedBanner').style.display = 'none');
      $('raceFinishedBanner') && ($('raceFinishedBanner').style.display = 'none');
      $('simHeader') && ($('simHeader').style.display = 'flex');
      $('simulatorView') && ($('simulatorView').style.display = 'block');
      buildCircuit(state.circuitId, {
        ...options,
        totalLaps: options.laps || 5,
        customGridDrivers: options.customGridDrivers,
        playerCarIdx: options.playerCarIdx || 0,
        isMultiplayer: true,
        warp: 2,
        autoStartSequence: true
      });
    },
    onReturnHome: () => showLanding()
  });

  // ── View Mode Switching (Landing Page, Quick Play, Championship, Multiplayer) ──
  function showLanding() {
    state.playing = false;
    document.body.classList.remove('multiplayer-in-race');
    if (engine) {
      engine.state = RaceState.WAITING;
      if (engine.launchManager) {
        engine.launchManager.reset(state.selIdx || 0);
      }
    }
    const gantry = $('gantryOverlay');
    if (gantry) {
      gantry.classList.add('gantry-hidden');
      gantry.style.display = 'none';
      for (let i = 0; i < 5; i++) {
        $(`gLight${i}`)?.classList.remove('lit');
      }
    }
    if (champCtrl) {
      champCtrl.active = false;
      champCtrl.hideModal();
      champCtrl.hideBanner();
      champCtrl.hideLiveHUD();
    }
    if (quickRaceCtrl) {
      quickRaceCtrl.active = false;
      quickRaceCtrl.hideModal();
      quickRaceCtrl.hideBanner();
    }
    $('landingView') && ($('landingView').style.display = 'block');
    $('simHeader') && ($('simHeader').style.display = 'none');
    $('simHeader')?.classList.remove('nav-open');
    $('simulatorView') && ($('simulatorView').style.display = 'none');
    $('championshipMount') && ($('championshipMount').style.display = 'none');
    $('raceFinishedBanner') && ($('raceFinishedBanner').style.display = 'none');
    $('quickRaceMount') && ($('quickRaceMount').style.display = 'none');
    $('quickRaceFinishedBanner') && ($('quickRaceFinishedBanner').style.display = 'none');
    $('draftModeMount') && ($('draftModeMount').style.display = 'none');
    $('multiplayerMount') && ($('multiplayerMount').style.display = 'none');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    getLandingAudio().play();
    const landing = getLandingPage({
      onStartQuickRace: () => showQuickPlay(true),
      onStartChampionship: () => showChampionship(),
      onStartDraftMode: () => showDraftMode(),
      onStartMultiplayer: () => showMultiplayer(),
      onOpenDraft: () => {
        const modal = getDraftModal({
          onConfirm: (summary) => {
            updateDraftPillDisplay(summary);
            landing.render();
          }
        });
        modal.open();
      },
      onOpenSettings: () => {
        $('settingsModal') && ($('settingsModal').style.display = 'flex');
      },
      onSelectCircuit: (cid) => {
        state.circuitId = cid;
        quickRaceCtrl?.manager?.updateConfig({ circuitId: cid });
        showQuickPlay(true);
      }
    });
    landing.render($('landingView'));
  }

  function showQuickPlay(openWizard = true) {
    try { getLandingPage()?.destroy(); } catch (_) {}
    // Soundtrack plays until race start lights appear on the gantry
    if (getLandingAudio().isEnabled && !getLandingAudio().isPlaying && getLandingAudio().canPlay()) {
      getLandingAudio().play();
    }
    $('landingView') && ($('landingView').style.display = 'none');
    $('championshipMount') && ($('championshipMount').style.display = 'none');
    $('simHeader') && ($('simHeader').style.display = 'flex');
    $('simulatorView') && ($('simulatorView').style.display = 'block');
    $('navHome')?.classList.remove('active');
    $('navChampionship')?.classList.remove('active');
    $('navQuickPlay')?.classList.add('active');
    champCtrl?.switchToQuickPlay();
    if (openWizard && quickRaceCtrl) {
      quickRaceCtrl.openEntryPortal();
    }
  }

  function showChampionship() {
    try { getLandingPage()?.destroy(); } catch (_) {}
    // Soundtrack plays until race start lights appear on the gantry
    if (getLandingAudio().isEnabled && !getLandingAudio().isPlaying && getLandingAudio().canPlay()) {
      getLandingAudio().play();
    }
    quickRaceCtrl?.hideModal();
    quickRaceCtrl?.hideBanner();
    if (quickRaceCtrl) quickRaceCtrl.active = false;
    $('landingView') && ($('landingView').style.display = 'none');
    $('simulatorView') && ($('simulatorView').style.display = 'none');
    $('quickRaceMount') && ($('quickRaceMount').style.display = 'none');
    $('quickRaceFinishedBanner') && ($('quickRaceFinishedBanner').style.display = 'none');
    $('raceFinishedBanner') && ($('raceFinishedBanner').style.display = 'none');
    $('simHeader') && ($('simHeader').style.display = 'none');
    $('simHeader')?.classList.remove('nav-open');
    $('championshipMount') && ($('championshipMount').style.display = 'block');
    $('navHome')?.classList.remove('active');
    $('navQuickPlay')?.classList.remove('active');
    $('navChampionship')?.classList.add('active');
    champCtrl?.switchToChampionshipMode();
  }

  function showDraftMode() {
    try { getLandingPage()?.destroy(); } catch (_) {}
    // Keep soundtrack playing during draft mode
    if (getLandingAudio().isEnabled && !getLandingAudio().isPlaying && getLandingAudio().canPlay()) {
      getLandingAudio().play();
    }
    quickRaceCtrl?.hideModal();
    quickRaceCtrl?.hideBanner();
    if (quickRaceCtrl) quickRaceCtrl.active = false;
    $('landingView') && ($('landingView').style.display = 'none');
    $('simulatorView') && ($('simulatorView').style.display = 'none');
    $('quickRaceMount') && ($('quickRaceMount').style.display = 'none');
    $('quickRaceFinishedBanner') && ($('quickRaceFinishedBanner').style.display = 'none');
    $('raceFinishedBanner') && ($('raceFinishedBanner').style.display = 'none');
    $('championshipMount') && ($('championshipMount').style.display = 'none');
    $('simHeader') && ($('simHeader').style.display = 'none');
    $('draftModeMount') && ($('draftModeMount').style.display = 'block');
    window.scrollTo({ top: 0, behavior: 'smooth' });

    const draftMode = getDraftModeController();
    draftMode.show($('draftModeMount'), {
      onBack: () => showLanding(),
      onConfirm: (summary) => {
        // Apply historical draft choices into Quick Race engine
        const eng = getSharedDraftEngine();
        if (summary.driver) eng.selectedDriverId = summary.driver.code;
        if (summary.manager) eng.selectedManagerId = summary.manager.id;
        if (summary.car) eng.selectedCarId = summary.car.id;
        eng.persist();
        updateDraftPillDisplay(summary);
        $('draftModeMount') && ($('draftModeMount').style.display = 'none');
        showQuickPlay(true);
      }
    });
  }

  function showMultiplayer() {
    try { getLandingPage()?.destroy(); } catch (_) {}
    if (getLandingAudio().isEnabled && !getLandingAudio().isPlaying && getLandingAudio().canPlay()) {
      getLandingAudio().play();
    }
    quickRaceCtrl?.hideModal();
    quickRaceCtrl?.hideBanner();
    if (quickRaceCtrl) quickRaceCtrl.active = false;
    $('landingView') && ($('landingView').style.display = 'none');
    $('simulatorView') && ($('simulatorView').style.display = 'none');
    $('quickRaceMount') && ($('quickRaceMount').style.display = 'none');
    $('quickRaceFinishedBanner') && ($('quickRaceFinishedBanner').style.display = 'none');
    $('raceFinishedBanner') && ($('raceFinishedBanner').style.display = 'none');
    $('championshipMount') && ($('championshipMount').style.display = 'none');
    $('draftModeMount') && ($('draftModeMount').style.display = 'none');
    $('multiplayerMount') && ($('multiplayerMount').style.display = 'block');
    $('simHeader') && ($('simHeader').style.display = 'flex');
    $('navHome')?.classList.remove('active');
    $('navQuickPlay')?.classList.remove('active');
    $('navChampionship')?.classList.remove('active');
    $('navMultiplayer')?.classList.add('active');
    multiplayerCtrl?.openHub();
  }

  // Navigation handlers
  $('navHome')?.addEventListener('click', showLanding);
  $('brandLogoHome')?.addEventListener('click', showLanding);
  $('btnRaceExitMenu')?.addEventListener('click', showLanding);
  $('navQuickPlay')?.addEventListener('click', () => showQuickPlay(true));
  $('navChampionship')?.addEventListener('click', showChampionship);
  $('navMultiplayer')?.addEventListener('click', showMultiplayer);

  // Draft Team Modal trigger in Quick Race bar
  $('btnDraftTeam')?.addEventListener('click', () => {
    const modal = getDraftModal({
      onConfirm: (summary) => {
        updateDraftPillDisplay(summary);
        buildCircuit(state.circuitId);
      }
    });
    modal.open();
  });

  // Circuit tabs
  const tabs = $('tabs');
  if (tabs) {
    CIRCUITS.forEach(c => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'tab'; b.dataset.id = c.id; b.textContent = c.short;
      b.onclick = () => buildCircuit(c.id);
      tabs.appendChild(b);
    });
  }

  // Grid size selector
  const gridSel = $('gridSel');
  if (gridSel) {
    DRIVERS.forEach((d, i) => {
      const n = i + 1;
      const opt = document.createElement('option');
      opt.value = n; opt.textContent = n + ' cars';
      if (n === state.gridSize) opt.selected = true;
      gridSel.appendChild(opt);
    });
    gridSel.onchange = () => { state.gridSize = +gridSel.value; buildCircuit(state.circuitId); };
  }

  // Play / pause
  $('playBtn')?.addEventListener('click', () => {
    if (multiplayerCtrl && multiplayerCtrl.inRace) return;
    if (engine.state === RaceState.FINISHED) {
      if (quickRaceCtrl && quickRaceCtrl.active) {
        quickRaceCtrl.restartRace();
      } else {
        buildCircuit(state.circuitId);
      }
      return;
    }
    state.playing = !state.playing;
    $('playBtn').textContent = state.playing ? 'Pause' : 'Play';
    $('mPauseIcon') && ($('mPauseIcon').textContent = state.playing ? '⏸️' : '▶️');
    $('mPauseLabel') && ($('mPauseLabel').textContent = state.playing ? 'PAUSE' : 'RESUME');
  });

  // Restart
  $('restartBtn')?.addEventListener('click', () => {
    if (multiplayerCtrl && multiplayerCtrl.inRace) return;
    if (quickRaceCtrl && quickRaceCtrl.active) {
      quickRaceCtrl.restartRace();
    } else {
      buildCircuit(state.circuitId);
    }
  });

  // Warp
  $('warpSeg')?.addEventListener('click', e => {
    if (multiplayerCtrl && multiplayerCtrl.inRace) return;
    const b = e.target.closest('button');
    if (!b) return;
    const rawW = +b.dataset.w;
    state.rawWarp = rawW;
    state.warp = WARP_RATES[rawW] || rawW;
    document.querySelectorAll('#warpSeg button').forEach(x =>
      x.setAttribute('aria-pressed', String(x === b)));
  });

  // Track colour mode
  $('modeSeg')?.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    state.mode = b.dataset.m;
    applyTrackMode(scene, state.mode);
    document.querySelectorAll('#modeSeg button').forEach(x =>
      x.setAttribute('aria-pressed', String(x.dataset.m === state.mode)));
    updateLegend();
  });

  // Camera
  $('viewSeg')?.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    cam.mode = b.dataset.v;
    syncCamUI();
  });
  $('chaseBtn')?.addEventListener('click', () => { cam.toggleChase(); syncCamUI(); });
  $('zIn')?.addEventListener('click',    () => cam.zoom(1));
  $('zOut')?.addEventListener('click',   () => cam.zoom(-1));
  $('zHome')?.addEventListener('click',  () => { cam.setOverview(); syncCamUI(); });

  // ── Launch Challenge Button ──
  $('btnLaunch')?.addEventListener('click', handleLaunch);

  // ── Tactical DRS & Pit Stop controls ──
  $('btnDrs')?.addEventListener('click', handleToggleDRS);
  $('btnBox')?.addEventListener('click', handleBox);
  $('compoundSeg')?.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b?.dataset.compound) {
      selectCompound(b.dataset.compound);
    }
  });

  // ── Mobile Sticky Race Control Dock (Touch & Click Support) ──
  $('mBtnDrs')?.addEventListener('click', handleToggleDRS);
  $('mBtnDrs')?.addEventListener('touchend', e => {
    e.preventDefault();
    handleToggleDRS();
  }, { passive: false });

  $('mBtnBox')?.addEventListener('click', handleBox);
  $('mBtnBox')?.addEventListener('touchend', e => {
    e.preventDefault();
    handleBox();
  }, { passive: false });

  $('mBtnBattery')?.addEventListener('click', handleToggleBattery);
  $('mBtnBattery')?.addEventListener('touchend', e => {
    e.preventDefault();
    handleToggleBattery();
  }, { passive: false });

  $('mBtnPause')?.addEventListener('click', () => {
    $('playBtn')?.click();
  });
  $('mBtnPause')?.addEventListener('touchend', e => {
    e.preventDefault();
    $('playBtn')?.click();
  }, { passive: false });

  // ── Dynamic Weather Controls (Pre-session / General Scenario) ──
  $('weatherPresetSel')?.addEventListener('change', e => {
    engine.setWeatherPreset(e.target.value);
  });

  // ── Team Radio Controls & Interactive Actions ──
  setRadioActionCallback(action => {
    if (action.type === 'box') {
      if (action.compound) {
        selectCompound(action.compound);
      }
      handleBox();
    }
  });

  $('radioFilterTabs')?.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    document.querySelectorAll('#radioFilterTabs button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    setRadioFilter(btn.dataset.cat);
  });

  $('radioModeSelector')?.addEventListener('click', e => {
    const btn = e.target.closest('button[data-mode]');
    if (!btn) return;
    const mode = btn.dataset.mode;
    updateRadioSettings({ mode });
    engine.setRadioMode(mode);
  });

  $('radioSoundBtn')?.addEventListener('click', () => {
    const cur = getRadioSettings();
    updateRadioSettings({ soundEnabled: !cur.soundEnabled });
  });

  $('radioVoiceBtn')?.addEventListener('click', () => {
    const cur = getRadioSettings();
    updateRadioSettings({ voiceEnabled: !cur.voiceEnabled });
  });

  renderRadioControls();
  initSettingsModal();

  // Leaderboard click
  $('side')?.addEventListener('click', e => {
    const r = e.target.closest('.lrow');
    if (r) selectCar(+r.dataset.i, true);
  });

  // Mouse wheel zoom
  $('map')?.addEventListener('wheel', e => { e.preventDefault(); cam.zoom(e.deltaY < 0 ? 1 : -1); }, { passive: false });

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) {
        const lState = engine.launchManager?.state;
        if (lState && lState !== 'racing' && !engine.launchManager?.playerReacted) {
          handleLaunch();
        } else {
          if (!multiplayerCtrl?.inRace) {
            $('playBtn')?.click();
          }
        }
      }
    }
    if (e.code === 'KeyR')  {
      if (!multiplayerCtrl?.inRace) $('restartBtn')?.click();
    }
    if (e.code === 'KeyD')  { e.preventDefault(); handleToggleDRS(); }
    if (e.code === 'KeyB')  { e.preventDefault(); handleBox(); }
    if (e.code === 'KeyE')  { e.preventDefault(); handleToggleBattery(); }
    if (e.code === 'Equal' || e.code === 'NumpadAdd')    cam.zoom(1);
    if (e.code === 'Minus' || e.code === 'NumpadSubtract') cam.zoom(-1);
    if (e.code === 'Digit1') {
      if (e.shiftKey) { e.preventDefault(); handleSetBatteryLevel(1); }
      else cam.mode = 'overview';
    }
    if (e.code === 'Digit2') {
      if (e.shiftKey) { e.preventDefault(); handleSetBatteryLevel(2); }
      else cam.mode = 'follow';
    }
    if (e.code === 'Digit3') {
      if (e.shiftKey) { e.preventDefault(); handleSetBatteryLevel(3); }
      else cam.toggleChase();
    }
  });

  // Theme toggle
  $('themeBtn')?.addEventListener('click', () => {
    const r = document.documentElement, t = r.getAttribute('data-theme');
    r.setAttribute('data-theme',
      t ? (t === 'dark' ? 'light' : 'dark')
        : (matchMedia('(prefers-color-scheme: dark)').matches ? 'light' : 'dark'));
  });

  // Reduced motion
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) state.playing = false;

  updateLegend();
  buildCircuit('monaco', { autoStartSequence: false });
  if (engine?.launchManager) {
    engine.launchManager.onLightsStart = () => {
      getLandingAudio().pause(true);
    };
  }
  requestAnimationFrame(frame);
  showLanding();
}

function initSettingsModal() {
  const modal = $('settingsModal');
  const btnOpenHeader = $('btnOpenSettings');
  const btnOpenRadio = $('radioSettingsBtn');
  const btnClose = $('btnCloseSettings');
  const btnBack = $('btnBackSettings');
  const btnSaveClose = $('btnSaveCloseSettings');

  const voiceSel = $('settingVoiceSelect');
  const rateSlider = $('settingVoiceRate');
  const rateVal = $('settingVoiceRateVal');
  const volSlider = $('settingVoiceVolume');
  const volVal = $('settingVoiceVolumeVal');
  const pitchSlider = $('settingVoicePitch');
  const pitchVal = $('settingVoicePitchVal');
  const styleSel = $('settingVoiceStyle');
  const voiceEnabledCheck = $('settingVoiceEnabled');
  const squelchCheck = $('settingSquelchEnabled');
  const btnPreview = $('btnPreviewVoice');
  const btnReset = $('btnResetVoiceDefaults');
  const btnMute = $('btnMuteActiveRadio');
  const providerNote = $('settingVoiceProviderNote');

  function populateVoices() {
    if (!voiceSel) return;
    const voices = getAvailableVoices();
    const curSettings = getVoiceSettings();

    if (!voices || !voices.length) {
      voiceSel.innerHTML = '<option value="">Standard Browser Voice (Synthesizer Default)</option>';
      if (providerNote) {
        providerNote.textContent = 'Voice list initializing or unavailable in this browser. Using standard default TTS voice.';
      }
      return;
    }

    if (providerNote) {
      providerNote.textContent = `Found ${voices.length} system voices from Web Speech API. Availability is determined by OS and browser.`;
    }

    voiceSel.innerHTML = voices.map(v => {
      const isSel = (v.voiceURI === curSettings.voiceURI || v.name === curSettings.voiceName);
      return `<option value="${v.voiceURI}" ${isSel ? 'selected' : ''}>${v.name} (${v.lang || 'default'})</option>`;
    }).join('');
  }

  function syncUIFromSettings() {
    const s = getVoiceSettings();
    if (voiceEnabledCheck) voiceEnabledCheck.checked = !!s.voiceEnabled;
    if (rateSlider) {
      rateSlider.value = s.speed || 1.05;
      if (rateVal) rateVal.textContent = `${(s.speed || 1.05).toFixed(2)}x`;
    }
    if (volSlider) {
      volSlider.value = s.volume || 0.85;
      if (volVal) volVal.textContent = `${Math.round((s.volume || 0.85) * 100)}%`;
    }
    if (pitchSlider) {
      pitchSlider.value = s.pitch || 0.95;
      if (pitchVal) pitchVal.textContent = (s.pitch || 0.95).toFixed(2);
    }
    if (styleSel) styleSel.value = s.style || 'adaptive';
    if (squelchCheck) squelchCheck.checked = !!s.squelchEnabled;
    populateVoices();
  }

  function openSettings() {
    syncUIFromSettings();
    if (modal) modal.style.display = 'flex';
  }

  function closeSettings() {
    if (modal) modal.style.display = 'none';
  }

  btnOpenHeader?.addEventListener('click', openSettings);
  btnOpenRadio?.addEventListener('click', openSettings);
  btnClose?.addEventListener('click', closeSettings);
  btnBack?.addEventListener('click', closeSettings);
  btnSaveClose?.addEventListener('click', closeSettings);

  modal?.addEventListener('click', e => {
    if (e.target === modal) closeSettings();
  });

  voiceEnabledCheck?.addEventListener('change', e => {
    updateVoiceSettings({ voiceEnabled: e.target.checked });
  });

  voiceSel?.addEventListener('change', e => {
    const val = e.target.value;
    const voices = getAvailableVoices();
    const match = voices.find(v => v.voiceURI === val);
    updateVoiceSettings({
      voiceURI: val,
      voiceName: match ? match.name : val,
      voiceLang: match ? match.lang : 'en'
    });
  });

  rateSlider?.addEventListener('input', e => {
    const spd = parseFloat(e.target.value);
    if (rateVal) rateVal.textContent = `${spd.toFixed(2)}x`;
    updateVoiceSettings({ speed: spd });
  });

  volSlider?.addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    if (volVal) volVal.textContent = `${Math.round(v * 100)}%`;
    updateVoiceSettings({ volume: v });
  });

  pitchSlider?.addEventListener('input', e => {
    const p = parseFloat(e.target.value);
    if (pitchVal) pitchVal.textContent = p.toFixed(2);
    updateVoiceSettings({ pitch: p });
  });

  styleSel?.addEventListener('change', e => {
    updateVoiceSettings({ style: e.target.value });
  });

  squelchCheck?.addEventListener('change', e => {
    updateVoiceSettings({ squelchEnabled: e.target.checked });
  });

  btnPreview?.addEventListener('click', () => {
    previewVoice('Box this lap, confirm box. Fresh tyres are ready.');
  });

  btnReset?.addEventListener('click', () => {
    resetVoiceDefaults();
    syncUIFromSettings();
  });

  btnMute?.addEventListener('click', () => {
    muteRadioVoice();
    syncUIFromSettings();
  });

  if (typeof window !== 'undefined' && window.speechSynthesis) {
    try {
      window.speechSynthesis.onvoiceschanged = () => {
        populateVoices();
      };
    } catch (_) {}
  }
  syncUIFromSettings();
}

function updateLegend() {
  const legend = $('legend');
  if (!legend) return;
  legend.innerHTML = state.mode === 'real'
    ? '<span class="lg">Click a driver to follow. Space = Launch / Pause, D = DRS, B = Box, R = Restart.</span>'
    : (state.mode === 'sector'
      ? '<span class="lg"><i class="sw" style="background:var(--s1)"></i>S1</span><span class="lg"><i class="sw" style="background:var(--s2)"></i>S2</span><span class="lg"><i class="sw" style="background:var(--s3)"></i>S3</span>'
      : '<span class="lg">Slow<i class="ramp"></i>Fast</span>')
    + '<span class="lg"><i class="sw" style="background:var(--straight)"></i>Longest straights</span>';
}

// Start (only in browser environment)
if (typeof document !== 'undefined') {
  init();
}
