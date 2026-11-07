/**
 * championshipViews.js
 * Comprehensive User Interface & Screen Renderer for F1 Championship Mode.
 *
 * Implements:
 *   - Main Menu (Quick Play vs Championship Mode)
 *   - Multi-step Championship Creation Wizard
 *   - Persistent Championship Hub (Standings, Upcoming Round, Dynamic Actions)
 *   - Weekend Stages: Overview, Practice, Qualifying, Grid, Race Briefing
 *   - Post-Race Official Results & Points Breakdown
 *   - Season Finale Celebration & World Champions Coronation
 *   - Season History & Archived Results
 *   - Live In-Race Championship Projections HUD
 */

import {
  WeekendStage,
  SeasonStatus,
  AI_DIFFICULTY,
  RACE_DISTANCES
} from '../championship/championshipState.js';
import { CIRCUITS, getCircuit } from '../data/circuitData.js';
import { DRIVERS, getDriver } from '../data/driverData.js';
import { QualifyingEngine } from '../championship/qualifyingEngine.js';
import { DriverPsychology } from '../simulation/driverPsychology.js';
import { MANAGERS, getManager } from '../data/managerData.js';
import { CARS, getCar } from '../data/carData.js';
import { getSharedDraftEngine } from '../strategy/draftEngine.js';

export class ChampionshipViews {

  // ── 1. Main Menu ──────────────────────────────────────────────────────────

  /**
   * Render the Main Menu mode selector.
   */
  static renderMainMenu(container, { onQuickPlay, onChampionshipMode, hasActiveChamp }) {
    container.innerHTML = `
      <div class="f1-modal-backdrop">
        <div class="f1-menu-card">
          <div class="f1-menu-header">
            <span class="f1-badge-red">FIA FORMULA ONE WORLD CHAMPIONSHIP</span>
            <h1 class="f1-menu-title">RACING SIMULATOR</h1>
            <p class="f1-menu-sub">Select your motorsport experience</p>
          </div>

          <div class="f1-mode-grid">
            <!-- Quick Play Card -->
            <button type="button" class="f1-mode-btn" id="btnModeQuickPlay">
              <div class="f1-mode-icon">⚡</div>
              <div class="f1-mode-info">
                <h2>QUICK PLAY</h2>
                <p>Jump directly into an individual Grand Prix. Select any circuit, weather scenario, and race distance instantly.</p>
                <span class="f1-mode-tag">STANDALONE RACE</span>
              </div>
            </button>

            <!-- Championship Mode Card -->
            <button type="button" class="f1-mode-btn f1-mode-primary" id="btnModeChampionship">
              <div class="f1-mode-icon">🏆</div>
              <div class="f1-mode-info">
                <h2>CHAMPIONSHIP MODE</h2>
                <p>Embark on an authentic multi-round season. Compete for the Drivers' & Constructors' World Championships with full race weekends and persistent standings.</p>
                <span class="f1-mode-tag f1-tag-gold">${hasActiveChamp ? 'SEASON IN PROGRESS' : 'MULTI-ROUND SEASON'}</span>
              </div>
            </button>
          </div>

          <div class="f1-menu-foot">
            <span>Formula 1 Autonomous Racing Simulation &middot; Official Regulations</span>
          </div>
        </div>
      </div>
    `;

    container.querySelector('#btnModeQuickPlay')?.addEventListener('click', onQuickPlay);
    container.querySelector('#btnModeChampionship')?.addEventListener('click', onChampionshipMode);
  }

  // ── 2. Championship Mode Entry / Select ────────────────────────────────────

  /**
   * Render Championship Entry Screen (New vs Continue vs History).
   */
  static renderChampionshipEntry(container, {
    activeChamp,
    history,
    onContinue,
    onNewChampionship,
    onViewHistory,
    onBackToMain
  }) {
    const hasActive = (activeChamp && activeChamp.status === SeasonStatus.IN_PROGRESS);
    const roundInfo = hasActive ? activeChamp.calendar[activeChamp.currentRoundIndex] : null;

    container.innerHTML = `
      <div class="f1-modal-backdrop">
        <div class="f1-menu-card">
          <div class="f1-menu-nav">
            <button type="button" class="f1-btn-ghost" id="btnEntryBack">← MAIN MENU</button>
            <span class="f1-badge-gold">CHAMPIONSHIP PORTAL</span>
          </div>

          <div class="f1-entry-body">
            ${hasActive ? `
              <!-- Continue Active Season Hero Card -->
              <div class="f1-active-champ-hero">
                <div class="f1-active-badge">ACTIVE SEASON</div>
                <h2>${activeChamp.name}</h2>
                <div class="f1-active-meta">
                  <span>Round ${activeChamp.currentRoundIndex + 1} of ${activeChamp.calendar.length}: <strong>${roundInfo?.circuitName}</strong></span>
                  <span>Driver: <strong>${activeChamp.player.driverName} (${activeChamp.player.team})</strong></span>
                  <span>Stage: <strong>${(roundInfo?.stage || '').replace(/_/g, ' ')}</strong></span>
                </div>
                <div class="f1-hero-actions">
                  <button type="button" class="f1-btn-primary f1-btn-lg" id="btnEntryContinue">
                    ▶ CONTINUE SEASON
                  </button>
                </div>
              </div>
            ` : `
              <!-- Empty State Welcome -->
              <div class="f1-empty-champ">
                <div class="f1-empty-icon">🏆</div>
                <h2>NO ACTIVE CHAMPIONSHIP</h2>
                <p>Begin a new Formula 1 season to race across iconic circuits, score championship points, and fight for the World Championship crown.</p>
              </div>
            `}

            <div class="f1-entry-actions-row">
              <button type="button" class="f1-btn-secondary" id="btnEntryNew">
                + NEW CHAMPIONSHIP
              </button>
              ${history && history.length ? `
                <button type="button" class="f1-btn-ghost" id="btnEntryHistory">
                  📜 SEASON HISTORY (${history.length})
                </button>
              ` : ''}
            </div>
          </div>
        </div>
      </div>
    `;

    container.querySelector('#btnEntryBack')?.addEventListener('click', onBackToMain);
    container.querySelector('#btnEntryContinue')?.addEventListener('click', onContinue);
    container.querySelector('#btnEntryNew')?.addEventListener('click', onNewChampionship);
    container.querySelector('#btnEntryHistory')?.addEventListener('click', onViewHistory);
  }

  // ── 3. Championship Creation Wizard ───────────────────────────────────────

  /**
   * Render Guided Creation Wizard (Steps 1 to 4).
   */
  static renderWizard(container, { onCancel, onComplete }) {
    let currentStep = 1;
    const draftEngine = getSharedDraftEngine();
    const currentDraft = draftEngine.getSummary();
    const initDriver = currentDraft.driver || DRIVERS[0];
    const initManager = currentDraft.manager || MANAGERS[0];
    const initCar = currentDraft.car || CARS[0];

    const wizardState = {
      name: '2025 FIA Formula One World Championship',
      seasonLength: 4,
      raceDistance: 'short',
      aiDifficulty: 'normal',
      rules: {
        practiceEnabled: true,
        qualifyingEnabled: true,
        weatherMode: 'dynamic',
        pointsSystem: 'fia_2025',
        fastestLapPoint: true,
        twoCompoundRule: true,
        mechanicalDamage: true,
        homeAdvantage: true,
        previousWinnerConfidence: true,
        teamRadioMode: 'full'
      },
      player: {
        driverCode: initDriver.code,
        team: initDriver.team,
        teammateCode: DRIVERS.find(d => d.team === initDriver.team && d.code !== initDriver.code)?.code || null,
        managerId: initManager.id,
        carId: initCar.id
      },
      circuitIds: ['monaco', 'silverstone', 'spa', 'monza']
    };

    function updateView() {
      const prevScroll = container.querySelector('.f1-modal-backdrop')?.scrollTop ?? 0;
      const prevStep = updateView._lastStep;

      container.innerHTML = `
        <div class="f1-modal-backdrop">
          <div class="f1-wizard-card">
            <!-- Wizard Header & Progress -->
            <div class="f1-wizard-header">
              <div class="f1-wizard-nav">
                <span class="f1-badge-red">SEASON CREATION WIZARD</span>
                <span class="f1-wizard-step-label">Step ${currentStep} of 4</span>
              </div>
              <div class="f1-wizard-progress">
                <div class="f1-wizard-bar" style="width: ${(currentStep / 4) * 100}%"></div>
              </div>
            </div>

            <!-- Step Body -->
            <div class="f1-wizard-body" id="wizardBody">
              ${renderStepContent(currentStep, wizardState)}
            </div>

            <!-- Wizard Footer Controls -->
            <div class="f1-wizard-footer">
              <button type="button" class="f1-btn-ghost" id="btnWizCancel">Cancel</button>
              <div class="f1-wizard-controls">
                ${currentStep > 1 ? `
                  <button type="button" class="f1-btn-secondary" id="btnWizBack">← Back</button>
                ` : ''}
                ${currentStep < 4 ? `
                  <button type="button" class="f1-btn-primary" id="btnWizNext">Continue →</button>
                ` : `
                  <button type="button" class="f1-btn-primary f1-btn-gold" id="btnWizConfirm">🏁 START CHAMPIONSHIP</button>
                `}
              </div>
            </div>
          </div>
        </div>
      `;

      // Bind actions
      container.querySelector('#btnWizCancel')?.addEventListener('click', onCancel);
      container.querySelector('#btnWizBack')?.addEventListener('click', () => {
        saveStepInputs(currentStep, wizardState, container);
        currentStep--;
        updateView();
      });
      container.querySelector('#btnWizNext')?.addEventListener('click', () => {
        saveStepInputs(currentStep, wizardState, container);
        currentStep++;
        updateView();
      });
      container.querySelector('#btnWizConfirm')?.addEventListener('click', () => {
        saveStepInputs(currentStep, wizardState, container);
        onComplete(wizardState);
      });

      bindStepEvents(currentStep, wizardState, container);

      const backdrop = container.querySelector('.f1-modal-backdrop');
      if (backdrop) backdrop.scrollTop = (prevStep === currentStep) ? prevScroll : 0;
      updateView._lastStep = currentStep;
    }

    function renderStepContent(step, w) {
      if (step === 1) {
        return `
          <h2>Championship Identity & Format</h2>
          <p class="f1-sub">Set up your season title, calendar length, and racing intensity.</p>

          <div class="f1-form-group">
            <label for="wizChampName">Championship Title</label>
            <input type="text" id="wizChampName" class="f1-input" value="${w.name}">
          </div>

          <div class="f1-grid-2col">
            <div class="f1-form-group">
              <label for="wizLength">Season Length</label>
              <select id="wizLength" class="f1-select">
                <option value="3" ${w.seasonLength === 3 ? 'selected' : ''}>3 Rounds (Sprint Test Season)</option>
                <option value="4" ${w.seasonLength === 4 ? 'selected' : ''}>4 Rounds (Classic Championship)</option>
                <option value="6" ${w.seasonLength === 6 ? 'selected' : ''}>6 Rounds (Extended Grand Prix Series)</option>
                <option value="8" ${w.seasonLength === 8 ? 'selected' : ''}>8 Rounds (Full World Championship)</option>
              </select>
            </div>

            <div class="f1-form-group">
              <label for="wizDist">Race Distance</label>
              <select id="wizDist" class="f1-select">
                <option value="short" ${w.raceDistance === 'short' ? 'selected' : ''}>Sprint (5 Laps)</option>
                <option value="medium" ${w.raceDistance === 'medium' ? 'selected' : ''}>Standard (12 Laps)</option>
                <option value="full" ${w.raceDistance === 'full' ? 'selected' : ''}>Grand Prix (Full Circuit Laps)</option>
              </select>
            </div>
          </div>

          <div class="f1-form-group">
            <label for="wizDiff">AI Difficulty</label>
            <select id="wizDiff" class="f1-select">
              <option value="easy" ${w.aiDifficulty === 'easy' ? 'selected' : ''}>Rookie (Easy) — Relaxed AI pace</option>
              <option value="normal" ${w.aiDifficulty === 'normal' ? 'selected' : ''}>Challenger (Normal) — Realistic competitive pace</option>
              <option value="hard" ${w.aiDifficulty === 'hard' ? 'selected' : ''}>Pro (Hard) — Demanding AI benchmark</option>
              <option value="legend" ${w.aiDifficulty === 'legend' ? 'selected' : ''}>World Champion (Legend) — Maximum human threshold</option>
            </select>
          </div>
        `;
      }

      if (step === 2) {
        return `
          <h2>Official Regulations & Weekend Rules</h2>
          <p class="f1-sub">Configure the race weekend structure and applicable FIA sporting rules.</p>

          <div class="f1-checkbox-list">
            <label class="f1-checkbox-card">
              <input type="checkbox" id="wizPractice" ${w.rules.practiceEnabled ? 'checked' : ''}>
              <div class="f1-check-info">
                <strong>Free Practice Sessions</strong>
                <span>Allows track acclimatization and setup tuning before qualifying.</span>
              </div>
            </label>

            <label class="f1-checkbox-card">
              <input type="checkbox" id="wizQuali" ${w.rules.qualifyingEnabled ? 'checked' : ''}>
              <div class="f1-check-info">
                <strong>Full Qualifying Shootout</strong>
                <span>Authentic timed flying laps determine starting grid slots.</span>
              </div>
            </label>

            <label class="f1-checkbox-card">
              <input type="checkbox" id="wizTwoCompound" ${w.rules.twoCompoundRule ? 'checked' : ''}>
              <div class="f1-check-info">
                <strong>FIA Mandatory Two-Compound Rule</strong>
                <span>Mandates using two distinct dry compounds in dry races (waived in wet).</span>
              </div>
            </label>

            <label class="f1-checkbox-card">
              <input type="checkbox" id="wizFastestLap" ${w.rules.fastestLapPoint ? 'checked' : ''}>
              <div class="f1-check-info">
                <strong>Fastest Lap Bonus Point (+1 pt)</strong>
                <span>Awarded to driver setting fastest lap, provided they finish in top 10.</span>
              </div>
            </label>

            <label class="f1-checkbox-card">
              <input type="checkbox" id="wizHomeAdv" ${w.rules.homeAdvantage ? 'checked' : ''}>
              <div class="f1-check-info">
                <strong>Home Race Advantage</strong>
                <span>Drivers competing in their home country receive a modest, realistic confidence & consistency bonus.</span>
              </div>
            </label>

            <label class="f1-checkbox-card">
              <input type="checkbox" id="wizPrevWinner" ${w.rules.previousWinnerConfidence ? 'checked' : ''}>
              <div class="f1-check-info">
                <strong>Previous Circuit Winner Confidence</strong>
                <span>Past winners at a circuit receive heightened composure in wheel-to-wheel battles and setback recovery.</span>
              </div>
            </label>
          </div>

          <div class="f1-grid-2col" style="margin-top:14px">
            <div class="f1-form-group">
              <label for="wizWeather">Weather Mode</label>
              <select id="wizWeather" class="f1-select">
                <option value="dynamic" ${w.rules.weatherMode === 'dynamic' ? 'selected' : ''}>Dynamic Weather & Live Radar Forecasts</option>
                <option value="fixed_dry" ${w.rules.weatherMode === 'fixed_dry' ? 'selected' : ''}>Bone Dry (No Rain)</option>
                <option value="fixed_wet" ${w.rules.weatherMode === 'fixed_wet' ? 'selected' : ''}>Persistent Wet (Heavy Rain)</option>
              </select>
            </div>

            <div class="f1-form-group">
              <label for="wizRadioMode">Interactive Team Radio Delivery</label>
              <select id="wizRadioMode" class="f1-select">
                <option value="full" ${w.rules.teamRadioMode === 'full' ? 'selected' : ''}>Full — Strategy, overtaking, defending, tyres & weather</option>
                <option value="essential" ${w.rules.teamRadioMode === 'essential' ? 'selected' : ''}>Essential — Critical tyre, pit, weather & safety alerts</option>
                <option value="off" ${w.rules.teamRadioMode === 'off' ? 'selected' : ''}>Off — Muted; critical safety flags only</option>
              </select>
            </div>
          </div>
        `;
      }

      if (step === 3) {
        // Team, Driver, Manager and Car Selection
        const teams = Array.from(new Set(DRIVERS.map(d => d.team)));
        const selectedTeamDrivers = DRIVERS.filter(d => d.team === w.player.team);
        const selManager = getManager(w.player.managerId) || MANAGERS[0];
        const selCar = getCar(w.player.carId) || CARS[0];

        return `
          <h2>Team, Driver, Principal & Machine Selection</h2>
          <p class="f1-sub">Draft your championship lineup. Choose your driver, team principal, and car machine.</p>

          <div class="f1-team-selector">
            <label>Select Team & Driver</label>
            <div class="f1-team-chips" id="teamChips">
              ${teams.map(t => {
                const leadD = DRIVERS.find(x => x.team === t);
                const isSel = (t === w.player.team);
                return `
                  <button type="button" class="f1-chip ${isSel ? 'active' : ''}" data-team="${t}" style="--chip-col:${leadD.teamColor}">
                    <span class="f1-chip-dot" style="background:${leadD.teamColor}"></span>
                    ${t}
                  </button>
                `;
              }).join('')}
            </div>
          </div>

          <div class="f1-driver-grid" id="driverCards">
            ${selectedTeamDrivers.map(d => {
              const isPlayer = (d.code === w.player.driverCode);
              return `
                <div class="f1-driver-card ${isPlayer ? 'selected' : ''}" data-code="${d.code}">
                  <div class="f1-driver-card-head" style="border-left: 4px solid ${d.color}">
                    <span class="f1-driver-num">#${d.number}</span>
                    <span class="f1-driver-name">${d.name}</span>
                    <span class="f1-driver-code">${d.code}</span>
                  </div>
                  <div class="f1-driver-ratings">
                    <div class="f1-rating-row"><span>Aggression</span><strong>${Math.round(d.personality.aggression * 100)}%</strong></div>
                    <div class="f1-rating-row"><span>Consistency</span><strong>${Math.round(d.personality.consistency * 100)}%</strong></div>
                    <div class="f1-rating-row"><span>Racecraft</span><strong>${Math.round(d.personality.racecraft * 100)}%</strong></div>
                    <div class="f1-rating-row"><span>Tyre Mgmt</span><strong>${Math.round(d.personality.tyreManagement * 100)}%</strong></div>
                    <div class="f1-rating-row"><span>Wet Skill</span><strong>${Math.round(d.personality.wetSkill * 100)}%</strong></div>
                  </div>
                  <button type="button" class="f1-btn-select-driver ${isPlayer ? 'active' : ''}">
                    ${isPlayer ? '✓ SELECTED DRIVER' : 'CHOOSE DRIVER'}
                  </button>
                </div>
              `;
            }).join('')}
          </div>

          <!-- Team Principal Selection Row -->
          <div class="f1-team-selector" style="margin-top:16px">
            <label>Select Team Principal (Tactical Perks)</label>
            <div class="f1-team-chips" id="managerChips">
              ${MANAGERS.map(m => {
                const isSel = (m.id === w.player.managerId);
                return `
                  <button type="button" class="f1-chip ${isSel ? 'active' : ''}" data-mgr="${m.id}">
                    <span>${m.avatar}</span>
                    ${m.name} (${m.team})
                  </button>
                `;
              }).join('')}
            </div>
            <div class="draft-synergy-panel" style="margin-top:8px;padding:10px 14px">
              <strong style="color:#38bdf8">${selManager.name} · ${selManager.style}</strong>
              <div style="font-size:11px;color:#94a3b8;margin-top:4px">${selManager.perks.join(' · ')}</div>
            </div>
          </div>

          <!-- Constructor Machine Selection Row -->
          <div class="f1-team-selector" style="margin-top:16px">
            <label>Select Constructor Car (Aerodynamics & Top Speed)</label>
            <div class="f1-team-chips" id="carChips">
              ${CARS.map(c => {
                const isSel = (c.id === w.player.carId);
                return `
                  <button type="button" class="f1-chip ${isSel ? 'active' : ''}" data-car="${c.id}">
                    <span>${c.badge}</span>
                    ${c.name}
                  </button>
                `;
              }).join('')}
            </div>
            <div class="draft-synergy-panel" style="margin-top:8px;padding:10px 14px">
              <strong style="color:#00e676">${selCar.name} · ${selCar.team}</strong>
              <div style="font-size:11px;color:#94a3b8;margin-top:4px">Top Speed: ${selCar.stats.topSpeed} · Cornering: ${selCar.stats.cornering} · Tyre Preserv: ${selCar.stats.tyrePreservation} | ${selCar.strengths}</div>
            </div>
          </div>
        `;
      }

      if (step === 4) {
        // Review Calendar & Settings
        const circuitList = w.circuitIds.slice(0, w.seasonLength).map(id => getCircuit(id));
        const playerD = DRIVERS.find(d => d.code === w.player.driverCode) || DRIVERS[0];
        const playerM = getManager(w.player.managerId) || MANAGERS[0];
        const playerC = getCar(w.player.carId) || CARS[0];

        return `
          <h2>Season Confirmation & Review</h2>
          <p class="f1-sub">Verify your championship configuration and calendar schedule.</p>

          <div class="f1-summary-grid">
            <div class="f1-summary-box">
              <span class="f1-sub-label">DRIVER & TEAM</span>
              <h3>${playerD.name} (#${playerD.number})</h3>
              <p>${playerD.team} &middot; Teammate: ${w.player.teammateCode || 'None'}</p>
            </div>
            <div class="f1-summary-box">
              <span class="f1-sub-label">PRINCIPAL & MACHINE</span>
              <h3>${playerM.name} &middot; ${playerC.name}</h3>
              <p>Perks: ${playerM.perks[0] || 'Optimized Strategy'}</p>
            </div>
            <div class="f1-summary-box">
              <span class="f1-sub-label">FORMAT & RULES</span>
              <h3>${w.seasonLength} Rounds &middot; ${w.raceDistance.toUpperCase()}</h3>
              <p>AI Difficulty: ${AI_DIFFICULTY[w.aiDifficulty].name} &middot; Weather: ${w.rules.weatherMode.toUpperCase()}</p>
            </div>
          </div>

          <div class="f1-calendar-preview">
            <span class="f1-sub-label">OFFICIAL SEASON CALENDAR</span>
            <div class="f1-cal-list">
              ${circuitList.map((c, i) => `
                <div class="f1-cal-item">
                  <span class="f1-cal-rnd">R${i + 1}</span>
                  <div class="f1-cal-details">
                    <strong>${c.name}</strong>
                    <small>${c.loc} &middot; ${c.lengthM}m &middot; ${c.turns} Turns</small>
                  </div>
                  <span class="f1-cal-rec">Record: ${c.rec}s (${c.who})</span>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }
      return '';
    }

    function saveStepInputs(step, w, root) {
      if (step === 1) {
        const nameEl = root.querySelector('#wizChampName');
        const lenEl  = root.querySelector('#wizLength');
        const distEl = root.querySelector('#wizDist');
        const diffEl = root.querySelector('#wizDiff');
        if (nameEl) w.name = nameEl.value || w.name;
        if (lenEl)  w.seasonLength = +lenEl.value;
        if (distEl) w.raceDistance = distEl.value;
        if (diffEl) w.aiDifficulty = diffEl.value;

        // Populate circuits matching seasonLength
        const allIds = CIRCUITS.map(c => c.id);
        w.circuitIds = allIds.slice(0, w.seasonLength);
      }
      if (step === 2) {
        w.rules.practiceEnabled          = !!root.querySelector('#wizPractice')?.checked;
        w.rules.qualifyingEnabled        = !!root.querySelector('#wizQuali')?.checked;
        w.rules.twoCompoundRule          = !!root.querySelector('#wizTwoCompound')?.checked;
        w.rules.fastestLapPoint          = !!root.querySelector('#wizFastestLap')?.checked;
        w.rules.homeAdvantage            = !!root.querySelector('#wizHomeAdv')?.checked;
        w.rules.previousWinnerConfidence = !!root.querySelector('#wizPrevWinner')?.checked;
        const wModeEl = root.querySelector('#wizWeather');
        if (wModeEl) w.rules.weatherMode = wModeEl.value;
        const rModeEl = root.querySelector('#wizRadioMode');
        if (rModeEl) w.rules.teamRadioMode = rModeEl.value;
      }
    }

    function bindStepEvents(step, w, root) {
      if (step === 3) {
        root.querySelector('#teamChips')?.addEventListener('click', e => {
          const btn = e.target.closest('button[data-team]');
          if (!btn) return;
          const newTeam = btn.dataset.team;
          w.player.team = newTeam;
          const firstDriver = DRIVERS.find(d => d.team === newTeam);
          const secondDriver = DRIVERS.find(d => d.team === newTeam && d.code !== firstDriver.code);
          w.player.driverCode = firstDriver.code;
          w.player.teammateCode = secondDriver?.code || null;
          updateView();
        });

        root.querySelector('#driverCards')?.addEventListener('click', e => {
          const card = e.target.closest('.f1-driver-card');
          if (!card) return;
          const code = card.dataset.code;
          const teamDrivers = DRIVERS.filter(d => d.team === w.player.team);
          w.player.driverCode = code;
          const teammate = teamDrivers.find(d => d.code !== code);
          w.player.teammateCode = teammate?.code || null;
          getSharedDraftEngine().selectEntity('driver', code);
          updateView();
        });

        root.querySelector('#managerChips')?.addEventListener('click', e => {
          const btn = e.target.closest('button[data-mgr]');
          if (!btn) return;
          w.player.managerId = btn.dataset.mgr;
          getSharedDraftEngine().selectEntity('manager', btn.dataset.mgr);
          updateView();
        });

        root.querySelector('#carChips')?.addEventListener('click', e => {
          const btn = e.target.closest('button[data-car]');
          if (!btn) return;
          w.player.carId = btn.dataset.car;
          getSharedDraftEngine().selectEntity('car', btn.dataset.car);
          updateView();
        });
      }
    }

    updateView();
  }

  // ── 4. Championship Hub ───────────────────────────────────────────────────

  /**
   * Render the persistent Championship Hub.
   */
  static renderHub(container, state, {
    onMainAction,
    onViewCalendar,
    onViewStandings,
    onViewHistory,
    onSaveAndExit
  }) {
    const round = state.calendar[state.currentRoundIndex];
    const isCompleted = (state.status === SeasonStatus.COMPLETED);
    const progressPct = Math.round(((state.currentRoundIndex) / state.calendar.length) * 100);

    // Determine dynamic primary action text based on stage
    let actionBtnText = 'START RACE WEEKEND';
    let actionBtnClass = 'f1-btn-primary f1-btn-hero';

    if (isCompleted) {
      actionBtnText = '🏆 VIEW SEASON FINALE & AWARDS';
      actionBtnClass = 'f1-btn-primary f1-btn-gold f1-btn-hero';
    } else if (round) {
      switch (round.stage) {
        case WeekendStage.EVENT_OVERVIEW:
          actionBtnText = `🏁 ENTER ROUND ${round.round}: ${round.circuitName.toUpperCase()}`;
          break;
        case WeekendStage.PRACTICE_PENDING:
          actionBtnText = '⏱ START PRACTICE SESSION';
          break;
        case WeekendStage.PRACTICE_COMPLETED:
        case WeekendStage.QUALIFYING_PENDING:
          actionBtnText = '⚡ START QUALIFYING SHOOTOUT';
          break;
        case WeekendStage.QUALIFYING_COMPLETED:
        case WeekendStage.GRID_CONFIRMATION:
          actionBtnText = '📋 CONFIRM STARTING GRID';
          break;
        case WeekendStage.RACE_READY:
          actionBtnText = '🚦 ENTER RACE & PREPARE GRID';
          break;
        case WeekendStage.RACE_IN_PROGRESS:
          actionBtnText = '🏎 RESUME ACTIVE RACE';
          break;
        case WeekendStage.RESULTS_PENDING:
        case WeekendStage.EVENT_COMPLETED:
          actionBtnText = '📊 VIEW OFFICIAL RACE RESULTS';
          break;
        default:
          actionBtnText = 'CONTINUE RACE WEEKEND';
      }
    }

    container.innerHTML = `
      <div class="f1-hub-screen">
        <!-- Hub Top Header -->
        <div class="f1-hub-header">
          <div class="f1-hub-title-block">
            <div class="f1-hub-badge-row">
              <span class="f1-badge-gold">CHAMPIONSHIP HUB</span>
              <span class="f1-badge-dark">${state.name}</span>
            </div>
            <h1>ROUND ${state.currentRoundIndex + 1} OF ${state.calendar.length}</h1>
          </div>

          <div class="f1-hub-progress-block">
            <div class="f1-hub-prog-labels">
              <span>Season Progress</span>
              <strong>${progressPct}%</strong>
            </div>
            <div class="f1-prog-track"><i style="width:${progressPct}%"></i></div>
          </div>
        </div>

        <div class="f1-hub-grid">
          <!-- Left: Upcoming Event Hero & Primary Action -->
          <div class="f1-hub-event-card">
            ${round ? `
              <div class="f1-event-badge">NEXT REQUIRED SESSION</div>
              <h2 class="f1-event-title">${round.circuitName}</h2>
              <div class="f1-event-meta">
                <span>📍 ${round.location}</span>
                <span>🏁 ${round.laps} Laps Distance</span>
                <span>Stage: <strong>${(round.stage || '').replace(/_/g, ' ')}</strong></span>
              </div>

              <!-- Big Primary Contextual Button -->
              <div class="f1-hero-action-box">
                <button type="button" class="${actionBtnClass}" id="btnHubAction">
                  ${actionBtnText}
                </button>
              </div>
            ` : `
              <div class="f1-event-badge">SEASON COMPLETE</div>
              <h2>All ${state.calendar.length} Grand Prix Completed!</h2>
              <button type="button" class="f1-btn-primary f1-btn-gold f1-btn-hero" id="btnHubAction">
                🏆 VIEW FINAL CHAMPIONSHIP AWARDS
              </button>
            `}

            <!-- Quick Weekend Timeline -->
            <div class="f1-weekend-timeline">
              <div class="f1-tl-step ${round?.stage === 'EVENT_OVERVIEW' ? 'active' : ''}">Briefing</div>
              <div class="f1-tl-step ${round?.practiceResults ? 'done' : (round?.stage === 'PRACTICE_PENDING' ? 'active' : '')}">Practice</div>
              <div class="f1-tl-step ${round?.qualifyingResults ? 'done' : (round?.stage?.includes('QUALIFYING') ? 'active' : '')}">Qualifying</div>
              <div class="f1-tl-step ${round?.grid ? 'done' : (round?.stage === 'GRID_CONFIRMATION' ? 'active' : '')}">Grid</div>
              <div class="f1-tl-step ${round?.raceResults ? 'done' : (round?.stage?.includes('RACE') ? 'active' : '')}">Grand Prix</div>
            </div>
          </div>

          <!-- Right: Mini Standings Table -->
          <div class="f1-hub-standings-card">
            <div class="f1-hub-card-head">
              <h3>WORLD DRIVERS' STANDINGS</h3>
              <button type="button" class="f1-btn-tiny" id="btnHubViewStandings">Full Table</button>
            </div>

            <div class="f1-mini-table">
              <div class="f1-mt-head">
                <span>P</span><span>Driver</span><span>Team</span><span style="text-align:right">Pts</span>
              </div>
              ${state.driverStandings.slice(0, 8).map(d => `
                <div class="f1-mt-row ${d.isPlayer ? 'player-row' : ''}">
                  <span class="f1-pos-tag">${d.position}</span>
                  <span class="f1-name-tag">
                    <i class="f1-col-dot" style="background:${d.color}"></i>
                    ${d.name} ${d.isPlayer ? '<small class="player-tag">YOU</small>' : ''}
                  </span>
                  <span class="f1-team-tag">${d.team}</span>
                  <span class="f1-pts-tag">${d.points}</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <!-- Hub Footer Nav -->
        <div class="f1-hub-footer">
          <div class="f1-hub-foot-left">
            <button type="button" class="f1-btn-ghost" id="btnHubCalendar">📅 Full Season Calendar</button>
            <button type="button" class="f1-btn-ghost" id="btnHubHistory">📜 Past Seasons</button>
          </div>
          <div class="f1-hub-foot-right">
            <button type="button" class="f1-btn-secondary" id="btnHubSaveExit">💾 Save & Exit to Main Menu</button>
          </div>
        </div>
      </div>
    `;

    container.querySelector('#btnHubAction')?.addEventListener('click', onMainAction);
    container.querySelector('#btnHubViewStandings')?.addEventListener('click', onViewStandings);
    container.querySelector('#btnHubCalendar')?.addEventListener('click', onViewCalendar);
    container.querySelector('#btnHubHistory')?.addEventListener('click', onViewHistory);
    container.querySelector('#btnHubSaveExit')?.addEventListener('click', onSaveAndExit);
  }

  // ── 5. Weekend Stage: Event Overview ──────────────────────────────────────

  /**
   * Render Event Overview screen.
   */
  static renderEventOverview(container, state, round, { onProceed, onBackToHub }) {
    const circuit = getCircuit(round.circuitId);
    const pDriver = getDriver(state.player.driverCode);
    const psych = DriverPsychology.evaluatePreRaceAdvantage(pDriver, circuit, {
      homeAdvantageEnabled: state.rules.homeAdvantage ?? true,
      previousWinnerEnabled: state.rules.previousWinnerConfidence ?? true,
      archivedHistory: state.history,
      currentSeasonCalendar: state.calendar,
      currentRoundIndex: state.currentRoundIndex
    });

    container.innerHTML = `
      <div class="f1-modal-backdrop">
        <div class="f1-stage-card">
          <div class="f1-stage-nav">
            <button type="button" class="f1-btn-ghost" id="btnOverviewBack">← CHAMPIONSHIP HUB</button>
            <span class="f1-badge-red">ROUND ${round.round} OF ${state.calendar.length}</span>
          </div>

          <div class="f1-stage-header">
            <h1>${circuit.name}</h1>
            <div class="f1-loc-tag">${circuit.loc} &middot; Length: ${circuit.lengthM}m &middot; Turns: ${circuit.turns} &middot; Direction: ${circuit.direction}</div>
          </div>

          ${psych.contextMessage ? `
            <div class="f1-psych-banner ${psych.badgeType}">
              <span class="f1-psych-badge-icon">${psych.isHome ? '🏠' : '🏆'}</span>
              <div class="f1-psych-badge-text">
                <strong>${psych.isHome && psych.isPreviousWinner ? 'HOME RACE & PREVIOUS CIRCUIT WINNER' : (psych.isHome ? 'HOME GRAND PRIX' : 'PROVEN TRACK WINNER')}</strong>
                <p>${psych.contextMessage}</p>
                <small>${psych.detail}</small>
              </div>
              <span class="f1-psych-badge-stat">+${Math.round(psych.totalConfidenceBonus * 100)}% CONFIDENCE</span>
            </div>
          ` : ''}

          <div class="f1-stage-grid">
            <div class="f1-circuit-notes">
              <h3>Circuit Profile</h3>
              <p>${circuit.note}</p>
              <div class="f1-stat-pill-row">
                <span class="f1-stat-pill">DRS Zones: ${circuit.drs}</span>
                <span class="f1-stat-pill">Race Laps: ${round.laps}</span>
                <span class="f1-stat-pill">Lap Record: ${circuit.rec}s (${circuit.who})</span>
              </div>
            </div>

            <div class="f1-weekend-schedule-box">
              <h3>Weekend Schedule</h3>
              <ul class="f1-sched-list">
                <li class="${state.rules.practiceEnabled ? '' : 'disabled'}">
                  <strong>Free Practice</strong>
                  <small>${state.rules.practiceEnabled ? 'Optional acclimatization laps' : 'Disabled by rules'}</small>
                </li>
                <li class="${state.rules.qualifyingEnabled ? '' : 'disabled'}">
                  <strong>Qualifying Shootout</strong>
                  <small>${state.rules.qualifyingEnabled ? 'Flying laps determine grid positions' : 'Championship seeded grid'}</small>
                </li>
                <li>
                  <strong>Grand Prix</strong>
                  <small>${round.laps} Laps &middot; Full FIA Points</small>
                </li>
              </ul>
            </div>
          </div>

          <div class="f1-stage-actions">
            <button type="button" class="f1-btn-primary f1-btn-lg" id="btnOverviewProceed">
              ${state.rules.practiceEnabled ? 'START PRACTICE SESSION →' : (state.rules.qualifyingEnabled ? 'START QUALIFYING →' : 'PREPARE STARTING GRID →')}
            </button>
          </div>
        </div>
      </div>
    `;

    container.querySelector('#btnOverviewBack')?.addEventListener('click', onBackToHub);
    container.querySelector('#btnOverviewProceed')?.addEventListener('click', onProceed);
  }

  // ── 6. Weekend Stage: Practice Session ────────────────────────────────────

  /**
   * Render Practice Session screen.
   */
  static renderPractice(container, state, round, { onCompleteLaps, onSkip, onBackToHub }) {
    const circuit = getCircuit(round.circuitId);
    container.innerHTML = `
      <div class="f1-modal-backdrop">
        <div class="f1-stage-card">
          <div class="f1-stage-nav">
            <button type="button" class="f1-btn-ghost" id="btnPracticeBack">← Hub</button>
            <span class="f1-badge-gold">FREE PRACTICE</span>
          </div>

          <div class="f1-stage-header">
            <h1>Free Practice &middot; ${circuit.name}</h1>
            <p class="f1-sub">Dial in car balance, inspect tyre degradation, and benchmark track grip before qualifying.</p>
          </div>

          <div class="f1-practice-box">
            <div class="f1-practice-metric">
              <span class="f1-sub-label">TRACK SURFACE</span>
              <strong>32°C &middot; Optimum Grip</strong>
            </div>
            <div class="f1-practice-metric">
              <span class="f1-sub-label">WEATHER OUTLOOK</span>
              <strong>${state.rules.weatherMode.toUpperCase()}</strong>
            </div>
            <div class="f1-practice-metric">
              <span class="f1-sub-label">TARGET LAP PACE</span>
              <strong>~${(circuit.rec * 1.03).toFixed(3)}s</strong>
            </div>
          </div>

          <div class="f1-stage-actions-split">
            <button type="button" class="f1-btn-ghost" id="btnPracticeSkip">Skip Practice</button>
            <button type="button" class="f1-btn-primary f1-btn-lg" id="btnPracticeRun">
              ⚡ COMPLETE PRACTICE RUN →
            </button>
          </div>
        </div>
      </div>
    `;

    container.querySelector('#btnPracticeBack')?.addEventListener('click', onBackToHub);
    container.querySelector('#btnPracticeSkip')?.addEventListener('click', onSkip);
    container.querySelector('#btnPracticeRun')?.addEventListener('click', () => {
      // Simulate practice laps with player pace
      const best = (circuit.rec * 1.025) + (Math.random() * 0.5);
      onCompleteLaps([best + 0.4, best + 0.2, Math.round(best * 1000) / 1000]);
    });
  }

  // ── 7. Weekend Stage: Qualifying Shootout ──────────────────────────────────

  /**
   * Render Qualifying Session.
   */
  static renderQualifying(container, state, round, { onRunQuali, onConfirmGrid, onBackToHub }) {
    const circuit = getCircuit(round.circuitId);
    const existingResults = round.qualifyingResults;

    container.innerHTML = `
      <div class="f1-modal-backdrop">
        <div class="f1-stage-card f1-card-wide">
          <div class="f1-stage-nav">
            <button type="button" class="f1-btn-ghost" id="btnQualiBack">← Hub</button>
            <span class="f1-badge-red">QUALIFYING SHOOTOUT</span>
          </div>

          <div class="f1-stage-header">
            <h1>Official Qualifying &middot; ${circuit.name}</h1>
            <p class="f1-sub">Low-fuel trim, soft Pirelli tyres, all 20 cars battling for Pole Position.</p>
          </div>

          ${!existingResults ? `
            <!-- Pre-Quali Action Box -->
            <div class="f1-quali-pre">
              <p>Ready to set your flying lap around ${circuit.name}? Drivers have one set of brand-new Soft tyres.</p>
              <button type="button" class="f1-btn-primary f1-btn-lg" id="btnRunQualiAction">
                🚀 RUN QUALIFYING SHOOTOUT
              </button>
            </div>
          ` : `
            <!-- Live Timing Results Classification -->
            <div class="f1-quali-results-table">
              <div class="f1-table-head f1-quali-head-extended">
                <span>Pos</span><span>Driver</span><span>Team</span><span>S1</span><span>S2</span><span>S3</span><span>Time</span><span style="text-align:right">Gap</span>
              </div>
              <div class="f1-table-rows">
                ${existingResults.map(r => `
                  <div class="f1-table-row ${r.isPlayer ? 'player-row' : ''}">
                    <span class="f1-pos-badge ${r.isPole ? 'pole-badge' : ''}">${r.position}</span>
                    <span class="f1-driver-col">
                      <i class="f1-col-dot" style="background:${r.color}"></i>
                      <strong>${r.name}</strong> ${r.isPlayer ? '<small class="player-tag">YOU</small>' : ''}
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
              <button type="button" class="f1-btn-primary f1-btn-lg" id="btnConfirmGridAction">
                CONFIRM STARTING GRID →
              </button>
            </div>
          `}
        </div>
      </div>
    `;

    container.querySelector('#btnQualiBack')?.addEventListener('click', onBackToHub);
    container.querySelector('#btnRunQualiAction')?.addEventListener('click', onRunQuali);
    container.querySelector('#btnConfirmGridAction')?.addEventListener('click', onConfirmGrid);
  }

  // ── 8. Weekend Stage: Starting Grid Confirmation ───────────────────────────

  /**
   * Render Starting Grid in authentic staggered F1 layout.
   */
  static renderStartingGrid(container, state, round, { onProceedToRacePrep, onBackToHub }) {
    const circuit = getCircuit(round.circuitId);
    const grid = round.grid || [];

    container.innerHTML = `
      <div class="f1-modal-backdrop">
        <div class="f1-stage-card f1-card-wide">
          <div class="f1-stage-nav">
            <button type="button" class="f1-btn-ghost" id="btnGridBack">← Hub</button>
            <span class="f1-badge-red">OFFICIAL STARTING GRID</span>
          </div>

          <div class="f1-stage-header">
            <h1>Starting Grid &middot; ${circuit.name}</h1>
            <p class="f1-sub">20 cars in staggered 2-by-2 grid slots. P1 starts on the clean racing line.</p>
          </div>

          <!-- Staggered 2-by-2 Grid Visual -->
          <div class="f1-grid-staggered">
            ${grid.map(g => {
              const isEven = (g.gridPosition % 2 === 0);
              const dProf = getDriver(g.driverCode);
              const dPsych = DriverPsychology.evaluatePreRaceAdvantage(dProf, circuit, {
                homeAdvantageEnabled: state.rules.homeAdvantage ?? true,
                previousWinnerEnabled: state.rules.previousWinnerConfidence ?? true,
                archivedHistory: state.history,
                currentSeasonCalendar: state.calendar,
                currentRoundIndex: state.currentRoundIndex
              });

              return `
                <div class="f1-grid-slot ${isEven ? 'slot-right' : 'slot-left'} ${g.isPlayer ? 'slot-player' : ''}">
                  <span class="f1-slot-num">P${g.gridPosition}</span>
                  <div class="f1-slot-info">
                    <span class="f1-slot-driver">
                      <i class="f1-col-dot" style="background:${g.color}"></i>
                      <strong>${g.name}</strong> ${g.isPlayer ? '<small class="player-tag">YOU</small>' : ''}
                      ${dPsych.isHome ? '<span class="f1-grid-badge f1-badge-home" title="Home Grand Prix">🏠 HOME</span>' : ''}
                      ${dPsych.isPreviousWinner ? `<span class="f1-grid-badge f1-badge-winner" title="${dPsych.contextMessage}">🏆 ${dPsych.isDefendingChampion ? 'DEFENDING' : 'WINNER'}</span>` : ''}
                    </span>
                    <span class="f1-slot-team">${g.team} &middot; ${g.qualifyingTime}</span>
                  </div>
                </div>
              `;
            }).join('')}
          </div>

          <div class="f1-stage-actions">
            <button type="button" class="f1-btn-primary f1-btn-lg" id="btnGridProceed">
              PROCEED TO RACE PREPARATION →
            </button>
          </div>
        </div>
      </div>
    `;

    container.querySelector('#btnGridBack')?.addEventListener('click', onBackToHub);
    container.querySelector('#btnGridProceed')?.addEventListener('click', onProceedToRacePrep);
  }

  // ── 9. Weekend Stage: Race Preparation & Briefing ─────────────────────────

  /**
   * Render Pre-Race Preparation & Strategic Briefing.
   */
  static renderRacePrep(container, state, round, { onEnterRace, onBackToGrid }) {
    const circuit = getCircuit(round.circuitId);
    const playerGrid = round.grid?.find(g => g.driverCode === state.player.driverCode);
    const pDriver = getDriver(state.player.driverCode);
    const psych = DriverPsychology.evaluatePreRaceAdvantage(pDriver, circuit, {
      homeAdvantageEnabled: state.rules.homeAdvantage ?? true,
      previousWinnerEnabled: state.rules.previousWinnerConfidence ?? true,
      archivedHistory: state.history,
      currentSeasonCalendar: state.calendar,
      currentRoundIndex: state.currentRoundIndex
    });
    const engineerName = pDriver?.engineerName || 'Race Engineer';

    container.innerHTML = `
      <div class="f1-modal-backdrop">
        <div class="f1-stage-card">
          <div class="f1-stage-nav">
            <button type="button" class="f1-btn-ghost" id="btnPrepBack">← Grid</button>
            <span class="f1-badge-gold">RACE BRIEFING</span>
          </div>

          <div class="f1-stage-header">
            <h1>Race Preparation &middot; ${circuit.name}</h1>
            <div class="f1-loc-tag">Starting from <strong>P${playerGrid?.gridPosition || 1}</strong> &middot; Race Distance: <strong>${round.laps} Laps</strong></div>
          </div>

          ${psych.contextMessage ? `
            <div class="f1-psych-banner ${psych.badgeType}">
              <span class="f1-psych-badge-icon">${psych.isHome ? '🏠' : '🏆'}</span>
              <div class="f1-psych-badge-text">
                <strong>${psych.isHome && psych.isPreviousWinner ? 'HOME RACE & PREVIOUS WINNER' : (psych.isHome ? 'HOME GRAND PRIX ADVANTAGE' : 'TRACK RECORD ADVANTAGE')}</strong>
                <p>${psych.contextMessage}</p>
              </div>
              <span class="f1-psych-badge-stat">+${Math.round(psych.totalConfidenceBonus * 100)}% CONFIDENCE</span>
            </div>
          ` : ''}

          <div class="f1-prep-grid">
            <div class="f1-briefing-box">
              <h3>${engineerName} Briefing</h3>
              <p>We are starting from P${playerGrid?.gridPosition}. Lights-out launch will be decisive into Turn 1. Be ready to react when the 5 red lights extinguish.</p>
              <div class="f1-brief-checks">
                <span>✓ Tyre warmers active on grid</span>
                <span>✓ Fuel load calculated for ${round.laps} laps</span>
                <span>✓ ERS MGU-K state: 85% deployment buffer</span>
                ${psych.isHome ? `<span>✓ 🏠 Home crowd motivation: +${Math.round(psych.totalConfidenceBonus * 100)}% confidence</span>` : ''}
                ${psych.isPreviousWinner ? `<span>✓ 🏆 Previous winner track mastery: ${psych.lastWinYear ? 'won here in ' + psych.lastWinYear : 'proven victor'}</span>` : ''}
                <span>✓ DRS zones available after Lap 1</span>
              </div>
            </div>

            <div class="f1-strat-choice-box">
              <h3>Starting Tyre Selection</h3>
              <p>Select your starting compound off the line:</p>
              <div class="f1-tyre-pills" id="prepTyreSeg">
                <button type="button" class="compound-pill compound-s" data-c="soft">S (Soft)</button>
                <button type="button" class="compound-pill compound-m active" data-c="medium">M (Medium)</button>
                <button type="button" class="compound-pill compound-h" data-c="hard">H (Hard)</button>
              </div>
            </div>
          </div>

          <div class="f1-stage-actions">
            <button type="button" class="f1-btn-primary f1-btn-hero f1-btn-gold" id="btnPrepStartRace">
              🚦 TO THE GRID — START RACE!
            </button>
          </div>
        </div>
      </div>
    `;

    container.querySelector('#btnPrepBack')?.addEventListener('click', onBackToGrid);

    let chosenCompound = 'medium';
    container.querySelector('#prepTyreSeg')?.addEventListener('click', e => {
      const b = e.target.closest('button[data-c]');
      if (!b) return;
      container.querySelectorAll('#prepTyreSeg button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      chosenCompound = b.dataset.c;
    });

    container.querySelector('#btnPrepStartRace')?.addEventListener('click', () => {
      onEnterRace({ startingCompound: chosenCompound });
    });
  }

  // ── 10. Post-Race Official Results ────────────────────────────────────────

  /**
   * Render Official Race Results & Points Allocation.
   */
  static renderResults(container, state, round, resultsData, { onContinueToHub, onViewFinale, onReturnMain }) {
    const { raceResults, fastestLap } = resultsData;
    const isSeasonFinale = (state.currentRoundIndex >= state.calendar.length - 1);
    const circuit = getCircuit(round.circuitId);
    const playerRes = raceResults.find(r => r.isPlayer);

    container.innerHTML = `
      <div class="f1-modal-backdrop">
        <div class="f1-stage-card f1-card-wide">
          <div class="f1-stage-nav">
            <span class="f1-badge-red">CHEQUERED FLAG</span>
            <span class="f1-badge-gold">OFFICIAL CLASSIFICATION</span>
            ${onReturnMain ? `<button type="button" class="f1-btn-ghost btn-modal-back" id="btnResultsBack">← MAIN MENU</button>` : ''}
          </div>

          <div class="f1-stage-header">
            <h1>Grand Prix Results &middot; ${circuit.name}</h1>
            <p class="f1-sub">Official race classification and FIA World Championship points allocation.</p>
          </div>

          <!-- Player Summary Callout -->
          <div class="f1-player-summary-bar">
            <span>Your Result: <strong>P${playerRes?.finishPosition}</strong> (${playerRes?.posGained >= 0 ? '+' : ''}${playerRes?.posGained} pos)</span>
            <span>Points Earned: <strong>+${playerRes?.pointsEarned} pts</strong></span>
            <span>Fastest Lap: <strong>${fastestLap?.driverCode} (${fastestLap?.timeFormatted})</strong></span>
          </div>

          <!-- Official Results Table -->
          <div class="f1-results-table">
            <div class="f1-table-head">
              <span>Pos</span><span>Driver</span><span>Team</span><span>Grid</span><span>Laps</span><span style="text-align:right">Pts</span>
            </div>
            <div class="f1-table-rows">
              ${raceResults.map(r => `
                <div class="f1-table-row ${r.isPlayer ? 'player-row' : ''}">
                  <span class="f1-pos-badge ${r.finishPosition <= 3 ? 'podium-' + r.finishPosition : ''}">${r.finishPosition}</span>
                  <span class="f1-driver-col">
                    <i class="f1-col-dot" style="background:${r.color}"></i>
                    <strong>${r.name}</strong> ${r.isPlayer ? '<small class="player-tag">YOU</small>' : ''}
                    ${r.isFastestLap ? '<span class="f1-fl-badge" title="Fastest Lap of the Race">FL</span>' : ''}
                  </span>
                  <span class="f1-team-col">${r.team}</span>
                  <span class="f1-pos-change">${r.startPosition} (${r.posGained >= 0 ? '+' : ''}${r.posGained})</span>
                  <span class="f1-time-col">${r.lapsCompleted}L</span>
                  <span class="f1-pts-col">+${r.pointsEarned}</span>
                </div>
              `).join('')}
            </div>
          </div>

          <div class="f1-stage-actions">
            ${isSeasonFinale ? `
              <button type="button" class="f1-btn-primary f1-btn-gold f1-btn-lg" id="btnResultsFinale">
                🏆 VIEW FINAL SEASON CHAMPIONS →
              </button>
            ` : `
              <button type="button" class="f1-btn-primary f1-btn-lg" id="btnResultsHub">
                CONTINUE TO CHAMPIONSHIP HUB →
              </button>
            `}
            ${onReturnMain ? `<button type="button" class="f1-btn-secondary" id="btnResultsSaveExit">💾 Save & Exit to Main Menu</button>` : ''}
          </div>
        </div>
      </div>
    `;

    container.querySelector('#btnResultsHub')?.addEventListener('click', onContinueToHub);
    container.querySelector('#btnResultsFinale')?.addEventListener('click', onViewFinale);
    container.querySelector('#btnResultsBack')?.addEventListener('click', onReturnMain);
    container.querySelector('#btnResultsSaveExit')?.addEventListener('click', onReturnMain);
  }

  // ── 11. Season Finale & World Champions ───────────────────────────────────

  /**
   * Render Season Finale Screen with Coronation.
   */
  static renderFinale(container, state, { onStartNew, onReturnMain, onViewStandings }) {
    const champion = state.driverStandings[0];
    const constructorChamp = state.constructorStandings[0];
    const playerResult = state.driverStandings.find(d => d.isPlayer);

    container.innerHTML = `
      <div class="f1-modal-backdrop">
        <div class="f1-finale-card">
          <div class="f1-finale-header">
            <span class="f1-badge-gold">FIA FORMULA ONE WORLD CHAMPIONSHIP</span>
            <h1 class="f1-finale-title">SEASON FINALE</h1>
            <p class="f1-sub">Official Awards and Championship Coronation</p>
          </div>

          <div class="f1-champions-grid">
            <!-- World Drivers' Champion -->
            <div class="f1-champ-box">
              <div class="f1-trophy-icon">🏆</div>
              <span class="f1-trophy-label">WORLD DRIVERS' CHAMPION</span>
              <h2>${champion.name}</h2>
              <div class="f1-champ-meta">
                <span style="color:${champion.color}"><strong>${champion.team}</strong></span>
                <span><strong>${champion.points} Points</strong> &middot; ${champion.wins} Wins &middot; ${champion.podiums} Podiums</span>
              </div>
            </div>

            <!-- World Constructors' Champion -->
            <div class="f1-champ-box">
              <div class="f1-trophy-icon">🏁</div>
              <span class="f1-trophy-label">WORLD CONSTRUCTORS' CHAMPION</span>
              <h2>${constructorChamp.team}</h2>
              <div class="f1-champ-meta">
                <span><strong>${constructorChamp.points} Points</strong> &middot; ${constructorChamp.wins} Total Wins</span>
              </div>
            </div>
          </div>

          <!-- Player Season Performance Box -->
          <div class="f1-player-perf-card">
            <h3>Your Season Performance &middot; ${playerResult?.name}</h3>
            <div class="f1-perf-stats">
              <div class="f1-perf-stat"><span class="lbl">FINAL RANK</span><strong>P${playerResult?.position}</strong></div>
              <div class="f1-perf-stat"><span class="lbl">TOTAL POINTS</span><strong>${playerResult?.points}</strong></div>
              <div class="f1-perf-stat"><span class="lbl">WINS</span><strong>${playerResult?.wins || 0}</strong></div>
              <div class="f1-perf-stat"><span class="lbl">PODIUMS</span><strong>${playerResult?.podiums || 0}</strong></div>
              <div class="f1-perf-stat"><span class="lbl">POLES</span><strong>${playerResult?.poles || 0}</strong></div>
            </div>
          </div>

          <div class="f1-finale-actions">
            <button type="button" class="f1-btn-secondary" id="btnFinaleStandings">View Final Standings</button>
            <button type="button" class="f1-btn-primary" id="btnFinaleNew">Start New Championship</button>
            <button type="button" class="f1-btn-ghost" id="btnFinaleMain">Main Menu</button>
          </div>
        </div>
      </div>
    `;

    container.querySelector('#btnFinaleStandings')?.addEventListener('click', onViewStandings);
    container.querySelector('#btnFinaleNew')?.addEventListener('click', onStartNew);
    container.querySelector('#btnFinaleMain')?.addEventListener('click', onReturnMain);
  }

  // ── 12. Full Standings Modal ──────────────────────────────────────────────

  /**
   * Render modal showing full Driver & Constructor standings.
   */
  static renderStandingsModal(container, state, { onClose }) {
    let activeTab = 'drivers';

    function renderContent() {
      container.innerHTML = `
        <div class="f1-modal-backdrop">
          <div class="f1-stage-card f1-card-wide">
            <div class="f1-stage-nav">
              <div class="f1-tab-group" id="standingsTabs">
                <button type="button" class="f1-tab-btn ${activeTab === 'drivers' ? 'active' : ''}" data-tab="drivers">Drivers' Standings</button>
                <button type="button" class="f1-tab-btn ${activeTab === 'constructors' ? 'active' : ''}" data-tab="constructors">Constructors' Standings</button>
              </div>
              <button type="button" class="f1-btn-ghost" id="btnCloseStandings">✕ Close</button>
            </div>

            <div class="f1-standings-content">
              ${activeTab === 'drivers' ? `
                <div class="f1-table-head">
                  <span>P</span><span>Driver</span><span>Team</span><span>Wins</span><span>Pod</span><span>Gap</span><span style="text-align:right">Pts</span>
                </div>
                <div class="f1-table-rows">
                  ${state.driverStandings.map(d => `
                    <div class="f1-table-row ${d.isPlayer ? 'player-row' : ''}">
                      <span class="f1-pos-badge">${d.position}</span>
                      <span class="f1-driver-col">
                        <i class="f1-col-dot" style="background:${d.color}"></i>
                        ${d.name} ${d.isPlayer ? '<small class="player-tag">YOU</small>' : ''}
                      </span>
                      <span class="f1-team-col">${d.team}</span>
                      <span class="f1-stat-col">${d.wins || 0}</span>
                      <span class="f1-stat-col">${d.podiums || 0}</span>
                      <span class="f1-gap-col">${d.gapToLeader === 0 ? 'LEADER' : '-' + d.gapToLeader}</span>
                      <span class="f1-pts-col"><strong>${d.points}</strong></span>
                    </div>
                  `).join('')}
                </div>
              ` : `
                <div class="f1-table-head">
                  <span>P</span><span>Constructor</span><span>Wins</span><span>Podiums</span><span>Gap</span><span style="text-align:right">Pts</span>
                </div>
                <div class="f1-table-rows">
                  ${state.constructorStandings.map(c => `
                    <div class="f1-table-row">
                      <span class="f1-pos-badge">${c.position}</span>
                      <span class="f1-driver-col"><strong>${c.team}</strong></span>
                      <span class="f1-stat-col">${c.wins || 0}</span>
                      <span class="f1-stat-col">${c.podiums || 0}</span>
                      <span class="f1-gap-col">${c.gapToLeader === 0 ? 'LEADER' : '-' + c.gapToLeader}</span>
                      <span class="f1-pts-col"><strong>${c.points}</strong></span>
                    </div>
                  `).join('')}
                </div>
              `}
            </div>
          </div>
        </div>
      `;

      container.querySelector('#btnCloseStandings')?.addEventListener('click', onClose);
      container.querySelector('#standingsTabs')?.addEventListener('click', e => {
        const btn = e.target.closest('button[data-tab]');
        if (!btn) return;
        activeTab = btn.dataset.tab;
        renderContent();
      });
    }

    renderContent();
  }

  // ── 13. Full Calendar Modal ───────────────────────────────────────────────

  /**
   * Render modal showing full season calendar.
   */
  static renderCalendarModal(container, state, { onClose }) {
    container.innerHTML = `
      <div class="f1-modal-backdrop">
        <div class="f1-stage-card f1-card-wide">
          <div class="f1-stage-nav">
            <span class="f1-badge-gold">OFFICIAL CALENDAR</span>
            <button type="button" class="f1-btn-ghost" id="btnCloseCalendar">✕ Close</button>
          </div>

          <div class="f1-stage-header">
            <h1>Season Calendar &middot; ${state.calendar.length} Rounds</h1>
          </div>

          <div class="f1-calendar-list-scroll">
            ${state.calendar.map((rnd, idx) => {
              const circuit = getCircuit(rnd.circuitId);
              const isCurrent = (idx === state.currentRoundIndex && state.status === SeasonStatus.IN_PROGRESS);
              const isDone = (rnd.status === 'completed');
              const winner = rnd.raceResults ? rnd.raceResults[0] : null;

              return `
                <div class="f1-cal-card ${isCurrent ? 'current' : ''} ${isDone ? 'completed' : ''}">
                  <div class="f1-cal-round-tag">ROUND ${rnd.round}</div>
                  <div class="f1-cal-body">
                    <strong>${circuit.name}</strong>
                    <span>📍 ${circuit.loc} &middot; ${rnd.laps} Laps</span>
                    ${winner ? `
                      <div class="f1-winner-tag">🏆 Winner: <strong>${winner.name} (${winner.team})</strong></div>
                    ` : ''}
                  </div>
                  <div class="f1-cal-status">
                    ${isDone ? '<span class="status-done">COMPLETED</span>' : (isCurrent ? '<span class="status-active">IN PROGRESS</span>' : '<span class="status-pending">UPCOMING</span>')}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    `;

    container.querySelector('#btnCloseCalendar')?.addEventListener('click', onClose);
  }

  // ── 14. Live Race Championship Overlay HUD ────────────────────────────────

  /**
   * Update or mount the compact Live Championship Projections HUD in the live race.
   */
  static updateLiveOverlay(element, projection) {
    if (!element || !projection) return;

    element.innerHTML = `
      <div class="f1-live-champ-hud">
        <div class="f1-lch-title">🏆 CHAMPIONSHIP PROJECTION</div>
        <div class="f1-lch-metrics">
          <span>Projected Rank: <strong>P${projection.playerProjectedRank || '-'}</strong></span>
          <span>Projected Pts: <strong>${projection.playerProjectedPoints}</strong> (${projection.pointsDelta >= 0 ? '+' : ''}${projection.pointsDelta})</span>
        </div>
      </div>
    `;
  }
}
