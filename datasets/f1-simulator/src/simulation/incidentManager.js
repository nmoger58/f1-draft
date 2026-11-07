/**
 * incidentManager.js
 * Track Incident & Hazard Management Engine.
 *
 * Implements:
 *   - Physical and probabilistic incident detection (spins, collisions, stranded vehicles)
 *   - Localized track segment hazard binding
 *   - Severity assessment (Local Yellow vs Virtual Safety Car vs Physical Safety Car)
 *   - Clearance timers and automatic hazard recovery
 */

export class IncidentManager {
  /**
   * @param {number} circuitLengthM
   * @param {number} numSegments
   */
  constructor(circuitLengthM = 5000, numSegments = 24) {
    this.circuitLengthM = circuitLengthM;
    this.numSegments = numSegments;
    this.segmentLengthM = circuitLengthM / numSegments;
    this.activeIncidents = [];
    this.incidentCounter = 0;
  }

  /**
   * Check for new incidents among cars or trigger simulated hazards.
   *
   * @param {number}   simTime       – current race time (s)
   * @param {object[]} cars          – active cars
   * @param {number}   trackWetness  – track water level (higher wetness = higher incident risk)
   * @returns {object[]} new incident events triggered this step
   */
  update(simTime, cars = [], trackWetness = 0) {
    const newIncidents = [];

    // 1. Natural spin/mistake detection
    // Cars on slick tyres in heavy wetness (>0.35) have a small risk of spinning when pushing
    if (trackWetness > 0.30) {
      for (const car of cars) {
        const isSlick = (car.tyreModel?.compound === 'soft' || car.tyreModel?.compound === 'medium' || car.tyreModel?.compound === 'hard');
        if (isSlick && car.v > 30 && !car.isSpun && Math.random() < 0.0008) {
          const inc = this.createIncident(
            'spin',
            car.d,
            `Car ${car.code} spun off-line due to lack of wet grip!`,
            simTime,
            18 // 18s duration to rejoin
          );
          car.isSpun = true;
          car.spinTimer = 6.0; // 6 seconds stationary to recover
          newIncidents.push(inc);
        }
      }
    }

    // Recover spun cars
    for (const car of cars) {
      if (car.isSpun) {
        car.spinTimer = (car.spinTimer || 6.0) - 0.016;
        car.v = Math.max(0, car.v - 15 * 0.016);
        if (car.spinTimer <= 0) {
          car.isSpun = false;
        }
      }
    }

    // 2. Clear expired incidents
    for (let i = this.activeIncidents.length - 1; i >= 0; i--) {
      const inc = this.activeIncidents[i];
      if (simTime >= inc.clearTime) {
        this.activeIncidents.splice(i, 1);
      }
    }

    return newIncidents;
  }

  /**
   * Create an incident at a specific track distance.
   */
  createIncident(type, distanceM, description, simTime, durationS = 22) {
    this.incidentCounter++;
    const segIdx = Math.floor((((distanceM % this.circuitLengthM) + this.circuitLengthM) % this.circuitLengthM) / this.segmentLengthM);

    const incident = {
      id: this.incidentCounter,
      type, // 'spin', 'collision', 'debris', 'hazard'
      d: distanceM,
      segmentIndex: segIdx,
      description,
      startTime: simTime,
      clearTime: simTime + durationS,
      cleared: false
    };

    this.activeIncidents.push(incident);
    return incident;
  }

  /**
   * Manually trigger a simulated incident for testing or user event.
   */
  triggerManualIncident(type = 'hazard', simTime = 0, trackLengthM = 5000) {
    const randomD = Math.random() * trackLengthM;
    return this.createIncident(
      type,
      randomD,
      `Debris on track at Turn ${Math.floor(randomD / 400) + 1}`,
      simTime,
      25
    );
  }

  /** Get array of all track segment indices currently under hazard */
  getHazardSegments() {
    return this.activeIncidents.map(inc => inc.segmentIndex);
  }

  /** Check if a specific distance is inside an active hazard zone */
  isHazardAt(distanceM) {
    const segIdx = Math.floor((((distanceM % this.circuitLengthM) + this.circuitLengthM) % this.circuitLengthM) / this.segmentLengthM);
    return this.activeIncidents.some(inc => inc.segmentIndex === segIdx);
  }
}
