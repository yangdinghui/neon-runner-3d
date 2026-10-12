/* =========================================================================
 * touch.js —— 移动端全屏手势操作
 *
 *   左右拨动  → 横向跑位（手指按住横向拖动，位移映射成世界坐标位移，松手停在原地）
 *   向上拨动  → 跳跃（连续两次上拨 = 二段跳）
 *   向下拨动  → 下趴滑铲；按住不放就一直趴着，松手起身（空中下滑 = 快速飞坠）
 *
 * 设计要点：
 *   · 全屏都是手势区，没有固定按钮，视野不被遮挡
 *   · 一帧内同时判定「横向」和「纵向」：横向用来转向，纵向用来触发动作，
 *     所以左手按住拨动转向的同时，右手上滑照样能跳（多点触控）
 *   · 纵向判定要求「纵向位移 > 横向位移 × verticalBias」，避免斜着拨动误触发跳跃
 *   · 手势可视化：手指处出现光环，转向变青色、触发动作变粉色并闪一下「跳 / 趴」
 * ========================================================================= */

class TouchControls {
  constructor() {
    this.enabled = !!Device.touch;

    // 暴露给 Game 的输入状态
    this.left = false;
    this.right = false;
    this.slideDown = false;
    this.steering = false;
    this.targetX = 0;
    this.currentX = 0;                       // 由 Game 每帧同步（转向基准点）
    this.trackHalf = CFG.track.width / 2;

    this._jumpQueue = 0;                     // 用队列而不是布尔，快速两拨不会丢帧
    this._slideQueue = 0;
    this._pointers = new Map();              // pointerId → 手势状态
    this._steerId = null;                    // 当前负责转向的手指
    this._baseX = 0;                         // 该手指按下时的角色位置
    this._holdDown = 0;                      // 按住「趴」的手指数量

    this.gain = 0.034;                       // 每像素对应的世界位移，按屏幕尺寸自适应
    this._updateGain();

    this.dom = document.getElementById('touch');
    this._dots = [];
    this._buildDots();
    if (this.dom) this._bind();
    window.addEventListener('resize', () => this._updateGain());
    window.addEventListener('orientationchange', () => this._updateGain());
  }

  get available() { return this.enabled && !!this.dom; }
  get visible() { return this.available && !this.dom.classList.contains('hidden'); }

  consumeJump() { if (this._jumpQueue > 0) { this._jumpQueue--; return true; } return false; }
  consumeSlide() { if (this._slideQueue > 0) { this._slideQueue--; return true; } return false; }

  setVisible(v) {
    if (!this.dom) return;
    const show = this.available && v;
    this.dom.classList.toggle('hidden', !show);
    if (show) {
      // 手势图例展示几秒后淡出，不长期占视野
      this.dom.classList.add('show');
      clearTimeout(this._legendT);
      this._legendT = setTimeout(() => this.dom.classList.remove('show'), 6500);
    } else {
      this.dom.classList.remove('show');
      this.reset();
    }
  }

  reset() {
    this.left = false; this.right = false;
    this.slideDown = false; this.steering = false;
    this._jumpQueue = 0; this._slideQueue = 0;
    this._holdDown = 0;
    this._steerId = null;
    this._pointers.clear();
    for (const d of this._dots) { d.el.classList.remove('on', 'steer', 'act', 'flash'); }
  }

  /* 拖动「屏幕短边的 62%」≈ 横跨整条赛道，横竖屏手感一致 */
  _updateGain() {
    const short = Math.min(window.innerWidth || 390, window.innerHeight || 844);
    const span = Math.max(140, short * (CFG.touch.dragSpanRatio || 0.62));
    this.gain = clamp((CFG.track.width * 0.92) / span, 0.02, CFG.touch.gainMax || 0.06);
  }

  /* ------------------------------------------------------------------ */
  _buildDots() {
    if (!this.dom) return;
    for (let i = 0; i < 3; i++) {
      const el = document.createElement('div');
      el.className = 'touch-dot';
      const label = document.createElement('span');
      label.className = 'dot-label';
      el.appendChild(label);
      this.dom.appendChild(el);
      this._dots.push({ el, label, id: null, free: true });
    }
  }

  _dotFor(pointerId) {
    const used = this._dots.find((d) => d.id === pointerId);
    if (used) return used;
    const free = this._dots.find((d) => d.free);
    if (!free) return null;
    free.free = false;
    free.id = pointerId;
    return free;
  }

  _releaseDot(pointerId) {
    const d = this._dots.find((k) => k.id === pointerId);
    if (!d) return;
    d.id = null; d.free = true;
    d.el.classList.remove('on', 'steer', 'act', 'flash');
  }

  _moveDot(dot, x, y) {
    if (!dot) return;
    dot.el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }

  /* ------------------------------------------------------------------ */
  _bind() {
    const surface = this.dom;

    surface.addEventListener('pointerdown', (e) => {
      // HUD 上的按钮不参与手势（按钮自己的 pointer-events 是 auto，正常会先命中它们）
      if (e.target && e.target.closest && e.target.closest('button, .screen, input, a')) return;
      e.preventDefault();
      if (this._pointers.has(e.pointerId)) return;

      const g = {
        id: e.pointerId,
        startX: e.clientX, startY: e.clientY,
        actionFired: false, holdingDown: false, steerOwner: false,
      };
      this._pointers.set(e.pointerId, g);
      try { surface.setPointerCapture(e.pointerId); } catch (err) {}

      const dot = this._dotFor(e.pointerId);
      g.dot = dot;
      this._moveDot(dot, e.clientX, e.clientY);
      if (dot) { dot.el.classList.add('on'); dot.label.textContent = ''; }
    });

    surface.addEventListener('pointermove', (e) => {
      const g = this._pointers.get(e.pointerId);
      if (!g) return;
      e.preventDefault();
      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;

      /* ---- 横向：转向 ---- */
      if (Math.abs(dx) > CFG.touch.deadZonePx) {
        const mine = this._steerId === null || this._steerId === e.pointerId;
        if (mine) {
          if (this._steerId !== e.pointerId) {
            this._steerId = e.pointerId;
            this._baseX = this.currentX;      // 以「接管瞬间」的角色位置为基准
            g.steerOwner = true;
          }
          this.steering = true;
          this.targetX = clamp(this._baseX + dx * this.gain, -this.trackHalf, this.trackHalf);
          const delta = this.targetX - this.currentX;
          this.left = delta < -0.04;
          this.right = delta > 0.04;
          if (g.dot) { g.dot.el.classList.add('steer'); g.dot.el.classList.remove('act'); }
        }
      }

      /* ---- 纵向：跳 / 趴 ---- */
      if (!g.actionFired && Math.abs(dy) > CFG.touch.swipePx &&
          Math.abs(dy) > Math.abs(dx) * CFG.touch.verticalBias) {
        g.actionFired = true;
        if (dy < 0) {
          this._jumpQueue++;
          this._flash(g, '跳', PAL.neonCyan);
        } else {
          this._slideQueue++;
          this._holdDown++;
          g.holdingDown = true;
          this.slideDown = true;
          this._flash(g, '趴', PAL.neonPink);
        }
      }

      this._moveDot(g.dot, e.clientX, e.clientY);
    });

    const end = (e) => {
      const g = this._pointers.get(e.pointerId);
      if (!g) return;
      e.preventDefault();
      if (g.holdingDown) { this._holdDown = Math.max(0, this._holdDown - 1); g.holdingDown = false; }
      if (this._holdDown === 0) this.slideDown = false;
      if (this._steerId === e.pointerId || g.steerOwner) {
        this._steerId = null;
        this.steering = false;
        this.left = false; this.right = false;
      }
      this._releaseDot(e.pointerId);
      this._pointers.delete(e.pointerId);
      try { this.dom.releasePointerCapture(e.pointerId); } catch (err) {}
    };
    surface.addEventListener('pointerup', end);
    surface.addEventListener('pointercancel', end);

    // 触屏上不要长按菜单 / 选中文字
    surface.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _flash(g, text, color) {
    const dot = g.dot;
    if (!dot) return;
    dot.label.textContent = text;
    dot.el.classList.add('flash');
    dot.el.classList.remove('steer');
    dot.el.classList.add('act');
    clearTimeout(dot._t);
    dot._t = setTimeout(() => {
      dot.el.classList.remove('flash');
      dot.label.textContent = '';
    }, 420);
  }

  _buzz(ms) {
    try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {}
  }

  /* 受击 / 死亡时的震动反馈（iOS 不支持，忽略即可） */
  impact(ms = 22) { this._buzz(ms); }
}
