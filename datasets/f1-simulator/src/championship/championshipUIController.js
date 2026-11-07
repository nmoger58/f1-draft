/**
 * championshipUIController.js
 * Comprehensive Screen Router and Workflow Coordinator for Championship Mode.
 *
 * Connects ChampionshipManager, ChampionshipViews, and the shared RaceEngine:
 *   - Orchestrates all screen transitions (Menu -> Wizard -> Hub -> Weekend -> Race -> Results -> Finale)
 *   - Ensures Quick Play and Championship Mode remain 100% independent
 *   - Manages live in-race championship projections
 *   - Provides safe save-and-resume handling across browser refreshes
 */

import { ChampionshipManager } from './championshipManager.js';
import { ChampionshipViews } from '../ui/championshipViews.js';
import { WeekendStage, SeasonStatus } from './championshipState.js';

export class ChampionshipUIController {
  constructor({ engine, onStartChampionshipRace, onSwitchToQuickPlay, onReturnHome, $ }) {
    this.engine = engine;
    this.onStartChampionshipRace = onStartChampionshipRace;
    this.onSwitchToQuickPlay = onSwitchToQuickPlay;
    this.onReturnHome = onReturnHome;
    this.$ = $;

    this.mountEl = $('championshipMount');
    this.hudEl   = $('liveChampHudMount');
    this.bannerEl= $('raceFinishedBanner');

    // Championship Session State
    this.active = false;
    this.champ = null;
    this.lastFinalizedResults = null;

    // Restore any active championship from persistence
    if (ChampionshipManager.hasActiveChampionship()) {
      this.champ = ChampionshipManager.loadActiveChampionship();
    }
  }

  // ── Mode Switching ────────────────────────────────────────────────────────

  /** Return to Landing Page Main Menu */
  returnToMainMenu() {
    this.active = false;
    this.hideModal();
    this.hideBanner();
    this.hideLiveHUD();

    this.$('navChampionship')?.classList.remove('active', 'champ-active');
    this.$('navQuickPlay')?.classList.remove('active');
    this.$('simHeader')?.classList.remove('nav-open');

    // Restore circuit tabs visibility if needed
    const tabs = this.$('tabs');
    if (tabs) tabs.style.visibility = 'visible';

    if (this.onReturnHome) {
      this.onReturnHome();
    } else {
      this.switchToQuickPlay();
    }
  }

  /** Enter Quick Play mode */
  switchToQuickPlay() {
    this.active = false;
    this.hideModal();
    this.hideBanner();
    this.hideLiveHUD();

    this.$('navQuickPlay')?.classList.add('active');
    this.$('navChampionship')?.classList.remove('active', 'champ-active');

    // Show circuit tabs and grid selector
    const tabs = this.$('tabs');
    if (tabs) tabs.style.visibility = 'visible';

    this.onSwitchToQuickPlay();
  }

  /** Enter Championship Mode */
  switchToChampionshipMode() {
    this.$('navQuickPlay')?.classList.remove('active');
    this.$('navChampionship')?.classList.add('active', 'champ-active');

    // Hide quick-play circuit tabs while in championship flow
    const tabs = this.$('tabs');
    if (tabs) tabs.style.visibility = 'hidden';

    this.showEntryScreen();
  }

  // ── Screen Transitions ───────────────────────────────────────────────────

  /** Show Main Menu (Quick Play vs Championship) */
  showMainMenu() {
    this.showModal();
    ChampionshipViews.renderMainMenu(this.mountEl, {
      onQuickPlay: () => this.switchToQuickPlay(),
      onChampionshipMode: () => this.switchToChampionshipMode(),
      onBackToMain: () => this.returnToMainMenu(),
      hasActiveChamp: ChampionshipManager.hasActiveChampionship()
    });
  }

  /** Show Championship Entry Portal (New vs Continue vs History) */
  showEntryScreen() {
    this.showModal();
    this.champ = ChampionshipManager.loadActiveChampionship();
    const history = ChampionshipManager.getChampionshipHistory();

    ChampionshipViews.renderChampionshipEntry(this.mountEl, {
      activeChamp: this.champ,
      history,
      onContinue: () => this.resumeChampionship(),
      onNewChampionship: () => this.startCreationWizard(),
      onViewHistory: () => this.showHistoryModal(),
      onBackToMain: () => this.returnToMainMenu()
    });
  }

  /** Open Season Creation Wizard */
  startCreationWizard() {
    this.showModal();
    ChampionshipViews.renderWizard(this.mountEl, {
      onCancel: () => this.showEntryScreen(),
      onComplete: (wizardConfig) => {
        this.champ = ChampionshipManager.createChampionship(wizardConfig);
        this.showHub();
      }
    });
  }

  /** Open Championship Hub */
  showHub() {
    this.showModal();
    this.active = true;
    this.champ = ChampionshipManager.loadActiveChampionship();

    if (!this.champ) {
      this.showEntryScreen();
      return;
    }

    if (this.champ.status === SeasonStatus.COMPLETED) {
      this.showSeasonFinale();
      return;
    }

    ChampionshipViews.renderHub(this.mountEl, this.champ, {
      onMainAction: () => this.handleHubMainAction(),
      onViewCalendar: () => this.showCalendarModal(),
      onViewStandings: () => this.showStandingsModal(),
      onViewHistory: () => this.showHistoryModal(),
      onSaveAndExit: () => {
        ChampionshipManager.saveActiveChampionship(this.champ);
        this.returnToMainMenu();
      }
    });
  }

  /** Primary contextual action handler from Hub */
  handleHubMainAction() {
    const round = ChampionshipManager.getCurrentRound(this.champ);
    if (!round) return;

    switch (round.stage) {
      case WeekendStage.EVENT_OVERVIEW:
        this.showEventOverview();
        break;
      case WeekendStage.PRACTICE_PENDING:
        this.showPracticeScreen();
        break;
      case WeekendStage.PRACTICE_COMPLETED:
      case WeekendStage.QUALIFYING_PENDING:
        this.showQualifyingScreen();
        break;
      case WeekendStage.QUALIFYING_COMPLETED:
      case WeekendStage.GRID_CONFIRMATION:
        this.showStartingGridScreen();
        break;
      case WeekendStage.RACE_READY:
        this.showRacePrepScreen();
        break;
      case WeekendStage.RACE_IN_PROGRESS:
        // Resume active race
        this.hideModal();
        this.active = true;
        if (this.engine && this.engine.cars && this.engine.cars.length && this.engine.track?.circuit?.id === round.circuitId) {
          if (this.$) {
            this.$('simulatorView') && (this.$('simulatorView').style.display = 'block');
            this.$('simHeader') && (this.$('simHeader').style.display = 'flex');
          }
          if (this.hudEl) this.hudEl.style.display = 'block';
          if (typeof window !== 'undefined' && window.simulatorState) window.simulatorState.playing = true;
        } else if (this.onStartChampionshipRace) {
          this.onStartChampionshipRace({
            round,
            champ: this.champ,
            prepSettings: null
          });
        }
        break;
      case WeekendStage.RESULTS_PENDING:
      case WeekendStage.EVENT_COMPLETED:
        this.showOfficialResults();
        break;
      default:
        this.showEventOverview();
    }
  }

  /** Weekend: Event Overview */
  showEventOverview() {
    const round = ChampionshipManager.getCurrentRound(this.champ);
    ChampionshipViews.renderEventOverview(this.mountEl, this.champ, round, {
      onProceed: () => {
        if (this.champ.rules.practiceEnabled) {
          ChampionshipManager.advanceStage(this.champ, WeekendStage.PRACTICE_PENDING);
          this.showPracticeScreen();
        } else if (this.champ.rules.qualifyingEnabled) {
          ChampionshipManager.advanceStage(this.champ, WeekendStage.QUALIFYING_PENDING);
          this.showQualifyingScreen();
        } else {
          ChampionshipManager.buildAlternativeGrid(this.champ);
          this.showStartingGridScreen();
        }
      },
      onBackToHub: () => this.showHub()
    });
  }

  /** Weekend: Practice */
  showPracticeScreen() {
    const round = ChampionshipManager.getCurrentRound(this.champ);
    ChampionshipViews.renderPractice(this.mountEl, this.champ, round, {
      onCompleteLaps: (laps) => {
        ChampionshipManager.completePractice(this.champ, laps);
        if (this.champ.rules.qualifyingEnabled) {
          this.showQualifyingScreen();
        } else {
          ChampionshipManager.buildAlternativeGrid(this.champ);
          this.showStartingGridScreen();
        }
      },
      onSkip: () => {
        ChampionshipManager.skipPractice(this.champ);
        if (this.champ.rules.qualifyingEnabled) {
          this.showQualifyingScreen();
        } else {
          this.showStartingGridScreen();
        }
      },
      onBackToHub: () => this.showHub()
    });
  }

  /** Weekend: Qualifying Shootout */
  showQualifyingScreen() {
    const round = ChampionshipManager.getCurrentRound(this.champ);
    ChampionshipViews.renderQualifying(this.mountEl, this.champ, round, {
      onRunQuali: () => {
        ChampionshipManager.runQualifying(this.champ);
        this.showQualifyingScreen(); // re-render with timing tower
      },
      onConfirmGrid: () => {
        ChampionshipManager.advanceStage(this.champ, WeekendStage.GRID_CONFIRMATION);
        this.showStartingGridScreen();
      },
      onBackToHub: () => this.showHub()
    });
  }

  /** Weekend: Starting Grid */
  showStartingGridScreen() {
    const round = ChampionshipManager.getCurrentRound(this.champ);
    ChampionshipViews.renderStartingGrid(this.mountEl, this.champ, round, {
      onProceedToRacePrep: () => {
        ChampionshipManager.advanceStage(this.champ, WeekendStage.RACE_READY);
        this.showRacePrepScreen();
      },
      onBackToHub: () => this.showHub()
    });
  }

  /** Weekend: Race Briefing & Tyre Setup */
  showRacePrepScreen() {
    const round = ChampionshipManager.getCurrentRound(this.champ);
    ChampionshipViews.renderRacePrep(this.mountEl, this.champ, round, {
      onEnterRace: (prepSettings) => {
        ChampionshipManager.advanceStage(this.champ, WeekendStage.RACE_IN_PROGRESS);
        this.hideModal();
        this.active = true;

        // Launch the race in the main simulation scene
        this.onStartChampionshipRace({
          round,
          champ: this.champ,
          prepSettings
        });
      },
      onBackToGrid: () => this.showStartingGridScreen()
    });
  }

  // ── In-Race Live HUD & Chequered Flag Finalization ─────────────────────────

  /** Update the compact live championship projection HUD */
  updateInRaceProjection() {
    if (!this.active || !this.champ || !this.hudEl) return;
    const round = ChampionshipManager.getCurrentRound(this.champ);
    if (!round || round.stage !== WeekendStage.RACE_IN_PROGRESS) {
      this.hideLiveHUD();
      return;
    }

    const proj = ChampionshipManager.calculateLiveProjections(this.champ, this.engine.standings);
    if (proj) {
      this.hudEl.style.display = 'block';
      ChampionshipViews.updateLiveOverlay(this.hudEl, proj);
    }
  }

  /** Triggered when the race engine reaches FINISHED state in Championship Mode */
  handleRaceFinished() {
    if (!this.active || !this.champ) return;
    const round = ChampionshipManager.getCurrentRound(this.champ);
    if (!round) return;

    round.stage = WeekendStage.RESULTS_PENDING;
    ChampionshipManager.saveActiveChampionship(this.champ);

    this.showBanner();
  }

  /** Show Official Post-Race Results */
  showOfficialResults() {
    this.hideBanner();
    this.hideLiveHUD();
    this.showModal();

    const round = ChampionshipManager.getCurrentRound(this.champ);
    if (!round) return;

    // Idempotently finalize the race
    const resultsData = ChampionshipManager.finalizeRace(this.champ, this.engine);
    this.lastFinalizedResults = resultsData;

    ChampionshipViews.renderResults(this.mountEl, this.champ, round, resultsData, {
      onContinueToHub: () => {
        const adv = ChampionshipManager.advanceToNextRound(this.champ);
        if (adv.seasonFinished) {
          this.showSeasonFinale();
        } else {
          this.showHub();
        }
      },
      onViewFinale: () => {
        const adv = ChampionshipManager.advanceToNextRound(this.champ);
        this.showSeasonFinale();
      },
      onReturnMain: () => {
        ChampionshipManager.saveActiveChampionship(this.champ);
        this.returnToMainMenu();
      }
    });
  }

  /** Season Finale: World Champions Coronation */
  showSeasonFinale() {
    this.showModal();
    this.hideBanner();
    this.hideLiveHUD();

    ChampionshipViews.renderFinale(this.mountEl, this.champ, {
      onStartNew: () => this.startCreationWizard(),
      onReturnMain: () => this.returnToMainMenu(),
      onViewStandings: () => this.showStandingsModal()
    });
  }

  // ── Modals (Calendar, Standings, History) ──────────────────────────────────

  showStandingsModal() {
    const modalDiv = document.createElement('div');
    document.body.appendChild(modalDiv);
    ChampionshipViews.renderStandingsModal(modalDiv, this.champ, {
      onClose: () => modalDiv.remove()
    });
  }

  showCalendarModal() {
    const modalDiv = document.createElement('div');
    document.body.appendChild(modalDiv);
    ChampionshipViews.renderCalendarModal(modalDiv, this.champ, {
      onClose: () => modalDiv.remove()
    });
  }

  showHistoryModal() {
    const history = ChampionshipManager.getChampionshipHistory();
    const modalDiv = document.createElement('div');
    document.body.appendChild(modalDiv);

    modalDiv.innerHTML = `
      <div class="f1-modal-backdrop">
        <div class="f1-stage-card f1-card-wide">
          <div class="f1-stage-nav">
            <span class="f1-badge-gold">ARCHIVED SEASONS</span>
            <button type="button" class="f1-btn-ghost" id="btnCloseHistory">✕ Close</button>
          </div>
          <div class="f1-stage-header">
            <h1>Championship History</h1>
            <p class="f1-sub">Past completed Formula 1 World Championship seasons.</p>
          </div>
          <div class="f1-calendar-list-scroll">
            ${history.length ? history.map((h, i) => `
              <div class="f1-cal-card completed">
                <div class="f1-cal-round-tag">SEASON ${history.length - i}</div>
                <div class="f1-cal-body">
                  <strong>${h.name}</strong>
                  <span>🏆 Drivers' Champion: <strong>${h.champion?.name} (${h.champion?.team})</strong> &middot; ${h.champion?.points} pts</span>
                  <span>🏁 Constructors' Champion: <strong>${h.constructorChampion?.team}</strong></span>
                  <span>Your Finish: <strong>P${h.playerResult?.position || '-'}</strong> (${h.playerResult?.points || 0} pts)</span>
                </div>
                <span class="status-done">COMPLETED</span>
              </div>
            `).join('') : '<div class="f1-sub" style="padding:20px;text-align:center">No archived championships yet. Complete a season to view records!</div>'}
          </div>
        </div>
      </div>
    `;

    modalDiv.querySelector('#btnCloseHistory')?.addEventListener('click', () => modalDiv.remove());
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  resumeChampionship() {
    this.champ = ChampionshipManager.loadActiveChampionship();
    this.showHub();
  }

  showModal() {
    if (this.mountEl) this.mountEl.style.display = 'block';
    if (this.$) {
      this.$('simulatorView') && (this.$('simulatorView').style.display = 'none');
      this.$('simHeader') && (this.$('simHeader').style.display = 'none');
      this.$('simHeader')?.classList.remove('nav-open');
    }
  }

  hideModal() {
    if (this.mountEl) this.mountEl.style.display = 'none';
  }

  showBanner() {
    if (this.bannerEl) {
      this.bannerEl.style.display = 'flex';
      const btn = this.bannerEl.querySelector('#btnViewOfficialResults');
      if (btn) {
        btn.onclick = () => this.showOfficialResults();
      }
    }
  }

  hideBanner() {
    if (this.bannerEl) this.bannerEl.style.display = 'none';
  }

  hideLiveHUD() {
    if (this.hudEl) this.hudEl.style.display = 'none';
  }
}
