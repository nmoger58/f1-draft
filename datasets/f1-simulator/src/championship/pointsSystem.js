/**
 * pointsSystem.js
 * Official FIA Formula 1 Scoring and Classification Regulations.
 *
 * Implements:
 *   - Standard FIA 25-18-15-12-10-8-6-4-2-1 points scale for top 10 finishers
 *   - Fastest lap bonus (+1 point), strictly validated for top 10 finishers only
 *   - Official FIA tie-breaking criteria (most 1st places, then 2nd places, etc.)
 *   - Constructor standings aggregation across both team drivers
 */

export const FIA_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

export class PointsSystem {
  /**
   * Calculate points awarded for a single race result.
   *
   * @param {number} finishPos     – finishing position (1-based: 1 to 20)
   * @param {boolean} hasFastestLap – whether this driver set the fastest lap of the race
   * @param {boolean} bonusEnabled  – whether fastest lap bonus is active in regulations
   * @returns {object} { basePoints, bonusPoints, totalPoints, explanation }
   */
  static getPointsForFinish(finishPos, hasFastestLap = false, bonusEnabled = true) {
    const base = (finishPos >= 1 && finishPos <= 10) ? FIA_POINTS[finishPos - 1] : 0;
    // FIA Article: +1 point awarded only if driver is classified in top 10
    const bonus = (hasFastestLap && bonusEnabled && finishPos >= 1 && finishPos <= 10) ? 1 : 0;
    const total = base + bonus;

    let explanation = base > 0 ? `P${finishPos}: ${base} pts` : `P${finishPos}: 0 pts`;
    if (bonus > 0) explanation += ` + 1 pt (Fastest Lap)`;

    return {
      basePoints: base,
      bonusPoints: bonus,
      totalPoints: total,
      explanation
    };
  }

  /**
   * Sort driver standings applying official FIA tie-breaking logic.
   * Criteria:
   *   1. Total points (descending)
   *   2. Number of 1st places (wins)
   *   3. Number of 2nd places
   *   4. Number of 3rd places
   *   5. Best finishing position achieved
   *
   * @param {object[]} standings – array of driver standings objects
   * @returns {object[]} sorted standings with position 1..N and gap to leader
   */
  static sortDriverStandings(standings) {
    const sorted = [...standings].sort((a, b) => {
      // 1. Total points
      if (b.points !== a.points) return b.points - a.points;

      // 2. Wins (1st places)
      if ((b.wins || 0) !== (a.wins || 0)) return (b.wins || 0) - (a.wins || 0);

      // 3. Podiums (top 3 finishes)
      if ((b.podiums || 0) !== (a.podiums || 0)) return (b.podiums || 0) - (a.podiums || 0);

      // 4. Detailed count of finish positions if history is available
      if (a.finishCounts && b.finishCounts) {
        for (let pos = 1; pos <= 20; pos++) {
          const countA = a.finishCounts[pos] || 0;
          const countB = b.finishCounts[pos] || 0;
          if (countB !== countA) return countB - countA;
        }
      }

      // 5. Best finish position (lower is better: 1 > 2)
      const bestA = a.bestFinish ?? 99;
      const bestB = b.bestFinish ?? 99;
      if (bestA !== bestB) return bestA - bestB;

      // Fallback: driver name alphabetical
      return (a.name || '').localeCompare(b.name || '');
    });

    const leaderPts = sorted[0]?.points || 0;
    sorted.forEach((item, idx) => {
      item.position = idx + 1;
      item.gapToLeader = idx === 0 ? 0 : leaderPts - item.points;
    });

    return sorted;
  }

  /**
   * Aggregate constructor standings from driver standings.
   *
   * @param {object[]} driverStandings
   * @returns {object[]} sorted constructor standings
   */
  static computeConstructorStandings(driverStandings) {
    const teamsMap = new Map();

    driverStandings.forEach(d => {
      const teamName = d.team || 'Independent';
      if (!teamsMap.has(teamName)) {
        teamsMap.set(teamName, {
          team: teamName,
          points: 0,
          wins: 0,
          podiums: 0,
          drivers: []
        });
      }
      const t = teamsMap.get(teamName);
      t.points += d.points || 0;
      t.wins += d.wins || 0;
      t.podiums += d.podiums || 0;
      t.drivers.push(d.name || d.driverCode);
    });

    const list = Array.from(teamsMap.values()).sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (b.podiums !== a.podiums) return b.podiums - a.podiums;
      return a.team.localeCompare(b.team);
    });

    const leaderPts = list[0]?.points || 0;
    list.forEach((item, idx) => {
      item.position = idx + 1;
      item.gapToLeader = idx === 0 ? 0 : leaderPts - item.points;
    });

    return list;
  }
}
