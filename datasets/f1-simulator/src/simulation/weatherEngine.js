/**
 * weatherEngine.js
 * Dynamic Meteorological Simulation & Weather Radar.
 *
 * Implements:
 *   - Weather states: Dry, Light Rain, Moderate Rain, Heavy Monsoon
 *   - Continuous rainfall intensity (0.0 to 1.0)
 *   - Pre-configured dynamic weather scenarios (Incoming Shower, Drying, Monsoon)
 *   - Ambient and track temperature coupling
 *   - Weather radar forecast projecting conditions 2, 5, and 10 minutes ahead
 *   - User-configurable weather controls
 */

export const WeatherPresets = {
  DRY: {
    id: 'dry',
    name: 'Bone Dry',
    description: 'Clear sunny skies, high track temperature.',
    ambientTemp: 27,
    trackTemp: 42,
    fn: (t) => 0.0
  },
  INCOMING_SHOWER: {
    id: 'incoming_shower',
    name: 'Incoming Shower',
    description: 'Starts dry, rain arrives around lap 2-3, tapering off towards the finish.',
    ambientTemp: 23,
    trackTemp: 34,
    fn: (t) => {
      // t is race time in seconds
      if (t < 90) return 0.0;
      if (t < 160) return (t - 90) / 70 * 0.45; // rising light rain
      if (t < 280) return 0.45 + Math.sin((t - 160) / 40) * 0.25; // moderate shower
      if (t < 380) return Math.max(0, 0.55 - (t - 280) / 100 * 0.55); // tapering off
      return 0.0;
    }
  },
  DRYING_TRACK: {
    id: 'drying_track',
    name: 'Drying Track',
    description: 'Race begins under wet conditions, rain stops, track dries progressively.',
    ambientTemp: 20,
    trackTemp: 26,
    fn: (t) => {
      if (t < 60) return 0.70;
      if (t < 140) return Math.max(0, 0.70 - (t - 60) / 80 * 0.70);
      return 0.0;
    }
  },
  DYNAMIC_MONSOON: {
    id: 'dynamic_monsoon',
    name: 'Tropical Monsoon',
    description: 'Violent fluctuations in rainfall intensity testing strategy and safety.',
    ambientTemp: 26,
    trackTemp: 30,
    fn: (t) => {
      const wave1 = Math.sin(t / 80) * 0.45;
      const wave2 = Math.cos(t / 45) * 0.25;
      return Math.max(0, Math.min(1.0, 0.50 + wave1 + wave2));
    }
  },
  FULL_WET: {
    id: 'full_wet',
    name: 'Persistent Heavy Rain',
    description: 'Saturated conditions throughout, full wet tyres mandatory.',
    ambientTemp: 18,
    trackTemp: 22,
    fn: (t) => 0.85 + Math.sin(t / 50) * 0.10
  }
};

export class WeatherEngine {
  /**
   * @param {string} initialPreset – key of WeatherPresets
   */
  constructor(initialPreset = 'INCOMING_SHOWER') {
    const key = (initialPreset || 'INCOMING_SHOWER').toUpperCase();
    this.presetKey = key in WeatherPresets ? key : 'INCOMING_SHOWER';
    this.preset = WeatherPresets[this.presetKey] || WeatherPresets.DRY;

    this.rainIntensity = 0.0;   // 0.0 .. 1.0
    this.ambientTemp = this.preset.ambientTemp;
    this.trackTemp = this.preset.trackTemp;
    this.manualOverride = false;
    this.simTime = 0;
  }

  /** Set a new weather preset */
  setPreset(key) {
    const uKey = (key || '').toUpperCase();
    if (WeatherPresets[uKey]) {
      this.presetKey = uKey;
      this.preset = WeatherPresets[uKey];
      this.manualOverride = false;
    }
  }

  /** Set manual rain intensity (disables auto-timeline until reset) */
  setManualRain(intensity) {
    this.rainIntensity = Math.max(0, Math.min(1.0, intensity));
    this.manualOverride = true;
  }

  /**
   * Advance weather evolution by dt seconds.
   *
   * @param {number} dt – elapsed seconds
   * @param {number} simTime – total elapsed race time
   * @returns {object} { rainIntensity, weatherLabel, ambientTemp, trackTemp }
   */
  update(dt, simTime) {
    this.simTime = simTime;

    if (!this.manualOverride) {
      this.rainIntensity = this.preset.fn(simTime);
    }

    // Couple ambient temperature slightly with rain
    this.ambientTemp = this.preset.ambientTemp - this.rainIntensity * 4.0;

    return {
      rainIntensity: this.rainIntensity,
      weatherLabel: this.weatherLabel,
      ambientTemp: Math.round(this.ambientTemp),
      trackTemp: Math.round(this.trackTemp),
      isRaining: this.rainIntensity > 0.05
    };
  }

  /** Human-readable status label */
  get weatherLabel() {
    if (this.rainIntensity < 0.05) return 'Dry';
    if (this.rainIntensity < 0.30) return 'Light Rain';
    if (this.rainIntensity < 0.65) return 'Moderate Rain';
    return 'Heavy Monsoon';
  }

  /**
   * Generate weather radar forecast projecting upcoming conditions.
   *
   * @param {number} aheadSeconds – time ahead from now
   * @returns {object} { timeAhead, rainIntensity, label, recommendedCompound }
   */
  getForecast(aheadSeconds = 180) {
    const futureTime = this.simTime + aheadSeconds;
    const futureRain = this.manualOverride ? this.rainIntensity : this.preset.fn(futureTime);

    let recCompound = 'medium';
    if (futureRain > 0.60) recCompound = 'wet';
    else if (futureRain > 0.18) recCompound = 'intermediate';

    return {
      aheadMin: Math.round(aheadSeconds / 60),
      rainIntensity: futureRain,
      label: futureRain < 0.05 ? 'Dry' : (futureRain < 0.30 ? 'Light Rain' : (futureRain < 0.65 ? 'Moderate' : 'Heavy')),
      recommendedCompound: recCompound
    };
  }
}
