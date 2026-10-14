import type { GameRuntime } from './GameRuntime';

/**
 * First-person controls. Mouse look under pointer lock (drag to look when the lock is refused),
 * WASD to walk, E or left click to use what the crosshair points at, Space to scan at the till.
 * On touch screens the left half of the screen is a walking stick and the right half looks;
 * a tap uses what you point at.
 */
export class InputController {
  private keys = new Set<string>();
  private locked = false;
  private dragging = false; private moved = false;
  private downX = 0; private downY = 0; private lastX = 0; private lastY = 0;
  private lastDir = { x: 0, z: 0 };
  private scanHeld = false; private scanTimer = 0;
  /** Touch: one finger walks (left half), one looks (right half). */
  private stick: { id: number; x0: number; y0: number; x: number; y: number } | null = null;
  private lookTouch: { id: number; x: number; y: number; moved: boolean } | null = null;
  private detachFns: (() => void)[] = [];

  constructor(private readonly rt: GameRuntime, private readonly canvas: HTMLCanvasElement) {}

  attach(): void {
    const c = this.canvas;
    const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement | Window | Document, ev: K | string, fn: (e: never) => void, opts?: AddEventListenerOptions) => {
      el.addEventListener(ev, fn as EventListener, opts); this.detachFns.push(() => el.removeEventListener(ev, fn as EventListener, opts));
    };
    on(c, 'pointerdown', (e: PointerEvent) => {
      this.rt.audio.start();
      if (!this.rt.inFirstPerson) return;
      if (e.pointerType === 'touch') { this.touchDown(e); return; }
      if (this.locked) {
        if (e.button === 0) this.rt.interact();
        else if (e.button === 2) this.rt.secondary();
        return;
      }
      c.setPointerCapture(e.pointerId);
      this.dragging = true; this.moved = false;
      this.downX = this.lastX = e.clientX; this.downY = this.lastY = e.clientY;
    });
    on(c, 'pointermove', (e: PointerEvent) => {
      if (!this.rt.inFirstPerson) return;
      if (e.pointerType === 'touch') { this.touchMove(e); return; }
      if (this.locked) { this.rt.look(e.movementX, e.movementY); return; }
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX, dy = e.clientY - this.lastY;
      this.lastX = e.clientX; this.lastY = e.clientY;
      if (Math.hypot(e.clientX - this.downX, e.clientY - this.downY) > 5) this.moved = true;
      if (this.moved) this.rt.look(dx * 1.6, dy * 1.6);
    });
    on(c, 'pointerup', (e: PointerEvent) => {
      if (e.pointerType === 'touch') { this.touchUp(e); return; }
      const was = this.dragging; this.dragging = false;
      if (!was || this.moved || !this.rt.inFirstPerson) return;
      if (e.button === 2) { this.rt.secondary(); return; }
      if (e.button !== 0) return;
      // A plain click: take the mouse for looking. If the browser refuses, act on the crosshair instead.
      if (!this.rt.requestLock()) this.rt.interact();
    });
    on(c, 'pointercancel', (e: PointerEvent) => { if (e.pointerType === 'touch') this.touchUp(e); this.dragging = false; });
    on(c, 'contextmenu', (e: Event) => e.preventDefault());
    on(c, 'wheel', (e: WheelEvent) => { e.preventDefault(); if (this.rt.build.placing || this.rt.build.selectedId !== null) this.rt.rotateGhost(e.deltaY > 0 ? 1 : -1); }, { passive: false });
    on(document, 'pointerlockchange', () => { this.locked = document.pointerLockElement === c; this.rt.setLocked(this.locked); if (!this.locked) this.keys.clear(); });
    on(window, 'keydown', (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const k = this.rt.settings.keys;
      this.keys.add(e.code);
      if (!this.rt.inFirstPerson) return;
      if (e.code === k.scan) { e.preventDefault(); if (!this.scanHeld) { this.scanHeld = true; this.scanTimer = 0; this.rt.scanHere(); } return; }
      if (e.code === k.interact && !e.repeat) { this.rt.interact(); return; }
      if (e.code === 'Escape') { this.rt.closeCard(); return; }
      if (this.rt.card === 'build' || this.rt.build.placing) {
        if (e.code === k.rotate) { e.preventDefault(); this.rt.rotateGhost(); return; }
        if (e.code === 'Delete' || e.code === 'Backspace') { this.rt.sellSelected(); return; }
        if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); if (e.shiftKey) this.rt.redo(); else this.rt.undo(); return; }
        if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') { e.preventDefault(); this.rt.redo(); return; }
        if (e.code === 'KeyC' && this.rt.build.selectedId !== null) { this.rt.copySelected(); return; }
      }
      if (e.code === 'KeyB') { this.rt.openCard('build'); return; }
      if (e.code === 'Tab') { e.preventDefault(); this.rt.openCard('stock'); return; }
      if (e.code === k.pause) this.rt.togglePause();
      if (e.code === k.speed1) this.rt.setSpeed(1);
      if (e.code === k.speed2) this.rt.setSpeed(2);
      if (e.code === k.speed4) this.rt.setSpeed(4);
    });
    on(window, 'keyup', (e: KeyboardEvent) => { this.keys.delete(e.code); if (e.code === this.rt.settings.keys.scan) this.scanHeld = false; });
    on(window, 'blur', () => { this.keys.clear(); this.scanHeld = false; this.stick = null; });
  }

  /** Called every frame: walking, arrow-key turning and held scanning. */
  update(dt: number): void {
    const r = this.rt.renderer;
    if (!r || !this.rt.inFirstPerson) { this.lastDir = { x: 0, z: 0 }; return; }
    const k = this.rt.settings.keys;
    let f = 0, s = 0;
    const typing = (document.activeElement as HTMLElement | null)?.tagName === 'INPUT';
    if (!typing) {
      if (this.keys.has(k.forward) || this.keys.has('ArrowUp')) f += 1;
      if (this.keys.has(k.back) || this.keys.has('ArrowDown')) f -= 1;
      if (this.keys.has(k.right)) s += 1;
      if (this.keys.has(k.left)) s -= 1;
      if (this.keys.has('ArrowLeft')) this.rt.look(-520 * dt, 0);
      if (this.keys.has('ArrowRight')) this.rt.look(520 * dt, 0);
    }
    if (this.stick) {
      const dx = (this.stick.x - this.stick.x0) / 50, dy = (this.stick.y - this.stick.y0) / 50;
      if (Math.hypot(dx, dy) > 0.2) { s += Math.max(-1, Math.min(1, dx)); f -= Math.max(-1, Math.min(1, dy)); }
    }
    let x = 0, z = 0;
    if (f || s) {
      const b = r.fp.basis();
      x = b.fx * f + b.rx * s; z = b.fz * f + b.rz * s;
      const l = Math.hypot(x, z); x /= l; z /= l;
    }
    // Only send a command when the direction really changes (turning while walking does).
    if (Math.abs(x - this.lastDir.x) > 0.02 || Math.abs(z - this.lastDir.z) > 0.02) { this.lastDir = { x, z }; this.rt.move(x, z); }
    if (this.scanHeld) { this.scanTimer += dt; if (this.scanTimer > 0.25) { this.scanTimer = 0; this.rt.scanHere(true); } }
  }

  private touchDown(e: PointerEvent): void {
    if (e.clientX < window.innerWidth * 0.45 && !this.stick) this.stick = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
    else if (!this.lookTouch) this.lookTouch = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
  }
  private touchMove(e: PointerEvent): void {
    if (this.stick?.id === e.pointerId) { this.stick.x = e.clientX; this.stick.y = e.clientY; return; }
    const t = this.lookTouch; if (!t || t.id !== e.pointerId) return;
    const dx = e.clientX - t.x, dy = e.clientY - t.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) t.moved = true;
    t.x = e.clientX; t.y = e.clientY;
    this.rt.look(dx * 2.2, dy * 2.2);
  }
  private touchUp(e: PointerEvent): void {
    if (this.stick?.id === e.pointerId) { const tap = Math.hypot(this.stick.x - this.stick.x0, this.stick.y - this.stick.y0) < 8; this.stick = null; if (tap) this.rt.interact(); return; }
    if (this.lookTouch?.id === e.pointerId) { const tap = !this.lookTouch.moved; this.lookTouch = null; if (tap) this.rt.interact(); }
  }

  detach(): void { for (const fn of this.detachFns) fn(); this.detachFns = []; }
}
