/**
 * quickRaceUIController.js
 * Workflow Coordinator and Screen Router for Quick Race Mode.
 *
 * Coordinates:
 *   - Entry portal (Quick Start vs Custom Wizard vs Presets)
 *   - 6-step Quick Race Setup Wizard
 *   - Launching race with exact grid, options, and lap count into RaceEngine
 *   - Post-race classification results modal & chequered flag banner
 *   - Restarting race with identical setup
 */

import { QuickRaceManager } from './quickRaceManager.js';
import { QuickRaceViews } from '../ui/quickRaceViews.js';
import { getCircuit } from '../data/circuitData.js';

export const QuickRaceState = Object.freeze({
  CONFIGURATION: 'CONFIGURATION',
  QUALIFYING_INITIALIZATION: 'QUALIFYING_INITIALIZATION',
  QUALIFYING_RUNNING: 'QUALIFYING_RUNNING',
  QUALIFYING_FINALIZATION: 'QUALIFYING_FINALIZATION',
  GRID_FORMATION: 'GRID_FORMATION',
  RACE_PREPARATION: 'RACE_PREPARATION',
  RACING: 'RACING'
});

export class QuickRaceUIController {
  constructor({ engine, onStartRace, onSwitchToChampionship, onReturnHome, $ }) {
    this.engine = engine;
    this.onStartRace = onStartRace;
    this.onSwitchToChampionship = onSwitchToChampionship;
    this.onReturnHome = onReturnHome;
    this.$ = $;

    this.mountEl = $('quickRaceMount');
    this.bannerEl = $('quickRaceFinishedBanner');

    this.manager = new QuickRaceManager();
    this.active = false;
    this.lastClassification = null;
    this.sessionState = QuickRaceState.CONFIGURATION;

    this._bindBannerEvents();
  }

  // ── Mode Activation & Screen Transitions ─────────────────────────────────

  /**
   * Open the Quick Race Entry Screen (Quick Start vs Customize vs Presets).
   */
  openEntryPortal() {
    this.active = true;
    this.hideBanner();
    this.showModal();

    QuickRaceViews.renderEntryPortal(this.mountEl, {
      config: this.manager.getConfig(),
      onQuickStart: () => this.quickStart(),
      onOpenWizard: () => this.openWizard(),
      onLoadPreset: (presetConfig) => {
        this.manager.setConfig(presetConfig);
        this.launchRaceWithConfig(presetConfig);
      },
      onBackToMain: () => {
        this.hideModal();
        this.onReturnHome();
      }
    });
  }

  /**
   * Open the 6-Step Quick Race Configuration Wizard.
   */
  openWizard() {
    this.active = true;
    this.hideBanner();
    this.showModal();

    QuickRaceViews.renderWizard(this.mountEl, {
      initialConfig: this.manager.getConfig(),
      onCancel: () => this.openEntryPortal(),
      onLaunchRace: (wizardState) => this.launchRaceWithConfig(wizardState)
    });
  }

  /**
   * Quick Start: One-click launch with current/saved configuration.
   */
  quickStart() {
    const config = this.manager.getConfig();
    this.launchRaceWithConfig(config);
  }

  /**
   * Launch a race with the specified configuration.
   * If includeQualifying is true, transitions through Qualifying Shootout.
   * If includeQualifying is false, skips qualifying and starts the race directly.
   *
   * @param {object} config
   */
  launchRaceWithConfig(config) {
    const val = this.manager.setConfig(config);
    if (!val.valid) {
      alert(`Setup error:\n${val.errors.join('\n')}`);
      return;
    }

    if (this.manager.getConfig().includeQualifying) {
      this.sessionState = QuickRaceState.QUALIFYING_INITIALIZATION;
      this.showQualifyingScreen();
      return;
    }

    // Direct path: CONFIGURATION -> GRID_FORMATION -> RACE_PREPARATION -> RACING
    this.sessionState = QuickRaceState.GRID_FORMATION;
    this.sessionState = QuickRaceState.RACE_PREPARATION;
    this.sessionState = QuickRaceState.RACING;
    this.startActualRace();
  }

  /**
   * Displays the full-field qualifying shootout screen.
   */
  showQualifyingScreen() {
    this.showModal();
    this.hideBanner();
    const config = this.manager.getConfig();
    const curCircuit = getCircuit(config.circuitId);

    QuickRaceViews.renderQualifying(this.mountEl, {
      config,
      circuit: curCircuit,
      results: config.qualifyingResults || null,
      onRunQuali: () => {
        this.sessionState = QuickRaceState.QUALIFYING_RUNNING;
        this.manager.runQualifyingSession();
        this.sessionState = QuickRaceState.QUALIFYING_FINALIZATION;
        this.showQualifyingScreen();
      },
      onConfirmGrid: () => {
        this.sessionState = QuickRaceState.GRID_FORMATION;
        this.showStartingGridScreen();
      },
      onBack: () => {
        this.sessionState = QuickRaceState.CONFIGURATION;
        this.openWizard();
      }
    });
  }

  /**
   * Displays the confirmed starting grid screen.
   */
  showStartingGridScreen() {
    this.showModal();
    this.hideBanner();
    const config = this.manager.getConfig();
    const curCircuit = getCircuit(config.circuitId);
    const gridData = this.manager.prepareStartingGrid();

    QuickRaceViews.renderStartingGrid(this.mountEl, {
      config,
      circuit: curCircuit,
      grid: gridData.gridDrivers,
      onStartRace: () => {
        this.sessionState = QuickRaceState.RACE_PREPARATION;
        this.sessionState = QuickRaceState.RACING;
        this.startActualRace();
      },
      onBack: () => {
        if (config.includeQualifying) {
          this.sessionState = QuickRaceState.QUALIFYING_FINALIZATION;
          this.showQualifyingScreen();
        } else {
          this.sessionState = QuickRaceState.CONFIGURATION;
          this.openWizard();
        }
      }
    });
  }

  /**
   * Initializes and starts the actual Grand Prix into the RaceEngine.
   */
  startActualRace() {
    this.manager.prepareStartingGrid();
    const options = this.manager.getRaceEngineOptions();

    this.hideModal();
    this.hideBanner();

    this.active = true;
    this.onStartRace(options);
  }

  /**
   * Called when race engine reaches FINISHED state in Quick Race.
   */
  handleRaceFinished() {
    if (!this.active) return;

    this.lastClassification = this.manager.calculateFinalClassification(this.engine);
    this.showBanner();
  }

  /**
   * Show the post-race classification modal.
   */
  showResultsModal() {
    if (!this.lastClassification) {
      this.lastClassification = this.manager.calculateFinalClassification(this.engine);
    }

    const curCircuit = getCircuit(this.manager.getConfig().circuitId);
    this.showModal();

    QuickRaceViews.renderResultsModal(this.mountEl, {
      classification: this.lastClassification,
      circuit: curCircuit,
      onRestart: () => this.restartRace(),
      onConfigure: () => this.openWizard(),
      onReturnMenu: () => {
        this.hideModal();
        this.hideBanner();
        this.onReturnHome();
      }
    });
  }

  /**
   * Restarts the race with the exact same configuration, resetting session state cleanly.
   */
  restartRace() {
    this.hideModal();
    this.hideBanner();
    this.manager.resetQualifyingState();
    const config = this.manager.getConfig();
    this.launchRaceWithConfig(config);
  }

  // ── Banner & Modal Visibility ────────────────────────────────────────────

  showModal() {
    if (this.mountEl) {
      this.mountEl.style.display = 'block';
    }
  }

  hideModal() {
    if (this.mountEl) {
      this.mountEl.style.display = 'none';
      this.mountEl.innerHTML = '';
    }
  }

  showBanner() {
    if (this.bannerEl) {
      this.bannerEl.style.display = 'flex';
      const btn = this.bannerEl.querySelector('#btnQRViewOfficialResults');
      if (btn) {
        btn.onclick = () => this.showResultsModal();
      }
    }
  }

  hideBanner() {
    if (this.bannerEl) {
      this.bannerEl.style.display = 'none';
    }
  }

  _bindBannerEvents() {
    if (this.bannerEl) {
      const btn = this.bannerEl.querySelector('#btnQRViewOfficialResults');
      if (btn) {
        btn.addEventListener('click', () => this.showResultsModal());
      }
    }
  }
}
