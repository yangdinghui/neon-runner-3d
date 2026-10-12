/* =========================================================================
 * touch.js —— 移动端触屏操作
 *
 * 布局（双拇指）：
 *   左手：转向摇杆（按住横向拖动 = 相对当前位置左右移动，松手即停）
 *   右手：大号「跳」按钮（连点两次 = 二段跳）+「滑」按钮（按住滑铲 / 空中飞坠）
 *
 * 输入状态合并进 InputManager 的语义：left / right / jumpPressed / slidePressed / slideDown，
 * 额外提供一个 targetX（绝对目标位置），由 Player 用「跟随目标」的方式解算，手感比按键更跟手。
 * ========================================================================= */

class TouchControls {
  constructor() {
    this.enabled = !!Device.touch;
    this.left = false;
    this.right = false;
    this.slideDown = false;
    this.steering = false;
    this.targetX = 0;
    this.currentX = 0;      // 由 Game 每帧同步（转向基准点）
    this.trackHalf = CFG.track.width / 2;

    this._jumpPressed = false;
    this._slidePressed = false;
    this._padId = null;
    this._padStartX = 0;
    this._padBaseX = 0;

    this.dom = document.getElementById('touch');
    this.pad = document.getElementById('pad-steer');
    this.knob = document.getElementById('pad-knob');
    this.arrows = document.getElementById('pad-arrows');
    this.btnJump = document.getElementById('btn-touch-jump');
    this.btnSlide = document.getElementById('btn-touch-slide');

    if (this.dom) this._bind();
  }

  get available() { return this.enabled && !!this.dom; }
  get visible() { return this.available && !this.dom.classList.contains('hidden'); }

  /* 边沿触发：取一次就清掉，等价于键盘的 wasPressed */
  consumeJump() { const v = this._jumpPressed; this._jumpPressed = false; return v; }
  consumeSlide() { const v = this._slidePressed; this._slidePressed = false; return v; }

  setVisible(v) {
    if (!this.dom) return;
    const show = this.available && v;
    this.dom.classList.toggle('hidden', !show);
    if (!show) this.reset();
  }

  reset() {
    this.left = false; this.right = false;
    this.slideDown = false; this.steering = false;
    this._padId = null;
    this._jumpPressed = false; this._slidePressed = false;
    if (this.knob) this.knob.style.transform = 'translate(-50%, -50%)';
    if (this.btnSlide) this.btnSlide.classList.remove('pressed');
    if (this.btnJump) this.btnJump.classList.remove('pressed');
    if (this.arrows) this.arrows.className = 'pad-arrows';
  }

  /* ------------------------------------------------------------------ */
  _bind() {
    const stop = (e) => { e.preventDefault(); e.stopPropagation(); };

    /* ---- 转向摇杆 ---- */
    const pad = this.pad;
    if (pad) {
      pad.addEventListener('pointerdown', (e) => {
        stop(e);
        if (this._padId !== null) return;
        this._padId = e.pointerId;
        this._padStartX = e.clientX;
        this._padBaseX = this.currentX;
        this.steering = true;
        try { pad.setPointerCapture(e.pointerId); } catch (err) {}
        pad.classList.add('active');
        this._updatePad(e.clientX);
        this._buzz(8);
      });
      pad.addEventListener('pointermove', (e) => {
        if (e.pointerId !== this._padId) return;
        stop(e);
        this._updatePad(e.clientX);
      });
      const end = (e) => {
        if (e.pointerId !== this._padId) return;
        stop(e);
        this._padId = null;
        this.steering = false;
        this.left = false; this.right = false;
        pad.classList.remove('active');
        try { pad.releasePointerCapture(e.pointerId); } catch (err) {}
        if (this.knob) this.knob.style.transform = 'translate(-50%, -50%)';
        if (this.arrows) this.arrows.className = 'pad-arrows';
      };
      pad.addEventListener('pointerup', end);
      pad.addEventListener('pointercancel', end);
      pad.addEventListener('lostpointercapture', end);
    }

    /* ---- 跳 ---- */
    if (this.btnJump) {
      this.btnJump.addEventListener('pointerdown', (e) => {
        stop(e);
        this._jumpPressed = true;
        this._jumpHeld = true;
        this.btnJump.classList.add('pressed');
        this._buzz(10);
      });
      const up = (e) => { stop(e); this._jumpHeld = false; this.btnJump.classList.remove('pressed'); };
      this.btnJump.addEventListener('pointerup', up);
      this.btnJump.addEventListener('pointercancel', up);
      this.btnJump.addEventListener('pointerleave', up);
    }

    /* ---- 滑铲 / 飞坠 ---- */
    if (this.btnSlide) {
      this.btnSlide.addEventListener('pointerdown', (e) => {
        stop(e);
        this.slideDown = true;
        this._slidePressed = true;
        this.btnSlide.classList.add('pressed');
        this._buzz(8);
      });
      const up = (e) => {
        stop(e);
        this.slideDown = false;
        this.btnSlide.classList.remove('pressed');
      };
      this.btnSlide.addEventListener('pointerup', up);
      this.btnSlide.addEventListener('pointercancel', up);
      this.btnSlide.addEventListener('pointerleave', up);
    }

    // 触屏上不要弹出长按菜单 / 选中文字
    this.dom.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _updatePad(clientX) {
    const dx = clientX - this._padStartX;
    const gain = CFG.touch.dragGain;
    this.targetX = clamp(this._padBaseX + dx * gain, -this.trackHalf, this.trackHalf);

    // 方向指示（用于角色倾斜动画，也让玩家看到自己压住了哪一侧）
    const delta = this.targetX - this.currentX;
    this.left = delta < -CFG.touch.dragGain * 6;
    this.right = delta > CFG.touch.dragGain * 6;

    if (this.knob) {
      const k = clamp(dx, -CFG.touch.maxDragPx, CFG.touch.maxDragPx);
      this.knob.style.transform = `translate(calc(-50% + ${k}px), -50%)`;
    }
    if (this.arrows) {
      this.arrows.className = 'pad-arrows' + (this.left ? ' go-left' : '') + (this.right ? ' go-right' : '');
    }
  }

  _buzz(ms) {
    try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {}
  }

  /* 受击 / 死亡时的震动反馈（iOS 不支持，忽略即可） */
  impact(ms = 22) { this._buzz(ms); }
}
