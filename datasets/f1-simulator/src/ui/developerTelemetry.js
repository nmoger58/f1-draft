/**
 * developerTelemetry.js
 * Authoritative Developer Racing Diagnostics & Live Telemetry Inspector (Phase 8 Extension).
 *
 * Keeps developer telemetry completely separate from the normal player HUD.
 * Exposes live physical vehicle dynamics, kinematic braking calculations,
 * out-in-out racing lines, nearby conflict predictions (TTC),
 * dynamic 24-sector moisture/rubber grip evolution, ERS battery power,
 * predictive pit strategy decisions, and an interactive SVG visual debug overlay.
 *
 * Visual Debug Layers:
 *   - Track centerline & physical boundaries
 *   - Usable road corridor
 *   - Reference dynamic racing line
 *   - Selected AI trajectory
 *   - Alternative candidate passing paths
 *   - Car footprints & predicted positions (1s, 2s, 3s horizons)
 *   - Collision-risk hazard regions & TTC indicators
 *   - Track-limit violations & kerb contact
 *
 * Keybindings:
 *   - Backtick (`) or Tilde (~)
 *   - F2 key
 *   - UI button in header: [🛠️ DEV]
 */

import { sampleTrack } from '../simulation/trackManager.js';
import { SimConfig } from '../config/simulationConfig.js';
import { getSharedMultiplayerController } from '../multiplayer/multiplayerUIController.js';

const STORAGE_KEY_DEBUG_LAYERS = 'f1_dev_debug_layers';

export const DEFAULT_DEBUG_LAYERS = {
  centerline: false,
  boundaries: false,
  corridor: false,
  referenceLine: true,
  selectedTrajectory: true,
  candidatePaths: true,
  footprints: true,
  collisionRisk: true,
  trackLimits: true
};

const LAYER_CONFIG = [
  { id: 'centerline', label: 'Centerline', color: '#ffffff' },
  { id: 'boundaries', label: 'Boundaries', color: '#ff7675' },
  { id: 'corridor', label: 'Usable Corridor', color: '#00cec9' },
  { id: 'referenceLine', label: 'Ref Line', color: '#a29bfe' },
  { id: 'selectedTrajectory', label: 'AI Trajectory', color: '#00ff88' },
  { id: 'candidatePaths', label: 'Candidates', color: '#ffa502' },
  { id: 'footprints', label: 'Footprints', color: '#fdcb6e' },
  { id: 'collisionRisk', label: 'Collision Risk', color: '#ff4757' },
  { id: 'trackLimits', label: 'Track Limits', color: '#ff3838' }
];

/**
 * Maps track Frenet coordinates (d, lat) to world SVG (x, y) coordinates.
 */
export function trackToWorld(track, d, lat = 0) {
  if (!track || !track.pts || track.pts.length === 0) {
    return { x: 0, y: 0, cx: 0, cy: 0, nx: 0, ny: 0, heading: 0, halfWidth: 13.5, usableHalfWidth: 11.5 };
  }
  const sample = sampleTrack(track, d);
  const pts = track.pts;
  const N = pts.length;
  const a = pts[sample.i];
  const b = pts[(sample.i + 1) % N];
  const nx = -Math.sin(sample.heading);
  const ny = Math.cos(sample.heading);
  const cx = a[0] + (b[0] - a[0]) * sample.fr;
  const cy = a[1] + (b[1] - a[1]) * sample.fr;
  return {
    x: cx + nx * lat,
    y: cy + ny * lat,
    cx,
    cy,
    nx,
    ny,
    heading: sample.heading,
    halfWidth: sample.halfWidth,
    usableHalfWidth: sample.usableHalfWidth
  };
}

export class DeveloperTelemetryManager {
  constructor() {
    this.isOpen = false;
    this.selectedCarIndex = 0;
    this.engine = null;
    this.scene = null;
    this.track = null;
    this.container = null;
    this._lastRenderTime = 0;
    this._boundKeyHandler = this._handleKeyDown.bind(this);
    this.debugLayers = this._loadLayerPreferences();
  }

  /**
   * Initialise the developer telemetry manager.
   * @param {object} engine - RaceEngine instance
   * @param {object} [scene=null] - SVG scene container refs
   * @param {object} [track=null] - Track geometry model
   */
  init(engine, scene = null, track = null) {
    this.engine = engine;
    this.scene = scene;
    this.track = track;
    this.selectedCarIndex = engine?.selectedCarIdx ?? 0;
    this._ensureDOM();
    this._attachEventListeners();
  }

  /**
   * Update engine, scene, and track references on circuit or session restart.
   */
  setEngine(engine, scene = null, track = null) {
    this.engine = engine;
    if (scene) this.scene = scene;
    if (track) this.track = track;
    if (engine && engine.cars && engine.cars.length > 0) {
      this.selectedCarIndex = Math.min(this.selectedCarIndex, engine.cars.length - 1);
    }
    this._populateCarSelect();
  }

  /**
   * Toggle developer diagnostics overlay open/closed.
   */
  toggle() {
    this.isOpen = !this.isOpen;
    if (this.container) {
      if (this.isOpen) {
        this.container.classList.remove('hidden');
        this.container.style.display = 'block';
        if (this.scene?.devDebugOverlay) {
          this.scene.devDebugOverlay.setAttribute('visibility', 'visible');
        }
        this.update(true);
      } else {
        this.container.classList.add('hidden');
        this.container.style.display = 'none';
        if (this.scene?.devDebugOverlay) {
          this.scene.devDebugOverlay.setAttribute('visibility', 'hidden');
          this.scene.devDebugOverlay.innerHTML = '';
        }
      }
    }

    if (typeof document !== 'undefined') {
      const btn = document.getElementById('devTelemetryBtn');
      if (btn) {
        btn.classList.toggle('active', this.isOpen);
      }
    }
  }

  /**
   * Update the telemetry display if open.
   * Throttled to ~15 Hz to ensure zero impact on simulation framerate.
   * @param {boolean} [force=false]
   */
  update(force = false) {
    if (!this.isOpen && !force) return;
    if (!this.engine || !this.engine.cars || this.engine.cars.length === 0) return;

    const now = performance.now();
    if (!force && (now - this._lastRenderTime) < 65) {
      return; // Cap at ~15 updates per second
    }
    this._lastRenderTime = now;

    const data = this.engine.getDeveloperTelemetry(this.selectedCarIndex);
    if (!data) return;

    this._renderData(data);

    if (this.scene?.devDebugOverlay && this.track) {
      this._renderDebugOverlay(data);
    }
  }

  /**
   * Ensure container DOM exists in the document.
   * @private
   */
  _ensureDOM() {
    if (typeof document === 'undefined') return;
    let el = document.getElementById('devTelemetryOverlay');
    if (!el) {
      el = document.createElement('div');
      el.id = 'devTelemetryOverlay';
      el.className = 'dev-telemetry-overlay hidden';
      document.body.appendChild(el);
    }
    this.container = el;
    this._renderShell();
  }

  /**
   * Render initial layout shell, header, and debug layers toolbar.
   * @private
   */
  _renderShell() {
    if (!this.container) return;

    this.container.innerHTML = `
      <div class="dev-tel-panel">
        <div class="dev-tel-header">
          <div class="dev-tel-title">
            <span class="dev-tel-badge">DEV DIAGNOSTICS</span>
            <span class="dev-tel-name">Racing Diagnostics & AI Decision Telemetry</span>
          </div>
          <div class="dev-tel-controls">
            <label for="devTelCarSelect" class="dev-tel-label">INSPECT CAR:</label>
            <select id="devTelCarSelect" class="dev-tel-select"></select>
            <button type="button" class="dev-tel-btn" id="btnDevCopySnapshot" title="Copy full telemetry JSON to clipboard">📋 SNAPSHOT</button>
            <button type="button" class="dev-tel-close" id="btnDevTelClose" title="Close Developer Telemetry [~]">✕</button>
          </div>
        </div>

        <div class="dev-debug-toolbar" id="devDebugToolbar">
          <span class="dev-debug-toolbar-label">DEBUG LAYERS:</span>
          <!-- Dynamic layer toggle chips -->
        </div>

        <div class="dev-tel-grid" id="devTelGrid">
          <!-- Live cards injected dynamically -->
        </div>
      </div>
    `;

    this._renderToolbar();
    this._populateCarSelect();

    const carSel = document.getElementById('devTelCarSelect');
    if (carSel) {
      carSel.addEventListener('change', (e) => {
        this.selectedCarIndex = parseInt(e.target.value, 10) || 0;
        this.update(true);
      });
    }

    const copyBtn = document.getElementById('btnDevCopySnapshot');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => this._copySnapshot());
    }

    const closeBtn = document.getElementById('btnDevTelClose');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.toggle());
    }
  }

  /**
   * Render layer toggle chips in toolbar.
   * @private
   */
  _renderToolbar() {
    const toolbar = document.getElementById('devDebugToolbar');
    if (!toolbar) return;

    toolbar.innerHTML = `
      <span class="dev-debug-toolbar-label">DEBUG LAYERS:</span>
      ${LAYER_CONFIG.map(layer => {
        const isActive = !!this.debugLayers[layer.id];
        return `
          <button type="button"
            class="dev-layer-chip ${isActive ? 'active' : ''}"
            data-layer="${layer.id}"
            style="${isActive ? `border-color: ${layer.color}; color: #ffffff; background: rgba(255,255,255,0.12);` : ''}"
            title="Toggle ${layer.label} visual debug layer">
            <span class="layer-dot" style="background: ${layer.color};"></span>
            ${layer.label}
          </button>
        `;
      }).join('')}
    `;

    toolbar.querySelectorAll('.dev-layer-chip').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const layerId = btn.getAttribute('data-layer');
        if (layerId && this.debugLayers.hasOwnProperty(layerId)) {
          this.debugLayers[layerId] = !this.debugLayers[layerId];
          this._saveLayerPreferences();
          this._renderToolbar();
          this.update(true);
        }
      });
    });
  }

  /**
   * Populate car dropdown with active grid drivers.
   * @private
   */
  _populateCarSelect() {
    if (typeof document === 'undefined') return;
    const sel = document.getElementById('devTelCarSelect');
    if (!sel || !this.engine || !this.engine.cars) return;

    const currentVal = this.selectedCarIndex;
    sel.innerHTML = '';
    this.engine.cars.forEach((c, idx) => {
      const opt = document.createElement('option');
      opt.value = idx;
      opt.textContent = `P${c.position || (idx + 1)} · ${c.code} (${c.team || 'Car'})`;
      if (idx === currentVal) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  /**
   * Render live cards with telemetry data and explicit value classification badges.
   * @private
   */
  _renderData(d) {
    if (typeof document === 'undefined') return;
    const grid = document.getElementById('devTelGrid');
    if (!grid) return;

    const sel = document.getElementById('devTelCarSelect');
    if (sel && sel.options.length !== this.engine.cars.length) {
      this._populateCarSelect();
    }

    // AI state style map
    const aiStateClass = {
      FOLLOWING: 'state-following',
      APPROACHING: 'state-approaching',
      ATTACKING: 'state-attacking',
      DEFENDING: 'state-defending',
      SIDE_BY_SIDE: 'state-side-by-side',
      ABORTING: 'state-aborting',
      RECOVERING: 'state-recovering'
    }[d.aiState] || 'state-following';

    // Threat & overtaking badge classes
    const threatClass = d.threatSeverity === 'CRITICAL' ? 'tel-val-crit' : (d.threatSeverity === 'WARNING' ? 'tel-val-warn' : 'tel-val-ok');
    const otBadgeClass = d.overtakingState === 'VIABLE_OPPORTUNITY' ? 'badge-attack' : (d.overtakingState === 'POTENTIAL_OPPORTUNITY' ? 'badge-pursuit' : 'badge-neutral');
    const pitActionClass = d.strategyAction === 'PIT_THIS_LAP' ? 'tel-val-crit' : 'tel-val-ok';

    // Track limits pill
    const trackLimitBadge = d.isTrackLimitViolation
      ? `<span class="dev-badge badge-attack">⚠️ VIOLATION</span>`
      : (d.isOnKerb ? `<span class="dev-badge badge-outside">KERB</span>` : `<span class="dev-badge badge-pursuit">LEGAL</span>`);

    // Candidate Paths Table HTML
    let candidatePathsHtml = '';
    if (d.candidatePaths && d.candidatePaths.length > 0) {
      candidatePathsHtml = `
        <table class="dev-cand-table">
          <thead>
            <tr>
              <th>Path</th>
              <th>Room (m)</th>
              <th>Status</th>
              <th>Score</th>
              <th>Rationale</th>
            </tr>
          </thead>
          <tbody>
            ${d.candidatePaths.map(p => {
              const isSelected = p.name === d.selectedPassingLine;
              const statusClass = p.isFeasible ? 'tel-val-ok' : 'tel-val-warn';
              return `
                <tr class="${isSelected ? 'dev-cand-selected' : ''}">
                  <td style="font-weight: ${isSelected ? '700' : '500'};">${isSelected ? '▶ ' : ''}${p.name}</td>
                  <td>${p.roomM}m</td>
                  <td class="${statusClass}">${p.isFeasible ? 'FEASIBLE' : 'BLOCKED'}</td>
                  <td>${p.score}</td>
                  <td style="font-size: 10px; color: #a4b0be;">${p.rationale}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      `;
    } else {
      candidatePathsHtml = `<div class="dev-val tel-mono" style="font-size:11px; color:#747d8c;">No alternative passing paths evaluated (clean air or single line)</div>`;
    }

    grid.innerHTML = `
      <!-- Card 1: Authoritative Vehicle Dynamics & Controls -->
      <div class="dev-card">
        <div class="dev-card-head">
          <span>🏎️ VEHICLE DYNAMICS & CONTROLS</span>
          <span class="dev-tag">${d.driverCode} (P${d.position})</span>
        </div>
        <div class="dev-metrics-list">
          <div class="dev-metric">
            <span class="dev-lbl">Velocity / Target: <span class="badge-meas">MEASURED</span></span>
            <span class="dev-val tel-mono">${d.speedKph} km/h <span class="dev-sub">(${d.speedMps} m/s)</span> · tgt ${d.targetSpeedKph} km/h</span>
          </div>
          <div class="dev-metric">
            <span class="dev-lbl">Acc (Long / Lat): <span class="badge-meas">MEASURED</span></span>
            <span class="dev-val tel-mono">${d.accMps2 > 0 ? '+' : ''}${d.accMps2} m/s² <span class="dev-sub">(${d.longitudinalAccG}G long / ${d.lateralAccG}G lat)</span></span>
          </div>
          <div class="dev-metric">
            <span class="dev-lbl">Steering Input & Angle: <span class="badge-meas">MEASURED</span></span>
            <span class="dev-val tel-mono">${d.steeringInput > 0 ? '+' : ''}${d.steeringInput} ratio <span class="dev-sub">(${d.steeringAngleDeg > 0 ? '+' : ''}${d.steeringAngleDeg}°)</span></span>
          </div>
          <div class="dev-metric">
            <span class="dev-lbl">Throttle / Brake / Gear: <span class="badge-meas">MEASURED</span></span>
            <span class="dev-val tel-mono">${d.throttlePct}% thr / ${d.brakePct}% brk / G${d.gear}</span>
          </div>
          <div class="dev-metric">
            <span class="dev-lbl">Kinematic Braking Dist: <span class="badge-est">ESTIMATED</span></span>
            <span class="dev-val tel-mono">${d.brakingDistanceM} m <span class="dev-sub">(Decel cap: ${d.brakingLimitDecelMps2} m/s²)</span></span>
          </div>
          <div class="dev-metric">
            <span class="dev-lbl">Lookahead Target Corner: <span class="badge-est">ESTIMATED</span></span>
            <span class="dev-val tel-mono">+${d.lookAheadM} m <span class="dev-sub">(Curv: ${d.targetCornerCurvature})</span></span>
          </div>
          <div class="dev-metric">
            <span class="dev-lbl">Wheelspin / Lockup: <span class="badge-meas">MEASURED</span></span>
            <span class="dev-val tel-mono ${d.isWheelspinning || d.isFrontLocked ? 'tel-val-warn' : 'tel-val-ok'}">${(d.wheelspin * 100).toFixed(1)}% spin · ${d.isFrontLocked ? '⚠️ FRONT LOCKED' : '✓ NO LOCKUP'}</span>
          </div>
          <div class="dev-metric">
            <span class="dev-lbl">Aero Package & Damage: <span class="badge-meas">MEASURED</span></span>
            <span class="dev-val tel-mono">${d.setupPackage || 'Standard'} <span class="dev-sub">(Wing: ${d.frontWingDamagePct}%, Floor: ${d.floorDamagePct}%)</span></span>
          </div>
        </div>
      </div>

      <!-- Card 2: Track Boundaries & Usable Corridor -->
      <div class="dev-card">
        <div class="dev-card-head">
          <span>📐 RACING LINE & TRACK GEOMETRY</span>
          ${trackLimitBadge}
        </div>
        <div class="dev-metrics-list">
          <div class="dev-metric">
            <span class="dev-lbl">Current Lateral Position: <span class="badge-meas">MEASURED</span></span>
            <span class="dev-val tel-mono">${d.currentLatM} m <span class="dev-sub">(${d.currentLatPx} px)</span></span>
          </div>
          <div class="dev-metric">
            <span class="dev-lbl">Target Lateral Offset: <span class="badge-est">ESTIMATED</span></span>
            <span class="dev-val tel-mono">${d.targetLatM} m <span class="dev-sub">(Ref: ${d.referenceLatM} m, Δ: ${(d.targetLatM - d.currentLatM).toFixed(2)}m)</span></span>
          </div>
          <div class="dev-metric">
            <span class="dev-lbl">Dist to Boundaries (L / R): <span class="badge-meas">MEASURED</span></span>
            <span class="dev-val tel-mono">${d.distFromLeftM} m L / ${d.distFromRightM} m R</span>
          </div>
          <div class="dev-metric">
            <span class="dev-lbl">Total Track Width: <span class="badge-meas">MEASURED</span></span>
            <span class="dev-val tel-mono">${d.totalTrackWidthM} m <span class="dev-sub">(Usable asphalt: ${d.usableTrackWidthM} m)</span></span>
          </div>
          <div class="dev-metric">
            <span class="dev-lbl">Usable Net Width: <span class="badge-est">ESTIMATED</span></span>
            <span class="dev-val tel-mono ${d.usableNetWidthM > 4.5 ? 'tel-val-ok' : 'tel-val-warn'}">${d.usableNetWidthM} m <span class="dev-sub">(Margin: ${d.boundarySafetyMarginM} m / 45% car width)</span></span>
          </div>
          <div class="dev-metric">
            <span class="dev-lbl">Racing Corridor / Track Limits: <span class="badge-meas">MEASURED</span></span>
            <span class="dev-val tel-mono">${d.racingCorridor} <span class="dev-sub">(${d.isTrackLimitViolation ? 'LIMIT EXCEEDED' : (d.isOnKerb ? 'ON KERB' : 'CLEAR')})</span></span>
          </div>
          <div class="dev-metric">
            <span class="dev-lbl">Track Progress (d): <span class="badge-meas">MEASURED</span></span>
            <span class="dev-val tel-mono">${d.d} m <span class="dev-sub">(Lap ${d.lap})</span></span>
          </div>
        </div>
      </div>

      <!-- Card 3: AI Behaviour State & Overtaking Decisions -->
      <div class="dev-card" style="grid-column: span 2;">
        <div class="dev-card-head">
          <span>🤖 AI BEHAVIOUR & OVERTAKING DECISIONS</span>
          <span class="dev-badge ${aiStateClass}">${d.aiState}</span>
        </div>
        <div class="dev-metrics-list">
          <div style="display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 6px;">
            <div class="dev-metric" style="flex: 1; min-width: 220px;">
              <span class="dev-lbl">Selected Passing Line: <span class="badge-est">ESTIMATED</span></span>
              <span class="dev-val tel-mono ${d.selectedPassingLine !== 'NONE' ? 'tel-val-ok' : ''}">${d.selectedPassingLine}</span>
            </div>
            <div class="dev-metric" style="flex: 2; min-width: 280px;">
              <span class="dev-lbl">Selection Reason: <span class="badge-est">ESTIMATED</span></span>
              <span class="dev-val tel-mono" style="font-size:11px; white-space:normal; text-align:left;">${d.selectionReason}</span>
            </div>
          </div>

          <div class="dev-metric">
            <span class="dev-lbl">Overtake Rejection / Cancellation Reason: <span class="badge-est">ESTIMATED</span></span>
            <span class="dev-val tel-mono ${d.rejectionReason ? 'tel-val-warn' : 'tel-val-ok'}" style="font-size:11px; white-space:normal; text-align:left;">
              ${d.rejectionReason ? `⛔ ${d.rejectionReason}` : '✓ None (Passing maneuver viable or tracking optimal line)'}
            </span>
          </div>

          <div style="margin-top: 6px;">
            <div class="dev-lbl" style="margin-bottom: 4px; font-weight: 700; color: #dfe4ea;">ALTERNATIVE CANDIDATE PATHS EVALUATION:</div>
            ${candidatePathsHtml}
          </div>

          <div style="display: flex; gap: 16px; flex-wrap: wrap; margin-top: 6px; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 6px;">
            <div class="dev-metric" style="flex: 1;">
              <span class="dev-lbl">Defensive Positioning: <span class="badge-meas">MEASURED</span></span>
              <span class="dev-val tel-mono ${d.isDefending ? 'tel-val-warn' : ''}">${d.isDefending ? 'DEFENDING INSIDE' : 'RACING LINE'} ${d.hasDefendedThisStraight ? '(1-Move Rule Enforced)' : ''}</span>
            </div>
            <div class="dev-metric" style="flex: 1;">
              <span class="dev-lbl">Racing Room Given: <span class="badge-meas">MEASURED</span></span>
              <span class="dev-val tel-mono">${d.racingRoomGivenM} m <span class="dev-sub">(≥1.2 Car-width FIA rule)</span></span>
            </div>
          </div>
        </div>
      </div>

      <!-- Card 4: Opponents, Traffic & TTC Radar -->
      <div class="dev-card">
        <div class="dev-card-head">
          <span>🔭 OPPONENTS, TRAFFIC & TTC RADAR</span>
          <span class="dev-tag">Spatial Radar</span>
        </div>
        <div class="dev-metrics-list">
          <div class="dev-metric">
            <span class="dev-lbl">Target Opponent: <span class="badge-meas">MEASURED</span></span>
            <span class="dev-val tel-mono">${d.targetOpponent ? `${d.targetOpponent.code} (${d.targetOpponent.gapM} m gap)` : '<span class="badge-unavail">CLEAN AIR</span>'}</span>
          </div>
          <div class="dev-metric">
            <span class="dev-lbl">Relative Speed / Closing Rate: <span class="badge-est">ESTIMATED</span></span>
            <span class="dev-val tel-mono">${d.targetOpponent ? `${d.targetOpponent.relativeSpeedKph > 0 ? '+' : ''}${d.targetOpponent.relativeSpeedKph} km/h (${d.targetOpponent.closingRateMps > 0 ? '+' : ''}${d.targetOpponent.closingRateMps} m/s)` : '<span class="badge-unavail">N/A</span>'}</span>
          </div>
          <div class="dev-metric">
            <span class="dev-lbl">Estimated Time to Collision (TTC): <span class="badge-est">ESTIMATED</span></span>
            <span class="dev-val tel-mono ${d.timeToCollision !== null && d.timeToCollision < 2.0 ? 'tel-val-crit' : (d.timeToCollision !== null && d.timeToCollision < 3.5 ? 'tel-val-warn' : 'tel-val-ok')}">
              ${d.timeToCollision !== null ? `${d.timeToCollision} s` : '<span class="badge-unavail">∞ (Clear)</span>'}
            </span>
          </div>
          <div class="dev-metric">
            <span class="dev-lbl">Min Predicted Clearance: <span class="badge-est">ESTIMATED</span></span>
            <span class="dev-val tel-mono ${d.minPredictedClearanceM < 3.5 ? 'tel-val-crit' : 'tel-val-ok'}">${d.minPredictedClearanceM} m</span>
          </div>
          <div class="dev-metric">
            <span class="dev-lbl">Predicted Trajectories (1s/2s/3s): <span class="badge-est">ESTIMATED</span></span>
            <span class="dev-val tel-mono">${d.predictedTrajectories ? `+1s: ${(d.predictedTrajectories.self[0].d % 1000).toFixed(0)}m · +2s: ${(d.predictedTrajectories.self[1].d % 1000).toFixed(0)}m · +3s: ${(d.predictedTrajectories.self[2].d % 1000).toFixed(0)}m` : '<span class="badge-unavail">N/A</span>'}</span>
          </div>
          <div class="dev-metric">
            <span class="dev-lbl">Side-by-Side Overlap: <span class="badge-meas">MEASURED</span></span>
            <span class="dev-val tel-mono">${d.sideBySide && d.sideBySide.length > 0 ? d.sideBySide.map(s => `${s.code} [${s.side}, ${s.overlapM}m]`).join(', ') : 'None'}</span>
          </div>
          <div class="dev-metric">
            <span class="dev-lbl">Collision Avoidance State: <span class="badge-meas">MEASURED</span></span>
            <span class="dev-val tel-mono ${d.collisionAvoidanceActive || d.emergencyBrakeTriggered ? 'tel-val-crit' : 'tel-val-ok'}">
              ${d.emergencyBrakeTriggered ? 'EMERGENCY BRAKING' : (d.collisionAvoidanceActive ? 'EVASIVE INTERVENTION' : 'CLEAR')}
            </span>
          </div>
        </div>
      </div>

      <!-- Card 5: Tyres, Thermal Grip & Dirty Air -->
      <div class="dev-card">
        <div class="dev-card-head">
          <span>🛞 TYRES, GRIP & DIRTY AIR</span>
          <span class="dev-tag">${d.compound.toUpperCase()}</span>
        </div>
        <div class="dev-metrics-list">
          <div class="dev-metric">
            <span class="dev-lbl">Tyre Wear & Dual-Axle Temp: <span class="badge-meas">MEASURED</span></span>
            <span class="dev-val tel-mono">${d.tyreWearPct}% wear · ${d.tyreSurfaceTempC || d.tyreTempC}°C surf / ${d.tyreCarcassTempC || d.tyreTempC}°C carcass</span>
          </div>
          <div class="dev-metric">
            <span class="dev-lbl">Carbon Brakes & Disc Fade: <span class="badge-meas">MEASURED</span></span>
            <span class="dev-val tel-mono ${d.brakeFade > 0.05 ? 'tel-val-warn' : 'tel-val-ok'}">${d.frontBrakeTempC || d.brakeTempC}°C F / ${d.rearBrakeTempC || d.brakeTempC}°C R ${d.brakeFade > 0.05 ? `· ⚠️ FADE ${(d.brakeFade * 100).toFixed(0)}%` : '· OPTIMAL BITE'}</span>
          </div>
          <div class="dev-metric">
            <span class="dev-lbl">Fuel Mass & Lift-and-Coast: <span class="badge-meas">MEASURED</span></span>
            <span class="dev-val tel-mono ${d.isLiftingAndCoasting ? 'tel-val-ok' : ''}">${d.fuelKg ?? '—'} kg (Δ ${d.fuelDeltaKg > 0 ? '+' : ''}${d.fuelDeltaKg ?? 0} kg) · ${d.isLiftingAndCoasting ? '🟢 LIFT & COAST' : 'STANDARD BURN'}</span>
          </div>
          <div class="dev-metric">
            <span class="dev-lbl">Effective Grip Multiplier: <span class="badge-meas">MEASURED</span></span>
            <span class="dev-val tel-mono">${d.effectiveGripMult}x</span>
          </div>
          <div class="dev-metric">
            <span class="dev-lbl">Aero Wake & Dirty Air: <span class="badge-meas">MEASURED</span></span>
            <span class="dev-val tel-mono ${d.inDirtyAir ? 'tel-val-warn' : (d.inSlipstream ? 'tel-val-ok' : '')}">
              ${d.dirtyAirState === 'DIRTY_AIR' ? `TURBULENT DIRTY AIR (-${d.dirtyAirDownforceLossPct}% downforce)` : (d.dirtyAirState === 'SLIPSTREAM' ? `SLIPSTREAM TOW (+${d.slipstreamBenefitPct}% tow)` : 'CLEAN AIR')}
            </span>
          </div>
          <div class="dev-metric">
            <span class="dev-lbl">Current Sector Evolution: <span class="badge-meas">MEASURED</span></span>
            <span class="dev-val tel-mono">Sector ${d.trackSector}/24 <span class="dev-sub">(Wet: ${d.sectorMoisturePct}%, Rub: ${d.sectorRubberPct}%)</span></span>
          </div>
          <div class="dev-metric">
            <span class="dev-lbl">Track Wetness / Aquaplaning: <span class="badge-meas">MEASURED</span></span>
            <span class="dev-val tel-mono ${d.aquaplaning ? 'tel-val-crit' : 'tel-val-ok'}">Avg ${d.avgTrackWetnessPct}% · ${d.aquaplaning ? '⚠️ AQUAPLANING RISK' : '✓ NORMAL CONTACT'}</span>
          </div>
        </div>
      </div>

      <!-- Card 6: Hybrid Powertrain, ERS & DRS Deployment -->
      <div class="dev-card">
        <div class="dev-card-head">
          <span>🔋 ERS HYBRID & DRS DEPLOYMENT</span>
          <span class="dev-tag">${d.batteryMode}</span>
        </div>
        <div class="dev-metrics-list">
          <div class="dev-metric">
            <span class="dev-lbl">DRS Status & Flap: <span class="badge-meas">MEASURED</span></span>
            <span class="dev-val tel-mono ${d.drsActive ? 'tel-val-ok' : (d.drsEligible ? 'tel-val-warn' : '')}">
              ${d.drsActive ? 'OPEN (WING ACTIVE)' : (d.drsEligible ? 'ELIGIBLE' : 'INACTIVE')}
            </span>
          </div>
          <div class="dev-metric">
            <span class="dev-lbl">DRS Decision Rationale: <span class="badge-meas">MEASURED</span></span>
            <span class="dev-val tel-mono" style="font-size:11px; white-space:normal; line-height:1.2;">${d.drsReason}</span>
          </div>
          <div class="dev-metric">
            <span class="dev-lbl">ERS Battery SOC / Energy: <span class="badge-meas">MEASURED</span></span>
            <span class="dev-val tel-mono">${d.batterySocPct}% <span class="dev-sub">(${(d.batteryEnergyJoules / 1000000).toFixed(2)} MJ / 4.00 MJ)</span></span>
          </div>
          <div class="dev-metric">
            <span class="dev-lbl">Power Output / Flow: <span class="badge-meas">MEASURED</span></span>
            <span class="dev-val tel-mono">${d.batteryPowerKw > 0 ? '+' : ''}${d.batteryPowerKw} kW <span class="dev-sub">(${d.batteryDeploying ? 'DEPLOYING' : (d.batteryHarvesting ? 'HARVESTING' : 'NEUTRAL')})</span></span>
          </div>
          <div class="dev-metric">
            <span class="dev-lbl">Predictive Pit Action: <span class="badge-est">ESTIMATED</span></span>
            <span class="dev-val tel-mono ${pitActionClass}">${d.strategyAction} · ${d.strategyRecommendedCompound.toUpperCase()} compound</span>
          </div>
          <div class="dev-metric">
            <span class="dev-lbl">Pit Loss / Undercut: <span class="badge-est">ESTIMATED</span></span>
            <span class="dev-val tel-mono">${d.predictedPitLossS}s loss · ${d.undercutAdvantageS !== null ? `${d.undercutAdvantageS > 0 ? '+' : ''}${d.undercutAdvantageS}s undercut` : '<span class="badge-unavail">N/A</span>'}</span>
          </div>
        </div>
      </div>

      <!-- Card 7: Network Synchronisation & Authoritative Telemetry -->
      ${(() => {
        const mpCtrl = getSharedMultiplayerController();
        const netDiag = mpCtrl?.getNetworkDiagnostics();
        const inMp = mpCtrl?.inRace;
        return `
        <div class="dev-card" style="grid-column: span 2;">
          <div class="dev-card-head">
            <span>📡 NETWORK SYNCHRONISATION & AUTHORITATIVE TIMING</span>
            <span class="dev-tag">${inMp ? (netDiag?.reconnectionStatus === 'connected' ? 'SYNCED' : 'RECONNECTING') : 'LOCAL / STANDALONE'}</span>
          </div>
          <div class="dev-metrics-list" style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px;">
            <div class="dev-metric">
              <span class="dev-lbl">Round Trip Time (Ping): <span class="badge-meas">MEASURED</span></span>
              <span class="dev-val tel-mono ${netDiag && netDiag.pingMs > 150 ? 'tel-val-warn' : 'tel-val-ok'}">${netDiag ? netDiag.pingMs.toFixed(1) + ' ms' : '0.0 ms'}</span>
            </div>
            <div class="dev-metric">
              <span class="dev-lbl">Network Jitter: <span class="badge-meas">MEASURED</span></span>
              <span class="dev-val tel-mono">${netDiag ? netDiag.jitterMs.toFixed(1) + ' ms' : '0.0 ms'}</span>
            </div>
            <div class="dev-metric">
              <span class="dev-lbl">Authoritative Snapshot Buffer: <span class="badge-meas">BUFFER</span></span>
              <span class="dev-val tel-mono">${netDiag ? netDiag.snapshotBufferDepth + ' snapshots (' + netDiag.bufferDurationMs.toFixed(0) + ' ms)' : '0 snapshots'}</span>
            </div>
            <div class="dev-metric">
              <span class="dev-lbl">Interpolation Delay: <span class="badge-est">CONFIGURED</span></span>
              <span class="dev-val tel-mono">${netDiag ? netDiag.interpolationDelayMs + ' ms' : '100 ms'}</span>
            </div>
            <div class="dev-metric">
              <span class="dev-lbl">Dead Reckoning Active: <span class="badge-est">PREDICTION</span></span>
              <span class="dev-val tel-mono ${netDiag && netDiag.deadReckoningActive ? 'tel-val-warn' : 'tel-val-ok'}">${netDiag && netDiag.deadReckoningActive ? 'ACTIVE (' + netDiag.deadReckoningDurationMs.toFixed(0) + ' ms)' : 'INACTIVE (Hermite Synced)'}</span>
            </div>
            <div class="dev-metric">
              <span class="dev-lbl">Hermite Spline Correction RMS: <span class="badge-est">RECONCILE</span></span>
              <span class="dev-val tel-mono">${netDiag ? netDiag.correctionMagnitudeM.toFixed(3) + ' m' : '0.000 m'}</span>
            </div>
            <div class="dev-metric">
              <span class="dev-lbl">Packet Loss Rate: <span class="badge-meas">MEASURED</span></span>
              <span class="dev-val tel-mono ${netDiag && netDiag.packetLossRate > 5 ? 'tel-val-warn' : 'tel-val-ok'}">${netDiag ? netDiag.packetLossRate.toFixed(1) + '%' : '0.0%'}</span>
            </div>
            <div class="dev-metric">
              <span class="dev-lbl">Server Monotonic Tick: <span class="badge-meas">AUTHORITATIVE</span></span>
              <span class="dev-val tel-mono">#${netDiag ? netDiag.lastServerTick : 0} (Seq #${netDiag ? netDiag.lastSequenceNumber : 0})</span>
            </div>
          </div>
        </div>`;
      })()}
    `;
  }

  /**
   * Render SVG Visual Debug Drawings on top of the circuit map.
   * Renders only enabled layers for the selected car and nearby rivals.
   * @param {object} d - Telemetry data object
   * @private
   */
  _renderDebugOverlay(d) {
    if (!this.scene?.devDebugOverlay || !this.track || !this.engine?.cars) return;
    const g = this.scene.devDebugOverlay;
    const car = this.engine.cars[this.selectedCarIndex];
    if (!car) {
      g.innerHTML = '';
      return;
    }

    const track = this.track;
    const L = track.circuit.lengthM;
    const k = track.k || 1;
    const carWidthPx = 3.6 * k;
    const carLengthM = 5.6;

    let svg = '';

    // Sample range around selected car: 50m behind to 140m ahead
    const distBack = 50.0;
    const distAhead = 140.0;
    const stepM = 5.0;
    const sampleCount = Math.floor((distBack + distAhead) / stepM);

    // ── 1. Layer: Track Centerline ──────────────────────────────────────────
    if (this.debugLayers.centerline) {
      let dStr = '';
      for (let s = 0; s <= sampleCount; s++) {
        const dist = car.d - distBack + s * stepM;
        const pt = trackToWorld(track, dist, 0);
        dStr += (s === 0 ? 'M ' : ' L ') + `${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
      }
      svg += `<path d="${dStr}" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-dasharray="6,4" opacity="0.85" />`;
    }

    // ── 2. Layer: Track Boundaries (Outer Asphalt Extents) ──────────────────
    if (this.debugLayers.boundaries) {
      let dLeft = '';
      let dRight = '';
      for (let s = 0; s <= sampleCount; s++) {
        const dist = car.d - distBack + s * stepM;
        const ptCenter = trackToWorld(track, dist, 0);
        const ptL = trackToWorld(track, dist, ptCenter.halfWidth);
        const ptR = trackToWorld(track, dist, -ptCenter.halfWidth);
        dLeft += (s === 0 ? 'M ' : ' L ') + `${ptL.x.toFixed(1)} ${ptL.y.toFixed(1)}`;
        dRight += (s === 0 ? 'M ' : ' L ') + `${ptR.x.toFixed(1)} ${ptR.y.toFixed(1)}`;
      }
      svg += `<path d="${dLeft}" fill="none" stroke="#ff7675" stroke-width="2.2" opacity="0.85" />`;
      svg += `<path d="${dRight}" fill="none" stroke="#74b9ff" stroke-width="2.2" opacity="0.85" />`;
    }

    // ── 3. Layer: Usable Road Corridor (Asphalt minus outer limits) ─────────
    if (this.debugLayers.corridor) {
      const leftPts = [];
      const rightPts = [];
      for (let s = 0; s <= sampleCount; s++) {
        const dist = car.d - distBack + s * stepM;
        const ptCenter = trackToWorld(track, dist, 0);
        leftPts.push(trackToWorld(track, dist, ptCenter.usableHalfWidth));
        rightPts.push(trackToWorld(track, dist, -ptCenter.usableHalfWidth));
      }

      // Shaded corridor polygon
      let polyD = `M ${leftPts[0].x.toFixed(1)} ${leftPts[0].y.toFixed(1)}`;
      for (let i = 1; i < leftPts.length; i++) polyD += ` L ${leftPts[i].x.toFixed(1)} ${leftPts[i].y.toFixed(1)}`;
      for (let i = rightPts.length - 1; i >= 0; i--) polyD += ` L ${rightPts[i].x.toFixed(1)} ${rightPts[i].y.toFixed(1)}`;
      polyD += ' Z';

      svg += `<path d="${polyD}" fill="rgba(0, 206, 201, 0.08)" stroke="none" />`;

      // Corridor boundary dashed lines
      let leftD = `M ${leftPts[0].x.toFixed(1)} ${leftPts[0].y.toFixed(1)}`;
      let rightD = `M ${rightPts[0].x.toFixed(1)} ${rightPts[0].y.toFixed(1)}`;
      for (let i = 1; i < leftPts.length; i++) {
        leftD += ` L ${leftPts[i].x.toFixed(1)} ${leftPts[i].y.toFixed(1)}`;
        rightD += ` L ${rightPts[i].x.toFixed(1)} ${rightPts[i].y.toFixed(1)}`;
      }
      svg += `<path d="${leftD}" fill="none" stroke="#00cec9" stroke-width="1.8" stroke-dasharray="5,3" opacity="0.9" />`;
      svg += `<path d="${rightD}" fill="none" stroke="#00cec9" stroke-width="1.8" stroke-dasharray="5,3" opacity="0.9" />`;
    }

    // ── 4. Layer: Reference Dynamic Racing Line ─────────────────────────────
    if (this.debugLayers.referenceLine) {
      let dRef = '';
      for (let s = 0; s <= sampleCount; s++) {
        const dist = car.d - distBack + s * stepM;
        const ptCenter = trackToWorld(track, dist, 0);
        // Lookahead curvature at dist
        const sampleAhead = sampleTrack(track, dist + 24.0);
        const curv = sampleAhead.curv || 0;
        let refLat = 0;
        if (Math.abs(curv) > 0.0012) {
          const sign = curv > 0 ? 1 : -1;
          const apexMargin = 2.2 * k;
          refLat = sign * (ptCenter.usableHalfWidth - apexMargin);
        }
        const pt = trackToWorld(track, dist, refLat);
        dRef += (s === 0 ? 'M ' : ' L ') + `${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
      }
      svg += `<path d="${dRef}" fill="none" stroke="#a29bfe" stroke-width="2.4" stroke-dasharray="7,4" opacity="0.9" />`;
    }

    // ── 5. Layer: Selected AI Trajectory ────────────────────────────────────
    if (this.debugLayers.selectedTrajectory) {
      const v = Math.max(15, car.v);
      const lookTime = 3.0; // 3 second projection
      const trajSteps = 8;
      let dTraj = `M ${car.x.toFixed(1)} ${car.y.toFixed(1)}`;

      for (let step = 1; step <= trajSteps; step++) {
        const t = (step / trajSteps) * lookTime;
        const dist = car.d + v * t;
        // Smoothly blend from current lat towards targetLat
        const blend = Math.min(1.0, t / 1.5);
        const lat = car.lat + ((car.targetLat || 0) - car.lat) * blend;
        const pt = trackToWorld(track, dist, lat);
        dTraj += ` L ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;

        // Waypoint dots at 1s, 2s, 3s
        if (step === 2 || step === 5 || step === 8) {
          const horizonLabel = `+${(t).toFixed(0)}s`;
          svg += `<circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="3" fill="#00ff88" stroke="#000" stroke-width="1" />`;
        }
      }

      svg += `<path d="${dTraj}" fill="none" stroke="rgba(0, 255, 136, 0.35)" stroke-width="5" stroke-linecap="round" />`;
      svg += `<path d="${dTraj}" fill="none" stroke="#00ff88" stroke-width="2.5" stroke-linecap="round" />`;
    }

    // ── 6. Layer: Alternative Candidate Paths ───────────────────────────────
    if (this.debugLayers.candidatePaths && d.candidatePaths && d.candidatePaths.length > 0) {
      const v = Math.max(15, car.v);
      const lookDist = Math.max(45, v * 2.0);

      d.candidatePaths.forEach(cand => {
        if (cand.name === 'Reference Line') return; // Covered by ref line

        const candTargetLat = cand.targetLatM * k;
        let candD = `M ${car.x.toFixed(1)} ${car.y.toFixed(1)}`;
        const steps = 6;
        for (let s = 1; s <= steps; s++) {
          const frac = s / steps;
          const dist = car.d + lookDist * frac;
          const lat = car.lat + (candTargetLat - car.lat) * frac;
          const pt = trackToWorld(track, dist, lat);
          candD += ` L ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;

          if (s === steps) {
            const labelColor = cand.isFeasible ? '#ffa502' : '#ff4757';
            svg += `<circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="4" fill="${labelColor}" stroke="#ffffff" stroke-width="1" />`;
          }
        }

        const strokeColor = cand.isFeasible
          ? (cand.name === 'Inside Dive' ? '#ffa502' : '#e056fd')
          : '#ff4757';
        const dash = cand.isFeasible ? '5,3' : '2,2';
        svg += `<path d="${candD}" fill="none" stroke="${strokeColor}" stroke-width="2" stroke-dasharray="${dash}" opacity="0.85" />`;
      });
    }

    // ── 7. Layer: Car Footprints & Predicted Positions ──────────────────────
    if (this.debugLayers.footprints) {
      const renderFootprint = (c, strokeColor, fillColor, isSelected = false) => {
        const rad = c.ang;
        const deg = (rad * 180 / Math.PI).toFixed(1);
        const w = (carWidthPx * 1.05).toFixed(1);
        const h = (carLengthM * 1.5).toFixed(1);
        return `
          <g transform="translate(${c.x.toFixed(1)}, ${c.y.toFixed(1)}) rotate(${deg})">
            <rect x="${(-h / 2).toFixed(1)}" y="${(-w / 2).toFixed(1)}" width="${h}" height="${w}"
              fill="${fillColor}" stroke="${strokeColor}" stroke-width="${isSelected ? '2.2' : '1.5'}" rx="2" />
          </g>
        `;
      };

      // Selected car footprint
      svg += renderFootprint(car, '#fdcb6e', 'rgba(253, 203, 110, 0.25)', true);

      // Nearby opponent footprints (within 70m)
      this.engine.cars.forEach((other, idx) => {
        if (idx === this.selectedCarIndex) return;
        const gapFwd = (((other.d - car.d) % L) + L) % L;
        const dist = Math.min(gapFwd, L - gapFwd);
        if (dist <= 70.0) {
          svg += renderFootprint(other, '#74b9ff', 'rgba(116, 185, 255, 0.15)');
        }
      });

      // Predicted positions ghosts (1s, 2s, 3s)
      if (d.predictedTrajectories && d.predictedTrajectories.self) {
        d.predictedTrajectories.self.forEach((ptInfo, i) => {
          const pt = trackToWorld(track, ptInfo.d, ptInfo.lat);
          svg += `
            <g transform="translate(${pt.x.toFixed(1)}, ${pt.y.toFixed(1)}) rotate(${(pt.heading * 180 / Math.PI).toFixed(1)})">
              <rect x="-4" y="-2.5" width="8" height="5" fill="none" stroke="#fdcb6e" stroke-width="1.2" stroke-dasharray="2,2" opacity="0.75" />
            </g>
          `;
        });
      }
    }

    // ── 8. Layer: Collision Risk Regions & TTC Indicators ───────────────────
    if (this.debugLayers.collisionRisk) {
      if (d.targetOpponent && d.timeToCollision !== null && d.timeToCollision < 3.8) {
        // Find opponent car object
        const opp = this.engine.cars.find(c => c.code === d.targetOpponent.code);
        if (opp) {
          // Polygon between cars
          const polyRisk = `M ${car.x.toFixed(1)} ${car.y.toFixed(1)} L ${opp.x.toFixed(1)} ${opp.y.toFixed(1)}`;
          svg += `<path d="${polyRisk}" stroke="#ff4757" stroke-width="3" stroke-dasharray="4,4" opacity="0.9" />`;

          // Hazard midpoint badge
          const midX = ((car.x + opp.x) / 2).toFixed(1);
          const midY = ((car.y + opp.y) / 2).toFixed(1);
          const alertColor = d.timeToCollision < 1.8 ? '#ff4757' : '#ffa502';

          svg += `
            <g transform="translate(${midX}, ${midY})">
              <rect x="-35" y="-10" width="70" height="20" rx="4" fill="rgba(20, 20, 30, 0.9)" stroke="${alertColor}" stroke-width="1.5" />
              <text x="0" y="4" fill="${alertColor}" font-family="monospace" font-size="9" font-weight="bold" text-anchor="middle">
                TTC: ${d.timeToCollision}s
              </text>
            </g>
          `;
        }
      }
    }

    // ── 9. Layer: Track Limit Violations ────────────────────────────────────
    if (this.debugLayers.trackLimits) {
      if (d.isTrackLimitViolation) {
        // Flashing red halo around selected car
        svg += `
          <g transform="translate(${car.x.toFixed(1)}, ${car.y.toFixed(1)})">
            <circle cx="0" cy="0" r="14" fill="none" stroke="#ff0000" stroke-width="2.8" stroke-dasharray="4,2" />
            <rect x="-45" y="-24" width="90" height="15" rx="3" fill="#ff0000" />
            <text x="0" y="-13" fill="#ffffff" font-family="Rajdhani, sans-serif" font-size="8.5" font-weight="bold" text-anchor="middle">
              TRACK LIMIT VIOLATION
            </text>
          </g>
        `;
      } else if (d.isOnKerb) {
        // Yellow kerb indicator
        svg += `
          <g transform="translate(${car.x.toFixed(1)}, ${car.y.toFixed(1)})">
            <circle cx="0" cy="0" r="11" fill="none" stroke="#f9ca24" stroke-width="2" stroke-dasharray="3,3" />
            <rect x="-32" y="-20" width="64" height="12" rx="2" fill="rgba(249, 202, 36, 0.9)" />
            <text x="0" y="-11" fill="#000000" font-family="Rajdhani, sans-serif" font-size="8" font-weight="bold" text-anchor="middle">
              KERB CONTACT
            </text>
          </g>
        `;
      }
    }

    g.innerHTML = svg;
  }

  /**
   * Load layer preferences from localStorage or fall back to defaults.
   * @private
   */
  _loadLayerPreferences() {
    try {
      if (typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem(STORAGE_KEY_DEBUG_LAYERS);
        if (saved) {
          return { ...DEFAULT_DEBUG_LAYERS, ...JSON.parse(saved) };
        }
      }
    } catch (_) {}
    return { ...DEFAULT_DEBUG_LAYERS };
  }

  /**
   * Save layer preferences to localStorage.
   * @private
   */
  _saveLayerPreferences() {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY_DEBUG_LAYERS, JSON.stringify(this.debugLayers));
      }
    } catch (_) {}
  }

  /**
   * Copy telemetry JSON snapshot to clipboard.
   * @private
   */
  _copySnapshot() {
    if (!this.engine) return;
    const d = this.engine.getDeveloperTelemetry(this.selectedCarIndex);
    if (!d) return;

    const json = JSON.stringify(d, null, 2);
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(json).then(() => {
        const btn = document.getElementById('btnDevCopySnapshot');
        if (btn) {
          const orig = btn.textContent;
          btn.textContent = '✓ COPIED!';
          setTimeout(() => { btn.textContent = orig; }, 2000);
        }
      }).catch(() => {});
    }
  }

  /**
   * Global keydown listener for keyboard shortcuts (` / ~ / F2).
   * @private
   */
  _handleKeyDown(e) {
    if (e.key === '`' || e.key === '~' || e.key === 'F2') {
      const target = e.target;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      e.preventDefault();
      this.toggle();
    }
  }

  /**
   * Attach keyboard and header button listeners.
   * @private
   */
  _attachEventListeners() {
    if (typeof window === 'undefined') return;
    window.removeEventListener('keydown', this._boundKeyHandler);
    window.addEventListener('keydown', this._boundKeyHandler);

    const devBtn = document.getElementById('devTelemetryBtn');
    if (devBtn) {
      devBtn.addEventListener('click', () => this.toggle());
    }
  }
}

let developerTelemetryInstance = null;

export function initDeveloperTelemetry(engine, scene = null, track = null) {
  if (!developerTelemetryInstance) {
    developerTelemetryInstance = new DeveloperTelemetryManager();
  }
  developerTelemetryInstance.init(engine, scene, track);
  return developerTelemetryInstance;
}

export function getDeveloperTelemetry() {
  return developerTelemetryInstance;
}
