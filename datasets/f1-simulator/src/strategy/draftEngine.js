/**
 * draftEngine.js
 * Authoritative Draft State & Selection Engine.
 *
 * Implements a draft-style selection system for Drivers, Team Principals/Managers,
 * and Constructor Cars for both Quick Race and Championship Mode.
 *
 * Features:
 *   - 5-card draft sets with deterministic pagination / shuffle
 *   - Stable entity IDs (driverCode, managerId, carId)
 *   - Authoritative state persistence across sessions and race restarts
 *   - Full synergy summary computation
 *   - Grid deduplication (never duplicates player driver on the AI grid)
 */

import { DRIVERS, getDriver } from '../data/driverData.js';
import { MANAGERS, getManager } from '../data/managerData.js';
import { CARS, getCar } from '../data/carData.js';
import { enrichDriverWithML, enrichCarWithML, enrichManagerWithML } from '../data/mlIntelligence.js';

export const DRAFT_STAGES = {
  DRIVER: 'driver',
  MANAGER: 'manager',
  CAR: 'car',
  SUMMARY: 'summary',
  COMPLETED: 'completed'
};

const STORAGE_KEY = 'f1_draft_selection';

export class DraftEngine {
  constructor(options = {}) {
    this.mode = options.mode || 'quick'; // 'quick' | 'championship' | 'historic'
    this.stage = DRAFT_STAGES.DRIVER;
    this.circuitId = options.circuitId || 'silverstone';

    // Pools — enriched with 7-algorithm ML intelligence, sample size confidence, and technical strengths
    const rawDrivers  = options.driverPool  ? [...options.driverPool]  : [...DRIVERS];
    const rawManagers = options.managerPool ? [...options.managerPool] : [...MANAGERS];
    const rawCars     = options.carPool     ? [...options.carPool]     : [...CARS];

    this.driverPool  = rawDrivers.map(d => enrichDriverWithML(d, this.circuitId));
    this.managerPool = rawManagers.map(m => enrichManagerWithML(m));
    this.carPool     = rawCars.map(c => enrichCarWithML(c));

    // Pagination / Rotation offsets
    this.offsets = {
      driver: 0,
      manager: 0,
      car: 0
    };

    // Authoritative selections
    this.selectedDriverId = options.initialDriverId || null;
    this.selectedManagerId = options.initialManagerId || null;
    this.selectedCarId = options.initialCarId || null;

    // Optional circuit context
    this.circuitId = options.circuitId || 'silverstone';

    if (options.autoRestore !== false) {
      this.restore();
    }
  }

  /**
   * Return up to 5 items for the specified category.
   * If a selection is currently made in this category and not in the active window,
   * it is pinned to index 0 so the user never loses sight of their current pick.
   *
   * @param {'driver'|'manager'|'car'} category
   * @returns {Array<object>}
   */
  getDraftSet(category) {
    const pool = this._getPool(category);
    if (!pool || pool.length === 0) return [];

    const pageSize = Math.min(5, pool.length);
    const offset = (this.offsets[category] || 0) % pool.length;

    // Circular slice of pageSize elements
    const set = [];
    for (let i = 0; i < pageSize; i++) {
      const idx = (offset + i) % pool.length;
      set.push(pool[idx]);
    }

    // Check if current selected item is in this set
    const currentId = this.getSelectedId(category);
    if (currentId) {
      const inSet = set.some(item => this._getEntityId(category, item) === currentId);
      if (!inSet) {
        const selectedItem = pool.find(item => this._getEntityId(category, item) === currentId);
        if (selectedItem) {
          // Replace the last item with the selected item so it remains visible
          set[set.length - 1] = selectedItem;
        }
      }
    }

    return set;
  }

  /**
   * Advance to the next 5-card set for a category (Shuffle / Next Set action).
   *
   * @param {'driver'|'manager'|'car'} category
   * @returns {Array<object>} the newly active draft set
   */
  shuffleNextSet(category) {
    const pool = this._getPool(category);
    if (!pool || pool.length <= 5) return this.getDraftSet(category);

    this.offsets[category] = (this.offsets[category] + 5) % pool.length;
    return this.getDraftSet(category);
  }

  /**
   * Select an entity in a category by ID.
   *
   * @param {'driver'|'manager'|'car'} category
   * @param {string} id
   * @returns {boolean} true if selection is valid
   */
  selectEntity(category, id) {
    const pool = this._getPool(category);
    const found = pool.some(item => this._getEntityId(category, item) === id);
    if (!found) return false;

    if (category === 'driver') this.selectedDriverId = id;
    else if (category === 'manager') this.selectedManagerId = id;
    else if (category === 'car') this.selectedCarId = id;

    this.persist();
    return true;
  }

  /**
   * Get selected ID for category.
   */
  getSelectedId(category) {
    if (category === 'driver') return this.selectedDriverId;
    if (category === 'manager') return this.selectedManagerId;
    if (category === 'car') return this.selectedCarId;
    return null;
  }

  /**
   * Get full selected entity object.
   */
  getSelectedEntity(category) {
    const id = this.getSelectedId(category);
    if (!id) return null;
    // Check custom pool first (historical season drafts override static data)
    if (category === 'driver') return this.driverPool.find(d => d.code === id) || getDriver(id) || null;
    if (category === 'manager') return this.managerPool.find(m => m.id === id) || getManager(id) || null;
    if (category === 'car') return this.carPool.find(c => c.id === id) || getCar(id) || null;
    return null;
  }

  /**
   * Check if a specific stage has a valid selection.
   */
  isStageReady(stage = this.stage) {
    if (stage === DRAFT_STAGES.DRIVER) return !!this.selectedDriverId;
    if (stage === DRAFT_STAGES.MANAGER) return !!this.selectedManagerId;
    if (stage === DRAFT_STAGES.CAR) return !!this.selectedCarId;
    if (stage === DRAFT_STAGES.SUMMARY) {
      return !!(this.selectedDriverId && this.selectedManagerId && this.selectedCarId);
    }
    return true;
  }

  /**
   * Advance to the next stage in the draft wizard.
   */
  nextStage() {
    if (!this.isStageReady(this.stage)) return false;

    if (this.stage === DRAFT_STAGES.DRIVER) {
      this.stage = DRAFT_STAGES.MANAGER;
    } else if (this.stage === DRAFT_STAGES.MANAGER) {
      this.stage = DRAFT_STAGES.CAR;
    } else if (this.stage === DRAFT_STAGES.CAR) {
      this.stage = DRAFT_STAGES.SUMMARY;
    } else if (this.stage === DRAFT_STAGES.SUMMARY) {
      this.stage = DRAFT_STAGES.COMPLETED;
    }
    return true;
  }

  /**
   * Step backward to allow editing earlier picks.
   */
  prevStage() {
    if (this.stage === DRAFT_STAGES.SUMMARY) {
      this.stage = DRAFT_STAGES.CAR;
    } else if (this.stage === DRAFT_STAGES.CAR) {
      this.stage = DRAFT_STAGES.MANAGER;
    } else if (this.stage === DRAFT_STAGES.MANAGER) {
      this.stage = DRAFT_STAGES.DRIVER;
    }
    return this.stage;
  }

  setStage(stage) {
    this.stage = stage;
  }

  /**
   * Return comprehensive draft configuration summary.
   */
  getSummary() {
    const driver = this.getSelectedEntity('driver');
    const manager = this.getSelectedEntity('manager');
    const car = this.getSelectedEntity('car');

    const drvRating = driver?.overallRating || driver?.blendedRating || 82;
    const carRating = car?.carRating || 82;
    const mgrRating = manager?.rating || 90;
    const teamOvr = Math.round((drvRating + carRating + mgrRating) / 3);

    return {
      mode: this.mode,
      circuitId: this.circuitId,
      driver,
      manager,
      car,
      teamOvr,
      confidencePct: driver?.confidencePct || 85,
      carStrengths: car?.strengths || 'Balanced Aerodynamic Platform',
      isComplete: !!(driver && manager && car),
      modifiers: {
        maxSpeedBonus: car?.modifiers?.maxSpeedBonus ?? 0,
        accelMult: car?.modifiers?.accelMult ?? 1.0,
        downforceMult: car?.modifiers?.downforceMult ?? 1.0,
        dragMult: car?.modifiers?.dragMult ?? 1.0,
        tyreDegMult: (car?.modifiers?.tyreWearMult ?? 1.0) * (manager?.modifiers?.tyreDegMult ?? 1.0),
        pitLossDelta: manager?.modifiers?.pitLossDelta ?? 0,
        strategyBonus: manager?.modifiers?.strategyBonus ?? 0,
        launchAssistMs: manager?.modifiers?.launchAssistMs ?? 0
      }
    };
  }

  /**
   * Build a balanced, deduplicated starting grid for the race engine.
   * Guarantees that the drafted player driver is never duplicated as an AI car.
   *
   * @param {number} gridSize - total desired cars (e.g. 6, 10, 20)
   * @returns {Array<object>} driver list with player at index 0
   */
  buildRaceGrid(gridSize = 6) {
    const playerDriver = this.getSelectedEntity('driver');
    if (!playerDriver) {
      // Fallback only if no driver selected yet
      return DRIVERS.slice(0, Math.min(gridSize, DRIVERS.length));
    }

    // Filter out player driver from AI pool to eliminate duplication
    const aiCandidates = DRIVERS.filter(d => d.code !== playerDriver.code);
    const neededAI = Math.max(0, gridSize - 1);
    const aiGrid = aiCandidates.slice(0, neededAI);

    // Player occupies slot 0
    return [playerDriver, ...aiGrid];
  }

  /**
   * Persist current choices to localStorage.
   */
  persist() {
    try {
      if (typeof localStorage === 'undefined') return;
      const data = {
        selectedDriverId: this.selectedDriverId,
        selectedManagerId: this.selectedManagerId,
        selectedCarId: this.selectedCarId,
        mode: this.mode,
        circuitId: this.circuitId
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (_) {
      // Local storage unavailable or quota exceeded
    }
  }

  /**
   * Restore previous choices from localStorage without forcing Norris.
   */
  restore() {
    try {
      if (typeof localStorage === 'undefined') return false;
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);

      if (data.selectedDriverId && this.driverPool.some(d => d.code === data.selectedDriverId)) {
        this.selectedDriverId = data.selectedDriverId;
      }
      if (data.selectedManagerId && this.managerPool.some(m => m.id === data.selectedManagerId)) {
        this.selectedManagerId = data.selectedManagerId;
      }
      if (data.selectedCarId && this.carPool.some(c => c.id === data.selectedCarId)) {
        this.selectedCarId = data.selectedCarId;
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * Reset all draft selections.
   */
  reset() {
    this.selectedDriverId = null;
    this.selectedManagerId = null;
    this.selectedCarId = null;
    this.stage = DRAFT_STAGES.DRIVER;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch (_) {}
  }

  _getPool(category) {
    if (category === 'driver') return this.driverPool;
    if (category === 'manager') return this.managerPool;
    if (category === 'car') return this.carPool;
    return [];
  }

  _getEntityId(category, item) {
    if (!item) return null;
    if (category === 'driver') return item.code;
    return item.id;
  }
}

// Global shared singleton instance for Quick Race & cross-component communication
let _sharedDraftInstance = null;

export function getSharedDraftEngine(options = {}) {
  if (!_sharedDraftInstance) {
    _sharedDraftInstance = new DraftEngine(options);
  }
  return _sharedDraftInstance;
}
