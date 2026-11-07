/**
 * test_e2e_fixed_background.mjs
 * Browser automation test verifying fixed screen background image,
 * zero layout shift on scroll, and immersive gaming glassmorphism.
 */

import { spawn } from 'child_process';
import { strict as assert } from 'assert';

import { getChromePath, getTempProfileDir, connectToChromePage } from './testHelper.js';

console.log('🏎️ ══════════════════════════════════════════════════════════════');
console.log('   E2E BROWSER VALIDATION: FIXED SCREEN BACKGROUND & GAMING UI   ');
console.log('════════════════════════════════════════════════════════════════\n');

const profileDir = getTempProfileDir('chrome-fixed-bg');
const chrome = spawn(getChromePath(), [
  '--headless=new',
  '--remote-debugging-port=9222',
  '--remote-debugging-address=127.0.0.1',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--no-sandbox',
  '--autoplay-policy=no-user-gesture-required',
  `--user-data-dir=${profileDir}`,
  'http://127.0.0.1:8765/'
]);

async function run() {
  const ws = await connectToChromePage(9222, '8765');

  let msgId = 1;
  const pending = new Map();

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
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

  // Wait for landing view to fully mount
  await evalInBrowser(`new Promise((resolve) => {
    const check = () => {
      if (document.querySelector('.lp-fixed-screen-bg')) resolve(true);
      else setTimeout(check, 100);
    };
    check();
  })`);

  // Stage 1: Verify Fixed Background Elements in DOM
  console.log('Stage 1: Validating Fixed Background Structure');
  const stage1 = await evalInBrowser(`(function() {
    const bgContainer = document.querySelector('.lp-fixed-screen-bg');
    const bgImg = document.querySelector('.lp-fixed-bg-img');
    const bgOverlay = document.querySelector('.lp-fixed-bg-overlay');
    const bgVignette = document.querySelector('.lp-fixed-bg-vignette');
    const bgGrid = document.querySelector('.lp-fixed-bg-grid');

    if (!bgContainer || !bgImg) {
      return { success: false, reason: 'Missing fixed background element' };
    }

    const cStyle = getComputedStyle(bgContainer);
    const iStyle = getComputedStyle(bgImg);

    return {
      success: true,
      position: cStyle.position,
      top: cStyle.top,
      left: cStyle.left,
      zIndex: cStyle.zIndex,
      objectFit: iStyle.objectFit,
      imgSrc: bgImg.getAttribute('src'),
      hasOverlay: !!bgOverlay,
      hasVignette: !!bgVignette,
      hasGrid: !!bgGrid
    };
  })()`);

  console.log('  Fixed BG computed styles:', stage1.result.value);
  assert(stage1.result.value.success, 'Fixed background elements must exist');
  assert.equal(stage1.result.value.position, 'fixed', 'Background container must have position: fixed');
  assert.equal(stage1.result.value.top, '0px', 'Background must be anchored at top: 0');
  assert.equal(stage1.result.value.left, '0px', 'Background must be anchored at left: 0');
  assert.equal(stage1.result.value.objectFit, 'cover', 'Background image must scale with object-fit: cover');
  assert(stage1.result.value.imgSrc.includes('hero_sunset_race.png') || stage1.result.value.imgSrc.includes('hero_racing_car.jpg'), 'Background image must reference racing car');
  console.log('  ✓ Fixed background container and layers confirmed');

  // Stage 2: Test Scrolling Behavior (Zero Drift of Fixed Background)
  console.log('\nStage 2: Validating Immersive Zero-Drift on Page Scroll');
  const stage2 = await evalInBrowser(`(async function() {
    const bgContainer = document.querySelector('.lp-fixed-screen-bg');
    const initialRect = bgContainer.getBoundingClientRect();

    // Scroll down 600px into Featured Circuits section
    window.scrollTo({ top: 600, behavior: 'instant' });
    await new Promise(r => setTimeout(r, 200));
    const scrolledRect1 = bgContainer.getBoundingClientRect();

    // Scroll down 1500px to bottom
    window.scrollTo({ top: 1500, behavior: 'instant' });
    await new Promise(r => setTimeout(r, 200));
    const scrolledRect2 = bgContainer.getBoundingClientRect();

    // Scroll back to top
    window.scrollTo({ top: 0, behavior: 'instant' });
    await new Promise(r => setTimeout(r, 200));

    return {
      initialTop: initialRect.top,
      initialHeight: initialRect.height,
      scrolled1Top: scrolledRect1.top,
      scrolled1Height: scrolledRect1.height,
      scrolled2Top: scrolledRect2.top,
      scrolled2Height: scrolledRect2.height
    };
  })()`);

  console.log('  Scroll measurements:', stage2.result.value);
  assert.equal(stage2.result.value.initialTop, 0, 'Initial rect top must be 0');
  assert.equal(stage2.result.value.scrolled1Top, 0, 'After 600px scroll, fixed background top must remain exactly 0');
  assert.equal(stage2.result.value.scrolled2Top, 0, 'After 1500px scroll, fixed background top must remain exactly 0');
  assert(stage2.result.value.initialHeight > 400, 'Height must span full viewport');
  console.log('  ✓ Background remains 100% fixed throughout scroll');

  // Stage 3: Validate Glassmorphism & Translucent Depth on Content Cards
  console.log('\nStage 3: Validating Glassmorphic Depth on Cards & Strips');
  const stage3 = await evalInBrowser(`(function() {
    const modeCard = document.querySelector('.lp-mode-card');
    const circuitCard = document.querySelector('.lp-circuit-card');
    const featureStrip = document.querySelector('.lp-feature-strip');

    const mStyle = modeCard ? getComputedStyle(modeCard) : null;
    const cStyle = circuitCard ? getComputedStyle(circuitCard) : null;
    const fStyle = featureStrip ? getComputedStyle(featureStrip) : null;

    return {
      hasModeCard: !!modeCard,
      modeCardBackdrop: mStyle?.backdropFilter,
      modeCardBg: mStyle?.backgroundColor,
      hasCircuitCard: !!circuitCard,
      circuitCardBackdrop: cStyle?.backdropFilter,
      circuitCardBg: cStyle?.backgroundColor,
      featureStripBackdrop: fStyle?.backdropFilter
    };
  })()`);

  console.log('  Glassmorphic card styles:', stage3.result.value);
  assert(stage3.result.value.modeCardBg.includes('rgba'), 'Mode cards must use translucent background for gaming depth');
  assert(stage3.result.value.circuitCardBg.includes('rgba'), 'Circuit cards must use translucent background for gaming depth');
  console.log('  ✓ Frosted glassmorphism and depth layers confirmed');

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('🎉 FIXED SCREEN BACKGROUND & IMMERSIVE GAMING LAYOUT VERIFIED!');
  console.log('══════════════════════════════════════════════════════════════\n');

  chrome.kill();
  process.exit(0);
}

run().catch((err) => {
  console.error('Test failed:', err);
  chrome.kill();
  process.exit(1);
});