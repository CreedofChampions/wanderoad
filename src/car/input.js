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
  /* X (or Enter) BUYS THE CAR YOU ARE STANDING NEXT TO on a dealership forecourt. Operator: "show
   * room type situation where they can see the different cars physically and choose them" — choosing
   * one has to be an act you perform AT the car, not a menu row. E was the obvious letter and is
   * already shiftUp; Enter is here because it is what anyone tries when a prompt says "confirm". */
  buyHere: ['KeyX', 'Enter'],
  /* P for PLANE — take off from where you are, or land and get back in the car. See game/plane.js. */
  fly: ['KeyP'],
  /* The pitch axis, which only the plane reads. I/K rather than the arrows, because the arrows are
   * already throttle and steering (see KEY_HELP) and the throttle has to keep meaning throttle in the
   * air. K pulls the nose UP — back on the stick to climb, the one control every flight game shares. */
  pitchUp: ['KeyK'],
  pitchDown: ['KeyI'],
  fine: ['ShiftLeft'],
  attack: ['ControlLeft'],
  /* THE GARAGE, as an ACTION rather than a key listened for somewhere else. Escape and M were bound
   * inside ui/menu.js, which meant a gamepad could never open the one panel that explains the game.
   * Routing it through the same action table as everything else is what makes Start work. */
  garage: ['Escape', 'KeyM'],
};

/* ── THE GAMEPAD, AS A FIRST-CLASS DEVICE ─────────────────────────────
 *
 * Operator: "add clear controler support and controls so u can open garage w reset to road and KNOW
 * how to do that and get hints at tirght times".
 *
 * The pad could steer, accelerate, brake and pull the handbrake — four of the twenty things the game
 * can do. Everything else was keyboard-only, including the two that matter most when you are stuck:
 * getting back on the road, and opening the Garage. A controller that can drive you into a field and
 * then cannot get you out of it is not controller support.
 *
 * So the pad gets the SAME action names as the keyboard, in a table beside it, and `tapped`/`held`
 * read both. Indices are the W3C Standard Gamepad layout, which is what every Xbox, PlayStation and
 * Switch Pro pad reports through the browser.
 *
 * The choices that are not arbitrary:
 *   Start opens the Garage — it is the menu button on every console ever made.
 *   View/Back AND Y both put you back on the road. Two bindings because this is the PANIC control:
 *     Y is under your thumb while driving, View is where racing games put "reset", and a player who
 *     is stuck should not have to remember which one this game chose.
 *   X buys the car you are standing at, matching the keyboard's X — so the forecourt prompt can name
 *     the same letter whichever device you are holding.
 *   A stays the handbrake, which is where it already was.
 */
const PADMAP = {
  handbrake: [0], // A
  reverse: [1], // B
  buyHere: [2], // X - the same letter as the keyboard binding
  reset: [3, 8], // Y and View/Back - see above, this is the panic control
  shiftDown: [4], // LB
  shiftUp: [5], // RB
  garage: [9], // Start
  fly: [10], // left stick click
  camera: [11], // right stick click
  useCan: [12], // D-pad up
  horn: [13], // D-pad down
  radio: [14], // D-pad left
  nextCar: [15], // D-pad right
};

/** What to CALL each pad button on screen. A prompt that names button 9 helps nobody. */
const PAD_NAMES = {
  0: 'A', 1: 'B', 2: 'X', 3: 'Y', 4: 'LB', 5: 'RB', 6: 'LT', 7: 'RT',
  8: 'View', 9: 'Start', 10: 'L3', 11: 'R3',
  12: 'D-pad up', 13: 'D-pad down', 14: 'D-pad left', 15: 'D-pad right',
};

/** What to CALL each key on screen, where the code is not already readable. */
const KEY_NAMES = {
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Space: 'Space', ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Ctrl', Escape: 'Esc',
};

/** 'KeyR' -> 'R', 'Digit1' -> '1', and anything already readable straight through. */
export function keyLabel(code) {
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}

/** What one action is called on one device, e.g. 'Start' or 'R'. Empty when it is not bound there. */
export function actionLabel(action, device = 'keyboard') {
  if (device === 'pad') {
    const b = PADMAP[action];
    return b && b.length ? PAD_NAMES[b[0]] || `button ${b[0]}` : '';
  }
  const k = KEYMAP[action];
  return k && k.length ? keyLabel(k[0]) : '';
}

/** Every action the pad can reach, for the Garage's own controls list. [action, padLabel, what]. */
export const PAD_HELP = [
  ['throttle', 'RT', 'throttle'],
  ['brake', 'LT', 'brake'],
  ['steer', 'Left stick', 'steer'],
  ['handbrake', 'A', 'handbrake'],
  ['reset', 'Y or View', 'put me back on the road'],
  ['garage', 'Start', 'this Garage - and Start or B closes it'],
  ['buyHere', 'X', 'buy the car you are standing at'],
  ['reverse', 'B', 'reverse'],
  ['camera', 'R3', 'change camera'],
  ['nextCar', 'D-pad right', 'next car'],
  ['radio', 'D-pad left', 'radio station'],
  ['useCan', 'D-pad up', 'pour in a spare fuel can'],
  ['horn', 'D-pad down', 'horn'],
  ['fly', 'L3', 'fly, once you have a plane'],
];

export class Input {
  constructor(target = window) {
    this.keys = new Set();
    this.pressed = new Set(); // edge-triggered, cleared each read
    /* The pad's equivalent of `keys` and `pressed`. A gamepad fires no events - it is POLLED - so
     * "was this button just pushed" has to be derived by comparing this frame against the last.
     * Without it, holding Start would toggle the Garage sixty times a second. */
    this.padDown = new Set();
    this.padPressed = new Set();
    this.padLive = false;
    this._padWas = new Set();
    this._navAxes = [0, 0];
    this._navArmed = [true, true];
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
      /** Plane only — see poll(). The car never reads it. */
      pitchAxis: 0,
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

  /** True once, on the frame the key OR the pad button went down. */
  tapped(action) {
    for (const c of KEYMAP[action] || []) if (this.pressed.has(c)) return true;
    for (const b of PADMAP[action] || []) if (this.padPressed.has(b)) return true;
    return false;
  }

  held(action) {
    for (const c of KEYMAP[action] || []) if (this.keys.has(c)) return true;
    for (const b of PADMAP[action] || []) if (this.padDown.has(b)) return true;
    return false;
  }

  /**
   * Which device is in the player's hands RIGHT NOW, so a prompt can name a control they have.
   * Telling someone holding a pad to "press X to buy" when X is a key, or telling a keyboard player
   * to "press Start", is the same as telling them nothing.
   */
  get device() {
    if (this.touch.active) return 'touch';
    return this.padLive ? 'pad' : 'keyboard';
  }

  /** What this action is called on the device in the player's hands. See actionLabel. */
  label(action) {
    return actionLabel(action, this.device === 'pad' ? 'pad' : 'keyboard');
  }

  /**
   * Menu navigation off the pad: one step per push, never a stream.
   *
   * The Garage is a page of DOM buttons, and a pad that can open it but not move through it is worse
   * than one that cannot open it at all. The stick is read as a d-pad here deliberately - a menu
   * wants discrete steps - and each axis re-arms only when it returns near centre, which is what
   * stops one flick from running the focus off the end of the list.
   *
   * @returns {{dx: number, dy: number, confirm: boolean, cancel: boolean}}
   */
  padNav() {
    const ax = this._navAxes;
    const step = (v, axis) => {
      if (Math.abs(v) < 0.35) {
        this._navArmed[axis] = true;
        return 0;
      }
      if (!this._navArmed[axis]) return 0;
      this._navArmed[axis] = false;
      return Math.sign(v);
    };
    const dxStick = step(ax[0], 0);
    const dyStick = step(ax[1], 1);
    const d = (i) => (this.padPressed.has(i) ? 1 : 0);
    return {
      dx: d(15) - d(14) || dxStick,
      dy: d(13) - d(12) || dyStick,
      confirm: this.padPressed.has(0),
      cancel: this.padPressed.has(1),
    };
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
    const nowDown = new Set();
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      padLive = true;
      /* EVERY button, not just the four the car reads. `pressed` covers the digital ones and the
       * 0.5 threshold covers analogue triggers, which report a value and never a clean press on
       * some pads. */
      for (let i = 0; i < p.buttons.length; i++) {
        const b = p.buttons[i];
        if (b && (b.pressed || b.value > 0.5)) nowDown.add(i);
      }
      // Kept for the Garage's own navigation - see padNav().
      this._navAxes = [p.axes[0] || 0, p.axes[1] || 0];
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
    /* The pad's EDGES, derived by comparison because a gamepad is polled and never fires an event. */
    this.padPressed = new Set([...nowDown].filter((b) => !this._padWas.has(b)));
    this.padDown = nowDown;
    this._padWas = nowDown;
    this.padLive = padLive;
    if (this.padPressed.size || Math.abs(gSteer) > 0.02 || gThrottle > 0.02 || gBrake > 0.02)
      this._lastDevice = 'gamepad';

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

    /* The plane's pitch axis. Read here so there is ONE place that turns keys into intent — the
     * same argument the file header makes for everything else — and simply ignored by the car. */
    s.pitchAxis = (this.held('pitchUp') ? 1 : 0) - (this.held('pitchDown') ? 1 : 0);

    return s;
  }

  /** Call at the very end of the frame. */
  endFrame() {
    this.pressed.clear();
    this.padPressed = new Set();
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
  ['P', 'fly (needs a plane — diamonds at sea)'],
  ['I / K', 'nose down / up, in the air'],
  ['F', 'pour in a spare fuel can'],
  ['Esc / M', 'garage'],
  ['H', 'horn'],
  ['1 2 3 4', 'assists: cruise / sport / off / hardcore'],
];
