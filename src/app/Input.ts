import type { GameRuntime } from './GameRuntime';

/** Pointer and keyboard handling for the canvas: pan, zoom, rotate, click to pick, edge pan. */
export class InputController {
  private dragging: 'none' | 'pan' | 'rotate' = 'none';
  private downX = 0; private downY = 0; private lastX = 0; private lastY = 0; private moved = false;
  private keys = new Set<string>();
  private pinchDist = 0;
  private pointerX = -1; private pointerY = -1;
  private scanHeld = false; private scanTimer = 0;
  private detachFns: (() => void)[] = [];

  constructor(private readonly rt: GameRuntime, private readonly canvas: HTMLCanvasElement) {}

  attach(): void {
    const c = this.canvas;
    const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement | Window, ev: K | string, fn: (e: never) => void, opts?: AddEventListenerOptions) => {
      el.addEventListener(ev, fn as EventListener, opts); this.detachFns.push(() => el.removeEventListener(ev, fn as EventListener, opts));
    };
    on(c, 'pointerdown', (e: PointerEvent) => {
      this.rt.audio.start();
      c.setPointerCapture(e.pointerId);
      this.downX = this.lastX = e.clientX; this.downY = this.lastY = e.clientY; this.moved = false;
      this.dragging = e.button === 2 ? 'rotate' : 'pan';
      if (e.button === 1) this.dragging = 'pan';
    });
    on(c, 'pointermove', (e: PointerEvent) => {
      this.pointerX = e.clientX; this.pointerY = e.clientY;
      if (this.dragging === 'none') return;
      const dx = e.clientX - this.lastX, dy = e.clientY - this.lastY;
      this.lastX = e.clientX; this.lastY = e.clientY;
      if (Math.hypot(e.clientX - this.downX, e.clientY - this.downY) > 5) this.moved = true;
      const cam = this.rt.renderer?.camera; if (!cam) return;
      if (this.dragging === 'pan' && this.moved) {
        const k = cam.goalDistance / c.clientHeight * 1.15;
        cam.pan(-dx * k, -dy * k);
      } else if (this.dragging === 'rotate') cam.rotate(-dx * 0.006, -dy * 0.004);
    });
    on(c, 'pointerup', (e: PointerEvent) => {
      const was = this.dragging; this.dragging = 'none';
      if (was === 'pan' && !this.moved && e.button === 0) this.click(e.clientX, e.clientY);
    });
    on(c, 'pointerleave', () => { this.pointerX = -1; this.pointerY = -1; });
    on(c, 'contextmenu', (e: Event) => e.preventDefault());
    on(c, 'wheel', (e: WheelEvent) => { e.preventDefault(); this.rt.renderer?.camera.zoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
    on(c, 'touchstart', (e: TouchEvent) => { if (e.touches.length === 2) this.pinchDist = touchDist(e); }, { passive: true });
    on(c, 'touchmove', (e: TouchEvent) => {
      if (e.touches.length === 2) { const d = touchDist(e); if (this.pinchDist > 0) this.rt.renderer?.camera.zoom(this.pinchDist / d); this.pinchDist = d; }
    }, { passive: true });
    on(window, 'keydown', (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      const k = this.rt.settings.keys;
      this.keys.add(e.code);
      if (e.code === k.scan) { e.preventDefault(); if (!this.scanHeld) { this.scanHeld = true; this.scanTimer = 0; this.rt.scan(); } }
      if (e.code === 'Escape') this.rt.closeCard();
      if (e.code === k.focus) this.rt.focusStore();
      if (e.code === k.pause) this.rt.togglePause();
      if (e.code === k.speed1) this.rt.setSpeed(1);
      if (e.code === k.speed2) this.rt.setSpeed(2);
      if (e.code === k.speed4) this.rt.setSpeed(4);
    });
    on(window, 'keyup', (e: KeyboardEvent) => { this.keys.delete(e.code); if (e.code === this.rt.settings.keys.scan) this.scanHeld = false; });
    on(window, 'blur', () => { this.keys.clear(); this.scanHeld = false; });
  }

  /** Called every frame for held keys and edge panning. */
  update(dt: number): void {
    const cam = this.rt.renderer?.camera; if (!cam) return;
    const k = this.rt.settings.keys;
    const speed = cam.goalDistance * 0.9 * dt;
    let dx = 0, dz = 0;
    if (this.keys.has(k.panUp) || this.keys.has('ArrowUp')) dz -= 1;
    if (this.keys.has(k.panDown) || this.keys.has('ArrowDown')) dz += 1;
    if (this.keys.has(k.panLeft) || this.keys.has('ArrowLeft')) dx -= 1;
    if (this.keys.has(k.panRight) || this.keys.has('ArrowRight')) dx += 1;
    if (this.keys.has(k.rotateLeft)) cam.rotate(1.6 * dt, 0);
    if (this.keys.has(k.rotateRight)) cam.rotate(-1.6 * dt, 0);
    if (this.keys.has('KeyR')) cam.rotate(0, 0.8 * dt);
    if (this.keys.has('KeyT')) cam.rotate(0, -0.8 * dt);
    if (this.rt.settings.edgePan && this.pointerX >= 0 && this.dragging === 'none' && !this.rt.card && document.hasFocus()) {
      const m = 14, w = window.innerWidth, h = window.innerHeight;
      if (this.pointerX < m) dx -= 1; else if (this.pointerX > w - m) dx += 1;
      if (this.pointerY < m + 56) { /* top bar: no pan */ } else if (this.pointerY > h - m) dz += 1;
    }
    if (dx || dz) { const l = Math.hypot(dx, dz); cam.pan((dx / l) * speed, (dz / l) * speed); }
    if (this.scanHeld) { this.scanTimer += dt; if (this.scanTimer > 0.25) { this.scanTimer = 0; this.rt.scan(); } }
  }

  private click(x: number, y: number): void {
    const s = this.rt.state; const r = this.rt.renderer;
    if (!s || !r) return;
    const hit = r.pick(x, y, s);
    if (hit && hit.kind === 'fixture') {
      const f = s.shop.fixtures.find((fx) => fx.id === hit.id);
      if (f) this.rt.clickFixture(f);
    }
  }

  detach(): void { for (const fn of this.detachFns) fn(); this.detachFns = []; }
}

function touchDist(e: TouchEvent): number {
  const a = e.touches[0]!, b = e.touches[1]!;
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}
