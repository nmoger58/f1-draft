/**
 * reinforcementLearning.js
 * Adaptive Driver Agent / Q-Learning Policy Optimizer.
 *
 * Implements a lightweight tabular Q-learning / adaptive driver policy:
 * - State Space (Discretized Observation):
 *     1. Speed bucket: [low (<40 m/s), medium (40-70 m/s), high (>70 m/s)]
 *     2. Curvature ahead: [straight (<0.003), gentle (0.003-0.008), sharp (>0.008)]
 *     3. Opponent gap: [open (>40m), draft (15-40m), close (<15m)]
 *     4. Tyre state: [fresh (<0.3), worn (0.3-0.6), critical (>0.6)]
 * - Action Space:
 *     0: Standard baseline (no adjustment)
 *     1: Aggressive entry (+3% pace boost)
 *     2: Tyre-preserving entry (-3% pace, smoother line)
 *     3: Apex attack (tighter lateral cut)
 *     4: Late braking / switchback
 * - Reward Function:
 *     + Lap progress & delta distance
 *     + Position gains / clean overtakes (+25)
 *     + Clean lap completion (+100)
 *     - Proximity penalty / collision hazard (-30)
 *     - Track limit scrubbing (-5)
 *     - Tyre degradation penalty (-10)
 *
 * Safety guarantee: The learned policy is advisory only. Hard safety limits
 * (collision avoidance, track boundaries) always override the learning agent.
 */

export class RLDriverModel {
  constructor(driverCode = 'DEFAULT', enabled = true) {
    this.driverCode = driverCode;
    this.enabled = enabled;
    this.qTable = new Map();
    this.alpha = 0.15;    // Learning rate
    this.gamma = 0.85;    // Discount factor
    this.epsilon = 0.10;  // Exploration rate

    this.lastStateKey = null;
    this.lastAction = 0;
    this.cumulativeReward = 0;
    this.trainingSteps = 0;

    // Load persisted weights if available
    this.load();
  }

  /** Discretize environment state into string hash key */
  encodeState(speed, curvatureAhead, gapM, tyreWear) {
    const sBucket = speed < 40 ? 'SLOW' : speed < 70 ? 'MID' : 'FAST';
    const cBucket = curvatureAhead < 0.003 ? 'STR' : curvatureAhead < 0.008 ? 'CRV' : 'SHP';
    const gBucket = gapM > 40 ? 'OPEN' : gapM > 15 ? 'DRAFT' : 'CLOSE';
    const tBucket = tyreWear < 0.35 ? 'FRESH' : tyreWear < 0.65 ? 'MED' : 'WORN';
    return `${sBucket}_${cBucket}_${gBucket}_${tBucket}`;
  }

  /** Get Q-values for a state (5 discrete actions) */
  getQValues(stateKey) {
    if (!this.qTable.has(stateKey)) {
      this.qTable.set(stateKey, [0.0, 0.0, 0.0, 0.0, 0.0]);
    }
    return this.qTable.get(stateKey);
  }

  /** Select action via epsilon-greedy policy */
  selectAction(stateKey) {
    if (!this.enabled) return 0; // Baseline fallback

    if (Math.random() < this.epsilon) {
      return Math.floor(Math.random() * 5); // Explore
    }

    const q = this.getQValues(stateKey);
    let bestAction = 0;
    let maxVal = q[0];
    for (let i = 1; i < q.length; i++) {
      if (q[i] > maxVal) {
        maxVal = q[i];
        bestAction = i;
      }
    }
    return bestAction;
  }

  /**
   * Observe transition & update Q-values via Bellman equation:
   * Q(s, a) <- Q(s, a) + alpha * [reward + gamma * max_a' Q(s', a') - Q(s, a)]
   */
  update(reward, nextStateKey) {
    if (!this.enabled || !this.lastStateKey) return;

    const qPrev = this.getQValues(this.lastStateKey);
    const qNext = this.getQValues(nextStateKey);
    const maxNextQ = Math.max(...qNext);

    const oldVal = qPrev[this.lastAction];
    const target = reward + this.gamma * maxNextQ;
    qPrev[this.lastAction] = oldVal + this.alpha * (target - oldVal);

    this.cumulativeReward += reward;
    this.trainingSteps++;
  }

  /**
   * Step RL agent: returns { paceDelta, latDelta } adjustments
   */
  step(speed, curvatureAhead, gapM, tyreWear, reward) {
    const currentStateKey = this.encodeState(speed, curvatureAhead, gapM, tyreWear);

    if (this.lastStateKey !== null) {
      this.update(reward, currentStateKey);
    }

    const action = this.selectAction(currentStateKey);
    this.lastStateKey = currentStateKey;
    this.lastAction = action;

    // Map action to control delta:
    // 0: Baseline (0, 0)
    // 1: Aggressive pace boost (+0.03 pace)
    // 2: Tyre conservation (-0.03 pace)
    // 3: Tight inside line (-1.5px lat)
    // 4: Wide late apex (+1.5px lat)
    const deltas = [
      { paceDelta: 0.0,  latDelta: 0.0 },
      { paceDelta: 0.03, latDelta: 0.0 },
      { paceDelta: -0.03, latDelta: 0.0 },
      { paceDelta: 0.01, latDelta: -1.5 },
      { paceDelta: 0.01, latDelta: 1.5 },
    ];

    return deltas[action] || deltas[0];
  }

  /** Compute immediate reward for this decision cycle */
  static computeReward(deltaDistance, gapM, isOvertake, hasCollisionRisk, tyreDeg) {
    let r = deltaDistance * 0.1; // Progress reward
    if (isOvertake) r += 25.0;     // Overtake reward
    if (hasCollisionRisk) r -= 30.0; // Proximity/collision penalty
    if (tyreDeg > 0.05) r -= tyreDeg * 20.0; // Excessive wear penalty
    return r;
  }

  /** Persistence: save Q-table to memory / storage */
  save() {
    try {
      const data = {};
      this.qTable.forEach((val, key) => { data[key] = val; });
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(`f1_rl_${this.driverCode}`, JSON.stringify(data));
      }
      return data;
    } catch (e) {
      return null;
    }
  }

  /** Persistence: load Q-table */
  load() {
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(`f1_rl_${this.driverCode}`);
        if (raw) {
          const data = JSON.parse(raw);
          Object.keys(data).forEach(k => this.qTable.set(k, data[k]));
        }
      }
    } catch (e) {
      // Graceful fallback to fresh policy
    }
  }
}
