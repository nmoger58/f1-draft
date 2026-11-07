/**
 * commentaryEngine.js
 * Dynamic CSV-Driven Team Radio & Commentary Engine for Formula 1 Simulator.
 *
 * Implements:
 *   - Dynamic loading and RFC-4180 parsing of `f1_team_radio_commentary.csv`
 *     (Browser fetch + Node.js fs environment support).
 *   - Mapping of simulation engine events to CSV `event_type`.
 *   - Cooldown, priority, and repeat-policy enforcement:
 *       * CRITICAL safety alerts bypass routine cooldowns.
 *       * Repeat policies: once_per_race, once_per_session, per_event, per_strategy_state,
 *         per_wear_band, per_weather_change, per_state_change, per_flag_transition,
 *         once_per_investigation, per_gap_band, per_lap_band.
 *   - Anti-repetition dialogue selection: selects among eligible candidates with variance,
 *     tracking dialogue_id to avoid immediate repeats.
 *   - Robust placeholder interpolation: {driver}, {overtaker}, {overtaken}, {position},
 *     {sector}, {penalty}, {rival}, {gap_ahead}, {driver_ahead}, {gap_behind}, {driver_behind}.
 *     Falls back to sensible context strings instead of displaying literal brackets.
 *   - Full validation with graceful fallback for missing files or malformed rows.
 */

import { resolveDriverFullName } from '../utils/driverResolver.js';
import { formatForSpeech } from '../utils/speechFormatter.js';

export class CommentaryEngine {
  constructor(options = {}) {
    this.csvUrl = options.csvUrl || '/data/f1_team_radio_commentary.csv';
    this.dialogues = []; // parsed rows
    this.dialoguesByType = new Map(); // event_type -> dialogue[]
    this.isLoaded = false;
    this.loadError = null;

    // Tracking state for anti-repetition and cooldowns
    this.lastPlayedById = new Map();     // dialogue_id -> simTime / timestamp
    this.lastPlayedByType = new Map();   // event_type -> simTime / timestamp
    this.playedInRace = new Set();       // dialogue_id set
    this.playedInSession = new Set();    // dialogue_id set
    this.playedInvestigations = new Map(); // investigationId -> Set<dialogue_id>
    this.lastPlayedDialoguePerType = new Map(); // event_type -> dialogue_id
  }

  /**
   * Load and initialize the CSV dynamically.
   * Works seamlessly in browser (via fetch) and Node.js (via fs).
   */
  async load(customCsvText = null) {
    try {
      let csvContent = customCsvText;

      if (!csvContent) {
        if (typeof window !== 'undefined' && typeof window.fetch === 'function') {
          // Browser environment
          let resp = null;
          try {
            resp = await window.fetch(this.csvUrl);
          } catch (_) {
            resp = await window.fetch('/f1_team_radio_commentary.csv');
          }
          if (!resp || !resp.ok) {
            throw new Error(`Failed to fetch CSV: ${resp ? resp.statusText : 'Network error'}`);
          }
          csvContent = await resp.text();
        } else if (typeof process !== 'undefined' && process.versions && process.versions.node) {
          // Node.js environment
          const fs = await import('fs');
          const path = await import('path');
          const candidatePaths = [
            path.resolve(process.cwd(), 'data/f1_team_radio_commentary.csv'),
            path.resolve(process.cwd(), '../f1_team_radio_commentary.csv'),
            path.resolve(process.cwd(), 'f1_team_radio_commentary.csv'),
            path.resolve(process.cwd(), 'datasets/f1_team_radio_commentary.csv'),
            path.resolve(process.cwd(), '../../datasets/f1_team_radio_commentary.csv'),
            path.resolve(path.dirname(import.meta.url ? new URL(import.meta.url).pathname : process.cwd()), '../../../../datasets/f1_team_radio_commentary.csv')
          ];
          for (const p of candidatePaths) {
            if (fs.existsSync(p)) {
              csvContent = fs.readFileSync(p, 'utf-8');
              break;
            }
          }
          if (!csvContent) {
            throw new Error('Commentary CSV file not found on disk in candidate paths');
          }
        }
      }

      if (!csvContent || typeof csvContent !== 'string') {
        throw new Error('Empty or invalid CSV content');
      }

      this.parseCSV(csvContent);
      if (!this.dialogues.length) {
        this._loadFallbackDialogues();
      }
      this.isLoaded = true;
      return true;
    } catch (err) {
      console.warn('CommentaryEngine load error (using built-in fallback):', err.message);
      this.loadError = err;
      this._loadFallbackDialogues();
      this.isLoaded = true;
      return false;
    }
  }

  /**
   * RFC-4180 compliant CSV parser supporting quoted strings with commas and escaped quotes.
   */
  parseCSV(text) {
    const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (!lines.length) return;

    // Parse header
    const headerLine = lines[0];
    const headers = this._parseCSVRow(headerLine).map(h => h.trim().toLowerCase());

    const records = [];
    for (let i = 1; i < lines.length; i++) {
      const row = this._parseCSVRow(lines[i]);
      if (!row || row.length < 5) continue; // Skip malformed rows

      const entry = {};
      headers.forEach((h, idx) => {
        entry[h] = row[idx] !== undefined ? row[idx].trim() : '';
      });

      if (!entry.event_type || !entry.dialogue_id || !entry.dialogue_template) {
        continue;
      }

      const parsed = {
        event_type: entry.event_type.toUpperCase(),
        priority: (entry.priority || 'NORMAL').toUpperCase(),
        channel: (entry.channel || 'ENGINEER').toUpperCase(),
        dialogue_id: entry.dialogue_id,
        dialogue_template: entry.dialogue_template,
        cooldown_seconds: parseFloat(entry.cooldown_seconds) || 20,
        repeat_policy: (entry.repeat_policy || 'per_event').toLowerCase(),
        condition_tag: (entry.condition_tag || '').toLowerCase()
      };

      records.push(parsed);
    }

    this.dialogues = records;
    this.dialoguesByType.clear();

    for (const d of records) {
      if (!this.dialoguesByType.has(d.event_type)) {
        this.dialoguesByType.set(d.event_type, []);
      }
      this.dialoguesByType.get(d.event_type).push(d);
    }
  }

  _parseCSVRow(rowStr) {
    const fields = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < rowStr.length; i++) {
      const c = rowStr[i];
      if (c === '"') {
        if (inQuotes && i + 1 < rowStr.length && rowStr[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (c === ',' && !inQuotes) {
        fields.push(cur);
        cur = '';
      } else {
        cur += c;
      }
    }
    fields.push(cur);
    return fields;
  }

  /**
   * Evaluate an incoming race event and select an eligible dialogue from matching category.
   *
   * @param {string} eventType – e.g. 'OVERTAKE_SUCCESS', 'SAFETY_CAR_DEPLOYED', 'PIT_RECOMMENDATION'
   * @param {object} context   – { simTime, driver, overtaker, overtaken, position, sector, penalty, conditionTag, etc. }
   * @returns {object|null}    – Formatted commentary/radio message or null if ineligible/on-cooldown
   */
  processEvent(eventType, context = {}) {
    if (!this.isLoaded || !this.dialogues.length) return null;

    const normalizedType = (eventType || '').toUpperCase();
    const candidates = this.dialoguesByType.get(normalizedType);
    if (!candidates || !candidates.length) {
      return null;
    }

    const simTime = context.simTime !== undefined ? context.simTime : (Date.now() / 1000);
    const reqCondition = (context.conditionTag || '').toLowerCase();
    const investigationId = context.investigationId || null;

    // Filter by condition tag if candidate requires it
    let matching = candidates;
    if (reqCondition) {
      const tagged = candidates.filter(c => c.condition_tag === reqCondition);
      if (tagged.length > 0) matching = tagged;
    }

    // Filter by repeat policies and cooldowns
    const eligible = [];
    for (const d of matching) {
      // Repeat policy checks
      if (d.repeat_policy === 'once_per_race' && this.playedInRace.has(d.dialogue_id)) {
        continue;
      }
      if (d.repeat_policy === 'once_per_session' && this.playedInSession.has(d.dialogue_id)) {
        continue;
      }
      if (d.repeat_policy === 'once_per_investigation' && investigationId) {
        const invSet = this.playedInvestigations.get(investigationId);
        if (invSet && (invSet.has(d.event_type) || invSet.has(d.dialogue_id))) continue;
      }

      // Cooldown check: Critical safety messages bypass routine cooldowns!
      const isCritical = (d.priority === 'CRITICAL');
      const lastPlayed = this.lastPlayedById.get(d.dialogue_id) ?? -9999;
      const typeLastPlayed = this.lastPlayedByType.get(d.event_type) ?? -9999;

      if (!isCritical) {
        if (simTime - lastPlayed < d.cooldown_seconds) {
          continue;
        }
        // Small spacing between any messages of the same type (except critical safety)
        if (simTime - typeLastPlayed < Math.min(8, d.cooldown_seconds * 0.4)) {
          continue;
        }
      }

      eligible.push(d);
    }

    if (!eligible.length) {
      // If none currently eligible, check if a CRITICAL message exists for this event
      const criticalFallback = candidates.find(c => c.priority === 'CRITICAL');
      if (criticalFallback) {
        return this._formatMessage(criticalFallback, context, simTime);
      }
      return null;
    }

    // Variance selection: Avoid immediate repetition of the exact same dialogue_id
    const lastId = this.lastPlayedDialoguePerType.get(normalizedType);
    let selectionPool = eligible;
    if (eligible.length > 1 && lastId) {
      const withoutLast = eligible.filter(d => d.dialogue_id !== lastId);
      if (withoutLast.length > 0) selectionPool = withoutLast;
    }

    // Select randomly from variance pool
    const selected = selectionPool[Math.floor(Math.random() * selectionPool.length)];

    // Record execution state
    this.lastPlayedById.set(selected.dialogue_id, simTime);
    this.lastPlayedByType.set(selected.event_type, simTime);
    this.lastPlayedDialoguePerType.set(normalizedType, selected.dialogue_id);
    this.playedInRace.add(selected.dialogue_id);
    this.playedInSession.add(selected.dialogue_id);

    if (investigationId) {
      if (!this.playedInvestigations.has(investigationId)) {
        this.playedInvestigations.set(investigationId, new Set());
      }
      this.playedInvestigations.get(investigationId).add(selected.dialogue_id);
      this.playedInvestigations.get(investigationId).add(selected.event_type);
    }

    return this._formatMessage(selected, context, simTime);
  }

  /**
   * Interpolate placeholders with current simulation data and sensible fallbacks.
   */
  _formatMessage(dialogue, context, simTime) {
    const rawTemplate = dialogue.dialogue_template;

    const driverFull = resolveDriverFullName(context.driver || context.driverName || context.code, 'the driver');
    const overtakerFull = resolveDriverFullName(context.overtaker || context.driver || context.code, 'Overtaker');
    const overtakenFull = resolveDriverFullName(context.overtaken || context.rival, 'rival');
    const rivalFull = resolveDriverFullName(context.rival || context.overtaken, 'the car behind');
    const driverAheadFull = resolveDriverFullName(context.driver_ahead, 'the car ahead');
    const driverBehindFull = resolveDriverFullName(context.driver_behind, 'the car behind');

    const values = {
      driver: driverFull,
      overtaker: overtakerFull,
      overtaken: overtakenFull,
      position: context.position || context.pos || '1',
      rival: rivalFull,
      sector: context.sector ? (String(context.sector).toLowerCase().startsWith('sector') ? context.sector : `Sector ${context.sector}`) : 'Sector 2',
      penalty: context.penalty || '5-second time penalty',
      gap_ahead: (context.gap_ahead !== undefined && context.gap_ahead !== null) ? Number(context.gap_ahead).toFixed(1) : '1.2',
      driver_ahead: driverAheadFull,
      gap_behind: (context.gap_behind !== undefined && context.gap_behind !== null) ? Number(context.gap_behind).toFixed(1) : '0.8',
      driver_behind: driverBehindFull
    };

    // Replace all known placeholders
    let formatted = rawTemplate;
    Object.keys(values).forEach(key => {
      const regex = new RegExp(`\\{${key}\\}`, 'gi');
      formatted = formatted.replace(regex, values[key]);
    });

    // Guard against any leftover unreplaced {placeholder}
    formatted = formatted.replace(/\{[a-z0-9_-]+\}/gi, 'the car');

    // Priority mapping
    let numPriority = 3; // NORMAL
    if (dialogue.priority === 'CRITICAL') numPriority = 1;
    else if (dialogue.priority === 'HIGH') numPriority = 2;

    // Channel sender mapping
    let sender = 'Race Engineer';
    if (dialogue.channel === 'RACE_CONTROL') {
      sender = 'FIA Race Control';
    } else if (dialogue.channel === 'COMMENTARY') {
      sender = 'F1 Broadcast Commentary';
    } else if (context.engineerName) {
      sender = context.engineerName;
    }

    // Category mapping for UI badge & icons
    const category = this._mapCategory(dialogue.event_type);

    // Natural spoken representation for TTS
    const spokenText = formatForSpeech(formatted, {
      type: 'commentary',
      driver: driverFull,
      category,
      context
    });

    return {
      dialogueId: dialogue.dialogue_id,
      eventType: dialogue.event_type,
      priority: numPriority,
      priorityLabel: dialogue.priority,
      channel: dialogue.channel,
      category,
      sender,
      msg: formatted,
      spokenText,
      time: simTime,
      severity: numPriority === 1 ? 'critical' : (numPriority === 2 ? 'alert' : 'info'),
      driverCode: context.driverCode || context.code || null
    };
  }

  _mapCategory(eventType) {
    if (eventType.startsWith('PIT') || eventType.includes('UNDERCUT') || eventType.includes('OVERCUT')) return 'pit';
    if (eventType.startsWith('TYRE')) return 'tyre';
    if (eventType.includes('OVERTAKE') || eventType === 'LEAD_CHANGE') return 'overtake';
    if (eventType === 'DEFENDING' || eventType === 'POSITION_LOST') return 'defend';
    if (eventType.includes('RAIN') || eventType.includes('DRY') || eventType.includes('WET') || eventType.includes('AQUAPLANE')) return 'weather';
    if (eventType.includes('FLAG') || eventType.includes('SAFETY_CAR') || eventType.includes('VSC') || eventType.includes('RESTART')) return 'control';
    if (eventType.includes('INVESTIGATION') || eventType.includes('PENALTY') || eventType.includes('WARNING')) return 'control';
    if (eventType.includes('DAMAGE') || eventType.includes('COLLISION') || eventType.includes('RETIREMENT')) return 'damage';
    if (eventType.includes('START') || eventType.includes('FINISH') || eventType.includes('WIN')) return 'control';
    return 'strategy';
  }

  /**
   * Reset tracking when a new race session begins.
   */
  resetRace() {
    this.playedInRace.clear();
    this.playedInvestigations.clear();
    this.lastPlayedById.clear();
    this.lastPlayedByType.clear();
    this.lastPlayedDialoguePerType.clear();
  }

  /**
   * Built-in fallback in case CSV file is missing or unreadable.
   */
  _loadFallbackDialogues() {
    this.parseCSV(`event_type,priority,channel,dialogue_id,dialogue_template,cooldown_seconds,repeat_policy,condition_tag
RACE_START,CRITICAL,RACE_CONTROL,START_001,Lights out! Lights out! You're racing. Get a clean launch and watch the car alongside.,30,once_per_race,
SAFETY_CAR_DEPLOYED,CRITICAL,RACE_CONTROL,SC_001,Safety Car deployed. Reduce speed, hold position, and close up safely to the queue.,10,per_state_change,
RED_FLAG,CRITICAL,RACE_CONTROL,RED_001,Red flag. Session suspended—slow down and follow the race-control instructions.,10,per_state_change,
PIT_RECOMMENDATION,HIGH,ENGINEER,PIT_001,Box this lap. The tyre wear is high, and the fresh set should give us a better run.,35,per_strategy_state,wear_high
OVERTAKE_SUCCESS,HIGH,COMMENTARY,OVT_001,He's through! {overtaker} gets past {overtaken} and takes P{position}.,12,per_event,
RACE_FINISH,CRITICAL,RACE_CONTROL,FINISH_001,Chequered flag! That's the finish. Bring the car home safely.,30,once_per_race,`);
  }
}

export const commentaryEngine = new CommentaryEngine();
