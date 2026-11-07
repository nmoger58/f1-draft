/**
 * cameraController.js
 * Smooth camera: overview / follow-car / chase-cam modes.
 * Direct port of the original camera logic, now isolated as a module.
 */

import { SimConfig } from '../config/simulationConfig.js';

export class CameraController {
  constructor() {
    this.z    = 1;      // zoom
    this.w    = 0;      // follow weight (0 = overview, 1 = follow)
    this.rot  = 0;      // rotation degrees
    this.mode = 'overview';  // 'overview' | 'follow'
    this.chase = true;
    this.zf   = SimConfig.render.followZoom;
  }

  /**
   * Smooth camera update — called every frame.
   * @param {object} scene – { world, vcx, vcy, vh }
   * @param {object} car   – selected car { x, y, ang }
   * @param {number} dt    – wall-clock delta seconds
   * @param {number} warp
   */
  update(scene, car, dt, warp) {
    if (!scene || !car) return;
    const { world, vcx, vcy, vh } = scene;
    const follow = this.mode === 'follow';
    const k1 = 1 - Math.exp(-dt * 5);

    this.z = Math.exp(Math.log(this.z) + (Math.log(follow ? this.zf : 1) - Math.log(this.z)) * k1);
    this.w += ((follow ? 1 : 0) - this.w) * k1;

    const tRot = follow && this.chase ? -90 - car.ang * 180 / Math.PI : 0;
    const diff = ((tRot - this.rot + 540) % 360) - 180;
    this.rot += diff * (1 - Math.exp(-dt * (7 + warp * 2)));

    const cx  = vcx + (car.x - vcx) * this.w;
    const cy  = vcy + (car.y - vcy) * this.w;
    const off = this.chase ? 0.17 * vh * this.w : 0;

    world.setAttribute('transform',
      `translate(${vcx.toFixed(1)} ${(vcy + off).toFixed(1)}) rotate(${this.rot.toFixed(2)}) scale(${this.z.toFixed(4)}) translate(${(-cx).toFixed(1)} ${(-cy).toFixed(1)})`);
  }

  zoom(dir) {
    if (this.mode === 'overview') {
      if (dir > 0) { this.mode = 'follow'; this.zf = 3; }
    } else {
      this.zf = Math.max(1, Math.min(16, this.zf * (dir > 0 ? 1.28 : 0.78)));
      if (this.zf < 1.7) { this.mode = 'overview'; this.zf = SimConfig.render.followZoom; }
    }
  }

  setOverview() { this.mode = 'overview'; }
  setFollow()   { this.mode = 'follow'; }
  toggleChase() { this.chase = !this.chase; }

  get hudText() {
    return this.mode === 'follow'
      ? `${this.zf.toFixed(1)}× zoom${this.chase ? ' · Chase' : ''}`
      : 'Overview';
  }
}
