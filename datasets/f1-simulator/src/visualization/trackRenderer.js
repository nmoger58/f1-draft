/**
 * trackRenderer.js
 * SVG rendering of the circuit — track surface, kerbs, trees, grid,
 * start/finish line, and analysis overlays.
 *
 * Ported and extended from the original F1 Circuit Guide build() function.
 * The rendering logic is separated so it runs once on circuit change,
 * not on every animation frame.
 */

import { SimConfig } from '../config/simulationConfig.js';

const NS = 'http://www.w3.org/2000/svg';
const f1 = n => n.toFixed(1);
const N  = SimConfig.physics.N;

// Colour helpers (unchanged from original)
const mix = (a, b, t) => a.map((x, i) => Math.round(x + (b[i] - x) * t));
const SLOW = [255, 77, 109], MID = [255, 214, 10], FAST = [34, 211, 238];
export const heat = u => { const c = u < .5 ? mix(SLOW, MID, u / .5) : mix(MID, FAST, (u - .5) / .5); return `rgb(${c[0]},${c[1]},${c[2]})`; };
export const SECT_COLOURS = ['var(--s1)', 'var(--s2)', 'var(--s3)'];

function pathD(pts, a, b) {
  let d = ''; const n = ((b - a + N) % N);
  for (let k = 0; k <= n; k++) { const p = pts[(a + k) % N]; d += (k ? 'L' : 'M') + f1(p[0]) + ' ' + f1(p[1]); }
  return d;
}

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

/**
 * Build the SVG scene for a track.
 * @param {SVGSVGElement} svgEl  – the <svg id="map"> element
 * @param {object}        track  – from trackManager.buildTrack()
 * @returns {object} refs to SVG groups needed for runtime updates
 */
export function renderTrack(svgEl, track) {
  const { pts, k, x0, y0, x1, y1, vw, vh, speedModel, crossing } = track;
  const md = speedModel;

  svgEl.innerHTML = '';
  svgEl.setAttribute('aria-label', track.circuit.name + ' circuit map');

  const vcx = (x0 + x1) / 2, vcy = (y0 + y1) / 2;
  svgEl.setAttribute('viewBox', `${f1(vcx - vw / 2)} ${f1(vcy - vh / 2)} ${f1(vw)} ${f1(vh)}`);

  const world = document.createElementNS(NS, 'g');
  svgEl.appendChild(world);
  const add = (html, host) => { const e = document.createElementNS(NS, 'g'); e.innerHTML = html; (host || world).appendChild(e); return e; };

  const full = pathD(pts, 0, N - 1) + 'Z';
  const avgAsphalt = track.avgWidth || (27.5 * k);
  const W = {
    asphalt: avgAsphalt,
    line:    avgAsphalt + 2.0 * k,
    kerb:    avgAsphalt + 5.5 * k,
    runoff:  avgAsphalt + 9.5 * k,
    gravel:  avgAsphalt + 17.0 * k
  };

  // Trees
  const rndFn = rng(track.circuit.lengthM); let trees = '';
  for (let t = 0, n = 0; t < 900 && n < 230; t++) {
    const x = x0 - 64 + rndFn() * (x1 - x0 + 128), y = y0 - 64 + rndFn() * (y1 - y0 + 128);
    let dmin = 1e9; for (let i = 0; i < N; i += 3) dmin = Math.min(dmin, Math.hypot(pts[i][0]-x, pts[i][1]-y));
    if (dmin < W.gravel / 2 + 10*k) continue;
    n++; trees += `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1((4 + rndFn() * 5)*k)}" fill="var(${rndFn()<.5?'--tree1':'--tree2'})"/>`;
  }
  add(trees);

  // Gravel + runoff
  add(`<path d="${full}" fill="none" stroke="var(--gravel)" stroke-width="${f1(W.gravel)}" stroke-linejoin="round" opacity=".75"/>
       <path d="${full}" fill="none" stroke="var(--runoff)" stroke-width="${f1(W.runoff)}" stroke-linejoin="round"/>`);

  // Straight highlights (scaled with widened asphalt)
  let under = '';
  md.straights.forEach(s => { under += `<path d="${pathD(pts, s.from, (s.from+s.n)%N)}" fill="none" stroke="var(--straight)" stroke-width="${f1(avgAsphalt + 5.0 * k)}" stroke-linecap="round" opacity=".5"/>`; });
  const straightsG = add(under);

  // Kerbs
  let kerb = '', runStart = -1;
  const isC = i => md.kap[(i + N) % N] > 0.0045;
  for (let i = 0; i <= N; i++) {
    const on = i < N && isC(i);
    if (on && runStart < 0) runStart = i;
    if (!on && runStart >= 0) { if (i - runStart >= 3) kerb += pathD(pts, (runStart-2+N)%N, (i+1)%N); runStart = -1; }
  }
  if (kerb) add(`<path d="${kerb}" fill="none" stroke="#f3f3f3" stroke-width="${f1(W.kerb)}" stroke-linejoin="round"/><path d="${kerb}" fill="none" stroke="#d6141e" stroke-width="${f1(W.kerb)}" stroke-linejoin="round" stroke-dasharray="${f1(5*k)} ${f1(5*k)}"/>`);

  // Track surface
  add(`<path d="${full}" fill="none" stroke="#f1f1f1" stroke-width="${f1(W.line)}" stroke-linejoin="round"/>
       <path d="${full}" fill="none" stroke="var(--asphalt)" stroke-width="${f1(W.asphalt)}" stroke-linejoin="round"/>
       <path d="${full}" fill="none" stroke="#000" stroke-opacity=".22" stroke-width="${f1(5*k)}" stroke-linejoin="round"/>`);

  // Analysis overlay (sector / speed colour)
  const segEls = [];
  const overlayG = document.createElementNS(NS, 'g'); world.appendChild(overlayG);
  const addChunk = (j, end) => {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', pathD(pts, j, end));
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke-width', f1(3.2*k));
    p.dataset.s = SECT_COLOURS[Math.min(2, Math.floor(j / (N/3)))];
    p.dataset.h = heat((md.v[j]-md.vmin)/(md.vmax-md.vmin||1));
    segEls.push(p); overlayG.appendChild(p);
  };
  for (let j = 0; j < N; j += 3) addChunk(j, Math.min(j+3,N)%N);

  // Bridge for figure-8 (Suzuka)
  const xc = crossing, x = xc ? xc[1] : -1;
  if (x >= 0) {
    const a = (x-12+N)%N, b = (x+12)%N, d = pathD(pts, a, b);
    add(`<path d="${d}" fill="none" stroke="#9a9aa6" stroke-width="${f1(avgAsphalt + 4.5*k)}"/><path d="${d}" fill="none" stroke="#f1f1f1" stroke-width="${f1(avgAsphalt + 2.0*k)}"/><path d="${d}" fill="none" stroke="var(--asphalt)" stroke-width="${f1(avgAsphalt)}"/>`);
    for (let j = a; j !== b;) { const step = Math.min(3, (b-j+N)%N), end = (j+step)%N; addChunk(j, end); j = end; }
  }

  // Start/finish line
  const hd = i => { const a = pts[(i-1+N)%N], b = pts[(i+1)%N]; return Math.atan2(b[1]-a[1], b[0]-a[0]); };
  const nrm = h => [-Math.sin(h), Math.cos(h)];
  const h0 = hd(0), n0 = nrm(h0), p0 = pts[0], half = (track.width ? track.width[0] / 2 : W.asphalt / 2);
  add(`<line x1="${f1(p0[0]-n0[0]*half)}" y1="${f1(p0[1]-n0[1]*half)}" x2="${f1(p0[0]+n0[0]*half)}" y2="${f1(p0[1]+n0[1]*half)}" stroke="#fff" stroke-width="${f1(4*k)}"/>
       <line x1="${f1(p0[0]-n0[0]*half)}" y1="${f1(p0[1]-n0[1]*half)}" x2="${f1(p0[0]+n0[0]*half)}" y2="${f1(p0[1]+n0[1]*half)}" stroke="#111" stroke-width="${f1(4*k)}" stroke-dasharray="${f1(4*k)} ${f1(4*k)}"/>`);
  add(`<text x="${f1(p0[0]+n0[0]*(half+12*k))}" y="${f1(p0[1]+n0[1]*(half+12*k)+3.5*k)}" text-anchor="middle" font-family="Rajdhani,sans-serif" font-weight="700" font-size="${f1(11*k)}" letter-spacing="1" fill="#fff" stroke="#000" stroke-width="${f1(2.2*k)}" paint-order="stroke">S/F</text>`);

  // Straight badges
  let badges = '';
  md.straights.forEach((s, i) => {
    const m = pts[s.mid], h = hd(s.mid), bx = m[0]+Math.sin(h)*30*k, by = m[1]-Math.cos(h)*30*k;
    badges += `<circle cx="${f1(bx)}" cy="${f1(by)}" r="${f1(9*k)}" fill="var(--straight)"/><text x="${f1(bx)}" y="${f1(by+4*k)}" text-anchor="middle" font-family="Rajdhani,sans-serif" font-weight="700" font-size="${f1(12.5*k)}" fill="#04110d">${i+1}</text>`;
  });
  const badgesG = add(badges);

  // DRS Zones Highlight Layer
  const drsLayer = document.createElementNS(NS, 'g');
  drsLayer.setAttribute('id', 'drsLayer');
  world.appendChild(drsLayer);
  track.drsZones?.forEach((z, i) => {
    const pathStr = pathD(pts, z.from, z.to);
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', pathStr);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', '#00f59b');
    p.setAttribute('stroke-width', f1(5.5 * k));
    p.setAttribute('stroke-dasharray', `${f1(8 * k)} ${f1(6 * k)}`);
    p.setAttribute('opacity', '.75');
    drsLayer.appendChild(p);

    const midI = Math.floor((z.from + (z.to >= z.from ? z.to - z.from : z.to + N - z.from) / 2) % N);
    const m = pts[midI], h = hd(midI);
    const lx = m[0] - Math.sin(h) * 22 * k;
    const ly = m[1] + Math.cos(h) * 22 * k;
    const txt = document.createElementNS(NS, 'text');
    txt.setAttribute('x', f1(lx));
    txt.setAttribute('y', f1(ly));
    txt.setAttribute('text-anchor', 'middle');
    txt.setAttribute('font-family', 'Rajdhani,sans-serif');
    txt.setAttribute('font-weight', '700');
    txt.setAttribute('font-size', f1(10 * k));
    txt.setAttribute('fill', '#00f59b');
    txt.setAttribute('letter-spacing', '1');
    txt.textContent = `DRS ${i + 1}`;
    drsLayer.appendChild(txt);
  });

  // Pit Lane Box Marking Layer
  if (track.pitLane) {
    const pitG = document.createElementNS(NS, 'g');
    pitG.setAttribute('id', 'pitLaneLayer');
    world.appendChild(pitG);

    const pitOffset = track.pitLane.offsetPx;
    const pBoxX = p0[0] + n0[0] * pitOffset;
    const pBoxY = p0[1] + n0[1] * pitOffset;

    const pitBox = document.createElementNS(NS, 'rect');
    pitBox.setAttribute('x', f1(-12 * k));
    pitBox.setAttribute('y', f1(-5 * k));
    pitBox.setAttribute('width', f1(24 * k));
    pitBox.setAttribute('height', f1(10 * k));
    pitBox.setAttribute('fill', 'rgba(225, 6, 0, 0.28)');
    pitBox.setAttribute('stroke', 'var(--accent)');
    pitBox.setAttribute('stroke-width', f1(1.5 * k));
    pitBox.setAttribute('transform', `translate(${f1(pBoxX)} ${f1(pBoxY)}) rotate(${(h0 * 180 / Math.PI).toFixed(1)})`);
    pitG.appendChild(pitBox);

    const pitText = document.createElementNS(NS, 'text');
    pitText.setAttribute('x', f1(pBoxX));
    pitText.setAttribute('y', f1(pBoxY + 3.2 * k));
    pitText.setAttribute('text-anchor', 'middle');
    pitText.setAttribute('font-family', 'Rajdhani,sans-serif');
    pitText.setAttribute('font-weight', '700');
    pitText.setAttribute('font-size', f1(7.5 * k));
    pitText.setAttribute('fill', '#fff');
    pitText.setAttribute('letter-spacing', '1');
    pitText.textContent = 'PIT BOX';
    pitG.appendChild(pitText);
  }

  // Developer Telemetry Visual Debug Drawings Layer (Phase 8 Extension)
  const devDebugOverlay = document.createElementNS(NS, 'g');
  devDebugOverlay.setAttribute('id', 'devDebugOverlay');
  devDebugOverlay.setAttribute('visibility', 'hidden');
  world.appendChild(devDebugOverlay);

  // Car layers (cars added by carRenderer.js)
  const carLayer = document.createElementNS(NS, 'g'); world.appendChild(carLayer);
  const lblLayer = document.createElementNS(NS, 'g'); world.appendChild(lblLayer);

  return { world, overlayG, straightsG, badgesG, carLayer, lblLayer, devDebugOverlay, segEls, vcx, vcy, vw, vh, hd, nrm, W };
}

/** Apply mode colouring to the overlay segments */
export function applyTrackMode(scene, mode) {
  const analysis = mode !== 'real';
  scene.segEls.forEach(p => p.setAttribute('stroke', mode === 'sector' ? p.dataset.s : p.dataset.h));
  [scene.overlayG, scene.straightsG, scene.badgesG].forEach(g => g.setAttribute('visibility', analysis ? 'visible' : 'hidden'));
}
