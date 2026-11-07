/**
 * commentaryToastOverlay.js
 * Compact Race Commentary Toast Overlay on the Race Track.
 *
 * Renders concise, high-impact motorsport broadcast toast notifications
 * directly inside the top-left corner of the track diagram container.
 *
 * Core Features:
 *  - Maximum 4 visible notifications simultaneously, stacked newest-at-top.
 *  - Configurable auto-dismissal durations based on event type.
 *  - Strict Priority Eviction: Critical safety & race-state events (P1)
 *    are NEVER dropped or evicted by routine overtakes (P3).
 *  - Event deduplication and flag state transition suppression.
 *  - Non-intrusive layout (pointer-events: none on container, auto on toasts).
 *  - Supports manual dismissal and enable/disable toggle.
 */

export const ToastDurations = {
  overtake:    4000, // 4s
  lead_change: 5000, // 5s
  start:       5000, // 5s
  yellow_flag: 5000, // 5s
  red_flag:    7000, // 7s
  safety_car:  6000, // 6s
  vsc:         6000, // 6s
  finish:      7000, // 7s
  incident:    6000, // 6s
  penalty:     5000, // 5s
  pit:         4000, // 4s
  default:     4000, // 4s
};

/**
 * Priority Hierarchy:
 * Lower numerical value = strictly higher priority / more critical.
 *   Priority 1: Critical safety / race state (Red flag, SC, VSC, finish, incident)
 *   Priority 2: Significant race events (Race start, Lead changes, Penalties, Pit stops)
 *   Priority 3: Routine broadcast events (Overtakes, Fastest lap, Info)
 */
export const ToastPriorities = {
  red_flag:    1,
  safety_car:  1,
  vsc:         1,
  finish:      1,
  incident:    1,
  retirement:  1,

  start:       2,
  lead_change: 2,
  penalty:     2,
  pit:         2,

  overtake:    3,
  green_flag:  2,
  fastest_lap: 3,
  info:        3,
  default:     3,
};

export const ToastAccents = {
  green_flag:  'green',
  start:       'green',
  yellow_flag: 'yellow',
  safety_car:  'amber',
  vsc:         'amber',
  red_flag:    'red',
  incident:    'red',
  penalty:     'red',
  lead_change: 'gold',
  finish:      'gold',
  overtake:    'blue',
  pit:         'magenta',
  default:     'blue',
};

export const ToastIcons = {
  start:       '🚦',
  green_flag:  '🟢',
  yellow_flag: '⚠️',
  safety_car:  '🚗',
  vsc:         '🟡',
  red_flag:    '🚩',
  incident:    '💥',
  penalty:     '⚖️',
  lead_change: '⚡',
  finish:      '🏁',
  overtake:    '🏎️',
  pit:         '🔧',
  default:     '📻',
};

export class CommentaryToastManager {
  /**
   * @param {HTMLElement|null} containerEl - DOM container element (inside .mapwrap)
   * @param {object} options
   */
  constructor(containerEl = null, options = {}) {
    this.container = containerEl;
    this.maxVisible = options.maxVisible ?? 4;
    this.mobileMaxVisible = options.mobileMaxVisible ?? 2;
    this.mobileExpanded = false;
    this.expandBtn = null;
    this.enabled = options.enabled ?? true;
    this.debounceWindowMs = options.debounceWindowMs ?? 3000;

    /** @type {Array<{ id: string, key: string, category: string, priority: number, headline: string, detail: string, accent: string, icon: string, createdAt: number, timerId: any, element: HTMLElement|null }>} */
    this.toasts = [];

    // Track recently displayed keys for deduplication
    this.recentKeys = new Map();

    // Last seen flag to suppress flag spam
    this.lastFlag = null;
    this._seq = 0;
  }

  /**
   * Set container element (e.g. after DOM reload)
   */
  setContainer(containerEl) {
    this.container = containerEl;
    this._syncDom();
  }

  /**
   * Enable or disable toast notifications.
   * Disabling clears currently visible toasts.
   * @param {boolean} enabled
   */
  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) {
      this.clear();
    }
  }

  /**
   * Toggle enabled status
   */
  toggleEnabled() {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  isEnabled() {
    return this.enabled;
  }

  /**
   * Returns a copy of the currently visible toasts.
   */
  getVisibleToasts() {
    return this.toasts.map(t => ({
      id: t.id,
      category: t.category,
      priority: t.priority,
      headline: t.headline,
      detail: t.detail,
      accent: t.accent,
      icon: t.icon,
      createdAt: t.createdAt,
    }));
  }

  /**
   * Returns list of toasts visible on small mobile screens.
   * On mobile in collapsed mode, at most mobileMaxVisible (2) toasts are displayed,
   * with Critical (Priority 1) events strictly preserved over newer routine events.
   */
  getMobileVisibleToasts() {
    if (this.toasts.length <= this.mobileMaxVisible || this.mobileExpanded) {
      return this.getVisibleToasts();
    }
    const visibleIds = new Set();
    // 1. Critical safety & state events (P1) must always remain visible
    for (const t of this.toasts) {
      if (t.priority === 1 && visibleIds.size < this.mobileMaxVisible) {
        visibleIds.add(t.id);
      }
    }
    // 2. Fill remaining slots with newest notifications (front of array)
    for (const t of this.toasts) {
      if (visibleIds.size >= this.mobileMaxVisible) break;
      visibleIds.add(t.id);
    }
    return this.toasts
      .filter(t => visibleIds.has(t.id))
      .map(t => ({
        id: t.id,
        category: t.category,
        priority: t.priority,
        headline: t.headline,
        detail: t.detail,
        accent: t.accent,
        icon: t.icon,
        createdAt: t.createdAt,
      }));
  }

  /**
   * Toggle expansion of mobile toast stack.
   */
  toggleMobileExpansion() {
    this.mobileExpanded = !this.mobileExpanded;
    this._updateMobileVisibility();
    return this.mobileExpanded;
  }

  isMobileExpanded() {
    return this.mobileExpanded;
  }

  setMobileExpanded(expanded) {
    this.mobileExpanded = Boolean(expanded);
    this._updateMobileVisibility();
  }

  /**
   * Clear all active toasts immediately.
   */
  clear() {
    for (const t of this.toasts) {
      if (t.timerId) clearTimeout(t.timerId);
      if (t.element && t.element.parentNode) {
        t.element.parentNode.removeChild(t.element);
      }
    }
    this.toasts = [];
    this.recentKeys.clear();
    this.lastFlag = null;
    this._seq = 0;
    this.mobileExpanded = false;
    if (this.expandBtn) {
      this.expandBtn.style.display = 'none';
      if (this.expandBtn.parentNode) {
        this.expandBtn.parentNode.removeChild(this.expandBtn);
      }
      this.expandBtn = null;
    }
    if (this.container) {
      this.container.innerHTML = '';
    }
  }

  /**
   * Ingest array of engine / simulation events.
   * @param {Array<object>} events
   */
  processEvents(events) {
    if (!Array.isArray(events) || !events.length || !this.enabled) return;

    for (const ev of events) {
      const normalized = this._normalizeEvent(ev);
      if (normalized) {
        this.pushToast(normalized);
      }
    }
  }

  /**
   * Push a single toast notification.
   * Applies deduplication, priority check, and capacity eviction.
   * @param {object} item - { category, headline, detail, priority, accent, icon, key, duration }
   * @returns {boolean} Whether toast was displayed
   */
  pushToast(item) {
    if (!this.enabled || !item || !item.headline) return false;

    const now = Date.now();
    const category = item.category || 'default';
    const priority = item.priority ?? (ToastPriorities[category] || 3);
    const duration = item.duration || ToastDurations[category] || ToastDurations.default;
    const accent   = item.accent || ToastAccents[category] || ToastAccents.default;
    const icon     = item.icon || ToastIcons[category] || ToastIcons.default;
    const headline = String(item.headline).trim();
    const detail   = item.detail ? String(item.detail).trim() : '';

    // Deduplication check
    const dedupKey = item.key || `${category}_${headline}_${detail}`;
    if (this.recentKeys.has(dedupKey)) {
      const lastTime = this.recentKeys.get(dedupKey);
      if (now - lastTime < this.debounceWindowMs) {
        return false; // Suppress duplicate
      }
    }
    this.recentKeys.set(dedupKey, now);

    // Prune stale debounce keys (older than 2x debounce window)
    for (const [k, time] of this.recentKeys.entries()) {
      if (now - time > this.debounceWindowMs * 2) {
        this.recentKeys.delete(k);
      }
    }

    // Capacity & Priority Eviction:
    // If at maxVisible capacity:
    //  - If incoming is lower priority (higher number) than all visible: reject or drop.
    //  - Otherwise evict lowest priority oldest item.
    if (this.toasts.length >= this.maxVisible) {
      const evicted = this._evictForIncoming(priority);
      if (!evicted) {
        // Queue is completely saturated with higher-priority items; drop incoming
        return false;
      }
    }

    const toastId = 'ct_' + now + '_' + Math.random().toString(36).substr(2, 6);
    const toastObj = {
      id: toastId,
      seq: ++this._seq,
      key: dedupKey,
      category,
      priority,
      headline,
      detail,
      accent,
      icon,
      createdAt: now,
      timerId: null,
      element: null,
    };

    // Auto-dismissal timer
    toastObj.timerId = setTimeout(() => {
      this._dismissToast(toastId);
    }, duration);

    // Newest at top: unshift to front of array
    this.toasts.unshift(toastObj);

    // Render into DOM
    this._renderToastElement(toastObj);
    this._updateMobileVisibility();

    return true;
  }

  /**
   * Determine and perform eviction when capacity is reached.
   * Priority rule: Critical events (lower priority number) must NEVER be evicted by
   * routine events (higher priority number).
   * @param {number} incomingPriority
   * @returns {boolean} True if space was made, False if incoming should be dropped
   * @private
   */
  _evictForIncoming(incomingPriority) {
    if (this.toasts.length < this.maxVisible) return true;

    // Find the toast with the highest numerical priority value (lowest importance)
    let maxPriorityVal = -1;
    for (const t of this.toasts) {
      if (t.priority > maxPriorityVal) {
        maxPriorityVal = t.priority;
      }
    }

    // If incoming priority is strictly worse than all current toasts, cannot evict
    if (incomingPriority > maxPriorityVal) {
      return false;
    }

    // Among those with the lowest importance (maxPriorityVal), find the oldest (added earliest)
    let targetIdx = -1;
    let oldestSeq = Infinity;
    for (let i = 0; i < this.toasts.length; i++) {
      const t = this.toasts[i];
      if (t.priority === maxPriorityVal) {
        if (t.seq < oldestSeq) {
          oldestSeq = t.seq;
          targetIdx = i;
        }
      }
    }

    if (targetIdx >= 0) {
      const [evicted] = this.toasts.splice(targetIdx, 1);
      if (evicted.timerId) clearTimeout(evicted.timerId);
      this._removeDomElement(evicted.element);
      return true;
    }

    return false;
  }

  /**
   * Dismiss a toast with smooth exit animation.
   * @private
   */
  _dismissToast(id) {
    const idx = this.toasts.findIndex(t => t.id === id);
    if (idx === -1) return;

    const [toast] = this.toasts.splice(idx, 1);
    if (toast.timerId) clearTimeout(toast.timerId);

    if (toast.element) {
      toast.element.classList.add('ct-exit');
      setTimeout(() => {
        this._removeDomElement(toast.element);
        this._updateMobileVisibility();
      }, 250);
    } else {
      this._updateMobileVisibility();
    }
  }

  /**
   * Safely remove DOM element.
   * @private
   */
  _removeDomElement(el) {
    if (el && el.parentNode) {
      el.parentNode.removeChild(el);
    }
  }

  /**
   * Render single toast element at the top of container.
   * @private
   */
  _renderToastElement(toast) {
    if (!this.container || typeof document === 'undefined') return;

    const el = document.createElement('div');
    el.className = `commentary-toast ct-accent-${toast.accent}`;
    el.dataset.id = toast.id;
    el.setAttribute('role', 'alert');

    const badgeLabel = this._formatBadge(toast.category);

    el.innerHTML = `
      <div class="ct-accent-bar"></div>
      <div class="ct-icon" aria-hidden="true">${toast.icon}</div>
      <div class="ct-content">
        <div class="ct-badge-row">
          <span class="ct-category">${badgeLabel}</span>
        </div>
        <div class="ct-headline">${this._escapeHtml(toast.headline)}</div>
        ${toast.detail ? `<div class="ct-detail">${this._escapeHtml(toast.detail)}</div>` : ''}
      </div>
      <button type="button" class="ct-close" aria-label="Dismiss notification">&times;</button>
    `;

    // Manual close button
    const closeBtn = el.querySelector('.ct-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._dismissToast(toast.id);
      });
    }

    toast.element = el;

    // Prepend so newest is at the top of the stack
    if (this.container.firstChild) {
      this.container.insertBefore(el, this.container.firstChild);
    } else {
      this.container.appendChild(el);
    }
  }

  /**
   * Ensure the mobile expansion pill button exists at the bottom of the stack.
   * @private
   */
  _ensureExpandButton() {
    if (!this.container || typeof document === 'undefined') return;
    if (!this.expandBtn) {
      this.expandBtn = document.createElement('button');
      this.expandBtn.type = 'button';
      this.expandBtn.className = 'ct-expand-btn';
      this.expandBtn.setAttribute('aria-label', 'Toggle older notifications');
      this.expandBtn.style.display = 'none';
      this.expandBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleMobileExpansion();
      });
      this.container.appendChild(this.expandBtn);
    } else {
      // Ensure expandBtn stays at the bottom of the container
      this.container.appendChild(this.expandBtn);
    }
  }

  /**
   * Update mobile visibility classes and expansion button status.
   * Ensures Critical (P1) alerts remain visible on mobile even when collapsed to 2.
   * @private
   */
  _updateMobileVisibility() {
    if (!this.container || typeof document === 'undefined') return;
    this._ensureExpandButton();

    const total = this.toasts.length;
    if (total <= this.mobileMaxVisible) {
      if (this.expandBtn) this.expandBtn.style.display = 'none';
      for (const t of this.toasts) {
        if (t.element) t.element.classList.remove('ct-mobile-hidden');
      }
      return;
    }

    // When there are more toasts than mobileMaxVisible
    if (this.expandBtn) {
      this.expandBtn.style.display = '';
      if (this.mobileExpanded) {
        this.expandBtn.innerHTML = '▲ Show less';
        this.expandBtn.classList.add('ct-expanded');
      } else {
        const hiddenCount = total - this.mobileMaxVisible;
        this.expandBtn.innerHTML = `+${hiddenCount} more`;
        this.expandBtn.classList.remove('ct-expanded');
      }
    }

    if (this.mobileExpanded) {
      for (const t of this.toasts) {
        if (t.element) t.element.classList.remove('ct-mobile-hidden');
      }
    } else {
      const visibleIds = new Set();
      // 1. Critical events (priority 1) must remain visible
      for (const t of this.toasts) {
        if (t.priority === 1 && visibleIds.size < this.mobileMaxVisible) {
          visibleIds.add(t.id);
        }
      }
      // 2. Fill remaining slots with newest notifications (from top)
      for (const t of this.toasts) {
        if (visibleIds.size >= this.mobileMaxVisible) break;
        visibleIds.add(t.id);
      }

      for (const t of this.toasts) {
        if (t.element) {
          if (visibleIds.has(t.id)) {
            t.element.classList.remove('ct-mobile-hidden');
          } else {
            t.element.classList.add('ct-mobile-hidden');
          }
        }
      }
    }
  }

  /**
   * Re-sync DOM with internal array.
   * @private
   */
  _syncDom() {
    if (!this.container || typeof document === 'undefined') return;
    this.container.innerHTML = '';
    this.expandBtn = null;
    // Append in reverse order so unshifted items stay top
    for (let i = this.toasts.length - 1; i >= 0; i--) {
      this._renderToastElement(this.toasts[i]);
    }
    this._updateMobileVisibility();
  }

  /**
   * Normalize an event into toast structure or return null if it should be skipped.
   * Filters out lap ticks, low-level telemetry, and redundant events.
   * @private
   */
  _normalizeEvent(ev) {
    if (!ev) return null;

    // Filter out lap ticks or empty messages
    if (ev.type === 'lap_tick' || (!ev.msg && !ev.headline)) {
      return null;
    }

    // If already pre-formatted toast event
    if (ev.headline && ev.category) {
      return {
        category: ev.category,
        headline: ev.headline,
        detail:   ev.detail || '',
        priority: ev.priority ?? ToastPriorities[ev.category],
        accent:   ev.accent || ToastAccents[ev.category],
        icon:     ev.icon || ToastIcons[ev.category],
        key:      ev.key || `${ev.category}_${ev.headline}`,
      };
    }

    const msg = String(ev.msg || '').trim();
    const type = ev.type || 'info';

    // Race Start
    if (type === 'start' || msg.includes('GO GO GO!') || msg.includes('LIGHTS OUT')) {
      return {
        category: 'start',
        headline: 'LIGHTS OUT AND AWAY WE GO!',
        detail: 'The race is underway',
        priority: 2,
        accent: 'green',
        icon: '🚦',
        key: 'race_start_lights_out',
      };
    }

    // Race Finish / Chequered Flag
    if (type === 'finish' || msg.includes('CHEQUERED FLAG') || msg.includes('FINISHES')) {
      return {
        category: 'finish',
        headline: 'CHEQUERED FLAG',
        detail: msg.replace(/^Race control:\s*/i, ''),
        priority: 1,
        accent: 'gold',
        icon: '🏁',
        key: `race_finish_${msg}`,
      };
    }

    // Red Flag
    if (msg.includes('RED FLAG')) {
      return {
        category: 'red_flag',
        headline: 'RED FLAG — SESSION SUSPENDED',
        detail: msg.replace(/^Race control:\s*RED FLAG\s*—?\s*/i, '') || 'Return to pit lane',
        priority: 1,
        accent: 'red',
        icon: '🚩',
        key: 'red_flag_alert',
      };
    }

    // Safety Car
    if (msg.includes('PHYSICAL SAFETY CAR DEPLOYED') || msg.includes('SAFETY CAR DEPLOYED')) {
      return {
        category: 'safety_car',
        headline: 'SAFETY CAR DEPLOYED',
        detail: 'Full course caution — pack up',
        priority: 1,
        accent: 'amber',
        icon: '🚗',
        key: 'safety_car_deployed',
      };
    }

    // Virtual Safety Car
    if (msg.includes('VIRTUAL SAFETY CAR DEPLOYED') || msg.includes('VSC')) {
      return {
        category: 'vsc',
        headline: 'VIRTUAL SAFETY CAR (VSC)',
        detail: 'Reduce speed and maintain delta',
        priority: 1,
        accent: 'amber',
        icon: '🟡',
        key: 'vsc_deployed',
      };
    }

    // Green Flag / Resume
    if (msg.includes('GREEN FLAG')) {
      return {
        category: 'green_flag',
        headline: 'GREEN FLAG',
        detail: 'Track is clear — race resumed',
        priority: 2,
        accent: 'green',
        icon: '🟢',
        key: 'green_flag_resumed',
      };
    }

    // Penalties & Jump Starts
    if (msg.includes('JUMP START') || msg.includes('PENALTY') || msg.includes('INVESTIGATION')) {
      return {
        category: 'penalty',
        headline: 'RACE CONTROL INVESTIGATION',
        detail: msg.replace(/^⚠️\s*/, ''),
        priority: 2,
        accent: 'red',
        icon: '⚖️',
        key: `penalty_${msg}`,
      };
    }

    // Incidents & Hazards
    if (type === 'incident' || msg.includes('Incident:') || msg.includes('HAZARD') || msg.includes('DEBRIS')) {
      return {
        category: 'incident',
        headline: 'TRACK HAZARD DETECTED',
        detail: msg.replace(/^Incident:\s*/i, ''),
        priority: 1,
        accent: 'red',
        icon: '⚠️',
        key: `incident_${msg}`,
      };
    }

    // Pit Stop activity
    if (type === 'pit' || msg.includes('Pitting') || msg.includes('Box this lap')) {
      return {
        category: 'pit',
        headline: 'PIT LANE ACTIVITY',
        detail: msg,
        priority: 2,
        accent: 'magenta',
        icon: '🔧',
        key: `pit_${msg}`,
      };
    }

    // Overtake or Lead Change from message
    if (msg.includes('takes the lead') || msg.includes('TAKES THE LEAD')) {
      return {
        category: 'lead_change',
        headline: 'LEAD CHANGE',
        detail: msg,
        priority: 2,
        accent: 'gold',
        icon: '⚡',
        key: `lead_${msg}`,
      };
    }

    if (msg.includes('commits to overtake') || msg.includes('OVERTAKES')) {
      return {
        category: 'overtake',
        headline: 'OVERTAKE',
        detail: msg,
        priority: 3,
        accent: 'blue',
        icon: '🏎️',
        key: `overtake_${msg}`,
      };
    }

    // General AI / Control fallback if high-importance
    if (type === 'control' && !msg.includes('Grid set') && !msg.includes('initiated')) {
      return {
        category: 'info',
        headline: 'RACE CONTROL',
        detail: msg.replace(/^Race control:\s*/i, ''),
        priority: 3,
        accent: 'blue',
        icon: '📻',
        key: `rc_${msg}`,
      };
    }

    return null;
  }

  /**
   * Format badge label.
   * @private
   */
  _formatBadge(category) {
    const map = {
      lead_change: 'LEAD CHANGE',
      overtake:    'OVERTAKE',
      start:       'RACE START',
      finish:      'CHEQUERED FLAG',
      yellow_flag: 'YELLOW FLAG',
      red_flag:    'RED FLAG',
      safety_car:  'SAFETY CAR',
      vsc:         'VSC',
      green_flag:  'TRACK CLEAR',
      incident:    'INCIDENT',
      penalty:     'PENALTY',
      pit:         'PIT STOP',
      info:        'RACE INFO',
      default:     'COMMENTARY',
    };
    return map[category] || category.toUpperCase();
  }

  /**
   * Escape HTML entities.
   * @private
   */
  _escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
