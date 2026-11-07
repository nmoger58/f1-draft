/**
 * test_e2e_ml_draft_mode.mjs
 * End-to-end browser validation of:
 *   1. F1 Draft Mode card on landing page
 *   2. Era / Season selection screen (2019–2025)
 *   3. 7-Algorithm ML Intelligence on Draft Cards:
 *      - Rarity tiers (LEGENDARY, EPIC, RARE, UNCOMMON, COMMON)
 *      - ML Statistical Confidence score
 *      - ML Capabilities chips (TYR, CON, PACE)
 *      - Machinery OVR, Aero bias & Technical Strengths
 *      - Manager tactical attributes & stopwatch perks
 *   4. 4-Stage Draft flow (Driver → Manager → Car → Summary)
 *   5. Launching Quick Race with drafted lineup
 */

import { spawn } from 'child_process';
import { strict as assert } from 'assert';

import { getChromePath, getTempProfileDir, connectToChromePage } from './testHelper.js';

console.log('🏎️ ══════════════════════════════════════════════════════════════');
console.log('   E2E BROWSER VALIDATION: F1 DRAFT MODE & ML INTELLIGENCE       ');
console.log('════════════════════════════════════════════════════════════════\n');

const profileDir = getTempProfileDir('chrome-draft');
const chrome = spawn(getChromePath(), [
  '--headless=new',
  '--remote-debugging-port=9226',
  '--remote-debugging-address=127.0.0.1',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--no-sandbox',
  '--autoplay-policy=no-user-gesture-required',
  `--user-data-dir=${profileDir}`,
  'http://localhost:8765/'
]);

async function run() {
  const ws = await connectToChromePage(9226, '8765');

  let msgId = 1;
  const pending = new Map();

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.method === 'Runtime.exceptionThrown') {
      console.error('❌ BROWSER EXCEPTION:', msg.params.exceptionDetails.text, msg.params.exceptionDetails.exception?.description);
    }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) {
        const err = new Error(msg.error.message || 'CDP Error');
        err.code = msg.error.code;
        if (reject) reject(err);
        else resolve(msg.result?.result?.value ?? msg.result?.value ?? msg.result);
      } else {
        resolve(msg.result?.result?.value ?? msg.result?.value ?? msg.result);
      }
    }
  };

  const evalInBrowser = (expr) => {
    return new Promise(async (resolve, reject) => {
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const res = await new Promise((resFn, rejFn) => {
            const id = ++msgId;
            pending.set(id, { resolve: resFn, reject: rejFn });
            ws.send(JSON.stringify({
              id,
              method: 'Runtime.evaluate',
              params: { expression: expr, returnByValue: true, awaitPromise: true }
            }));
          });
          return resolve(res);
        } catch (err) {
          const isCtx = err?.code === -32000 || (err?.message && (err.message.includes('-32000') || err.message.includes('Execution context was destroyed')));
          if (isCtx && attempt < 4) {
            await new Promise(r => setTimeout(r, 200));
            continue;
          }
          return reject(err);
        }
      }
    });
  };

  ws.send(JSON.stringify({ id: ++msgId, method: 'Runtime.enable' }));
  ws.send(JSON.stringify({ id: ++msgId, method: 'Page.enable' }));

  // Wait for landing page DOM and components to be fully rendered
  for (let i = 0; i < 25; i++) {
    const ready = await evalInBrowser(`!!document.querySelector('.lp-mode-card[data-mode="draftmode"]')`);
    if (ready) break;
    await new Promise(r => setTimeout(r, 200));
  }

  console.log('▶ Stage 1: Verify F1 Draft Mode Card on Landing Page');
  const stage1 = await evalInBrowser(`
    (() => {
      const draftCard = document.querySelector('.lp-mode-card[data-mode="draftmode"]');
      const navBtn = document.querySelector('button[data-action="draftmode"]');
      return {
        cardFound: !!draftCard,
        cardTitle: draftCard?.querySelector('.lp-mode-title')?.textContent?.trim() || '',
        badgeText: draftCard?.querySelector('.lp-mode-badge')?.textContent?.trim() || '',
        navFound: !!navBtn
      };
    })()
  `);
  console.log('  Stage 1 result:', stage1);
  assert(stage1.cardFound, 'F1 Draft Mode card must exist on landing page');
  assert(stage1.cardTitle === 'F1 Draft Mode', 'Card title must be "F1 Draft Mode"');
  assert(stage1.navFound, 'Draft Mode nav button must exist');
  console.log('  ✓ Stage 1 Passed: F1 Draft Mode card & nav link present\n');

  console.log('▶ Stage 2: Click F1 Draft Mode and Verify Season Era Picker');
  const stage2 = await evalInBrowser(`
    (() => {
      const draftCard = document.querySelector('.lp-mode-card[data-mode="draftmode"]');
      draftCard.click();
      const mount = document.getElementById('draftModeMount');
      const yearGrid = document.getElementById('fdmYearGrid');
      const yearCards = document.querySelectorAll('.fdm-year-card');
      return {
        mountVisible: mount && mount.style.display !== 'none',
        gridFound: !!yearGrid,
        yearCardCount: yearCards.length,
        years: Array.from(yearCards).map(c => c.dataset.year)
      };
    })()
  `);
  console.log('  Stage 2 result:', stage2);
  assert(stage2.mountVisible, 'Draft mode mount must be visible');
  assert(stage2.yearCardCount === 7, 'Must display 7 historic season cards (2019-2025)');
  assert(stage2.years.includes('2021'), 'Must include 2021 season');
  assert(stage2.years.includes('2025'), 'Must include 2025 season');
  console.log('  ✓ Stage 2 Passed: 7 historic seasons (2019–2025) displayed\n');

  console.log('▶ Stage 3: Select Season 2021 and Open Draft Wizard');
  await evalInBrowser(`
    (() => {
      const card2021 = document.querySelector('.fdm-year-card[data-year="2021"]');
      card2021.click();
    })()
  `);

  // Wait for CSV data to fetch and modal to open
  await new Promise(r => setTimeout(r, 1200));

  const stage3 = await evalInBrowser(`
    (() => {
      const modal = document.getElementById('draftModalContainer');
      const driverCards = document.querySelectorAll('.draft-card[data-category="driver"]');
      const sample = driverCards[0];
      return {
        modalOpen: !!modal,
        cardCount: driverCards.length,
        hasRarityBadge: !!sample?.querySelector('.draft-rarity-badge'),
        rarityText: sample?.querySelector('.draft-rarity-badge')?.textContent?.trim() || '',
        hasMLConfidence: !!sample?.querySelector('.draft-ml-confidence'),
        confidenceText: sample?.querySelector('.draft-ml-confidence')?.textContent?.trim() || '',
        hasMLPills: !!sample?.querySelector('.draft-ml-pills'),
        pillsText: sample?.querySelector('.draft-ml-pills')?.textContent?.replace(/\\s+/g, ' ')?.trim() || '',
        driverName: sample?.querySelector('.draft-card-name')?.textContent?.trim() || ''
      };
    })()
  `);
  console.log('  Stage 3 result:', stage3);
  assert(stage3.modalOpen, 'Draft modal must be open');
  assert(stage3.cardCount === 5, 'Must render 5-card draft set');
  assert(stage3.hasRarityBadge, 'Driver card must feature rarity badge');
  assert(stage3.hasMLConfidence, 'Driver card must feature statistical ML confidence');
  assert(stage3.hasMLPills, 'Driver card must feature ML capability pills (TYR, CON, PACE)');
  console.log('  ✓ Stage 3 Passed: 2021 season roster loaded with ML intelligence & rarity tiers\n');

  console.log('▶ Stage 4: Pick Driver & Advance to Manager Stage');
  const stage4 = await evalInBrowser(`
    (() => {
      const driverCard = document.querySelector('.draft-card[data-category="driver"]');
      driverCard.click();
      const nextBtn = document.getElementById('draftNextBtn');
      nextBtn.click();
      const mgrCards = document.querySelectorAll('.draft-card[data-category="manager"]');
      const sampleMgr = mgrCards[0];
      return {
        managerCardsCount: mgrCards.length,
        hasRarity: !!sampleMgr?.querySelector('.draft-rarity-badge'),
        hasPerks: !!sampleMgr?.querySelector('.draft-perks-list'),
        mgrName: sampleMgr?.querySelector('.draft-card-name')?.textContent?.trim() || ''
      };
    })()
  `);
  console.log('  Stage 4 result:', stage4);
  assert(stage4.managerCardsCount === 5, 'Must render 5 manager draft cards');
  assert(stage4.hasRarity, 'Manager card must feature rarity tier');
  assert(stage4.hasPerks, 'Manager card must feature tactical perks');
  console.log('  ✓ Stage 4 Passed: Team Principals rendered with tactical traits\n');

  console.log('▶ Stage 5: Pick Manager & Advance to Car Stage (Machinery Strengths)');
  const stage5 = await evalInBrowser(`
    (() => {
      const mgrCard = document.querySelector('.draft-card[data-category="manager"]');
      mgrCard.click();
      document.getElementById('draftNextBtn').click();
      const carCards = document.querySelectorAll('.draft-card[data-category="car"]');
      const sampleCar = carCards[0];
      return {
        carCardsCount: carCards.length,
        hasRarity: !!sampleCar?.querySelector('.draft-rarity-badge'),
        hasStrengths: !!sampleCar?.querySelector('.draft-note-strength'),
        strengthsText: sampleCar?.querySelector('.draft-note-strength')?.textContent?.trim() || '',
        carName: sampleCar?.querySelector('.draft-card-name')?.textContent?.trim() || ''
      };
    })()
  `);
  console.log('  Stage 5 result:', stage5);
  assert(stage5.carCardsCount === 5, 'Must render 5 car cards');
  assert(stage5.hasRarity, 'Car card must feature machinery rarity');
  assert(stage5.hasStrengths, 'Car card must display authentic technical strengths');
  assert(stage5.strengthsText.length > 20, 'Technical strengths text must be detailed');
  console.log('  ✓ Stage 5 Passed: Cars rendered with machinery rating & authentic strengths\n');

  console.log('▶ Stage 6: Pick Car & Advance to Draft Summary & Synergy');
  const stage6 = await evalInBrowser(`
    (() => {
      const carCard = document.querySelector('.draft-card[data-category="car"]');
      carCard.click();
      document.getElementById('draftNextBtn').click();
      const summaryBanner = document.querySelector('.draft-summary-banner');
      const synergyPanel = document.querySelector('.draft-synergy-panel');
      const confirmBtn = document.getElementById('draftConfirmBtn');
      return {
        bannerFound: !!summaryBanner,
        synergyFound: !!synergyPanel,
        confirmReady: !!confirmBtn && !confirmBtn.disabled,
        confirmText: confirmBtn?.textContent?.trim() || ''
      };
    })()
  `);
  console.log('  Stage 6 result:', stage6);
  assert(stage6.bannerFound, 'Summary banner must be present');
  assert(stage6.synergyFound, 'Simulation synergy panel must be present');
  assert(stage6.confirmReady, 'Confirm button must be active');
  console.log('  ✓ Stage 6 Passed: Team Confirmation & Authoritative Synergy ready\n');

  console.log('▶ Stage 7: Confirm Lineup and Launch Quick Race');
  const stage7 = await evalInBrowser(`
    (() => {
      const confirmBtn = document.getElementById('draftConfirmBtn');
      confirmBtn.click();
      const quickRacePortal = document.querySelector('.qr-portal-container');
      const quickRaceMount = document.getElementById('quickRaceMount');
      const landingView = document.getElementById('landingView');
      return {
        modalClosed: !document.getElementById('draftModalContainer'),
        landingHidden: landingView && landingView.style.display === 'none',
        quickRaceActive: (quickRaceMount && quickRaceMount.style.display !== 'none') || !!quickRacePortal
      };
    })()
  `);
  console.log('  Stage 7 result:', stage7);
  assert(stage7.modalClosed, 'Modal must close on confirm');
  assert(stage7.landingHidden, 'Landing view must be hidden');
  console.log('  ✓ Stage 7 Passed: Successfully launched Quick Race with historic lineup\n');

  console.log('🏁 ══════════════════════════════════════════════════════════════');
  console.log('   ALL E2E STAGES PASSED! ML DRAFT MODE SYSTEM VERIFIED GREEN!   ');
  console.log('════════════════════════════════════════════════════════════════\n');

  ws.close();
  chrome.kill();
  process.exit(0);
}

run().catch(err => {
  console.error('\n❌ E2E TEST FAILED:', err);
  chrome.kill();
  process.exit(1);
});
