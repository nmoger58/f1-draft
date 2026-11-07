/**
 * circuitSelect.js
 * Dedicated Circuit Selection Screen Component for F1 Apex Racing Autonomous Simulator.
 *
 * Implements:
 *   1. Compact page heading and subtitle with circuit count badge.
 *   2. Spacious, touch-optimised circuit selection grid with enlarged track geometry previews.
 *   3. Prominent Selected Circuit Information card with authentic FIA specifications and red accent styling.
 *   4. Mobile-first responsive hierarchy supporting 320px–768px viewports in portrait & landscape.
 */

import { CIRCUITS, RAW_WAYPOINTS, getCircuit } from '../data/circuitData.js';

export { CIRCUITS, RAW_WAYPOINTS, getCircuit };

/**
 * Builds the SVG track path string from GPS waypoints.
 * @param {string} circuitId
 * @returns {string} SVG path d attribute
 */
export function getTrackSvgPath(circuitId) {
  const points = RAW_WAYPOINTS[circuitId] || [];
  if (!points || points.length === 0) return '';
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ') + ' Z';
}

/**
 * Renders the Selected Circuit Information section.
 * @param {object} circuit
 * @returns {string} HTML markup
 */
export function renderSelectedCircuitInfo(circuit) {
  if (!circuit || typeof circuit !== 'object') return '';

  const len = typeof circuit.lengthM === 'number' ? circuit.lengthM : 5000;
  const lengthKm = (len / 1000).toFixed(3);
  const lengthMeters = len.toLocaleString();
  const lapRecordFormatted = typeof circuit.rec === 'number' ? `${circuit.rec.toFixed(3)}s` : (circuit.rec || '–');
  const recordHolder = circuit.who || 'Formula 1 Record';
  const recordYear = circuit.year || 2025;
  const turns = typeof circuit.turns === 'number' ? circuit.turns : 15;
  const drs = typeof circuit.drs === 'number' ? circuit.drs : 2;
  const turnCharacter = turns > 16 ? 'High Downforce & Technical' : (turns > 12 ? 'Balanced High Speed' : 'Low Drag Power Track');

  return `
    <section class="qr-selected-circuit-section" id="qrSelectedCircuitInfo" aria-label="Selected Circuit Specifications">
      <div class="qr-selected-card">
        <div class="qr-selected-header">
          <div class="qr-selected-badge-col">
            <div class="qr-selected-status-pill">
              <span class="f1-badge-red">CONFIRMED SELECTION</span>
              <span class="qr-selected-f1-tag">OFFICIAL FIA SPEC</span>
            </div>
            <h4 class="qr-selected-title">${circuit.name}</h4>
            <span class="qr-selected-loc">📍 ${circuit.loc || circuit.country} &middot; ${circuit.country}</span>
          </div>
          <div class="qr-selected-accent-tag" aria-hidden="true">
            <span class="qr-active-dot"></span>
            <span>ACTIVE TRACK</span>
          </div>
        </div>

        <!-- 4-Stat Overview Grid -->
        <div class="qr-selected-stats-grid">
          <div class="qr-stat-box">
            <span class="qr-stat-label">CIRCUIT LENGTH</span>
            <span class="qr-stat-val">${lengthKm} km <small>(${lengthMeters} m)</small></span>
          </div>
          <div class="qr-stat-box">
            <span class="qr-stat-label">CORNERS / TURNS</span>
            <span class="qr-stat-val">${circuit.turns} Turns <small>(${turnCharacter})</small></span>
          </div>
          <div class="qr-stat-box">
            <span class="qr-stat-label">DRS ACTIVATION</span>
            <span class="qr-stat-val">${circuit.drs} Zones <small>(Detection & Flap)</small></span>
          </div>
          <div class="qr-stat-box qr-stat-highlight">
            <span class="qr-stat-label">OFFICIAL LAP RECORD</span>
            <span class="qr-stat-val qr-stat-gold">⏱️ ${lapRecordFormatted} <small>(${recordHolder}, ${recordYear})</small></span>
          </div>
        </div>

        <!-- Tactical Profile Note -->
        <div class="qr-selected-characteristics">
          <span class="qr-char-label">TRACK PROFILE &amp; OVERTAKING ZONES:</span>
          <p class="qr-char-text">${circuit.note || 'Demanding track geometry with rapid elevation and aerodynamic tyre stress.'}</p>
        </div>
      </div>
    </section>
  `;
}

/**
 * Renders the full Step 2: Circuit Selection Screen.
 * @param {object} w Wizard state object containing circuitId
 * @returns {string} HTML markup
 */
export function renderCircuitSelection(w = {}) {
  const wizard = w || {};
  let selectedCircuit = getCircuit(wizard.circuitId);
  if (!selectedCircuit) {
    selectedCircuit = CIRCUITS[0] || null;
  }
  const currentCircuitId = selectedCircuit ? selectedCircuit.id : (wizard.circuitId || 'silverstone');

  return `
    <div class="qr-step-content qr-circuit-step">
      <!-- Section 1: Compact Page Heading & Subtitle -->
      <div class="qr-section-desc qr-circuit-heading">
        <div class="qr-circuit-badge-eyebrow">
          <span class="f1-badge-red">STEP 2 &middot; TRACK SELECT</span>
          <span class="qr-circuit-count-badge">8 OFFICIAL CIRCUITS</span>
        </div>
        <h3 class="qr-circuit-page-title">CIRCUIT SELECTION</h3>
        <p class="qr-circuit-page-sub">Select an official Formula 1 circuit. Each track features authentic GPS waypoints, corner profiles, and DRS zones.</p>
      </div>

      <!-- Section 2: Circuit Selection Area with Larger Cards -->
      <div class="qr-circuit-grid" role="radiogroup" aria-label="Available Formula 1 Circuits">
        ${CIRCUITS.map(c => {
          const isSelected = (currentCircuitId === c.id);
          const pathData = getTrackSvgPath(c.id);
          const lengthKm = (c.lengthM / 1000).toFixed(3);
          const recText = c.rec ? `${c.rec.toFixed(3)}s` : '–';
          const whoText = c.who ? `(${c.who}, ${c.year || 2025})` : '';

          return `
            <div
              class="qr-circuit-card ${isSelected ? 'active' : ''}"
              data-circuit-id="${c.id}"
              role="radio"
              aria-checked="${isSelected}"
              tabindex="0"
              aria-label="${c.name} Grand Prix, ${c.country}"
            >
              <div class="qr-circuit-thumb">
                <svg viewBox="0 0 800 560" class="qr-circuit-svg" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
                  <path d="${pathData}" class="qr-track-path" />
                </svg>
                <div class="qr-thumb-overlay">
                  <span class="qr-thumb-tag">${c.countryCode || c.country}</span>
                  ${isSelected ? `
                    <span class="qr-thumb-active-pill">
                      <span class="qr-active-pip"></span> SELECTED
                    </span>
                  ` : ''}
                </div>
              </div>

              <div class="qr-circuit-info">
                <div class="qr-circuit-name-row">
                  <h4 class="qr-circuit-name">${c.name}</h4>
                  <span class="qr-circuit-country">${c.country}</span>
                </div>

                <div class="qr-circuit-meta-row">
                  <span class="qr-meta-item"><strong class="qr-meta-val">${lengthKm}</strong> km</span>
                  <span class="qr-meta-sep">&middot;</span>
                  <span class="qr-meta-item"><strong class="qr-meta-val">${c.turns}</strong> Turns</span>
                  <span class="qr-meta-sep">&middot;</span>
                  <span class="qr-meta-item"><strong class="qr-meta-val">${c.drs}</strong> DRS</span>
                </div>

                <p class="qr-circuit-note">${c.note}</p>

                <div class="qr-circuit-record">
                  <span class="qr-rec-lbl">RECORD:</span>
                  <span class="qr-rec-data">⏱️ <strong>${recText}</strong> <small>${whoText}</small></span>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>

      <!-- Section 3: Selected Circuit Information -->
      ${renderSelectedCircuitInfo(selectedCircuit)}
    </div>
  `;
}

/**
 * Binds user interaction events to circuit cards (click, tap, keyboard).
 * @param {HTMLElement} container
 * @param {object} w Wizard state
 * @param {Function} rerender Callback to re-render wizard
 */
export function bindCircuitSelectionEvents(container, w, rerender) {
  if (!container || !w) return;
  const onRerender = typeof rerender === 'function' ? rerender : () => {};

  const cards = container.querySelectorAll('.qr-circuit-card');
  cards.forEach(card => {
    const cid = card.dataset.circuitId;
    if (!cid) return;

    const selectThisCircuit = () => {
      if (w.circuitId !== cid) {
        w.circuitId = cid;
        onRerender();
      }
    };

    card.addEventListener('click', (e) => {
      e.preventDefault();
      selectThisCircuit();
    });

    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectThisCircuit();
      }
    });
  });
}
