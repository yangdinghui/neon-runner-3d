/* =========================================================================
 * audio.js —— 纯 WebAudio 程序化音频（零音频文件）
 *   · SFX：跳跃 / 落地 / 滑铲 / 拾取（连击音阶上行）/ 受击 / 结算
 *   · BGM：马卡龙电子小调性循环，速度越快节奏越密（intensity 0~1）
 * ========================================================================= */

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this.musicPlaying = false;
    this.intensity = 0;

    this.master = null;
    this.sfxBus = null;
    this.musicBus = null;
    this.delay = null;

    this._timer = null;
    this._nextNoteTime = 0;
    this._step = 0;
    this._bar = 0;
    this._bpm = 112;

    // D 大调五声音阶（清新、无半音紧张感）
    this.scale = [293.66, 329.63, 369.99, 440.00, 493.88, 587.33, 659.25, 739.99, 880.00];
    this.bassNotes = [73.42, 110.00, 123.47, 98.00];   // D A B G
    this.chords = [
      [293.66, 369.99, 440.00],
      [329.63, 415.30, 493.88],
      [369.99, 440.00, 587.33],
      [293.66, 392.00, 493.88],
    ];
  }

  /* 必须在用户手势里调用一次 */
  unlock() {
    if (this.ready) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : 0.85;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 22;
    comp.ratio.value = 3;
    comp.attack.value = 0.005;
    comp.release.value = 0.22;

    master.connect(comp);
    comp.connect(ctx.destination);

    const sfx = ctx.createGain(); sfx.gain.value = 0.85; sfx.connect(master);
    const music = ctx.createGain(); music.gain.value = 0.34; music.connect(master);

    // 回声总线：让琶音有空间感
    const delay = ctx.createDelay(1.0);
    delay.delayTime.value = 60 / this._bpm / 2;
    const fb = ctx.createGain(); fb.gain.value = 0.26;
    const dw = ctx.createGain(); dw.gain.value = 0.34;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
    delay.connect(fb); fb.connect(delay);
    delay.connect(dw); dw.connect(music); dw.connect(lp);
    lp.connect(master);

    this.master = master; this.sfxBus = sfx; this.musicBus = music; this.delay = delay;
    this.ready = true;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.linearRampToValueAtTime(m ? 0 : 0.85, this.ctx.currentTime + 0.13);
    }
  }

  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  /* ---------------- 基础乐器 ---------------- */
  tone(o = {}) {
    if (!this.ready) return;
    const ctx = this.ctx, t0 = ctx.currentTime + (o.at ?? 0);
    const dur = o.dur ?? 0.25;
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'triangle';
    osc.frequency.setValueAtTime(o.f0 ?? 440, t0);
    if (o.f1 && o.f1 !== o.f0) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t0 + (o.sweep ?? dur));
    }
    const g = ctx.createGain();
    const peak = o.gain ?? 0.2;
    const atk = o.attack ?? 0.006;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    let node = osc;
    if (o.filter) {
      const f = ctx.createBiquadFilter();
      f.type = o.filter;
      f.frequency.value = o.fc ?? 1200;
      f.Q.value = o.q ?? 1;
      node.connect(f); node = f;
    }
    node.connect(g);
    g.connect(o.bus ?? this.sfxBus);
    if (o.delay) { const d = ctx.createGain(); d.gain.value = o.delay; g.connect(d); d.connect(this.delay); }
    osc.start(t0); osc.stop(t0 + dur + 0.05);
  }

  noise(o = {}) {
    if (!this.ready) return;
    const ctx = this.ctx, t0 = ctx.currentTime + (o.at ?? 0);
    const dur = o.dur ?? 0.2;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = o.filter ?? 'bandpass';
    f.frequency.setValueAtTime(o.f0 ?? 1200, t0);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(Math.max(60, o.f1), t0 + dur);
    f.Q.value = o.q ?? 1.1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(o.gain ?? 0.14, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(o.bus ?? this.sfxBus);
    src.start(t0); src.stop(t0 + dur + 0.02);
  }

  /* ---------------- 音效 ---------------- */
  jump()      { this.tone({ type: 'triangle', f0: 330, f1: 700, dur: 0.17, gain: 0.17, sweep: 0.13 });
                this.noise({ f0: 900, f1: 2600, dur: 0.1, gain: 0.06, filter: 'highpass' }); }
  doubleJump(){ this.tone({ type: 'triangle', f0: 520, f1: 1080, dur: 0.19, gain: 0.15, sweep: 0.15 });
                this.tone({ type: 'sine', f0: 1040, f1: 1900, dur: 0.14, gain: 0.07, sweep: 0.12 }); }
  land()      { this.tone({ type: 'sine', f0: 190, f1: 70, dur: 0.13, gain: 0.2, sweep: 0.12, filter: 'lowpass', fc: 700 });
                this.noise({ f0: 500, f1: 180, dur: 0.1, gain: 0.08 }); }
  slide()     { this.noise({ f0: 700, f1: 2900, dur: 0.3, gain: 0.1, filter: 'bandpass', q: 0.9 });
                this.noise({ f0: 2200, f1: 900, dur: 0.26, gain: 0.05, filter: 'highpass' }); }

  pickup(level = 0) {
    const n = this.scale[Math.min(this.scale.length - 1, 2 + (level % 7))];
    this.tone({ type: 'sine', f0: n, dur: 0.16, gain: 0.16, delay: 0.28 });
    this.tone({ type: 'sine', f0: n * 2.01, dur: 0.1, gain: 0.05 });
  }
  bigPickup(level = 0) {
    const n = this.scale[Math.min(this.scale.length - 1, 3 + (level % 5))];
    [0, 0.055, 0.11].forEach((at, i) => {
      this.tone({ type: 'sine', f0: n * (1 + i * 0.25), dur: 0.34, gain: 0.14, at, delay: 0.4 });
    });
    this.noise({ f0: 3000, f1: 6000, dur: 0.22, gain: 0.05, filter: 'highpass' });
  }
  combo(level) {
    this.tone({ type: 'triangle', f0: 660 * Math.pow(1.12, level), dur: 0.12, gain: 0.1 });
  }
  hit() {
    this.tone({ type: 'sawtooth', f0: 260, f1: 55, dur: 0.4, gain: 0.22, sweep: 0.36, filter: 'lowpass', fc: 1400, q: 3 });
    this.noise({ f0: 1800, f1: 200, dur: 0.3, gain: 0.16, filter: 'bandpass', q: 0.7 });
  }
  shieldBreak() {
    this.tone({ type: 'square', f0: 900, f1: 220, dur: 0.28, gain: 0.1, sweep: 0.24, filter: 'lowpass', fc: 2400 });
    this.noise({ f0: 4000, f1: 1200, dur: 0.26, gain: 0.09, filter: 'highpass' });
  }
  gameOver() {
    const seq = [587.33, 493.88, 440.00, 293.66];
    seq.forEach((f, i) => this.tone({ type: 'triangle', f0: f, dur: 0.42, gain: 0.15, at: i * 0.16, delay: 0.25 }));
    this.noise({ f0: 2000, f1: 120, dur: 1.1, gain: 0.1, filter: 'lowpass', at: 0.1 });
  }
  record() {
    const seq = [587.33, 739.99, 880.00, 1174.66];
    seq.forEach((f, i) => {
      this.tone({ type: 'triangle', f0: f, dur: 0.3, gain: 0.15, at: i * 0.11 });
      this.tone({ type: 'sine', f0: f * 2, dur: 0.2, gain: 0.05, at: i * 0.11 });
    });
    this.noise({ f0: 4000, f1: 8000, dur: 0.5, gain: 0.05, filter: 'highpass', at: 0.33 });
  }
  ui()    { this.tone({ type: 'sine', f0: 720, f1: 980, dur: 0.09, gain: 0.11, sweep: 0.07 }); }
  start() { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
              this.tone({ type: 'triangle', f0: f, dur: 0.26, gain: 0.14, at: i * 0.075 })); }

  /* ---------------- BGM ---------------- */
  startMusic() {
    if (!this.ready || this.musicPlaying) return;
    this.musicPlaying = true;
    this._step = 0;
    this._bar = 0;
    this._nextNoteTime = this.ctx.currentTime + 0.08;
    this._schedule();
    this._timer = setInterval(() => this._schedule(), 45);
  }

  stopMusic() {
    this.musicPlaying = false;
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }

  setIntensity(v) { this.intensity = clamp(v, 0, 1); }

  _schedule() {
    if (!this.musicPlaying || !this.ready) return;
    const ctx = this.ctx;
    const look = 0.16;
    this._bpm = 108 + this.intensity * 22;
    const stepDur = 60 / this._bpm / 4;
    if (this.delay) this.delay.delayTime.value = stepDur * 3;

    while (this._nextNoteTime < ctx.currentTime + look) {
      this._playStep(this._step, this._nextNoteTime, stepDur);
      this._nextNoteTime += stepDur;
      this._step = (this._step + 1) % 16;
      if (this._step === 0) this._bar = (this._bar + 1) % 4;
    }
  }

  _playStep(step, t, stepDur) {
    const I = this.intensity;
    const bus = this.musicBus;
    const rel = (t - this.ctx.currentTime);

    // 底鼓
    if (step === 0 || step === 8 || (I > 0.45 && step === 11)) {
      this.tone({ type: 'sine', f0: 130, f1: 46, dur: 0.22, gain: 0.5, at: rel, bus, sweep: 0.18 });
      this.noise({ f0: 400, f1: 90, dur: 0.06, gain: 0.12, at: rel, bus });
    }
    // 拍手
    if (step === 4 || step === 12) {
      this.noise({ f0: 1600, f1: 900, dur: 0.13, gain: 0.16, filter: 'bandpass', q: 0.8, at: rel, bus });
    }
    // 踩镲
    if (step % 2 === 1 && (I > 0.22 || step % 4 === 1)) {
      this.noise({ f0: 8000, f1: 11000, dur: 0.045, gain: 0.05 + I * 0.045, filter: 'highpass', at: rel, bus });
    }
    // 贝斯
    const bassPat = { 0: 1, 3: 0, 6: 0, 8: 0, 10: 1, 13: 0, 14: 0 };
    if (step in bassPat) {
      const root = this.bassNotes[this._bar];
      const f = bassPat[step] === 1 ? root * 2 : root;
      this.tone({ type: 'sawtooth', f0: f, dur: stepDur * 2.6, gain: 0.12, at: rel, bus,
                  filter: 'lowpass', fc: 700 + I * 500, q: 4, attack: 0.008 });
    }
    // 琶音
    if (step % 2 === 0 || I > 0.55) {
      const idx = this.scale.length;
      const n = this.scale[(step * 2 + this._bar * 3) % idx];
      this.tone({ type: 'triangle', f0: n, dur: stepDur * 1.8, gain: 0.075 + I * 0.03, at: rel, bus,
                  delay: 0.5, attack: 0.004 });
      if (I > 0.5) {
        this.tone({ type: 'sine', f0: n * 2, dur: stepDur * 1.2, gain: 0.028, at: rel, bus, delay: 0.6 });
      }
    }
    // 垫底弦乐（每小节头）
    if (step === 0) {
      const chord = this.chords[this._bar];
      chord.forEach((f, i) => {
        this.tone({ type: 'triangle', f0: f / 2, dur: 60 / this._bpm * 3.4, gain: 0.05,
                    at: rel, bus, attack: 0.35, filter: 'lowpass', fc: 1800 });
        this.tone({ type: 'sine', f0: f * 1.5, dur: 60 / this._bpm * 3.0, gain: 0.02,
                    at: rel + i * 0.02, bus, attack: 0.5 });
      });
    }
    // 高频闪片
    if (step === 6 && I > 0.7) {
      this.noise({ f0: 6000, f1: 9000, dur: 0.35, gain: 0.05, filter: 'highpass', at: rel, bus });
    }
  }
}
