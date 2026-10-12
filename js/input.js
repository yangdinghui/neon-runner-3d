/* =========================================================================
 * input.js —— 键盘输入（含边沿触发与按键持续状态）
 * ========================================================================= */

class InputManager {
  constructor() {
    this.state = {};
    this.pressed = {};        // 本帧刚按下
    this.released = {};       // 本帧刚抬起
    this.anyKeyHandlers = [];
    this.enabled = true;

    this.map = {
      ArrowLeft: 'left', KeyA: 'left',
      ArrowRight: 'right', KeyD: 'right',
      ArrowUp: 'jump', KeyW: 'jump', Space: 'jump',
      ArrowDown: 'slide', KeyS: 'slide', ShiftLeft: 'slide', ShiftRight: 'slide',
      KeyP: 'pause', Escape: 'pause',
      KeyR: 'restart',
      KeyM: 'mute',
      KeyL: 'leaderboard',
      Enter: 'confirm',
    };
    // 需要阻止默认行为的键（避免页面滚动）
    this.block = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'ShiftLeft', 'ShiftRight']);

    window.addEventListener('keydown', (e) => {
      // 在输入框里打字时不要触发游戏操作
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) && e.code !== 'Escape') {
        return;
      }
      if (this.block.has(e.code)) e.preventDefault();
      if (e.repeat) { return; }
      const a = this.map[e.code];
      this._fireAnyKey(e);
      if (!a || !this.enabled) return;
      if (!this.state[a]) this.pressed[a] = true;
      this.state[a] = true;
      if (e.code === 'Space' || e.code === 'Enter') this.pressed[a] = true;
    });

    window.addEventListener('keyup', (e) => {
      const a = this.map[e.code];
      if (!a) return;
      this.state[a] = false;
      this.released[a] = true;
    });

    window.addEventListener('blur', () => this.clear());
  }

  onAnyKey(fn) { this.anyKeyHandlers.push(fn); }
  _fireAnyKey(e) { for (const fn of this.anyKeyHandlers) fn(e); }

  isDown(a) { return !!this.state[a]; }
  wasPressed(a) { return !!this.pressed[a]; }
  wasReleased(a) { return !!this.released[a]; }

  /* 每帧末尾调用，清掉边沿标记 */
  endFrame() {
    this.pressed = {};
    this.released = {};
  }

  clear() {
    this.state = {};
    this.pressed = {};
    this.released = {};
  }
}
