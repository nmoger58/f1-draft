/**
 * leaderboard.js
 * Live race order panel: position, driver, gap, last lap, tyre, pit stops.
 */

const fmtT = s => {
  if (s == null || s <= 0) return '–';
  const m = Math.floor(s / 60), r = s - m * 60;
  return m + ':' + (r < 10 ? '0' : '') + r.toFixed(3);
};

/**
 * Render the leaderboard into #board.
 * @param {object[]} standings – from raceEngine.standings (sorted by position)
 * @param {number}   selIdx    – currently selected car index (for highlight)
 * @param {number}   totalLaps
 * @param {Function} onSelect  – callback(carIndex)
 */
export function renderLeaderboard(standings, selIdx, totalLaps, onSelect) {
  const board = document.getElementById('board');
  if (!board) return;

  const bestLapTime = Math.min(...standings.map(c => c.bestLap || Infinity));

  board.innerHTML = standings.map((car, p) => {
    const isLeader  = p === 0;
    const gap       = isLeader
      ? (car.finished ? `FINISHED (${totalLaps}/${totalLaps})` : `Lap ${Math.max(1, Math.min(totalLaps, car.lap))}/${totalLaps}`)
      : car.retiredLap !== null
        ? 'DNF'
        : car.finished
          ? (car.gapToLeader > 0 ? `+${car.gapToLeader.toFixed(1)}s` : 'FIN')
          : (car.gapToLeader > 0 ? `+${car.gapToLeader.toFixed(1)}s` : 'LAP');
    const isBestLap = car.bestLap !== null && car.bestLap === bestLapTime;
    const tyreCol   = car.tyreModel?.colour || car.tyreStrategy?.colour || '#ffd60a';
    const tyreCode  = car.tyreModel?.label || car.tyreStrategy?.label || '?';
    const tyreAge   = car.tyreModel?.ageLaps || 0;
    const tyreHTML  = `<span class="tyre-badge" style="background:${tyreCol}" title="${(car.tyreModel?.compound || '').toUpperCase()}">${tyreCode}</span><small class="tyre-age-lbl" style="font:700 9px 'Rajdhani',sans-serif;color:var(--muted);margin-left:2px">${tyreAge}L</small>`;
    const pitHTML   = car.pitstops > 0 ? `<span class="pit-count">${car.pitstops}✦</span>` : '';
    const wearPct   = car.tyreWear ? Math.round(car.tyreWear * 100) : 0;
    const wearBar   = `<span class="wear-bar" title="Tyre wear ${wearPct}%"><i style="width:${wearPct}%"></i></span>`;

    // DRS state badge
    const drsHTML = car.drsActive
      ? `<span class="drs-pill drs-on" title="DRS Wing Deployed">DRS</span>`
      : (car.drsEligible ? `<span class="drs-pill drs-ready" title="DRS Available">DRS</span>` : '');

    // In-pit state badge
    const inPit = (car.pitState === 'entering' || car.pitState === 'in_lane' || car.pitState === 'servicing' || car.pitState === 'exiting');
    const pitStatusHTML = inPit
      ? `<span class="pit-badge in-pit" title="Car in Pit Lane">PIT</span>`
      : (car.pitRequested ? `<span class="pit-badge pit-req" title="Pit Stop Queued">BOX</span>` : '');

    return `<button class="lrow" type="button" data-i="${car.i}" aria-pressed="${car.i === selIdx}">
      <span class="pos">${p + 1}</span>
      <i class="dot" style="background:${car.color}"></i>
      <span class="code">${car.code}<small>${car.team}</small></span>
      ${drsHTML}${pitStatusHTML}${tyreHTML}${pitHTML}
      <span class="gap">${gap}</span>
      <span class="ll${isBestLap ? ' best' : ''}">${fmtT(car.lastLap)}</span>
      ${wearBar}
    </button>`;
  }).join('');

  // Bind click events
  board.querySelectorAll('.lrow').forEach(btn => {
    btn.addEventListener('click', () => onSelect(+btn.dataset.i));
  });
}
