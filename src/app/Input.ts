import type { GameRuntime } from './GameRuntime';

/**
 * Controls for the follow camera. WASD walks the manager relative to the camera (or pans the
 * camera once it is zoomed out past following); F (or the Use button) uses the thing in front of
 * the manager; Space scans at the till. The mouse: move over things to see what they are, left
 * click to walk there and use them (or place in build mode), right-drag to turn the camera (a plain right click cancels in Build),
 * the wheel to zoom. Q/E turn the camera in 45° steps, C brings it back to you, + and − zoom.
 * Touch: tap to walk or use, drag to turn, pinch to zoom.
 */
export class InputController {
  private keys = new Set<string>();
  private rightDrag: { x: number; y: number; moved: number } | null = null;
  private leftDown: { x: number; y: number; moved: boolean } | null = null;
  private lastDir = { x: 0, z: 0 };
  private scanHeld = false; private scanTimer = 0;
  private touches = new Map<number, { x: number; y: number; x0: number; y0: number }>();
  private pinch = 0;
  private touchMoved = false;
  private mouse: { x: number; y: number } | null = null;
  private detachFns: (() => void)[] = [];

  constructor(private readonly rt: GameRuntime, private readonly canvas: HTMLCanvasElement) {}

  attach(): void {
    const c = this.canvas;
    const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement | Window | Document, ev: K | string, fn: (e: never) => void, opts?: AddEventListenerOptions) => {
      el.addEventListener(ev, fn as EventListener, opts); this.detachFns.push(() => el.removeEventListener(ev, fn as EventListener, opts));
    };
    on(c, 'pointerdown', (e: PointerEvent) => {
      this.rt.audio.start();
      if (!this.rt.inPlay) return;
      if (e.pointerType === 'touch') { this.touchDown(e); return; }
      c.setPointerCapture(e.pointerId);
      if (e.button === 2) { this.rightDrag = { x: e.clientX, y: e.clientY, moved: 0 }; return; }
      if (e.button === 0) this.leftDown = { x: e.clientX, y: e.clientY, moved: false };
    });
    on(c, 'pointermove', (e: PointerEvent) => {
      if (e.pointerType === 'touch') { this.touchMove(e); return; }
      this.mouse = { x: e.clientX, y: e.clientY };
      this.rt.setMouse(e.clientX, e.clientY);
      if (!this.rt.inPlay) return;
      if (this.rightDrag) {
        const dx = e.clientX - this.rightDrag.x, dy = e.clientY - this.rightDrag.y;
        this.rightDrag = { x: e.clientX, y: e.clientY, moved: this.rightDrag.moved + Math.abs(dx) + Math.abs(dy) };
        this.rt.turnCamera(dx, dy);
        return;
      }
      if (this.leftDown && Math.hypot(e.clientX - this.leftDown.x, e.clientY - this.leftDown.y) > 6) this.leftDown.moved = true;
    });
    on(c, 'pointerleave', () => { this.mouse = null; this.rt.setMouse(null, null); });
    on(c, 'pointerup', (e: PointerEvent) => {
      if (e.pointerType === 'touch') { this.touchUp(e); return; }
      // A right click that did not turn the camera cancels placing or moving in Build.
      if (e.button === 2) { const d = this.rightDrag; this.rightDrag = null; if (d && d.moved < 6 && this.rt.inPlay) this.rt.secondary(); return; }
      const down = this.leftDown; this.leftDown = null;
      if (!down || down.moved || !this.rt.inPlay) return;
      this.rt.clickAt(e.clientX, e.clientY);
    });
    on(c, 'pointercancel', (e: PointerEvent) => { if (e.pointerType === 'touch') this.touchUp(e, true); this.rightDrag = null; this.leftDown = null; });
    on(c, 'contextmenu', (e: Event) => e.preventDefault());
    on(c, 'wheel', (e: WheelEvent) => { e.preventDefault(); if (this.rt.inPlay) this.rt.zoom(e.deltaY > 0 ? 1.18 : 1 / 1.18); }, { passive: false });
    on(window, 'keydown', (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const k = this.rt.settings.keys;
      this.keys.add(e.code);
      if (!this.rt.inPlay) return;
      if (e.code === k.scan) { e.preventDefault(); if (!this.scanHeld) { this.scanHeld = true; this.scanTimer = 0; this.rt.scanHere(); } return; }
      if (e.code === k.interact && !e.repeat) { this.rt.interact(); return; }
      if (e.code === k.turnLeft) { this.rt.turnStep(-1); return; }
      if (e.code === k.turnRight) { this.rt.turnStep(1); return; }
      if (e.code === k.focus) { this.rt.focusCamera(); return; }
      if (e.code === k.zoomIn || e.code === 'NumpadAdd') { this.rt.zoom(1 / 1.3); return; }
      if (e.code === k.zoomOut || e.code === 'NumpadSubtract') { this.rt.zoom(1.3); return; }
      if (e.code === 'Escape') { this.rt.escape(); return; }
      if (this.rt.card === 'build' || this.rt.build.placing) {
        if (e.code === k.rotate) { e.preventDefault(); this.rt.rotateGhost(); return; }
        if (e.code === 'Delete' || e.code === 'Backspace') { this.rt.sellSelected(); return; }
        if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); if (e.shiftKey) this.rt.redo(); else this.rt.undo(); return; }
        if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') { e.preventDefault(); this.rt.redo(); return; }
        if (e.code === 'KeyV' && this.rt.build.selectedId !== null) { this.rt.copySelected(); return; }
      }
      if (e.code === 'KeyB') { this.rt.openCard('build'); return; }
      if (e.code === 'Tab') { e.preventDefault(); this.rt.openCard('stock'); return; }
      if (e.code === k.pause) this.rt.togglePause();
      if (e.code === k.speed1) this.rt.setSpeed(1);
      if (e.code === k.speed2) this.rt.setSpeed(2);
      if (e.code === k.speed4) this.rt.setSpeed(4);
    });
    on(window, 'keyup', (e: KeyboardEvent) => { this.keys.delete(e.code); if (e.code === this.rt.settings.keys.scan) this.scanHeld = false; });
    on(window, 'blur', () => { this.keys.clear(); this.scanHeld = false; this.touches.clear(); this.rightDrag = null; });
  }

  /** Called every frame: walking (or panning), held scanning, edge pan. */
  update(dt: number): void {
    const r = this.rt.renderer;
    if (!r || !this.rt.inPlay) { this.lastDir = { x: 0, z: 0 }; return; }
    const k = this.rt.settings.keys;
    let f = 0, s = 0;
    const typing = (document.activeElement as HTMLElement | null)?.tagName === 'INPUT';
    if (!typing) {
      if (this.keys.has(k.forward) || this.keys.has('ArrowUp')) f += 1;
      if (this.keys.has(k.back) || this.keys.has('ArrowDown')) f -= 1;
      if (this.keys.has(k.right) || this.keys.has('ArrowRight')) s += 1;
      if (this.keys.has(k.left) || this.keys.has('ArrowLeft')) s -= 1;
    }
    const cam = r.follow;
    if (!cam.following) {
      // Zoomed out past following: the keys (and the screen edges) move the camera instead.
      let pf = f, ps = s;
      if (this.rt.settings.edgePan && this.mouse) {
        const m = 24, w = window.innerWidth, h = window.innerHeight;
        if (this.mouse.x < m) ps -= 1; else if (this.mouse.x > w - m) ps += 1;
        if (this.mouse.y < m + 60) pf += 1; else if (this.mouse.y > h - m) pf -= 1;
      }
      if (pf || ps) cam.pan(ps * dt * cam.distance * 0.9, pf * dt * cam.distance * 0.9);
      f = 0; s = 0;
    }
    let x = 0, z = 0;
    if (f || s) {
      const b = cam.basis();
      x = b.fx * f + b.rx * s; z = b.fz * f + b.rz * s;
      const l = Math.hypot(x, z); x /= l; z /= l;
    }
    // Only send a command when the direction really changes (turning the camera while walking does).
    if (Math.abs(x - this.lastDir.x) > 0.02 || Math.abs(z - this.lastDir.z) > 0.02) { this.lastDir = { x, z }; this.rt.move(x, z); }
    if (this.scanHeld) { this.scanTimer += dt; if (this.scanTimer > 0.25) { this.scanTimer = 0; this.rt.scanHere(true); } }
  }

  private touchDown(e: PointerEvent): void {
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY });
    if (this.touches.size === 1) this.touchMoved = false;
    if (this.touches.size === 2) { const [a, b] = [...this.touches.values()]; this.pinch = Math.hypot(a!.x - b!.x, a!.y - b!.y); this.touchMoved = true; }
  }
  private touchMove(e: PointerEvent): void {
    const t = this.touches.get(e.pointerId); if (!t) return;
    const dx = e.clientX - t.x, dy = e.clientY - t.y;
    t.x = e.clientX; t.y = e.clientY;
    if (this.touches.size >= 2) {
      // Pinch to zoom.
      const [a, b] = [...this.touches.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (this.pinch > 0 && d > 0) this.rt.zoom(this.pinch / d);
      this.pinch = d;
      return;
    }
    if (Math.hypot(e.clientX - t.x0, e.clientY - t.y0) > 10) this.touchMoved = true;
    // One finger dragging: turn the camera (or pan it, when zoomed right out).
    if (this.touchMoved) this.rt.touchDrag(dx, dy);
  }
  private touchUp(e: PointerEvent, cancel = false): void {
    const t = this.touches.get(e.pointerId);
    this.touches.delete(e.pointerId);
    if (this.touches.size < 2) this.pinch = 0;
    // A tap: walk there, use what is there, or place in build mode.
    if (t && !cancel && !this.touchMoved && this.touches.size === 0) this.rt.clickAt(e.clientX, e.clientY);
  }

  detach(): void { for (const fn of this.detachFns) fn(); this.detachFns = []; }
}
