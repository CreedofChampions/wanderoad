/* Wanderoad — input.
 *
 * Keyboard, gamepad and touch are all live at once and are combined per axis by magnitude.
 * The game NEVER auto-switches the active device: "TURN OFF ALL automatic control swapping
 * PLEASE!!!!" is among the most emphatic things Solar Crown players say, and in a browser a
 * stray mouse move or focus change happens constantly.
 *
 * The steering RAMP lives in the vehicle, not here — this module only reports intent, and
 * whether that intent came from an analogue source (which the vehicle uses to decide
 * between the keyboard ramp and the gamepad rate limit).
 */

import { clamp, clamp01 } from '../core/math.js';
import { STEER } from './tuning.js';

const KEYMAP = {
  steerLeft: ['KeyA', 'ArrowLeft'],
  steerRight: ['KeyD', 'ArrowRight'],
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  handbrake: ['Space'],
  shiftUp: ['KeyE', 'ShiftRight'],
  shiftDown: ['KeyQ'],
  camera: ['KeyC'],
  // R is RESET — it is the key people reach for when they are stuck, and it was on T.
  reset: ['KeyR', 'KeyT'],
  reverse: ['KeyB'],
  nextCar: ['KeyV'],
  radio: ['KeyN'],
  autodrive: ['KeyG'],
  horn: ['KeyH'],
  /* F for FUEL — pour a spare can into the tank. Bought at a petrol station (operator: "make it so
   * you can buy gas cans in the petrol stations"), carried in the boot, and used wherever you happen
   * to be, which is the whole point of carrying one. */
  useCan: ['KeyF'],
  fine: ['ShiftLeft'],
  attack: ['ControlLeft'],
};

export class Input {
  constructor(target = window) {
    this.keys = new Set();
    this.pressed = new Set(); // edge-triggered, cleared each read
    this.analogue = false;
    this.padIndex = null;
    this._lastDevice = 'keyboard';
    this._deviceSince = 0;

    this.state = {
      steer: 0,
      throttle: 0,
      brake: 0,
      handbrake: 0,
      analogue: false,
      fine: false,
      attack: false,
    };

    this._onDown = (e) => {
      if (e.repeat) return;
      // Space scrolls the page and the arrow keys move the caret; a driving game needs both.
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
      this.pressed.add(e.code);
    };
    this._onUp = (e) => this.keys.delete(e.code);
    this._onBlur = () => this.keys.clear();

    target.addEventListener('keydown', this._onDown, { passive: false });
    target.addEventListener('keyup', this._onUp);
    target.addEventListener('blur', this._onBlur);
    target.addEventListener('gamepadconnected', (e) => {
      this.padIndex = e.gamepad.index;
    });
    target.addEventListener('gamepaddisconnected', () => {
      this.padIndex = null;
    });
    this._target = target;

    // touch: two invisible halves, left steers, right is throttle/brake
    this.touch = { steer: 0, throttle: 0, brake: 0, active: false };
  }

  /** True once, on the frame the key went down. */
  tapped(action) {
    const codes = KEYMAP[action] || [];
    for (const c of codes) if (this.pressed.has(c)) return true;
    return false;
  }

  held(action) {
    const codes = KEYMAP[action] || [];
    for (const c of codes) if (this.keys.has(c)) return true;
    return false;
  }

  /** Read every device and produce one intent. Call once per frame. */
  poll() {
    const s = this.state;

    // ── keyboard ──
    // NOTE THE SIGN. The solver works in a frame where forward is (sin yaw, cos yaw) and a
    // positive yaw rate rotates forward towards +X. In three's right-handed space, when you
    // look along +Z the +X axis is on your LEFT — so a positive steer angle turns the car
    // left on screen. Steering was inverted on the first live build for exactly this reason.
    // The whole solver is self-consistent in its own frame, so the fix belongs here, once,
    // at the boundary between the player's left/right and the maths.
    let kSteer = (this.held('steerLeft') ? 1 : 0) - (this.held('steerRight') ? 1 : 0);
    let kThrottle = this.held('throttle') ? 1 : 0;
    let kBrake = this.held('brake') ? 1 : 0;
    let kHand = this.held('handbrake') ? 1 : 0;

    // ── gamepad ──
    let gSteer = 0;
    let gThrottle = 0;
    let gBrake = 0;
    let gHand = 0;
    let padLive = false;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      padLive = true;
      // Radial deadzone with a response curve, never an axis-independent dead band. A large
      // centre deadzone is Solar Crown's single most repeated complaint.
      const ax = -(p.axes[0] || 0); // same handedness flip as the keyboard above
      const mag = Math.abs(ax);
      if (mag > STEER.padDeadzone) {
        const n = clamp01((mag - STEER.padDeadzone) / (STEER.padSaturation - STEER.padDeadzone));
        gSteer = Math.sign(ax) * Math.pow(n, STEER.padCurve);
      }
      gThrottle = p.buttons[7] ? p.buttons[7].value : 0;
      gBrake = p.buttons[6] ? p.buttons[6].value : 0;
      gHand = p.buttons[0] && p.buttons[0].pressed ? 1 : 0;
      break;
    }

    // ── combine by magnitude; never switch device ──
    s.steer = Math.abs(gSteer) > Math.abs(kSteer) ? gSteer : kSteer;
    if (this.touch.active && Math.abs(this.touch.steer) > Math.abs(s.steer)) s.steer = this.touch.steer;
    s.throttle = Math.max(kThrottle, gThrottle, this.touch.throttle);
    s.brake = Math.max(kBrake, gBrake, this.touch.brake);
    s.handbrake = Math.max(kHand, gHand);

    // The vehicle needs to know whether this frame's steering is analogue, because the
    // keyboard ramp and the gamepad rate limit are different mechanisms.
    s.analogue = padLive && Math.abs(gSteer) >= Math.abs(kSteer) && Math.abs(gSteer) > 0.001;
    if (this.touch.active) s.analogue = true;

    // ── modifiers ──
    // Fine mode is for cruising: hold it and the car will sit at 40 km/h without you
    // feathering a digital key.
    s.fine = this.held('fine');
    s.attack = this.held('attack');
    if (s.fine) {
      s.throttle = Math.min(s.throttle, 0.45);
      s.steer *= 0.6;
    }
    if (s.attack) s.steer = clamp(s.steer * 1.25, -1, 1);

    return s;
  }

  /** Call at the very end of the frame. */
  endFrame() {
    this.pressed.clear();
  }

  /** Wire the touch halves to a DOM element (mobile). */
  attachTouch(el) {
    const rect = () => el.getBoundingClientRect();
    const handle = (ev) => {
      const r = rect();
      let steer = 0;
      let throttle = 0;
      let brake = 0;
      let any = false;
      for (const t of ev.touches) {
        any = true;
        const x = (t.clientX - r.left) / r.width;
        const y = (t.clientY - r.top) / r.height;
        if (x < 0.5) {
          steer = clamp(-(x / 0.5 - 0.5) * 2.4, -1, 1); // handedness flip, see poll()
        } else if (y > 0.55) {
          brake = 1;
        } else {
          throttle = 1;
        }
      }
      this.touch.active = any;
      this.touch.steer = any ? steer : 0;
      this.touch.throttle = throttle;
      this.touch.brake = brake;
      if (any) ev.preventDefault();
    };
    el.addEventListener('touchstart', handle, { passive: false });
    el.addEventListener('touchmove', handle, { passive: false });
    el.addEventListener('touchend', handle, { passive: false });
    el.addEventListener('touchcancel', handle, { passive: false });
  }

  dispose() {
    this._target.removeEventListener('keydown', this._onDown);
    this._target.removeEventListener('keyup', this._onUp);
    this._target.removeEventListener('blur', this._onBlur);
  }
}

export const KEY_HELP = [
  ['W / ↑', 'throttle'],
  ['S / ↓', 'brake'],
  ['A D / ← →', 'steer'],
  ['Space', 'handbrake'],
  ['Shift', 'fine control'],
  ['C', 'camera'],
  ['R', 'back to the road'],
  ['V', 'next car'],
  ['B', 'reverse (or just hold brake when stopped)'],
  ['N', 'radio'],
  ['G', 'auto-drive'],
  ['Esc / M', 'garage'],
  ['H', 'horn'],
  ['1 2 3 4', 'assists: cruise / sport / off / hardcore'],
];
