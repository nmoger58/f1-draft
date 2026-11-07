/**
 * clientAdapter.js
 * High-Precision Client-Side Snapshot Interpolation & Dead Reckoning Engine.
 *
 * Implements:
 *   1. Timestamped Authoritative Snapshot Buffering (sorted by server timestamp/sequence).
 *   2. Cubic Hermite Spline Interpolation for positions, track progress (s, d, lat), and velocities.
 *   3. Continuous Angular Heading Interpolation with shortest-arc wrap-around [-π, π].
 *   4. Track Length (L) Periodic Boundary Wrap Handling (Lap Crossing S-wrap).
 *   5. Dead Reckoning with Velocity/Acceleration Projection and Confidence Decay.
 *   6. Smooth Reconciliation on Snapshot Arrival (exponential correction blending, no visual snapping).
 *   7. Fallback Linear Interpolation for missing velocity derivatives.
 *   8. Real-Time Network Quality & Diagnostics Tracking (RTT, Jitter, Packet Loss, Buffer Depth, Corrections).
 *   9. Pure Visual Decoupling: Interpolation and Dead Reckoning NEVER alter authoritative race state or standings.
 */

/** Cubic Hermite basis functions */
function h00(t) { return (1 + 2 * t) * (1 - t) * (1 - t); }
function h10(t) { return t * (1 - t) * (1 - t); }
function h01(t) { return t * t * (3 - 2 * t); }
function h11(t) { return t * t * (t - 1); }

/**
 * Evaluates Cubic Hermite spline between p0 and p1 with velocities v0 and v1.
 * @param {number} p0 - Position at start (t = 0)
 * @param {number} p1 - Position at end (t = 1)
 * @param {number} v0 - Velocity / derivative at start
 * @param {number} v1 - Velocity / derivative at end
 * @param {number} t  - Normalised factor [0, 1]
 * @param {number} [dt=1] - Time interval (s)
 * @returns {number}
 */
export function hermiteInterpolate(p0, p1, v0, v1, t, dt = 1) {
  const _h00 = h00(t);
  const _h10 = h10(t);
  const _h01 = h01(t);
  const _h11 = h11(t);
  return _h00 * p0 + _h10 * (v0 * dt) + _h01 * p1 + _h11 * (v1 * dt);
}

/** Shortest-distance angle interpolation (radians) */
export function interpolateAngle(a0, a1, t) {
  let diff = (a1 - a0) % (Math.PI * 2);
  if (diff < -Math.PI) diff += Math.PI * 2;
  if (diff > Math.PI) diff -= Math.PI * 2;
  return a0 + diff * t;
}

/** Periodic distance wrap (e.g. lap line wrap around length L) */
export function unwrapDistance(target, ref, L) {
  if (!L || L <= 0) return target;
  let delta = target - ref;
  if (delta > L * 0.5) delta -= L;
  if (delta < -L * 0.5) delta += L;
  return ref + delta;
}

export class ClientSnapshotAdapter {
  /**
   * @param {object} [options]
   * @param {number} [options.interpolationDelayMs=100] – Render delay behind real-time server clock to ensure buffer availability
   * @param {number} [options.maxBufferMs=2000] – Snapshot buffer window retention
   * @param {number} [options.maxPredictionMs=1200] – Max dead-reckoning projection window before freezing
   * @param {number} [options.reconciliationSmoothFactor=0.15] – Exponential smoothing weight for correction reconciliation
   */
  constructor(options = {}) {
    this.interpolationDelayMs = options.interpolationDelayMs ?? 100;
    this.maxBufferMs = options.maxBufferMs ?? 2000;
    this.maxPredictionMs = options.maxPredictionMs ?? 1200;
    this.reconciliationSmoothFactor = options.reconciliationSmoothFactor ?? 0.18;

    /** @type {Array<{ serverTimestamp: number, sequenceNumber: number, simulationTick: number, cars: Record<string, object>, flags?: string }>} */
    this.snapshotBuffer = [];

    /** Monotonically highest sequence number observed */
    this.latestSequenceNumber = -1;

    /** Last processed server timestamp */
    this.latestServerTimestamp = 0;

    /** Local time of last snapshot arrival */
    this.lastPacketLocalTime = 0;

    /** Per-car dead reckoning & smoothing state: participantId -> { predS, predLat, correctionOffsetS, correctionOffsetLat, lastKnownV, lastKnownHeading } */
    this.carVisualStates = new Map();

    /** Track circuit length for modulo arithmetic */
    this.circuitLengthM = options.circuitLength ?? 5000;

    /** Network quality diagnostics */
    this.diagnostics = {
      pingMs: 0,
      jitterMs: 0,
      packetLossPct: 0,
      bufferDepth: 0,
      interpolationDelayMs: this.interpolationDelayMs,
      predictionDurationMs: 0,
      correctionMagnitudeM: 0,
      snapshotsReceived: 0,
      packetsDropped: 0,
      serverSimulationTick: 0,
      isReconnecting: false
    };

    this._packetArrivalIntervals = [];
    this._lastPacketArrivalTime = 0;
    this._pingHistory = [];
  }

  /** Set track length for lap wrap-around calculations */
  setTrackLength(lengthM) {
    if (lengthM > 0) this.circuitLengthM = lengthM;
  }

  /** Reset buffer (e.g. on new race or reconnection) */
  reset() {
    this.snapshotBuffer = [];
    this.latestSequenceNumber = -1;
    this.latestServerTimestamp = 0;
    this.lastPacketLocalTime = 0;
    this.carVisualStates.clear();
    this.diagnostics.bufferDepth = 0;
    this.diagnostics.predictionDurationMs = 0;
    this.diagnostics.correctionMagnitudeM = 0;
  }

  /**
   * Ingest an authoritative server snapshot.
   * Filters stale or duplicate snapshots, updates metrics, and maintains sorted buffer.
   *
   * @param {object} snapshot
   * @param {number} snapshot.serverTimestamp
   * @param {number} snapshot.sequenceNumber
   * @param {number} [snapshot.simulationTick]
   * @param {Record<string, object>|Array<object>} snapshot.cars
   * @returns {boolean} true if accepted, false if discarded (out of order / duplicate)
   */
  pushSnapshot(snapshot) {
    if (!snapshot || typeof snapshot.serverTimestamp !== 'number') return false;

    const seq = snapshot.sequenceNumber ?? (this.latestSequenceNumber + 1);
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());

    // Packet loss & out-of-order detection
    if (this.latestSequenceNumber >= 0) {
      if (seq <= this.latestSequenceNumber) {
        // Stale or duplicate packet
        this.diagnostics.packetsDropped++;
        return false;
      }
      const gap = seq - this.latestSequenceNumber - 1;
      if (gap > 0) {
        this.diagnostics.packetsDropped += gap;
      }
    }

    this.latestSequenceNumber = seq;
    this.latestServerTimestamp = snapshot.serverTimestamp;
    this.diagnostics.snapshotsReceived++;
    this.diagnostics.serverSimulationTick = snapshot.simulationTick ?? this.diagnostics.serverSimulationTick;

    // Jitter calculation
    if (this._lastPacketArrivalTime > 0) {
      const interval = now - this._lastPacketArrivalTime;
      this._packetArrivalIntervals.push(interval);
      if (this._packetArrivalIntervals.length > 20) this._packetArrivalIntervals.shift();
      const avg = this._packetArrivalIntervals.reduce((a, b) => a + b, 0) / this._packetArrivalIntervals.length;
      const variance = this._packetArrivalIntervals.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / this._packetArrivalIntervals.length;
      this.diagnostics.jitterMs = Math.round(Math.sqrt(variance));
    }
    this._lastPacketArrivalTime = now;
    this.lastPacketLocalTime = now;

    // Normalise cars to map keyed by participantId or car id
    const carMap = {};
    if (Array.isArray(snapshot.cars)) {
      for (const c of snapshot.cars) {
        const id = c.participantId || c.id || c.code;
        if (id) carMap[id] = c;
      }
    } else if (snapshot.cars && typeof snapshot.cars === 'object') {
      for (const [k, v] of Object.entries(snapshot.cars)) {
        carMap[k] = v;
      }
    }

    const cleanSnapshot = {
      serverTimestamp: snapshot.serverTimestamp,
      sequenceNumber: seq,
      simulationTick: snapshot.simulationTick ?? 0,
      cars: carMap,
      flags: snapshot.flags || 'green',
      vsc: snapshot.vsc || null,
      safetyCar: snapshot.safetyCar || null
    };

    // Maintain sorted buffer
    this.snapshotBuffer.push(cleanSnapshot);
    this.snapshotBuffer.sort((a, b) => a.serverTimestamp - b.serverTimestamp);

    // Prune expired buffer history
    const oldestAllowed = snapshot.serverTimestamp - this.maxBufferMs;
    while (this.snapshotBuffer.length > 2 && this.snapshotBuffer[0].serverTimestamp < oldestAllowed) {
      this.snapshotBuffer.shift();
    }

    this.diagnostics.bufferDepth = this.snapshotBuffer.length;
    const totalPackets = this.diagnostics.snapshotsReceived + this.diagnostics.packetsDropped;
    this.diagnostics.packetLossPct = totalPackets > 0
      ? Number(((this.diagnostics.packetsDropped / totalPackets) * 100).toFixed(1))
      : 0;

    return true;
  }

  /**
   * Record local ping measurement (round trip time)
   * @param {number} rttMs
   */
  recordPing(rttMs) {
    if (typeof rttMs !== 'number' || rttMs < 0) return;
    this._pingHistory.push(rttMs);
    if (this._pingHistory.length > 10) this._pingHistory.shift();
    this.diagnostics.pingMs = Math.round(this._pingHistory.reduce((a, b) => a + b, 0) / this._pingHistory.length);
  }

  /**
   * Set connection status
   * @param {boolean} isReconnecting
   */
  setReconnecting(isReconnecting) {
    this.diagnostics.isReconnecting = !!isReconnecting;
  }

  /**
   * Interpolate all cars at the target render time.
   * If render time falls between two snapshots: Hermite Spline Interpolation.
   * If render time exceeds the latest snapshot: Dead Reckoning with smooth decay.
   *
   * @param {number} [targetRenderTime] – Explicit server timestamp to render. If omitted, uses (latestServerTimestamp - interpolationDelayMs).
   * @returns {Map<string, { s: number, d: number, lat: number, v: number, heading: number, interpolated: boolean, isDeadReckoning: boolean, confidence: number }>}
   */
  evaluate(targetRenderTime) {
    const results = {};
    Object.defineProperty(results, 'get', {
      value: function(key) { return this[key]; },
      enumerable: false,
      writable: true,
      configurable: true
    });
    Object.defineProperty(results, 'set', {
      value: function(key, val) { this[key] = val; return this; },
      enumerable: false,
      writable: true,
      configurable: true
    });
    if (this.snapshotBuffer.length === 0) return results;

    const renderTime = (typeof targetRenderTime === 'number')
      ? targetRenderTime
      : (this.latestServerTimestamp - this.interpolationDelayMs);

    const L = this.circuitLengthM;

    // Case A: Only 1 snapshot available — static render if at/before snapshot; else project via dead reckoning
    if (this.snapshotBuffer.length === 1 && renderTime <= this.snapshotBuffer[0].serverTimestamp) {
      const snap = this.snapshotBuffer[0];
      for (const [id, car] of Object.entries(snap.cars)) {
        results.set(id, {
          s: car.s ?? 0,
          d: car.s ?? 0,
          lat: car.lat ?? 0,
          v: car.v ?? 0,
          heading: car.heading ?? 0,
          lap: car.lap ?? 1,
          interpolated: false,
          isDeadReckoning: false,
          confidence: 1.0,
          rawCar: car
        });
      }
      return results;
    }

    const firstSnap = this.snapshotBuffer[0];
    const lastSnap = this.snapshotBuffer[this.snapshotBuffer.length - 1];

    // Case B: Render time is older than the oldest snapshot — clamp to oldest
    if (renderTime <= firstSnap.serverTimestamp) {
      for (const [id, car] of Object.entries(firstSnap.cars)) {
        results.set(id, {
          s: car.s ?? 0,
          d: car.s ?? 0,
          lat: car.lat ?? 0,
          v: car.v ?? 0,
          heading: car.heading ?? 0,
          lap: car.lap ?? 1,
          interpolated: false,
          isDeadReckoning: false,
          confidence: 1.0,
          rawCar: car
        });
      }
      return results;
    }

    // Case C: Render time exceeds latest snapshot — Dead Reckoning
    if (renderTime > lastSnap.serverTimestamp) {
      const deltaSec = (renderTime - lastSnap.serverTimestamp) / 1000;
      this.diagnostics.predictionDurationMs = Math.round(deltaSec * 1000);

      // Confidence decays from 1.0 down to 0.0 at maxPredictionMs
      const maxPredSec = this.maxPredictionMs / 1000;
      const confidence = Math.max(0, 1.0 - (deltaSec / maxPredSec));

      for (const [id, car] of Object.entries(lastSnap.cars)) {
        const v = typeof car.v === 'number' ? car.v : 0;
        const a = typeof car.a === 'number' ? car.a : 0;
        const lat = typeof car.lat === 'number' ? car.lat : 0;
        const heading = typeof car.heading === 'number' ? car.heading : 0;

        // Kinematic forward projection: s = s0 + v*dt + 0.5*a*dt^2
        const projectedDist = (v * deltaSec + 0.5 * a * deltaSec * deltaSec) * confidence;
        let sPred = ((car.s ?? 0) + projectedDist) % L;
        if (sPred < 0) sPred += L;

        // Apply reconciliation smoothing if previous offset exists
        let visState = this.carVisualStates.get(id);
        if (!visState) {
          visState = { offsetS: 0, offsetLat: 0 };
          this.carVisualStates.set(id, visState);
        }

        // Decay offset towards zero smoothly
        visState.offsetS *= (1 - this.reconciliationSmoothFactor);
        visState.offsetLat *= (1 - this.reconciliationSmoothFactor);

        let finalS = (sPred + visState.offsetS) % L;
        if (finalS < 0) finalS += L;

        results.set(id, {
          s: finalS,
          d: finalS,
          lat: lat + visState.offsetLat,
          v,
          heading,
          lap: car.lap ?? 1,
          interpolated: true,
          isDeadReckoning: true,
          confidence,
          rawCar: car
        });
      }
      return results;
    }

    // Case D: Render time is between two snapshots — Hermite Spline Interpolation
    this.diagnostics.predictionDurationMs = 0;

    let s0 = firstSnap;
    let s1 = lastSnap;
    for (let i = 0; i < this.snapshotBuffer.length - 1; i++) {
      if (renderTime >= this.snapshotBuffer[i].serverTimestamp && renderTime <= this.snapshotBuffer[i + 1].serverTimestamp) {
        s0 = this.snapshotBuffer[i];
        s1 = this.snapshotBuffer[i + 1];
        break;
      }
    }

    const t0 = s0.serverTimestamp;
    const t1 = s1.serverTimestamp;
    const dt = Math.max(0.001, (t1 - t0) / 1000); // delta in seconds
    const factor = Math.max(0, Math.min(1.0, (renderTime - t0) / (t1 - t0)));

    // Hermite polynomials
    const _h00 = h00(factor);
    const _h10 = h10(factor);
    const _h01 = h01(factor);
    const _h11 = h11(factor);

    // Collect all unique participant IDs from both snapshots
    const allIds = new Set([...Object.keys(s0.cars), ...Object.keys(s1.cars)]);

    for (const id of allIds) {
      const c0 = s0.cars[id];
      const c1 = s1.cars[id];

      if (!c0 && c1) {
        results.set(id, { ...c1, interpolated: false, isDeadReckoning: false, confidence: 1.0, rawCar: c1 });
        continue;
      }
      if (c0 && !c1) {
        results.set(id, { ...c0, interpolated: false, isDeadReckoning: false, confidence: 1.0, rawCar: c0 });
        continue;
      }

      // Unwrap s1.s across the finish line if needed
      const rawS0 = c0.s ?? 0;
      const rawS1 = unwrapDistance(c1.s ?? 0, rawS0, L);

      const v0 = typeof c0.v === 'number' ? c0.v : (rawS1 - rawS0) / dt;
      const v1 = typeof c1.v === 'number' ? c1.v : v0;

      // Hermite position interpolation along track axis s
      // Tangents scaled by interval dt: m0 = v0 * dt, m1 = v1 * dt
      const m0 = v0 * dt;
      const m1 = v1 * dt;
      let interpS = _h00 * rawS0 + _h10 * m0 + _h01 * rawS1 + _h11 * m1;
      interpS = ((interpS % L) + L) % L;

      // Smooth lateral offset (linear / cubic)
      const lat0 = c0.lat ?? 0;
      const lat1 = c1.lat ?? 0;
      const interpLat = lat0 + (lat1 - lat0) * factor;

      // Smooth velocity interpolation
      const interpV = v0 + (v1 - v0) * factor;

      // Smooth angular heading interpolation
      const heading0 = c0.heading ?? 0;
      const heading1 = c1.heading ?? heading0;
      const interpHeading = interpolateAngle(heading0, heading1, factor);

      // Reconciliation smoothing check
      let visState = this.carVisualStates.get(id);
      if (!visState) {
        visState = { offsetS: 0, offsetLat: 0 };
        this.carVisualStates.set(id, visState);
      }

      // Compute correction magnitude if a discrepancy was smoothed
      const correction = Math.abs(visState.offsetS);
      if (correction > this.diagnostics.correctionMagnitudeM) {
        this.diagnostics.correctionMagnitudeM = Number(correction.toFixed(2));
      }
      visState.offsetS *= (1 - this.reconciliationSmoothFactor);
      visState.offsetLat *= (1 - this.reconciliationSmoothFactor);

      let finalS = (interpS + visState.offsetS) % L;
      if (finalS < 0) finalS += L;

      results.set(id, {
        s: finalS,
        d: finalS,
        lat: interpLat + visState.offsetLat,
        v: interpV,
        heading: interpHeading,
        lap: (factor > 0.5 ? (c1.lap ?? c0.lap) : c0.lap) ?? 1,
        interpolated: true,
        isDeadReckoning: false,
        confidence: 1.0,
        rawCar: factor > 0.5 ? c1 : c0
      });
    }

    return results;
  }

  /**
   * Reconcile local car visual state against incoming authoritative position.
   * Smooths the correction offset over subsequent frames to eliminate visual snapping.
   *
   * @param {string} participantId
   * @param {number} authoritativeS
   * @param {number} authoritativeLat
   * @param {number} renderedS
   * @param {number} renderedLat
   */
  reconcile(participantId, authoritativeS, authoritativeLat, renderedS, renderedLat) {
    const L = this.circuitLengthM;
    let diffS = authoritativeS - renderedS;
    if (diffS > L * 0.5) diffS -= L;
    if (diffS < -L * 0.5) diffS += L;

    const diffLat = authoritativeLat - renderedLat;

    // Small discrepancies (< 0.1m) require no correction
    if (Math.abs(diffS) < 0.1 && Math.abs(diffLat) < 0.05) return;

    // Hard clamp extreme discrepancies (> 25m e.g. respawn or teleport)
    if (Math.abs(diffS) > 25) {
      this.carVisualStates.set(participantId, { offsetS: 0, offsetLat: 0 });
      return;
    }

    let visState = this.carVisualStates.get(participantId);
    if (!visState) {
      visState = { offsetS: 0, offsetLat: 0 };
      this.carVisualStates.set(participantId, visState);
    }

    // Set residual offset to be smoothed out over future frames
    visState.offsetS = diffS;
    visState.offsetLat = diffLat;
  }

  /** Retrieve full network diagnostics snapshot */
  getDiagnostics() {
    const oldest = this.snapshotBuffer[0]?.serverTimestamp || 0;
    const latest = this.snapshotBuffer[this.snapshotBuffer.length - 1]?.serverTimestamp || 0;
    const bufferDurationMs = Math.max(0, latest - oldest);

    return {
      ...this.diagnostics,
      snapshotBufferDepth: this.snapshotBuffer.length,
      bufferDepth: this.snapshotBuffer.length,
      bufferDurationMs,
      packetLossRate: this.diagnostics.packetLossPct,
      reconnectionStatus: this.diagnostics.isReconnecting ? 'reconnecting' : 'connected',
      lastServerTick: this.diagnostics.serverSimulationTick,
      lastSequenceNumber: this.latestSequenceNumber,
      lastServerTimestamp: this.latestServerTimestamp
    };
  }
}
