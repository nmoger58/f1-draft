/**
 * quickRaceWizard.js
 * Quick Race Configuration Wizard Module for F1 Apex Racing Simulator.
 * Provides entry points for Multi-step Wizard and Circuit Selection integration.
 */

export { QuickRaceViews } from './quickRaceViews.js';
export {
  renderCircuitSelection,
  renderSelectedCircuitInfo,
  bindCircuitSelectionEvents,
  getTrackSvgPath,
  CIRCUITS,
  RAW_WAYPOINTS,
  getCircuit
} from './circuitSelect.js';
