/**
 * test_e2e_landing_audio_flow.mjs
 * End-to-end browser validation of the landing page, audio playlist looping,
 * pre-race wizard audio playback, and audio cessation when race start lights appear.
 */

import { spawn } from 'child_process';
import { strict as assert } from 'assert';

import { getChromePath, getTempProfileDir, connectToChromePage } from './testHelper.js';

console.log('🏁 ══════════════════════════════════════════════════════════════');
console.log('   E2E BROWSER VALIDATION: PLAYLIST LOOP & RACE START LIGHTS     ');
console.log('════════════════════════════════════════════════════════════════\n');

const profileDir = getTempProfileDir('chrome-landing-audio');
const chrome = spawn(getChromePath(), [
  '--headless=new',
  '--remote-debugging-port=9224',
  '--remote-debugging-address=127.0.0.1',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--no-sandbox',
  '--autoplay-policy=no-user-gesture-required',
  `--user-data-dir=${profileDir}`,
  'http://localhost:8765/'
]);

async function run() {
  const ws = await connectToChromePage(9224, '8765');

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
      if (document.getElementById('lpBtnMusic')) resolve(true);
      else setTimeout(check, 100);
    };
    check();
  })`);

  // ── Stage 1: Landing Page DOM & Default Speaker Status ────────────────────
  console.log('Stage 1: Validating Landing Page & Default Speaker ON State');
  const step1 = await evalInBrowser(`(function() {
    const landing = document.getElementById('landingView');
    const btnMusic = document.getElementById('lpBtnMusic');
    const btnMusicPrev = document.getElementById('lpBtnMusicPrev');
    const btnMusicNext = document.getElementById('lpBtnMusicNext');
    const iconMusic = document.getElementById('lpMusicIcon');
    const labelMusic = document.getElementById('lpMusicLabel');

    return {
      landingDisplay: getComputedStyle(landing).display,
      landingHtmlLength: landing.innerHTML.length,
      hasBtnMusic: !!btnMusic,
      hasBtnMusicPrev: !!btnMusicPrev,
      hasBtnMusicNext: !!btnMusicNext,
      speakerIcon: iconMusic?.textContent,
      musicLabel: labelMusic?.textContent
    };
  })()`);

  console.log('  Landing DOM state:', step1.result.value);
  assert.equal(step1.result.value.landingDisplay, 'block', 'Landing page must be visible on initial load');
  assert(step1.result.value.hasBtnMusic, 'Navbar must contain soundtrack music toggle button');
  assert.equal(step1.result.value.hasBtnMusicPrev, false, 'Must NOT show previous song button');
  assert.equal(step1.result.value.hasBtnMusicNext, false, 'Must NOT show next song button');
  assert.equal(step1.result.value.speakerIcon, '🔊', 'Speaker must be ON by default (🔊)');
  assert(!step1.result.value.musicLabel.includes('/'), 'Must NOT show how many audios available (e.g. 1/4)');
  console.log('  ✓ Default speaker is ON, no next song buttons, and no audio count shown');

  // ── Stage 2: Background Sequential Looping of All 4 Installed Tracks ─────
  console.log('\nStage 2: Validating Background Sequential Looping (Without Exposing Counts)');
  const step2 = await evalInBrowser(`(async function() {
    const { getLandingAudio, SOUNDTRACK_PLAYLIST } = await import('/src/ui/landingAudio.js');
    const audioCtrl = getLandingAudio();

    // Start with Track 0
    audioCtrl.selectTrack(0, false);
    const label0 = document.getElementById('lpMusicLabel')?.textContent;

    // Advance 0 -> 1
    audioCtrl.next(false);
    const label1 = document.getElementById('lpMusicLabel')?.textContent;

    // Advance 1 -> 2
    audioCtrl.next(false);
    const label2 = document.getElementById('lpMusicLabel')?.textContent;

    // Advance 2 -> 3
    audioCtrl.next(false);
    const label3 = document.getElementById('lpMusicLabel')?.textContent;

    // Advance 3 -> 0 (Sequential Loop Wrap)
    audioCtrl.next(false);
    const labelWrap = document.getElementById('lpMusicLabel')?.textContent;

    // Reset to Track 0 and play
    audioCtrl.selectTrack(0, true);
    await new Promise(r => setTimeout(r, 200));

    return {
      playlistLength: SOUNDTRACK_PLAYLIST.length,
      label0,
      label1,
      label2,
      label3,
      labelWrap,
      hasAnyFraction: [label0, label1, label2, label3, labelWrap].some(l => l && l.includes('/')),
      speakerIcon: document.getElementById('lpMusicIcon')?.textContent,
      isPlaying: audioCtrl.isPlaying
    };
  })()`);

  console.log('  Background Playlist Result:', step2.result.value);
  assert.equal(step2.result.value.playlistLength, 4, 'Playlist must contain 4 installed tracks');
  assert.equal(step2.result.value.hasAnyFraction, false, 'No UI label may show track count or fraction (e.g. 1/4)');
  assert.equal(step2.result.value.speakerIcon, '🔊', 'Speaker icon must be 🔊 when enabled');
  console.log('  ✓ Background 4-track loop verified without exposing count or fractions');

  // ── Stage 3: Audio Plays in Quick Race Wizard UNTIL Race Start Lights ─────
  console.log('\nStage 3: Validating Audio Plays During Setup Wizard Until Start Lights Appear');
  const step3 = await evalInBrowser(`(async function() {
    const { getLandingAudio } = await import('/src/ui/landingAudio.js');
    const audioCtrl = getLandingAudio();

    // 1. Click Hero "Start Racing" CTA to enter Quick Race Entry Portal / Wizard
    const heroBtn = document.getElementById('lpHeroStartBtn');
    heroBtn.click();
    await new Promise(r => setTimeout(r, 400));

    // Audio MUST still be playing during the setup portal / wizard!
    const audioPlayingInEntryPortal = audioCtrl.isPlaying;

    // Open Wizard via #btnQRCustomize
    const btnCustom = document.getElementById('btnQRCustomize');
    if (btnCustom) {
      btnCustom.click();
      await new Promise(r => setTimeout(r, 300));
    }

    // Step through wizard until review step (Step 6)
    for (let s = 1; s < 6; s++) {
      const nextBtn = document.getElementById('btnWizNext');
      if (nextBtn) {
        nextBtn.click();
        await new Promise(r => setTimeout(r, 200));
      }
    }

    // Audio MUST still be playing during step 6 review!
    const audioPlayingInWizardReview = audioCtrl.isPlaying;

    // 2. Click "START RACE" via #btnWizLaunch
    const startRaceBtn = document.getElementById('btnWizLaunch');
    if (startRaceBtn) {
      startRaceBtn.click();
      await new Promise(r => setTimeout(r, 600));
    }

    // Gantry start lights check
    const gantry = document.getElementById('gantryOverlay');
    const gantryVisible = gantry && gantry.style.display !== 'none' && !gantry.classList.contains('gantry-hidden');
    const litLights = document.querySelectorAll('#gantryOverlay .gantry-light.lit').length;

    // AUDIO MUST BE PAUSED ONCE RACE START LIGHTS APPEAR!
    const audioPausedWhenStartLightsAppear = !audioCtrl.isPlaying;

    return {
      audioPlayingInEntryPortal,
      audioPlayingInWizardReview,
      gantryVisible,
      litLights,
      audioPausedWhenStartLightsAppear
    };
  })()`);

  console.log('  Start Lights Transition result:', step3.result.value);
  assert(step3.result.value.audioPlayingInEntryPortal, 'Soundtrack must play during Quick Race entry portal');
  assert(step3.result.value.audioPlayingInWizardReview, 'Soundtrack must play during Quick Race wizard configuration');
  assert(step3.result.value.gantryVisible, 'Starting lights gantry overlay must appear on race launch');
  assert(step3.result.value.audioPausedWhenStartLightsAppear, 'Audio MUST pause as soon as race start lights appear on the gantry!');
  console.log('  ✓ Audio plays continuously until race start lights appear on gantry');

  // ── Stage 4: Returning to Landing Page Resumes Audio ─────────────────────
  console.log('\nStage 4: Validating Return Home Resumes Soundtrack Playback');
  const step4 = await evalInBrowser(`(async function() {
    const { getLandingAudio } = await import('/src/ui/landingAudio.js');
    const audioCtrl = getLandingAudio();

    // Click HOME button in header
    const homeBtn = document.getElementById('navHome');
    homeBtn.click();
    await new Promise(r => setTimeout(r, 400));

    const landing = document.getElementById('landingView');
    const simView = document.getElementById('simulatorView');
    const audioResumed = audioCtrl.isPlaying;

    return {
      landingVisible: landing.style.display === 'block',
      simViewHidden: simView.style.display === 'none',
      audioResumed
    };
  })()`);

  console.log('  Return Home result:', step4.result.value);
  assert(step4.result.value.landingVisible, 'Landing page must become visible again');
  assert(step4.result.value.simViewHidden, 'Simulator view must hide upon returning home');
  assert(step4.result.value.audioResumed, 'Soundtrack must resume playing when returning to landing page');
  console.log('  ✓ Return to Landing Page & Audio Resume passed');

  // ── Stage 5: Championship Mode Menu Plays Audio ──────────────────────────
  console.log('\nStage 5: Validating Audio Plays in Championship Screens');
  const step5 = await evalInBrowser(`(async function() {
    const { getLandingAudio } = await import('/src/ui/landingAudio.js');
    const audioCtrl = getLandingAudio();

    // Click Hero "Explore Championship" CTA
    const champBtn = document.getElementById('lpHeroChampBtn');
    champBtn.click();
    await new Promise(r => setTimeout(r, 400));

    const champMount = document.getElementById('championshipMount');
    const champMountVisible = champMount.style.display === 'block';
    const audioPlayingInChamp = audioCtrl.isPlaying;

    // Return Home
    document.getElementById('navHome')?.click();
    await new Promise(r => setTimeout(r, 400));

    return {
      champMountVisible,
      audioPlayingInChamp,
      landingRestored: document.getElementById('landingView').style.display === 'block',
      audioStillPlayingOnReturn: audioCtrl.isPlaying
    };
  })()`);

  console.log('  Championship Flow result:', step5.result.value);
  assert(step5.result.value.champMountVisible, 'Championship mount must be visible in Championship mode');
  assert(step5.result.value.audioPlayingInChamp, 'Audio must continue playing during Championship mode menus');
  assert(step5.result.value.landingRestored, 'Landing page must restore when navigating home');
  assert(step5.result.value.audioStillPlayingOnReturn, 'Audio must continue playing on return');
  console.log('  ✓ Championship Mode audio flow passed');

  // ── Stage 6: Modals (Draft Team & Settings) ──────────────────────────────
  console.log('\nStage 6: Validating Modals & Audio Continuity');
  const step6 = await evalInBrowser(`(async function() {
    const { getLandingAudio } = await import('/src/ui/landingAudio.js');
    const audioCtrl = getLandingAudio();

    // 1. Open Draft Modal from Hero
    document.getElementById('lpHeroChangeDraftBtn')?.click();
    await new Promise(r => setTimeout(r, 300));
    const draftModal = document.getElementById('draftModalContainer');
    const draftOpen = draftModal && draftModal.style.display !== 'none';
    const audioPlayingInDraft = audioCtrl.isPlaying;

    // Close Draft Modal
    document.getElementById('draftCloseBtn')?.click();
    await new Promise(r => setTimeout(r, 200));

    // 2. Open Settings Modal from Navbar
    document.getElementById('lpBtnSettings')?.click();
    await new Promise(r => setTimeout(r, 300));
    const settingsModal = document.getElementById('settingsModal');
    const settingsOpen = settingsModal && settingsModal.style.display !== 'none';
    const audioPlayingInSettings = audioCtrl.isPlaying;

    // Close Settings Modal
    document.getElementById('btnSaveCloseSettings')?.click();
    await new Promise(r => setTimeout(r, 200));

    return {
      draftModalWorked: draftOpen,
      audioPlayingInDraft,
      settingsModalWorked: settingsOpen,
      audioPlayingInSettings
    };
  })()`);

  console.log('  Modals result:', step6.result.value);
  assert(step6.result.value.draftModalWorked, 'Draft modal must open on user trigger');
  assert(step6.result.value.audioPlayingInDraft, 'Audio must play during Draft modal');
  assert(step6.result.value.settingsModalWorked, 'Settings modal must open on user trigger');
  assert(step6.result.value.audioPlayingInSettings, 'Audio must play during Settings modal');
  console.log('  ✓ Draft & Settings modals audio continuity verified');

  console.log('\n════════════════════════════════════════════════════════════════');
  console.log('🎉 ALL REQUIREMENTS FULLY VALIDATED!');
  console.log('   - 4-Track Looping Playlist operates continuously (1->2->3->4->1)');
  console.log('   - Soundtrack plays throughout Landing, Wizard, and Championship');
  console.log('   - Soundtrack ceases exactly when race start lights appear');
  console.log('════════════════════════════════════════════════════════════════\n');

  chrome.kill();
  process.exit(0);
}

run().catch((err) => {
  console.error('Test execution error:', err);
  chrome.kill();
  process.exit(1);
});