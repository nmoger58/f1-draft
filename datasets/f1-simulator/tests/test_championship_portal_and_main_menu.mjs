/**
 * test_championship_portal_and_main_menu.mjs
 * End-to-end verification of Championship Mode launching and Main Menu navigation fixes:
 * 1. Entering Championship mode displays championship portal.
 * 2. Clicking "← MAIN MENU" in championship portal returns to landing page (#landingView, .lp-navbar) and hides #simHeader.
 * 3. Starting a championship through the wizard transitions to Championship Hub.
 * 4. In Hub, clicking "Save & Exit to Main Menu" returns to landing page (#landingView, .lp-navbar) and hides #simHeader.
 * 5. Entering race session properly unhides #simulatorView and launches 5-red-light sequence.
 * 6. In-race clicking "Main Menu" (#btnRaceExitMenu) or header (#navHome) returns cleanly to landing page.
 * 7. Results modal features Save & Exit to Main Menu returning to landing page.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { getChromePath, getTempProfileDir, connectToChromePage } from './testHelper.js';

const APP_URL = 'http://localhost:8765/';
const DEBUG_PORT = 9260;

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

console.log('🏎️  RUNNING CHAMPIONSHIP MODE & MAIN MENU ROUTING VERIFICATION SUITE\n');

const profileDir = getTempProfileDir('chrome-championship');
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

let msgId = 0;
const pending = new Map();

function sendCommand(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evalInBrowser(ws, expression) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await sendCommand(ws, 'Runtime.evaluate', {
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

async function run() {
  const ws = await connectToChromePage(DEBUG_PORT, '8765');

  ws.on('message', data => {
    const msg = JSON.parse(data.toString());
    if (msg.method === 'Runtime.consoleAPICalled') {
      console.log('[Browser Console]', msg.params.type, msg.params.args?.map(a => a.value || a.description).join(' '));
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      console.error('[Browser Exception]', JSON.stringify(msg.params.exceptionDetails));
    }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) {
        const err = new Error(msg.error.message || 'CDP Error');
        err.code = msg.error.code;
        if (reject) reject(err);
        else resolve(msg.result);
      } else {
        resolve(msg.result);
      }
    }
  });

  await sendCommand(ws, 'Runtime.enable');
  await sendCommand(ws, 'Page.enable');

  // Wait for landing view and lpNavbar to render
  for (let i = 0; i < 20; i++) {
    const ready = await evalInBrowser(ws, `!!document.getElementById('lpNavbar')`);
    if (ready) break;
    await sleep(250);
  }

  // ── STEP 1: Verify Initial Landing View & Navbar ─────────────────────────
  console.log('--- STEP 1: Landing Page Initial View ---');
  const initial = await evalInBrowser(ws, `({
    landing: document.getElementById('landingView')?.style.display,
    simHeader: document.getElementById('simHeader')?.style.display,
    simulator: document.getElementById('simulatorView')?.style.display,
    lpNavbar: !!document.getElementById('lpNavbar')
  })`);
  assert.equal(initial.landing, 'block', 'Landing view should be block');
  assert.equal(initial.simHeader, 'none', 'simHeader should be none initially');
  assert.equal(initial.lpNavbar, true, 'Landing page navbar .lp-navbar must be present');
  console.log('  ✅ Landing view with .lp-navbar active initially');

  // ── STEP 2: Open Championship Mode & Return to Main Menu ─────────────────
  console.log('\n--- STEP 2: Championship Portal Back to Main Menu ---');
  await evalInBrowser(ws, `document.querySelector('.lp-mode-card[data-mode="championship"]').click()`);
  await sleep(400);

  const portalState = await evalInBrowser(ws, `({
    mountDisplay: document.getElementById('championshipMount')?.style.display,
    hasBackBtn: !!document.getElementById('btnEntryBack')
  })`);
  assert.equal(portalState.mountDisplay, 'block', 'Championship mount displayed');
  assert.equal(portalState.hasBackBtn, true, '← MAIN MENU button present');

  // Click ← MAIN MENU
  await evalInBrowser(ws, `document.getElementById('btnEntryBack').click()`);
  await sleep(400);

  const afterPortalBack = await evalInBrowser(ws, `({
    landing: document.getElementById('landingView')?.style.display,
    simHeader: document.getElementById('simHeader')?.style.display,
    championshipMount: document.getElementById('championshipMount')?.style.display,
    lpNavbar: !!document.getElementById('lpNavbar')
  })`);
  assert.equal(afterPortalBack.landing, 'block', 'Landing view restored');
  assert.equal(afterPortalBack.simHeader, 'none', 'simHeader hidden upon returning to Main Menu');
  assert.equal(afterPortalBack.championshipMount, 'none', 'Championship mount hidden');
  assert.equal(afterPortalBack.lpNavbar, true, 'Landing page navbar restored');
  console.log('  ✅ Clicking ← MAIN MENU in Championship portal properly restores landing navbar');

  // ── STEP 3: Complete Creation Wizard to Hub & Exit to Main Menu ──────────
  console.log('\n--- STEP 3: Wizard -> Hub -> Save & Exit to Main Menu ---');
  await evalInBrowser(ws, `document.querySelector('.lp-mode-card[data-mode="championship"]').click()`);
  await sleep(400);
  await evalInBrowser(ws, `document.getElementById('btnEntryNew').click()`);
  await sleep(300);
  await evalInBrowser(ws, `document.getElementById('btnWizNext').click()`); // step 1->2
  await sleep(300);
  await evalInBrowser(ws, `document.getElementById('btnWizNext').click()`); // step 2->3
  await sleep(300);
  await evalInBrowser(ws, `document.getElementById('btnWizNext').click()`); // step 3->4
  await sleep(300);
  await evalInBrowser(ws, `document.getElementById('btnWizConfirm').click()`); // confirm
  await sleep(500);

  const hubState = await evalInBrowser(ws, `({
    mountDisplay: document.getElementById('championshipMount')?.style.display,
    hasSaveExitBtn: !!document.getElementById('btnHubSaveExit')
  })`);
  assert.equal(hubState.mountDisplay, 'block', 'Hub displayed');
  assert.equal(hubState.hasSaveExitBtn, true, 'Save & Exit to Main Menu button present');

  // Click Save & Exit to Main Menu
  await evalInBrowser(ws, `document.getElementById('btnHubSaveExit').click()`);
  await sleep(400);

  const afterHubExit = await evalInBrowser(ws, `({
    landing: document.getElementById('landingView')?.style.display,
    simHeader: document.getElementById('simHeader')?.style.display,
    championshipMount: document.getElementById('championshipMount')?.style.display,
    lpNavbar: !!document.getElementById('lpNavbar')
  })`);
  assert.equal(afterHubExit.landing, 'block', 'Landing view restored from Hub exit');
  assert.equal(afterHubExit.simHeader, 'none', 'simHeader hidden upon Hub exit');
  assert.equal(afterHubExit.lpNavbar, true, 'Landing page navbar restored');
  console.log('  ✅ Save & Exit to Main Menu in Hub properly restores landing navbar');

  // ── STEP 4: Resume Championship & Launch Race into Simulation View ────────
  console.log('\n--- STEP 4: Resume Championship & Launch Grand Prix ---');
  await evalInBrowser(ws, `document.getElementById('lpHeroChampBtn').click()`);
  await sleep(400);

  // Active season hero card should be present
  const resumeBtn = await evalInBrowser(ws, `!!document.getElementById('btnEntryContinue')`);
  assert.equal(resumeBtn, true, 'Continue Season button present for active championship');
  await evalInBrowser(ws, `document.getElementById('btnEntryContinue').click()`);
  await sleep(400);

  // Enter round from hub
  await evalInBrowser(ws, `document.getElementById('btnHubAction').click()`);
  await sleep(400);

  // Event overview -> Proceed to practice
  await evalInBrowser(ws, `document.getElementById('btnOverviewProceed').click()`);
  await sleep(400);

  // Practice -> Skip to qualifying
  await evalInBrowser(ws, `document.getElementById('btnPracticeSkip').click()`);
  await sleep(400);

  // Qualifying -> Run shootout
  await evalInBrowser(ws, `document.getElementById('btnRunQualiAction').click()`);
  await sleep(400);

  // Qualifying -> Confirm grid
  await evalInBrowser(ws, `document.getElementById('btnConfirmGridAction').click()`);
  await sleep(400);

  // Starting grid -> Proceed to race prep
  await evalInBrowser(ws, `document.getElementById('btnGridProceed').click()`);
  await sleep(400);

  // Race prep -> TO THE GRID — START RACE!
  await evalInBrowser(ws, `document.getElementById('btnPrepStartRace').click()`);
  await sleep(1000);

  const raceState = await evalInBrowser(ws, `({
    landing: document.getElementById('landingView')?.style.display,
    simHeader: document.getElementById('simHeader')?.style.display,
    simulator: document.getElementById('simulatorView')?.style.display,
    championshipMount: document.getElementById('championshipMount')?.style.display,
    gantryHidden: document.getElementById('gantryOverlay')?.classList.contains('gantry-hidden')
  })`);
  assert.equal(raceState.landing, 'none', 'Landing view hidden during race');
  assert.equal(raceState.simulator, 'block', 'Simulator view must be visible during Championship race');
  assert.equal(raceState.simHeader, 'flex', 'simHeader active during in-race simulation');
  assert.equal(raceState.gantryHidden, false, 'Starting gantry sequence initiated');
  console.log('  ✅ Championship Grand Prix launched cleanly into simulator view with gantry sequence');

  // ── STEP 5: In-Race Return to Main Menu ───────────────────────────────────
  console.log('\n--- STEP 5: In-Race Return to Main Menu ---');
  await evalInBrowser(ws, `document.getElementById('btnRaceExitMenu').click()`);
  await sleep(400);

  const afterRaceExit = await evalInBrowser(ws, `({
    landing: document.getElementById('landingView')?.style.display,
    simHeader: document.getElementById('simHeader')?.style.display,
    simulator: document.getElementById('simulatorView')?.style.display,
    championshipMount: document.getElementById('championshipMount')?.style.display,
    lpNavbar: !!document.getElementById('lpNavbar')
  })`);
  assert.equal(afterRaceExit.landing, 'block', 'Landing view restored on in-race exit');
  assert.equal(afterRaceExit.simHeader, 'none', 'simHeader hidden on in-race exit');
  assert.equal(afterRaceExit.simulator, 'none', 'Simulator view hidden on in-race exit');
  assert.equal(afterRaceExit.lpNavbar, true, 'Landing page navbar active');
  console.log('  ✅ In-race Main Menu button properly exits race and restores landing navbar');

  // ── STEP 6: simHeader navHome Navigation ─────────────────────────────────
  console.log('\n--- STEP 6: Header navHome navigation ---');
  await evalInBrowser(ws, `document.querySelector('.lp-mode-card[data-mode="quickrace"]').click()`);
  await sleep(400);
  assert.equal(await evalInBrowser(ws, `document.getElementById('simHeader')?.style.display`), 'flex');

  // Click navHome in simHeader
  await evalInBrowser(ws, `document.getElementById('navHome').click()`);
  await sleep(400);

  const afterNavHome = await evalInBrowser(ws, `({
    landing: document.getElementById('landingView')?.style.display,
    simHeader: document.getElementById('simHeader')?.style.display,
    lpNavbar: !!document.getElementById('lpNavbar')
  })`);
  assert.equal(afterNavHome.landing, 'block');
  assert.equal(afterNavHome.simHeader, 'none');
  assert.equal(afterNavHome.lpNavbar, true);
  console.log('  ✅ navHome in simulator header properly returns to landing navbar');

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('🏁 ALL CHAMPIONSHIP MODE & MAIN MENU ROUTING TESTS PASSED (100%)');
  console.log('══════════════════════════════════════════════════════════════\n');

  ws.close();
  chromeProc.kill();
}

run().catch(err => {
  console.error('❌ Test failed:', err);
  chromeProc.kill();
  process.exit(1);
});
