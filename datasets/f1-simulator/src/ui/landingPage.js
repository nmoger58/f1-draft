/**
 * landingPage.js
 * Responsive, mobile-first landing page for the F1 Autonomous Racing Simulator.
 *
 * Load /styles/landing-responsive.css AFTER your existing landing CSS.
 * Make sure index.html has:
 *   <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
 */

import { getCircuit } from '../data/circuitData.js';
import { getSharedDraftEngine } from '../strategy/draftEngine.js';
import { getLandingAudio } from './landingAudio.js';

const DESKTOP_BREAKPOINT = 1180; // must match the CSS breakpoint

const ICONS = {
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  quickrace: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  championship:
    '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
  draftmode:
    '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="9"/><line x1="12" y1="15" x2="12" y2="22"/><line x1="2" y1="12" x2="9" y2="12"/><line x1="15" y1="12" x2="22" y2="12"/>',
  multiplayer:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  circuits:
    '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>',
  garage:
    '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  close: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
};

const icon = (name, size = 16, cls = 'lp-nav-svg') =>
  `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;

// Single source of truth for desktop nav + mobile drawer.
const NAV_ITEMS = [
  { action: 'home', label: 'Home', drawerLabel: 'Home' },
  { action: 'quickrace', label: 'Quick Race', drawerLabel: 'Quick Race' },
  { action: 'championship', label: 'Championship', drawerLabel: 'Championship' },
  { action: 'draftmode', label: 'Draft Mode', drawerLabel: 'Draft Mode' },
  { action: 'multiplayer', label: 'Head-to-Head', drawerLabel: 'Head-to-Head' },
  { action: 'circuits', label: 'Circuits', drawerLabel: 'Circuits &amp; Records' },
  { action: 'garage', label: 'Garage', drawerLabel: 'Garage' },
];

const STRIP_ITEMS = [
  ['⚙️', 'Realistic Physics', 'Fixed-step integration, ERS hybrid boost &amp; tyre thermal windows'],
  ['🌧️', 'Dynamic Weather', 'Real-time rain radar, drying racing lines &amp; intermediate crossover'],
  ['🤖', 'AI Race Control', 'Flag escalation, Virtual Safety Car, Safety Car &amp; stewarding'],
  ['🛑', 'Pit Strategy', '5 Pirelli compounds, undercut timing &amp; crew stopwatch modulation'],
  ['🌍', 'Global Circuits', '8 authentic FIA circuits including Monaco, Silverstone, Spa and Monza'],
  ['🏆', 'Championship Mode', 'Practice, qualifying, official points system &amp; season finale awards'],
];

/* ------------------------------------------------------------------ SFX Audio Synthesizer (tactile click feedback) */
const sfx = (() => {
  let ctx = null;
  function tone(freq, dur, vol = 0.04, type = 'sine') {
    try {
      if (typeof window === 'undefined') return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!ctx) ctx = new AC();
      if (ctx.state === 'suspended') ctx.resume();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const t = ctx.currentTime;
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      o.frequency.exponentialRampToValueAtTime(freq * 1.5, t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g);
      g.connect(ctx.destination);
      o.start(t);
      o.stop(t + dur + 0.02);
    } catch (_) {}
  }
  return {
    blip: () => tone(480, 0.06, 0.03, 'sine')
  };
})();

/* ------------------------------------------------------------------ Speed Dust & Sparks Particle System */
function createParticleSystem(canvas, { count = 38, speed = 1.0 } = {}) {
  if (!canvas || typeof window === 'undefined') return { stop() {} };
  const ctx = canvas.getContext('2d');
  if (!ctx) return { stop() {} };
  let w = 0, h = 0, dpr = 1, ps = [], raf = 0, vis = true, tabVis = !document.hidden;
  let stopped = false;
  const size = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    w = canvas.clientWidth || window.innerWidth;
    h = canvas.clientHeight || window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  const mk = (init = false) => ({
    x: Math.random() * w,
    y: init ? Math.random() * h : h + 8,
    r: Math.random() * 1.8 + 0.4,
    vx: -(Math.random() * 0.75 + 0.25) * speed,
    vy: -(Math.random() * 0.55 + 0.1) * speed,
    a: Math.random() * 0.6 + 0.2,
    hot: Math.random() < 0.55
  });
  function frame() {
    raf = 0;
    if (stopped || !vis || !tabVis) return;
    ctx.clearRect(0, 0, w, h);
    for (const p of ps) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < -10 || p.y < -10) Object.assign(p, mk(false), { x: Math.random() * w * 1.1 });
      ctx.fillStyle = p.hot ? `rgba(225, 6, 0, ${p.a})` : `rgba(255, 255, 255, ${p.a * 0.7})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    raf = requestAnimationFrame(frame);
  }
  const kick = () => { if (!stopped && !raf && vis && tabVis) raf = requestAnimationFrame(frame); };
  size();
  ps = Array.from({ length: count }, () => mk(true));
  const io = typeof IntersectionObserver !== 'undefined'
    ? new IntersectionObserver(([e]) => { vis = e.isIntersecting; kick(); })
    : { observe() {}, disconnect() {} };
  io.observe(canvas);
  const onVisChange = () => { tabVis = !document.hidden; kick(); };
  document.addEventListener('visibilitychange', onVisChange);
  const onResize = () => { size(); };
  window.addEventListener('resize', onResize, { passive: true });
  kick();
  return {
    stop() {
      stopped = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisChange);
      window.removeEventListener('resize', onResize);
    }
  };
}

/* ------------------------------------------------------------------ 5-Red-Light Gantry Animation */
function initStartGantry(container) {
  const gantry = container?.querySelector('.lp-start-gantry');
  if (!gantry || typeof window === 'undefined') return { stop() {} };
  const lights = Array.from(gantry.querySelectorAll('.g-light'));
  let timer = null;
  let running = true;

  function clearTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function runCycle() {
    if (!running) return;
    clearTimer();
    lights.forEach(l => l.classList.remove('lit'));
    gantry.classList.remove('lights-out');
    let idx = 0;
    function next() {
      if (!running) return;
      if (idx < lights.length) {
        lights[idx].classList.add('lit');
        idx++;
        timer = setTimeout(next, 320);
      } else {
        timer = setTimeout(() => {
          if (!running) return;
          lights.forEach(l => l.classList.remove('lit'));
          gantry.classList.add('lights-out');
          timer = setTimeout(() => {
            if (running) runCycle();
          }, 3600);
        }, 1200);
      }
    }
    timer = setTimeout(next, 600);
  }
  runCycle();

  // Interactive click handler to test reaction and re-trigger start sequence
  const onClick = () => {
    sfx.blip();
    runCycle();
  };
  gantry.addEventListener('click', onClick);

  return {
    stop() {
      running = false;
      clearTimer();
      gantry.removeEventListener('click', onClick);
    }
  };
}

/* ------------------------------------------------------------------ 3D Interactive Card Tilt */
function setupTilt(container) {
  if (typeof window === 'undefined') return () => {};
  const FINE = window.matchMedia('(hover:hover) and (pointer:fine)').matches;
  const RM = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!FINE || RM || !window.gsap) return () => {};
  const cards = container.querySelectorAll('.lp-mode-card, .lp-story-card, .lp-circuit-card, .lp-stat-card');
  const cleanups = [];
  cards.forEach(card => {
    const rx = window.gsap.quickTo(card, 'rotationX', { duration: 0.45, ease: 'power3.out' });
    const ry = window.gsap.quickTo(card, 'rotationY', { duration: 0.45, ease: 'power3.out' });
    const onMove = (e) => {
      const rect = card.getBoundingClientRect();
      const xPct = (e.clientX - rect.left) / rect.width - 0.5;
      const yPct = (e.clientY - rect.top) / rect.height - 0.5;
      ry(xPct * 9);
      rx(-yPct * 9);
    };
    const onLeave = () => {
      rx(0);
      ry(0);
    };
    card.addEventListener('pointermove', onMove);
    card.addEventListener('pointerleave', onLeave);
    cleanups.push(() => {
      card.removeEventListener('pointermove', onMove);
      card.removeEventListener('pointerleave', onLeave);
      rx(0);
      ry(0);
    });
  });
  return () => {
    cleanups.forEach(fn => fn());
  };
}

/* ------------------------------------------------------------------ GSAP ScrollTrigger Motion */
function initScrollAnimations(container) {
  if (typeof window === 'undefined' || !window.gsap) return null;
  const RM = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (RM) return null;
  if (window.ScrollTrigger) {
    window.gsap.registerPlugin(window.ScrollTrigger);
  }

  const ctx = window.gsap.context(() => {
    // 1. Hero text line reveal
    window.gsap.fromTo(
      container.querySelectorAll('.lp-hero-title .ln > span'),
      { yPercent: 110 },
      { yPercent: 0, duration: 0.9, stagger: 0.12, ease: 'power4.out', delay: 0.08 }
    );

    // 2. Hero copy and actions stagger
    window.gsap.fromTo(
      container.querySelectorAll('.lp-hero-desc, .lp-hero-actions, .lp-hero-trio-banner'),
      { opacity: 0, y: 20 },
      { opacity: 1, y: 0, duration: 0.75, stagger: 0.12, ease: 'power3.out', delay: 0.3 }
    );

    if (window.ScrollTrigger) {
      // 3. Section Titles Masked Line Reveal
      container.querySelectorAll('.lp-section-title').forEach(title => {
        const spans = title.querySelectorAll('.ln > span');
        if (spans.length) {
          window.ScrollTrigger.create({
            trigger: title,
            start: 'top 88%',
            once: true,
            onEnter: () => {
              window.gsap.fromTo(
                spans,
                { yPercent: 110 },
                { yPercent: 0, duration: 0.85, stagger: 0.1, ease: 'power4.out' }
              );
            }
          });
        } else {
          window.ScrollTrigger.create({
            trigger: title,
            start: 'top 88%',
            once: true,
            onEnter: () => {
              window.gsap.fromTo(title, { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.75, ease: 'power3.out' });
            }
          });
        }
      });

      // 4. Mode Cards Staggered Batch Entrance with Signature Image Clip Wipe
      window.ScrollTrigger.batch(container.querySelectorAll('.lp-mode-card'), {
        start: 'top 90%',
        once: true,
        onEnter: (batch) => {
          window.gsap.fromTo(
            batch,
            { opacity: 0, y: 48, rotationX: 8 },
            { opacity: 1, y: 0, rotationX: 0, duration: 0.85, stagger: 0.1, ease: 'power3.out', overwrite: true }
          );
          const imgWraps = batch.map(c => c.querySelector('.lp-mode-img-wrap')).filter(Boolean);
          if (imgWraps.length) {
            window.gsap.fromTo(
              imgWraps,
              { clipPath: 'inset(0 100% 0 0)' },
              { clipPath: 'inset(0 0% 0 0)', duration: 1.0, stagger: 0.1, ease: 'power4.inOut' }
            );
          }
        }
      });

      // 5. Telemetry / Stat Cards Roll-up Counters & Progress Bars
      container.querySelectorAll('.lp-stat-card').forEach(card => {
        const numEl = card.querySelector('[data-count]');
        const barEl = card.querySelector('.lp-stat-bar i');
        if (!numEl) return;
        const targetVal = parseFloat(numEl.dataset.count) || 0;
        const counter = { v: 0 };
        numEl.textContent = '0';
        window.ScrollTrigger.create({
          trigger: card,
          start: 'top 90%',
          once: true,
          onEnter: () => {
            window.gsap.to(counter, {
              v: targetVal,
              duration: 1.6,
              ease: 'power2.out',
              onUpdate: () => {
                numEl.textContent = Math.round(counter.v);
              }
            });
            if (barEl) {
              const targetScale = parseFloat(barEl.style.getPropertyValue('--target-scale')) || 1;
              window.gsap.to(barEl, { scaleX: targetScale, duration: 1.6, ease: 'power3.out' });
            }
          }
        });
      });

      // 6. SVG Divider Path Drawing
      container.querySelectorAll('.lp-dv-path').forEach(path => {
        try {
          const len = path.getTotalLength();
          window.gsap.set(path, { strokeDasharray: len, strokeDashoffset: len });
          window.gsap.to(path, {
            strokeDashoffset: 0,
            ease: 'none',
            scrollTrigger: {
              trigger: path.closest('.lp-animated-divider') || path,
              start: 'top 95%',
              end: 'bottom 65%',
              scrub: 0.6
            }
          });
        } catch (_) {}
      });

      // 7. Circuits cards batch
      window.ScrollTrigger.batch(container.querySelectorAll('.lp-circuit-card'), {
        start: 'top 92%',
        once: true,
        onEnter: (batch) => {
          window.gsap.fromTo(
            batch,
            { opacity: 0, y: 38 },
            { opacity: 1, y: 0, duration: 0.7, stagger: 0.08, ease: 'power3.out', overwrite: true }
          );
        }
      });

      // 8. Story cards batch with image clip wipe
      window.ScrollTrigger.batch(container.querySelectorAll('.lp-story-card'), {
        start: 'top 92%',
        once: true,
        onEnter: (batch) => {
          window.gsap.fromTo(
            batch,
            { opacity: 0, y: 38 },
            { opacity: 1, y: 0, duration: 0.7, stagger: 0.1, ease: 'power3.out', overwrite: true }
          );
          const imgWraps = batch.map(c => c.querySelector('.lp-story-img-wrap')).filter(Boolean);
          if (imgWraps.length) {
            window.gsap.fromTo(
              imgWraps,
              { clipPath: 'inset(0 100% 0 0)' },
              { clipPath: 'inset(0 0% 0 0)', duration: 0.95, stagger: 0.1, ease: 'power4.inOut' }
            );
          }
        }
      });

      // 9. Desktop multi-layer depth parallax (hero copy, road, atmospheric smoke)
      const mm = window.gsap.matchMedia();
      mm.add('(min-width: 861px)', () => {
        if (RM) return;
        const heroContent = container.querySelector('.lp-hero-content');
        const heroRoad = container.querySelector('.lp-hero-road');
        const smokeLayer = container.querySelector('.lp-smoke-layer');
        const heroEl = container.querySelector('.lp-hero');
        if (heroContent && heroEl) {
          window.gsap.to(heroContent, {
            yPercent: -8,
            ease: 'none',
            scrollTrigger: { trigger: heroEl, start: 'top top', end: 'bottom top', scrub: true }
          });
        }
        if (heroRoad && heroEl) {
          window.gsap.to(heroRoad, {
            yPercent: 10,
            ease: 'none',
            scrollTrigger: { trigger: heroEl, start: 'top top', end: 'bottom top', scrub: true }
          });
        }
        if (smokeLayer && heroEl) {
          window.gsap.to(smokeLayer, {
            yPercent: 16,
            ease: 'none',
            scrollTrigger: { trigger: heroEl, start: 'top top', end: 'bottom top', scrub: true }
          });
        }
      });
    }
  }, container);

  return ctx;
}

/* ------------------------------------------------------------------ Navbar Sliding Indicator */
function initNavbarIndicator(container) {
  const linksWrap = container?.querySelector('.lp-nav-links');
  const ind = container?.querySelector('#lpNavInd');
  if (!linksWrap || !ind) return () => {};

  function moveInd(target) {
    if (!target) {
      ind.style.width = '0px';
      return;
    }
    const wrapRect = linksWrap.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    ind.style.width = `${targetRect.width}px`;
    ind.style.transform = `translateX(${targetRect.left - wrapRect.left}px)`;
  }

  function getActiveLink() {
    return linksWrap.querySelector('.lp-nav-link.active') || linksWrap.querySelector('.lp-nav-link');
  }

  setTimeout(() => moveInd(getActiveLink()), 120);

  const onEnter = (e) => moveInd(e.currentTarget);
  const onLeave = () => moveInd(getActiveLink());
  const links = Array.from(linksWrap.querySelectorAll('.lp-nav-link'));
  links.forEach(link => {
    link.addEventListener('pointerenter', onEnter);
    link.addEventListener('pointerleave', onLeave);
  });

  const onResize = () => moveInd(getActiveLink());
  window.addEventListener('resize', onResize, { passive: true });

  return () => {
    links.forEach(link => {
      link.removeEventListener('pointerenter', onEnter);
      link.removeEventListener('pointerleave', onLeave);
    });
    window.removeEventListener('resize', onResize);
  };
}

/* ------------------------------------------------------------------ Navbar Scrolled Blur State */
function initNavbarScrollState(container) {
  const navbar = container?.querySelector('#lpNavbar');
  if (!navbar || typeof window === 'undefined') return () => {};
  let isScrolled = false;
  const onScroll = () => {
    const s = window.scrollY > 28;
    if (s !== isScrolled) {
      isScrolled = s;
      navbar.classList.toggle('scrolled', s);
    }
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  return () => window.removeEventListener('scroll', onScroll);
}

export class LandingPage {
  constructor(options = {}) {
    this.container = options.container || null;
    this.onStartQuickRace = options.onStartQuickRace || (() => {});
    this.onStartChampionship = options.onStartChampionship || (() => {});
    this.onStartDraftMode = options.onStartDraftMode || (() => {});
    this.onStartMultiplayer = options.onStartMultiplayer || (() => {});
    this.onOpenDraft = options.onOpenDraft || (() => {});
    this.onOpenSettings = options.onOpenSettings || (() => {});
    this.onSelectCircuit = options.onSelectCircuit || (() => {});
    this._onKeyDown = null;
    this._onResize = null;
    this._particles = null;
    this._gantry = null;
    this._gsapCtx = null;
    this._tiltCleanup = null;
    this._navIndCleanup = null;
    this._navScrollCleanup = null;
  }

  render(targetEl = this.container) {
    if (!targetEl) return;
    this.destroy(); // remove listeners from any previous render
    this.container = targetEl;

    const draft = getSharedDraftEngine();
    const currentTrio = draft.getSummary();
    const driverName = currentTrio.driver?.name || 'Lando Norris';
    const driverCode = currentTrio.driver?.code || 'NOR';
    const carName = currentTrio.car?.name || 'McLaren MCL38';
    const managerName = currentTrio.manager?.name || 'Andrea Stella';

    const featuredCircuits = ['monaco', 'silverstone', 'spa', 'monza'].map((id) => getCircuit(id));

    const desktopLinks = NAV_ITEMS.map(
      (n, i) => `
        <button type="button" class="lp-nav-link${i === 0 ? ' active' : ''}" data-action="${n.action}">
          ${icon(n.action, 14)}<span>${n.label}</span>
        </button>`
    ).join('');

    const drawerLinks = NAV_ITEMS.map(
      (n, i) => `
        <button type="button" class="lp-drawer-link${i === 0 ? ' active' : ''}" data-action="${n.action}">
          ${icon(n.action, 20, 'lp-drawer-svg')}<span>${n.drawerLabel}</span>
        </button>`
    ).join('');

    this.container.innerHTML = `
      <div class="landing-page-wrapper">
        <!-- Shared F1 vector art & linear gradients -->
        <svg width="0" height="0" style="position:absolute" aria-hidden="true">
          <defs>
            <linearGradient id="gBody" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#ff2a1f"/><stop offset=".55" stop-color="#d10a00"/><stop offset="1" stop-color="#7a0500"/>
            </linearGradient>
            <linearGradient id="gBlue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#3b8cff"/><stop offset=".55" stop-color="#1457d6"/><stop offset="1" stop-color="#0a2a73"/>
            </linearGradient>
            <symbol id="f1CarSilhouette" viewBox="0 0 620 170">
              <path d="M36 28h58v8H36z" fill="#0b0f1c"/><path d="M44 36h6v46h-6zM80 36h6v46h-6z" fill="#161c2e"/>
              <path d="M30 22h70v8H30z" fill="#e8ecf5"/>
              <path d="M70 112 L118 98 L206 92 L262 64 L300 58 L336 66 L352 90 L440 96 L548 108 L596 116 L596 124 L70 126 Z" fill="var(--car-body, url(#gBody))"/>
              <path d="M150 100 L262 94 L330 98 L330 116 L150 118 Z" fill="#000" opacity=".22"/>
              <path d="M118 98 L206 92 L262 64 L300 58 L262 90 L150 100Z" fill="#fff" opacity=".14"/>
              <path d="M206 92 L248 54 L300 52 L300 62 L262 64Z" fill="var(--car-body, url(#gBody))"/>
              <path d="M296 62 Q318 40 346 64" fill="none" stroke="#0b0f1c" stroke-width="6" stroke-linecap="round"/>
              <path d="M312 60 L320 72 L336 72" fill="none" stroke="#0b0f1c" stroke-width="4"/>
              <circle cx="318" cy="66" r="8" fill="#e8ecf5"/>
              <path d="M520 130 L612 126 L612 134 L520 138Z" fill="#0b0f1c"/><path d="M520 126h92v4h-92z" fill="#e8ecf5"/>
              <path d="M596 118h6v22h-6z" fill="#161c2e"/>
              <rect x="70" y="124" width="530" height="5" fill="#000" opacity=".6"/>
              <g class="wheel"><circle cx="150" cy="118" r="38" fill="#07090f"/><circle cx="150" cy="118" r="22" fill="#1b2133"/><circle cx="150" cy="118" r="9" fill="#e10600"/><path d="M150 96v44M128 118h44M134 102l32 32M166 102l-32 32" stroke="#323a52" stroke-width="3"/></g>
              <g class="wheel"><circle cx="478" cy="122" r="32" fill="#07090f"/><circle cx="478" cy="122" r="18" fill="#1b2133"/><circle cx="478" cy="122" r="7" fill="#e10600"/><path d="M478 104v36M460 122h36M465 109l26 26M491 109l-26 26" stroke="#323a52" stroke-width="3"/></g>
            </symbol>
          </defs>
        </svg>

        <div class="lp-fixed-screen-bg" aria-hidden="true">
          <img src="/assets/images/hero_sunset_race.png" alt="" class="lp-fixed-bg-img lp-hero-img" id="lpFixedBgImg" loading="eager" decoding="async" />
          <div class="lp-fixed-bg-overlay"></div>
          <div class="lp-fixed-bg-vignette"></div>
          <div class="lp-fixed-bg-grid"></div>
          <canvas class="lp-particles-canvas" id="lpParticlesFx" aria-hidden="true"></canvas>
          <div class="lp-speed-streaks" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
          <div class="lp-smoke-layer" aria-hidden="true"><i></i><i></i><i></i></div>
        </div>

        <!-- 1. Navbar -->
        <nav class="lp-navbar" id="lpNavbar" aria-label="Main Navigation">
          <div class="lp-nav-inner">
            <a href="#home" class="lp-brand" id="lpBrandLogo" data-action="home" aria-label="Apex Racing Autonomous Simulator Home">
              <span class="lp-brand-badge">F1</span>
              <span class="lp-brand-text">
                <span class="lp-brand-title">APEX RACING</span>
                <span class="lp-brand-subtitle">AUTONOMOUS SIMULATOR</span>
              </span>
            </a>

            <div class="lp-nav-links">
              ${desktopLinks}
              <span class="lp-nav-ind" id="lpNavInd" aria-hidden="true"></span>
            </div>

            <div class="lp-nav-actions">
              <button type="button" class="lp-btn-music" id="lpBtnMusic" title="Soundtrack (mute/unmute)" aria-label="Toggle Soundtrack">
                <span class="lp-music-icon" id="lpMusicIcon">🔊</span>
                <span class="lp-music-label" id="lpMusicLabel">WE OWN IT</span>
                <span class="lp-music-eq" aria-hidden="true">
                  <span class="eq-bar bar1"></span><span class="eq-bar bar2"></span><span class="eq-bar bar3"></span>
                </span>
              </button>
              <button type="button" class="lp-btn-settings" id="lpBtnSettings" data-action="settings" title="Simulator Settings" aria-label="Simulator Settings">
                ${icon('settings', 20)}
              </button>
              <button type="button" class="lp-hamburger-btn" id="lpHamburgerBtn" aria-label="Open navigation menu" aria-expanded="false" aria-controls="lpMobileDrawer">
                <span></span><span></span><span></span>
              </button>
            </div>
          </div>
        </nav>

        <!-- Drawer + backdrop live OUTSIDE <nav> so backdrop-filter on the navbar can't trap position:fixed -->
        <div class="lp-drawer-backdrop" id="lpDrawerBackdrop" aria-hidden="true"></div>
        <aside class="lp-mobile-drawer" id="lpMobileDrawer" role="dialog" aria-modal="true" aria-label="Mobile Navigation" aria-hidden="true">
          <div class="lp-drawer-header">
            <div class="lp-brand lp-brand-drawer">
              <span class="lp-brand-badge">F1</span>
              <span class="lp-brand-title">APEX RACING</span>
            </div>
            <button type="button" class="lp-drawer-close" id="lpDrawerCloseBtn" aria-label="Close navigation menu">
              ${icon('close', 22, 'lp-drawer-svg')}
            </button>
          </div>
          <div class="lp-drawer-body">
            ${drawerLinks}
            <button type="button" class="lp-drawer-link" data-action="settings">
              ${icon('settings', 20, 'lp-drawer-svg')}<span>Settings &amp; Voice</span>
            </button>
            <button type="button" class="lp-drawer-link" id="lpDrawerMusic">
              <span class="lp-drawer-music-icon">🔊</span><span>Soundtrack</span>
            </button>
          </div>
          <div class="lp-drawer-footer">
            <button type="button" class="lp-btn-primary lp-drawer-cta" id="lpDrawerStartBtn">
              <span class="lp-btn-icon">⚡</span><span class="lp-btn-text">START RACING</span>
            </button>
          </div>
        </aside>

        <!-- 2. Hero -->
        <header class="lp-hero" id="home">
          <div class="lp-hero-content">
            <div class="lp-hero-badge-row">
              <div class="lp-start-gantry" aria-label="Start Lights Sequence" title="5 Red Lights"><i class="g-light"></i><i class="g-light"></i><i class="g-light"></i><i class="g-light"></i><i class="g-light"></i></div>
              <span class="lp-eyebrow">DRIVE &middot; COMPETE &middot; BECOME LEGENDARY</span>
              <span class="lp-version-tag">2025 FIA REGULATIONS</span>
            </div>

            <h1 class="lp-hero-title">
              <span class="ln"><span>THE ULTIMATE F1</span></span>
              <span class="ln lp-highlight-red"><span>SIMULATOR</span></span>
            </h1>

            <p class="lp-hero-desc">
              Experience the pinnacle of motorsport powered by fixed-step vehicle physics, autonomous AI drivers, dynamic weather radar, live telemetry, and authentic championship racing.
            </p>

            <div class="lp-hero-actions">
              <button type="button" class="lp-btn-primary" id="lpHeroStartBtn">
                <span class="lp-btn-icon">⚡</span><span class="lp-btn-text">START RACING</span>
              </button>
              <button type="button" class="lp-btn-secondary" id="lpHeroChampBtn">
                <span class="lp-btn-icon">🏆</span><span class="lp-btn-text">EXPLORE CHAMPIONSHIP</span>
              </button>
            </div>

            <div class="lp-hero-trio-banner" id="lpHeroTrioBanner">
              <span class="trio-banner-label">CURRENT DRAFT LINEUP</span>
              <div class="trio-banner-chips">
                <span class="trio-chip driver-chip">🏎️ <strong>${driverName}</strong> <em>#${driverCode}</em></span>
                <span class="trio-chip car-chip">⚙️ <strong>${carName}</strong></span>
                <span class="trio-chip mgr-chip">👨‍💼 <strong>${managerName}</strong></span>
                <button type="button" class="trio-change-btn" id="lpHeroChangeDraftBtn">Change Team ✏️</button>
              </div>
            </div>
          </div>
          <svg class="lp-hero-road" viewBox="0 0 1200 300" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="lpRoadGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#07090e" stop-opacity="0"/><stop offset="100%" stop-color="#07090e" stop-opacity="0.8"/></linearGradient></defs><path d="M0 300 L440 0 L760 0 L1200 300 Z" fill="url(#lpRoadGrad)"/><g stroke="rgba(255,255,255,0.12)" stroke-width="2"><path d="M440 0 L160 300"/><path d="M760 0 L1040 300"/></g><path class="lp-road-dash" d="M600 0 L600 300" stroke="#e10600" stroke-width="3.5" stroke-dasharray="24 32"/><path d="M0 0 H1200" stroke="rgba(225,6,0,0.4)" stroke-width="1"/></svg>
          <a class="lp-scroll-cue" href="#raceModes" aria-label="Scroll down to racing modes"><span></span></a>
        </header>

        <!-- 3. Feature strip -->
        <section class="lp-feature-strip" aria-label="Simulator Capabilities">
          <div class="lp-strip-container">
            ${STRIP_ITEMS.map(
              ([ic, title, text]) => `
              <div class="lp-strip-item">
                <span class="lp-strip-icon" aria-hidden="true">${ic}</span>
                <div class="lp-strip-text"><strong>${title}</strong><span>${text}</span></div>
              </div>`
            ).join('')}
          </div>
        </section>

        <!-- 4. Modes -->
        <section class="lp-section lp-modes-section" id="raceModes">
          <div class="lp-section-header">
            <span class="lp-section-tag">COMPETITIVE DISCIPLINES</span>
            <h2 class="lp-section-title"><span class="ln"><span>CHOOSE YOUR RACE</span></span></h2>
            <p class="lp-section-sub">Select how you want to compete. Jump straight into a single Grand Prix, draft historic season grids, or campaign for the World Championship title.</p>
          </div>

          <div class="lp-modes-grid">
            <div class="lp-mode-card" data-mode="quickrace" tabindex="0" role="button">
              <div class="lp-mode-img-wrap">
                <img src="/assets/images/mode_quickrace.png" alt="Quick Race Single Grand Prix" class="lp-mode-img" loading="lazy" decoding="async" />
                <div class="lp-mode-badge active">PLAYABLE NOW</div>
              </div>
              <div class="lp-mode-body">
                <h3 class="lp-mode-title">Quick Race</h3>
                <p class="lp-mode-desc">Select your driver, principal and constructor machine. Customize laps, grid size and weather for an instant Grand Prix showdown.</p>
                <div class="lp-mode-footer">
                  <span class="lp-mode-meta">Single Event &middot; Full Grid &middot; 8 Circuits</span>
                  <span class="lp-mode-btn">Launch Quick Race <span class="arrow">→</span></span>
                </div>
              </div>
            </div>

            <div class="lp-mode-card" data-mode="championship" tabindex="0" role="button">
              <div class="lp-mode-img-wrap">
                <img src="/assets/images/mode_championship.png" alt="FIA World Championship Trophy" class="lp-mode-img" loading="lazy" decoding="async" />
                <div class="lp-mode-badge gold">OFFICIAL SEASON</div>
              </div>
              <div class="lp-mode-body">
                <h3 class="lp-mode-title">Championship Mode</h3>
                <p class="lp-mode-desc">Embark on a multi-round World Championship campaign. Compete in Practice, battle for Pole in Qualifying, and score official FIA points.</p>
                <div class="lp-mode-footer">
                  <span class="lp-mode-meta">3 to 8 Rounds &middot; Points &middot; Trophy Hub</span>
                  <span class="lp-mode-btn">Enter Championship <span class="arrow">→</span></span>
                </div>
              </div>
            </div>

            <div class="lp-mode-card lp-mode-draft" data-mode="draftmode" tabindex="0" role="button">
              <div class="lp-mode-img-wrap">
                <img src="/assets/images/mode_draftmode.png" alt="F1 Draft Mode — Historic Season Grid" class="lp-mode-img" loading="lazy" decoding="async" />
                <div class="lp-mode-badge lp-badge-draft">DRAFT MODE</div>
              </div>
              <div class="lp-mode-body">
                <h3 class="lp-mode-title">F1 Draft Mode</h3>
                <p class="lp-mode-desc">Choose a historic season (2019&ndash;2025). Draft your driver, team principal and constructor machine with real stats derived from 7 supervised ML algorithms and official FIA records.</p>
                <div class="lp-mode-footer">
                  <span class="lp-mode-meta">2019&ndash;2025 &middot; Historic Draft &middot; ML Infused</span>
                  <span class="lp-mode-btn lp-mode-btn-draft">Draft Historic Team <span class="arrow">→</span></span>
                </div>
              </div>
            </div>

            <div class="lp-mode-card" data-mode="timetrial" tabindex="0" role="button">
              <div class="lp-mode-img-wrap">
                <img src="/assets/images/mode_timetrial.png" alt="Telemetry HUD and Flying Lap Records" class="lp-mode-img" loading="lazy" decoding="async" />
                <div class="lp-mode-badge">TELEMETRY BENCHMARK</div>
              </div>
              <div class="lp-mode-body">
                <h3 class="lp-mode-title">Time Trial &amp; Records</h3>
                <p class="lp-mode-desc">Push your machine to the limit on a clear track. Compare sector deltas and throttle application against historical circuit lap records.</p>
                <div class="lp-mode-footer">
                  <span class="lp-mode-meta">Pure Pace &middot; Flying Laps &middot; Track Records</span>
                  <span class="lp-mode-btn">View Circuit Records <span class="arrow">→</span></span>
                </div>
              </div>
            </div>

            <div class="lp-mode-card lp-mode-multiplayer" data-mode="multiplayer" tabindex="0" role="button">
              <div class="lp-mode-img-wrap">
                <img src="/assets/images/mode_multiplayer.png" alt="F1 Multiplayer — Same Track. Different Rivals." class="lp-mode-img" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='/assets/images/hero_sunset_race.png'" />
                <div class="lp-mode-badge lp-badge-mp">2–20 PLAYERS</div>
                <div class="lp-mp-slots-preview" aria-hidden="true">
                  <div class="lp-mp-slot p1"><svg viewBox="0 0 620 170"><use href="#f1CarSilhouette"/></svg><span>P1</span></div>
                  <div class="lp-mp-slot p2"><svg viewBox="0 0 620 170" style="--car-body:url(#gBlue)"><use href="#f1CarSilhouette"/></svg><span>P2</span></div>
                </div>
              </div>
              <div class="lp-mode-body">
                <h3 class="lp-mode-title">Head-to-Head Multiplayer</h3>
                <p class="lp-mode-desc">Host or join online race rooms for 2 to 20 real players, with synchronized driver/car/manager roulettes, a live timing tower and full-field results.</p>
                <div class="lp-mode-footer">
                  <span class="lp-mode-meta">2–20 Players &middot; Selection Roulette &middot; Full Grid</span>
                  <span class="lp-mode-btn lp-btn-mp">Enter Multiplayer Arena <span class="arrow">→</span></span>
                </div>
              </div>
            </div>

            <div class="lp-mode-card lp-mode-locked" data-mode="career" aria-disabled="true">
              <div class="lp-mode-img-wrap">
                <img src="/assets/images/story_garage_prep.jpg" alt="Driver Career Progression" class="lp-mode-img locked-filter" loading="lazy" decoding="async" />
                <div class="lp-mode-badge locked">COMING SOON</div>
              </div>
              <div class="lp-mode-body">
                <h3 class="lp-mode-title">Career Mode</h3>
                <p class="lp-mode-desc">Rise through feeder championships, earn constructor contract offers, manage team budgets, and develop chassis aerodynamic upgrades.</p>
                <div class="lp-mode-footer">
                  <span class="lp-mode-meta">Multi-Year Story &middot; R&amp;D Upgrades</span>
                  <span class="lp-mode-btn lp-btn-locked">Locked &middot; Season 2</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- Divider -->
        <svg class="lp-animated-divider" viewBox="0 0 1200 40" preserveAspectRatio="none" aria-hidden="true"><path class="lp-dv-path" d="M0 30 C 200 30 260 8 420 8 S 700 34 820 20 S 1050 4 1200 10" fill="none" stroke="#e10600" stroke-width="2.5"/></svg>

        <!-- Live Simulator Telemetry & Grid Benchmarks -->
        <section class="lp-section lp-telemetry-section" id="simulatorTelemetry" aria-labelledby="telemetryTitle">
          <div class="lp-section-header">
            <span class="lp-section-tag">REAL-TIME TELEMETRY</span>
            <h2 id="telemetryTitle" class="lp-section-title"><span class="ln"><span>BUILT FOR THE GRID</span></span></h2>
            <p class="lp-section-sub">Every figure is computed from the simulator's live physics model and championship engine.</p>
          </div>
          <div class="lp-stat-grid" id="lpStatGrid">
            <div class="lp-stat-card">
              <div class="lp-stat-num"><span data-count="8">8</span><small class="lp-stat-suffix">FIA</small></div>
              <div class="lp-stat-lbl">Grand Prix Circuits</div>
              <div class="lp-stat-bar"><i style="--target-scale: 1;"></i></div>
            </div>
            <div class="lp-stat-card">
              <div class="lp-stat-num"><span data-count="20">20</span><small class="lp-stat-suffix">GRID</small></div>
              <div class="lp-stat-lbl">Drivers &amp; Constructor Machines</div>
              <div class="lp-stat-bar"><i style="--target-scale: 1;"></i></div>
            </div>
            <div class="lp-stat-card">
              <div class="lp-stat-num"><span data-count="7">7</span><small class="lp-stat-suffix">ML</small></div>
              <div class="lp-stat-lbl">Machine Learning Algorithms</div>
              <div class="lp-stat-bar"><i style="--target-scale: 0.88;"></i></div>
            </div>
            <div class="lp-stat-card">
              <div class="lp-stat-num"><span data-count="1000">1000</span><small class="lp-stat-suffix">HZ</small></div>
              <div class="lp-stat-lbl">Physics Integration Loop</div>
              <div class="lp-stat-bar"><i style="--target-scale: 1;"></i></div>
            </div>
            <div class="lp-stat-card">
              <div class="lp-stat-num"><span data-count="5">5</span><small class="lp-stat-suffix">TYRES</small></div>
              <div class="lp-stat-lbl">Pirelli Thermal Formulations</div>
              <div class="lp-stat-bar"><i style="--target-scale: 0.85;"></i></div>
            </div>
            <div class="lp-stat-card">
              <div class="lp-stat-num"><span data-count="20">20</span><small class="lp-stat-suffix">PVP</small></div>
              <div class="lp-stat-lbl">Max Real-Time Room Capacity</div>
              <div class="lp-stat-bar"><i style="--target-scale: 0.95;"></i></div>
            </div>
          </div>
        </section>

        <!-- Divider -->
        <svg class="lp-animated-divider" viewBox="0 0 1200 40" preserveAspectRatio="none" aria-hidden="true"><path class="lp-dv-path" d="M0 10 C 150 35 380 32 540 12 S 860 38 1020 18 S 1150 28 1200 30" fill="none" stroke="#e10600" stroke-width="2.5"/></svg>

        <!-- 5. Story -->
        <section class="lp-section lp-story-section">
          <div class="lp-section-header">
            <span class="lp-section-tag">MOTORSPORT LEGACY</span>
            <h2 class="lp-section-title"><span class="ln"><span>IT'S NOT JUST A RACE.</span></span> <span class="ln lp-highlight-red"><span>IT'S YOUR STORY.</span></span></h2>
            <p class="lp-section-sub">Choose your driver. Build your team. Master every circuit. Turn every lap into a legacy.</p>
          </div>

          <div class="lp-story-grid">
            <article class="lp-story-card">
              <div class="lp-story-img-wrap"><img src="/assets/images/story_garage_prep.jpg" alt="Preparation in the garage before the Grand Prix" class="lp-story-img" loading="lazy" decoding="async" /></div>
              <div class="lp-story-content">
                <span class="lp-story-step">01 &middot; THE PREPARATION</span>
                <h3 class="lp-story-heading">Command the Garage</h3>
                <p class="lp-story-text">Work directly with your Team Principal. Analyze telemetry, calculate fuel loads, evaluate track temperatures, and select optimal starting compounds.</p>
              </div>
            </article>
            <article class="lp-story-card">
              <div class="lp-story-img-wrap"><img src="/assets/images/hero_sunset_race.png" alt="Wheel-to-wheel racing on the track apex" class="lp-story-img" loading="lazy" decoding="async" /></div>
              <div class="lp-story-content">
                <span class="lp-story-step">02 &middot; THE EXECUTION</span>
                <h3 class="lp-story-heading">Master Every Apex</h3>
                <p class="lp-story-text">React instantly to the five red lights. Execute daring overtakes in DRS zones, survive turbulent dirty air, and manage tyre wear across every stint.</p>
              </div>
            </article>
            <article class="lp-story-card">
              <div class="lp-story-img-wrap"><img src="/assets/images/mode_championship.png" alt="World Championship Trophy and Podium Celebration" class="lp-story-img" loading="lazy" decoding="async" /></div>
              <div class="lp-story-content">
                <span class="lp-story-step">03 &middot; THE GLORY</span>
                <h3 class="lp-story-heading">Claim the Championship</h3>
                <p class="lp-story-text">Stand on top of the podium. Accumulate World Championship points, defend your constructors' crown, and write your name alongside racing legends.</p>
              </div>
            </article>
          </div>
        </section>

        <!-- 6. Circuits -->
        <section class="lp-section lp-circuits-section" id="featuredCircuits">
          <div class="lp-section-header">
            <span class="lp-section-tag">CALENDAR BENCHMARKS</span>
            <h2 class="lp-section-title"><span class="ln"><span>FEATURED CIRCUITS</span></span> <span class="ln lp-highlight-red"><span>&amp; OFFICIAL RECORDS</span></span></h2>
            <p class="lp-section-sub">Every circuit features authentic layout geometry, DRS zones, and verified official Formula 1 lap records.</p>
          </div>

          <div class="lp-circuits-grid">
            ${featuredCircuits
              .map(
                (c) => `
              <div class="lp-circuit-card" data-circuit="${c.id}">
                <div class="lp-circuit-top">
                  <div class="lp-circuit-name-grp">
                    <span class="lp-circuit-country">${c.country} (${c.countryCode})</span>
                    <h3 class="lp-circuit-name">${c.name}</h3>
                  </div>
                  <span class="lp-circuit-turns">${c.turns} TURNS</span>
                </div>
                <div class="lp-circuit-specs">
                  <div class="spec-row"><span>Length</span><strong>${(c.lengthM / 1000).toFixed(3)} km</strong></div>
                  <div class="spec-row"><span>DRS Zones</span><strong>${c.drs} Zones</strong></div>
                  <div class="spec-row"><span>Lap Record</span><strong class="rec-time">${c.rec.toFixed(3)}s</strong></div>
                  <div class="spec-row"><span>Holder</span><strong>${c.who} (${c.year})</strong></div>
                </div>
                <p class="lp-circuit-note">${c.note || ''}</p>
                <button type="button" class="lp-btn-circuit-launch" data-circuit="${c.id}">Race ${c.short} Now →</button>
              </div>`
              )
              .join('')}
          </div>
        </section>

        <!-- 7. Footer -->
        <footer class="lp-footer">
          <div class="lp-footer-inner">
            <div class="lp-footer-brand">
              <span class="lp-brand-badge">F1</span>
              <div>
                <strong>APEX AUTONOMOUS RACING SIMULATOR</strong>
                <p>Pure motorsport simulation with fixed-step numerical integration and autonomous AI drivers.</p>
              </div>
            </div>
            <div class="lp-footer-links">
              <button type="button" class="lp-footer-link" data-action="quickrace">Quick Race</button>
              <button type="button" class="lp-footer-link" data-action="championship">Championship</button>
              <button type="button" class="lp-footer-link" data-action="draftmode">Draft Mode</button>
              <button type="button" class="lp-footer-link" data-action="garage">Team Draft</button>
              <button type="button" class="lp-footer-link" data-action="circuits">Circuits</button>
              <button type="button" class="lp-footer-link" data-action="settings">Settings</button>
            </div>
          </div>
          <div class="lp-footer-bottom">
            <span>&copy; 2025 Apex Motorsport Systems. High-performance autonomous physics engine.</span>
            <span>Non-commercial open motorsport educational simulation.</span>
          </div>
        </footer>
      </div>
    `;

    this._bindEvents();
    this._particles = createParticleSystem(this.container.querySelector('#lpParticlesFx'), {
      count: typeof window !== 'undefined' && window.innerWidth <= 640 ? 18 : 42,
      speed: 1.1
    });
    this._gantry = initStartGantry(this.container);
    this._tiltCleanup = setupTilt(this.container);
    this._gsapCtx = initScrollAnimations(this.container);
    this._navIndCleanup = initNavbarIndicator(this.container);
    this._navScrollCleanup = initNavbarScrollState(this.container);
  }

  /** Remove global listeners, stop animation loops and release the scroll lock. */
  destroy() {
    if (this._onKeyDown) window.removeEventListener('keydown', this._onKeyDown);
    if (this._onResize) window.removeEventListener('resize', this._onResize);
    this._onKeyDown = null;
    this._onResize = null;
    if (this._particles) { this._particles.stop(); this._particles = null; }
    if (this._gantry) { this._gantry.stop(); this._gantry = null; }
    if (this._gsapCtx) { this._gsapCtx.revert(); this._gsapCtx = null; }
    if (this._tiltCleanup) { this._tiltCleanup(); this._tiltCleanup = null; }
    if (this._navIndCleanup) { this._navIndCleanup(); this._navIndCleanup = null; }
    if (this._navScrollCleanup) { this._navScrollCleanup(); this._navScrollCleanup = null; }
    document.body.classList.remove('lp-menu-open');
  }

  _setDrawer(open) {
    const q = (s) => this.container?.querySelector(s);
    const drawer = q('#lpMobileDrawer');
    const burger = q('#lpHamburgerBtn');
    const backdrop = q('#lpDrawerBackdrop');
    if (!drawer) return;

    drawer.classList.toggle('is-open', open);
    drawer.setAttribute('aria-hidden', String(!open));
    if (open) drawer.removeAttribute('inert');
    else drawer.setAttribute('inert', '');
    backdrop?.classList.toggle('is-open', open);
    if (burger) {
      burger.classList.toggle('active', open);
      burger.setAttribute('aria-expanded', String(open));
      burger.setAttribute('aria-label', open ? 'Close navigation menu' : 'Open navigation menu');
    }
    document.body.classList.toggle('lp-menu-open', open);

    if (open) q('#lpDrawerCloseBtn')?.focus({ preventScroll: true });
    else if (this._drawerWasOpen) burger?.focus({ preventScroll: true });
    this._drawerWasOpen = open;
  }

  _openMobileDrawer() { this._setDrawer(true); }
  _closeMobileDrawer() { this._setDrawer(false); }

  _scrollTo(selector) {
    this.container?.querySelector(selector)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  _bindEvents() {
    if (!this.container) return;
    const $ = (s) => this.container.querySelector(s);

    // Drawer starts inert so keyboard focus can't reach hidden links
    $('#lpMobileDrawer')?.setAttribute('inert', '');

    $('#lpHamburgerBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this._setDrawer(!$('#lpMobileDrawer').classList.contains('is-open'));
    });
    $('#lpDrawerBackdrop')?.addEventListener('click', () => this._closeMobileDrawer());
    $('#lpDrawerCloseBtn')?.addEventListener('click', () => this._closeMobileDrawer());

    this._onKeyDown = (e) => {
      if (e.key === 'Escape') this._closeMobileDrawer();
    };
    window.addEventListener('keydown', this._onKeyDown);

    // Close the drawer (and release scroll lock) if the viewport grows to desktop
    this._onResize = () => {
      if (window.innerWidth >= DESKTOP_BREAKPOINT) this._closeMobileDrawer();
    };
    window.addEventListener('resize', this._onResize, { passive: true });

    // Navigation (desktop links, drawer links, brand, footer links, settings)
    this.container.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        sfx.blip();
        const action = btn.dataset.action;
        if (btn.tagName === 'A') e.preventDefault();
        this._closeMobileDrawer();

        this.container.querySelectorAll('.lp-nav-link, .lp-drawer-link').forEach((link) => {
          link.classList.toggle('active', link.dataset.action === action);
        });

        switch (action) {
          case 'home': window.scrollTo({ top: 0, behavior: 'smooth' }); break;
          case 'quickrace': this.onStartQuickRace(); break;
          case 'championship': this.onStartChampionship(); break;
          case 'draftmode': this.onStartDraftMode(); break;
          case 'multiplayer': this.onStartMultiplayer(); break;
          case 'circuits': this._scrollTo('#featuredCircuits'); break;
          case 'garage': this.onOpenDraft(); break;
          case 'settings': this.onOpenSettings(); break;
        }
      });
    });

    // Hero + drawer CTAs
    $('#lpHeroStartBtn')?.addEventListener('click', () => { sfx.blip(); this.onStartQuickRace(); });
    $('#lpHeroChampBtn')?.addEventListener('click', () => { sfx.blip(); this.onStartChampionship(); });
    $('#lpHeroChangeDraftBtn')?.addEventListener('click', () => { sfx.blip(); this.onOpenDraft(); });
    $('#lpDrawerStartBtn')?.addEventListener('click', () => {
      sfx.blip();
      this._closeMobileDrawer();
      this.onStartQuickRace();
    });

    // Soundtrack
    const landingAudio = getLandingAudio();
    const btnMusic = $('#lpBtnMusic');
    const drawerMusic = $('#lpDrawerMusic');
    btnMusic?.addEventListener('click', () => landingAudio.toggle());
    drawerMusic?.addEventListener('click', () => landingAudio.toggle());
    landingAudio.bindUI({
      btn: btnMusic,
      label: $('#lpMusicLabel'),
      icon: $('#lpMusicIcon'),
      drawerBtn: drawerMusic,
    });
    landingAudio.play();

    const unlock = () => {
      if (!landingAudio.isPlaying && landingAudio.isEnabled && landingAudio.canPlay()) {
        landingAudio.play(true);
      }
    };
    this.container.addEventListener('click', unlock, { capture: true, passive: true });
    this.container.addEventListener('pointerdown', unlock, { capture: true, passive: true });

    // Mode cards
    this.container.querySelectorAll('.lp-mode-card:not(.lp-mode-locked)').forEach((card) => {
      card.addEventListener('click', () => {
        sfx.blip();
        switch (card.dataset.mode) {
          case 'quickrace': this.onStartQuickRace(); break;
          case 'championship': this.onStartChampionship(); break;
          case 'draftmode': this.onStartDraftMode(); break;
          case 'multiplayer': this.onStartMultiplayer(); break;
          case 'timetrial': this._scrollTo('#featuredCircuits'); break;
        }
      });
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          card.click();
        }
      });
    });

    // Circuit cards
    this.container.querySelectorAll('.lp-btn-circuit-launch').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        sfx.blip();
        e.stopPropagation();
        this.onSelectCircuit(btn.dataset.circuit);
      });
    });
  }
}

let _landingPageInstance = null;

export function getLandingPage(options = {}) {
  if (!_landingPageInstance) {
    _landingPageInstance = new LandingPage(options);
  } else if (options && Object.keys(options).length > 0) {
    Object.assign(_landingPageInstance, options);
  }
  return _landingPageInstance;
}