import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const APP_URL = 'http://localhost:8765/';

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runNavbarValidation() {
  console.log('🏎️  VALIDATING NAVBAR REDESIGN ACROSS VIEWPORTS AND FUNCTIONALITY\n');

  const chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=9235',
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
      mobile: width < 1024
    });
    await sleep(150);
  }

  try {
    // Wait for Chrome remote debugging
    let connected = false;
    let wsUrl = '';
    for (let i = 0; i < 30; i++) {
      try {
        const resp = await fetch('http://127.0.0.1:9235/json');
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

    // Wait for landing navbar
    await evalInBrowser(`new Promise((resolve) => {
      const check = () => {
        if (document.getElementById('lpNavbar')) resolve(true);
        else setTimeout(check, 100);
      };
      check();
    })`);

    // ── 1. Verification of START RACING CTA Removal ──────────────────────────
    console.log('▶ Test 1: Verifying START RACING CTA is completely removed from navbar');
    const startCtaCheck = await evalInBrowser(`(() => {
      return {
        hasBtnNavStart: !!document.getElementById('lpBtnNavStart'),
        hasBtnDrawerStart: !!document.getElementById('lpBtnDrawerStart'),
        navbarTextContainsStartRacing: (document.getElementById('lpNavbar')?.textContent || '').includes('START RACING')
      };
    })()`);

    console.log('  Start CTA presence:', startCtaCheck);
    assert.equal(startCtaCheck.hasBtnNavStart, false, 'Start button must NOT exist in desktop navbar');
    assert.equal(startCtaCheck.hasBtnDrawerStart, false, 'Start button must NOT exist in mobile drawer');
    assert.equal(startCtaCheck.navbarTextContainsStartRacing, false, 'Navbar must not contain "START RACING" CTA text');
    console.log('  ✅ Test 1 Passed: Start Racing button completely removed without replacement');

    // ── 2. Verification of Compact Settings & Music IDs ─────────────────────
    console.log('\n▶ Test 2: Verifying Compact Settings icon control & Music buttons preserved');
    const controlsCheck = await evalInBrowser(`(() => {
      const btnSettings = document.getElementById('lpBtnSettings');
      const btnMusic = document.getElementById('lpBtnMusic');
      const iconMusic = document.getElementById('lpMusicIcon');
      const labelMusic = document.getElementById('lpMusicLabel');

      return {
        hasSettings: !!btnSettings,
        settingsHasSvg: !!btnSettings?.querySelector('svg'),
        settingsWidth: btnSettings?.offsetWidth,
        settingsHeight: btnSettings?.offsetHeight,
        hasMusic: !!btnMusic,
        hasMusicIcon: !!iconMusic,
        hasMusicLabel: !!labelMusic
      };
    })()`);

    console.log('  Controls check:', controlsCheck);
    assert(controlsCheck.hasSettings, 'Settings button must exist with id lpBtnSettings');
    assert(controlsCheck.settingsHasSvg, 'Settings button must contain SVG icon');
    assert(controlsCheck.settingsWidth <= 44, 'Settings button must be compact (<= 44px)');
    assert(controlsCheck.settingsHeight <= 44, 'Settings button must be compact (<= 44px)');
    assert(controlsCheck.hasMusic, 'Soundtrack music button lpBtnMusic must be preserved');
    console.log('  ✅ Test 2 Passed: Settings is compact icon button, Audio controls intact');

    // ── 3. Test Responsive Viewports (320px, 375px, 430px, 768px, 1024px, 1366px, 1920px) ──
    console.log('\n▶ Test 3: Testing responsive breakpoints for layout, visibility & zero overflow');
    const breakpoints = [
      { width: 1920, height: 1080, name: 'Desktop Full HD (1920x1080)' },
      { width: 1366, height: 768, name: 'Laptop WXGA (1366x768)' },
      { width: 1024, height: 768, name: 'Tablet Landscape / Small Laptop (1024x768)' },
      { width: 768, height: 1024, name: 'Tablet Portrait (768x1024)' },
      { width: 430, height: 932, name: 'Mobile Large / iPhone Pro Max (430x932)' },
      { width: 375, height: 667, name: 'Mobile Medium / iPhone SE (375x667)' },
      { width: 320, height: 568, name: 'Mobile Small / iPhone 5/SE1 (320x568)' }
    ];

    for (const bp of breakpoints) {
      await setViewport(bp.width, bp.height);

      const vpMetrics = await evalInBrowser(`(() => {
        const docEl = document.documentElement;
        const nav = document.getElementById('lpNavbar');
        const desktopLinks = document.querySelector('.lp-nav-links');
        const hamburger = document.getElementById('lpHamburgerBtn');
        const settings = document.getElementById('lpBtnSettings');
        const subtitle = document.querySelector('.lp-brand-subtitle');

        const desktopLinksDisplay = desktopLinks ? getComputedStyle(desktopLinks).display : 'none';
        const hamburgerDisplay = hamburger ? getComputedStyle(hamburger).display : 'none';
        const subtitleDisplay = subtitle ? getComputedStyle(subtitle).display : 'none';

        // Check horizontal overflow
        const docScrollWidth = docEl.scrollWidth;
        const docClientWidth = docEl.clientWidth;
        const hasOverflow = docScrollWidth > docClientWidth + 1; // 1px tolerance for subpixel rendering

        return {
          viewportWidth: window.innerWidth,
          docScrollWidth,
          docClientWidth,
          hasOverflow,
          desktopLinksDisplay,
          hamburgerDisplay,
          subtitleDisplay,
          settingsVisible: settings && getComputedStyle(settings).display !== 'none'
        };
      })()`);

      console.log(`  • ${bp.name}:`, {
        width: vpMetrics.viewportWidth,
        overflow: vpMetrics.hasOverflow ? 'FAIL' : 'NONE',
        desktopLinks: vpMetrics.desktopLinksDisplay,
        hamburger: vpMetrics.hamburgerDisplay,
        settings: vpMetrics.settingsVisible
      });

      assert.equal(vpMetrics.hasOverflow, false, `Viewport ${bp.name} must have NO horizontal overflow`);

      if (bp.width >= 1366) {
        assert.notEqual(vpMetrics.desktopLinksDisplay, 'none', `Desktop links must be visible at ${bp.width}px`);
        assert.equal(vpMetrics.hamburgerDisplay, 'none', `Hamburger must be hidden at ${bp.width}px`);
      } else {
        // Mobile / Tablet
        assert.equal(vpMetrics.desktopLinksDisplay, 'none', `Desktop links must be hidden at ${bp.width}px`);
        assert.notEqual(vpMetrics.hamburgerDisplay, 'none', `Hamburger must be visible at ${bp.width}px`);
      }

      if (bp.width <= 640) {
        assert.equal(vpMetrics.subtitleDisplay, 'none', `Brand subtitle should be hidden on mobile <= 640px`);
      }
    }
    console.log('  ✅ Test 3 Passed: All 7 responsive breakpoints verified with zero horizontal overflow');

    // ── 4. Mobile Drawer Open / Close / Backdrop / Escape / Touch Targets ────
    console.log('\n▶ Test 4: Testing Mobile Drawer opening, items, tap targets, and closing interactions');
    await setViewport(375, 667);

    // Initial state: drawer closed
    const initialDrawer = await evalInBrowser(`(() => {
      const drawer = document.getElementById('lpMobileDrawer');
      return {
        isOpen: drawer?.classList.contains('is-open')
      };
    })()`);
    assert.equal(initialDrawer.isOpen, false, 'Drawer must be closed initially');

    // Click Hamburger to Open
    await evalInBrowser(`document.getElementById('lpHamburgerBtn').click()`);
    await sleep(200);

    const openedDrawer = await evalInBrowser(`(() => {
      const drawer = document.getElementById('lpMobileDrawer');
      const backdrop = document.getElementById('lpDrawerBackdrop');
      const hamburger = document.getElementById('lpHamburgerBtn');
      const links = Array.from(drawer.querySelectorAll('.lp-drawer-link'));

      const linkDetails = links.map(link => ({
        action: link.dataset.action || link.id,
        text: link.textContent.trim(),
        height: link.offsetHeight,
        minHeightMet: link.offsetHeight >= 44
      }));

      return {
        drawerOpen: drawer.classList.contains('is-open'),
        backdropOpen: backdrop.classList.contains('is-open'),
        hamburgerActive: hamburger.classList.contains('active'),
        hamburgerExpanded: hamburger.getAttribute('aria-expanded'),
        linkCount: links.length,
        linkDetails,
        allTouchTargetsMet: linkDetails.every(l => l.minHeightMet)
      };
    })()`);

    console.log('  Opened drawer status:', {
      open: openedDrawer.drawerOpen,
      backdrop: openedDrawer.backdropOpen,
      hamburgerActive: openedDrawer.hamburgerActive,
      linkCount: openedDrawer.linkCount,
      allTouchTargetsMet: openedDrawer.allTouchTargetsMet
    });

    assert.equal(openedDrawer.drawerOpen, true, 'Drawer must have is-open class');
    assert.equal(openedDrawer.backdropOpen, true, 'Backdrop must have is-open class');
    assert.equal(openedDrawer.hamburgerActive, true, 'Hamburger must have active class');
    assert.equal(openedDrawer.hamburgerExpanded, 'true', 'Hamburger aria-expanded must be true');
    assert(openedDrawer.linkCount >= 8, 'Mobile drawer must contain all navigation links');
    assert.equal(openedDrawer.allTouchTargetsMet, true, 'All drawer links must meet >= 44px tap target height');

    // Test Close via Backdrop Click
    await evalInBrowser(`document.getElementById('lpDrawerBackdrop').click()`);
    await sleep(200);
    const closedByBackdrop = await evalInBrowser(`document.getElementById('lpMobileDrawer').classList.contains('is-open')`);
    assert.equal(closedByBackdrop, false, 'Drawer must close when backdrop is clicked');
    console.log('  ✓ Drawer closes on backdrop click');

    // Test Close via Escape Key
    await evalInBrowser(`document.getElementById('lpHamburgerBtn').click()`);
    await sleep(200);
    await evalInBrowser(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await sleep(200);
    const closedByEsc = await evalInBrowser(`document.getElementById('lpMobileDrawer').classList.contains('is-open')`);
    assert.equal(closedByEsc, false, 'Drawer must close when Escape key is pressed');
    console.log('  ✓ Drawer closes on Escape key');

    // Test Close via Close Button
    await evalInBrowser(`document.getElementById('lpHamburgerBtn').click()`);
    await sleep(200);
    await evalInBrowser(`document.getElementById('lpDrawerCloseBtn').click()`);
    await sleep(200);
    const closedByBtn = await evalInBrowser(`document.getElementById('lpMobileDrawer').classList.contains('is-open')`);
    assert.equal(closedByBtn, false, 'Drawer must close when close button is clicked');
    console.log('  ✓ Drawer closes on close button click');

    // ── 5. Active Link Highlight Synchronization ─────────────────────────────
    console.log('\n▶ Test 5: Testing Active Link State Synchronization across Desktop and Drawer');
    await setViewport(1366, 768);

    const testActions = ['quickrace', 'championship', 'circuits', 'garage', 'home'];
    for (const act of testActions) {
      await evalInBrowser(`(() => {
        const btn = document.querySelector('.lp-nav-link[data-action="${act}"]');
        if (btn) btn.click();
      })()`);
      await sleep(100);

      const activeState = await evalInBrowser(`(() => {
        const desktopActive = document.querySelector('.lp-nav-link.active')?.dataset.action;
        const drawerActive = document.querySelector('.lp-drawer-link.active')?.dataset.action;
        return { desktopActive, drawerActive };
      })()`);

      assert.equal(activeState.desktopActive, act, `Desktop active link should be ${act}`);
      assert.equal(activeState.drawerActive, act, `Drawer active link should be synchronized to ${act}`);
    }
    console.log('  ✅ Test 5 Passed: Active states update and synchronize across navigation bars');

    console.log('\n🏁 ══════════════════════════════════════════════════════════════');
    console.log('   ALL NAVBAR REDESIGN & RESPONSIVE VALIDATIONS PASSED CLEANLY!  ');
    console.log('════════════════════════════════════════════════════════════════\n');

  } finally {
    if (ws) ws.close();
    chromeProc.kill();
  }
}

runNavbarValidation().catch((err) => {
  console.error('❌ Validation failed:', err);
  process.exit(1);
});
