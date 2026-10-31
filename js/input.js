// Touch / mouse input: one-finger pan (or a captured drag), pinch zoom, tap, mouse wheel, hover.

export class Input {
  constructor(el, renderer, handlers) {
    this.el = el;
    this.r = renderer;
    this.h = handlers;
    this.pointers = new Map();
    this.panning = false;
    this.pinch = null;
    this.downAt = null;
    this.dragging = false;   // a handler captured the one-finger drag (e.g. moving an aim reticle) instead of panning

    el.addEventListener('pointerdown', e => this.down(e));
    el.addEventListener('pointermove', e => this.move(e));
    el.addEventListener('pointerup', e => this.up(e));
    el.addEventListener('pointercancel', e => this.cancel(e));
    el.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') this.h.hover && this.h.hover(null); });
    el.addEventListener('wheel', e => {
      e.preventDefault();
      const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      this.r.zoomAt(e.clientX, e.clientY, f);
    }, { passive: false });
    // iOS Safari gesture events (prevent page zoom)
    for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
      document.addEventListener(ev, e => e.preventDefault(), { passive: false });
    }
  }

  down(e) {
    this.el.setPointerCapture && this.el.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) {
      this.downAt = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, type: e.pointerType };
      this.panning = false;
      this.dragging = false;
    } else if (this.pointers.size === 2) {
      if (this.dragging) { this.dragging = false; this.h.dragEnd && this.h.dragEnd(); }
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      this.downAt = null;
    }
  }

  move(e) {
    if (e.pointerType === 'mouse' && this.pointers.size === 0) {
      this.h.hover && this.h.hover({ x: e.clientX, y: e.clientY });
      return;
    }
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (this.pointers.size >= 2 && this.pinch) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      if (this.pinch.d > 0) this.r.zoomAt(cx, cy, d / this.pinch.d);
      this.r.pan(cx - this.pinch.cx, cy - this.pinch.cy);
      this.pinch = { d, cx, cy };
      return;
    }
    if (this.downAt && !this.panning && !this.dragging) {
      const moved = Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y);
      if (moved > 9) {
        if (this.h.dragStart && this.h.dragStart(this.downAt)) this.dragging = true;
        else this.panning = true;
      }
    }
    if (this.dragging) { this.h.drag && this.h.drag({ x: e.clientX, y: e.clientY }); return; }
    if (this.panning) this.r.pan(dx, dy);
    if (e.pointerType === 'mouse') this.h.hover && this.h.hover({ x: e.clientX, y: e.clientY });
  }

  up(e) {
    const had = this.pointers.has(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (!had) return;
    if (this.pointers.size < 2) this.pinch = null;
    if (this.dragging && this.downAt && this.downAt.id === e.pointerId) { this.dragging = false; this.h.dragEnd && this.h.dragEnd(); }
    else if (this.downAt && this.downAt.id === e.pointerId && !this.panning) {
      const dt = performance.now() - this.downAt.t;
      if (dt < 600) this.h.tap && this.h.tap({ x: e.clientX, y: e.clientY, type: this.downAt.type });
    }
    if (this.pointers.size === 0) { this.downAt = null; this.panning = false; }
  }

  cancel(e) {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.pointers.size === 0) { this.downAt = null; this.panning = false; if (this.dragging) { this.dragging = false; this.h.dragEnd && this.h.dragEnd(); } }
  }
}
