/**
 * quickRaceViews.js
 * User Interface & Screen Renderer for Quick Race Setup Wizard,
 * Format Selectors, Grid Visualization, Review, and Official Results.
 *
 * Implements:
 *   - Quick Race Entry Screen (Quick Start vs Custom Wizard vs Presets)
 *   - 6-Step Setup Wizard with step indicators and back/continue navigation
 *   - Live Distance-to-Laps calculator with British English explanations
 *   - Circuit Selection with SVG circuit geometry previews
 *   - 20-Driver, 8-Manager, 10-Car draft-style selection with stats and synergies
 *   - Grid Configuration with 2x2 staggered starting grid preview
 *   - Conditions, Weather, AI Difficulty, and Rules toggles
 *   - Comprehensive Review & Launch card
 *   - Official Post-Race Classification Modal & Chequered Flag Banner
 */

import {
  FIELD_SIZE_PRESETS,
  LAP_PRESETS,
  DISTANCE_PRESETS,
  GRID_MODES,
  WEATHER_OPTIONS,
  AI_DIFFICULTIES,
  TYRE_COMPOUNDS,
  calculateLapsFromDistance,
  getQuickRacePresets,
  saveQuickRacePreset
} from '../quickrace/quickRaceConfig.js';
import { CIRCUITS, RAW_WAYPOINTS, getCircuit } from '../data/circuitData.js';
import { DRIVERS, getDriver } from '../data/driverData.js';
import { MANAGERS, getManager } from '../data/managerData.js';
import { CARS, getCar } from '../data/carData.js';
import { renderCircuitSelection, bindCircuitSelectionEvents } from './circuitSelect.js';

export class QuickRaceViews {

  // ── 1. Quick Race Entry Portal ──────────────────────────────────────────

  /**
   * Renders the Quick Race Entry Modal.
   * Gives users the option for 1-click Quick Start, Multi-step Custom Setup, or Loading a Preset.
   */
  static renderEntryPortal(container, { config, onQuickStart, onOpenWizard, onLoadPreset, onBackToMain }) {
    const presets = getQuickRacePresets();
    const curCircuit = getCircuit(config.circuitId);
    const curDriver = getDriver(config.playerDriverCode);
    const curCar = getCar(config.playerCarId);

    container.innerHTML = `
      <div class="f1-modal-backdrop">
        <div class="f1-menu-card f1-card-wide qr-entry-card">
          <div class="f1-menu-header">
            <div class="f1-menu-nav-row">
              <button type="button" class="f1-btn-ghost btn-modal-back" id="btnQREntryBack">← MAIN MENU</button>
              <span class="f1-badge-red">STANDALONE GRAND PRIX</span>
              <button type="button" class="f1-btn-close btn-modal-close" id="btnQREntryClose" aria-label="Close">&times;</button>
            </div>
            <h1 class="f1-menu-title">QUICK RACE MODE</h1>
            <p class="f1-menu-sub">Configure a custom race weekend or launch immediately with default race settings.</p>
          </div>

          <!-- Current Configuration Quick Preview -->
          <div class="qr-current-preview">
            <div class="qr-preview-tag">
              <span class="qr-preview-lbl">CIRCUIT</span>
              <span class="qr-preview-val">${curCircuit.name} (${curCircuit.country})</span>
            </div>
            <div class="qr-preview-tag">
              <span class="qr-preview-lbl">FORMAT</span>
              <span class="qr-preview-val">${config.fieldSize} Cars &middot; ${config.totalLaps} Laps</span>
            </div>
            <div class="qr-preview-tag">
              <span class="qr-preview-lbl">DRIVER & CAR</span>
              <span class="qr-preview-val" style="color:${curDriver?.teamColor || '#e10600'}">${curDriver?.code || 'HAM'} &middot; ${curCar?.name || 'Car'}</span>
            </div>
            <div class="qr-preview-tag">
              <span class="qr-preview-lbl">DIFFICULTY</span>
              <span class="qr-preview-val">${config.aiDifficulty?.toUpperCase() || 'NORMAL'}</span>
            </div>
          </div>

          <!-- Main Launch Options -->
          <div class="f1-mode-grid">
            <!-- 1. Quick Start Option -->
            <button type="button" class="f1-mode-btn f1-mode-primary qr-entry-btn" id="btnQRQuickStart">
              <div class="f1-mode-icon">⚡</div>
              <div class="f1-mode-info">
                <h2>QUICK START</h2>
                <p>Launch immediately into the race using current settings. One click to lights out!</p>
                <span class="f1-mode-tag f1-tag-gold">INSTANT ACTION &middot; ${config.totalLaps} LAPS</span>
              </div>
            </button>

            <!-- 2. Customize Race Option -->
            <button type="button" class="f1-mode-btn qr-entry-btn" id="btnQRCustomize">
              <div class="f1-mode-icon">🛠️</div>
              <div class="f1-mode-info">
                <h2>CUSTOMIZE RACE</h2>
                <p>Step through the complete race wizard: format, circuit, driver, grid order, weather & rules.</p>
                <span class="f1-mode-tag">FULL 6-STEP WIZARD</span>
              </div>
            </button>
          </div>

          <!-- Presets Section -->
          <div class="qr-presets-section">
            <div class="qr-presets-header">
              <h3>🏎️ RACE PRESETS</h3>
              <span class="qr-presets-sub">Select a curated scenario or load a saved configuration</span>
            </div>
            <div class="qr-preset-grid">
              ${presets.map((p, idx) => `
                <div class="qr-preset-card" data-preset-idx="${idx}">
                  <div class="qr-preset-title-row">
                    <span class="qr-preset-name">${p.name}</span>
                    ${p.isUser ? '<span class="f1-badge-gold">USER</span>' : '<span class="f1-badge-subtle">OFFICIAL</span>'}
                  </div>
                  <p class="qr-preset-desc">${p.description}</p>
                  <div class="qr-preset-meta">
                    <span>${p.config.fieldSize} Cars</span> &middot;
                    <span>${p.config.totalLaps} Laps</span> &middot;
                    <span>${p.config.circuitId?.toUpperCase()}</span> &middot;
                    <span>${p.config.weatherPreset}</span>
                  </div>
                  <button type="button" class="f1-btn-secondary f1-btn-sm btn-load-preset" data-preset-idx="${idx}">LOAD PRESET →</button>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    `;

    container.querySelector('#btnQREntryBack')?.addEventListener('click', onBackToMain);
    container.querySelector('#btnQREntryClose')?.addEventListener('click', onBackToMain);
    container.querySelector('#btnQRQuickStart')?.addEventListener('click', onQuickStart);
    container.querySelector('#btnQRCustomize')?.addEventListener('click', onOpenWizard);

    container.querySelectorAll('.btn-load-preset').forEach(btn => {
      btn.addEventListener('click', e => {
        const idx = parseInt(e.currentTarget.dataset.presetIdx, 10);
        const preset = presets[idx];
        if (preset && onLoadPreset) {
          onLoadPreset(preset.config);
        }
      });
    });
  }

  // ── 2. Multi-Step Configuration Wizard ──────────────────────────────────

  /**
   * Render Guided Quick Race Setup Wizard (Steps 1 to 6).
   */
  static renderWizard(container, { initialConfig, onCancel, onLaunchRace, onSavePreset }) {
    let currentStep = 1;
    const totalSteps = 6;
    const wizardState = { ...initialConfig };

    function render() {
      container.innerHTML = `
        <div class="f1-modal-backdrop">
          <div class="f1-wizard-card f1-card-wide qr-wizard-card">
            <!-- Header & Step Navigation -->
            <div class="f1-wizard-header qr-wizard-header" id="qrWizardHeader">
              <div class="f1-wizard-nav">
                <button type="button" class="f1-btn-ghost btn-modal-back" id="btnWizHeaderBack">← BACK</button>
                <div class="qr-wizard-badge-row">
                  <span class="f1-badge-red">QUICK RACE CONFIGURATION</span>
                  <span class="qr-step-title">${getStepTitle(currentStep)}</span>
                </div>
                <button type="button" class="f1-btn-close btn-modal-close" id="btnWizHeaderClose" aria-label="Cancel">&times;</button>
              </div>
              <div class="qr-wizard-sub-row">
                <h2 class="qr-wizard-main-title">RACE SETUP WIZARD</h2>
                <span class="f1-wizard-step-label">Step ${currentStep} of ${totalSteps}</span>
              </div>
              <nav class="qr-step-indicator-bar" aria-label="Wizard Steps">
                ${[
                  { num: 1, label: 'Format' },
                  { num: 2, label: 'Circuit' },
                  { num: 3, label: 'Driver' },
                  { num: 4, label: 'Grid' },
                  { num: 5, label: 'Rules' },
                  { num: 6, label: 'Review' }
                ].map(s => `
                  <div class="qr-step-dot ${s.num < currentStep ? 'done' : (s.num === currentStep ? 'current' : 'upcoming')}" data-step="${s.num}">
                    <span class="qr-step-dot-num">${s.num < currentStep ? '✓' : s.num}</span>
                    <span class="qr-step-dot-label">${s.label}</span>
                  </div>
                `).join('')}
              </nav>
              <div class="f1-wizard-progress">
                <div class="f1-wizard-bar" style="width: ${(currentStep / totalSteps) * 100}%"></div>
              </div>
            </div>

            <!-- Step Body Container -->
            <div class="f1-wizard-body qr-wizard-body" id="qrWizardBody">
              ${renderStepBody(currentStep, wizardState)}
            </div>

            <!-- Wizard Footer Controls -->
            <div class="f1-wizard-footer" id="qrWizardFooter">
              <button type="button" class="f1-btn-ghost" id="btnWizCancel">Cancel</button>
              <div class="f1-wizard-controls">
                ${currentStep > 1 ? `
                  <button type="button" class="f1-btn-secondary" id="btnWizBack">← Back</button>
                ` : ''}
                ${currentStep < totalSteps ? `
                  <button type="button" class="f1-btn-primary" id="btnWizNext">Continue →</button>
                ` : `
                  <button type="button" class="f1-btn-secondary" id="btnWizSavePreset">💾 Save Preset</button>
                  <button type="button" class="f1-btn-primary f1-btn-gold" id="btnWizLaunch">
                    ${wizardState.includeQualifying ? '⏱️ PROCEED TO QUALIFYING →' : '🏁 START RACE'}
                  </button>
                `}
              </div>
            </div>
          </div>
        </div>
      `;

      // Event Listeners
      container.querySelector('#btnWizCancel')?.addEventListener('click', onCancel);
      container.querySelector('#btnWizHeaderClose')?.addEventListener('click', onCancel);
      container.querySelector('#btnWizHeaderBack')?.addEventListener('click', () => {
        if (currentStep > 1) {
          saveStepInputs(currentStep, wizardState, container);
          currentStep--;
          render();
        } else {
          onCancel();
        }
      });

      container.querySelector('#btnWizBack')?.addEventListener('click', () => {
        saveStepInputs(currentStep, wizardState, container);
        currentStep = Math.max(1, currentStep - 1);
        render();
      });

      container.querySelector('#btnWizNext')?.addEventListener('click', () => {
        saveStepInputs(currentStep, wizardState, container);
        currentStep = Math.min(totalSteps, currentStep + 1);
        render();
      });

      container.querySelector('#btnWizSavePreset')?.addEventListener('click', () => {
        saveStepInputs(currentStep, wizardState, container);
        const name = prompt('Enter a name for this custom Quick Race preset:', `${wizardState.circuitId.toUpperCase()} Custom Race`);
        if (name && name.trim()) {
          saveQuickRacePreset(name.trim(), wizardState);
          alert(`Preset "${name.trim()}" saved!`);
        }
      });

      container.querySelector('#btnWizLaunch')?.addEventListener('click', () => {
        saveStepInputs(currentStep, wizardState, container);
        onLaunchRace(wizardState);
      });

      bindStepEvents(currentStep, wizardState, container, render);
    }

    render();
  }

  // ── 3. Post-Race Classification Modal ───────────────────────────────────

  /**
   * Renders the Official Post-Race Classification Modal.
   */
  static renderResultsModal(container, { classification, circuit, onRestart, onConfigure, onReturnMenu }) {
    const winner = classification[0];

    container.innerHTML = `
      <div class="f1-modal-backdrop">
        <div class="f1-stage-card f1-card-wide qr-results-card">
          <div class="qr-results-header">
            <div class="qr-results-top-nav">
              <button type="button" class="f1-btn-ghost btn-modal-back" id="btnQRResultsHeaderBack">← RETURN TO MENU</button>
              <button type="button" class="f1-btn-close btn-modal-close" id="btnQRResultsHeaderClose" aria-label="Close">&times;</button>
            </div>
            <div class="qr-results-badge-row">
              <span class="f1-badge-red">FIA FORMULA ONE WORLD CHAMPIONSHIP</span>
              <span class="f1-badge-gold">OFFICIAL CLASSIFICATION</span>
            </div>
            <h1 class="qr-results-title">🏁 ${circuit.name.toUpperCase()} GRAND PRIX</h1>
            <p class="qr-results-sub">${winner ? `Winner: ${winner.name} (${winner.team}) &middot; Completed in ${winner.gapText}` : 'Grand Prix Complete'}</p>
          </div>

          <!-- Official Classification Table -->
          <div class="qr-table-wrap">
            <table class="qr-results-table">
              <thead>
                <tr>
                  <th>POS</th>
                  <th>NO</th>
                  <th>DRIVER</th>
                  <th>CONSTRUCTOR</th>
                  <th>LAPS</th>
                  <th>TIME / GAP</th>
                  <th>BEST LAP</th>
                  <th>STATUS</th>
                </tr>
              </thead>
              <tbody>
                ${classification.map(r => `
                  <tr class="${r.isPlayer ? 'qr-row-player' : ''}">
                    <td class="qr-cell-pos"><strong>P${r.position}</strong></td>
                    <td class="qr-cell-num">${r.number}</td>
                    <td class="qr-cell-driver">
                      <span class="qr-team-bar" style="background:${r.teamColor}"></span>
                      <span class="qr-driver-name">${r.name}</span>
                      <span class="qr-driver-code">${r.driverCode}</span>
                      ${r.isPlayer ? '<span class="f1-badge-subtle">YOU</span>' : ''}
                    </td>
                    <td class="qr-cell-team">${r.team}</td>
                    <td class="qr-cell-laps">${r.completedLaps}/${r.totalLaps}</td>
                    <td class="qr-cell-gap"><strong>${r.gapText}</strong></td>
                    <td class="qr-cell-best">
                      ${r.hasFastestLap ? `
                        <span class="qr-fl-badge" title="Fastest Lap of the Race">🟣 ${r.bestLapFormatted}</span>
                      ` : `
                        <span>${r.bestLapFormatted}</span>
                      `}
                    </td>
                    <td class="qr-cell-status">
                      <span class="qr-status-tag ${r.status.includes('Penalty') ? 'qr-status-pen' : ''}">${r.status}</span>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>

          <!-- Results Actions -->
          <div class="qr-results-actions">
            <button type="button" class="f1-btn-ghost" id="btnQRReturnMenu">← RETURN TO MENU</button>
            <div class="qr-results-btn-group">
              <button type="button" class="f1-btn-secondary" id="btnQRConfigure">⚙️ CONFIGURE RACE</button>
              <button type="button" class="f1-btn-primary f1-btn-gold" id="btnQRRestart">🔄 RESTART RACE</button>
            </div>
          </div>
        </div>
      </div>
    `;

    container.querySelector('#btnQRResultsHeaderBack')?.addEventListener('click', onReturnMenu);
    container.querySelector('#btnQRResultsHeaderClose')?.addEventListener('click', onReturnMenu);
    container.querySelector('#btnQRReturnMenu')?.addEventListener('click', onReturnMenu);
    container.querySelector('#btnQRConfigure')?.addEventListener('click', onConfigure);
    container.querySelector('#btnQRRestart')?.addEventListener('click', onRestart);
  }

  // ── 4. Qualifying Shootout Screen ───────────────────────────────────────

  /**
   * Render Official Full-Field Qualifying Shootout Screen.
   */
  static renderQualifying(container, { config, circuit, results, onRunQuali, onConfirmGrid, onBack }) {
    const fSize = config.fieldSize || 20;

    container.innerHTML = `
      <div class="f1-modal-backdrop">
        <div class="f1-stage-card f1-card-wide qr-quali-card">
          <div class="f1-stage-nav">
            <button type="button" class="f1-btn-ghost btn-modal-back" id="btnQRQualiBack">← Setup</button>
            <span class="f1-badge-red">QUALIFYING SHOOTOUT</span>
            <button type="button" class="f1-btn-close btn-modal-close" id="btnQRQualiClose" aria-label="Close">&times;</button>
          </div>

          <div class="f1-stage-header">
            <h1>Official Qualifying &middot; ${circuit.name}</h1>
            <p class="f1-sub">Low-fuel trim, soft Pirelli tyres, all ${fSize} cars battling for Pole Position.</p>
          </div>

          ${!results ? `
            <!-- Pre-Quali Action Box -->
            <div class="f1-quali-pre">
              <p>Ready to set flying laps around ${circuit.name}? All ${fSize} cars will participate with fresh Soft tyres in qualifying trim.</p>
              <button type="button" class="f1-btn-primary f1-btn-lg" id="btnQRRunQualiAction">
                🚀 RUN FULL-FIELD QUALIFYING SHOOTOUT
              </button>
            </div>
          ` : `
            <!-- Live Timing Results Classification -->
            <div class="f1-quali-results-table">
              <div class="f1-table-head f1-quali-head-extended">
                <span>Pos</span>
                <span>Driver</span>
                <span>Team</span>
                <span>S1</span>
                <span>S2</span>
                <span>S3</span>
                <span>Time</span>
                <span style="text-align:right">Gap</span>
              </div>
              <div class="f1-table-rows">
                ${results.map(r => `
                  <div class="f1-table-row ${r.isPlayer ? 'player-row qr-row-player' : ''}">
                    <span class="f1-pos-badge ${r.isPole ? 'pole-badge' : ''}">${r.position}</span>
                    <span class="f1-driver-col">
                      <i class="f1-col-dot" style="background:${r.color || r.teamColor}"></i>
                      <strong>${r.name}</strong> (${r.driverCode})
                      ${r.isPlayer ? '<small class="player-tag">YOU</small>' : ''}
                    </span>
                    <span class="f1-team-col">${r.team}</span>
                    <span class="f1-sector-col">${r.sector1Formatted || '-'}</span>
                    <span class="f1-sector-col">${r.sector2Formatted || '-'}</span>
                    <span class="f1-sector-col">${r.sector3Formatted || '-'}</span>
                    <span class="f1-time-col"><strong>${r.formattedTime}</strong></span>
                    <span class="f1-gap-col ${r.isPole ? 'pole-text' : ''}">${r.gapFormatted}</span>
                  </div>
                `).join('')}
              </div>
            </div>

            <div class="f1-stage-actions">
              <button type="button" class="f1-btn-primary f1-btn-lg" id="btnQRConfirmGridAction">
                CONFIRM STARTING GRID →
              </button>
            </div>
          `}
        </div>
      </div>
    `;

    container.querySelector('#btnQRQualiBack')?.addEventListener('click', onBack);
    container.querySelector('#btnQRQualiClose')?.addEventListener('click', onBack);
    container.querySelector('#btnQRRunQualiAction')?.addEventListener('click', onRunQuali);
    container.querySelector('#btnQRConfirmGridAction')?.addEventListener('click', onConfirmGrid);
  }

  // ── 5. Starting Grid Confirmation Screen ────────────────────────────────

  /**
   * Render Official Starting Grid in authentic staggered F1 layout.
   */
  static renderStartingGrid(container, { config, circuit, grid, onStartRace, onBack }) {
    container.innerHTML = `
      <div class="f1-modal-backdrop">
        <div class="f1-stage-card f1-card-wide qr-grid-card">
          <div class="f1-stage-nav">
            <button type="button" class="f1-btn-ghost btn-modal-back" id="btnQRGridBack">← Qualifying</button>
            <span class="f1-badge-red">OFFICIAL STARTING GRID</span>
            <button type="button" class="f1-btn-close btn-modal-close" id="btnQRGridClose" aria-label="Close">&times;</button>
          </div>

          <div class="f1-stage-header">
            <h1>Starting Grid &middot; ${circuit.name}</h1>
            <p class="f1-sub">${grid.length} cars in staggered 2-by-2 grid slots. P1 starts on the clean racing line.</p>
          </div>

          <!-- Staggered 2-by-2 Grid Visual -->
          <div class="f1-grid-staggered">
            ${grid.map((g, idx) => {
              const pos = idx + 1;
              const isEven = (pos % 2 === 0);
              const isPlayer = (g.code === config.playerDriverCode);
              return `
                <div class="f1-grid-slot ${isEven ? 'slot-right' : 'slot-left'} ${isPlayer ? 'slot-player qr-slot-player' : ''}">
                  <span class="f1-slot-num">P${pos}</span>
                  <div class="f1-slot-info">
                    <span class="f1-slot-driver">
                      <i class="f1-col-dot" style="background:${g.color || g.teamColor}"></i>
                      <strong>${g.name}</strong> (${g.code})
                      ${isPlayer ? '<small class="player-tag">YOU</small>' : ''}
                    </span>
                    <span class="f1-slot-team">${g.team}</span>
                  </div>
                </div>
              `;
            }).join('')}
          </div>

          <div class="f1-stage-actions">
            <button type="button" class="f1-btn-primary f1-btn-lg f1-btn-gold" id="btnQRStartRaceAction">
              🏁 START GRAND PRIX
            </button>
          </div>
        </div>
      </div>
    `;

    container.querySelector('#btnQRGridBack')?.addEventListener('click', onBack);
    container.querySelector('#btnQRGridClose')?.addEventListener('click', onBack);
    container.querySelector('#btnQRStartRaceAction')?.addEventListener('click', onStartRace);
  }
}

// ── Wizard Step Title Helper ──────────────────────────────────────────────

function getStepTitle(step) {
  switch (step) {
    case 1: return 'Format & Race Distance';
    case 2: return 'Circuit Selection';
    case 3: return 'Driver, Manager & Car Selection';
    case 4: return 'Grid Configuration & Qualifying';
    case 5: return 'Race Conditions & Rules';
    case 6: return 'Review & Launch';
    default: return '';
  }
}

// ── Step Content Renderers ────────────────────────────────────────────────

function renderStepBody(step, w) {
  switch (step) {
    case 1: return renderStep1Format(w);
    case 2: return renderStep2Circuit(w);
    case 3: return renderStep3Lineup(w);
    case 4: return renderStep4Grid(w);
    case 5: return renderStep5Conditions(w);
    case 6: return renderStep6Review(w);
    default: return '';
  }
}

// ── Step 1: Format & Distance ─────────────────────────────────────────────

function renderStep1Format(w) {
  const circuit = getCircuit(w.circuitId);
  const isDistanceMode = (w.lapMode === 'distance');
  const distanceKm = w.targetDistanceKm || 25;
  const distCalc = calculateLapsFromDistance(circuit.lengthM, distanceKm, circuit.name);

  return `
    <div class="qr-step-content">
      <div class="qr-section-desc">
        <h3>RACE FORMAT & FIELD SIZE</h3>
        <p>Choose the size of the competitive grid and configure race duration either by lap count or target distance.</p>
      </div>

      <!-- Field Size Selector -->
      <div class="qr-config-block">
        <label class="qr-block-label">Number of Cars on Grid (${w.fieldSize || 20} Cars)</label>
        <div class="qr-chip-row">
          ${FIELD_SIZE_PRESETS.map(p => `
            <button type="button" class="qr-chip ${w.fieldSize === p.size ? 'active' : ''}" data-field-size="${p.size}">
              <strong>${p.size} Cars</strong>
              <small>${p.desc}</small>
            </button>
          `).join('')}
        </div>
        <div class="qr-slider-row">
          <span>Custom Grid Size:</span>
          <input type="range" id="inputFieldSize" min="2" max="20" step="1" value="${w.fieldSize || 20}" class="f1-range">
          <span class="qr-val-badge" id="valFieldSize">${w.fieldSize || 20}</span>
        </div>
      </div>

      <!-- Lap Mode Selector -->
      <div class="qr-config-block">
        <label class="qr-block-label">Race Distance Mode</label>
        <div class="qr-mode-toggle-row">
          <button type="button" class="qr-toggle-btn ${!isDistanceMode ? 'active' : ''}" id="btnModeLaps">By Lap Count</button>
          <button type="button" class="qr-toggle-btn ${isDistanceMode ? 'active' : ''}" id="btnModeDistance">By Target Distance (km)</button>
        </div>

        ${!isDistanceMode ? `
          <!-- Lap Presets & Custom Slider -->
          <div class="qr-sub-block">
            <div class="qr-chip-row">
              ${LAP_PRESETS.map(lp => `
                <button type="button" class="qr-chip ${w.totalLaps === lp.laps ? 'active' : ''}" data-lap-preset="${lp.laps}">
                  <strong>${lp.laps} Laps</strong>
                  <small>${lp.desc}</small>
                </button>
              `).join('')}
            </div>
            <div class="qr-slider-row">
              <span>Custom Lap Count:</span>
              <input type="range" id="inputTotalLaps" min="1" max="50" step="1" value="${w.totalLaps || 5}" class="f1-range">
              <span class="qr-val-badge" id="valTotalLaps">${w.totalLaps || 5} Laps</span>
            </div>
            <div class="qr-info-box">
              <span>ℹ️ At ${circuit.name} (${circuit.lengthM.toLocaleString()} metres), a ${w.totalLaps || 5}-lap race covers approximately <strong>${(((w.totalLaps || 5) * circuit.lengthM) / 1000).toFixed(2)} kilometres</strong>.</span>
            </div>
          </div>
        ` : `
          <!-- Distance Presets & Custom Slider -->
          <div class="qr-sub-block">
            <div class="qr-chip-row">
              ${DISTANCE_PRESETS.map(dp => `
                <button type="button" class="qr-chip ${w.distancePreset === dp.id ? 'active' : ''}" data-dist-preset="${dp.id}" data-dist-km="${dp.targetKm}">
                  <strong>${dp.label}</strong>
                  <small>${dp.desc}</small>
                </button>
              `).join('')}
            </div>
            <div class="qr-slider-row">
              <span>Target Kilometres:</span>
              <input type="range" id="inputTargetDistance" min="10" max="150" step="5" value="${distanceKm}" class="f1-range">
              <span class="qr-val-badge" id="valTargetDistance">${distanceKm} km</span>
            </div>
            <!-- Distance-to-Laps Live Explanation Box -->
            <div class="qr-info-box qr-dist-calc-box">
              <div class="qr-calc-title">📐 DISTANCE TO LAPS CALCULATION</div>
              <p class="qr-calc-text">${distCalc.explanation}</p>
              <div class="qr-calc-badge-row">
                <span class="f1-badge-subtle">Target: ${distCalc.targetDistanceKm} km</span>
                <span class="f1-badge-gold">Calculated: ${distCalc.laps} Laps</span>
                <span class="f1-badge-subtle">Actual: ${distCalc.actualDistanceKm} km</span>
              </div>
            </div>
          </div>
        `}
      </div>
    </div>
  `;
}

// ── Step 2: Circuit Selection ─────────────────────────────────────────────

function renderStep2Circuit(w) {
  return renderCircuitSelection(w);
}

// ── Step 3: Driver, Manager & Car Selection ───────────────────────────────

function renderStep3Lineup(w) {
  const curDriver = getDriver(w.playerDriverCode) || DRIVERS[0];
  const curMgr = getManager(w.playerManagerId) || MANAGERS[0];
  const curCar = getCar(w.playerCarId) || CARS[0];

  return `
    <div class="qr-step-content">
      <div class="qr-section-desc">
        <h3>DRIVER, MANAGER & CAR SELECTION</h3>
        <p>Pick your racing package. Choose any driver from the 2025 roster, team principal manager bonuses, and constructor car performance modifiers.</p>
      </div>

      <!-- 1. Driver Picker -->
      <div class="qr-config-block">
        <label class="qr-block-label">Player Driver: <strong style="color:${curDriver.teamColor}">${curDriver.name} (${curDriver.code} · ${curDriver.team})</strong></label>
        <div class="qr-roster-grid">
          ${DRIVERS.map(d => {
            const isSel = (w.playerDriverCode === d.code);
            return `
              <div class="qr-roster-card ${isSel ? 'active' : ''}" data-driver-code="${d.code}">
                <div class="qr-card-top" style="border-left: 4px solid ${d.teamColor}">
                  <span class="qr-driver-num">#${d.number}</span>
                  <span class="qr-driver-name">${d.name}</span>
                  <span class="qr-driver-team">${d.team}</span>
                </div>
                <div class="qr-card-stats">
                  <span title="Base Pace Rating">Pace: <strong>${Math.round((d.pace || 0.95) * 100)}</strong></span>
                  <span title="Attacking Skill">Attack: <strong>${Math.round((d.personality?.attackSkill || 0.8) * 100)}</strong></span>
                  <span title="Tyre Management">Tyres: <strong>${Math.round((d.personality?.tyreManagement || 0.8) * 100)}</strong></span>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <!-- 2. Constructor Car Picker -->
      <div class="qr-config-block">
        <label class="qr-block-label">Constructor Car: <strong>${curCar.name} (${curCar.team})</strong></label>
        <div class="qr-car-grid">
          ${CARS.map(c => {
            const isSel = (w.playerCarId === c.id);
            return `
              <div class="qr-car-card ${isSel ? 'active' : ''}" data-car-id="${c.id}">
                <div class="qr-car-header" style="border-left: 4px solid ${c.color}">
                  <span class="qr-car-badge">${c.badge}</span>
                  <strong>${c.name}</strong>
                </div>
                <div class="qr-car-stats-row">
                  <span>Speed: ${c.stats?.topSpeed || 90}</span>
                  <span>Cornering: ${c.stats?.cornering || 90}</span>
                  <span>Tyres: ${c.stats?.tyrePreservation || 90}</span>
                </div>
                <small class="qr-car-strength">${c.strengths || ''}</small>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <!-- 3. Team Principal / Manager Picker -->
      <div class="qr-config-block">
        <label class="qr-block-label">Team Principal: <strong>${curMgr.name} (${curMgr.team})</strong></label>
        <div class="qr-mgr-grid">
          ${MANAGERS.map(m => {
            const isSel = (w.playerManagerId === m.id);
            return `
              <div class="qr-mgr-card ${isSel ? 'active' : ''}" data-mgr-id="${m.id}">
                <div class="qr-mgr-header">
                  <span class="qr-mgr-avatar">${m.avatar}</span>
                  <div class="qr-mgr-meta">
                    <strong>${m.name}</strong>
                    <small>${m.team} &middot; Rating ${m.rating}</small>
                  </div>
                </div>
                <small class="qr-mgr-style">${m.style}</small>
                <div class="qr-mgr-perks">
                  ${(m.perks || []).slice(0, 2).map(p => `<span>• ${p}</span>`).join('')}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    </div>
  `;
}

// ── Step 4: Grid Configuration & Qualifying ───────────────────────────────

function renderStep4Grid(w) {
  const fSize = w.fieldSize || 20;
  const isQualiEnabled = !!w.includeQualifying;
  const directGridModes = GRID_MODES.filter(gm => gm.id !== 'qualifying');

  return `
    <div class="qr-step-content">
      <div class="qr-section-desc">
        <h3>STARTING GRID CONFIGURATION & QUALIFYING</h3>
        <p>Choose whether to run a full-field qualifying shootout or determine the starting grid directly via random, performance, or custom slot methods.</p>
      </div>

      <!-- Include Qualifying Toggle -->
      <div class="qr-config-block">
        <label class="qr-block-label">Include Qualifying Shootout</label>
        <p class="qr-block-sub">When enabled, all ${fSize} cars compete in an official flying-lap qualifying shootout to earn their starting grid positions. When disabled, the starting grid is determined directly by the grid method below.</p>
        <div class="qr-chip-row">
          <button type="button" class="qr-chip ${isQualiEnabled ? 'active' : ''}" data-quali="true">
            <strong>⏱️ QUALIFYING: ON</strong>
            <small>Flying lap shootout determines starting grid</small>
          </button>
          <button type="button" class="qr-chip ${!isQualiEnabled ? 'active' : ''}" data-quali="false">
            <strong>⚡ QUALIFYING: OFF</strong>
            <small>Skip qualifying & use direct starting grid</small>
          </button>
        </div>
      </div>

      ${isQualiEnabled ? `
        <!-- Qualifying Active Information Card -->
        <div class="qr-config-block qr-quali-active-card">
          <div class="qr-quali-badge">🏁 FULL-FIELD QUALIFYING ACTIVE</div>
          <p>Every single car on the grid (${fSize} competitors) will run official flying laps in qualifying trim (low fuel, fresh Soft Pirelli tyres). Sector splits (S1, S2, S3) and lap times will decide Pole Position through P${fSize}.</p>
        </div>
      ` : `
        <!-- Direct Grid Mode Selector (When Qualifying is OFF) -->
        <div class="qr-config-block">
          <label class="qr-block-label">Direct Starting Grid Order Method</label>
          <div class="qr-chip-row">
            ${directGridModes.map(gm => `
              <button type="button" class="qr-chip ${w.gridMode === gm.id ? 'active' : ''}" data-grid-mode="${gm.id}">
                <strong>${gm.label}</strong>
                <small>${gm.desc}</small>
              </button>
            `).join('')}
          </div>
        </div>

        <!-- Custom Position Slider (if custom mode) -->
        ${w.gridMode === 'custom' ? `
          <div class="qr-config-block">
            <label class="qr-block-label">Player Starting Position (P${w.customPlayerPosition || 1} of ${fSize})</label>
            <div class="qr-slider-row">
              <span>Grid Slot:</span>
              <input type="range" id="inputCustomPos" min="1" max="${fSize}" step="1" value="${w.customPlayerPosition || 1}" class="f1-range">
              <span class="qr-val-badge">P${w.customPlayerPosition || 1}</span>
            </div>
            <div class="qr-slot-shortcuts">
              <button type="button" class="f1-btn-subtle" data-set-pos="1">🏁 Pole Position (P1)</button>
              <button type="button" class="f1-btn-subtle" data-set-pos="${Math.ceil(fSize / 2)}">Midfield (P${Math.ceil(fSize / 2)})</button>
              <button type="button" class="f1-btn-subtle" data-set-pos="${fSize}">Back of Grid (P${fSize})</button>
            </div>
          </div>
        ` : ''}
      `}

      <!-- Grid Preview Diagram -->
      <div class="qr-config-block">
        <label class="qr-block-label">Staggered 2x2 Starting Grid Preview (${fSize} Cars)</label>
        <div class="qr-grid-diagram">
          ${renderGridPreviewDiagram(w)}
        </div>
      </div>
    </div>
  `;
}

function renderGridPreviewDiagram(w) {
  const fSize = w.fieldSize || 20;
  const playerPos = (w.gridMode === 'custom') ? (w.customPlayerPosition || 1) : 1;
  const pDriver = getDriver(w.playerDriverCode) || DRIVERS[0];

  let slotsHtml = '';
  for (let i = 1; i <= fSize; i++) {
    const isPlayer = (i === playerPos && w.gridMode === 'custom');
    const isOdd = (i % 2 !== 0); // Left vs right side of track
    slotsHtml += `
      <div class="qr-grid-slot ${isOdd ? 'slot-left' : 'slot-right'} ${isPlayer ? 'slot-player' : ''}">
        <span class="slot-pos">P${i}</span>
        <span class="slot-driver">${isPlayer ? `${pDriver.code} (YOU)` : `Car ${i}`}</span>
      </div>
    `;
  }
  return `<div class="qr-grid-track">${slotsHtml}</div>`;
}

// ── Step 5: Conditions & Rules ────────────────────────────────────────────

function renderStep5Conditions(w) {
  return `
    <div class="qr-step-content">
      <div class="qr-section-desc">
        <h3>RACE CONDITIONS & SIMULATION RULES</h3>
        <p>Set track weather, AI competitor difficulty, initial tyre compound, and safety car / incident rules.</p>
      </div>

      <!-- Weather Preset -->
      <div class="qr-config-block">
        <label class="qr-block-label">Weather Forecast</label>
        <div class="qr-chip-row">
          ${WEATHER_OPTIONS.map(wo => `
            <button type="button" class="qr-chip ${w.weatherPreset === wo.id ? 'active' : ''}" data-weather="${wo.id}">
              <strong>${wo.label}</strong>
              <small>${wo.desc}</small>
            </button>
          `).join('')}
        </div>
      </div>

      <!-- AI Difficulty -->
      <div class="qr-config-block">
        <label class="qr-block-label">AI Competitor Difficulty</label>
        <div class="qr-chip-row">
          ${AI_DIFFICULTIES.map(ad => `
            <button type="button" class="qr-chip ${w.aiDifficulty === ad.id ? 'active' : ''}" data-difficulty="${ad.id}">
              <strong>${ad.label}</strong>
              <small>${ad.desc}</small>
            </button>
          `).join('')}
        </div>
      </div>

      <!-- Starting Tyre Compound -->
      <div class="qr-config-block">
        <label class="qr-block-label">Starting Tyre Compound</label>
        <div class="qr-chip-row">
          ${TYRE_COMPOUNDS.map(tc => `
            <button type="button" class="qr-chip ${w.startingCompound === tc.id ? 'active' : ''}" data-compound="${tc.id}">
              <strong>${tc.badge}</strong>
              <small>${tc.desc}</small>
            </button>
          `).join('')}
        </div>
      </div>

      <!-- Car Setup & Aerodynamic Tuning (Phase 10) -->
      <div class="qr-config-block">
        <label class="qr-block-label">Vehicle Setup & Aerodynamic Tuning</label>
        <div class="qr-setup-grid" style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 12px;">
          <div class="qr-setup-item" style="background: rgba(255,255,255,0.03); padding: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.08);">
            <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:4px;">
              <span>Front Wing Angle</span>
              <strong id="valFrontWing">${w.carSetup?.frontWing ?? 6}</strong>
            </div>
            <input type="range" id="rngFrontWing" min="0" max="10" value="${w.carSetup?.frontWing ?? 6}" style="width:100%;">
            <small style="color:#888; font-size:10px;">Downforce vs straight-line drag</small>
          </div>
          <div class="qr-setup-item" style="background: rgba(255,255,255,0.03); padding: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.08);">
            <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:4px;">
              <span>Rear Wing Angle</span>
              <strong id="valRearWing">${w.carSetup?.rearWing ?? 6}</strong>
            </div>
            <input type="range" id="rngRearWing" min="0" max="10" value="${w.carSetup?.rearWing ?? 6}" style="width:100%;">
            <small style="color:#888; font-size:10px;">High-speed grip vs top speed</small>
          </div>
          <div class="qr-setup-item" style="background: rgba(255,255,255,0.03); padding: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.08);">
            <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:4px;">
              <span>Brake Bias (% Front)</span>
              <strong id="valBrakeBias">${w.carSetup?.brakeBias ?? 56}%</strong>
            </div>
            <input type="range" id="rngBrakeBias" min="50" max="62" value="${w.carSetup?.brakeBias ?? 56}" style="width:100%;">
            <small style="color:#888; font-size:10px;">Front stability vs rear rotation</small>
          </div>
          <div class="qr-setup-item" style="background: rgba(255,255,255,0.03); padding: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.08);">
            <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:4px;">
              <span>Differential Lock</span>
              <strong id="valDiffLock">${w.carSetup?.differential ?? 70}%</strong>
            </div>
            <input type="range" id="rngDiffLock" min="50" max="90" value="${w.carSetup?.differential ?? 70}" style="width:100%;">
            <small style="color:#888; font-size:10px;">Traction acceleration vs turn-in</small>
          </div>
        </div>
      </div>

      <!-- Rules & Subsystems Toggles -->
      <div class="qr-config-block">
        <label class="qr-block-label">Race Control & Subsystems</label>
        <div class="qr-toggles-grid">
          <label class="qr-toggle-card">
            <input type="checkbox" id="chkSafetyCar" ${w.safetyCarEnabled ? 'checked' : ''}>
            <div class="qr-toggle-label">
              <strong>Physical Safety Car & VSC</strong>
              <small>Autonomous full-course safety car deployments on major incidents</small>
            </div>
          </label>
          <label class="qr-toggle-card">
            <input type="checkbox" id="chkDamage" ${w.damageEnabled ? 'checked' : ''}>
            <div class="qr-toggle-label">
              <strong>Mechanical Damage & Wear</strong>
              <small>Physical tyre degradation, brake fading, and aerodynamic dirty air</small>
            </div>
          </label>
          <label class="qr-toggle-card">
            <input type="checkbox" id="chkPenalties" ${w.penaltiesEnabled ? 'checked' : ''}>
            <div class="qr-toggle-label">
              <strong>FIA Penalties & Investigations</strong>
              <small>Autonomous steward investigations for jump starts and collisions</small>
            </div>
          </label>
          <label class="qr-toggle-card">
            <input type="checkbox" id="chkBattery" ${w.batteryEnabled ? 'checked' : ''}>
            <div class="qr-toggle-label">
              <strong>Hybrid ERS & Battery Deploy</strong>
              <small>Manual Attack / Charge deployment modes and energy recovery</small>
            </div>
          </label>
          <label class="qr-toggle-card">
            <input type="checkbox" id="chkDRS" ${w.drsEnabled ? 'checked' : ''}>
            <div class="qr-toggle-label">
              <strong>DRS Drag Reduction System</strong>
              <small>Wing flap activation within 1.0s detection gap in designated zones</small>
            </div>
          </label>
        </div>
      </div>
    </div>
  `;
}

// ── Step 6: Review & Launch ───────────────────────────────────────────────

function renderStep6Review(w) {
  const circuit = getCircuit(w.circuitId);
  const pDriver = getDriver(w.playerDriverCode) || DRIVERS[0];
  const pMgr = getManager(w.playerManagerId) || MANAGERS[0];
  const pCar = getCar(w.playerCarId) || CARS[0];

  const laps = (w.lapMode === 'distance')
    ? calculateLapsFromDistance(circuit.lengthM, w.targetDistanceKm, circuit.name).laps
    : (w.totalLaps || 5);
  const totalKm = ((laps * circuit.lengthM) / 1000).toFixed(2);

  const gridModeDesc = GRID_MODES.find(m => m.id === w.gridMode)?.label || 'Qualifying';
  const weatherDesc = WEATHER_OPTIONS.find(m => m.id === w.weatherPreset)?.label || 'Dry';
  const diffDesc = AI_DIFFICULTIES.find(m => m.id === w.aiDifficulty)?.label || 'Normal';

  return `
    <div class="qr-step-content">
      <div class="qr-section-desc">
        <h3>REVIEW & LAUNCH GRAND PRIX</h3>
        <p>Confirm your custom Quick Race configuration before heading to the starting grid.</p>
      </div>

      <div class="qr-review-grid">
        <!-- 1. Circuit Summary Card -->
        <div class="qr-review-card">
          <span class="qr-review-badge">CIRCUIT</span>
          <h4>${circuit.name}</h4>
          <p>${circuit.country} &middot; ${(circuit.lengthM / 1000).toFixed(3)} km &middot; ${circuit.turns} Turns</p>
          <div class="qr-review-subtag">Lap Record: ${circuit.rec ? circuit.rec.toFixed(3) + 's' : '–'}</div>
        </div>

        <!-- 2. Race Format Card -->
        <div class="qr-review-card">
          <span class="qr-review-badge">FORMAT & DISTANCE</span>
          <h4>${w.fieldSize || 20} Competitors &middot; ${laps} Laps</h4>
          <p>Total Race Distance: <strong>${totalKm} kilometres</strong> (${circuit.lengthM.toLocaleString()} m/lap)</p>
          <div class="qr-review-subtag">Mode: ${w.lapMode === 'distance' ? `Target ${w.targetDistanceKm} km` : `${laps} Laps`}</div>
        </div>

        <!-- 3. Player Lineup Card -->
        <div class="qr-review-card">
          <span class="qr-review-badge">YOUR TEAM PACKAGE</span>
          <h4 style="color:${pDriver.teamColor}">${pDriver.name} (${pDriver.code})</h4>
          <p>Car: ${pCar.name} &middot; Principal: ${pMgr.name}</p>
          <div class="qr-review-subtag">Starting Tyres: ${w.startingCompound?.toUpperCase() || 'MEDIUM'}</div>
        </div>

        <!-- 4. Grid & Rules Card -->
        <div class="qr-review-card">
          <span class="qr-review-badge">GRID & QUALIFYING</span>
          <h4>${w.includeQualifying ? '⏱️ Qualifying: ON' : `⚡ Direct Grid: ${gridModeDesc}`}</h4>
          <p>${w.includeQualifying ? 'Full-field flying lap session will determine the starting grid' : `Grid order determined directly by ${gridModeDesc}`}</p>
          <div class="qr-review-subtag">Weather: ${weatherDesc} &middot; AI: ${diffDesc}</div>
        </div>
      </div>

      <div class="qr-launch-prompt">
        <p>${w.includeQualifying ? 'Press <strong>PROCEED TO QUALIFYING</strong> to begin the full-field shootout.' : 'Ready to hit the track? Press <strong>START RACE</strong> to form the grid.'}</p>
      </div>
    </div>
  `;
}

// ── Event Handlers & Input State Extraction ───────────────────────────────

function saveStepInputs(step, w, container) {
  if (step === 1) {
    const fSizeInput = container.querySelector('#inputFieldSize');
    if (fSizeInput) w.fieldSize = parseInt(fSizeInput.value, 10);

    const lapsInput = container.querySelector('#inputTotalLaps');
    if (lapsInput) w.totalLaps = parseInt(lapsInput.value, 10);

    const distInput = container.querySelector('#inputTargetDistance');
    if (distInput) w.targetDistanceKm = parseFloat(distInput.value);
  } else if (step === 4) {
    const customPosInput = container.querySelector('#inputCustomPos');
    if (customPosInput) w.customPlayerPosition = parseInt(customPosInput.value, 10);
  } else if (step === 5) {
    const sc = container.querySelector('#chkSafetyCar');
    if (sc) w.safetyCarEnabled = sc.checked;

    const dmg = container.querySelector('#chkDamage');
    if (dmg) w.damageEnabled = dmg.checked;

    const pen = container.querySelector('#chkPenalties');
    if (pen) w.penaltiesEnabled = pen.checked;

    const batt = container.querySelector('#chkBattery');
    if (batt) w.batteryEnabled = batt.checked;

    const drs = container.querySelector('#chkDRS');
    if (drs) w.drsEnabled = drs.checked;

    if (!w.carSetup) w.carSetup = { frontWing: 6, rearWing: 6, suspension: 3, rideHeight: 3, brakeBias: 56, differential: 70, tyrePressurePsi: 23.0 };
    const fw = container.querySelector('#rngFrontWing');
    if (fw) w.carSetup.frontWing = parseInt(fw.value, 10);
    const rw = container.querySelector('#rngRearWing');
    if (rw) w.carSetup.rearWing = parseInt(rw.value, 10);
    const bb = container.querySelector('#rngBrakeBias');
    if (bb) w.carSetup.brakeBias = parseInt(bb.value, 10);
    const df = container.querySelector('#rngDiffLock');
    if (df) w.carSetup.differential = parseInt(df.value, 10);
  }
}

function bindStepEvents(step, w, container, rerender) {
  if (step === 1) {
    // Field size chips
    container.querySelectorAll('[data-field-size]').forEach(btn => {
      btn.addEventListener('click', e => {
        w.fieldSize = parseInt(e.currentTarget.dataset.fieldSize, 10);
        rerender();
      });
    });

    const fSizeSlider = container.querySelector('#inputFieldSize');
    fSizeSlider?.addEventListener('input', e => {
      w.fieldSize = parseInt(e.target.value, 10);
      const valBadge = container.querySelector('#valFieldSize');
      if (valBadge) valBadge.textContent = w.fieldSize;
    });

    // Lap Mode toggle
    container.querySelector('#btnModeLaps')?.addEventListener('click', () => {
      w.lapMode = 'laps';
      rerender();
    });
    container.querySelector('#btnModeDistance')?.addEventListener('click', () => {
      w.lapMode = 'distance';
      rerender();
    });

    // Lap presets
    container.querySelectorAll('[data-lap-preset]').forEach(btn => {
      btn.addEventListener('click', e => {
        w.totalLaps = parseInt(e.currentTarget.dataset.lapPreset, 10);
        rerender();
      });
    });

    // Distance presets
    container.querySelectorAll('[data-dist-preset]').forEach(btn => {
      btn.addEventListener('click', e => {
        w.distancePreset = e.currentTarget.dataset.distPreset;
        w.targetDistanceKm = parseFloat(e.currentTarget.dataset.distKm);
        rerender();
      });
    });

    const lapsSlider = container.querySelector('#inputTotalLaps');
    lapsSlider?.addEventListener('input', e => {
      w.totalLaps = parseInt(e.target.value, 10);
      const badge = container.querySelector('#valTotalLaps');
      if (badge) badge.textContent = `${w.totalLaps} Laps`;
    });

    const distSlider = container.querySelector('#inputTargetDistance');
    distSlider?.addEventListener('input', e => {
      w.targetDistanceKm = parseFloat(e.target.value);
      rerender();
    });
  } else if (step === 2) {
    bindCircuitSelectionEvents(container, w, rerender);
  } else if (step === 3) {
    container.querySelectorAll('.qr-roster-card').forEach(card => {
      card.addEventListener('click', e => {
        w.playerDriverCode = e.currentTarget.dataset.driverCode;
        rerender();
      });
    });
    container.querySelectorAll('.qr-car-card').forEach(card => {
      card.addEventListener('click', e => {
        w.playerCarId = e.currentTarget.dataset.carId;
        rerender();
      });
    });
    container.querySelectorAll('.qr-mgr-card').forEach(card => {
      card.addEventListener('click', e => {
        w.playerManagerId = e.currentTarget.dataset.mgrId;
        rerender();
      });
    });
  } else if (step === 4) {
    container.querySelectorAll('[data-quali]').forEach(btn => {
      btn.addEventListener('click', e => {
        w.includeQualifying = (e.currentTarget.dataset.quali === 'true');
        if (w.includeQualifying) {
          w.gridMode = 'qualifying';
        } else if (w.gridMode === 'qualifying') {
          w.gridMode = 'random';
        }
        rerender();
      });
    });
    container.querySelectorAll('[data-grid-mode]').forEach(btn => {
      btn.addEventListener('click', e => {
        w.gridMode = e.currentTarget.dataset.gridMode;
        rerender();
      });
    });
    container.querySelectorAll('[data-set-pos]').forEach(btn => {
      btn.addEventListener('click', e => {
        w.customPlayerPosition = parseInt(e.currentTarget.dataset.setPos, 10);
        rerender();
      });
    });
    const posSlider = container.querySelector('#inputCustomPos');
    posSlider?.addEventListener('input', e => {
      w.customPlayerPosition = parseInt(e.target.value, 10);
      rerender();
    });
  } else if (step === 5) {
    container.querySelectorAll('[data-weather]').forEach(btn => {
      btn.addEventListener('click', e => {
        w.weatherPreset = e.currentTarget.dataset.weather;
        rerender();
      });
    });
    container.querySelectorAll('[data-difficulty]').forEach(btn => {
      btn.addEventListener('click', e => {
        w.aiDifficulty = e.currentTarget.dataset.difficulty;
        rerender();
      });
    });
    container.querySelectorAll('[data-compound]').forEach(btn => {
      btn.addEventListener('click', e => {
        w.startingCompound = e.currentTarget.dataset.compound;
        rerender();
      });
    });

    container.querySelector('#rngFrontWing')?.addEventListener('input', e => {
      if (!w.carSetup) w.carSetup = { frontWing: 6, rearWing: 6, suspension: 3, rideHeight: 3, brakeBias: 56, differential: 70, tyrePressurePsi: 23.0 };
      w.carSetup.frontWing = parseInt(e.target.value, 10);
      const val = container.querySelector('#valFrontWing');
      if (val) val.textContent = w.carSetup.frontWing;
    });
    container.querySelector('#rngRearWing')?.addEventListener('input', e => {
      if (!w.carSetup) w.carSetup = { frontWing: 6, rearWing: 6, suspension: 3, rideHeight: 3, brakeBias: 56, differential: 70, tyrePressurePsi: 23.0 };
      w.carSetup.rearWing = parseInt(e.target.value, 10);
      const val = container.querySelector('#valRearWing');
      if (val) val.textContent = w.carSetup.rearWing;
    });
    container.querySelector('#rngBrakeBias')?.addEventListener('input', e => {
      if (!w.carSetup) w.carSetup = { frontWing: 6, rearWing: 6, suspension: 3, rideHeight: 3, brakeBias: 56, differential: 70, tyrePressurePsi: 23.0 };
      w.carSetup.brakeBias = parseInt(e.target.value, 10);
      const val = container.querySelector('#valBrakeBias');
      if (val) val.textContent = `${w.carSetup.brakeBias}%`;
    });
    container.querySelector('#rngDiffLock')?.addEventListener('input', e => {
      if (!w.carSetup) w.carSetup = { frontWing: 6, rearWing: 6, suspension: 3, rideHeight: 3, brakeBias: 56, differential: 70, tyrePressurePsi: 23.0 };
      w.carSetup.differential = parseInt(e.target.value, 10);
      const val = container.querySelector('#valDiffLock');
      if (val) val.textContent = `${w.carSetup.differential}%`;
    });
  }
}
