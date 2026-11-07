/**
 * investigationOverlay.js
 * Persistent Central Investigation Notification for the Player.
 *
 * Renders an authoritative, broadcast-style FIA Race Control judicial card
 * directly in the center of the circuit display when the player driver is
 * under active investigation.
 *
 * Requirements:
 *  - Prominently positioned in the CENTER of the race track screen.
 *  - Remains visible continuously while the investigation is ongoing.
 *  - Displays Driver Name, Reason, Lap, Approximate Location, and Status.
 *  - Updates to display official decision (Penalty / No Further Action / Warning).
 *  - Persists for a brief review window (5s) after decision, then dismisses.
 *  - Independent of the 4-toast commentary overlay (cannot be evicted by commentary).
 *  - Player cannot dismiss an unresolved investigation.
 */

export class InvestigationOverlay {
  /**
   * @param {HTMLElement|null} containerEl - DOM container element
   */
  constructor(containerEl = null) {
    this.container = containerEl;
    this.currentInvestigation = null;
    this.dismissTimer = null;
  }

  setContainer(containerEl) {
    this.container = containerEl;
  }

  /**
   * Ingest an investigation update from Race Control.
   * @param {object} inv – investigation record from RaceControl
   */
  handleInvestigationUpdate(inv) {
    if (!inv || !inv.isPlayer) return;

    this.currentInvestigation = inv;

    if (this.dismissTimer) {
      clearTimeout(this.dismissTimer);
      this.dismissTimer = null;
    }

    this.render();

    // If resolved, schedule auto-dismissal after 5.0 seconds
    if (inv.status === 'RESOLVED') {
      this.dismissTimer = setTimeout(() => {
        this.dismiss();
      }, 5000);
    }
  }

  /**
   * Render the central investigation card.
   */
  render() {
    if (!this.container || !this.currentInvestigation) return;

    const inv = this.currentInvestigation;
    const isOngoing = (inv.status !== 'RESOLVED');

    const statusPillClass = isOngoing ? 'cio-status-ongoing' : 'cio-status-resolved';
    const statusPillText  = isOngoing ? '● INVESTIGATION ONGOING' : '● INVESTIGATION CONCLUDED';

    let decisionHtml = '';
    if (!isOngoing) {
      const isPenalty = (inv.penaltySeconds > 0);
      const isWarning = (inv.decision === 'WARNING');
      const decisionClass = isPenalty ? 'cio-dec-penalty' : (isWarning ? 'cio-dec-warning' : 'cio-dec-clear');
      const decisionTitle = isPenalty
        ? `${inv.penaltySeconds}-SECOND TIME PENALTY`
        : (isWarning ? 'OFFICIAL WARNING' : 'NO FURTHER ACTION');

      decisionHtml = `
        <div class="cio-decision-box ${decisionClass}">
          <div class="cio-dec-label">OFFICIAL DECISION:</div>
          <div class="cio-dec-val">${decisionTitle}</div>
          <div class="cio-dec-sub">${this._escape(inv.decisionText || inv.reason)}</div>
        </div>
      `;
    }

    this.container.innerHTML = `
      <div class="cio-card ${isOngoing ? 'cio-pulse' : ''}">
        <div class="cio-header">
          <span class="cio-badge">FIA RACE CONTROL</span>
          <span class="cio-status ${statusPillClass}">${statusPillText}</span>
        </div>

        <div class="cio-title">UNDER INVESTIGATION</div>
        <div class="cio-driver">${this._escape(inv.driverCode)} &middot; ${this._escape(inv.driverName)}</div>

        <div class="cio-body">
          <div class="cio-reason-line">
            <span class="cio-label">INCIDENT:</span>
            <span class="cio-val">${this._escape(inv.reason)}</span>
          </div>
          <div class="cio-meta-row">
            <span>Lap ${inv.lap || 1}</span>
            <span>&middot;</span>
            <span>Sector ${inv.sector || 1}</span>
            <span>&middot;</span>
            <span>Reviewing Telemetry & Video</span>
          </div>
        </div>

        ${decisionHtml}

        <div class="cio-footer">
          ${isOngoing
            ? '<span class="cio-timer-hint">Stewards reviewing evidence &middot; racing continues</span>'
            : '<span class="cio-timer-hint">Official ruling logged to Race Control registry</span>'}
        </div>
      </div>
    `;

    this.container.style.display = 'flex';
  }

  /**
   * Smoothly dismiss the notification.
   */
  dismiss() {
    if (!this.container) return;
    this.container.classList.add('cio-exit');
    setTimeout(() => {
      if (this.container) {
        this.container.style.display = 'none';
        this.container.classList.remove('cio-exit');
        this.container.innerHTML = '';
      }
      this.currentInvestigation = null;
    }, 300);
  }

  /**
   * Clear state immediately (e.g. on race restart).
   */
  clear() {
    if (this.dismissTimer) {
      clearTimeout(this.dismissTimer);
      this.dismissTimer = null;
    }
    this.currentInvestigation = null;
    if (this.container) {
      this.container.style.display = 'none';
      this.container.innerHTML = '';
    }
  }

  _escape(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
