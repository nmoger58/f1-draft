/**
 * draftModal.js
 * Motorsport-Themed Draft Selection Modal.
 *
 * Implements 5-card draft sets for:
 *   1. Driver Selection (20 authentic 2025 F1 drivers)
 *   2. Team Principal / Manager Selection (8 authentic managers)
 *   3. Constructor Machine Selection (10 authentic F1 cars)
 *   4. Team Confirmation & Synergy Summary
 *
 * Fully responsive across desktop and mobile devices.
 */

import { DRAFT_STAGES, getSharedDraftEngine } from '../strategy/draftEngine.js';
import { getRarity } from '../data/mlIntelligence.js';

export class DraftModal {
  constructor(options = {}) {
    this.draftEngine = options.draftEngine || getSharedDraftEngine();
    this.onConfirm = options.onConfirm || (() => {});
    this.onClose = options.onClose || (() => {});
    this.container = null;
    this.isOpen = false;
  }

  /**
   * Open the Draft Modal at a specific stage or resume previous.
   */
  open(stage = DRAFT_STAGES.DRIVER) {
    this.draftEngine.setStage(stage);
    this.isOpen = true;
    this._render();
  }

  /**
   * Close the modal.
   */
  close() {
    this.isOpen = false;
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    this.container = null;
    this.onClose();
  }

  _render() {
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = 'draftModalContainer';
      this.container.className = 'draft-modal-backdrop';
      document.body.appendChild(this.container);
    }

    const currentStage = this.draftEngine.stage;
    const isDriver = currentStage === DRAFT_STAGES.DRIVER;
    const isManager = currentStage === DRAFT_STAGES.MANAGER;
    const isCar = currentStage === DRAFT_STAGES.CAR;
    const isSummary = currentStage === DRAFT_STAGES.SUMMARY;

    const stageNumber = isDriver ? 1 : isManager ? 2 : isCar ? 3 : 4;
    const isReady = this.draftEngine.isStageReady(currentStage);

    let stageTitle = '';
    let stageSubtitle = '';
    let bodyContent = '';

    if (isDriver) {
      stageTitle = 'STAGE 1: DRAFT YOUR DRIVER';
      stageSubtitle = 'Choose your driver from the 5-card draft set. Use Shuffle to browse the full 2025 grid.';
      bodyContent = this._renderDriverCards();
    } else if (isManager) {
      stageTitle = 'STAGE 2: APPOINT TEAM PRINCIPAL';
      stageSubtitle = 'Select your manager. Principals modulate pit stop execution, tyre wear and race strategy.';
      bodyContent = this._renderManagerCards();
    } else if (isCar) {
      stageTitle = 'STAGE 3: CHOOSE CONSTRUCTOR MACHINE';
      stageSubtitle = 'Select your chassis. Aerodynamics, top speed and tyre preservation directly affect on-track physics.';
      bodyContent = this._renderCarCards();
    } else {
      stageTitle = 'TEAM DRAFT SUMMARY & SYNERGY';
      stageSubtitle = 'Confirm your chosen driver, team principal and car before taking to the track.';
      bodyContent = this._renderSummaryContent();
    }

    this.container.innerHTML = `
      <div class="draft-dialog" role="dialog" aria-modal="true" aria-labelledby="draftModalTitle">
        <!-- Draft Header -->
        <div class="draft-header">
          <div class="draft-header-meta">
            <span class="draft-stage-pill">STEP ${stageNumber} OF 4</span>
            <span class="draft-mode-tag">${this.draftEngine.mode === 'championship' ? '🏆 CHAMPIONSHIP' : '⚡ QUICK RACE'}</span>
          </div>
          <h2 class="draft-title" id="draftModalTitle">${stageTitle}</h2>
          <p class="draft-subtitle">${stageSubtitle}</p>
          <button type="button" class="draft-close-btn" id="draftCloseBtn" aria-label="Close Draft">&times;</button>

          <!-- Breadcrumb Progress Steps -->
          <div class="draft-progress-steps">
            <div class="draft-step-item ${isDriver ? 'active' : this.draftEngine.selectedDriverId ? 'completed' : ''}" data-goto="driver">
              <span class="step-num">1</span> Driver
            </div>
            <div class="draft-step-item ${isManager ? 'active' : this.draftEngine.selectedManagerId ? 'completed' : ''}" data-goto="manager">
              <span class="step-num">2</span> Manager
            </div>
            <div class="draft-step-item ${isCar ? 'active' : this.draftEngine.selectedCarId ? 'completed' : ''}" data-goto="car">
              <span class="step-num">3</span> Car
            </div>
            <div class="draft-step-item ${isSummary ? 'active' : ''}" data-goto="summary">
              <span class="step-num">4</span> Summary
            </div>
          </div>
        </div>

        <!-- Draft Body (Cards or Summary) -->
        <div class="draft-body" id="draftBody">
          ${bodyContent}
        </div>

        <!-- Draft Footer Controls -->
        <div class="draft-footer">
          <div class="draft-footer-left">
            ${!isSummary ? `
              <button type="button" class="btn-draft-secondary" id="draftShuffleBtn">
                🔄 Shuffle / Next 5
              </button>
            ` : `
              <button type="button" class="btn-draft-secondary" id="draftEditBtn">
                ✏️ Edit Selection
              </button>
            `}
          </div>

          <div class="draft-footer-right">
            ${stageNumber > 1 ? `
              <button type="button" class="btn-draft-secondary" id="draftPrevBtn">
                ← Back
              </button>
            ` : ''}

            ${!isSummary ? `
              <button type="button" class="btn-draft-primary" id="draftNextBtn" ${!isReady ? 'disabled' : ''}>
                Continue →
              </button>
            ` : `
              <button type="button" class="btn-draft-primary btn-confirm-launch" id="draftConfirmBtn">
                🏁 Confirm & Launch Race
              </button>
            `}
          </div>
        </div>
      </div>
    `;

    this._attachEventListeners();
  }

  _renderDriverCards() {
    const cards = this.draftEngine.getDraftSet('driver');
    const selectedId = this.draftEngine.getSelectedId('driver');

    return `
      <div class="draft-cards-grid">
        ${cards.map(driver => {
          const isSelected = driver.code === selectedId;
          const p = driver.personality || {};
          const aggPct = Math.round((p.aggression ?? 0.7) * 100);
          const conPct = Math.round((p.consistency ?? 0.8) * 100);
          const racPct = Math.round((p.racecraft ?? 0.8) * 100);
          const tyrPct = Math.round((p.tyreManagement ?? 0.75) * 100);
          const wetPct = Math.round((p.wetSkill ?? 0.75) * 100);
          const overallRating = driver.overallRating || driver.blendedRating || Math.round((conPct * 0.35 + racPct * 0.35 + tyrPct * 0.30));
          const rarity = driver.rarity || getRarity(overallRating);
          const confidence = driver.confidencePct || 85;
          const laps = driver.laps_in_data ? driver.laps_in_data.toLocaleString() : '1,500';

          return `
            <div class="draft-card ${isSelected ? 'is-selected' : ''} rarity-${rarity.name}" data-category="driver" data-id="${driver.code}" tabindex="0" role="button" aria-pressed="${isSelected}">
              ${isSelected ? '<span class="draft-card-badge">SELECTED</span>' : ''}
              
              <div class="draft-card-stripe" style="background:${driver.color || '#FF8000'}"></div>
              
              <div class="draft-card-top">
                <div class="draft-number-box">
                  <span class="draft-rarity-badge" style="background:${rarity.badgeBg};color:${rarity.textColor};box-shadow:${rarity.glow}">
                    ${rarity.name}
                  </span>
                  <span class="draft-car-number">#${driver.number}</span>
                  <span class="draft-code">${driver.code}</span>
                </div>
                <div class="draft-ovr-box">
                  <span class="ovr-label">OVR</span>
                  <span class="ovr-value" style="color:${rarity.color}">${overallRating}</span>
                </div>
              </div>

              <!-- Statistical ML Confidence Pill -->
              <div class="draft-ml-confidence" title="Trained across 7 supervised ML algorithms on ${laps} laps">
                <span class="ml-pulse-dot"></span>
                <span>⚡ ${confidence}% ML Confidence</span>
              </div>

              <!-- Driver Avatar & Helmet Placeholder -->
              <div class="draft-avatar-box">
                <div class="draft-avatar-circle" style="border-color:${driver.color || '#FF8000'}">
                  <span class="draft-avatar-initials">${driver.code}</span>
                </div>
              </div>

              <div class="draft-card-info">
                <h3 class="draft-card-name">${driver.name}</h3>
                <span class="draft-card-team" style="color:${driver.teamColor || '#aaa'}">${driver.team}</span>
                <span class="draft-card-country">${driver.nationality || driver.country || 'International'}</span>
              </div>

              <!-- ML Capabilities Metrics Chips -->
              <div class="draft-ml-pills">
                <span class="ml-pill" title="Tyre Degradation Z-Score">TYR <b>${(driver.tyre_z ?? 0) > 0 ? '+' : ''}${(driver.tyre_z ?? 0).toFixed(1)}z</b></span>
                <span class="ml-pill" title="Lap-to-Lap Consistency Z-Score">CON <b>${(driver.consistency_z ?? 0) > 0 ? '+' : ''}${(driver.consistency_z ?? 0).toFixed(1)}z</b></span>
                <span class="ml-pill" title="Raw Pace Delta %">PACE <b>${(driver.raw_pace_pct ?? 0) > 0 ? '+' : ''}${(driver.raw_pace_pct ?? -0.45).toFixed(2)}%</b></span>
              </div>

              <!-- Home / Track Specialist Badges -->
              ${(driver.trackBadges && driver.trackBadges.length > 0) ? `
                <div class="draft-track-badges">
                  ${driver.trackBadges.map(b => `<span class="track-badge ${b.type}">${b.label}</span>`).join('')}
                </div>
              ` : ''}

              <!-- Key Attributes Radar/Bars -->
              <div class="draft-card-attrs">
                <div class="draft-attr-row">
                  <span>Racecraft</span>
                  <div class="draft-bar"><div class="draft-bar-fill" style="width:${racPct}%"></div></div>
                  <strong>${racPct}</strong>
                </div>
                <div class="draft-attr-row">
                  <span>Consistency</span>
                  <div class="draft-bar"><div class="draft-bar-fill" style="width:${conPct}%"></div></div>
                  <strong>${conPct}</strong>
                </div>
                <div class="draft-attr-row">
                  <span>Tyre Longevity</span>
                  <div class="draft-bar"><div class="draft-bar-fill" style="width:${tyrPct}%"></div></div>
                  <strong>${tyrPct}</strong>
                </div>
                <div class="draft-attr-row">
                  <span>Wet Skill</span>
                  <div class="draft-bar"><div class="draft-bar-fill" style="width:${wetPct}%"></div></div>
                  <strong>${wetPct}</strong>
                </div>
              </div>

              <button type="button" class="btn-card-select">
                ${isSelected ? '✓ Picked' : 'Select Driver'}
              </button>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  _renderManagerCards() {
    const cards = this.draftEngine.getDraftSet('manager');
    const selectedId = this.draftEngine.getSelectedId('manager');

    return `
      <div class="draft-cards-grid">
        ${cards.map(mgr => {
          const isSelected = mgr.id === selectedId;
          const a = mgr.attributes || {};
          const rarity = mgr.rarity || getRarity(mgr.rating || 90);

          return `
            <div class="draft-card manager-card ${isSelected ? 'is-selected' : ''} rarity-${rarity.name}" data-category="manager" data-id="${mgr.id}" tabindex="0" role="button" aria-pressed="${isSelected}">
              ${isSelected ? '<span class="draft-card-badge">SELECTED</span>' : ''}
              
              <div class="draft-card-stripe manager-stripe"></div>

              <div class="draft-card-top">
                <div class="draft-number-box">
                  <span class="draft-rarity-badge" style="background:${rarity.badgeBg};color:${rarity.textColor};box-shadow:${rarity.glow}">
                    ${rarity.name}
                  </span>
                  <span class="manager-emoji">${mgr.avatar || '👨‍💼'}</span>
                </div>
                <div class="draft-ovr-box">
                  <span class="ovr-label">TACTICAL</span>
                  <span class="ovr-value" style="color:${rarity.color}">${mgr.rating || 90}</span>
                </div>
              </div>

              <div class="draft-card-info">
                <h3 class="draft-card-name">${mgr.name}</h3>
                <span class="draft-card-team">${mgr.team}</span>
                <span class="draft-manager-style">${mgr.style}</span>
              </div>

              <!-- Tactical Attributes -->
              <div class="draft-card-attrs">
                <div class="draft-attr-row">
                  <span>Strategy</span>
                  <div class="draft-bar"><div class="draft-bar-fill" style="width:${a.strategy || 90}%"></div></div>
                  <strong>${a.strategy || 90}</strong>
                </div>
                <div class="draft-attr-row">
                  <span>Pit Crew</span>
                  <div class="draft-bar"><div class="draft-bar-fill" style="width:${a.pitCrew || 90}%"></div></div>
                  <strong>${a.pitCrew || 90}</strong>
                </div>
                <div class="draft-attr-row">
                  <span>Tyre Mastery</span>
                  <div class="draft-bar"><div class="draft-bar-fill" style="width:${a.tyreManagement || 90}%"></div></div>
                  <strong>${a.tyreManagement || 90}</strong>
                </div>
                <div class="draft-attr-row">
                  <span>Leadership</span>
                  <div class="draft-bar"><div class="draft-bar-fill" style="width:${a.leadership || 90}%"></div></div>
                  <strong>${a.leadership || 90}</strong>
                </div>
              </div>

              <!-- Authoritative Perks -->
              <div class="draft-perks-list">
                ${(mgr.perks || []).slice(0, 2).map(perk => `
                  <div class="draft-perk-item">⚡ ${perk}</div>
                `).join('')}
              </div>

              <button type="button" class="btn-card-select">
                ${isSelected ? '✓ Appointed' : 'Appoint Manager'}
              </button>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  _renderCarCards() {
    const cards = this.draftEngine.getDraftSet('car');
    const selectedId = this.draftEngine.getSelectedId('car');

    return `
      <div class="draft-cards-grid">
        ${cards.map(car => {
          const isSelected = car.id === selectedId;
          const s = car.stats || {};
          const carRating = car.carRating || Math.round(s.cornering || 85);
          const rarity = car.rarity || getRarity(carRating);

          return `
            <div class="draft-card car-card ${isSelected ? 'is-selected' : ''} rarity-${rarity.name}" data-category="car" data-id="${car.id}" tabindex="0" role="button" aria-pressed="${isSelected}">
              ${isSelected ? '<span class="draft-card-badge">SELECTED</span>' : ''}
              
              <div class="draft-card-stripe" style="background:${car.color || '#fff'}"></div>

              <div class="draft-card-top">
                <div class="draft-number-box">
                  <span class="draft-rarity-badge" style="background:${rarity.badgeBg};color:${rarity.textColor};box-shadow:${rarity.glow}">
                    ${rarity.name}
                  </span>
                  <span class="car-badge-icon">${car.badge || '🏎️'}</span>
                </div>
                <div class="draft-ovr-box">
                  <span class="ovr-label">MACHINERY</span>
                  <span class="ovr-value" style="color:${rarity.color}">${carRating}</span>
                </div>
              </div>

              <div class="draft-card-info">
                <h3 class="draft-card-name">${car.name}</h3>
                <span class="draft-card-team">${car.team}</span>
                ${car.aeroBias ? `<span class="draft-car-aerobias">${car.aeroBias}</span>` : ''}
              </div>

              <!-- Performance Attributes -->
              <div class="draft-card-attrs">
                <div class="draft-attr-row">
                  <span>Top Speed</span>
                  <div class="draft-bar"><div class="draft-bar-fill" style="width:${s.topSpeed || 90}%"></div></div>
                  <strong>${s.topSpeed || 90}</strong>
                </div>
                <div class="draft-attr-row">
                  <span>Acceleration</span>
                  <div class="draft-bar"><div class="draft-bar-fill" style="width:${s.acceleration || 90}%"></div></div>
                  <strong>${s.acceleration || 90}</strong>
                </div>
                <div class="draft-attr-row">
                  <span>Cornering</span>
                  <div class="draft-bar"><div class="draft-bar-fill" style="width:${s.cornering || 90}%"></div></div>
                  <strong>${s.cornering || 90}</strong>
                </div>
                <div class="draft-attr-row">
                  <span>Tyre Preserv.</span>
                  <div class="draft-bar"><div class="draft-bar-fill" style="width:${s.tyrePreservation || 90}%"></div></div>
                  <strong>${s.tyrePreservation || 90}</strong>
                </div>
              </div>

              <!-- Prominent Machinery Strengths Box -->
              <div class="draft-car-notes">
                <div class="draft-note-strength">💪 <strong>Strengths:</strong> ${car.strengths || 'Balanced high-speed aerodynamic downforce and tyre preservation.'}</div>
              </div>

              <button type="button" class="btn-card-select">
                ${isSelected ? '✓ Selected' : 'Choose Machine'}
              </button>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  _renderSummaryContent() {
    const summary = this.draftEngine.getSummary();
    const d = summary.driver;
    const m = summary.manager;
    const c = summary.car;
    const mods = summary.modifiers;
    const teamOvr = summary.teamOvr || 88;
    const teamRarity = getRarity(teamOvr);

    return `
      <div class="draft-summary-container">
        <!-- Team Header Banner -->
        <div class="draft-summary-banner">
          <div>
            <span class="summary-banner-eyebrow">PADDOCK ENTRY APPROVED · 7-ALGORITHM ML INTELLIGENCE</span>
            <h3 class="summary-banner-title">${c?.team || 'Apex Racing'} Paddock Entry</h3>
          </div>
          <div class="summary-banner-ovr">
            <span class="draft-rarity-badge" style="background:${teamRarity.badgeBg};color:${teamRarity.textColor}">${teamRarity.name}</span>
            <div class="banner-ovr-num">${teamOvr} <small>OVR</small></div>
          </div>
        </div>

        <div class="summary-trio-grid">
          <!-- Driver Summary -->
          <div class="summary-trio-card" style="border-top: 4px solid ${d?.color || '#FF8000'}">
            <span class="trio-label">SELECTED DRIVER</span>
            <div class="trio-title">${d?.name || 'None'} <span class="trio-code">#${d?.number || ''} ${d?.code || ''}</span></div>
            <div class="trio-sub">${d?.team || ''} · ${d?.nationality || ''}</div>
            <div class="trio-ml-info">
              <span>⚡ ${d?.confidencePct || 85}% ML Confidence</span>
              <span>TYR: ${(d?.tyre_z ?? 0) > 0 ? '+' : ''}${(d?.tyre_z ?? 0).toFixed(1)}z</span>
            </div>
            <div class="trio-stats">
              <span>Racecraft: ${Math.round((d?.personality?.racecraft ?? 0.8) * 100)}%</span>
              <span>Consistency: ${Math.round((d?.personality?.consistency ?? 0.8) * 100)}%</span>
            </div>
          </div>

          <!-- Manager Summary -->
          <div class="summary-trio-card" style="border-top: 4px solid #3671c6">
            <span class="trio-label">TEAM PRINCIPAL</span>
            <div class="trio-title">${m?.name || 'None'} <span class="trio-code">${m?.avatar || '👨‍💼'}</span></div>
            <div class="trio-sub">${m?.team || ''} · ${m?.style || ''}</div>
            <div class="trio-stats">
              <span>Strategy: ${m?.attributes?.strategy || 90}</span>
              <span>Pit Crew: ${m?.attributes?.pitCrew || 90}</span>
            </div>
          </div>

          <!-- Car Summary -->
          <div class="summary-trio-card" style="border-top: 4px solid ${c?.color || '#27F4D2'}">
            <span class="trio-label">CONSTRUCTOR CHASSIS</span>
            <div class="trio-title">${c?.name || 'None'} <span class="trio-code">${c?.badge || '🏎️'}</span></div>
            <div class="trio-sub">${c?.team || ''} · Machinery OVR: ${c?.carRating || 85}</div>
            <div class="trio-strengths-snippet">💪 ${c?.strengths || 'Balanced high-speed aerodynamic efficiency.'}</div>
            <div class="trio-stats">
              <span>Top Speed: ${c?.stats?.topSpeed || 90}</span>
              <span>Cornering: ${c?.stats?.cornering || 90}</span>
            </div>
          </div>
        </div>

        <!-- Simulation Synergy Panel -->
        <div class="draft-synergy-panel">
          <h4 class="synergy-header">⚡ AUTHORITATIVE SIMULATION SYNERGY</h4>
          <div class="synergy-grid">
            <div class="synergy-stat">
              <span class="stat-label">Pit Stop Stopwatch</span>
              <strong class="stat-val ${mods.pitLossDelta < 0 ? 'good' : ''}">${(2.4 + mods.pitLossDelta).toFixed(2)}s (${mods.pitLossDelta > 0 ? '+' : ''}${mods.pitLossDelta.toFixed(2)}s)</strong>
            </div>
            <div class="synergy-stat">
              <span class="stat-label">Tyre Wear Scalar</span>
              <strong class="stat-val good">${mods.tyreDegMult.toFixed(3)}x (${Math.round((1 - mods.tyreDegMult) * 100)}% wear savings)</strong>
            </div>
            <div class="synergy-stat">
              <span class="stat-label">Terminal Velocity Delta</span>
              <strong class="stat-val ${mods.maxSpeedBonus > 0 ? 'good' : ''}">${mods.maxSpeedBonus >= 0 ? '+' : ''}${mods.maxSpeedBonus.toFixed(1)} m/s</strong>
            </div>
            <div class="synergy-stat">
              <span class="stat-label">Grid Launch Reaction Assist</span>
              <strong class="stat-val good">${mods.launchAssistMs > 0 ? `-${mods.launchAssistMs}ms` : 'Baseline'}</strong>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  _attachEventListeners() {
    // Close button
    const closeBtn = this.container.querySelector('#draftCloseBtn');
    if (closeBtn) closeBtn.onclick = () => this.close();

    // Card selection clicks
    const cards = this.container.querySelectorAll('.draft-card');
    cards.forEach(card => {
      card.onclick = () => {
        const cat = card.dataset.category;
        const id = card.dataset.id;
        if (cat && id) {
          this.draftEngine.selectEntity(cat, id);
          this._render();
        }
      };
      card.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          card.click();
        }
      };
    });

    // Shuffle / Next Set button
    const shuffleBtn = this.container.querySelector('#draftShuffleBtn');
    if (shuffleBtn) {
      shuffleBtn.onclick = () => {
        this.draftEngine.shuffleNextSet(this.draftEngine.stage);
        this._render();
      };
    }

    // Step navigation buttons
    const nextBtn = this.container.querySelector('#draftNextBtn');
    if (nextBtn) {
      nextBtn.onclick = () => {
        if (this.draftEngine.nextStage()) {
          this._render();
        }
      };
    }

    const prevBtn = this.container.querySelector('#draftPrevBtn');
    if (prevBtn) {
      prevBtn.onclick = () => {
        this.draftEngine.prevStage();
        this._render();
      };
    }

    const editBtn = this.container.querySelector('#draftEditBtn');
    if (editBtn) {
      editBtn.onclick = () => {
        this.draftEngine.setStage(DRAFT_STAGES.DRIVER);
        this._render();
      };
    }

    // Breadcrumb clicks
    const breadcrumbs = this.container.querySelectorAll('.draft-step-item');
    breadcrumbs.forEach(bc => {
      bc.onclick = () => {
        const target = bc.dataset.goto;
        if (target) {
          this.draftEngine.setStage(target);
          this._render();
        }
      };
    });

    // Confirm & Launch Race button
    const confirmBtn = this.container.querySelector('#draftConfirmBtn');
    if (confirmBtn) {
      confirmBtn.onclick = () => {
        const summary = this.draftEngine.getSummary();
        this.close();
        this.onConfirm(summary);
      };
    }
  }
}

// Global modal singleton
let _draftModalInstance = null;

export function getDraftModal(options = {}) {
  if (!_draftModalInstance) {
    _draftModalInstance = new DraftModal(options);
  } else if (options.onConfirm) {
    _draftModalInstance.onConfirm = options.onConfirm;
  }
  return _draftModalInstance;
}
