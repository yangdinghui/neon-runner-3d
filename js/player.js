/* =========================================================================
 * player.js —— 主角「皮皮」：圆滚滚的霓虹跑酷机器人
 *   朝向 -z（游戏里世界向 +z 滚动 = 角色向前奔跑）
 *   内含：移动/跳跃/二段跳/滑铲物理 + 程序化卡通动画
 * ========================================================================= */

class Player {
  constructor(scene, particles, audio, fx) {
    this.scene = scene;
    this.particles = particles;
    this.audio = audio;
    this.fx = fx;

    this.x = 0;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.grounded = true;
    this.jumps = 0;
    this.maxJumps = 2;

    this.state = 'run';          // run | air | slide | dead
    this.slideTimer = 0;
    this.slideCd = 0;
    this.runPhase = 0;
    this.squash = 0;             // 落地压扁 / 起跳拉伸
    this.stretch = 0;
    this.invuln = 0;
    this.flash = 0;
    this.deadTimer = 0;
    this.deadSpin = new THREE.Vector3();
    this.hurtLean = 0;

    this.bobY = 0;

    this._build();
  }

  /* 当前有效身高（滑铲时变矮，碰撞盒用它） */
  get height() { return this.state === 'slide' ? CFG.player.slideH : CFG.player.standH; }

  /* ------------------------------------------------------------------ */
  _build() {
    const M = (c, o = {}) => new THREE.MeshStandardMaterial({
      color: c, roughness: o.rough ?? 0.62, metalness: o.metal ?? 0.0,
      emissive: o.emissive ?? 0x000000, emissiveIntensity: o.ei ?? 1,
      flatShading: !!o.flat, transparent: !!o.transparent, opacity: o.opacity ?? 1,
    });
    const B = (c, o = {}) => new THREE.MeshBasicMaterial({
      color: c, transparent: !!o.transparent, opacity: o.opacity ?? 1,
    });

    const white = M(PAL.body, { rough: 0.55 });
    const white2 = M(0xeef2ff, { rough: 0.6 });
    const cyan = B(PAL.neonCyan);
    const pink = B(PAL.neonPink);
    const navy = M(0x2b2f4a, { rough: 0.35 });
    this.mats = { white, white2, cyan, pink, navy };

    const root = new THREE.Group();          // 世界位置
    const rig = new THREE.Group();           // 动画用（压扁/倾斜/旋转）
    root.add(rig);
    this.root = root;
    this.rig = rig;

    /* ---- 躯干 ---- */
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.40, 24, 18), white);
    body.position.y = 0.66;
    body.scale.set(1, 1.02, 0.94);
    body.castShadow = true;
    rig.add(body);
    this.body = body;

    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.40, 0.035, 8, 28), cyan);
    belt.position.y = 0.58;
    belt.rotation.x = Math.PI / 2;
    belt.scale.set(1.0, 0.94, 1);
    rig.add(belt);

    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.14, 0.06), pink);
    chest.position.set(0, 0.80, -0.36);
    rig.add(chest);
    this.chest = chest;

    /* ---- 头 ---- */
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.30, 24, 18), white2);
    head.position.y = 1.18;
    head.castShadow = true;
    rig.add(head);
    this.head = head;

    // 面罩
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.265, 20, 16), navy);
    visor.position.set(0, 1.19, -0.10);
    visor.scale.set(1.0, 0.62, 0.75);
    rig.add(visor);

    // 眼睛（发光）
    const eyeGeo = new THREE.SphereGeometry(0.052, 12, 10);
    this.eyes = [];
    for (const sx of [-0.11, 0.11]) {
      const e = new THREE.Mesh(eyeGeo, cyan);
      e.position.set(sx, 1.20, -0.30);
      e.scale.set(1, 1.15, 0.6);
      rig.add(e);
      this.eyes.push(e);
    }

    // 天线
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.24, 6), navy);
    ant.position.set(0.10, 1.48, 0.02);
    ant.rotation.z = -0.22;
    rig.add(ant);
    const antTip = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 10), pink);
    antTip.position.set(0.145, 1.60, 0.02);
    rig.add(antTip);
    this.antTip = antTip;

    // 侧边耳机
    for (const sx of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.05, 14), cyan);
      ear.position.set(sx * 0.295, 1.19, 0.0);
      ear.rotation.z = Math.PI / 2;
      rig.add(ear);
    }

    /* ---- 手臂 ---- */
    this.arms = [];
    for (const sx of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx * 0.40, 0.86, 0);
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.072, 0.20, 6, 12), white2);
      arm.position.y = -0.14;
      arm.castShadow = true;
      pivot.add(arm);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.095, 12, 10), white);
      hand.position.y = -0.27;
      pivot.add(hand);
      rig.add(pivot);
      this.arms.push(pivot);
    }

    /* ---- 腿 ---- */
    this.legs = [];
    this.feet = [];
    for (const sx of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx * 0.16, 0.42, 0);
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.092, 0.20, 6, 12), white2);
      leg.position.y = -0.15;
      leg.castShadow = true;
      pivot.add(leg);
      const foot = new THREE.Mesh(new THREE.SphereGeometry(0.115, 12, 10), cyan);
      foot.position.set(0, -0.30, -0.03);
      foot.scale.set(1.0, 0.75, 1.35);
      foot.castShadow = true;
      pivot.add(foot);
      rig.add(pivot);
      this.legs.push(pivot);
      this.feet.push(foot);
    }

    /* ---- 喷气背包 ---- */
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.20), white);
    pack.position.set(0, 0.78, 0.34);
    pack.castShadow = true;
    rig.add(pack);
    const packGlow = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.06, 0.02), cyan);
    packGlow.position.set(0, 0.90, 0.45);
    rig.add(packGlow);

    this.nozzles = [];
    for (const sx of [-1, 1]) {
      const n = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.075, 0.16, 10), M(0xdfe6ff, { rough: 0.4 }));
      n.position.set(sx * 0.13, 0.60, 0.36);
      rig.add(n);
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.085, 0.42, 10),
        B(PAL.neonCyan, { transparent: true, opacity: 0.9 })
      );
      flame.position.set(sx * 0.13, 0.36, 0.36);
      flame.rotation.x = Math.PI;
      rig.add(flame);
      this.nozzles.push(flame);
    }

    /* ---- 围巾（跑动时飘起来） ---- */
    this.scarf = [];
    const scarfMat = B(PAL.neonPink, { transparent: true, opacity: 0.95 });
    for (let i = 0; i < 4; i++) {
      const seg = new THREE.Mesh(new THREE.BoxGeometry(0.20 - i * 0.025, 0.05, 0.13), scarfMat);
      seg.position.set(0, 1.05 - i * 0.03, 0.30 + i * 0.17);
      rig.add(seg);
      this.scarf.push(seg);
    }

    /* ---- 护盾泡泡（受伤无敌时出现） ---- */
    const shield = new THREE.Mesh(
      new THREE.SphereGeometry(0.92, 24, 18),
      B(0x9be7ff, { transparent: true, opacity: 0.16 })
    );
    shield.position.y = 0.78;
    shield.visible = false;
    rig.add(shield);
    this.shield = shield;

    /* ---- 接触阴影 ---- */
    const blob = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 1.5),
      new THREE.MeshBasicMaterial({
        map: ART.glow(0x2b2f4a, 1.5), transparent: true, opacity: 0.34,
        depthWrite: false, color: 0x6b7099,
      })
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.03;
    blob.renderOrder = 2;
    root.add(blob);
    this.blob = blob;

    this.scene.add(root);
    this._buildThrusterGlow();
  }

  _buildThrusterGlow() {
    this.glowSprites = [];
    for (const sx of [-1, 1]) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: ART.glow(PAL.neonCyan, 1.9), transparent: true, opacity: 0.75,
        depthWrite: false, blending: THREE.NormalBlending,
      }));
      sp.position.set(sx * 0.13, 0.42, 0.36);
      sp.scale.set(0.55, 0.55, 1);
      this.rig.add(sp);
      this.glowSprites.push(sp);
    }
  }

  /* ------------------------------------------------------------------ */
  reset() {
    this.x = 0; this.y = 0; this.vx = 0; this.vy = 0;
    this.grounded = true; this.jumps = 0;
    this.state = 'run'; this.slideTimer = 0; this.slideCd = 0;
    this.invuln = 0; this.flash = 0; this.deadTimer = 0;
    this.hurtLean = 0; this.squash = 0; this.stretch = 0;
    this.deadSpin.set(0, 0, 0);
    this.root.position.set(0, 0, 0);
    this.rig.rotation.set(0, 0, 0);
    this.rig.scale.set(1, 1, 1);
    this.shield.visible = false;
  }

  get sliding() { return this.state === 'slide'; }
  get dead() { return this.state === 'dead'; }

  /* 碰撞盒（世界坐标 AABB） */
  box() {
    return {
      x0: this.x - CFG.player.halfW, x1: this.x + CFG.player.halfW,
      y0: this.y, y1: this.y + this.height,
      z0: -CFG.player.halfD, z1: CFG.player.halfD,
    };
  }

  /* ------------------------------------------------------------------
   * 更新：物理 + 动画
   * inputFlags: {left,right,jumpPressed,slideDown,slidePressed,targetX}
   * ctx: {speed, trackHalf}
   * ------------------------------------------------------------------ */
  update(dt, inp, ctx) {
    const P = CFG.player;
    const trackHalf = ctx.trackHalf - P.halfW;

    if (this.state === 'dead') {
      this._updateDead(dt);
      return;
    }

    /* ---------- 左右 ---------- */
    if (inp.targetX !== null && inp.targetX !== undefined) {
      /* 触屏：朝手指指定的世界坐标加速，离得越远越快、接近时自动收敛 */
      const dx = inp.targetX - this.x;
      const want = clamp(dx * 7.5, -P.lateralSpeed, P.lateralSpeed);
      this.vx = damp(this.vx, want, 16 * (this.grounded ? 1 : P.airControl + 0.2), dt);
      if (Math.abs(want) < 0.06 && Math.abs(this.vx) < 0.06) this.vx = 0;
    } else {
      const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
      const control = this.grounded ? 1 : P.airControl;
      if (dir !== 0) {
        this.vx += dir * P.lateralAccel * control * dt;
        this.vx = clamp(this.vx, -P.lateralSpeed, P.lateralSpeed);
      } else {
        const f = P.lateralFriction * dt * (this.grounded ? 1 : 0.45);
        this.vx = Math.abs(this.vx) <= f ? 0 : this.vx - Math.sign(this.vx) * f;
      }
    }
    this.x += this.vx * dt;
    if (this.x < -trackHalf) { this.x = -trackHalf; this.vx *= -0.15; }
    if (this.x > trackHalf) { this.x = trackHalf; this.vx *= -0.15; }

    /* ---------- 滑铲 ---------- */
    if (inp.slidePressed && this.grounded && this.slideCd <= 0) {
      this.state = 'slide';
      this.slideTimer = P.slideTime;
      this.slideCd = P.slideTime + P.slideCooldown;
      this.particles.burst(this.x, this.y + 0.18, 0.1, 12, {
        colors: [PAL.neonCyan, PAL.white, PAL.neonPurple], dir: 'back',
        speedMin: 1.5, speedMax: 4.5, sizeMin: 0.2, sizeMax: 0.5, gravity: -2, lifeMax: 0.5,
      });
      this.audio.slide();
    }
    if (this.state === 'slide') {
      this.slideTimer -= dt;
      if (this.slideTimer <= 0 || !this.grounded) this.state = this.grounded ? 'run' : 'air';
    }
    if (this.slideCd > 0) this.slideCd -= dt;

    /* ---------- 跳跃 ---------- */
    if (inp.jumpPressed) {
      if (this.grounded || this.jumps < this.maxJumps) {
        if (this.grounded) {
          this.vy = P.jumpVel;
          this.jumps = 1;
          this.grounded = false;
          this.state = 'air';
          this.stretch = 0.34;
          this.audio.jump();
          this._jumpFx(PAL.neonCyan, 16, 1.0);
        } else if (this.jumps < this.maxJumps) {
          this.vy = P.doubleJumpVel;
          this.jumps = 2;
          this.stretch = 0.30;
          this.audio.doubleJump();
          this._jumpFx(PAL.neonPink, 22, 1.25);
        }
      }
    }

    /* ---------- 重力 / 空中飞扑 ---------- */
    const g = (inp.slideDown && !this.grounded) ? P.diveGravity : P.gravity;
    this.vy += g * dt;
    this.y += this.vy * dt;

    if (this.y <= 0) {
      const hard = this.vy < -12;
      if (!this.grounded) {
        this.grounded = true;
        this.jumps = 0;
        this.state = this.state === 'slide' ? 'run' : (this.state === 'air' ? 'run' : this.state);
        this.squash = hard ? 0.42 : 0.24;
        this.audio.land();
        this.particles.burst(this.x, 0.08, 0.05, hard ? 16 : 9, {
          colors: [PAL.white, PAL.neonCyan, PAL.roadLine], dir: 'up',
          speedMin: 0.8, speedMax: hard ? 4 : 2.4, sizeMin: 0.18, sizeMax: 0.44,
          gravity: -4, lifeMax: 0.45,
        });
        if (hard) this.fx.ring(this.x, 0.06, 0.05, PAL.neonCyan, 0.45, 1.7);
      }
      this.y = 0;
      this.vy = 0;
    } else if (this.grounded && this.vy > 0.01) {
      this.grounded = false;
    }
    if (this.y > 0.02) this.grounded = false;
    if (!this.grounded && this.state === 'run') this.state = 'air';

    /* ---------- 无敌闪烁 ---------- */
    if (this.invuln > 0) {
      this.invuln -= dt;
      const on = Math.floor(this.invuln * 14) % 2 === 0;
      this.rig.visible = on || this.invuln <= 0;
      this.shield.visible = this.invuln > 0;
      const s = 1 + Math.sin(this.invuln * 22) * 0.03;
      this.shield.scale.setScalar(s);
      this.shield.material.opacity = 0.10 + Math.abs(Math.sin(this.invuln * 9)) * 0.13;
      if (this.invuln <= 0) { this.rig.visible = true; this.shield.visible = false; }
    }
    if (this.flash > 0) this.flash -= dt;

    /* ---------- 动画 ---------- */
    this._animate(dt, ctx.speed);
    this._syncRoot();
  }

  _syncRoot() {
    this.root.position.set(this.x, this.y, 0);
  }

  _jumpFx(color, count, power) {
    this.particles.burst(this.x, this.y + 0.12, 0.06, count, {
      colors: [color, PAL.white], dir: 'up',
      speedMin: 1.2 * power, speedMax: 5 * power, sizeMin: 0.2, sizeMax: 0.6,
      gravity: -7, lifeMax: 0.55,
    });
    this.fx.ring(this.x, this.y + 0.05, 0.06, color, 0.42, 1.5);
  }

  _animate(dt, speed) {
    const sn = clamp((speed - CFG.speed.base) / (CFG.speed.max - CFG.speed.base), 0, 1);
    const runRate = 0.62 + sn * 0.45;
    this.runPhase += dt * speed * runRate;

    // 压扁/拉伸回弹
    this.squash = damp(this.squash, 0, 7, dt);
    this.stretch = damp(this.stretch, 0, 9, dt);
    const sy = 1 - this.squash + this.stretch;
    const sxz = 1 + this.squash * 0.7 - this.stretch * 0.45;

    // 倾斜（转向 + 前倾）
    const targetLean = -this.vx * 0.028;
    const targetPitch = this.state === 'slide' ? 0 : (-0.07 - sn * 0.14) - clamp(this.vy, -6, 6) * 0.012;
    this.rig.rotation.z = damp(this.rig.rotation.z, targetLean + this.hurtLean, 9, dt);
    this.rig.rotation.x = damp(this.rig.rotation.x, targetPitch, 9, dt);

    let bodyY = 0;

    if (this.state === 'run' || this.state === 'slide') {
      if (this.state === 'run') {
        const s = Math.sin(this.runPhase), c = Math.cos(this.runPhase);
        this.legs[0].rotation.x = s * (0.85 + sn * 0.30);
        this.legs[1].rotation.x = -s * (0.85 + sn * 0.30);
        this.arms[0].rotation.x = -s * 0.75;
        this.arms[1].rotation.x = s * 0.75;
        this.arms[0].rotation.z = 0.16 + c * 0.06;
        this.arms[1].rotation.z = -0.16 - c * 0.06;
        this.feet[0].position.y = -0.30 + Math.max(0, s) * 0.05;
        this.feet[1].position.y = -0.30 + Math.max(0, -s) * 0.05;
        bodyY = Math.abs(Math.sin(this.runPhase)) * 0.055;
        this.head.rotation.z = Math.sin(this.runPhase * 0.5) * 0.04;
      } else {
        // 滑铲姿势：向后仰、腿前伸
        this.legs[0].rotation.x = -1.25;
        this.legs[1].rotation.x = -0.95;
        this.arms[0].rotation.x = 0.9;
        this.arms[1].rotation.x = 1.15;
        this.arms[0].rotation.z = 0.4;
        this.arms[1].rotation.z = -0.4;
        this.rig.rotation.x = damp(this.rig.rotation.x, 0.85, 14, dt);
        bodyY = -0.16;
      }
    } else if (this.state === 'air') {
      const up = this.vy > 1;
      this.legs[0].rotation.x = damp(this.legs[0].rotation.x, up ? -0.85 : -0.35, 10, dt);
      this.legs[1].rotation.x = damp(this.legs[1].rotation.x, up ? -0.35 : -0.7, 10, dt);
      this.arms[0].rotation.x = damp(this.arms[0].rotation.x, up ? -1.5 : -0.5, 10, dt);
      this.arms[1].rotation.x = damp(this.arms[1].rotation.x, up ? -1.3 : -0.8, 10, dt);
      this.arms[0].rotation.z = 0.35;
      this.arms[1].rotation.z = -0.35;
      bodyY = 0;
    }

    // 眼睛表情
    const eyeY = this.state === 'slide' ? 0.05 : (this.state === 'air' ? 0.05 : (this.grounded ? 1 : 1));
    for (const e of this.eyes) {
      e.position.y = lerp(e.position.y, 1.20 + eyeY * 0.4, 0.2);
      e.scale.y = lerp(e.scale.y, this.state === 'slide' ? 0.35 : (this.state === 'air' ? 1.5 : 1.15), 0.25);
    }

    // 天线 / 围巾摆动
    const t = performance.now() * 0.001;
    this.antTip.position.x = 0.145 + Math.sin(t * 6) * 0.02;
    this.antTip.position.y = 1.60 + Math.sin(t * 8) * 0.015;
    const flutter = 0.25 + sn * 0.5 + (this.state === 'air' ? 0.35 : 0);
    this.scarf.forEach((s, i) => {
      const ph = t * (7 + sn * 4) - i * 0.55;
      s.position.y = 1.05 - i * 0.03 + Math.sin(ph) * 0.045 * (i + 1) * 0.5;
      s.position.x = Math.sin(ph * 0.7) * 0.045 * (i + 1) * 0.55;
      s.rotation.x = -0.25 - flutter * (0.2 + i * 0.16);
      s.rotation.z = Math.sin(ph * 0.8) * 0.12 * (i + 1) * 0.4;
    });

    // 应用
    this.rig.position.y = bodyY;
    this.rig.scale.set(sxz, sy, sxz);

    // 喷焰
    const thrust = 0.55 + sn * 0.65 + (this.state === 'air' ? 0.45 : 0) + this.stretch * 1.2;
    this.nozzles.forEach((f, i) => {
      const k = thrust * (0.85 + Math.sin(t * 26 + i * 1.7) * 0.16);
      f.scale.set(0.8 + k * 0.16, k, 0.8 + k * 0.16);
      f.position.y = 0.40 - k * 0.16;
      f.material.opacity = clamp(0.35 + k * 0.35, 0, 0.95);
      f.material.color.setHex(i === 0 ? PAL.neonCyan : PAL.neonPink);
    });
    this.glowSprites.forEach((sp, i) => {
      const k = 0.45 + thrust * 0.5 + Math.sin(t * 22 + i * 2) * 0.06;
      sp.scale.set(k, k * 1.35, 1);
      sp.material.opacity = clamp(0.35 + thrust * 0.4, 0, 0.85);
      sp.material.map = ART.glow(i === 0 ? PAL.neonCyan : PAL.neonPink, 1.9);
    });

    // 接触阴影随高度变淡变大
    const h = this.y;
    this.blob.position.set(0, 0.03 - h, 0);
    const bs = clamp(1 + h * 0.22, 1, 2.1);
    this.blob.scale.set(bs, bs, 1);
    this.blob.material.opacity = clamp(0.34 - h * 0.11, 0.05, 0.34);

    // 受击倾斜回正
    this.hurtLean = damp(this.hurtLean, 0, 5, dt);
  }

  _updateDead(dt) {
    this.deadTimer += dt;
    this.vy += CFG.player.gravity * 1.2 * dt;
    this.y = Math.max(0, this.y + this.vy * dt);
    this.x += this.vx * dt;
    this.rot = this.rot || { x: 0, y: 0, z: 0 };
    this.rot.x += this.deadSpin.x * dt;
    this.rig.rotation.x = this.rot.x;
    this.rig.rotation.z += this.deadSpin.z * dt;
    this.rig.rotation.y += this.deadSpin.y * dt;
    if (this.y <= 0) { this.vy = 0; this.deadSpin.multiplyScalar(0.9); }
    this.rig.position.y = 0;
    this.nozzles.forEach((f) => { f.scale.set(0.2, 0.15, 0.2); f.material.opacity = 0.15; });
    this.glowSprites.forEach((sp) => { sp.material.opacity = damp(sp.material.opacity, 0, 3, dt); });
    this.blob.position.set(0, 0.03 - this.y, 0);
    this.blob.material.opacity = 0.2;
    this._syncRoot();
  }

  /* 被撞到 */
  onHit(dir = 1) {
    this.invuln = CFG.rules.invulnTime;
    this.hurtLean = -dir * 0.5;
    this.squash = 0.3;
    this.vx = -dir * 5.5;
    this.vy = Math.max(this.vy, 5.0);
    this.grounded = false;
    this.state = 'air';
    this.particles.burst(this.x, this.y + 0.7, -0.1, 26, {
      colors: [PAL.neonPink, PAL.neonYellow, PAL.white], dir: 'sphere',
      speedMin: 2.5, speedMax: 8, sizeMin: 0.24, sizeMax: 0.7, gravity: -8, lifeMax: 0.8,
    });
    this.fx.ring(this.x, this.y + 0.7, -0.1, PAL.neonPink, 0.6, 2.2);
    this.fx.ring(this.x, this.y + 0.7, -0.1, PAL.neonYellow, 0.85, 2.9);
  }

  die() {
    this.state = 'dead';
    this.deadTimer = 0;
    this.vy = 7.5;
    this.vx = rand(-2.5, 2.5);
    this.deadSpin.set(rand(-5, -3), rand(-7, 7), rand(3, 6));
    this.rot = { x: 0, y: 0, z: 0 };
    this.rig.scale.set(1, 1, 1);
    this.invuln = 0;
    this.shield.visible = false;
    this.rig.visible = true;
  }
}
