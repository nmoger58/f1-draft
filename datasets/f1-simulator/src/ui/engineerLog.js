/**
 * engineerLog.js
 * Race-engineer message panel — shows real AI decisions as concise messages.
 * Messages are sourced from:
 *   - driverAgent.decide() return values (actual decision states)
 *   - raceEngine.step() events (pit stops, laps, overtakes)
 *   - raceState flags (yellow, safety car, finish)
 */

import { SimConfig } from '../config/simulationConfig.js';

const MAX_MSGS = SimConfig.render.engineerLogMax;

let messages = [];

/**
 * Add new event messages to the log and re-render.
 * @param {object[]} events – [{ time, msg, type }]
 */
export function logEvents(events) {
  for (const ev of events) {
    if (!ev.msg || ev.type === 'lap_tick') continue;
    messages.unshift({ ...ev, id: Date.now() + Math.random() });
    if (messages.length > MAX_MSGS) messages.pop();
  }
  renderLog();
}

export function clearLog() {
  messages = [];
  renderLog();
}

function renderLog() {
  const el = document.getElementById('engineerLog');
  if (!el) return;

  const iconMap = {
    ai:      '🤖',
    pit:     '🔧',
    control: '📻',
    finish:  '🏁',
    info:    'ℹ',
  };
  const fmtTime = s => {
    const m = Math.floor(s / 60), r = Math.round(s % 60);
    return m + ':' + (r < 10 ? '0' : '') + r;
  };

  el.innerHTML = messages.map(m => `
    <div class="log-entry log-${m.type}">
      <span class="log-icon">${iconMap[m.type] || 'ℹ'}</span>
      <span class="log-time">${fmtTime(m.time)}</span>
      <span class="log-msg">${m.msg}</span>
    </div>`).join('');
}
