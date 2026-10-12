/* =========================================================================
 * particles.js —— 粒子系统 / 拖尾光带 / 冲击波 / 飘字
 * 注意：游戏背景是浅色的，additive 混合在白底上会「消失」，
 *      所以这里统一用普通透明混合 + 高饱和霓虹色，才能看见颜色。
 * ========================================================================= */

class ParticleSystem {
  constructor(scene, max = CFG.fx.maxParticles) {
    this.max = max;
    this.cursor = 0;
    this.alive = 0;

    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.siz = new Float32Array(max);
    this.alp = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.spin = new Float32Array(max);

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.siz, 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alp, 1));
    g.setDrawRange(0, max);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

    const m = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: ART.softDot() } },
      vertexShader: /* glsl */`
        attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
        varying vec3 vColor; varying float vAlpha;
        void main() {
          vColor = aColor; vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (340.0 / max(0.001, -mv.z));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D uMap;
        varying vec3 vColor; varying float vAlpha;
        void main() {
          float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor, a);
        }`,
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });

    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    this.geo = g;
  }

  /* 生成一个粒子 */
  emit(o) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const i3 = i * 3;
    const c = new THREE.Color(o.color ?? PAL.neonCyan);

    this.pos[i3] = o.x; this.pos[i3 + 1] = o.y; this.pos[i3 + 2] = o.z;
    this.vel[i3] = o.vx ?? 0; this.vel[i3 + 1] = o.vy ?? 0; this.vel[i3 + 2] = o.vz ?? 0;
    this.col[i3] = c.r; this.col[i3 + 1] = c.g; this.col[i3 + 2] = c.b;

    this.siz[i] = o.size ?? 0.5;
    this.alp[i] = 1;
    this.life[i] = 0;
    this.maxLife[i] = o.life ?? 0.6;
    this.grav[i] = o.gravity ?? 0;
    this.drag[i] = o.drag ?? 1.6;
    this.spin[i] = o.spin ?? 0;
    return i;
  }

  /* 爆发式粒子团 */
  burst(x, y, z, count, o = {}) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const el = rand(-0.9, 1.2);
      const sp = rand(o.speedMin ?? 1.5, o.speedMax ?? 6);
      const dir = o.dir ?? 'sphere';
      let vx = Math.cos(a) * sp, vz = Math.sin(a) * sp, vy = el * sp;
      if (dir === 'up') { vy = Math.abs(vy) * 1.3 + 1; vx *= 0.6; vz *= 0.6; }
      if (dir === 'back') { vz = Math.abs(vz) * 0.9 + rand(1, 3); vy = rand(0.4, 2.6); }
      this.emit({
        x: x + rand(-0.16, 0.16), y: y + rand(-0.16, 0.16), z: z + rand(-0.16, 0.16),
        vx, vy, vz,
        color: Array.isArray(o.colors) ? pick(o.colors) : (o.color ?? PAL.neonCyan),
        size: rand(o.sizeMin ?? 0.24, o.sizeMax ?? 0.72),
        life: rand(o.lifeMin ?? 0.35, o.lifeMax ?? 0.85),
        gravity: o.gravity ?? -6,
        drag: o.drag ?? 2.2,
      });
    }
  }

  update(dt) {
    const { pos, vel, alp, life, maxLife, grav, drag, siz } = this;
    let alive = 0;
    for (let i = 0; i < this.max; i++) {
      if (maxLife[i] <= 0) { continue; }
      life[i] += dt;
      const t = life[i] / maxLife[i];
      if (t >= 1) {
        maxLife[i] = 0; alp[i] = 0;
        pos[i * 3 + 1] = -9999;          // 移出视野
        continue;
      }
      alive++;
      const i3 = i * 3;
      const d = Math.exp(-drag[i] * dt);
      vel[i3] *= d; vel[i3 + 1] = vel[i3 + 1] * d + grav[i] * dt; vel[i3 + 2] *= d;
      pos[i3] += vel[i3] * dt;
      pos[i3 + 1] += vel[i3 + 1] * dt;
      pos[i3 + 2] += vel[i3 + 2] * dt;
      // 先实后虚
      alp[i] = t < 0.15 ? t / 0.15 : Math.pow(1 - (t - 0.15) / 0.85, 1.35);
      siz[i] *= 1 - dt * 0.25;
    }
    this.alive = alive;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
  }

  clear() {
    this.maxLife.fill(0);
    this.alp.fill(0);
    for (let i = 0; i < this.max; i++) this.pos[i * 3 + 1] = -9999;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
  }
}

/* ------------------------------------------------------------------
 * 拖尾光带：跟着角色的历史轨迹拉出一条渐隐的霓虹丝带
 *   采样点按「序号 × 固定间距」铺在角色身后（+z）。
 *   总长必须短于镜头距离（camera.back = 6.4），否则丝带会穿过镜头糊满屏幕。
 * ------------------------------------------------------------------ */
class TrailRibbon {
  constructor(scene, count = CFG.fx.trailPoints, width = 0.62, spacing = 0.19) {
    this.count = count;
    this.width = width;
    this.spacing = spacing;
    this.samples = [];
    for (let i = 0; i < count; i++) this.samples.push({ x: 0, y: 0 });

    const vCount = count * 2;
    const pos = new Float32Array(vCount * 3);
    const col = new Float32Array(vCount * 4);   // rgb + alpha
    const idx = [];
    for (let i = 0; i < count - 1; i++) {
      const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
      idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 4));
    g.setIndex(idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

    const m = new THREE.ShaderMaterial({
      vertexShader: /* glsl */`
        attribute vec4 aColor; varying vec4 vColor;
        void main(){ vColor = aColor; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */`
        varying vec4 vColor;
        void main(){
          float a = vColor.a;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor.rgb, a);
        }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.geo = g;
    this.posArr = pos;
    this.colArr = col;
    this.colorA = new THREE.Color(0x8ce9ff);   // 头部：浅青
    this.colorB = new THREE.Color(PAL.neonPink);
  }

  push(x, y) {
    const s = this.samples;
    const tail = s.pop();
    tail.x = x; tail.y = y;
    s.unshift(tail);
  }

  setVisible(v) {
    this.mesh.visible = v;
    if (!v) this.geo.setDrawRange(0, 0);
    else this.geo.setDrawRange(0, (this.count - 1) * 6);
  }

  reset(x, y) {
    this.samples.forEach((s) => { s.x = x; s.y = y; });
  }

  update(intensity = 1, alphaScale = 1) {
    const n = this.count;
    const tmp = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const h = this.samples[i];
      const t = i / (n - 1);                     // 0 头部 → 1 尾部
      const w = this.width * (1 - t) * (1 - t) * intensity + 0.015;
      const y = Math.max(0.07, h.y);
      const z = 0.34 + i * this.spacing;
      const i6 = i * 6, i8 = i * 8;
      this.posArr[i6 + 0] = h.x - w; this.posArr[i6 + 1] = y; this.posArr[i6 + 2] = z;
      this.posArr[i6 + 3] = h.x + w; this.posArr[i6 + 4] = y; this.posArr[i6 + 5] = z;

      tmp.copy(this.colorA).lerp(this.colorB, Math.pow(t, 1.8));
      const a = Math.pow(1 - t, 2.0) * alphaScale;
      for (const v of [0, 1]) {
        const o = i8 + v * 4;
        this.colArr[o] = tmp.r; this.colArr[o + 1] = tmp.g;
        this.colArr[o + 2] = tmp.b; this.colArr[o + 3] = a;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
  }
}

/* ------------------------------------------------------------------
 * 特效池：扩散光环 + 飘字
 * ------------------------------------------------------------------ */
class FXPool {
  constructor(scene) {
    this.scene = scene;
    this.rings = [];
    this.texts = [];
    this.ringGeo = new THREE.RingGeometry(0.86, 1.0, 48);
  }

  ring(x, y, z, color = PAL.neonCyan, life = 0.55, maxR = 3.4, tilt = true) {
    let r = this.rings.find((k) => !k.active);
    if (!r) {
      const mat = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 1, side: THREE.DoubleSide, depthWrite: false,
      });
      const mesh = new THREE.Mesh(this.ringGeo, mat);
      mesh.renderOrder = 3;
      this.scene.add(mesh);
      r = { mesh, mat, active: false, t: 0, life: 1, maxR: 3, tilt };
      this.rings.push(r);
    }
    r.mesh.position.set(x, y, z);
    r.mesh.rotation.set(tilt ? -Math.PI / 2 : 0, 0, 0);
    r.mesh.scale.setScalar(0.6);
    r.mat.color.set(color);
    r.mat.opacity = 0.95;
    r.active = true; r.t = 0; r.life = life; r.maxR = maxR;
    r.mesh.visible = true;
  }

  text(x, y, z, str, color = '#2ed3ff', life = 0.85, scale = 1) {
    let t = this.texts.find((k) => !k.active);
    if (!t) {
      const cv = ART.canvas(256, 128);
      const tex = ART.toTexture(cv);
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false });
      const sp = new THREE.Sprite(mat);
      sp.renderOrder = 9;
      this.scene.add(sp);
      t = { sp, tex, cv, mat, active: false, life: 1, t: 0, scale };
      this.texts.push(t);
    }
    const cv = t.cv, ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, 256, 128);
    ctx.font = '600 76px "PingFang SC", system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 12; ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.strokeText(str, 128, 64);
    ctx.fillStyle = color;
    ctx.fillText(str, 128, 64);
    t.tex.needsUpdate = true;
    t.sp.position.set(x, y, z);
    t.sp.material.opacity = 1;
    t.t = 0; t.life = life; t.active = true; t.sp.visible = true;
    t.scale = scale;
  }

  update(dt) {
    for (const r of this.rings) {
      if (!r.active) continue;
      r.t += dt;
      const k = r.t / r.life;
      if (k >= 1) { r.active = false; r.mesh.visible = false; continue; }
      const s = lerp(0.6, r.maxR, easeOutCubic(k));
      r.mesh.scale.set(s, s, s);
      r.mat.opacity = (1 - k) * 0.85;
    }
    for (const t of this.texts) {
      if (!t.active) continue;
      t.t += dt;
      const k = t.t / t.life;
      if (k >= 1) { t.active = false; t.sp.visible = false; continue; }
      t.sp.position.y += dt * 1.5;
      t.sp.material.opacity = 1 - Math.pow(k, 2.2);
      const s = t.scale * (1 + k * 0.25);
      t.sp.scale.set(s * 1.1, s * 0.55, 1);
    }
  }

  reset() {
    for (const r of this.rings) { r.active = false; r.mesh.visible = false; }
    for (const t of this.texts) { t.active = false; t.sp.visible = false; }
  }
}
