/**
 * test_mobile_championship_responsive.mjs
 * Verification of Championship Mobile Responsiveness (championship-view.css):
 * 1. Wizard updateView scroll preservation fix.
 * 2. Modal backdrop scrolling, container sizing and safe areas.
 * 3. 16px inputs (iOS no-zoom) and 44px minimum tap targets.
 * 4. Pinned wizard header and footer with full-width responsive controls.
 * 5. Swipeable team/manager/car chip rows on small screens.
 * 6. Staggered starting grid collapse to single-column list with 20px indent.
 * 7. Championship Hub column stacking (under 860px) and mini-table reflow.
 * 8. Responsive data tables column hiding (Quali, Results, Driver/Constructor Standings).
 * 9. Viewport scaling & zero horizontal overflow across 320px, 375px, 390px, 430px, 768px.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { ChampionshipViews } from '../src/ui/championshipViews.js';
import { getChromePath, getTempProfileDir, connectToChromePage } from './testHelper.js';

const APP_URL = 'http://localhost:8765/';
const DEBUG_PORT = 9240;

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

console.log('🏎️  RUNNING MOBILE CHAMPIONSHIP RESPONSIVE VERIFICATION SUITE\n');

// ── UNIT TEST: Verify JS scroll preservation logic in championshipViews.js ───
console.log('--- TEST GROUP 1: JS updateView Scroll Position Preservation ---');

// Mock a DOM container with .f1-modal-backdrop
const mockContainer = {
  innerHTML: '',
  _backdrop: { scrollTop: 0 },
  querySelector(selector) {
    if (selector === '.f1-modal-backdrop') {
      return this._backdrop;
    }
    return {
      addEventListener: () => {},
      closest: () => null,
      querySelectorAll: () => [],
      value: ''
    };
  }
};

let capturedWizardState = null;
ChampionshipViews.renderWizard(mockContainer, {
  onCancel: () => {},
  onComplete: (w) => { capturedWizardState = w; }
});

assert.ok(mockContainer.innerHTML.includes('f1-modal-backdrop'), 'Wizard renders with f1-modal-backdrop');
assert.ok(mockContainer.innerHTML.includes('SEASON CREATION WIZARD'), 'Wizard header rendered');
console.log('  ✅ Championship wizard mounts cleanly with backdrop and step indicators');

// ── E2E HEADLESS BROWSER VALIDATION ──────────────────────────────────────────
console.log('\n--- TEST GROUP 2: Headless Browser E2E Responsive Verification ---');

const profileDir = getTempProfileDir('chrome-championship-resp');
const chromeProc = spawn(getChromePath(), [
  '--headless=new',
  `--remote-debugging-port=${DEBUG_PORT}`,
  '--remote-debugging-address=127.0.0.1',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--no-sandbox',
  '--disable-extensions',
  '--disable-background-networking',
  `--user-data-dir=${profileDir}`,
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
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await sendCommand('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true
      });
      if (res?.exceptionDetails) {
        throw new Error(`Eval error: ${JSON.stringify(res.exceptionDetails)}`);
      }
      return res?.result?.value;
    } catch (err) {
      const isCtx = err?.code === -32000 || (err?.message && (err.message.includes('-32000') || err.message.includes('Execution context was destroyed')));
      if (isCtx && attempt < 4) {
        await sleep(200);
        continue;
      }
      throw err;
    }
  }
}

async function setViewport(width, height) {
  await sendCommand('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 1024
  });
  await sleep(150);
}

try {
  ws = await connectToChromePage(DEBUG_PORT, '8765');

  ws.on('message', (data) => {
    const parsed = JSON.parse(data);
    if (parsed.id && pending.has(parsed.id)) {
      const { resolve, reject } = pending.get(parsed.id);
      pending.delete(parsed.id);
      if (parsed.error) {
        const err = new Error(parsed.error.message || 'CDP Error');
        err.code = parsed.error.code;
        reject(err);
      } else {
        resolve(parsed.result);
      }
    }
  });

  await sendCommand('Page.enable');
  await sendCommand('DOM.enable');

  // Verify stylesheet is loaded
  const hasStylesheet = await evalInBrowser(`(() => {
    const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
    return links.some(l => l.href.includes('championship-view.css') || l.href.includes('championship-responsive.css'));
  })()`);
  assert.equal(hasStylesheet, true, 'championship-view.css stylesheet must be linked in index.html');
  console.log('  ✅ Championship responsive stylesheet is linked and active');

  // Wait for initial app lifecycle to settle
  await sleep(400);

  // Mount Championship Wizard directly in browser for visual/layout testing
  await evalInBrowser(`(async () => {
    const { ChampionshipViews } = await import('./src/ui/championshipViews.js');
    const mount = document.getElementById('championshipMount');
    mount.style.display = 'block';
    document.getElementById('landingView').style.display = 'none';
    window._testWizard = null;
    ChampionshipViews.renderWizard(mount, {
      onCancel: () => {},
      onComplete: (w) => { window._testWizard = w; }
    });
  })()`);
  await sleep(250);

  // ── Test 2A: Verify Scroll Position Preservation on Chip/Driver Clicks ─────
  console.log('\n▶ Test 2A: Testing Wizard updateView() scroll position preservation on Step 3');
  await setViewport(375, 667);
  // Advance to Step 3
  await evalInBrowser(`document.getElementById('btnWizNext').click()`); // to step 2
  await sleep(100);
  await evalInBrowser(`document.getElementById('btnWizNext').click()`); // to step 3
  await sleep(150);

  const scrollPreservationTest = await evalInBrowser(`(() => {
    const backdrop = document.querySelector('#championshipMount .f1-modal-backdrop') || document.querySelector('.f1-modal-backdrop');
    // Scroll down to simulate picking lower chips
    backdrop.scrollTop = 250;
    const initialScroll = backdrop.scrollTop;

    // Click another team chip (e.g. Ferrari or Red Bull)
    const ferrariChip = backdrop.querySelector('button[data-team="Ferrari"]') || backdrop.querySelectorAll('.f1-team-chips button')[1];
    if (ferrariChip) ferrariChip.click();

    const scrollAfterTeamClick = document.querySelector('#championshipMount .f1-modal-backdrop')?.scrollTop;

    // Click a manager chip
    const mgrChip = backdrop.querySelectorAll('#managerChips button')[1];
    if (mgrChip) mgrChip.click();
    const scrollAfterMgrClick = document.querySelector('#championshipMount .f1-modal-backdrop')?.scrollTop;

    // Advance to Step 4 via Next button -> scroll should reset to 0
    backdrop.querySelector('#btnWizNext')?.click();
    const scrollOnNextStep = document.querySelector('#championshipMount .f1-modal-backdrop')?.scrollTop;

    return {
      backdropScrollHeight: backdrop.scrollHeight,
      backdropClientHeight: backdrop.clientHeight,
      initialScroll,
      scrollAfterTeamClick,
      scrollAfterMgrClick,
      scrollOnNextStep
    };
  })()`);

  console.log('  Scroll preservation metrics:', scrollPreservationTest);
  assert.equal(scrollPreservationTest.scrollAfterTeamClick, scrollPreservationTest.initialScroll,
    'Scroll position must be preserved after team chip selection');
  assert.equal(scrollPreservationTest.scrollAfterMgrClick, scrollPreservationTest.initialScroll,
    'Scroll position must be preserved after manager chip selection');
  assert.equal(scrollPreservationTest.scrollOnNextStep, 0,
    'Scroll position must reset to 0 when advancing to a new step');
  console.log('  ✅ updateView() scroll preservation bug fix verified in browser!');

  // Re-render Wizard fresh for Step 1 responsive checks
  await evalInBrowser(`(async () => {
    const { ChampionshipViews } = await import('./src/ui/championshipViews.js');
    const mount = document.getElementById('championshipMount');
    mount.style.display = 'block';
    document.getElementById('landingView').style.display = 'none';
    ChampionshipViews.renderWizard(mount, {
      onCancel: () => {},
      onComplete: () => {}
    });
  })()`);
  await sleep(150);

  // ── Test 2B: Phone Width Inputs 16px and 44px Tap Targets ──────────────────
  console.log('\n▶ Test 2B: Validating 16px inputs (iOS no-zoom) & >=44px tap targets at phone width (375px)');
  await setViewport(375, 667);

  const inputAndTapMetrics = await evalInBrowser(`(() => {
    const mount = document.getElementById('championshipMount');
    const input = document.getElementById('wizChampName');
    const select = document.getElementById('wizLength');
    const btnCancel = document.getElementById('btnWizCancel');
    const btnNext = document.getElementById('btnWizNext');

    const inputFontSize = input ? getComputedStyle(input).fontSize : '0px';
    const selectFontSize = select ? getComputedStyle(select).fontSize : '0px';
    const inputMinHeight = input ? input.offsetHeight : 0;
    const btnNextHeight = btnNext ? btnNext.offsetHeight : 0;
    const btnCancelHeight = btnCancel ? btnCancel.offsetHeight : 0;

    return {
      mountDisplay: mount ? mount.style.display : null,
      mountComputedDisplay: mount ? getComputedStyle(mount).display : null,
      inputRect: input ? input.getBoundingClientRect() : null,
      inputFontSize,
      selectFontSize,
      inputMinHeight,
      btnNextHeight,
      btnCancelHeight
    };
  })()`);

  console.log('  Input & Tap Metrics:', inputAndTapMetrics);
  assert.equal(inputAndTapMetrics.inputFontSize, '16px', 'Inputs must have font-size: 16px to prevent iOS auto-zoom');
  assert.equal(inputAndTapMetrics.selectFontSize, '16px', 'Selects must have font-size: 16px to prevent iOS auto-zoom');
  assert.ok(inputAndTapMetrics.inputMinHeight >= 44, 'Inputs must have height >= 44px');
  assert.ok(inputAndTapMetrics.btnNextHeight >= 44, 'CTA button must have height >= 44px');
  assert.ok(inputAndTapMetrics.btnCancelHeight >= 44, 'Cancel button must have height >= 44px');
  console.log('  ✅ 16px font-size and >=44px touch targets confirmed on mobile');

  // ── Test 2C: Swipeable Chip Rows & Pinned Footer Controls ──────────────────
  console.log('\n▶ Test 2C: Validating swipeable chip rows and sticky pinned header & footer');
  // Jump to Step 3 to inspect chip rows
  await evalInBrowser(`document.getElementById('btnWizNext').click()`);
  await sleep(100);
  await evalInBrowser(`document.getElementById('btnWizNext').click()`);
  await sleep(150);

  const wizardMobileLayout = await evalInBrowser(`(() => {
    const header = document.querySelector('.f1-wizard-header');
    const footer = document.querySelector('.f1-wizard-footer');
    const teamChips = document.getElementById('teamChips');
    const chip = teamChips ? teamChips.querySelector('.f1-chip') : null;

    const headerPos = header ? getComputedStyle(header).position : '';
    const footerPos = footer ? getComputedStyle(footer).position : '';
    const chipsOverflowX = teamChips ? getComputedStyle(teamChips).overflowX : '';
    const chipsFlexWrap = teamChips ? getComputedStyle(teamChips).flexWrap : '';
    const chipHeight = chip ? chip.offsetHeight : 0;

    return {
      headerPos,
      footerPos,
      chipsOverflowX,
      chipsFlexWrap,
      chipHeight
    };
  })()`);

  console.log('  Wizard Mobile Layout:', wizardMobileLayout);
  assert.equal(wizardMobileLayout.headerPos, 'sticky', 'Wizard header must be position: sticky');
  assert.equal(wizardMobileLayout.footerPos, 'sticky', 'Wizard footer must be position: sticky');
  assert.equal(wizardMobileLayout.chipsOverflowX, 'auto', 'Chip rows must have overflow-x: auto on phones');
  assert.equal(wizardMobileLayout.chipsFlexWrap, 'nowrap', 'Chip rows must have flex-wrap: nowrap on phones');
  assert.ok(wizardMobileLayout.chipHeight >= 44, 'Chips must have height >= 44px for tap ergonomics');
  console.log('  ✅ Wizard sticky header, sticky footer, and swipeable chip rows validated');

  // ── Test 2D: Championship Hub Stacking & Mini Standings Reflow ─────────────
  console.log('\n▶ Test 2D: Validating Championship Hub column stacking and mini-standings reflow');
  await evalInBrowser(`(async () => {
    const { ChampionshipViews } = await import('./src/ui/championshipViews.js');
    const { ChampionshipManager } = await import('./src/championship/championshipManager.js');
    const champ = ChampionshipManager.createChampionship({ seasonLength: 3 });
    const mount = document.getElementById('championshipMount');
    ChampionshipViews.renderHub(mount, champ, {
      onMainAction: () => {},
      onViewCalendar: () => {},
      onViewStandings: () => {},
      onViewHistory: () => {},
      onSaveAndExit: () => {}
    });
  })()`);
  await sleep(200);

  // Test at 800px (tablet <= 860px) -> grid stacks to 1 column
  await setViewport(800, 900);
  const hubTabletCols = await evalInBrowser(`(() => {
    const grid = document.querySelector('.f1-hub-grid');
    return grid ? getComputedStyle(grid).gridTemplateColumns : '';
  })()`);
  console.log('  Hub grid at 800px width:', hubTabletCols);
  assert.ok(!hubTabletCols.includes(' '), 'Hub grid must collapse to 1 column below 860px (found: ' + hubTabletCols + ')');

  // Test at 375px (mobile <= 560px) -> mini standings hides Team column, footer buttons stack
  await setViewport(375, 667);
  const hubMobileDetails = await evalInBrowser(`(() => {
    const teamTag = document.querySelector('.f1-mt-row > .f1-team-tag');
    const footerBtn = document.querySelector('.f1-hub-footer button');
    const teamTagDisplay = teamTag ? getComputedStyle(teamTag).display : 'none';
    const footerBtnWidth = footerBtn ? footerBtn.offsetWidth : 0;
    const parentWidth = footerBtn?.parentElement ? footerBtn.parentElement.offsetWidth : 0;

    return {
      teamTagDisplay,
      footerBtnWidth,
      parentWidth,
      footerBtnFullWidth: footerBtnWidth >= parentWidth - 4
    };
  })()`);

  console.log('  Hub mobile details at 375px:', hubMobileDetails);
  assert.equal(hubMobileDetails.teamTagDisplay, 'none', 'Mini standings must hide Team column on phones (<= 560px)');
  assert.equal(hubMobileDetails.footerBtnFullWidth, true, 'Footer action buttons must be full width on mobile');
  console.log('  ✅ Championship Hub stacking and mini-table column hiding verified');

  // ── Test 2E: Data Tables Responsiveness (Qualifying, Results, Standings) ────
  console.log('\n▶ Test 2E: Validating Data Tables column hiding at phone width (375px)');
  await evalInBrowser(`(async () => {
    const { ChampionshipViews } = await import('./src/ui/championshipViews.js');
    const { ChampionshipManager } = await import('./src/championship/championshipManager.js');
    const champ = ChampionshipManager.createChampionship({ seasonLength: 3 });
    const mount = document.getElementById('championshipMount');

    // 1. Render Qualifying results
    const round = champ.calendar[0];
    round.qualifyingResults = champ.drivers.map((d, i) => ({
      position: i + 1,
      driverCode: d.code,
      bestLap: 75.0 + i * 0.2,
      s1: 24.5, s2: 26.5, s3: 24.0,
      gap: i === 0 ? '0.000s' : '+' + (i * 0.2).toFixed(3) + 's'
    }));
    ChampionshipViews.renderQualifying(mount, champ, round, {
      onRunQuali: () => {},
      onConfirmGrid: () => {},
      onBackToHub: () => {}
    });
  })()`);
  await sleep(150);

  const qualiTableCheck = await evalInBrowser(`(() => {
    const table = document.querySelector('.f1-quali-results-table');
    const thirdHead = table?.querySelector('.f1-table-head > :nth-child(3)'); // Team
    const thirdRow = table?.querySelector('.f1-table-row > :nth-child(3)'); // Team
    return {
      teamHeadDisplay: thirdHead ? getComputedStyle(thirdHead).display : '',
      teamRowDisplay: thirdRow ? getComputedStyle(thirdRow).display : ''
    };
  })()`);
  console.log('  Qualifying table on mobile (375px):', qualiTableCheck);
  assert.equal(qualiTableCheck.teamHeadDisplay, 'none', 'Qualifying table must hide Team column on phones');
  assert.equal(qualiTableCheck.teamRowDisplay, 'none', 'Qualifying rows must hide Team column on phones');

  // 2. Render Starting Grid & check single column collapse
  await evalInBrowser(`(async () => {
    const { ChampionshipViews } = await import('./src/ui/championshipViews.js');
    const { ChampionshipManager } = await import('./src/championship/championshipManager.js');
    const champ = ChampionshipManager.createChampionship({ seasonLength: 3 });
    const mount = document.getElementById('championshipMount');
    const round = champ.calendar[0];
    round.grid = champ.drivers.map((d, i) => ({
      gridPosition: i + 1,
      driverCode: d.code
    }));
    ChampionshipViews.renderStartingGrid(mount, champ, round, {
      onProceedToRacePrep: () => {},
      onBackToHub: () => {}
    });
  })()`);
  await sleep(150);

  const gridMobileCheck = await evalInBrowser(`(() => {
    const grid = document.querySelector('.f1-grid-staggered');
    const slotRight = document.querySelector('.f1-grid-slot.slot-right');
    const cols = grid ? getComputedStyle(grid).gridTemplateColumns : '';
    const marginLeft = slotRight ? getComputedStyle(slotRight).marginLeft : '';

    return {
      cols,
      singleCol: !cols.includes(' '),
      marginLeft
    };
  })()`);
  console.log('  Starting Grid at 375px:', gridMobileCheck);
  assert.equal(gridMobileCheck.singleCol, true, 'Starting grid must collapse to a single column on phones (<= 640px)');
  assert.equal(gridMobileCheck.marginLeft, '20px', 'Starting grid slot-right must keep 20px indent for staggered look');

  // 3. Render Standings modal & check column hiding
  await evalInBrowser(`(async () => {
    const { ChampionshipViews } = await import('./src/ui/championshipViews.js');
    const { ChampionshipManager } = await import('./src/championship/championshipManager.js');
    const champ = ChampionshipManager.createChampionship({ seasonLength: 3 });
    const mount = document.getElementById('championshipMount');
    ChampionshipViews.renderStandingsModal(mount, champ, {
      onClose: () => {}
    });
  })()`);
  await sleep(150);

  const standingsCheck = await evalInBrowser(`(() => {
    const head = document.querySelector('.f1-standings-content .f1-table-head');
    const thirdCol = head?.querySelector(':nth-child(3)'); // Team
    const fifthCol = head?.querySelector(':nth-child(5)'); // Pod
    const sixthCol = head?.querySelector(':nth-child(6)'); // Gap

    return {
      teamDisplay: thirdCol ? getComputedStyle(thirdCol).display : '',
      podDisplay: fifthCol ? getComputedStyle(fifthCol).display : '',
      gapDisplay: sixthCol ? getComputedStyle(sixthCol).display : ''
    };
  })()`);
  console.log('  Standings table at 375px:', standingsCheck);
  assert.equal(standingsCheck.teamDisplay, 'none', 'Driver standings must hide Team column on phones');
  assert.equal(standingsCheck.podDisplay, 'none', 'Driver standings must hide Podiums column on phones');
  assert.equal(standingsCheck.gapDisplay, 'none', 'Driver standings must hide Gap column on phones');
  console.log('  ✅ Data table columns gracefully hide on mobile viewport');

  // ── Test 2F: Zero Horizontal Overflow Across All Mobile Viewports ───────────
  console.log('\n▶ Test 2F: Validating zero horizontal overflow across 5 mobile viewports');
  const viewports = [
    { width: 320, height: 568, name: 'iPhone 5/SE1 (320px)' },
    { width: 375, height: 667, name: 'iPhone SE 2/3 (375px)' },
    { width: 390, height: 844, name: 'iPhone 12/13/14 (390px)' },
    { width: 430, height: 932, name: 'iPhone 14/15 Pro Max (430px)' },
    { width: 768, height: 1024, name: 'iPad Portrait (768px)' }
  ];

  for (const vp of viewports) {
    await setViewport(vp.width, vp.height);
    const overflow = await evalInBrowser(`(() => {
      const docEl = document.documentElement;
      return docEl.scrollWidth > docEl.clientWidth + 1;
    })()`);
    console.log(`  • ${vp.name}: overflow=${overflow ? 'FAIL' : 'NONE'}`);
    assert.equal(overflow, false, `Viewport ${vp.name} must have zero horizontal overflow`);
  }

  console.log('\n🏁 ══════════════════════════════════════════════════════════════');
  console.log('   ALL CHAMPIONSHIP MOBILE RESPONSIVE VERIFICATIONS PASSED!     ');
  console.log('════════════════════════════════════════════════════════════════\n');

} finally {
  if (ws) ws.close();
  chromeProc.kill();
}
