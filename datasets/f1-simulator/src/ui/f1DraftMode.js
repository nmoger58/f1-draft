/**
 * f1DraftMode.js
 * F1 Draft Mode — historical season draft game mode.
 *
 * Flow:
 *   1. Year picker screen (2019–2025) with season metadata
 *   2. CSV data load (with spinner)
 *   3. Existing 4-stage DraftModal wizard (driver → manager → car → summary)
 *   4. onConfirm(summary) callback launches Quick Race with chosen lineup
 *
 * Uses a fresh DraftEngine per session (never corrupts the shared QR/Championship engine).
 */

import { loadSeasonPools, SEASON_META } from '../data/seasonCsvLoader.js';
import { DraftEngine }                  from '../strategy/draftEngine.js';
import { DraftModal }                   from './draftModal.js';
import { getLandingAudio }              from './landingAudio.js';

const AVAILABLE_YEARS = [2019, 2020, 2021, 2022, 2023, 2024, 2025];

// ── Year-picker card data ─────────────────────────────────────────────────────

function buildYearCard(year) {
  const meta = SEASON_META[year] || { champion: 'Unknown', tagline: '', color: '#E10600' };
  return `
    <div class="fdm-year-card" data-year="${year}" tabindex="0" role="button"
         aria-label="Select ${year} F1 Season">
      <div class="fdm-year-card-top" style="border-top-color:${meta.color}">
        <span class="fdm-year-number">${year}</span>
        <span class="fdm-year-badge" style="background:${meta.color}">SEASON</span>
      </div>
      <div class="fdm-year-card-body">
        <div class="fdm-year-champion">
          <span class="fdm-year-champ-label">Champion</span>
          <strong class="fdm-year-champ-name">${meta.champion}</strong>
        </div>
        <p class="fdm-year-tagline">${meta.tagline}</p>
      </div>
      <div class="fdm-year-card-footer">
        <button type="button" class="fdm-year-btn" data-year="${year}">
          Draft ${year} Grid →
        </button>
      </div>
    </div>
  `;
}

// ── Spinner helper ────────────────────────────────────────────────────────────

function showSpinner(container, year) {
  container.innerHTML = `
    <div class="fdm-loading">
      <div class="fdm-spinner"></div>
      <p class="fdm-loading-text">Loading ${year} Season Data…</p>
      <p class="fdm-loading-sub">Fetching authentic driver roster and team lineup</p>
    </div>
  `;
}

function showError(container, message, onBack) {
  container.innerHTML = `
    <div class="fdm-error">
      <span class="fdm-error-icon">⚠️</span>
      <p class="fdm-error-msg">${message}</p>
      <button type="button" class="fdm-back-btn fdm-error-back">← Back to Season Select</button>
    </div>
  `;
  container.querySelector('.fdm-error-back')?.addEventListener('click', onBack);
}

// ── F1DraftMode class ─────────────────────────────────────────────────────────

export class F1DraftMode {
  constructor() {
    this._container   = null;
    this._onConfirm   = null;
    this._onBack      = null;
    this._modal       = null;
  }

  /**
   * Show the Draft Mode year picker screen.
   *
   * @param {HTMLElement} container
   * @param {{ onConfirm: function, onBack: function }} options
   */
  show(container, { onConfirm, onBack } = {}) {
    this._container = container;
    this._onConfirm = onConfirm || (() => {});
    this._onBack    = onBack    || (() => {});

    this._renderYearPicker();
  }

  // ── Year picker render ──────────────────────────────────────────────────────

  _renderYearPicker() {
    if (!this._container) return;

    this._container.innerHTML = `
      <div class="fdm-wrapper">

        <!-- Fixed immersive background (reuses landing page layer) -->
        <div class="lp-fixed-screen-bg fdm-bg" aria-hidden="true">
          <img src="/assets/images/hero_sunset_race.png" alt="Formula 1 Sunset Racing" class="lp-fixed-bg-img lp-hero-img" loading="eager" />
          <div class="lp-fixed-bg-overlay"></div>
          <div class="lp-fixed-bg-vignette"></div>
          <div class="lp-fixed-bg-grid"></div>
        </div>

        <!-- Content layer -->
        <div class="fdm-content">
          <!-- Header bar -->
          <div class="fdm-topbar">
            <button type="button" class="fdm-back-btn" id="fdmBackBtn">← Back</button>
            <div class="fdm-topbar-brand">
              <span class="lp-brand-badge">F1</span>
              <div>
                <span class="fdm-brand-title">DRAFT MODE</span>
                <span class="fdm-brand-sub">HISTORIC SEASON SELECT</span>
              </div>
            </div>
            <div class="fdm-topbar-spacer"></div>
          </div>

          <!-- Section header -->
          <div class="fdm-section-header">
            <span class="lp-section-tag">HISTORIC SEASONS · 2019–2025</span>
            <h2 class="lp-section-title fdm-section-title">CHOOSE YOUR ERA</h2>
            <p class="lp-section-sub">
              Select a Formula 1 season to draft authentic drivers, constructors, and team principals
              from that year's real grid. Race as a historic lineup with stats derived from genuine
              career data.
            </p>
          </div>

          <!-- Year cards grid -->
          <div class="fdm-year-grid" id="fdmYearGrid">
            ${AVAILABLE_YEARS.map(y => buildYearCard(y)).join('')}
          </div>

          <!-- Info strip -->
          <div class="fdm-info-strip">
            <div class="fdm-info-item">
              <span class="fdm-info-icon">📋</span>
              <span>Authentic driver stats from official FIA records</span>
            </div>
            <div class="fdm-info-item">
              <span class="fdm-info-icon">🏎️</span>
              <span>4-stage draft: Driver → Principal → Car → Summary</span>
            </div>
            <div class="fdm-info-item">
              <span class="fdm-info-icon">⚡</span>
              <span>Race launches in Quick Race mode with historic lineup</span>
            </div>
          </div>
        </div>
      </div>
    `;

    this._bindYearPickerEvents();
  }

  _bindYearPickerEvents() {
    const container = this._container;
    if (!container) return;

    // Back button
    container.querySelector('#fdmBackBtn')?.addEventListener('click', () => {
      this._onBack();
    });

    // Year card clicks (card itself or inner button)
    container.querySelectorAll('[data-year]').forEach(el => {
      const handler = () => {
        const year = parseInt(el.dataset.year, 10);
        if (!isNaN(year)) this._selectYear(year);
      };
      el.addEventListener('click', handler);
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); }
      });
    });
  }

  // ── Year selection & data load ──────────────────────────────────────────────

  async _selectYear(year) {
    const container = this._container;
    if (!container) return;

    showSpinner(container.querySelector('.fdm-content') || container, year);

    try {
      const { drivers, managers, cars } = await loadSeasonPools(year);

      if (!drivers.length) throw new Error(`No driver data found for ${year}.`);

      this._openDraftWizard(year, drivers, managers, cars);
    } catch (err) {
      console.error('[F1DraftMode] Failed to load season:', year, err);
      showError(
        container.querySelector('.fdm-content') || container,
        `Could not load the ${year} season data. Please check your connection and try again.<br><small>${err.message}</small>`,
        () => this._renderYearPicker()
      );
    }
  }

  // ── Draft wizard ────────────────────────────────────────────────────────────

  _openDraftWizard(year, drivers, managers, cars) {
    // Create a fresh DraftEngine with the historic season pools
    const engine = new DraftEngine({
      mode: 'historic',
      driverPool:  drivers,
      managerPool: managers,
      carPool:     cars,
      autoRestore: false,          // never restore Quick Race state into historic mode
    });

    // Instantiate a fresh DraftModal (not the shared singleton)
    const modal = new DraftModal({
      draftEngine:    engine,
      title:          `${year} F1 Season Draft`,
      subtitle:       `${SEASON_META[year]?.tagline || ''}  —  Draft your historic lineup`,
      onConfirm: (summary) => {
        // Annotate summary with the season year
        summary.seasonYear = year;
        getLandingAudio().play(); // keep the soundtrack alive
        this._onConfirm(summary);
      },
      onClose: () => {
        // User closed the wizard without completing — go back to year picker
        this._renderYearPicker();
      },
    });

    this._modal = modal;
    modal.open();
  }

  /** Destroy this controller and clean up. */
  destroy() {
    this._modal = null;
    this._container = null;
  }
}

// ── Singleton factory ─────────────────────────────────────────────────────────
let _instance = null;
export function getDraftModeController() {
  if (!_instance) _instance = new F1DraftMode();
  return _instance;
}
