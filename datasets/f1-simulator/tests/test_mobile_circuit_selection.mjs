/**
 * test_mobile_circuit_selection.mjs
 * Verification Suite for Mobile Circuit Selection Screen:
 * Height, Layout, Viewport Scaling (320px, 375px, 390px, 430px, 768px),
 * Touch Target Accessibility, Landscape Mode, and Desktop Preservation.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  CIRCUITS,
  RAW_WAYPOINTS,
  getCircuit,
  getTrackSvgPath,
  renderCircuitSelection,
  renderSelectedCircuitInfo,
  bindCircuitSelectionEvents
} from '../src/ui/circuitSelect.js';
import { QuickRaceViews } from '../src/ui/quickRaceWizard.js';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const APP_URL = 'http://localhost:8765/';
const DEBUG_PORT = 9238;

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

console.log('🏎️  RUNNING MOBILE CIRCUIT SELECTION VERIFICATION SUITE\n');

// ── UNIT TESTS: Module & Component Integrity ─────────────────────────────────

console.log('--- TEST GROUP 1: Component & Data Integrity ---');

// 1. All 8 FIA circuits present
assert.equal(CIRCUITS.length, 8, 'Should contain 8 official Formula 1 circuits');
const ids = CIRCUITS.map(c => c.id);
assert.ok(ids.includes('monaco'), 'Monaco should be present');
assert.ok(ids.includes('silverstone'), 'Silverstone should be present');
assert.ok(ids.includes('spa'), 'Spa-Francorchamps should be present');
assert.ok(ids.includes('monza'), 'Monza should be present');
console.log('  ✅ 8 Official circuits verified');

// 2. SVG path generator
for (const c of CIRCUITS) {
  const p = getTrackSvgPath(c.id);
  assert.ok(p.length > 50, `SVG path for ${c.id} should be non-empty`);
  assert.ok(p.startsWith('M'), `SVG path for ${c.id} should start with M`);
  assert.ok(p.endsWith('Z'), `SVG path for ${c.id} should close with Z`);
}
console.log('  ✅ Valid SVG track geometry paths generated for all 8 circuits');

// 3. 4-Section Layout in renderCircuitSelection
const mockState = { circuitId: 'silverstone' };
const html = renderCircuitSelection(mockState);

assert.ok(html.includes('qr-circuit-heading'), 'Section 1: Compact heading must be present');
assert.ok(html.includes('CIRCUIT SELECTION'), 'Section 1: Title must be present');
assert.ok(html.includes('qr-circuit-grid'), 'Section 2: Circuit selection grid must be present');
assert.ok(html.includes('qr-selected-circuit-section'), 'Section 3: Selected circuit info must be present');
assert.ok(html.includes('Silverstone Circuit'), 'Selected circuit info must display current track');
assert.ok(html.includes('5.891 km'), 'Selected circuit info must show track length');
assert.ok(html.includes('18 Turns'), 'Selected circuit info must show turn count');
assert.ok(html.includes('qr-thumb-active-pill'), 'Active circuit must have visual pill');
console.log('  ✅ 4 Clear sections and initial selection rendered accurately');

// 4. Dynamic update of selected circuit info
const monzaState = { circuitId: 'monza' };
const monzaHtml = renderCircuitSelection(monzaState);
assert.ok(monzaHtml.includes('Autodromo Nazionale Monza'), 'Selected circuit info updates to Monza');
assert.ok(monzaHtml.includes('5.793 km'), 'Selected circuit info updates to Monza length');
console.log('  ✅ Selected circuit information updates dynamically with authentic stats');

// ── E2E HEADLESS CHROME RESPONSIVENESS & INTERACTION ─────────────────────────

console.log('\n--- TEST GROUP 2: Viewport Optimisation & Headless Browser E2E ---');

async function runBrowserTests() {
  const chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${DEBUG_PORT}`,
    '--disable-gpu',
    '--no-sandbox',
    '--disable-extensions',
    '--disable-background-networking',
    APP_URL
  ]);

  let ws = null;
  let msgId = 0;
  const pending = new Map();

  function sendCommand(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++msgId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async function evalInBrowser(expression) {
    const res = await sendCommand('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      throw new Error(`Eval error: ${JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result.value;
  }

  async function setViewport(width, height) {
    await sendCommand('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width <= 768
    });
    await sleep(200);
  }

  try {
    // Wait for Chrome remote debugging
    let connected = false;
    let wsUrl = '';
    for (let i = 0; i < 30; i++) {
      try {
        const resp = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`);
        const tabs = await resp.json();
        const pageTab = tabs.find(t => t.type === 'page' && t.url.includes('localhost:8765'));
        if (pageTab?.webSocketDebuggerUrl) {
          wsUrl = pageTab.webSocketDebuggerUrl;
          connected = true;
          break;
        }
      } catch {
        await sleep(200);
      }
    }
    assert(connected, 'Failed to connect to headless Chrome page');

    const WebSocket = (await import('ws')).default;
    ws = new WebSocket(wsUrl);

    await new Promise((resolve) => {
      ws.on('open', resolve);
      ws.on('message', (data) => {
        const parsed = JSON.parse(data);
        if (parsed.id && pending.has(parsed.id)) {
          const { resolve, reject } = pending.get(parsed.id);
          pending.delete(parsed.id);
          if (parsed.error) reject(parsed.error);
          else resolve(parsed.result);
        }
      });
    });

    await sendCommand('Page.enable');
    await sendCommand('DOM.enable');

    // Wait for app and controllers to initialize
    await evalInBrowser(`new Promise((resolve) => {
      let attempts = 0;
      const check = () => {
        attempts++;
        if (window.quickRaceCtrl || attempts > 50) {
          resolve(true);
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    })`);

    // Navigate to Quick Race Setup Wizard Step 2 (Circuit Selection)
    await evalInBrowser(`(() => {
      if (window.quickRaceCtrl) {
        window.quickRaceCtrl.openWizard();
        document.getElementById('btnWizNext')?.click();
      } else {
        document.querySelector('[data-action="quickrace"]')?.click();
        setTimeout(() => {
          document.getElementById('btnQRCustomize')?.click();
          document.getElementById('btnWizNext')?.click();
        }, 100);
      }
    })()`);

    await sleep(500);

    // Verify Step 2 is active
    const stepTitle = await evalInBrowser(`document.querySelector('.qr-step-title')?.textContent`);
    assert.equal(stepTitle, 'Circuit Selection', 'Wizard should be on Step 2: Circuit Selection');
    console.log('  ✅ Step 2 Circuit Selection opened successfully');

    // ── Viewport Test Matrix ──────────────────────────────────────────────────
    const viewports = [
      { name: '320px (iPhone SE 1st Gen)', width: 320, height: 568 },
      { name: '375px (iPhone SE 2nd/3rd Gen)', width: 375, height: 667 },
      { name: '390px (iPhone 12/13/14)', width: 390, height: 844 },
      { name: '430px (iPhone 14/15 Pro Max)', width: 430, height: 932 },
      { name: '768px (iPad Portrait)', width: 768, height: 1024 },
      { name: 'Landscape 667x375 (iPhone Landscape)', width: 667, height: 375 },
      { name: 'Landscape 844x390 (Modern Landscape)', width: 844, height: 390 }
    ];

    for (const vp of viewports) {
      await setViewport(vp.width, vp.height);

      const metrics = await evalInBrowser(`(() => {
        const docEl = document.documentElement;
        const card = document.querySelector('.qr-wizard-card');
        const firstThumb = document.querySelector('.qr-circuit-thumb');
        const firstCard = document.querySelector('.qr-circuit-card');
        const selectedInfo = document.getElementById('qrSelectedCircuitInfo');
        const btnNext = document.getElementById('btnWizNext');
        const footer = document.querySelector('.f1-wizard-footer');

        const cardRect = card ? card.getBoundingClientRect() : null;
        const thumbRect = firstThumb ? firstThumb.getBoundingClientRect() : null;
        const firstCardRect = firstCard ? firstCard.getBoundingClientRect() : null;
        const nextRect = btnNext ? btnNext.getBoundingClientRect() : null;

        return {
          windowWidth: window.innerWidth,
          windowHeight: window.innerHeight,
          scrollWidth: docEl.scrollWidth,
          cardHeight: cardRect ? cardRect.height : 0,
          cardWidth: cardRect ? cardRect.width : 0,
          thumbHeight: thumbRect ? thumbRect.height : 0,
          firstCardHeight: firstCardRect ? firstCardRect.height : 0,
          hasSelectedInfo: !!selectedInfo,
          nextBtnHeight: nextRect ? nextRect.height : 0,
          footerVisible: !!footer
        };
      })()`);

      // 1. No horizontal scrolling
      assert.ok(
        metrics.scrollWidth <= metrics.windowWidth + 2,
        `Viewport ${vp.name}: scrollWidth (${metrics.scrollWidth}) must not exceed windowWidth (${metrics.windowWidth})`
      );

      // 2. Main circuit screen occupies available vertical space
      assert.ok(
        metrics.cardHeight >= metrics.windowHeight - 10,
        `Viewport ${vp.name}: wizard card (${metrics.cardHeight}px) should occupy full mobile viewport height (${metrics.windowHeight}px)`
      );

      // 3. Thumbnails have increased height on mobile portrait (> 150px)
      if (vp.height > 500 && vp.width <= 430) {
        assert.ok(
          metrics.thumbHeight >= 155,
          `Viewport ${vp.name}: circuit track thumb (${metrics.thumbHeight}px) should have breathing room (>= 155px)`
        );
        assert.ok(
          metrics.firstCardHeight >= 260,
          `Viewport ${vp.name}: circuit card (${metrics.firstCardHeight}px) should be tall and spacious (>= 260px)`
        );
      }

      // 4. Selected Circuit Information section is present
      assert.ok(metrics.hasSelectedInfo, `Viewport ${vp.name}: Selected Circuit info must exist`);

      // 5. Accessible bottom Next/Continue action
      assert.ok(
        metrics.nextBtnHeight >= 36,
        `Viewport ${vp.name}: Continue action should be accessible (height: ${metrics.nextBtnHeight}px)`
      );

      // 6. Test scroll clearance and ensure footer remains pinned at bottom without covering content
      const scrollMetrics = await evalInBrowser(`(() => {
        const body = document.querySelector('.qr-wizard-body');
        if (body) body.scrollTop = body.scrollHeight;
        const selected = document.getElementById('qrSelectedCircuitInfo');
        const footer = document.querySelector('.f1-wizard-footer');
        const selRect = selected ? selected.getBoundingClientRect() : null;
        const footerRect = footer ? footer.getBoundingClientRect() : null;

        const isCovered = (selRect && footerRect) ? (selRect.bottom > footerRect.top) : false;
        const clearance = (selRect && footerRect) ? (footerRect.top - selRect.bottom) : 0;
        const footerPinnedBottom = footerRect ? Math.abs(footerRect.bottom - window.innerHeight) <= 2 : false;

        return { isCovered, clearance, footerPinnedBottom };
      })()`);

      assert.ok(!scrollMetrics.isCovered, `Viewport ${vp.name}: Selected circuit specifications must not be covered by footer`);
      assert.ok(scrollMetrics.clearance >= 20, `Viewport ${vp.name}: Clearance above footer (${scrollMetrics.clearance}px) must be >= 20px`);
      assert.ok(scrollMetrics.footerPinnedBottom, `Viewport ${vp.name}: Footer must remain pinned to the bottom of the viewport`);

      // Reset scroll position
      await evalInBrowser(`document.querySelector('.qr-wizard-body')?.scrollTo(0, 0)`);

      console.log(`  ✅ Viewport ${vp.name}: No overflow, height=${metrics.cardHeight}px, thumb=${metrics.thumbHeight}px, NextBtn=${metrics.nextBtnHeight}px, scrollClearance=${Math.round(scrollMetrics.clearance)}px`);
    }

    // ── Interactive Circuit Selection & Live Update ───────────────────────────
    console.log('\n--- TEST GROUP 3: Selection Logic & Next Screen Navigation ---');

    // Click Monza card
    const selectMonzaResult = await evalInBrowser(`(() => {
      const monzaCard = document.querySelector('.qr-circuit-card[data-circuit-id="monza"]');
      if (monzaCard) {
        monzaCard.click();
        return true;
      }
      return false;
    })()`);
    assert.ok(selectMonzaResult, 'Monza card should be clicked');
    await sleep(200);

    const afterSelect = await evalInBrowser(`(() => {
      const activeCard = document.querySelector('.qr-circuit-card.active');
      const activeId = activeCard?.dataset.circuitId;
      const selectedInfoTitle = document.querySelector('#qrSelectedCircuitInfo .qr-selected-title')?.textContent;
      const selectedInfoLength = document.querySelector('#qrSelectedCircuitInfo .qr-stat-val')?.textContent;
      return { activeId, selectedInfoTitle, selectedInfoLength };
    })()`);

    assert.equal(afterSelect.activeId, 'monza', 'Active card should now be monza');
    assert.ok(afterSelect.selectedInfoTitle?.includes('Monza'), 'Selected info title should reflect Monza');
    assert.ok(afterSelect.selectedInfoLength?.includes('5.793'), 'Selected info length should reflect Monza 5.793 km');
    console.log('  ✅ Tapping a circuit card updates .active state and #qrSelectedCircuitInfo specifications');

    // Click Continue → and verify transition to Step 3
    await evalInBrowser(`document.getElementById('btnWizNext')?.click()`);
    await sleep(300);

    const step3State = await evalInBrowser(`(() => {
      const title = document.querySelector('.qr-step-title')?.textContent;
      const hasDriverCards = document.querySelectorAll('.qr-roster-card').length > 0;
      return { title, hasDriverCards };
    })()`);

    assert.equal(step3State.title, 'Driver, Manager & Car Selection', 'Should navigate to Step 3');
    assert.ok(step3State.hasDriverCards, 'Step 3 roster cards should be displayed');
    console.log('  ✅ Continue button advances to Step 3 with circuit selection preserved');

    // Return back to Step 2 and verify Monza is still selected
    await evalInBrowser(`document.getElementById('btnWizBack')?.click()`);
    await sleep(300);

    const step2Restored = await evalInBrowser(`(() => {
      const activeCard = document.querySelector('.qr-circuit-card.active');
      return activeCard?.dataset.circuitId;
    })()`);
    assert.equal(step2Restored, 'monza', 'Returning to Step 2 preserves Monza selection');
    console.log('  ✅ Navigating back to Step 2 preserves active circuit selection');

    // ── Desktop Preservation Verification ─────────────────────────────────────
    console.log('\n--- TEST GROUP 4: Desktop Layout Preservation ---');
    await setViewport(1280, 800);

    const desktopMetrics = await evalInBrowser(`(() => {
      const card = document.querySelector('.qr-wizard-card');
      const thumb = document.querySelector('.qr-circuit-thumb');
      const cardStyle = window.getComputedStyle(card);
      const thumbStyle = window.getComputedStyle(thumb);
      const grid = document.querySelector('.qr-circuit-grid');
      const gridStyle = window.getComputedStyle(grid);

      return {
        cardMaxWidth: cardStyle.maxWidth,
        cardMaxHeight: cardStyle.maxHeight,
        thumbHeight: thumb.offsetHeight,
        gridColumns: gridStyle.gridTemplateColumns.split(' ').length
      };
    })()`);

    assert.equal(desktopMetrics.cardMaxWidth, '960px', 'Desktop card max-width should be 960px');
    assert.equal(desktopMetrics.cardMaxHeight, '720px', 'Desktop card max-height should be 90vh (720px on 800px window)');
    assert.equal(desktopMetrics.thumbHeight, 120, 'Desktop circuit thumb height should remain standard 120px');
    assert.ok(desktopMetrics.gridColumns >= 3, `Desktop should display multi-column grid (found ${desktopMetrics.gridColumns})`);
    console.log('  ✅ Desktop layout preserved: max-width 960px, 120px thumbs, multi-column grid');

    console.log('\n🏁 ══════════════════════════════════════════════════════════════');
    console.log('   ALL MOBILE CIRCUIT SELECTION VERIFICATION TESTS PASSED!      ');
    console.log('════════════════════════════════════════════════════════════════\n');

  } finally {
    if (ws) ws.close();
    chromeProc.kill();
  }
}

runBrowserTests().catch((err) => {
  console.error('❌ Validation failed:', err);
  process.exit(1);
});
