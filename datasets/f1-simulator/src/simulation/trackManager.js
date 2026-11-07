/**
 * trackManager.js
 * Converts raw GPS waypoints → a smooth, equidistant centreline path
 * and computes the speed/curvature model used by the physics engine and AI.
 *
 * Preserves the centripetal Catmull-Rom + relax algorithm from the original
 * F1 Circuit Guide and adds:
 *   - curvature array (kap[])
 *   - corner speed profile (v[])
 *   - curvature-ahead array for AI look-ahead
 *   - sector boundaries
 *   - straight detection
 *   - crossing detection (for figure-8 tracks like Suzuka)
 */

import { SimConfig } from '../config/simulationConfig.js';
import { getTrackWidthProfile } from '../config/trackWidthConfig.js';

const N = SimConfig.physics.N; // 720 waypoints

// ── Bézier helpers (unchanged from original) ──────────────────────────────

function toBeziers(P) {
  const n = P.length, segs = [];
  const dist = (a, b) => Math.max(Math.hypot(a[0] - b[0], a[1] - b[1]), 1e-3);
  for (let i = 0; i < n; i++) {
    const p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n];
    const a1 = dist(p0, p1), a2 = dist(p1, p2), a3 = dist(p2, p3);
    const d1 = Math.sqrt(a1), d2 = Math.sqrt(a2), d3 = Math.sqrt(a3);
    const c1 = [0, 0], c2 = [0, 0];
    for (let k = 0; k < 2; k++) {
      c1[k] = (a1 * p2[k] - a2 * p0[k] + (2 * a1 + 3 * d1 * d2 + a2) * p1[k]) / (3 * d1 * (d1 + d2));
      c2[k] = (a3 * p1[k] - a2 * p3[k] + (2 * a3 + 3 * d3 * d2 + a2) * p2[k]) / (3 * d3 * (d3 + d2));
    }
    segs.push([p1, c1, c2, p2]);
  }
  return segs;
}

const bez = (s, t) => { const u = 1 - t; return [0, 1].map(k => u*u*u*s[0][k] + 3*u*u*t*s[1][k] + 3*u*t*t*s[2][k] + t*t*t*s[3][k]); };

function resample(segs, count) {
  const dense = [];
  segs.forEach(s => { for (let j = 0; j < 24; j++) dense.push(bez(s, j / 24)); });
  const m = dense.length, cum = [0];
  for (let i = 1; i <= m; i++) { const a = dense[i - 1], b = dense[i % m]; cum[i] = cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]); }
  const L = cum[m], out = []; let j = 0;
  for (let i = 0; i < count; i++) {
    const s = i * L / count; while (cum[j + 1] < s) j++;
    const a = dense[j], b = dense[(j + 1) % m], t = (s - cum[j]) / ((cum[j + 1] - cum[j]) || 1);
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

// ── Road separation (relax) ───────────────────────────────────────────────

const needChord = (arc, dmin) => arc >= Math.PI / 2 * dmin ? dmin : dmin * Math.sin(arc / dmin);

function relax(P, dmin, ex) {
  const n = P.length; let Q = P.map(p => [p[0], p[1]]), len = 0;
  for (let i = 0; i < n; i++) len += Math.hypot(P[(i + 1) % n][0] - P[i][0], P[(i + 1) % n][1] - P[i][1]);
  const dsp = len / n;
  const skip = (i, j) => ex && ((Math.abs(i - ex[0]) < 30 && Math.abs(j - ex[1]) < 30) || (Math.abs(j - ex[0]) < 30 && Math.abs(i - ex[1]) < 30));
  const need = arc => needChord(arc, dmin);
  for (let it = 0; it < 80; it++) {
    const D = Q.map(() => [0, 0]);
    for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
      const m = Math.min(j - i, n - (j - i)); if (m < 3) continue;
      const dx = Q[j][0] - Q[i][0], dy = Q[j][1] - Q[i][1], q = dx * dx + dy * dy, t = need(m * dsp);
      if (q >= t * t || skip(i, j)) continue;
      const d = Math.sqrt(q) || 1e-3, push = (t - d) * 0.2;
      D[i][0] -= dx / d * push; D[i][1] -= dy / d * push; D[j][0] += dx / d * push; D[j][1] += dy / d * push;
    }
    Q = Q.map((p, i) => {
      const a = Q[(i - 1 + n) % n], c = Q[(i + 1) % n], x = p[0] + D[i][0], y = p[1] + D[i][1];
      const sx = x + 0.3 * ((a[0] + c[0]) / 2 - x), sy = y + 0.3 * ((a[1] + c[1]) / 2 - y);
      return [sx + 0.03 * (P[i][0] - sx), sy + 0.03 * (P[i][1] - sy)];
    });
  }
  return Q;
}

function crowding(P, dmin, ex) {
  const n = P.length; let len = 0;
  for (let i = 0; i < n; i++) len += Math.hypot(P[(i + 1) % n][0] - P[i][0], P[(i + 1) % n][1] - P[i][1]);
  const dsp = len / n, bad = new Uint8Array(n);
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    const m = Math.min(j - i, n - (j - i)); if (m < 3) continue;
    if (ex && ((Math.abs(i - ex[0]) < 30 && Math.abs(j - ex[1]) < 30) || (Math.abs(j - ex[0]) < 30 && Math.abs(i - ex[1]) < 30))) continue;
    const t = 0.85 * needChord(m * dsp, dmin), dx = P[j][0] - P[i][0], dy = P[j][1] - P[i][1];
    if (dx * dx + dy * dy < t * t) { bad[i] = 1; bad[j] = 1; }
  }
  let c = 0; for (let i = 0; i < n; i++) c += bad[i]; return c / n;
}

function findCrossing(pts) {
  const M = 240, step = N / M, q = [];
  for (let i = 0; i < M; i++) q.push(pts[Math.floor(i * step)]);
  const ccw = (a, b, c) => (c[1] - a[1]) * (b[0] - a[0]) > (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < M; i++) for (let j = i + 6; j < M; j++) {
    if (i === 0 && j >= M - 6) continue;
    const a = q[i], b = q[(i + 1) % M], c = q[j], d = q[(j + 1) % M];
    if (ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d)) return [Math.floor((i + 0.5) * step), Math.floor((j + 0.5) * step)];
  }
  return null;
}

// ── Speed + curvature model ───────────────────────────────────────────────

function buildSpeedModel(circuit, pts) {
  const { A0, K, VMAX, VMIN, ABR, ACC0, ACC1, STR } = {
    A0:22, K:0.003, VMAX:SimConfig.physics.maxSpeed, VMIN:SimConfig.physics.minSpeed,
    ABR:SimConfig.physics.brakeDecel, ACC0:SimConfig.physics.accelMax, ACC1:SimConfig.physics.accelFalloff, STR:0.0022
  };
  const ds = circuit.lengthM / N, w = 3, kap = new Array(N);
  for (let i = 0; i < N; i++) {
    const a = pts[(i - w + N) % N], b = pts[i], d = pts[(i + w) % N];
    let dh = Math.atan2(d[1] - b[1], d[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0]);
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    kap[i] = Math.abs(dh) / (w * ds);
  }
  // smooth curvature
  for (let r = 0; r < 2; r++) { const c0 = kap.slice(); for (let i = 0; i < N; i++) { let s = 0; for (let k = -2; k <= 2; k++) s += c0[(i + k + N) % N]; kap[i] = s / 5; } }
  const v = kap.map(k => { const q = k - K; return q <= 1e-6 ? VMAX : Math.max(VMIN, Math.min(VMAX, Math.sqrt(A0 / q))); });
  // backward pass (braking)
  for (let p = 0; p < 3; p++) {
    for (let i = 2 * N - 1; i >= 0; i--) { const a = i % N, b = (i + 1) % N; v[a] = Math.min(v[a], Math.sqrt(v[b] * v[b] + 2 * ABR * ds)); }
    for (let i = 0; i < 2 * N; i++) { const a = i % N, b = (i + 1) % N; const acc = Math.max(4, ACC0 - ACC1 * v[a]); v[b] = Math.min(v[b], Math.sqrt(v[a] * v[a] + 2 * acc * ds)); }
  }
  // scale to lap record
  let T = 0; for (let i = 0; i < N; i++) T += ds / ((v[i] + v[(i + 1) % N]) / 2);
  const f = T / circuit.rec; for (let i = 0; i < N; i++) v[i] *= f;
  // cumulative time
  const t = [0]; for (let i = 0; i < N; i++) t.push(t[i] + ds / ((v[i] + v[(i + 1) % N]) / 2));
  const tscale = circuit.rec / t[N]; for (let i = 0; i <= N; i++) t[i] *= tscale;
  // straights
  const thr = STR; let start = kap.findIndex(k => k >= thr); const runs = [];
  if (start >= 0) {
    let cur = null;
    for (let q = 1; q <= N; q++) {
      const i = (start + q) % N;
      if (kap[i] < thr) { if (!cur) cur = { from: i, n: 0 }; cur.n++; } else if (cur) { runs.push(cur); cur = null; }
    }
    if (cur) runs.push(cur);
    for (let r = runs.length - 1; r > 0; r--) {
      const a = runs[r - 1], b = runs[r], gap = (b.from - (a.from + a.n) + N) % N;
      if (gap <= 6) { a.n += gap + b.n; runs.splice(r, 1); }
    }
  }
  const straights = runs.map(r => { const mid = (r.from + Math.floor(r.n / 2)) % N; let top = 0; for (let k = 0; k < r.n; k++) top = Math.max(top, v[(r.from + k) % N]); return { from: r.from, n: r.n, mid, len: r.n * ds, top: top * 3.6 }; })
    .filter(s => s.len >= 250).sort((a, b) => b.len - a.len).slice(0, 3);

  return { f, v, t, kap, straights, vmin: Math.min(...v), vmax: Math.max(...v), ds };
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Build a complete track geometry from raw waypoints + circuit metadata.
 * Returns an object consumed by trackRenderer and all AI/physics modules.
 */
export function buildTrack(circuit, rawWaypoints) {
  const base = resample(toBeziers(rawWaypoints), N);
  const pad = 64;
  const fitOf = P => {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, pxLen = 0;
    P.forEach((p, i) => { x0=Math.min(x0,p[0]); x1=Math.max(x1,p[0]); y0=Math.min(y0,p[1]); y1=Math.max(y1,p[1]); const q=P[(i+1)%N]; pxLen+=Math.hypot(q[0]-p[0],q[1]-p[1]); });
    let vw = x1-x0+2*pad, vh = y1-y0+2*pad;
    if (vw/vh>1.7) vh=vw/1.7; else if (vw/vh<0.9) vw=vh*0.9;
    return { x0, y0, x1, y1, pxLen, vw, vh, k: Math.max(vw/800, vh/560) };
  };
  const xo = findCrossing(base), F0 = fitOf(base);
  let pts = base, k = F0.k;
  const sub = P => P.filter((_, i) => i % 2 === 0), xo2 = xo && [xo[0]>>1, xo[1]>>1];
  for (const wk of [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.42]) {
    k = F0.k * wk;
    pts = resample(toBeziers(relax(sub(base), 38*k, xo2)), N);
    if (crowding(sub(pts), 38*k, xo2) < 0.02 && (xo || !findCrossing(pts))) break;
  }
  const F = fitOf(pts);
  const { x0, y0, x1, y1, pxLen, vw, vh } = F;
  const speedModel = buildSpeedModel(circuit, pts);
  const crossing = findCrossing(pts);
  const uPerM = pxLen / circuit.lengthM;

  // pre-compute heading array
  const heading = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = pts[(i - 1 + N) % N], b = pts[(i + 1) % N];
    heading[i] = Math.atan2(b[1] - a[1], b[0] - a[0]);
  }

  // Derive DRS zones matching circuit.drs count from straights
  const numDrs = circuit.drs || 1;
  const drsZones = speedModel.straights.slice(0, numDrs).map((s, idx) => {
    const startD = (s.from / N) * circuit.lengthM;
    const endD   = (((s.from + s.n) % N) / N) * circuit.lengthM;
    const detD   = (((s.from - 20 + N) % N) / N) * circuit.lengthM;
    return {
      id: idx + 1,
      name: `DRS Zone ${idx + 1}`,
      from: s.from,
      to: (s.from + s.n) % N,
      startD,
      endD,
      detD,
      len: s.len,
      topSpeed: s.top,
      isOfficial: true,
    };
  });

  if (drsZones.length === 0) {
    // Fallback: derive straight from lowest curvature segment around S/F line
    const startD = circuit.lengthM - 120;
    const endD   = 160;
    drsZones.push({
      id: 1,
      name: 'DRS Zone 1 (S/F Straight - Simulated)',
      from: Math.floor((startD / circuit.lengthM) * N),
      to: Math.floor((endD / circuit.lengthM) * N),
      startD,
      endD,
      detD: circuit.lengthM - 180,
      len: 280,
      topSpeed: 290,
      isOfficial: false,
    });
  }

  // Compute per-waypoint dynamic track width profile (Phase 2: Wider Tracks)
  const widthCfg = getTrackWidthProfile(circuit.id);
  const rawWidth = new Float32Array(N);
  const carWidthPx = 3.6 * k;

  for (let i = 0; i < N; i++) {
    let w = widthCfg.baseWidth;
    const kap = speedModel.kap[i];
    const isStraight = speedModel.straights.some(s => {
      const from = s.from, to = (s.from + s.n) % N;
      return from <= to ? (i >= from && i <= to) : (i >= from || i <= to);
    });

    if (isStraight) {
      w += widthCfg.straightBonus;
    } else if (kap > 0.008) {
      // Hairpin / high curvature corner: keep authentic tighter width (>= minCornerWidth)
      w = Math.max(widthCfg.minCornerWidth, w - (kap - 0.008) * 350);
    } else {
      // Braking zone or sweeping curve
      w += widthCfg.brakingBonus * Math.max(0, 1.0 - kap / 0.008);
    }

    // Segment overrides
    if (widthCfg.segmentOverrides && widthCfg.segmentOverrides.length > 0) {
      const d = (i / N) * circuit.lengthM;
      for (const ov of widthCfg.segmentOverrides) {
        if (d >= ov.startD && d <= ov.endD) {
          w = ov.width;
          break;
        }
      }
    }

    rawWidth[i] = w * k;
  }

  // Smooth width profile with Gaussian moving average to guarantee C1 continuity
  // without any sharp boundary distortions or self-intersections
  const width = new Float32Array(N);
  const halfWidth = new Float32Array(N);
  const usableHalfWidth = new Float32Array(N);
  const win = 16;
  let totalWidth = 0;

  for (let i = 0; i < N; i++) {
    let sum = 0, weightSum = 0;
    for (let j = -win; j <= win; j++) {
      const idx = (i + j + N) % N;
      const weight = Math.exp(-(j * j) / (2 * 5 * 5));
      sum += rawWidth[idx] * weight;
      weightSum += weight;
    }
    const smoothedW = sum / weightSum;
    width[i] = smoothedW;
    halfWidth[i] = smoothedW / 2;
    // Usable half-width leaves safety buffer so outer car wheels stay inside asphalt boundary
    usableHalfWidth[i] = (smoothedW / 2) - (carWidthPx * 0.45);
    totalWidth += smoothedW;
  }

  const avgWidth = totalWidth / N;
  const avgHalfWidth = avgWidth / 2;

  const getTrackWidthAt = (d) => {
    const f = (((d % circuit.lengthM) + circuit.lengthM) % circuit.lengthM) / circuit.lengthM * N;
    const i = Math.floor(f) % N, fr = f - Math.floor(f);
    const w = width[i] + (width[(i + 1) % N] - width[i]) * fr;
    return {
      width: w,
      halfWidth: w / 2,
      usableHalfWidth: (w / 2) - (carWidthPx * 0.45)
    };
  };

  // Pit lane geometry (positioned safely outside the wider main straight)
  const pitLane = {
    entryD: circuit.lengthM - 140,
    commitD: circuit.lengthM - 40,
    boxD: 0,
    exitD: 110,
    speedLimit: circuit.id === 'monaco' ? 16.7 : 22.2,
    side: circuit.direction === 'anticlockwise' ? -1 : 1,
    offsetPx: (circuit.direction === 'anticlockwise' ? -1 : 1) * (avgHalfWidth + 3.0 * k),
  };

  return {
    circuit, pts, heading, speedModel, crossing, k, uPerM, x0, y0, x1, y1, vw, vh, N,
    drsZones, pitLane, width, halfWidth, usableHalfWidth, avgWidth, avgHalfWidth, getTrackWidthAt
  };
}

/**
 * Sample track position at distance d (metres, may be negative or wrap).
 * Returns { i, fr, v, x, y, heading, width, halfWidth, usableHalfWidth }
 */
export function sampleTrack(track, d) {
  if (!track || !track.pts || !track.pts.length) {
    return { i: 0, fr: 0, v: 0, x: 0, y: 0, heading: 0, width: 27, halfWidth: 13.5, usableHalfWidth: 11.5, curv: 0 };
  }
  const L = track.circuit?.lengthM || 3337;
  const safeD = (typeof d === 'number' && !isNaN(d)) ? d : 0;
  const f = (((safeD % L) + L) % L) / L * N;
  const i = Math.max(0, Math.min(N - 1, (Math.floor(f) % N + N) % N));
  const fr = Math.max(0, Math.min(1, f - Math.floor(f)));
  const a = track.pts[i] || track.pts[0] || [0, 0];
  const b = track.pts[(i + 1) % N] || a;
  const x = a[0] + (b[0] - a[0]) * fr;
  const y = a[1] + (b[1] - a[1]) * fr;
  const speedV = track.speedModel?.v;
  const v = speedV ? (speedV[i] + (speedV[(i + 1) % N] - speedV[i]) * fr) : 50;
  const h = track.heading ? track.heading[i] : 0;
  const curv = track.speedModel?.kap ? track.speedModel.kap[i] : 0;

  // Dynamic track width interpolation
  let w = 27.0 * (track.k || 1);
  let hw = 13.5 * (track.k || 1);
  let uhw = 11.5 * (track.k || 1);
  if (track.width) {
    w = track.width[i] + (track.width[(i + 1) % N] - track.width[i]) * fr;
    hw = w / 2;
    uhw = track.usableHalfWidth[i] + (track.usableHalfWidth[(i + 1) % N] - track.usableHalfWidth[i]) * fr;
  }

  return { i, fr, v, x, y, heading: h, width: w, halfWidth: hw, usableHalfWidth: uhw, curv };
}

/** Maximum curvature in the next lookAheadM metres starting at distance d */
export function maxCurvatureAhead(track, d, lookAheadM) {
  const L = track.circuit.lengthM;
  const ds = L / N;
  const steps = Math.ceil(lookAheadM / ds);
  const startI = Math.floor((((d % L) + L) % L) / L * N);
  let maxKap = 0;
  for (let s = 0; s <= steps; s++) {
    maxKap = Math.max(maxKap, track.speedModel.kap[(startI + s) % N]);
  }
  return maxKap;
}

/** Minimum speed in the next lookAheadM metres */
export function minSpeedAhead(track, d, lookAheadM) {
  const L = track.circuit.lengthM;
  const ds = L / N;
  const steps = Math.ceil(lookAheadM / ds);
  const startI = Math.floor((((d % L) + L) % L) / L * N);
  let minV = Infinity;
  for (let s = 0; s <= steps; s++) {
    minV = Math.min(minV, track.speedModel.v[(startI + s) % N]);
  }
  return minV;
}

/**
 * Computes kinematic braking limit for approaching corners based on physical deceleration.
 * Allows full throttle on straights right up to the genuine braking marker.
 */
export function maxSafeSpeedAhead(track, d, lookAheadM, aBrake = 42, gripSpeedScale = 1.0) {
  const L = track.circuit.lengthM;
  const ds = L / N;
  const steps = Math.min(Math.ceil(lookAheadM / ds), 36);
  const startI = Math.floor((((d % L) + L) % L) / L * N);
  let safeV = Infinity;
  for (let s = 1; s <= steps; s++) {
    const targetCornerV = (track.speedModel.v[(startI + s) % N] || 50) * gripSpeedScale;
    const distToPoint = s * ds;
    const vAllowed = Math.sqrt(targetCornerV * targetCornerV + 2 * aBrake * distToPoint);
    if (vAllowed < safeV) {
      safeV = vAllowed;
    }
  }
  return safeV;
}
