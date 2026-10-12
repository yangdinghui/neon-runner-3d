/* =========================================================================
 * game.js —— 主控制器：渲染、镜头、状态机、碰撞、计分、HUD
 * ========================================================================= */

class Game {
  constructor() {
    this.canvas = document.getElementById('canvas');
    this.ui = {
      hud: document.getElementById('hud'),
      score: document.getElementById('hud-score'),
      dist: document.getElementById('hud-dist'),
      speed: document.getElementById('hud-speed'),
      shields: document.getElementById('hud-shields'),
      combo: document.getElementById('hud-combo'),
      toast: document.getElementById('toast'),
      fade: document.getElementById('fade'),
      loading: document.getElementById('loading'),
      loadingText: document.getElementById('loading-text'),
      hint: document.getElementById('hud-hint'),
    };

    this.state = 'loading';
    this.dist = 0;
    this.speed = CFG.speed.base;
    this.speedMul = 1;
    this.difficulty = 0;
    this.score = 0;
    this.shields = CFG.rules.shields;
    this.combo = 1;
    this.comboTimer = 0;
    this.maxCombo = 1;
    this.nextShieldAt = 800;
    this.dyingTimer = 0;
    this.overTimer = 0;
    this.shake = 0;
    this.flashV = 0;
    this.cam = { x: 0, y: CFG.camera.height, z: CFG.camera.back, orbit: 0, fov: CFG.camera.fovBase };
    this.hudCache = {};
    this.debug = new URLSearchParams(location.search).has('debug');
  }

  /* ================================================================ */
  init() {
    const r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.setSize(window.innerWidth, window.innerHeight, false);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = r;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(PAL.fog, CFG.fx.fogNear, CFG.fx.fogFar);

    this.camera = new THREE.PerspectiveCamera(CFG.camera.fovBase, window.innerWidth / window.innerHeight, 0.1, 1200);
    this.camera.position.set(0, CFG.camera.height, CFG.camera.back);

    // 模块
    this.audio = new AudioEngine();
    this.particles = new ParticleSystem(this.scene, CFG.fx.maxParticles);
    this.fx = new FXPool(this.scene);
    this.world = new World(this.scene, this.particles, this.fx, this.audio);
    this.player = new Player(this.scene, this.particles, this.audio, this.fx);
    this.trail = new TrailRibbon(this.scene, CFG.fx.trailPoints, 0.46);
    this.input = new InputManager();

    this._buildShieldHud();
    this._bindUI();
    this._bindResize();

    // 进入「菜单巡游」模式：世界缓慢滚动，玩家原地跑，做一个动态背景
    this._enterMenu(false);

    window.addEventListener('resize', () => this._resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.togglePause(true);
    });

    // 首次交互解锁音频
    const unlock = () => {
      this.audio.unlock();
      if (this.audio.ready) this.audio.startMusic();
      this.audio.setMuted(this.muted);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('pointerdown', unlock);
    };
    window.addEventListener('keydown', unlock);
    window.addEventListener('pointerdown', unlock);
    this.input.onAnyKey(() => {});

    this.lastT = performance.now();
    this._loop();

    this.ui.loading.classList.add('hidden');
    this.showScreen('start');
    Leaderboard.render(document.getElementById('lb-start'));
    document.getElementById('start-best').textContent = Leaderboard.best().toLocaleString('en-US');
  }

  /* ================================================================ */
  _bindUI() {
    document.getElementById('btn-play').addEventListener('click', () => this._fade(() => this.startRun()));
    document.getElementById('btn-retry').addEventListener('click', () => this._fade(() => this.startRun()));
    document.getElementById('btn-menu').addEventListener('click', () => this._fade(() => this._enterMenu(true)));
    document.getElementById('btn-resume').addEventListener('click', () => this.togglePause(false));
    document.getElementById('btn-restart-pause').addEventListener('click', () => this._fade(() => this.startRun()));
    document.getElementById('btn-menu-pause').addEventListener('click', () => this._fade(() => this._enterMenu(true)));
    document.getElementById('btn-pause').addEventListener('click', () => this.togglePause(true));

    const muteBtn = document.getElementById('btn-mute');
    this.muted = false;
    muteBtn.addEventListener('click', () => this.toggleMute());

    const nameInput = document.getElementById('input-name');
    nameInput.value = Leaderboard.lastName() || '';
    document.getElementById('btn-save-score').addEventListener('click', () => this._submitScore());
    nameInput.addEventListener('keydown', (e) => {
      if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); this._submitScore(); }
    });
    document.getElementById('btn-clear-lb').addEventListener('click', () => {
      if (confirm('确定要清空本地排行榜吗？')) {
        Leaderboard.clear();
        Leaderboard.render(document.getElementById('lb-start'));
        document.getElementById('start-best').textContent = '0';
        this.audio.ui();
      }
    });
  }

  _bindResize() {
    this._resize();
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _buildShieldHud() {
    this.ui.shields.innerHTML = '';
    this.shieldEls = [];
    for (let i = 0; i < CFG.rules.shields; i++) {
      const d = document.createElement('i');
      d.className = 'shield';
      this.ui.shields.appendChild(d);
      this.shieldEls.push(d);
    }
  }

  /* 屏幕转场：白闪一下，遮住世界重置 */
  _fade(cb) {
    this.ui.fade.classList.add('on');
    setTimeout(() => {
      cb();
      setTimeout(() => this.ui.fade.classList.remove('on'), 90);
    }, 240);
  }

  showScreen(name) {
    for (const s of document.querySelectorAll('.screen')) {
      s.classList.toggle('hidden', s.id !== 'screen-' + name);
    }
    const inGame = name === null;
    this.ui.hud.classList.toggle('hidden', !inGame && name !== 'pause');
  }

  /* ================================================================ */
  _enterMenu(withFade) {
    this.state = 'menu';
    this.world.reset();
    this.world.spawning = false;
    this.world.D = 0;
    this.dist = 0;
    this.speed = 9.5;
    this.speedMul = 1;
    this.difficulty = 0;
    this.player.reset();
    this.trail.reset(0, 0.35);
    this.particles.clear();
    this.fx.reset();
    this.combo = 1;
    this.score = 0;
    this.cam.orbit = 0;
    this.showScreen('start');
    document.getElementById('start-best').textContent = Leaderboard.best().toLocaleString('en-US');
    Leaderboard.render(document.getElementById('lb-start'));
    this.audio.setIntensity(0);
    this.audio.resume();
  }

  startRun() {
    // 上一局成绩如果还没保存（玩家直接点了再来一局），先默默记下来
    if (this.pendingEntry && !this.submitted && Leaderboard.qualifies(this.pendingEntry.score)) {
      this._submitScore(true);
    }
    this.state = 'playing';
    this.dist = 0;
    this.speed = CFG.speed.base;
    this.speedMul = 1;
    this.difficulty = 0;
    this.score = 0;
    this.shields = CFG.rules.shields;
    this.combo = 1;
    this.comboTimer = 0;
    this.maxCombo = 1;
    this.nextShieldAt = 800;
    this.dyingTimer = 0;
    this.overTimer = 0;
    this.shake = 0;
    this.submitted = false;
    this.pendingEntry = null;

    this.world.reset();
    this.world.spawning = true;
    this.world.D = 0;
    this.world.prefill(150);
    this.player.reset();
    this.trail.reset(0, 0.35);
    this.particles.clear();
    this.fx.reset();

    this.cam.x = 0;
    this.cam.y = CFG.camera.height;
    this.cam.z = CFG.camera.back;
    this.cam.fov = CFG.camera.fovBase;
    this.cam.orbit = 0;

    this._updateShields();
    this.hudCache = {};
    this.showScreen(null);
    this._showHint('← → 移动　空格 跳跃（可二段跳）　↓ / Shift 滑铲', 4200);
    this.audio.unlock();
    if (this.audio.ready && !this.audio.musicPlaying) this.audio.startMusic();
    this.audio.start();
  }

  togglePause(on) {
    if (on && this.state === 'playing') {
      this.state = 'paused';
      this.showScreen('pause');
      this.audio.suspend();
      this.input.clear();
    } else if (!on && this.state === 'paused') {
      this.state = 'playing';
      this.showScreen(null);
      this.audio.resume();
      this.input.clear();
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    this.audio.setMuted(this.muted);
    const b = document.getElementById('btn-mute');
    b.textContent = this.muted ? '🔇' : '🔊';
    b.classList.toggle('off', this.muted);
    if (!this.muted) this.audio.ui();
  }

  _showHint(text, ms = 3000) {
    const h = this.ui.hint;
    if (!h) return;
    h.textContent = text;
    h.classList.remove('hidden');
    clearTimeout(this._hintT);
    this._hintT = setTimeout(() => h.classList.add('hidden'), ms);
  }

  _toast(text, ms = 1500) {
    const t = this.ui.toast;
    t.textContent = text;
    t.classList.remove('hidden');
    t.classList.remove('pop');
    void t.offsetWidth;
    t.classList.add('pop');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.add('hidden'), ms);
  }

  /* ================================================================ */
  _loop() {
    requestAnimationFrame(() => this._loop());
    const now = performance.now();
    let dt = (now - this.lastT) / 1000;
    this.lastT = now;
    if (dt > 0.05) dt = 0.05;
    if (dt <= 0) dt = 0.0001;

    try {
      this._update(dt);
    } catch (err) {
      console.error('[update error]', err);
      throw err;
    }
    this.renderer.render(this.scene, this.camera);
    this.input.endFrame();

    if (this.debug) {
      this._dbgT = (this._dbgT || 0) + dt;
      if (this._dbgT > 0.25) {
        this._dbgT = 0;
        const info = this.renderer.info;
        document.getElementById('debug').classList.remove('hidden');
        document.getElementById('debug').textContent =
          `state=${this.state} fps=${Math.round(1 / dt)} calls=${info.render.calls} tris=${info.render.triangles} ` +
          `particles=${this.particles.alive} haz=${this.world.hazards.length} orbs=${this.world.orbs.length}`;
      }
    }
  }

  _update(dt) {
    const I = this.input;
    switch (this.state) {
      case 'menu': this._updateMenu(dt); break;
      case 'playing': this._updatePlaying(dt); break;
      case 'dying': this._updateDying(dt); break;
      case 'over': this._updateOver(dt); break;
      case 'paused': break;
      default: break;
    }

    // 全局按键
    if (this.state === 'menu' && (I.wasPressed('jump') || I.wasPressed('confirm'))) {
      this._fade(() => this.startRun());
    }
    if (I.wasPressed('mute')) this.toggleMute();
    if (I.wasPressed('pause')) {
      if (this.state === 'playing') this.togglePause(true);
      else if (this.state === 'paused') this.togglePause(false);
    }
    if (I.wasPressed('restart') && (this.state === 'over' || this.state === 'paused')) {
      this._fade(() => this.startRun());
    }
    if (I.wasPressed('confirm') && this.state === 'over' && document.activeElement !== document.getElementById('input-name')) {
      this._fade(() => this.startRun());
    }

    this.particles.update(dt);
    this.fx.update(dt);
    this._updateCamera(dt);
  }

  /* ---------------------------------------------------------- 菜单巡游 */
  _updateMenu(dt) {
    this.speed = 9.5;
    this.dist += this.speed * dt;
    this.player.update(dt, { left: false, right: false, jumpPressed: false, slideDown: false, slidePressed: false },
      { speed: this.speed, trackHalf: CFG.track.width / 2 });
    this.world.update(dt, this.dist, this.speed, 0, this.player.x);

    // 拖尾
    this.trail.setVisible(true);
    this._updateTrail(0.5, 0.45);
    this._puffTrail(dt, 0.55);

    this.cam.orbit += dt * 0.06;
    this.audio.setIntensity(0);
  }

  /* --------------------------------------------------------------- 游戏 */
  _updatePlaying(dt) {
    const I = this.input;
    const P = CFG.player;

    // 速度爬升 + 受击恢复
    this.speed = Math.min(CFG.speed.max, this.speed + CFG.speed.accel * dt);
    this.speedMul = damp(this.speedMul, 1, 1 / CFG.speed.recoverTime, dt);
    const v = this.speed * this.speedMul;

    this.dist += v * dt;
    this.score += v * dt * CFG.score.perMeter;

    // 难度
    this.difficulty = clamp(this.dist / 1500, 0, 1);

    const inp = {
      left: I.isDown('left'),
      right: I.isDown('right'),
      jumpPressed: I.wasPressed('jump'),
      slideDown: I.isDown('slide'),
      slidePressed: I.wasPressed('slide'),
    };
    this.player.update(dt, inp, { speed: v, trackHalf: CFG.track.width / 2 });
    this.world.update(dt, this.dist, v, this.difficulty, this.player.x);

    this._collide();
    this._updateCombo(dt);
    this._updateTrail(0.5 + this.difficulty * 0.35, 0.62);
    this._puffTrail(dt, 0.55 + this.difficulty * 0.55);

    // 护盾奖励
    if (this.dist >= this.nextShieldAt) {
      this.nextShieldAt += 800;
      if (this.shields < CFG.rules.shields) {
        this.shields++;
        this._updateShields(true);
        this._toast('⚡ 能量护盾 +1');
        this.audio.bigPickup(0);
      } else {
        this.score += 120;
        this._toast('⚡ 满护盾奖励 +120');
        this.audio.bigPickup(2);
      }
    }

    // 音画强度
    this.audio.setIntensity(clamp((v - CFG.speed.base) / (CFG.speed.max - CFG.speed.base), 0, 1));
    this._hud();
  }

  _updateDying(dt) {
    this.dyingTimer += dt;
    this.speed = damp(this.speed, 0, 2.6, dt);
    this.dist += this.speed * dt;
    this.player.update(dt, { left: false, right: false, jumpPressed: false, slideDown: false, slidePressed: false },
      { speed: this.speed, trackHalf: CFG.track.width / 2 });
    this.world.update(dt, this.dist, this.speed, this.difficulty, this.player.x);
    this.trail.setVisible(false);
    this.cam.orbit += dt * 0.55;
    this.audio.setIntensity(0);
    if (this.dyingTimer > 1.25) this._gameOver();
  }

  _updateOver(dt) {
    this.overTimer += dt;
    this.cam.orbit += dt * 0.18;
    this.player.update(dt, { left: false, right: false, jumpPressed: false, slideDown: false, slidePressed: false },
      { speed: 0, trackHalf: CFG.track.width / 2 });
  }

  /* ----------------------------------------------------------- 碰撞 */
  _collide() {
    const p = this.player;
    const box = p.box();

    // 障碍物
    for (const h of this.world.hazards) {
      if (h.hit) continue;
      const d = h.data;
      const hx = h.mesh.position.x, hz = h.mesh.position.z;
      if (hz > box.z1 + d.halfD || hz < box.z0 - d.halfD) continue;
      if (box.x1 < hx - d.halfW || box.x0 > hx + d.halfW) continue;
      if (box.y1 < d.yMin || box.y0 > d.yMax) continue;
      h.hit = true;
      this._onHit(hx);
    }

    // 能量球
    const cy = p.y + (p.sliding ? 0.42 : 0.78);
    for (const o of this.world.orbs) {
      if (o.taken) continue;
      const oz = o.mesh.position.z;
      if (Math.abs(oz) > 1.5) continue;
      const dx = o.mesh.position.x - p.x;
      const dy = o.mesh.position.y - cy;
      const r = o.data.r + 0.62;
      if (dx * dx + dy * dy > r * r) continue;
      o.taken = true;
      o.active = false;
      o.mesh.visible = false;
      const i = this.world.orbs.indexOf(o);
      if (i >= 0) this.world.orbs.splice(i, 1);
      this._onOrb(o);
    }
  }

  _onHit(hx, fatal = null) {
    if (this.player.invuln > 0) return;
    const dir = Math.sign(this.player.x - hx) || 1;
    this.combo = 1;
    this.comboTimer = 0;
    this.player.onHit(dir);
    this.shake = 0.85;
    this.flashV = 0.55;
    document.body.classList.add('flash-hit');
    setTimeout(() => document.body.classList.remove('flash-hit'), 200);

    const fatalNow = fatal !== null ? fatal : this.shields <= 1;
    if (this.shields > 0) this.shields--;
    this._updateShields();
    this.speedMul = CFG.speed.hitPenalty;

    if (fatalNow || this.shields <= 0) {
      this.audio.hit();
      this.audio.shieldBreak();
      setTimeout(() => this._die(), 160);
    } else {
      this.audio.hit();
      this._toast('💥 护盾 -1');
    }
  }

  _onOrb(o) {
    const big = o.data.big;
    // 连击
    if (this.comboTimer > 0) this.combo = Math.min(CFG.score.comboMax, this.combo + 1);
    else this.combo = 1;
    this.comboTimer = CFG.score.comboWindow;
    this.maxCombo = Math.max(this.maxCombo, this.combo);

    const base = big ? CFG.score.bigOrbScore : CFG.score.orbScore;
    const gain = base * this.combo;
    this.score += gain;

    const px = o.mesh.position.x, py = o.mesh.position.y, pz = o.mesh.position.z;
    this.particles.burst(px, py, pz, big ? 26 : 12, {
      colors: big ? [PAL.neonYellow, PAL.neonPink, PAL.white] : [PAL.neonCyan, PAL.white, PAL.neonLime],
      dir: 'sphere', speedMin: 1.5, speedMax: big ? 7 : 4, sizeMin: 0.2, sizeMax: 0.6,
      gravity: -3, lifeMax: 0.7,
    });
    this.fx.ring(px, py, pz, big ? PAL.neonYellow : PAL.neonCyan, big ? 0.6 : 0.4, big ? 2.4 : 1.5, false);
    if (big) {
      this.audio.bigPickup(this.combo);
      this.fx.text(px, py + 0.7, pz, '+' + gain, '#f0a500', 0.95, 1.25);
    } else {
      this.audio.pickup(this.combo + 1);
      if (this.combo >= 4) this.fx.text(px, py + 0.6, pz, 'x' + this.combo, '#12b8e8', 0.7, 1.0);
    }
    if (this.combo > 1 && this.combo % 3 === 0) this.audio.combo(this.combo);
    this._updateComboHud();
  }

  _updateCombo(dt) {
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) {
        this.combo = 1;
        this._updateComboHud();
      }
    }
  }

  _die() {
    if (this.state !== 'playing') return;
    this.state = 'dying';
    this.dyingTimer = 0;
    this.player.die();
    this.audio.gameOver();
    this.audio.setIntensity(0);
    this.shake = 1.2;
  }

  _gameOver() {
    this.state = 'over';
    this.overTimer = 0;
    this.showScreen('over');

    const finalScore = Math.floor(this.score);
    const best = Leaderboard.best();
    document.getElementById('over-score').textContent = finalScore.toLocaleString('en-US');
    document.getElementById('over-dist').textContent = Math.floor(this.dist).toLocaleString('en-US') + ' m';
    document.getElementById('over-combo').textContent = 'x' + this.maxCombo;
    document.getElementById('over-best').textContent = Math.max(best, finalScore).toLocaleString('en-US');

    const isRecord = finalScore > best;
    const badge = document.getElementById('record-badge');
    badge.classList.toggle('hidden', !isRecord);
    if (isRecord) { this.audio.record(); }

    // 上榜？
    const entry = document.getElementById('name-entry');
    const qualifies = Leaderboard.qualifies(finalScore);
    entry.classList.toggle('hidden', !qualifies);
    this.pendingEntry = { score: finalScore, dist: this.dist, combo: this.maxCombo };
    this.submitted = false;
    if (qualifies) {
      const input = document.getElementById('input-name');
      if (!input.value) input.value = Leaderboard.lastName() || '';
      setTimeout(() => input.focus(), 350);
    }
    Leaderboard.render(document.getElementById('lb-over'));
    Leaderboard.render(document.getElementById('lb-start'));
    document.getElementById('start-best').textContent = Math.max(best, finalScore).toLocaleString('en-US');
  }

  _submitScore(silent = false) {
    if (this.submitted || !this.pendingEntry) return;
    const input = document.getElementById('input-name');
    const name = (input.value || '匿名玩家').trim().slice(0, 10) || '匿名玩家';
    Leaderboard.setLastName(name);
    const res = Leaderboard.submit({ name, score: this.pendingEntry.score, dist: this.pendingEntry.dist, combo: this.pendingEntry.combo });
    this.submitted = true;
    this._lastId = res.id;
    document.getElementById('name-entry').classList.add('hidden');
    Leaderboard.render(document.getElementById('lb-over'), res.id);
    Leaderboard.render(document.getElementById('lb-start'), res.id);
    const rankEl = document.getElementById('over-rank');
    rankEl.textContent = res.rank ? '第 ' + res.rank + ' 名' : '未上榜';
    rankEl.classList.remove('hidden');
    if (!silent) this.audio.ui();
    if (res.rank === 1 && !silent) this.audio.record();
    input.blur();
  }

  /* ----------------------------------------------------------- 视觉 */
  _updateTrail(widthScale, alpha) {
    const p = this.player;
    this.trail.setVisible(this.state !== 'paused');
    this.trail.push(p.x, p.y + 0.30);
    if (this.trail.mesh.visible) this.trail.update(widthScale, alpha);
  }

  // 背包喷焰粒子（拖尾的“粒子”部分）
  _puffTrail(dt, rate) {
    const p = this.player;
    this._puffAcc = (this._puffAcc || 0) + dt * rate * 110;
    const n = Math.floor(this._puffAcc);
    this._puffAcc -= n;
    for (let i = 0; i < Math.min(n, 7); i++) {
      this.particles.emit({
        x: p.x + rand(-0.18, 0.18), y: p.y + 0.42 + rand(-0.08, 0.08), z: 0.40 + rand(-0.06, 0.06),
        vx: rand(-0.9, 0.9), vy: rand(-0.5, 1.4), vz: rand(2.8, 7.5),
        color: Math.random() < 0.5 ? PAL.neonCyan : PAL.neonPink,
        size: rand(0.22, 0.5), life: rand(0.3, 0.68), gravity: 1.4, drag: 1.3,
      });
    }
  }

  _updateCamera(dt) {
    const p = this.player;
    const C = CFG.camera;
    const dead = this.state === 'dying' || this.state === 'over';
    const sn = clamp((this.speed * this.speedMul - CFG.speed.base) / (CFG.speed.max - CFG.speed.base), 0, 1);

    let wantX, wantY, wantZ, lookX, lookY, lookZ;
    if (dead) {
      const r = 4.6;
      wantX = p.x + Math.sin(this.cam.orbit) * r;
      wantY = 2.1 + Math.sin(this.cam.orbit * 0.6) * 0.5;
      wantZ = Math.cos(this.cam.orbit) * r;
      lookX = p.x; lookY = 0.7; lookZ = 0;
    } else if (this.state === 'menu') {
      const r = 5.6;
      wantX = Math.sin(this.cam.orbit) * r * 0.55 + p.x * 0.5;
      wantY = 2.5;
      wantZ = C.back * 0.92 + Math.cos(this.cam.orbit) * 0.8;
      lookX = p.x * 0.5; lookY = 1.15; lookZ = C.lookAhead * 0.7;
    } else {
      wantX = p.x * 0.74;
      wantY = C.height + p.y * 0.34;
      wantZ = C.back + sn * 0.9;
      lookX = p.x * 0.55;
      lookY = C.lookHeight + p.y * 0.32;
      lookZ = C.lookAhead;
    }

    const k = dead ? 3.4 : (this.state === 'menu' ? 2.6 : 7.5);
    this.cam.x = damp(this.cam.x, wantX, k, dt);
    this.cam.y = damp(this.cam.y, wantY, k * 0.9, dt);
    this.cam.z = damp(this.cam.z, wantZ, k, dt);

    // FOV 随速度拉伸
    const targetFov = C.fovBase + sn * (C.fovMax - C.fovBase);
    this.cam.fov = damp(this.cam.fov, dead ? C.fovBase - 4 : targetFov, 3.2, dt);
    if (Math.abs(this.camera.fov - this.cam.fov) > 0.01) {
      this.camera.fov = this.cam.fov;
      this.camera.updateProjectionMatrix();
    }

    // 抖动
    this.shake = Math.max(0, this.shake - dt * 2.6);
    const sh = this.shake * this.shake;
    const sx = (Math.random() - 0.5) * sh * 0.9;
    const sy = (Math.random() - 0.5) * sh * 0.9;

    this.camera.position.set(this.cam.x + sx, Math.max(0.7, this.cam.y + sy), this.cam.z);
    this.camera.lookAt(
      lookX + sx * 0.4,
      lookY + sy * 0.4,
      lookZ
    );
    this.camera.rotateZ(clamp(-this.player.vx * 0.006, -0.05, 0.05));
  }

  /* ------------------------------------------------------------- HUD */
  _hud() {
    const c = this.hudCache;
    const sc = Math.floor(this.score);
    if (c.score !== sc) { this.ui.score.textContent = sc.toLocaleString('en-US'); c.score = sc; }
    const d = Math.floor(this.dist);
    if (c.dist !== d) { this.ui.dist.textContent = d.toLocaleString('en-US'); c.dist = d; }
    const kmh = Math.round(this.speed * this.speedMul * 3.6);
    if (c.speed !== kmh) { this.ui.speed.textContent = kmh; c.speed = kmh; }
    if (c.difficulty !== this.difficulty) {
      c.difficulty = this.difficulty;
      document.body.style.setProperty('--intensity', this.difficulty.toFixed(2));
    }
  }

  _updateShields(gained = false) {
    this.shieldEls.forEach((el, i) => {
      const on = i < this.shields;
      el.classList.toggle('lost', !on);
      if (gained && on) {
        el.classList.remove('gain');
        void el.offsetWidth;
        el.classList.add('gain');
      }
    });
    this.hudCache.shields = this.shields;
  }

  _updateComboHud() {
    const el = this.ui.combo;
    if (this.combo > 1) {
      el.textContent = 'x' + this.combo + ' 连击';
      el.classList.remove('hidden');
      el.classList.remove('pop');
      void el.offsetWidth;
      el.classList.add('pop');
    } else {
      el.classList.add('hidden');
    }
  }
}
