/**
 * multiplayerViews.js
 * UI views and renderers for 2–20 player multiplayer (mobile-first).
 *
 * Screens: Hub, Create modal, Join modals, Waiting room, Roulette,
 * Selection confirmation, Live timing tower, Final results.
 *
 * Pair with multiplayer-mobile.css (adds the mpx- classes + responsive rules).
 */

import { CIRCUITS } from '../data/circuitData.js';
import { DRIVERS } from '../data/driverData.js';
import { CARS } from '../data/carData.js';
import { MANAGERS } from '../data/managerData.js';

const NAME_KEY = 'f1_player_name';

// ── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const pad2 = (n) => String(n).padStart(2, '0');
const circuitList = () => (Array.isArray(CIRCUITS) ? CIRCUITS : Object.values(CIRCUITS || {}));
const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const isCoarsePointer = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
const isSmallScreen = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(max-width: 640px)').matches;

function getSavedName() {
  try { return localStorage.getItem(NAME_KEY) || ''; } catch (_) { return ''; }
}
function saveName(name) {
  try { localStorage.setItem(NAME_KEY, name); } catch (_) {}
}

/** Accepts "RACE-7K4P", "7k4p", or a pasted invite link containing ?room=... */
function normalizeRoomCode(raw) {
  let v = String(raw || '').trim();
  const m = v.match(/[?&]room=([^&#\s]+)/i);
  if (m) { try { v = decodeURIComponent(m[1]); } catch (_) { v = m[1]; } }
  v = v.toUpperCase().replace(/\s+/g, '');
  if (/^[2-9A-HJ-NP-Z]{4}$/.test(v)) v = `RACE-${v}`;
  return v;
}

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (_) { return false; }
}

function inviteLink(roomId) {
  if (typeof window === 'undefined' || !window.location || window.location.origin === 'null') return roomId;
  return `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(roomId)}`;
}

/** Clears timers / key handlers left by the previous screen in this container. */
function resetContainer(container) {
  if (container._reelTimer) { clearInterval(container._reelTimer); container._reelTimer = null; }
  if (container._reelTimeout) { clearTimeout(container._reelTimeout); container._reelTimeout = null; }
  if (container._countdownTimer) { clearInterval(container._countdownTimer); container._countdownTimer = null; }
  if (container._escHandler) {
    document.removeEventListener('keydown', container._escHandler);
    container._escHandler = null;
  }
  container._hub = null;
}

function bindEscape(container, fn) {
  if (typeof fn !== 'function') return;
  container._escHandler = (e) => { if (e.key === 'Escape') fn(); };
  document.addEventListener('keydown', container._escHandler);
}

function focusFirst(container, selector) {
  // Don't pop the on-screen keyboard open on touch devices
  if (isCoarsePointer()) return;
  const el = container.querySelector(selector);
  if (el) el.focus({ preventScroll: true });
}

function showError(box, msg) {
  if (!box) return;
  box.textContent = msg;
  box.style.display = 'block';
}
function hideError(box) {
  if (box) box.style.display = 'none';
}

export class MultiplayerViews {

  // ── 1. Hub ─────────────────────────────────────────────────────────────────

  static renderHub(container, {
    rooms = [],
    connected = true,
    onCreateCustomClick,
    onCreatePublicClick,
    onJoinPrivateClick,
    onDirectJoinPublic,
    onRefreshRooms,
    onBackClick
  }) {
    resetContainer(container);
    const circuits = circuitList();

    container.innerHTML = `
      <div class="f1-modal-backdrop mp-hub-backdrop">
        <main class="f1-menu-card f1-card-wide mp-hub-card mpx-screen" aria-labelledby="mpHubTitle">
          <header class="f1-menu-header mp-hub-header">
            <div class="f1-menu-nav-row mp-hub-nav-row">
              <button type="button" class="f1-btn-ghost btn-modal-back" id="btnMpHubBack">← MAIN MENU</button>
              <div class="mp-hub-header-badges">
                <span class="f1-badge-red">MULTIPLAYER · 2–20 PLAYERS</span>
                <span class="mp-conn-badge ${connected ? 'conn-online' : 'conn-pending'}" id="mpConnStatusBadge">
                  <span class="mp-live-dot ${connected ? '' : 'dot-pending'}"></span>
                  ${connected ? 'SERVER ONLINE' : 'SERVER READY'}
                </span>
              </div>
            </div>
            <h1 class="f1-menu-title mp-hub-main-title" id="mpHubTitle">MULTIPLAYER GRAND PRIX</h1>
            <p class="f1-menu-sub mp-hub-main-sub">Live lobbies, synchronized roulettes and full-field racing.</p>
          </header>

          <section class="mp-hub-dual-actions" aria-label="Create a room">
            <article class="mp-mode-card mp-mode-custom">
              <div class="mp-mode-card-img-wrap">
                <img src="/assets/images/mode_custom_room.png" alt="" loading="lazy" class="mp-mode-card-img"
                     onerror="this.onerror=null;this.src='/assets/images/mode_multiplayer.png'" />
                <span class="mp-badge-tag tag-private">🔒 PRIVATE GRID</span>
              </div>
              <div class="mp-mode-card-body">
                <h2>CREATE CUSTOM ROOM</h2>
                <p>Private room with full host control. Share a code to invite friends.</p>
                <button type="button" class="f1-btn-primary mp-btn-action" id="btnMpCreateCustom">CREATE CUSTOM ROOM</button>
              </div>
            </article>

            <article class="mp-mode-card mp-mode-public">
              <div class="mp-mode-card-img-wrap">
                <img src="/assets/images/mode_public_room.png" alt="" loading="lazy" class="mp-mode-card-img"
                     onerror="this.onerror=null;this.src='/assets/images/mode_multiplayer.png'" />
                <span class="mp-badge-tag tag-public">🌐 OPEN MATCHMAKING</span>
              </div>
              <div class="mp-mode-card-body">
                <h2>CREATE PUBLIC ROOM</h2>
                <p>Listed in the live browser so anyone can join without a code.</p>
                <button type="button" class="f1-btn-primary mp-btn-action" id="btnMpCreatePublic">CREATE PUBLIC ROOM</button>
              </div>
            </article>
          </section>

          <section class="mp-private-join-bar" aria-label="Join a private room">
            <div class="mp-private-join-left">
              <span class="mp-private-key-icon" aria-hidden="true">🔑</span>
              <div class="mp-private-text">
                <strong>JOIN PRIVATE ROOM</strong>
                <p>Enter the code (or paste the invite link) from your host.</p>
              </div>
            </div>
            <form class="mp-private-inputs-row" id="formQuickJoin" novalidate>
              <input type="text" id="inputQuickRoomId" placeholder="RACE-7K4P or invite link"
                     class="f1-input mp-input-code mpx-upper" spellcheck="false" autocomplete="off"
                     autocapitalize="characters" autocorrect="off" enterkeyhint="go" aria-label="Private room code" />
              <button type="submit" class="f1-btn-secondary mp-btn-code-join" id="btnMpOpenJoin">JOIN</button>
            </form>
          </section>

          <section class="mp-browser-section" aria-labelledby="mpBrowserTitle">
            <div class="mp-browser-header">
              <div class="mp-browser-title-col">
                <div class="mp-live-pulse-row">
                  <span class="mp-live-dot"></span>
                  <h2 class="mp-browser-title" id="mpBrowserTitle">LIVE PUBLIC ROOMS</h2>
                </div>
                <p class="mp-browser-sub">Open grids forming right now.</p>
              </div>
              <button type="button" class="f1-btn-ghost mp-btn-refresh" id="btnMpRefreshRooms" aria-label="Refresh public rooms">
                <span class="mp-refresh-icon" id="mpRefreshIcon" aria-hidden="true">🔄</span>
                <span>REFRESH</span>
              </button>
            </div>

            <div class="mp-browser-controls">
              <div class="mp-search-wrap">
                <span class="mp-search-icon" aria-hidden="true">🔍</span>
                <input type="search" id="inputMpSearch" class="f1-input mp-search-input"
                       placeholder="Search room or host…" aria-label="Search rooms" autocomplete="off" />
              </div>
              <div class="mp-filters-wrap">
                <select id="selectMpCircuit" class="f1-select mp-filter-select" aria-label="Filter by circuit">
                  <option value="all">All Circuits</option>
                  ${circuits.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('')}
                </select>
                <select id="selectMpFormat" class="f1-select mp-filter-select" aria-label="Filter by format">
                  <option value="all">All Formats</option>
                  <option value="sprint">Sprint (≤ 5 laps)</option>
                  <option value="standard">Standard (6–15)</option>
                  <option value="feature">Feature (16+)</option>
                  <option value="qualifying">⚡ With Qualifying</option>
                </select>
                <select id="selectMpSort" class="f1-select mp-filter-select" aria-label="Sort rooms">
                  <option value="newest">Newest First</option>
                  <option value="players">Most Players</option>
                  <option value="slots">Most Open Slots</option>
                </select>
              </div>
            </div>

            <div class="mp-public-rooms-grid" id="mpPublicRoomsGrid" aria-live="polite"></div>
          </section>
        </main>
      </div>
    `;

    let activeRooms = Array.isArray(rooms) ? [...rooms] : [];

    const refreshCards = () => {
      const gridEl = container.querySelector('#mpPublicRoomsGrid');
      if (!gridEl) return;

      const q = (container.querySelector('#inputMpSearch')?.value || '').trim().toLowerCase();
      const circuitFilter = container.querySelector('#selectMpCircuit')?.value || 'all';
      const formatFilter = container.querySelector('#selectMpFormat')?.value || 'all';
      const sortMode = container.querySelector('#selectMpSort')?.value || 'newest';

      const filtered = activeRooms.filter(r => {
        if (q && !(r.roomName || '').toLowerCase().includes(q) && !(r.hostDisplayName || '').toLowerCase().includes(q)) return false;
        if (circuitFilter !== 'all' && r.circuitId !== circuitFilter) return false;
        if (formatFilter === 'sprint' && r.laps > 5) return false;
        if (formatFilter === 'standard' && (r.laps <= 5 || r.laps > 15)) return false;
        if (formatFilter === 'feature' && r.laps <= 15) return false;
        if (formatFilter === 'qualifying' && !r.includeQualifying) return false;
        return true;
      });

      if (sortMode === 'players') {
        filtered.sort((a, b) => (b.connectedPlayersCount || 0) - (a.connectedPlayersCount || 0));
      } else if (sortMode === 'slots') {
        filtered.sort((a, b) => (b.maxPlayers - b.connectedPlayersCount) - (a.maxPlayers - a.connectedPlayersCount));
      } else {
        filtered.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      }

      MultiplayerViews.renderPublicRoomsList(gridEl, filtered, onDirectJoinPublic, onCreatePublicClick);
    };

    // Lets the controller push live updates through the same filters
    container._hub = {
      setRooms(list) {
        activeRooms = Array.isArray(list) ? [...list] : [];
        refreshCards();
      }
    };

    container.querySelector('#btnMpHubBack')?.addEventListener('click', onBackClick);
    container.querySelector('#btnMpCreateCustom')?.addEventListener('click', onCreateCustomClick);
    container.querySelector('#btnMpCreatePublic')?.addEventListener('click', onCreatePublicClick);

    // <form> so the keyboard "Go" key works on mobile
    container.querySelector('#formQuickJoin')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const raw = container.querySelector('#inputQuickRoomId')?.value || '';
      onJoinPrivateClick?.(normalizeRoomCode(raw));
    });

    container.querySelector('#btnMpRefreshRooms')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const icon = container.querySelector('#mpRefreshIcon');
      btn.disabled = true;
      icon?.classList.add('spinning');
      try {
        if (typeof onRefreshRooms === 'function') {
          const fresh = await onRefreshRooms();
          if (Array.isArray(fresh)) activeRooms = [...fresh];
        }
      } finally {
        setTimeout(() => {
          icon?.classList.remove('spinning');
          if (btn.isConnected) btn.disabled = false;
          refreshCards();
        }, 350);
      }
    });

    container.querySelector('#inputMpSearch')?.addEventListener('input', refreshCards);
    container.querySelector('#selectMpCircuit')?.addEventListener('change', refreshCards);
    container.querySelector('#selectMpFormat')?.addEventListener('change', refreshCards);
    container.querySelector('#selectMpSort')?.addEventListener('change', refreshCards);

    refreshCards();
  }

  /** Push a fresh public-room list into an already rendered hub (keeps filters). */
  static updateHubRooms(container, rooms) {
    if (container?._hub) {
      container._hub.setRooms(rooms);
      return true;
    }
    return false;
  }

  // ── 2. Public rooms list ───────────────────────────────────────────────────

  static renderPublicRoomsList(container, rooms, onDirectJoin, onCreatePublic) {
    if (!rooms || rooms.length === 0) {
      container.innerHTML = `
        <div class="mp-rooms-empty-state">
          <div class="mp-empty-icon" aria-hidden="true">🏎️</div>
          <h3 class="mp-empty-title">NO PUBLIC RACES YET</h3>
          <p class="mp-empty-sub">Start a public room and invite racers to your grid.</p>
          <button type="button" class="f1-btn-primary mp-btn-create-empty" id="btnEmptyCreatePublic">CREATE PUBLIC ROOM</button>
        </div>
      `;
      container.querySelector('#btnEmptyCreatePublic')?.addEventListener('click', () => onCreatePublic?.());
      return;
    }

    container.innerHTML = rooms.map(r => {
      const isFull = r.connectedPlayersCount >= r.maxPlayers;
      const isAlmostFull = !isFull && r.connectedPlayersCount >= r.maxPlayers - 2;
      const statusClass = isFull ? 'status-full' : (isAlmostFull ? 'status-almost' : 'status-waiting');
      const statusText = isFull ? 'FULL' : (isAlmostFull ? 'ALMOST FULL' : 'WAITING');
      const pct = Math.min(100, Math.round((r.connectedPlayersCount / r.maxPlayers) * 100));

      return `
        <article class="mp-room-card ${isFull ? 'card-full' : ''}">
          <div class="mp-room-card-top">
            <div class="mp-room-card-head">
              <span class="mp-circuit-flag" aria-hidden="true">🏁</span>
              <div class="mp-room-card-titles">
                <h3 class="mp-room-name" title="${escapeHtml(r.roomName)}">${escapeHtml(r.roomName)}</h3>
                <span class="mp-room-host">👑 <strong>${escapeHtml(r.hostDisplayName)}</strong></span>
              </div>
            </div>
            <span class="mp-status-pill ${statusClass}">${statusText}</span>
          </div>

          <div class="mp-room-meta-chips">
            <span class="mp-chip">📍 <strong>${escapeHtml(r.circuitName)}</strong></span>
            <span class="mp-chip">🔄 <strong>${r.laps} laps</strong></span>
            <span class="mp-chip ${r.includeQualifying ? 'chip-qual' : ''}">${r.includeQualifying ? '⚡ Qualifying' : 'Direct grid'}</span>
          </div>

          <div class="mp-room-card-bottom">
            <div class="mp-occupancy-wrap">
              <div class="mp-occupancy-header">
                <span class="mp-occupancy-label">GRID SLOTS</span>
                <strong class="mp-occupancy-val">${r.connectedPlayersCount}/${r.maxPlayers}</strong>
              </div>
              <div class="mp-occupancy-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${r.maxPlayers}" aria-valuenow="${r.connectedPlayersCount}">
                <div class="mp-occupancy-fill" style="width:${pct}%"></div>
              </div>
            </div>
            <div class="mp-room-card-action">
              ${isFull
                ? '<button type="button" class="f1-btn-ghost mp-btn-join-disabled" disabled>ROOM FULL</button>'
                : `<button type="button" class="f1-btn-primary mp-btn-join-direct" data-room-id="${escapeHtml(r.roomId)}">JOIN RACE</button>`}
            </div>
          </div>
        </article>
      `;
    }).join('');

    container.querySelectorAll('.mp-btn-join-direct').forEach(btn => {
      btn.addEventListener('click', (e) => onDirectJoin?.(e.currentTarget.dataset.roomId));
    });
  }

  // ── 3. Create room modal ───────────────────────────────────────────────────

  static renderCreateModal(container, { defaultType = 'custom', onSubmit, onCancel }) {
    resetContainer(container);
    const circuits = circuitList();

    container.innerHTML = `
      <div class="f1-modal-backdrop">
        <div class="f1-wizard-card f1-card-wide mp-setup-card mpx-screen mpx-modal" role="dialog" aria-modal="true" aria-labelledby="mpModalHeading">
          <div class="f1-wizard-header">
            <div class="f1-wizard-nav">
              <button type="button" class="f1-btn-ghost btn-modal-back" id="btnMpCreateBack">← BACK</button>
              <span class="f1-badge-red">SETUP</span>
              <h2 class="qr-step-title" id="mpModalHeading">${defaultType === 'public' ? 'CREATE PUBLIC ROOM' : 'CREATE CUSTOM ROOM'}</h2>
            </div>
            <button type="button" class="f1-btn-close btn-modal-close" id="btnMpCreateClose" aria-label="Close">&times;</button>
          </div>

          <div class="f1-wizard-content mpx-modal-body">
            <form id="formMpCreate" class="mp-form-grid" novalidate>
              <fieldset class="f1-form-group f1-col-full mpx-fieldset">
                <legend class="f1-label">Room Type</legend>
                <div class="mp-type-toggle-group">
                  <label class="mp-type-pill ${defaultType === 'custom' ? 'active' : ''}" id="lblTypeCustom">
                    <input type="radio" name="mpRoomType" value="custom" ${defaultType === 'custom' ? 'checked' : ''} />
                    <span class="mp-type-icon" aria-hidden="true">🔒</span>
                    <span class="mp-type-text">
                      <strong>Custom (Private)</strong>
                      <small>Hidden · join by invitation code</small>
                    </span>
                  </label>
                  <label class="mp-type-pill ${defaultType === 'public' ? 'active' : ''}" id="lblTypePublic">
                    <input type="radio" name="mpRoomType" value="public" ${defaultType === 'public' ? 'checked' : ''} />
                    <span class="mp-type-icon" aria-hidden="true">🌐</span>
                    <span class="mp-type-text">
                      <strong>Public (Discoverable)</strong>
                      <small>Listed · anyone can join</small>
                    </span>
                  </label>
                </div>
              </fieldset>

              <div class="f1-form-group f1-col-full">
                <label for="mpHostName" class="f1-label">Your Name for This Room <span class="f1-required" aria-hidden="true">*</span></label>
                <input type="text" id="mpHostName" class="f1-input" required maxlength="20" autocomplete="nickname"
                       enterkeyhint="next" placeholder="e.g. Naga, ApexLeader" value="${escapeHtml(getSavedName())}" />
                <span class="f1-hint">Shown in the lobby, timing tower and results.</span>
              </div>

              <div class="f1-form-group f1-col-half">
                <label for="mpRoomName" class="f1-label">Room Name</label>
                <input type="text" id="mpRoomName" class="f1-input" maxlength="32" enterkeyhint="done"
                       placeholder="e.g. Sunday Grand Prix" value="Apex Grand Prix Arena" />
              </div>

              <div class="f1-form-group f1-col-half">
                <label for="mpMaxPlayers" class="f1-label">Max Human Players</label>
                <select id="mpMaxPlayers" class="f1-select">
                  <option value="20" selected>20 (full grid)</option>
                  <option value="16">16</option>
                  <option value="12">12</option>
                  <option value="10">10</option>
                  <option value="8">8</option>
                  <option value="6">6</option>
                  <option value="4">4</option>
                  <option value="2">2 (head-to-head)</option>
                </select>
              </div>

              <div class="f1-form-group f1-col-half">
                <label for="mpCircuit" class="f1-label">Circuit</label>
                <select id="mpCircuit" class="f1-select">
                  ${circuits.map(c => `<option value="${escapeHtml(c.id)}" ${c.id === 'silverstone' ? 'selected' : ''}>${escapeHtml(c.name)} (${escapeHtml(c.country)})</option>`).join('')}
                </select>
              </div>

              <div class="f1-form-group f1-col-half">
                <label for="mpLaps" class="f1-label">Race Distance</label>
                <select id="mpLaps" class="f1-select">
                  <option value="3">3 laps · Sprint</option>
                  <option value="5" selected>5 laps · Quick GP</option>
                  <option value="10">10 laps · Tactical</option>
                  <option value="15">15 laps · Endurance</option>
                  <option value="20">20 laps · Feature</option>
                </select>
              </div>

              <div class="f1-form-group f1-col-half">
                <label for="mpQualifying" class="f1-label">Qualifying Session</label>
                <select id="mpQualifying" class="f1-select">
                  <option value="false" selected>Disabled (direct grid)</option>
                  <option value="true">⚡ Enabled</option>
                </select>
              </div>

              <div class="f1-form-group f1-col-half">
                <label for="mpWeather" class="f1-label">Track Weather</label>
                <select id="mpWeather" class="f1-select">
                  <option value="clear" selected>☀️ Dry &amp; Sunny</option>
                  <option value="overcast">⛅ Overcast</option>
                  <option value="light_rain">🌦️ Intermediate Rain</option>
                  <option value="heavy_rain">🌧️ Full Wet</option>
                  <option value="dynamic">🔄 Dynamic</option>
                </select>
              </div>

              <div class="f1-form-group f1-col-half">
                <label for="mpDriverPolicy" class="f1-label">Driver Selection</label>
                <select id="mpDriverPolicy" class="f1-select">
                  <option value="unique" selected>Unique drivers only</option>
                  <option value="allow">Allow duplicates</option>
                </select>
              </div>

              <div class="f1-form-group f1-col-full">
                <fieldset class="f1-form-group mpx-fieldset mp-ai-fieldset" style="border:1px solid #333;border-radius:8px;padding:12px 16px;margin:0">
                  <legend class="f1-label" style="padding:0 6px;font-weight:700">🤖 AI Opponents</legend>
                  <label class="f1-checkbox-label mpx-check" style="margin-bottom:8px">
                    <input type="checkbox" id="mpAiFill" />
                    <span>Fill empty grid slots with AI opponents</span>
                  </label>
                  <div id="mpAiOptions" style="display:none;margin-top:10px;padding-top:10px;border-top:1px solid #282828">
                    <div class="f1-form-group f1-col-half" style="margin:0">
                      <label for="mpAiDifficulty" class="f1-label">AI Difficulty</label>
                      <select id="mpAiDifficulty" class="f1-select">
                        <option value="easy">🟢 Easy — Rookie</option>
                        <option value="balanced" selected>🟡 Balanced — Challenger</option>
                        <option value="hard">🔴 Hard — Pro</option>
                        <option value="elite">⚫ Elite — World Champion</option>
                      </select>
                    </div>
                    <p class="f1-hint" id="mpAiCountHint" style="margin-top:6px">AI cars will fill the remaining slots to complete the grid.</p>
                  </div>
                </fieldset>
              </div>

              <div id="mpCreateError" class="f1-alert f1-alert-danger" role="alert" style="display:none"></div>
            </form>
          </div>

          <div class="f1-wizard-footer mpx-sticky-footer">
            <button type="button" class="f1-btn-ghost" id="btnMpCreateCancel">CANCEL</button>
            <button type="button" class="f1-btn-primary" id="btnMpCreateSubmit">CREATE &amp; OPEN WAITING ROOM</button>
          </div>
        </div>
      </div>
    `;

    const errBox = container.querySelector('#mpCreateError');
    const heading = container.querySelector('#mpModalHeading');
    const lblCustom = container.querySelector('#lblTypeCustom');
    const lblPublic = container.querySelector('#lblTypePublic');

    container.querySelectorAll('input[name="mpRoomType"]').forEach(r => {
      r.addEventListener('change', () => {
        const isPublic = container.querySelector('input[name="mpRoomType"]:checked')?.value === 'public';
        lblPublic?.classList.toggle('active', isPublic);
        lblCustom?.classList.toggle('active', !isPublic);
        if (heading) heading.textContent = isPublic ? 'CREATE PUBLIC ROOM' : 'CREATE CUSTOM ROOM';
      });
    });

    // AI toggle: show/hide difficulty + update count hint
    const aiFillChk = container.querySelector('#mpAiFill');
    const aiOptions = container.querySelector('#mpAiOptions');
    const aiCountHint = container.querySelector('#mpAiCountHint');
    const maxPlayersEl = container.querySelector('#mpMaxPlayers');

    const updateAiHint = () => {
      if (!aiCountHint || !maxPlayersEl) return;
      const maxP = parseInt(maxPlayersEl.value, 10) || 20;
      const aiSlots = Math.max(0, 20 - maxP);
      aiCountHint.textContent = aiSlots > 0
        ? `Up to ${aiSlots} AI car${aiSlots > 1 ? 's' : ''} will fill the grid (${maxP} human slots + ${aiSlots} AI = 20 total).`
        : 'Grid is set to 20 human players — no AI slots will be added.';
    };

    aiFillChk?.addEventListener('change', () => {
      const on = !!aiFillChk.checked;
      if (aiOptions) aiOptions.style.display = on ? 'block' : 'none';
      updateAiHint();
    });
    maxPlayersEl?.addEventListener('change', updateAiHint);
    updateAiHint();

    let busy = false;
    const submit = async () => {
      if (busy) return;
      const hostInput = container.querySelector('#mpHostName');
      const hostName = (hostInput?.value || '').trim();
      if (!hostName) {
        showError(errBox, 'Please enter your display name for this room.');
        hostInput?.focus();
        return;
      }
      hideError(errBox);

      const aiFillEnabled = !!container.querySelector('#mpAiFill')?.checked;
      const aiDifficulty = container.querySelector('#mpAiDifficulty')?.value || 'balanced';
      const driverPolicy = container.querySelector('#mpDriverPolicy')?.value || 'unique';
      const payload = {
        roomType: container.querySelector('input[name="mpRoomType"]:checked')?.value || 'custom',
        hostName,
        roomName: (container.querySelector('#mpRoomName')?.value || '').trim(),
        maxPlayers: parseInt(container.querySelector('#mpMaxPlayers')?.value, 10) || 20,
        circuitId: container.querySelector('#mpCircuit')?.value || 'silverstone',
        laps: parseInt(container.querySelector('#mpLaps')?.value, 10) || 5,
        includeQualifying: container.querySelector('#mpQualifying')?.value === 'true',
        weather: container.querySelector('#mpWeather')?.value || 'clear',
        duplicatePolicy: {
          drivers: driverPolicy,
          cars: driverPolicy === 'unique' ? 'unique' : 'allow',
          managers: driverPolicy === 'unique' ? 'unique' : 'allow'
        },
        aiParticipation: {
          enabled: aiFillEnabled,
          fillToMax: aiFillEnabled,
          difficulty: aiDifficulty
        }
      };

      busy = true;
      saveName(hostName);
      try {
        await onSubmit?.(payload);
      } catch (err) {
        showError(errBox, err?.message || 'Could not create the room.');
      } finally {
        busy = false;
      }
    };

    // Enter key inside the form must NOT reload the page
    container.querySelector('#formMpCreate')?.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
    container.querySelector('#btnMpCreateSubmit')?.addEventListener('click', submit);
    container.querySelector('#btnMpCreateBack')?.addEventListener('click', onCancel);
    container.querySelector('#btnMpCreateClose')?.addEventListener('click', onCancel);
    container.querySelector('#btnMpCreateCancel')?.addEventListener('click', onCancel);
    bindEscape(container, onCancel);
    focusFirst(container, '#mpHostName');
  }

  // ── 4. Direct join modal (public room) ─────────────────────────────────────

  static renderDirectJoinModal(container, { room, onJoin, onCancel }) {
    resetContainer(container);

    container.innerHTML = `
      <div class="f1-modal-backdrop">
        <div class="f1-wizard-card mp-join-modal-card mpx-screen mpx-modal" role="dialog" aria-modal="true" aria-labelledby="mpDirectTitle">
          <div class="f1-wizard-header">
            <div class="f1-wizard-nav">
              <button type="button" class="f1-btn-ghost btn-modal-back" id="btnDirectBack">← BACK</button>
              <span class="f1-badge-red">JOIN</span>
              <h2 class="qr-step-title" id="mpDirectTitle">JOIN RACE</h2>
            </div>
            <button type="button" class="f1-btn-close btn-modal-close" id="btnDirectClose" aria-label="Close">&times;</button>
          </div>

          <div class="f1-wizard-content mpx-modal-body">
            <div class="mp-join-header-text">
              <h3>${escapeHtml(room.roomName)}</h3>
              <p>👑 <strong>${escapeHtml(room.hostDisplayName || 'Host')}</strong> · 🏁 <strong>${escapeHtml(room.circuitName)}</strong> · 🔄 <strong>${room.laps} laps</strong></p>
            </div>

            <form id="formDirectJoin" class="mp-form-vertical" novalidate>
              <div class="f1-form-group">
                <label for="mpDirectPlayerName" class="f1-label">Your Name for This Room <span class="f1-required" aria-hidden="true">*</span></label>
                <input type="text" id="mpDirectPlayerName" class="f1-input mp-input-name-lg" required maxlength="20"
                       autocomplete="nickname" enterkeyhint="go" placeholder="e.g. ApexHunter" value="${escapeHtml(getSavedName())}" />
                <span class="f1-hint">Shown in the lobby, timing tower and results.</span>
              </div>
              <div id="mpDirectJoinError" class="f1-alert f1-alert-danger" role="alert" style="display:none"></div>
            </form>
          </div>

          <div class="f1-wizard-footer mpx-sticky-footer">
            <button type="button" class="f1-btn-ghost" id="btnDirectCancel">CANCEL</button>
            <button type="button" class="f1-btn-primary" id="btnDirectSubmit">JOIN RACE</button>
          </div>
        </div>
      </div>
    `;

    const errBox = container.querySelector('#mpDirectJoinError');
    const input = container.querySelector('#mpDirectPlayerName');
    const btn = container.querySelector('#btnDirectSubmit');

    let busy = false;
    const submit = async () => {
      if (busy) return;
      const name = (input?.value || '').trim();
      if (!name) {
        showError(errBox, 'Please enter your display name for this room.');
        input?.focus();
        return;
      }
      hideError(errBox);
      busy = true;
      if (btn) { btn.disabled = true; btn.textContent = 'JOINING…'; }
      try {
        await onJoin?.({ roomId: room.roomId, displayName: name });
      } catch (err) {
        showError(errBox, err?.message || 'Could not join the room.');
      } finally {
        busy = false;
        if (btn?.isConnected) { btn.disabled = false; btn.textContent = 'JOIN RACE'; }
      }
    };

    container.querySelector('#formDirectJoin')?.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
    btn?.addEventListener('click', submit);
    container.querySelector('#btnDirectBack')?.addEventListener('click', onCancel);
    container.querySelector('#btnDirectClose')?.addEventListener('click', onCancel);
    container.querySelector('#btnDirectCancel')?.addEventListener('click', onCancel);
    bindEscape(container, onCancel);
    focusFirst(container, '#mpDirectPlayerName');
  }

  // ── 5. Join by code (private room) ─────────────────────────────────────────

  static renderJoinModal(container, { prefillCode, onJoin, onCancel }) {
    resetContainer(container);

    container.innerHTML = `
      <div class="f1-modal-backdrop">
        <div class="f1-wizard-card mp-join-modal-card mpx-screen mpx-modal" role="dialog" aria-modal="true" aria-labelledby="mpJoinTitle">
          <div class="f1-wizard-header">
            <div class="f1-wizard-nav">
              <button type="button" class="f1-btn-ghost btn-modal-back" id="btnMpJoinBack">← BACK</button>
              <span class="f1-badge-red">PRIVATE</span>
              <h2 class="qr-step-title" id="mpJoinTitle">JOIN PRIVATE ROOM</h2>
            </div>
            <button type="button" class="f1-btn-close btn-modal-close" id="btnMpJoinClose" aria-label="Close">&times;</button>
          </div>

          <div class="f1-wizard-content mpx-modal-body">
            <div class="mp-join-header-text">
              <h3>JOIN WITH INVITATION CODE</h3>
              <p>Enter the code from your host and pick the name you want to race under.</p>
            </div>

            <form id="formMpJoin" class="mp-form-vertical" novalidate>
              <div class="f1-form-group">
                <label for="mpJoinRoomId" class="f1-label">Invitation Code <span class="f1-required" aria-hidden="true">*</span></label>
                <input type="text" id="mpJoinRoomId" class="f1-input mp-input-code-lg mpx-upper" required
                       placeholder="RACE-7K4P" value="${escapeHtml(prefillCode || '')}" spellcheck="false"
                       autocomplete="off" autocapitalize="characters" autocorrect="off" enterkeyhint="next" />
              </div>
              <div class="f1-form-group">
                <label for="mpJoinPlayerName" class="f1-label">Your Name for This Room <span class="f1-required" aria-hidden="true">*</span></label>
                <input type="text" id="mpJoinPlayerName" class="f1-input" required maxlength="20"
                       autocomplete="nickname" enterkeyhint="go" placeholder="e.g. Racer007" value="${escapeHtml(getSavedName())}" />
                <span class="f1-hint">Specific to this room.</span>
              </div>
              <div id="mpJoinError" class="f1-alert f1-alert-danger" role="alert" style="display:none"></div>
            </form>
          </div>

          <div class="f1-wizard-footer mpx-sticky-footer">
            <button type="button" class="f1-btn-ghost" id="btnMpJoinCancel">CANCEL</button>
            <button type="button" class="f1-btn-primary" id="btnMpJoinSubmit">JOIN ROOM</button>
          </div>
        </div>
      </div>
    `;

    const errBox = container.querySelector('#mpJoinError');
    let busy = false;
    const submit = async () => {
      if (busy) return;
      const codeInput = container.querySelector('#mpJoinRoomId');
      const nameInput = container.querySelector('#mpJoinPlayerName');
      const roomId = normalizeRoomCode(codeInput?.value);
      const name = (nameInput?.value || '').trim();
      if (!roomId) { showError(errBox, 'Please enter a room code.'); codeInput?.focus(); return; }
      if (!name) { showError(errBox, 'Please enter your display name for this room.'); nameInput?.focus(); return; }
      hideError(errBox);
      busy = true;
      saveName(name);
      try {
        await onJoin?.({ roomId, displayName: name });
      } catch (err) {
        showError(errBox, err?.message || 'Could not join the room.');
      } finally {
        busy = false;
      }
    };

    container.querySelector('#formMpJoin')?.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
    container.querySelector('#btnMpJoinSubmit')?.addEventListener('click', submit);
    container.querySelector('#btnMpJoinBack')?.addEventListener('click', onCancel);
    container.querySelector('#btnMpJoinClose')?.addEventListener('click', onCancel);
    container.querySelector('#btnMpJoinCancel')?.addEventListener('click', onCancel);
    bindEscape(container, onCancel);
    focusFirst(container, prefillCode ? '#mpJoinPlayerName' : '#mpJoinRoomId');
  }

  // ── 6. Waiting room ────────────────────────────────────────────────────────

  static renderWaitingRoom(container, { room, myParticipant, onToggleReady, onStartRace, onLeaveRoom }) {
    // Preserve scroll position across live re-renders
    const prevScroll = container.querySelector('.mpx-scroll')?.scrollTop || 0;
    resetContainer(container);

    const isHost = !!myParticipant?.isHost;
    const connectedCount = room.connectedPlayersCount || 1;
    const maxPlayers = room.maxPlayers || 20;
    const readyCount = room.readyPlayersCount || 0;
    const readyPct = connectedCount ? Math.round((readyCount / connectedCount) * 100) : 0;
    const canStart = !!room.canStartRace;
    const startReason = room.startBlockReason || '';
    const isPublic = room.roomType === 'public';
    const hostName = room.participants?.find(p => p.isHost)?.displayName || 'Host';
    const slots = room.slots || [];
    const occupied = slots.filter(s => s.occupied);
    const open = slots.filter(s => !s.occupied);
    const iAmReady = !!myParticipant?.ready;
    const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

    container.innerHTML = `
      <div class="f1-modal-backdrop mp-lobby-backdrop">
        <main class="f1-menu-card f1-card-wide mp-lobby-card mpx-screen mpx-lobby" aria-labelledby="mpLobbyTitle">
          <header class="mp-lobby-header">
            <div class="mp-lobby-top-nav">
              <button type="button" class="f1-btn-ghost btn-modal-back" id="btnMpLobbyBack">← LEAVE ROOM</button>
              <span class="mp-room-capacity-pill">PLAYERS <strong>${connectedCount}/${maxPlayers}</strong></span>
              <button type="button" class="f1-btn-close btn-modal-close" id="btnMpLobbyClose" aria-label="Close">&times;</button>
            </div>

            <h1 class="mpx-lobby-title" id="mpLobbyTitle">${escapeHtml(room.roomName)}</h1>

            <div class="mp-room-badge-group">
              <span class="f1-badge-red">${isPublic ? '🌐 PUBLIC' : '🔒 PRIVATE'}</span>
              ${!isPublic ? `
                <button type="button" class="mp-room-id-pill" id="btnCopyRoomId" title="Copy room code">
                  CODE <strong>${escapeHtml(room.roomId)}</strong> 📋
                </button>
                <button type="button" class="f1-btn-ghost mp-btn-copy-link" id="btnCopyInviteLink">🔗 COPY LINK</button>
                ${canShare ? '<button type="button" class="f1-btn-ghost mp-btn-copy-link" id="btnShareInvite">📤 SHARE</button>' : ''}
              ` : '<span class="mp-public-badge-pill">OPEN MATCHMAKING</span>'}
              <span class="mp-room-status-badge ${canStart ? 'status-ready' : 'status-waiting'}">
                ${canStart ? 'READY FOR LAUNCH' : 'WAITING FOR PLAYERS'}
              </span>
            </div>

            <div class="mp-room-meta-strip">
              <span class="mp-meta-item">🏁 <strong>${escapeHtml(room.circuitName)}</strong></span>
              <span class="mp-meta-item">🔄 <strong>${room.laps} laps</strong></span>
              <span class="mp-meta-item">${room.includeQualifying ? '⚡ <strong>Qualifying</strong>' : '🏁 <strong>Direct grid</strong>'}</span>
              <span class="mp-meta-item">⛅ <strong>${escapeHtml(String(room.weather || 'clear').replace(/_/g, ' '))}</strong></span>
              <span class="mp-meta-item">🛡️ <strong>${room.duplicatePolicy?.drivers === 'unique' ? 'Unique drivers' : 'Duplicates OK'}</strong></span>
              <span class="mp-meta-item">👑 <strong>${escapeHtml(hostName)}</strong></span>
              <span class="mp-meta-item">⚡ <strong>2× Speed</strong></span>
              ${room.aiParticipation?.fillToMax
                ? `<span class="mp-meta-item mp-meta-ai">🤖 <strong>AI filling grid</strong></span>`
                : `<span class="mp-meta-item mp-meta-no-ai">🚫 <strong>No AI opponents</strong></span>`}
            </div>
          </header>

          <div class="mp-table-container mpx-scroll">
            <table class="mp-participant-table mpx-table mpx-lobby-table">
              <caption class="mpx-sr-only">Players in this room</caption>
              <thead>
                <tr>
                  <th scope="col" style="width:70px">SLOT</th>
                  <th scope="col">PLAYER</th>
                  <th scope="col" style="width:150px">STATUS</th>
                </tr>
              </thead>
              <tbody>
                ${occupied.map(s => {
                  const isMe = s.participantId === myParticipant?.participantId;
                  const online = s.connectionStatus === 'connected';
                  return `
                    <tr class="mp-row-occupied ${isMe ? 'mp-row-me' : ''}">
                      <td class="mp-cell-slot" data-label="Slot"><strong>${pad2(s.slotNumber)}</strong></td>
                      <td class="mp-cell-name" data-label="Player">
                        <span class="mp-player-avatar" aria-hidden="true">${s.isHost ? '👑' : '🏎️'}</span>
                        <strong class="mp-name-text">${escapeHtml(s.displayName)}</strong>
                        ${isMe ? '<span class="mp-tag-you">YOU</span>' : ''}
                        ${s.isHost ? '<span class="mp-tag-host">HOST</span>' : ''}
                      </td>
                      <td class="mp-cell-status" data-label="Status">
                        <span class="mp-conn-dot ${online ? 'conn-online' : 'conn-offline'}" title="${online ? 'Connected' : 'Disconnected'}"></span>
                        ${!online
                          ? '<span class="mp-badge-unready">OFFLINE</span>'
                          : (s.ready ? '<span class="mp-badge-ready">READY</span>' : '<span class="mp-badge-unready">NOT READY</span>')}
                      </td>
                    </tr>`;
                }).join('')}
              </tbody>
            </table>

            ${open.length ? `
              <div class="mpx-open-slots" aria-label="${open.length} open slots">
                <span class="mpx-open-label">${open.length} OPEN SLOT${open.length > 1 ? 'S' : ''}</span>
                <span class="mpx-open-chips">${open.map(s => `<span class="mpx-slot-chip">${pad2(s.slotNumber)}</span>`).join('')}</span>
              </div>` : ''}
          </div>

          <div class="mp-lobby-readiness-bar">
            <div class="mpx-ready-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${readyPct}" aria-label="Players ready">
              <div class="mpx-ready-fill" style="width:${readyPct}%"></div>
            </div>
            <div class="mp-readiness-stats" aria-live="polite">
              <span class="mp-stat-pill">READY <strong>${readyCount}/${connectedCount}</strong></span>
              ${!canStart && startReason ? `<span class="mp-reason-pill">⚠️ ${escapeHtml(startReason)}</span>` : ''}
              ${canStart ? '<span class="mp-reason-pill mp-reason-ok">✅ All set — host can start.</span>' : ''}
            </div>
          </div>

          <footer class="mp-lobby-footer mpx-sticky-footer">
            <button type="button" class="f1-btn-ghost mpx-leave-btn" id="btnMpLeave">LEAVE</button>
            <div class="mp-footer-actions-right">
              <button type="button" class="f1-btn ${iAmReady ? 'f1-btn-amber' : 'f1-btn-primary'} mp-btn-ready" id="btnMpToggleReady" aria-pressed="${iAmReady}">
                ${iAmReady ? 'CANCEL READY' : 'READY UP'}
              </button>
              ${isHost ? `
                <button type="button" class="f1-btn-primary mp-btn-start" id="btnMpStartRace" ${canStart ? '' : 'disabled'}>
                  🚀 START RACE
                </button>
              ` : `
                <div class="mp-waiting-host-note">Waiting for <strong>${escapeHtml(hostName)}</strong> to launch…</div>
              `}
            </div>
          </footer>
        </main>
      </div>
    `;

    const scrollEl = container.querySelector('.mpx-scroll');
    if (scrollEl && prevScroll) scrollEl.scrollTop = prevScroll;

    // Copy / share
    const flash = (btn, okHtml, resetHtml, ok) => {
      btn.innerHTML = ok ? okHtml : 'COPY FAILED';
      setTimeout(() => { if (btn.isConnected) btn.innerHTML = resetHtml; }, 1800);
    };
    const btnCopy = container.querySelector('#btnCopyRoomId');
    btnCopy?.addEventListener('click', async () => {
      const ok = await copyText(room.roomId);
      flash(btnCopy, `CODE <strong>${escapeHtml(room.roomId)}</strong> COPIED ✅`, `CODE <strong>${escapeHtml(room.roomId)}</strong> 📋`, ok);
    });
    const btnLink = container.querySelector('#btnCopyInviteLink');
    btnLink?.addEventListener('click', async () => {
      const ok = await copyText(inviteLink(room.roomId));
      flash(btnLink, 'LINK COPIED ✅', '🔗 COPY LINK', ok);
    });
    container.querySelector('#btnShareInvite')?.addEventListener('click', async () => {
      try {
        await navigator.share({
          title: `Join my race: ${room.roomName}`,
          text: `Join my F1 race! Room code: ${room.roomId}`,
          url: inviteLink(room.roomId)
        });
      } catch (_) { /* user cancelled */ }
    });

    container.querySelector('#btnMpLobbyBack')?.addEventListener('click', onLeaveRoom);
    container.querySelector('#btnMpLobbyClose')?.addEventListener('click', onLeaveRoom);
    container.querySelector('#btnMpLeave')?.addEventListener('click', onLeaveRoom);

    const readyBtn = container.querySelector('#btnMpToggleReady');
    readyBtn?.addEventListener('click', async () => {
      if (readyBtn.disabled) return;
      readyBtn.disabled = true;
      try { await onToggleReady?.(!iAmReady); }
      finally { if (readyBtn.isConnected) readyBtn.disabled = false; }
    });

    const startBtn = container.querySelector('#btnMpStartRace');
    startBtn?.addEventListener('click', async () => {
      if (startBtn.disabled) return;
      startBtn.disabled = true;
      startBtn.textContent = 'STARTING…';
      try { await onStartRace?.(); }
      finally {
        if (startBtn.isConnected) {
          startBtn.disabled = !canStart;
          startBtn.textContent = '🚀 START RACE';
        }
      }
    });
  }

  // ── 7. Roulette ────────────────────────────────────────────────────────────

  static renderRouletteScreen(container, { phase, outcomes, currentParticipantIndex = 0, durationMs = 4000, onBackToLobby }) {
    resetContainer(container);

    const participants = Object.values(outcomes?.participants || {});
    const curP = participants[currentParticipantIndex] || participants[0];
    if (!curP) {
      container.innerHTML = '<div class="f1-modal-backdrop"><div class="f1-menu-card mpx-screen"><p class="mpx-center">Preparing selections…</p></div></div>';
      return;
    }

    const steps = ['driver_roulette', 'car_roulette', 'manager_roulette'];
    const stepIdx = Math.max(0, steps.indexOf(phase));
    let phaseTitle = 'DRIVER ROULETTE';
    let finalName = '';
    let cardContent = '';

    if (phase === 'car_roulette') {
      phaseTitle = 'CAR ROULETTE';
      finalName = curP.car?.name || '';
      cardContent = `
        <div class="mp-roulette-card-center car-card">
          <div class="mp-card-team-strip" style="background:${escapeHtml(curP.car?.primaryColor || '#00d2be')}"></div>
          <div class="mp-card-avatar" aria-hidden="true">🏁</div>
          <h2 class="mp-card-name">${escapeHtml((curP.car?.name || '').toUpperCase())}</h2>
          <div class="mp-card-team">${escapeHtml((curP.car?.team || '').toUpperCase())}</div>
          <div class="mp-card-stats-grid">
            <div class="mp-c-stat"><span>TOP SPEED</span><strong>${escapeHtml(curP.car?.stats?.topSpeedKmh ?? 340)} km/h</strong></div>
            <div class="mp-c-stat"><span>DOWNFORCE</span><strong>${escapeHtml(curP.car?.stats?.downforce ?? 88)}</strong></div>
            <div class="mp-c-stat"><span>BRAKING</span><strong>${escapeHtml(curP.car?.stats?.braking ?? 90)}</strong></div>
          </div>
        </div>`;
    } else if (phase === 'manager_roulette') {
      phaseTitle = 'MANAGER ROULETTE';
      finalName = curP.manager?.name || '';
      cardContent = `
        <div class="mp-roulette-card-center manager-card">
          <div class="mp-card-team-strip" style="background:#ff8000"></div>
          <div class="mp-card-avatar" aria-hidden="true">👨‍💼</div>
          <h2 class="mp-card-name">${escapeHtml((curP.manager?.name || '').toUpperCase())}</h2>
          <div class="mp-card-team">${escapeHtml((curP.manager?.team || '').toUpperCase())}</div>
          <div class="mp-card-perk">Tactical modifiers active</div>
        </div>`;
    } else {
      finalName = curP.driver?.name || '';
      cardContent = `
        <div class="mp-roulette-card-center driver-card">
          <div class="mp-card-team-strip" style="background:${escapeHtml(curP.driver?.color || '#e10600')}"></div>
          <div class="mp-card-number">#${escapeHtml(curP.driver?.number ?? '01')}</div>
          <div class="mp-card-avatar" aria-hidden="true">🏎️</div>
          <h2 class="mp-card-name">${escapeHtml((curP.driver?.name || '').toUpperCase())}</h2>
          <div class="mp-card-team">${escapeHtml((curP.driver?.team || '').toUpperCase())}</div>
          <div class="mp-card-stats-grid">
            <div class="mp-c-stat"><span>SKILL</span><strong>${escapeHtml(curP.driver?.skill ?? 90)}</strong></div>
            <div class="mp-c-stat"><span>AGGRESSION</span><strong>${escapeHtml(curP.driver?.aggression ?? 80)}</strong></div>
            <div class="mp-c-stat"><span>TYRES</span><strong>${escapeHtml(curP.driver?.tyreManagement ?? 85)}</strong></div>
          </div>
        </div>`;
    }

    container.innerHTML = `
      <div class="f1-modal-backdrop mp-roulette-backdrop">
        <main class="f1-menu-card f1-card-wide mp-roulette-card mpx-screen">
          <div class="mp-modal-top-nav">
            <button type="button" class="f1-btn-ghost btn-modal-back" id="btnMpRouletteBack">← LOBBY</button>
            <button type="button" class="f1-btn-close btn-modal-close" id="btnMpRouletteClose" aria-label="Close">&times;</button>
          </div>

          <header class="mp-roulette-header">
            <ol class="mpx-steps" aria-label="Selection progress">
              ${steps.map((_, i) => `<li class="mpx-step ${i < stepIdx ? 'done' : ''} ${i === stepIdx ? 'current' : ''}" aria-current="${i === stepIdx ? 'step' : 'false'}">${i + 1}</li>`).join('')}
            </ol>
            <h1 class="mp-roulette-title">${phaseTitle}</h1>
            <div class="mp-roulette-sub">
              FOR <strong class="mp-current-player-tag">${escapeHtml(curP.displayName)} · SLOT ${pad2(curP.slotNumber)}</strong>
            </div>
          </header>

          <div class="mp-roulette-stage">
            <div class="mpx-reel" id="mpReel">
              <div class="mpx-reel-ticker" id="mpReelTicker" aria-hidden="true"></div>
              <div class="mpx-reel-result" aria-live="polite">${cardContent}</div>
            </div>
          </div>

          <div class="mp-roulette-roster-strip">
            <span class="mp-roster-status-text">Assigning ${participants.length} player${participants.length === 1 ? '' : 's'}…</span>
          </div>
        </main>
      </div>
    `;

    container.querySelector('#btnMpRouletteBack')?.addEventListener('click', () => onBackToLobby?.());
    container.querySelector('#btnMpRouletteClose')?.addEventListener('click', () => onBackToLobby?.());

    // Spin the reel, then reveal the server-decided result
    const reel = container.querySelector('#mpReel');
    const ticker = container.querySelector('#mpReelTicker');
    const names = (arr, f) => (Array.isArray(arr) ? arr : []).map(f).filter(Boolean);
    let pool = phase === 'car_roulette' ? names(CARS, c => c.name)
      : phase === 'manager_roulette' ? names(MANAGERS, m => m.name)
      : names(DRIVERS, d => d.name);
    if (!pool.length) pool = [finalName || '…'];

    if (prefersReducedMotion() || !ticker) {
      reel?.classList.add('is-revealed');
    } else {
      let i = Math.floor(Math.random() * pool.length);
      ticker.textContent = pool[i];
      container._reelTimer = setInterval(() => {
        i = (i + 1 + Math.floor(Math.random() * 3)) % pool.length;
        ticker.textContent = pool[i];
      }, 90);
      container._reelTimeout = setTimeout(() => {
        clearInterval(container._reelTimer);
        container._reelTimer = null;
        reel?.classList.add('is-revealed');
      }, Math.max(600, Math.round(durationMs * 0.75)));
    }
  }

  // ── 8. Selection confirmation ──────────────────────────────────────────────

  static renderSelectionConfirmation(container, { roster = [], reviewDurationMs = 3500, myParticipantId, onBackToLobby }) {
    resetContainer(container);
    let remaining = Math.max(1, Math.ceil(reviewDurationMs / 1000));

    container.innerHTML = `
      <div class="f1-modal-backdrop mp-confirm-backdrop">
        <main class="f1-menu-card f1-card-wide mp-confirm-card mpx-screen">
          <div class="mp-modal-top-nav">
            <button type="button" class="f1-btn-ghost btn-modal-back" id="btnMpConfirmBack">← LOBBY</button>
            <button type="button" class="f1-btn-close btn-modal-close" id="btnMpConfirmClose" aria-label="Close">&times;</button>
          </div>

          <header class="mp-confirm-header">
            <span class="f1-badge-red">CONFIRMED ROSTER</span>
            <h1 class="mp-confirm-title">STARTING GRID</h1>
            <p class="mp-confirm-sub">Server-assigned driver, car and manager for every entry.</p>
          </header>

          <div class="mp-table-container mpx-scroll">
            <table class="mp-participant-table mpx-table">
              <caption class="mpx-sr-only">Confirmed starting roster</caption>
              <thead>
                <tr>
                  <th scope="col" style="width:70px">SLOT</th>
                  <th scope="col">PLAYER</th>
                  <th scope="col">DRIVER</th>
                  <th scope="col">CAR</th>
                  <th scope="col">MANAGER</th>
                </tr>
              </thead>
              <tbody>
                ${roster.map(r => {
                  const isMe = myParticipantId && r.participantId === myParticipantId;
                  return `
                    <tr class="${isMe ? 'mp-row-me' : ''}">
                      <td class="mp-cell-slot" data-label="Slot"><strong>${pad2(r.slotNumber)}</strong></td>
                      <td class="mp-cell-name" data-label="Player">
                        <strong class="mp-name-text">${escapeHtml(r.displayName)}</strong>
                        ${isMe ? '<span class="mp-tag-you">YOU</span>' : ''}
                        ${r.isAI ? '<span class="mp-tag-ai">AI</span>' : ''}
                      </td>
                      <td class="mp-cell-driver" data-label="Driver">
                        <span class="mp-driver-color-dot" style="background:${escapeHtml(r.driver?.color || '#e10600')}"></span>
                        <strong>${escapeHtml(r.driver?.name)}</strong> <small>${escapeHtml(r.driver?.team)}</small>
                      </td>
                      <td class="mp-cell-car" data-label="Car">${escapeHtml(r.car?.name)}</td>
                      <td class="mp-cell-mgr" data-label="Manager">👨‍💼 ${escapeHtml(r.manager?.name)}</td>
                    </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>

          <div class="mp-confirm-footer">
            <div class="mp-grid-countdown" aria-live="polite">
              GRID FORMATION IN <strong id="mpConfirmCountdown">${remaining}</strong>s…
            </div>
          </div>
        </main>
      </div>
    `;

    container.querySelector('#btnMpConfirmBack')?.addEventListener('click', () => onBackToLobby?.());
    container.querySelector('#btnMpConfirmClose')?.addEventListener('click', () => onBackToLobby?.());

    const label = container.querySelector('#mpConfirmCountdown');
    container._countdownTimer = setInterval(() => {
      remaining = Math.max(0, remaining - 1);
      if (label) label.textContent = String(remaining);
      if (remaining <= 0) { clearInterval(container._countdownTimer); container._countdownTimer = null; }
    }, 1000);
  }

  // ── 9. Live timing tower (built once, rows patched ≤4×/sec) ────────────────

  static renderTimingTower(container, { cars, myParticipantId, currentLap, totalLaps }) {
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (container._towerAt && now - container._towerAt < 250) return;
    container._towerAt = now;

    // (Re)build the shell if it's missing (first call, or container was cleared)
    let panel = container.querySelector('#mpTowerPanel');
    if (!panel) {
      if (container.dataset.collapsed === undefined) {
        container.dataset.collapsed = isSmallScreen() ? 'true' : 'false';
      }
      container.innerHTML = `
        <div class="mpx-tower" id="mpTowerPanel">
          <button type="button" class="mpx-tower-head" id="btnToggleTower" aria-expanded="true" aria-controls="mpTowerList">
            <span class="mpx-tower-title" id="mpTowerTitle"></span>
            <span class="mpx-tower-chevron" aria-hidden="true">▾</span>
          </button>
          <div class="mpx-tower-list" id="mpTowerList" role="list"></div>
        </div>
      `;
      panel = container.querySelector('#mpTowerPanel');
      container.querySelector('#btnToggleTower').addEventListener('click', () => {
        container.dataset.collapsed = container.dataset.collapsed === 'true' ? 'false' : 'true';
        container._towerAt = 0; // refresh immediately
        container.querySelector('#btnToggleTower')?.setAttribute('aria-expanded', String(container.dataset.collapsed !== 'true'));
        panel.classList.toggle('tower-collapsed', container.dataset.collapsed === 'true');
      });
    }

    const collapsed = container.dataset.collapsed === 'true';
    panel.classList.toggle('tower-collapsed', collapsed);
    container.querySelector('#btnToggleTower')?.setAttribute('aria-expanded', String(!collapsed));

    const list = Array.isArray(cars) ? cars : Object.values(cars || {});
    const isMine = (c) => !!myParticipantId && (c.participantId === myParticipantId || c.id === myParticipantId) || c.isPlayer || c.isLocalPlayer;
    const rank = (c) => (c.finished ? 0 : (c.status === 'retired' ? 2 : 1));

    const sorted = [...list].sort((a, b) => {
      const ra = rank(a), rb = rank(b);
      if (ra !== rb) return ra - rb;
      if (ra === 0) return (a.finishPosition || 99) - (b.finishPosition || 99);
      if ((a.lap || 0) !== (b.lap || 0)) return (b.lap || 0) - (a.lap || 0);
      return (b.s || 0) - (a.s || 0);
    });

    const myIdx = sorted.findIndex(isMine);
    const title = container.querySelector('#mpTowerTitle');
    if (title) {
      title.textContent = collapsed
        ? `P${myIdx >= 0 ? myIdx + 1 : '–'}/${sorted.length} · LAP ${currentLap}/${totalLaps} · 2×`
        : `LIVE TIMING · LAP ${currentLap}/${totalLaps} · 2× SPEED`;
    }
    if (collapsed) return; // nothing else to draw while minimized

    const listEl = container.querySelector('#mpTowerList');
    if (!listEl) return;
    listEl.innerHTML = sorted.map((c, idx) => {
      const me = isMine(c);
      let status;
      if (c.finished) status = `🏁 P${c.finishPosition || idx + 1}`;
      else if (c.status === 'retired') status = 'OUT';
      else if (idx === 0) status = 'LEAD';
      else {
        const gap = typeof c.gapToLeaderSec === 'number' ? c.gapToLeaderSec
          : (typeof c.gapToLeader === 'number' ? c.gapToLeader : null);
        status = gap === null ? '—' : `+${gap.toFixed(2)}s`;
      }
      const name = c.displayName || c.driver?.name || c.name || `Car ${idx + 1}`;
      const code = c.driver?.code || c.code || 'DRV';
      const color = c.driver?.color || c.color || '#e10600';
      return `
        <div class="mpx-tower-row ${me ? 'row-me' : ''} ${c.finished ? 'row-finished' : ''}" role="listitem">
          <span class="mpx-t-pos">${idx + 1}</span>
          <span class="mpx-t-tag" style="border-left-color:${escapeHtml(color)}">${escapeHtml(code)}</span>
          <span class="mpx-t-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
          <span class="mpx-t-gap">${escapeHtml(status)}</span>
        </div>`;
    }).join('');

    // Keep the player's row in view on small screens
    const meEl = listEl.querySelector('.row-me');
    if (meEl && isSmallScreen()) meEl.scrollIntoView({ block: 'nearest' });
  }

  // ── 10. Final results ──────────────────────────────────────────────────────

  static renderFinalResults(container, { classification = [], isHost, myParticipantId, durationMs = 12000, returnAt, onReturnToLobby, onRematch, onReturnHub }) {
    resetContainer(container);

    const finishers = classification.filter(e => e.status === 'finished').sort((a, b) => a.position - b.position);
    const podium = finishers.slice(0, 3);

    const podiumCard = (entry, cls, rank, trophy, timeText) => entry ? `
      <div class="mp-podium-card ${cls}">
        <div class="mp-podium-rank">${rank}</div>
        <div class="mp-podium-trophy" aria-hidden="true">${trophy}</div>
        <div class="mp-podium-name">${escapeHtml(entry.displayName || 'Driver')}</div>
        <div class="mp-podium-driver">${escapeHtml(entry.driver?.name || '')}</div>
        <div class="mp-podium-time">${escapeHtml(timeText || '')}</div>
      </div>` : '';

    const winnerTime = podium[0]?.finishTime ? `WINNER · ${Number(podium[0].finishTime).toFixed(2)}s` : 'WINNER';
    const initialSeconds = returnAt ? Math.max(1, Math.round((returnAt - Date.now()) / 1000)) : Math.round(durationMs / 1000);

    container.innerHTML = `
      <div class="f1-modal-backdrop mp-results-backdrop">
        <main class="f1-menu-card f1-card-wide mp-results-card mpx-screen">
          <header class="mp-results-header">
            <div class="f1-menu-nav-row mp-results-nav-row">
              <button type="button" class="f1-btn-ghost btn-modal-back" id="btnMpResultsBack">← HUB</button>
              <span class="f1-badge-red">OFFICIAL CLASSIFICATION</span>
              <button type="button" class="f1-btn-close btn-modal-close" id="btnMpResultsClose" aria-label="Close">&times;</button>
            </div>
            <h1 class="mp-results-title">GRAND PRIX RESULTS</h1>
            <p class="mp-results-sub">Official FIA race classification for all 20 grid entries.</p>
            <div class="mp-results-countdown-banner" id="mpResultsCountdown">
              <span class="mp-countdown-icon">⏱️</span>
              <span>Returning to Waiting Room in <strong id="mpResultsTimer">${initialSeconds}</strong>s</span>
            </div>
          </header>

          ${podium.length >= 1 ? `
            <section class="mp-podium-showcase" aria-label="Podium">
              ${podium.length >= 2 ? podiumCard(podium[1], 'podium-p2', 2, '🥈', podium[1]?.gapToWinner || '') : ''}
              ${podiumCard(podium[0], 'podium-p1', 1, '🏆', winnerTime)}
              ${podium.length >= 3 ? podiumCard(podium[2], 'podium-p3', 3, '🥉', podium[2]?.gapToWinner || '') : ''}
            </section>` : ''}

          <div class="mp-table-container mpx-scroll">
            <table class="mp-participant-table mp-results-table mpx-table">
              <caption class="mpx-sr-only">Final classification</caption>
              <thead>
                <tr>
                  <th scope="col" style="width:60px">POS</th>
                  <th scope="col">PLAYER</th>
                  <th scope="col">DRIVER</th>
                  <th scope="col">CAR</th>
                  <th scope="col" style="width:110px">STATUS</th>
                  <th scope="col" style="width:70px">LAPS</th>
                  <th scope="col" style="width:120px">TIME / GAP</th>
                  <th scope="col" style="width:110px">FASTEST LAP</th>
                  <th scope="col" style="width:80px">PENALTY</th>
                </tr>
              </thead>
              <tbody>
                ${classification.map(entry => {
                  const finished = entry.status === 'finished';
                  const isWinner = finished && entry.position === 1;
                  const isMe = myParticipantId && entry.participantId === myParticipantId;
                  const bestLapDisplay = (entry.bestLapTime && typeof entry.bestLapTime === 'number' && entry.bestLapTime > 0)
                    ? `${Number(entry.bestLapTime).toFixed(3)}s`
                    : '—';
                  const penaltyDisplay = (entry.penalties && entry.penalties > 0)
                    ? `+${entry.penalties}s`
                    : '—';

                  let statusBadge = '<span class="mp-badge-finished">FINISHED</span>';
                  if (entry.status === 'retired') statusBadge = '<span class="mp-badge-unready">RETIRED</span>';
                  else if (entry.status === 'dnf') statusBadge = '<span class="mp-badge-unready">DNF</span>';
                  else if (entry.status === 'dns') statusBadge = '<span class="mp-badge-unready">DNS</span>';
                  else if (entry.status === 'disconnected_classified') statusBadge = '<span class="mp-badge-unready">DISC</span>';
                  else if (!finished) statusBadge = '<span class="mp-badge-unready">CLASSIFIED</span>';

                  return `
                    <tr class="${isWinner ? 'mp-row-winner' : ''} ${isMe ? 'mp-row-me' : ''}">
                      <td class="mp-cell-pos" data-label="Pos">${finished ? `${isWinner ? '🏆 ' : ''}<strong>${entry.position}</strong>` : `<strong>${entry.position || '—'}</strong>`}</td>
                      <td class="mp-cell-name" data-label="Player">
                        <strong class="mp-player-result-name">${escapeHtml(entry.displayName || 'Driver')}</strong>
                        ${isMe ? '<span class="mp-tag-you">YOU</span>' : ''}
                        ${entry.isAI ? '<span class="mp-tag-ai">AI</span>' : ''}
                      </td>
                      <td class="mp-cell-driver" data-label="Driver">
                        <span class="mp-driver-color-dot" style="background:${escapeHtml(entry.driver?.color || '#e10600')}"></span>
                        <strong>${escapeHtml(entry.driver?.name || 'Driver')}</strong>
                      </td>
                      <td class="mp-cell-car" data-label="Car">${escapeHtml(entry.car?.name || 'Formula 1 Car')}</td>
                      <td class="mp-cell-status" data-label="Status">${statusBadge}</td>
                      <td class="mp-cell-laps" data-label="Laps">${escapeHtml(`${entry.lapsCompleted ?? 0}/${entry.totalLaps ?? 5}`)}</td>
                      <td class="mp-cell-time" data-label="Time / Gap"><strong>${escapeHtml(entry.gapToWinner || '—')}</strong></td>
                      <td class="mp-cell-fl" data-label="Fastest Lap">
                        ${entry.isFastestLap
                          ? `<span class="mp-badge-fastest-lap" title="Fastest Lap of the Race">🟣 ${bestLapDisplay}</span>`
                          : bestLapDisplay}
                      </td>
                      <td class="mp-cell-penalty" data-label="Penalty">${penaltyDisplay}</td>
                    </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>

          <footer class="mp-results-footer mpx-sticky-footer">
            <button type="button" class="f1-btn-ghost" id="btnMpResultsExit">← LEAVE ROOM</button>
            <button type="button" class="f1-btn-primary mp-btn-rematch" id="btnMpRematch">🔄 CONTINUE TO WAITING ROOM</button>
          </footer>
        </main>
      </div>
    `;

    container.querySelector('#btnMpResultsBack')?.addEventListener('click', () => onReturnHub?.());
    container.querySelector('#btnMpResultsClose')?.addEventListener('click', () => onReturnHub?.());
    container.querySelector('#btnMpResultsExit')?.addEventListener('click', () => onReturnHub?.());
    const rematchBtn = container.querySelector('#btnMpRematch');
    rematchBtn?.addEventListener('click', async () => {
      if (rematchBtn.disabled) return;
      rematchBtn.disabled = true;
      try {
        if (onReturnToLobby) await onReturnToLobby();
        else if (onRematch) await onRematch();
      } finally {
        if (rematchBtn.isConnected) rematchBtn.disabled = false;
      }
    });
  }
}