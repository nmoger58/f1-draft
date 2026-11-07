/**
 * trackWidthConfig.js
 * Authoritative Track Width Configurations & Segment Profiles (Phase 2).
 *
 * Defines realistic, proportional track widths (scaled by circuit factor k):
 *   - Base width: standard asphalt width across the lap
 *   - Straight bonus: widened passing lanes on straights and DRS zones
 *   - Braking bonus: wide entry corridors into heavy braking zones
 *   - Minimum corner width: authentic tighter width in hairpins/chicanes while ensuring
 *     at least 2 full cars + safety margin (>= 22k) can run side-by-side
 *   - Segment-specific width overrides for famous circuit sections (e.g. Baku Castle, Monaco Tunnel)
 */

export const TRACK_WIDTH_PROFILES = {
  // Monaco: Tight street circuit, but widened from original 19k to 22-25k to allow genuine passing
  monaco: {
    baseWidth: 23.0,
    straightBonus: 3.0,     // Tunnel & harbour straight ~26k
    brakingBonus: 2.0,      // Sainte Devote & Nouvelle chicane braking zones
    minCornerWidth: 21.0,   // Fairmont Hairpin & Rascasse
    segmentOverrides: [
      { startD: 1100, endD: 1550, width: 26.5 }, // Monaco Tunnel & Nouvelle Chicane entry
      { startD: 2100, endD: 2500, width: 24.5 }, // Swimming Pool section
      { startD: 3100, endD: 3337, width: 25.5 }, // Anthony Noghes to Main Straight
    ]
  },

  // Silverstone: Wide modern FIA Grade 1 former airfield circuit (15-17m)
  silverstone: {
    baseWidth: 28.5,
    straightBonus: 4.5,     // Hangar Straight & Wellington Straight up to 33k (3-wide racing!)
    brakingBonus: 3.5,      // Brooklands & Stowe braking zones
    minCornerWidth: 25.0,   // Village & Club complex
    segmentOverrides: [
      { startD: 1800, endD: 2600, width: 33.0 }, // Wellington Straight into Brooklands
      { startD: 3800, endD: 4700, width: 33.5 }, // Hangar Straight into Stowe
    ]
  },

  // Spa-Francorchamps: Flowing Ardennes circuit (14-16m)
  spa: {
    baseWidth: 28.0,
    straightBonus: 4.0,     // Kemmel Straight & Blanchimont up to 32k
    brakingBonus: 3.0,      // Les Combes & Bus Stop chicane entries
    minCornerWidth: 24.0,   // La Source hairpin
    segmentOverrides: [
      { startD: 800, endD: 2100, width: 32.5 },  // Kemmel Straight to Les Combes
      { startD: 5800, endD: 6800, width: 32.0 }, // Blanchimont to Bus Stop chicane
    ]
  },

  // Monza: Temple of Speed with wide slipstream straights and chicane braking zones
  monza: {
    baseWidth: 27.5,
    straightBonus: 4.5,     // Rettifilo Straight, Curva Grande, Serraglio up to 32k
    brakingBonus: 3.5,      // Prima Variante & Variante della Roggia braking zones
    minCornerWidth: 23.5,   // Tight chicanes
    segmentOverrides: [
      { startD: 0, endD: 800, width: 32.5 },     // Main Straight into Prima Variante Turn 1
      { startD: 1900, endD: 2600, width: 31.0 }, // Curva Grande into Roggia
      { startD: 4200, endD: 5100, width: 32.0 }, // Straight into Parabolica (Curva Alboreto)
    ]
  },

  // Singapore: High-speed modern waterfront street circuit
  singapore: {
    baseWidth: 25.5,
    straightBonus: 3.5,     // Raffles Boulevard straight up to 29k
    brakingBonus: 2.5,      // Turn 1, Turn 7, and Turn 14 braking zones
    minCornerWidth: 22.0,   // Anderson Bridge & Padang section
    segmentOverrides: [
      { startD: 1200, endD: 2100, width: 29.5 }, // Raffles Boulevard long straight
      { startD: 3200, endD: 3800, width: 28.0 }, // Waterfront DRS straight
    ]
  },

  // Suzuka: High-speed figure-8 demanding precise lateral positioning
  suzuka: {
    baseWidth: 26.5,
    straightBonus: 3.5,     // Pit Straight & back straight through 130R up to 30k
    brakingBonus: 3.0,      // Casio Triangle & Turn 1 braking zones
    minCornerWidth: 23.0,   // Hairpin & Degner corners
    segmentOverrides: [
      { startD: 0, endD: 700, width: 31.0 },     // Main Pit Straight into Turn 1/2
      { startD: 4300, endD: 5200, width: 31.5 }, // Back straight through 130R into Casio Triangle
    ]
  },

  // Interlagos: Undulating Brazilian circuit with wide overtaking into Senna S
  interlagos: {
    baseWidth: 27.0,
    straightBonus: 4.0,     // Reta Oposta & Main Straight up to 31k
    brakingBonus: 3.5,      // Senna S (Turn 1) and Descida do Lago (Turn 4)
    minCornerWidth: 23.5,   // Bico de Pato & Junção
    segmentOverrides: [
      { startD: 3500, endD: 4309, width: 32.0 }, // Subida dos Boxes & Main Straight
      { startD: 0, endD: 650, width: 31.5 },     // Senna S entry & Curva do Sol
      { startD: 1100, endD: 1900, width: 31.0 }, // Reta Oposta into Turn 4
    ]
  },

  // Baku: Extreme contrast between wide waterfront straight and narrow old city
  baku: {
    baseWidth: 27.5,
    straightBonus: 5.0,     // 2.2 km Neftchilar Avenue main straight up to 33k (widest in F1!)
    brakingBonus: 3.5,      // Turn 1 and Turn 3 heavy braking zones
    minCornerWidth: 21.0,   // Icheri Sheher Castle section
    segmentOverrides: [
      { startD: 4100, endD: 6003, width: 33.5 }, // 2.2km waterfront straight
      { startD: 1800, endD: 2400, width: 21.0 }, // Castle section (authentic tighter width, but safe for 2 cars)
    ]
  },

  // Default fallback profile
  default: {
    baseWidth: 27.0,
    straightBonus: 3.5,
    brakingBonus: 2.5,
    minCornerWidth: 23.0,
    segmentOverrides: []
  }
};

/**
 * Retrieve width profile for a circuit id.
 * @param {string} circuitId
 * @returns {object}
 */
export function getTrackWidthProfile(circuitId) {
  return TRACK_WIDTH_PROFILES[circuitId] || TRACK_WIDTH_PROFILES.default;
}

export const getTrackWidthConfig = getTrackWidthProfile;
