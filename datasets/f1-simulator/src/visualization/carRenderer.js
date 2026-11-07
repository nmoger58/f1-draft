/**
 * carRenderer.js
 * Creates and updates SVG car sprites with dynamic tyre compound livery sidewalls.
 */

import { SimConfig } from '../config/simulationConfig.js';

const NS  = 'http://www.w3.org/2000/svg';
const f1  = n => n.toFixed(1);
const cs  = SimConfig.render.carScale;

function carShape(color, tyreColour = '#ffd60a') {
  return `<g stroke="#fff" stroke-width="1" stroke-linejoin="round">
    <rect x="-13" y="-6.5" width="3.6" height="13" rx="1" fill="#111"/>
    <rect x="9" y="-6" width="3" height="12" rx="1" fill="#111"/>
    <!-- Rear Left Tyre & Sidewall Stripe -->
    <rect x="-9" y="-6.8" width="6" height="3.2" rx="1" fill="#111"/>
    <line class="tyre-stripe" x1="-8.5" y1="-5.2" x2="-3.5" y2="-5.2" stroke="${tyreColour}" stroke-width="1.3" stroke-linecap="round"/>
    <!-- Rear Right Tyre & Sidewall Stripe -->
    <rect x="-9" y="3.6" width="6" height="3.2" rx="1" fill="#111"/>
    <line class="tyre-stripe" x1="-8.5" y1="5.2" x2="-3.5" y2="5.2" stroke="${tyreColour}" stroke-width="1.3" stroke-linecap="round"/>
    <!-- Front Left Tyre & Sidewall Stripe -->
    <rect x="4" y="-6.2" width="5" height="2.8" rx="1" fill="#111"/>
    <line class="tyre-stripe" x1="4.5" y1="-4.8" x2="8.5" y2="-4.8" stroke="${tyreColour}" stroke-width="1.3" stroke-linecap="round"/>
    <!-- Front Right Tyre & Sidewall Stripe -->
    <rect x="4" y="3.4" width="5" height="2.8" rx="1" fill="#111"/>
    <line class="tyre-stripe" x1="4.5" y1="4.8" x2="8.5" y2="4.8" stroke="${tyreColour}" stroke-width="1.3" stroke-linecap="round"/>
    <!-- Body Chassis -->
    <path d="M-10 -2.8 L2 -2.4 L12 -1 L12 1 L2 2.4 L-10 2.8 Z" fill="${color}"/>
  </g><circle cx="-1" cy="0" r="1.7" fill="#fff"/>`;
}

/**
 * Create SVG car elements for each car and append them to the scene layers.
 * Returns an array of { el, lbl, ring, tyreStripes, _lastTyreCol } objects matched to car indices.
 */
export function createCarElements(cars, scene, k, onCarClick) {
  const sprites = cars.map((car, i) => {
    const el = document.createElementNS(NS, 'g');
    el.style.cursor = 'pointer';
    const initialTyreCol = car.tyreModel?.colour || car.tyreStrategy?.colour || '#ffd60a';

    el.innerHTML = `<circle r="17" fill="transparent"/>
      <circle class="ring" r="17" fill="none" stroke="#fff" stroke-width="1.6" stroke-dasharray="5 4" visibility="hidden"/>
      ${carShape(car.color, initialTyreCol)}`;
    el.addEventListener('click', () => onCarClick(i));

    const lbl = document.createElementNS(NS, 'g');
    lbl.style.pointerEvents = 'none';
    lbl.innerHTML = `<text y="${f1(-13*k)}" text-anchor="middle" font-family="Rajdhani,sans-serif" font-weight="700" font-size="${f1(10.5*k)}" fill="#fff" stroke="#000" stroke-width="${f1(2.6*k)}" paint-order="stroke" letter-spacing=".5">${car.code}</text>`;

    scene.carLayer.appendChild(el);
    scene.lblLayer.appendChild(lbl);

    const tyreStripes = Array.from(el.querySelectorAll('.tyre-stripe'));
    return { el, lbl, ring: el.querySelector('.ring'), tyreStripes, _lastTyreCol: initialTyreCol };
  });
  return sprites;
}

/**
 * Update all car SVG transforms and tyre sidewall colours for the current frame.
 * @param {object[]} cars     – race engine car states
 * @param {object[]} sprites  – SVG sprite refs from createCarElements
 * @param {object}   cam      – camera state { z, rot }
 * @param {number}   k        – track scale factor
 * @param {number}   selIdx   – index of selected car
 */
export function drawCars(cars, sprites, cam, k, selIdx) {
  const scale = cs * k;
  cars.forEach((car, i) => {
    const sp = sprites[i];
    if (!sp) return;

    // Dynamically update tyre sidewall livery when compound changes
    const curTyreCol = car.tyreModel?.colour || car.tyreStrategy?.colour || '#ffd60a';
    if (sp._lastTyreCol !== curTyreCol) {
      sp._lastTyreCol = curTyreCol;
      sp.tyreStripes?.forEach(line => line.setAttribute('stroke', curTyreCol));
    }

    sp.el.setAttribute('transform',
      `translate(${f1(car.x)} ${f1(car.y)}) rotate(${(car.ang * 180 / Math.PI).toFixed(1)}) scale(${scale.toFixed(3)})`);
    sp.lbl.setAttribute('transform',
      `translate(${f1(car.x)} ${f1(car.y)}) rotate(${(-cam.rot).toFixed(1)}) scale(${(1 / cam.z).toFixed(3)})`);
    sp.ring.setAttribute('visibility', i === selIdx ? 'visible' : 'hidden');
  });
}

/**
 * Re-order SVG car elements so the selected car is drawn on top.
 */
export function orderCarElements(sprites, scene, selIdx) {
  sprites.filter((_, i) => i !== selIdx).concat(sprites[selIdx])
    .forEach(sp => {
      if (!sp) return;
      scene.carLayer.appendChild(sp.el);
      scene.lblLayer.appendChild(sp.lbl);
    });
}

function safetyCarShape() {
  return `<g stroke="#fff" stroke-width="0.8" stroke-linejoin="round">
    <!-- Wide Performance Tyres -->
    <rect x="-12" y="-6.5" width="4" height="13" rx="1" fill="#111"/>
    <rect x="8" y="-6" width="3.5" height="12" rx="1" fill="#111"/>
    <rect x="-9" y="-6.8" width="6" height="3" rx="1" fill="#111"/>
    <rect x="-9" y="3.8" width="6" height="3" rx="1" fill="#111"/>
    <rect x="4" y="-6.2" width="5" height="2.6" rx="1" fill="#111"/>
    <rect x="4" y="3.6" width="5" height="2.6" rx="1" fill="#111"/>

    <!-- Aerodynamic GT Coupe Body (Aston Martin Racing Green / Mercedes Silver) -->
    <path d="M-11 -3.4 L-4 -3.8 L6 -3.2 L11 -1.8 L11 1.8 L6 3.2 L-4 3.8 L-11 3.4 Z" fill="#004d40" stroke="#00f59b" stroke-width="1.2"/>
    <!-- Cabin Roof -->
    <path d="M-5 -2.2 L1.5 -2.0 L3.5 -1.0 L3.5 1.0 L1.5 2.0 L-5 2.2 Z" fill="#151722"/>

    <!-- Roof Lightbar Assembly -->
    <rect x="-2" y="-3.5" width="3" height="7" rx="0.8" fill="#222" stroke="#444" stroke-width="0.6"/>
    <!-- Left & Right Amber Beacons -->
    <circle class="sc-beacon sc-beacon-left" cx="-0.5" cy="-2.2" r="1.3" fill="#ff9100"/>
    <circle class="sc-beacon sc-beacon-right" cx="-0.5" cy="2.2" r="1.3" fill="#ff9100"/>
    <circle class="sc-beacon-center" cx="-0.5" cy="0" r="0.8" fill="#ffd60a"/>

    <!-- Rear Aero Wing -->
    <rect x="-11.5" y="-5.5" width="1.8" height="11" rx="0.5" fill="#111"/>
  </g>`;
}

/**
 * Create dedicated SVG elements for the Physical Safety Car.
 * @param {object} scene – SVG scene layers
 * @param {number} k – track scale
 * @returns {object} { el, lbl, beacons }
 */
export function createSafetyCarElement(scene, k) {
  const el = document.createElementNS(NS, 'g');
  el.className.baseVal = 'safety-car-sprite';
  el.style.display = 'none';
  el.innerHTML = safetyCarShape();

  const lbl = document.createElementNS(NS, 'g');
  lbl.className.baseVal = 'safety-car-lbl';
  lbl.style.pointerEvents = 'none';
  lbl.style.display = 'none';
  lbl.innerHTML = `<text y="${f1(-14*k)}" text-anchor="middle" font-family="Rajdhani,sans-serif" font-weight="800" font-size="${f1(9.5*k)}" fill="#ffd60a" stroke="#000" stroke-width="${f1(2.5*k)}" paint-order="stroke" letter-spacing="1">SAFETY CAR</text>`;

  scene.carLayer.appendChild(el);
  scene.lblLayer.appendChild(lbl);

  return { el, lbl, leftBeacon: el.querySelector('.sc-beacon-left'), rightBeacon: el.querySelector('.sc-beacon-right') };
}

/**
 * Render Physical Safety Car SVG transform and beacon state.
 * @param {object} safetyCar – safety car state from raceControl.safetyCar
 * @param {object} scSprite  – sprite refs from createSafetyCarElement
 * @param {object} cam       – camera state
 * @param {number} k         – scale factor
 */
export function drawSafetyCar(safetyCar, scSprite, cam, k) {
  if (!scSprite) return;

  if (!safetyCar || !safetyCar.active) {
    scSprite.el.style.display = 'none';
    scSprite.lbl.style.display = 'none';
    return;
  }

  scSprite.el.style.display = '';
  scSprite.lbl.style.display = '';

  const scale = cs * k * 1.08;
  scSprite.el.setAttribute('transform',
    `translate(${f1(safetyCar.x)} ${f1(safetyCar.y)}) rotate(${(safetyCar.ang * 180 / Math.PI).toFixed(1)}) scale(${scale.toFixed(3)})`);
  scSprite.lbl.setAttribute('transform',
    `translate(${f1(safetyCar.x)} ${f1(safetyCar.y)}) rotate(${(-cam.rot).toFixed(1)}) scale(${(1 / cam.z).toFixed(3)})`);

  // Beacon flash toggle (lights off when in-lap / withdrawing)
  if (safetyCar.beaconLightsActive) {
    scSprite.el.classList.add('sc-beacon-active');
  } else {
    scSprite.el.classList.remove('sc-beacon-active');
    if (scSprite.leftBeacon) {
      scSprite.leftBeacon.setAttribute('fill', '#444');
      scSprite.rightBeacon?.setAttribute('fill', '#444');
    }
  }
}

