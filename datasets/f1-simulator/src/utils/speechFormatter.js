/**
 * speechFormatter.js
 * Centralized Natural Speech Formatter for Formula 1 Commentary & Team Radio.
 *
 * Transforms raw simulation data, compact broadcast strings, and dialogue templates
 * into natural, fluent English formatted specifically for Text-to-Speech (TTS) engines
 * (Web Speech API / SpeechSynthesis).
 *
 * Strict Architectural Separation:
 *   1. Raw Simulation Value: 12.345
 *   2. Compact UI Display:  "12.3s" or "+1.2s"
 *   3. Human Visible Msg:   "Gap to Max Verstappen is +1.2s"
 *   4. Spoken Speech Output:"Gap to Max Verstappen is plus 1.2 seconds"
 *
 * Standards:
 *   - British English spelling ("kilometres", "metres", "degrees Celsius")
 *   - Explicit duration phrasing ("1 second", "12 seconds", "1 minute 20 seconds")
 *   - Signed delta phrasing ("plus 1.234 seconds", "minus 0.500 seconds")
 *   - Motorsport acronym hyphenation ("D-R-S", "V-S-C", "Safety Car")
 *   - Natural lap time pronunciation ("one minute, thirty-two point four five six seconds")
 *   - Lap number phrasing ("lap twelve")
 *   - Position phrasing ("first place" / "position 1")
 *   - Anti-double-expansion guards (never outputs "12 seconds seconds")
 *   - Safe handling of raw placeholders, undefined, null, NaN, and UI symbols
 */

import { resolveDriverFullName } from './driverResolver.js';

// Number words 0 - 99 for natural speech
const SMALL_NUMBERS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen'
];

const TENS = [
  '', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'
];

/**
 * Convert integer (0-99) to spoken English words.
 */
export function integerToWords(num) {
  const n = Math.floor(Math.abs(num));
  if (n < 20) return SMALL_NUMBERS[n] || String(n);
  if (n < 100) {
    const ten = Math.floor(n / 10);
    const rem = n % 10;
    return rem > 0 ? `${TENS[ten]}-${SMALL_NUMBERS[rem]}` : TENS[ten];
  }
  return String(n);
}

/**
 * Convert decimal part to digit-by-digit spoken words (e.g. .456 -> "point four five six").
 */
export function decimalDigitsToWords(decimalStr) {
  const digits = decimalStr.replace(/^0*\./, '').split('');
  const spoken = digits.map(d => SMALL_NUMBERS[parseInt(d, 10)] || d).join(' ');
  return `point ${spoken}`;
}

/**
 * Format a lap time string (e.g. "1:32.456") to natural spoken words.
 * Example: "1:32.456" -> "one minute, thirty-two point four five six seconds"
 * (or "1 minute, 32.456 seconds")
 */
export function formatLapTimeForSpeech(lapTimeStr) {
  if (!lapTimeStr || typeof lapTimeStr !== 'string') return '';
  const match = lapTimeStr.trim().match(/^(\d+):([0-5]?\d)(?:\.(\d+))?$/);
  if (!match) return lapTimeStr;

  const min = parseInt(match[1], 10);
  const sec = parseInt(match[2], 10);
  const frac = match[3] || '';

  const minWord = min === 1 ? 'one minute' : `${integerToWords(min)} minutes`;
  const secWord = integerToWords(sec);

  if (frac) {
    const fracWords = decimalDigitsToWords(frac);
    return `${minWord}, ${secWord} ${fracWords} seconds`;
  }
  return `${minWord}, ${secWord} seconds`;
}

/**
 * Pronunciation map for motorsport terms and driver names that TTS engines often mangle.
 */
const PRONUNCIATION_MAP = [
  // Acronyms (hyphenated so TTS spells out letters distinctly)
  [/\bDRS\b/g, 'D-R-S'],
  [/\bVSC\b/g, 'V-S-C'],
  [/\bFIA\b/g, 'F-I-A'],
  [/\bDNF\b/g, 'D-N-F'],
  [/\bFL\b/g, 'fastest lap'],

  // Safety Car abbreviations
  [/\bSC deployed\b/gi, 'Safety Car deployed'],
  [/\bSC in this lap\b/gi, 'Safety Car in this lap'],
  [/\bSC delta\b/gi, 'Safety Car delta'],
  [/\bSC ending\b/gi, 'Safety Car ending'],
  [/\bVirtual SC\b/gi, 'Virtual Safety Car'],
  [/\bPhysical SC\b/gi, 'Physical Safety Car'],
  [/\bSC\b(?=\s+is|\s+period|\s+restart|\s+window|\s+board)/gi, 'Safety Car'],

  // Driver name phonetic aids
  [/\bHülkenberg\b/g, 'Hulkenberg'],
  [/\bHulkenberg\b/g, 'Hool-ken-berg'],
  [/\bLeclerc\b/g, 'Le-clerk'],
  [/\bAntonelli\b/g, 'An-toe-nel-li'],
  [/\bColapinto\b/g, 'Col-ah-pin-toe'],
  [/\bBortoleto\b/g, 'Bor-toe-let-toe'],
  [/\bTsunoda\b/g, 'Tsoo-no-da'],
  [/\bRäikkönen\b/g, 'Raikkonen'],
  [/\bPérez\b/g, 'Perez'],
  [/\bMonégasque\b/g, 'Monegasque']
];

/**
 * Format any race text for natural speech pronunciation.
 *
 * @param {string} text – Input dialogue, telemetry label, or broadcast commentary
 * @param {object} [context={}] – Optional contextual hints:
 *   {
 *     type: 'duration' | 'gap' | 'lap_time' | 'countdown' | 'commentary' | 'radio',
 *     driver: string | object,
 *     carAhead: object,
 *     carBehind: object
 *   }
 * @returns {string} Fully formatted natural spoken text
 */
export function formatForSpeech(text, context = {}) {
  if (!text || typeof text !== 'string') return '';

  let spoken = text.trim();

  // 1. Guard rails: Strip or resolve raw curly bracket placeholders
  spoken = spoken.replace(/\{(\w+)\}/g, (match, key) => {
    const k = key.toLowerCase();
    if (context[k]) {
      return resolveDriverFullName(context[k], 'the driver');
    }
    if (k === 'driver' || k === 'overtaker' || k === 'rival' || k === 'overtaken') {
      return 'the driver';
    }
    if (k === 'position' || k === 'pos') return 'position 1';
    if (k === 'penalty') return '5-second penalty';
    if (k === 'sector') return 'Sector 2';
    return '';
  });

  // Guard rails: Strip undefined, null, NaN literals
  spoken = spoken.replace(/\b(undefined|null|NaN)\b/gi, '');

  // 2. Remove emojis and UI keyboard / button prompts
  // Strip bracketed controls like "[ BOX THIS LAP (B) ]", "[B]", "[P]"
  spoken = spoken.replace(/\[\s*BOX THIS LAP\s*\(?B\)?\s*\]/gi, 'Box this lap');
  spoken = spoken.replace(/\[\s*DRS\s*\]/gi, 'D-R-S');
  spoken = spoken.replace(/\[\s*O\s*\]/gi, 'overtake');
  spoken = spoken.replace(/\[\s*[A-Z0-9_-]+\s*\]/g, ''); // strip any remaining [X]

  // Strip UI symbols and emojis: 🏁 🏎️ 🛞 ⚡ 🛡️ 🌧️ ⚠️ 🚩 🎯 📻 🏆 ✦ ⏱️ ⚙️ 💬
  spoken = spoken.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1FA00}-\u{1FAFF}✦]/gu, '');

  // Strip tilde approximation symbol (e.g. "~12s" -> "approximately 12s")
  spoken = spoken.replace(/~\s*/g, 'approximately ');

  // Strip surrounding parentheses around standalone notes (e.g. "(gap: +1.2s)" -> "gap: plus 1.2 seconds")
  spoken = spoken.replace(/\(([^)]+)\)/g, '$1');

  // 3. Lap Times: Format "1:32.456" or "01:32.456"
  spoken = spoken.replace(/\b([0-5]?\d):([0-5]\d)\.(\d{1,3})\b/g, (match, m, s, f) => {
    const min = parseInt(m, 10);
    const sec = parseInt(s, 10);
    const minWord = min === 1 ? 'one minute' : `${integerToWords(min)} minutes`;
    const secWord = integerToWords(sec);
    const fracWords = decimalDigitsToWords(f);
    return `${minWord}, ${secWord} ${fracWords} seconds`;
  });

  // Also handle "1:32" without fractional milliseconds
  spoken = spoken.replace(/\b([0-5]?\d):([0-5]\d)\b(?!\s*am|\s*pm)/gi, (match, m, s) => {
    const min = parseInt(m, 10);
    const sec = parseInt(s, 10);
    const minWord = min === 1 ? 'one minute' : `${integerToWords(min)} minutes`;
    const secWord = integerToWords(sec);
    return `${minWord}, ${secWord} seconds`;
  });

  // 4. Combined Minutes & Seconds: e.g. "1m 20s", "2m 5s", "1m 1s", "1m 20 sec"
  spoken = spoken.replace(/\b(\d+)\s*m\s+(\d+(?:\.\d+)?)\s*s(?:ec(?:ond)?s?)?\b/gi, (match, m, s) => {
    const min = parseInt(m, 10);
    const sec = parseFloat(s);
    const minUnit = min === 1 ? 'minute' : 'minutes';
    const secUnit = sec === 1 ? 'second' : 'seconds';
    return `${min} ${minUnit} ${s} ${secUnit}`;
  });

  // Standalone minute values: "1m" or "2m" when followed by duration words (e.g. "1m pit window")
  spoken = spoken.replace(/\b(\d+)\s*m\b(?=\s+(?:window|delay|stop|gap|duration|penalty))/gi, (match, m) => {
    const min = parseInt(m, 10);
    return `${min} ${min === 1 ? 'minute' : 'minutes'}`;
  });

  // 5. Signed time deltas / gaps:
  // e.g. "+1.234s", "+0.5s", "-0.500s", "-1s"
  spoken = spoken.replace(/([+-])\s*(\d+(?:\.\d+)?)\s*s(?:ec(?:ond)?s?)?\b/gi, (match, sign, val) => {
    const signWord = sign === '+' ? 'plus' : 'minus';
    const num = parseFloat(val);
    const unit = num === 1 ? 'second' : 'seconds';
    return `${signWord} ${val} ${unit}`;
  });

  // Signed deltas without trailing 's' if preceded by "gap" or "delta"
  spoken = spoken.replace(/(gap|delta)\s*(?:is|of)?\s*([+-])\s*(\d+(?:\.\d+)?)\b(?!\s*seconds?)/gi, (match, term, sign, val) => {
    const signWord = sign === '+' ? 'plus' : 'minus';
    const num = parseFloat(val);
    const unit = num === 1 ? 'second' : 'seconds';
    return `${term} ${signWord} ${val} ${unit}`;
  });

  // 6. Plain durations with 's' or 'sec':
  // e.g. "12s" -> "12 seconds", "5s" -> "5 seconds", "1s" -> "1 second", "0.5s" -> "0.5 seconds"
  // Lookbehind ensures we don't match something already preceded by plus/minus or inside a word
  spoken = spoken.replace(/\b(\d+(?:\.\d+)?)\s*s(?:ec(?:ond)?s?)?\b(?!\s*(?:wear|deg|celsius|km|m\b))/gi, (match, val) => {
    const num = parseFloat(val);
    const unit = num === 1 ? 'second' : 'seconds';
    return `${val} ${unit}`;
  });

  // Guard against accidental double expansion (e.g. "12 seconds seconds")
  spoken = spoken.replace(/\bseconds\s+seconds\b/gi, 'seconds');
  spoken = spoken.replace(/\bsecond\s+seconds\b/gi, 'second');
  spoken = spoken.replace(/\bminutes\s+minutes\b/gi, 'minutes');
  spoken = spoken.replace(/\bminute\s+minutes\b/gi, 'minute');

  // 7. Distance Units:
  // e.g. "300 m" / "300m" -> "300 metres", "1 m" / "1m" -> "1 metre"
  spoken = spoken.replace(/\b(\d+(?:\.\d+)?)\s*m\b(?!\s*(?:s\b|seconds?|minutes?|loss|saving|deg))/gi, (match, val) => {
    const num = parseFloat(val);
    const unit = num === 1 ? 'metre' : 'metres';
    return `${val} ${unit}`;
  });

  // 8. Speed Units:
  // e.g. "220 km/h" or "220km/h" or "220 kph" -> "220 kilometres per hour"
  spoken = spoken.replace(/\b(\d+(?:\.\d+)?)\s*(?:km\/h|kph)\b/gi, '$1 kilometres per hour');

  // Guard against double speed expansion
  spoken = spoken.replace(/\bkilometres per hour per hour\b/gi, 'kilometres per hour');

  // 9. Percentage Units:
  // e.g. "72%" -> "72 percent", "+20%" -> "plus 20 percent"
  spoken = spoken.replace(/([+-])?\s*(\d+(?:\.\d+)?)\s*%/g, (match, sign, val) => {
    const signPrefix = sign === '+' ? 'plus ' : (sign === '-' ? 'minus ' : '');
    return `${signPrefix}${val} percent`;
  });

  // 10. Temperature Units:
  // e.g. "95°C", "95° C", "95 deg C", "95°" -> "95 degrees Celsius"
  spoken = spoken.replace(/\b(\d+(?:\.\d+)?)\s*(?:°\s*C|deg\s*C|°(?!\s*F))\b/gi, '$1 degrees Celsius');

  // Guard against double degrees Celsius
  spoken = spoken.replace(/\bdegrees Celsius Celsius\b/gi, 'degrees Celsius');

  // 11. Lap numbers:
  // e.g. "Lap 12" -> "lap twelve", "Lap 1" -> "lap one"
  spoken = spoken.replace(/\bLap\s+(\d+)\b/gi, (match, lapNum) => {
    const n = parseInt(lapNum, 10);
    if (n >= 1 && n <= 99) {
      return `lap ${integerToWords(n)}`;
    }
    return `lap ${lapNum}`;
  });

  // 12. Positions:
  // e.g. "P1" -> "position 1" / "first place"
  // When preceded by "for", "in", "to", "take", "hold", "take over", "is", "at", or standalone
  spoken = spoken.replace(/\bP1\b/g, (match, offset, str) => {
    // If preceded by "for", "for P1" -> "for first place" sounds very authentic
    const before = str.slice(Math.max(0, offset - 10), offset).toLowerCase();
    if (/\b(?:for|in|take|holds?|fighting for)\s+$/i.test(before)) {
      return 'first place';
    }
    return 'position 1';
  });

  spoken = spoken.replace(/\bP2\b/g, (match, offset, str) => {
    const before = str.slice(Math.max(0, offset - 10), offset).toLowerCase();
    if (/\b(?:for|in|take|holds?|fighting for)\s+$/i.test(before)) {
      return 'second place';
    }
    return 'position 2';
  });

  spoken = spoken.replace(/\bP3\b/g, (match, offset, str) => {
    const before = str.slice(Math.max(0, offset - 10), offset).toLowerCase();
    if (/\b(?:for|in|take|holds?|fighting for)\s+$/i.test(before)) {
      return 'third place';
    }
    return 'position 3';
  });

  // Other positions: P4 to P24 -> "position 4", etc.
  spoken = spoken.replace(/\bP(\d{1,2})\b/g, 'position $1');

  // 13. Apply Motorsport Pronunciation Map
  for (const [pattern, replacement] of PRONUNCIATION_MAP) {
    spoken = spoken.replace(pattern, replacement);
  }

  // 14. Clean up whitespace and punctuation
  spoken = spoken.replace(/\s+/g, ' ').trim();

  return spoken;
}
