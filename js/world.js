/* =========================================================================
 * world.js —— 无尽赛道 / 障碍物 / 能量球 / 场景环境
 *
 * 坐标约定：世界在 +z 方向滚动（玩家朝 -z 跑）。
 * 所有内容用「赛道里程 s」记录位置，渲染时 z = D - s（D = 已跑里程），
 * 这样既不会浮点漂移，回收也简单：z > 回收线就重置 s。
 * ========================================================================= */

/* 共享几何 / 材质，避免反复创建 */
const GEO = {};
const MAT = {};

function initSharedAssets() {
  if (GEO.unitBox) return;
  GEO.unitBox = new THREE.BoxGeometry(1, 1, 1);
  GEO.orb = new THREE.SphereGeometry(0.27, 18, 14);
  GEO.orbCore = new THREE.SphereGeometry(0.13, 12, 10);
  GEO.ringA = new THREE.TorusGeometry(0.36, 0.028, 8, 26);
  GEO.ringB = new THREE.TorusGeometry(0.30, 0.022, 8, 22);
  GEO.edges = new Map();
  GEO.edgeFor = (g) => {
    if (!GEO.edges.has(g)) GEO.edges.set(g, new THREE.EdgesGeometry(g));
    return GEO.edges.get(g);
  };

  MAT.stripeTex = (() => {
    const c = ART.canvas(512, 128), x = c.getContext('2d');
    x.fillStyle = ART.hex(PAL.road);
    x.fillRect(0, 0, 512, 128);
    for (let i = -8; i < 16; i++) {
      x.fillStyle = i % 2 ? 'rgba(255,255,255,0.95)' : 'rgba(150,225,255,0.55)';
      x.beginPath();
      x.moveTo(i * 44, 128); x.lineTo(i * 44 + 44, 128);
      x.lineTo(i * 44 + 44 + 60, 0); x.lineTo(i * 44 + 60, 0);
      x.closePath(); x.fill();
    }
    return ART.toTexture(c, { repeat: [3, 1] });
  })();

  MAT.warnTex = (() => {
    const c = ART.canvas(256, 64), x = c.getContext('2d');
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, 256, 64);
    x.fillStyle = ART.hex(PAL.neonYellow);
    for (let i = -2; i < 12; i++) {
      x.beginPath();
      x.moveTo(i * 32, 64); x.lineTo(i * 32 + 16, 64);
      x.lineTo(i * 32 + 16 + 22, 0); x.lineTo(i * 32 + 22, 0);
      x.closePath(); x.fill();
    }
    return ART.toTexture(c, { repeat: [4, 1] });
  })();
}

class World {
  constructor(scene, particles, fx, audio) {
    initSharedAssets();
    this.scene = scene;
    this.particles = particles;
    this.fx = fx;
    this.audio = audio;

    this.D = 0;               // 已跑里程
    this.speed = CFG.speed.base;
    this.difficulty = 0;
    this.spawning = true;
    this.nextS = 55;          // 下一次生成内容的里程
    this.hazards = [];        // 激活中的障碍物
    this.orbs = [];           // 激活中的能量球
    this.pool = { block: [], bar: [], wall: [], orb: [], bigOrb: [] };

    this._buildSky();
    this._buildLights();
    this._buildTrack();
    this._buildScenery();
  }

  /* ---------------------------------------------------------------- 天空 */
  _buildSky() {
    const geo = new THREE.SphereGeometry(520, 32, 20);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        uTop: { value: new THREE.Color(PAL.skyTop) },
        uMid: { value: new THREE.Color(PAL.skyMid) },
        uLow: { value: new THREE.Color(PAL.skyLow) },
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */`
        varying vec3 vPos;
        void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */`
        uniform vec3 uTop, uMid, uLow; uniform float uTime;
        varying vec3 vPos;
        void main(){
          float h = normalize(vPos).y;
          vec3 col = mix(uLow, uMid, smoothstep(-0.28, 0.18, h));
          col = mix(col, uTop, smoothstep(0.12, 0.9, h));
          col += vec3(0.10, 0.06, 0.02) * exp(-abs(h + 0.02) * 16.0);   // 地平线暖光
          float lines = sin(vPos.y * 1.9 - uTime * 0.6) * 0.5 + 0.5;    // 淡淡扫描线，赛博味
          col -= lines * 0.016 * smoothstep(0.55, 0.0, abs(h));
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);

    // 太阳（两层柔光叠加，避免出现生硬的圆盘边）
    const sun = new THREE.Mesh(
      new THREE.CircleGeometry(30, 48),
      new THREE.MeshBasicMaterial({ color: 0xfff6d8, fog: false })
    );
    sun.position.set(-150, 96, -430);
    this.scene.add(sun);
    const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: ART.glow(0xffeaa8, 2.0), transparent: true, opacity: 0.5, depthWrite: false, fog: false,
    }));
    sunGlow.position.copy(sun.position);
    sunGlow.scale.set(430, 430, 1);
    this.scene.add(sunGlow);
    const sunHalo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: ART.glow(0xfff3cf, 3.2), transparent: true, opacity: 0.75, depthWrite: false, fog: false,
    }));
    sunHalo.position.copy(sun.position);
    sunHalo.scale.set(190, 190, 1);
    this.scene.add(sunHalo);
    this.sunGroup = [sun, sunGlow, sunHalo];
  }

  /* ---------------------------------------------------------------- 灯光 */
  _buildLights() {
    const hemi = new THREE.HemisphereLight(0xffffff, 0xffe9f6, 0.70);
    this.scene.add(hemi);
    // 补一点环境光，避免背光面发灰发脏（浅色卡通不需要强对比）
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.24));

    const Q = CFG.quality;
    const dir = new THREE.DirectionalLight(0xfff8ff, 1.05);
    dir.position.set(9, 16, 7);
    dir.castShadow = Q.shadowSize > 0;
    if (Q.shadowSize > 0) {
      dir.shadow.mapSize.set(Q.shadowSize, Q.shadowSize);
      const E = Q.shadowExtent;
      const sc = dir.shadow.camera;
      sc.left = -E; sc.right = E; sc.top = E; sc.bottom = -E; sc.near = 1; sc.far = 55;
      dir.shadow.bias = -0.0012;
      dir.shadow.normalBias = 0.03;
    }
    this.scene.add(dir);
    this.scene.add(dir.target);
    this.dirLight = dir;

    // 两盏霓虹补光，让浅色场景也带点赛博冷/暖调
    const rimA = new THREE.DirectionalLight(0x8fe8ff, 0.35);
    rimA.position.set(-10, 6, -12);
    this.scene.add(rimA);
    const rimB = new THREE.DirectionalLight(0xffb6e7, 0.28);
    rimB.position.set(11, 5, 10);
    this.scene.add(rimB);
  }

  /* ---------------------------------------------------------------- 赛道 */
  _buildTrack() {
    const w = CFG.track.width, len = CFG.track.segLen;
    const roadTex = ART.road();
    const topMat = new THREE.MeshStandardMaterial({
      map: roadTex, roughness: 0.88, metalness: 0.0,
    });
    const sideMat = new THREE.MeshStandardMaterial({ color: 0xdfd8ff, roughness: 0.85 });
    const botMat = new THREE.MeshStandardMaterial({ color: 0xc9c0f5, roughness: 0.9 });
    // box material order: +x, -x, +y, -y, +z, -z
    const mats = [sideMat, sideMat, topMat, botMat, sideMat, sideMat];
    this.roadGeo = new THREE.BoxGeometry(w, 0.9, len);
    this.roadMats = mats;

    this.segs = [];
    for (let i = 0; i < CFG.track.segCount; i++) {
      const g = new THREE.Group();
      const slab = new THREE.Mesh(this.roadGeo, mats);
      slab.position.y = -0.45;
      slab.receiveShadow = true;
      g.add(slab);

      // 两侧霓虹轨道条
      for (const sx of [-1, 1]) {
        const color = sx < 0 ? PAL.neonCyan : PAL.neonPink;
        const rail = new THREE.Mesh(GEO.unitBox, new THREE.MeshBasicMaterial({ color }));
        rail.scale.set(0.18, 0.16, len);
        rail.position.set(sx * (w / 2 - 0.14), 0.06, 0);
        g.add(rail);

        // 地面上的霓虹光晕
        const glowPlane = new THREE.Mesh(
          new THREE.PlaneGeometry(2.0, len),
          new THREE.MeshBasicMaterial({
            map: ART.glow(color, 1.7), transparent: true, opacity: 0.45,
            depthWrite: false, color,
          })
        );
        glowPlane.rotation.x = -Math.PI / 2;
        glowPlane.position.set(sx * (w / 2 - 0.5), 0.03, 0);
        glowPlane.renderOrder = 1;
        g.add(glowPlane);

        // 侧面光带（手机端省掉这层大面积透明叠加，填充率是移动端最大的瓶颈）
        if (CFG.quality.glow) {
          const sideGlow = new THREE.Mesh(
            new THREE.PlaneGeometry(len, 1.3),
            new THREE.MeshBasicMaterial({ map: ART.glow(color, 1.6), transparent: true, opacity: 0.42, depthWrite: false, color })
          );
          sideGlow.rotation.y = sx < 0 ? Math.PI / 2 : -Math.PI / 2;
          sideGlow.position.set(sx * (w / 2 + 0.02), -0.3, 0);
          sideGlow.renderOrder = 1;
          g.add(sideGlow);
        }

        // 赛道下沿的霓虹底边：让「漂浮感」更明确
        const underLine = new THREE.Mesh(GEO.unitBox, new THREE.MeshBasicMaterial({ color }));
        underLine.scale.set(0.14, 0.1, len);
        underLine.position.set(sx * (w / 2 - 0.02), -0.88, 0);
        g.add(underLine);
      }

      // 侧边灯柱 / 广告牌
      g.userData.props = this._buildSegmentProps(i, g);

      this.scene.add(g);
      this.segs.push({ group: g, k: null });
    }

    // 云海（赛道下方），让人感觉赛道漂在空中
    // 注意：所有云海平面必须「不重叠」且 y 略有差异，否则共面会 z-fighting 出横条纹
    this.seaTiles = [];
    this.seaGeo = new THREE.PlaneGeometry(260, 260);
    this.seaMat = new THREE.MeshBasicMaterial({ map: ART.sea(), fog: true });
    for (let i = 0; i < CFG.quality.sea; i++) {
      const t = new THREE.Mesh(this.seaGeo, this.seaMat);
      t.rotation.x = -Math.PI / 2;
      t.position.set(rand(-14, 14), -8.2 - i * 0.35, 0);
      this.scene.add(t);
      this.seaTiles.push({ mesh: t, s: i * 240 });
    }

    // 天空中的云
    this.cloudSprites = [];
    for (let i = 0; i < CFG.quality.clouds; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: ART.cloud(), transparent: true, opacity: rand(0.6, 0.95), depthWrite: false, fog: false,
      }));
      const scale = rand(18, 44);
      sp.scale.set(scale, scale * 0.5, 1);
      sp.position.set(rand(-70, 70), rand(6, 34), 0);
      this.scene.add(sp);
      this.cloudSprites.push({ sp, s: i * 30, par: rand(0.35, 0.6) });
    }
  }

  /* 赛道两侧的装饰（灯柱 + 悬浮广告牌）
     返回「道具组」列表，每组包含若干网格，方便整组显隐做节奏变化 */
  _buildSegmentProps(i, group) {
    const w = CFG.track.width, len = CFG.track.segLen;
    const groups = [];
    const rng = (n) => {
      // 每段固定随机（可复现），避免复用同一段时闪烁
      const x = Math.sin((i + 1) * 12.9898 + n * 78.233) * 43758.5453;
      return x - Math.floor(x);
    };

    for (let k = 0; k < 2; k++) {
      const z = -len * 0.25 - k * len * 0.5;
      for (const sx of [-1, 1]) {
        if (rng(k * 3 + (sx > 0 ? 1 : 0)) < 0.35) continue;
        const objs = [];
        const h = rand(2.6, 4.2);
        const pole = new THREE.Mesh(GEO.unitBox, new THREE.MeshStandardMaterial({ color: 0xe6ebff, roughness: 0.7 }));
        pole.scale.set(0.13, h, 0.13);
        pole.position.set(sx * (w / 2 + 1.5), h / 2, z);
        pole.castShadow = true;
        group.add(pole); objs.push(pole);

        const color = pick([PAL.neonCyan, PAL.neonPink, PAL.neonLime, PAL.neonPurple, PAL.neonYellow]);
        const bulb = new THREE.Mesh(GEO.unitBox, new THREE.MeshBasicMaterial({ color }));
        bulb.scale.set(0.34, 0.34, 0.34);
        bulb.position.set(sx * (w / 2 + 1.5), h + 0.16, z);
        group.add(bulb); objs.push(bulb);

        const halo = new THREE.Sprite(new THREE.SpriteMaterial({
          map: ART.glow(color, 2.0), transparent: true, opacity: 0.6, depthWrite: false,
        }));
        halo.position.copy(bulb.position);
        halo.scale.set(3.4, 3.4, 1);
        group.add(halo); objs.push(halo);

        groups.push({ type: 'pole', objs });
      }
    }

    // 悬浮广告牌
    for (let k = 0; k < 2; k++) {
      if (rng(10 + k) < 0.45) continue;
      const objs = [];
      const sx = rng(20 + k) < 0.5 ? -1 : 1;
      const bh = rand(2.2, 4.6), bw = rand(2.4, 4.2);
      const color = pick(PAL.obstacle);
      const board = new THREE.Mesh(
        new THREE.BoxGeometry(bw, bh, 0.4),
        new THREE.MeshStandardMaterial({ map: ART.windows(color), color: 0xffffff, roughness: 0.65 })
      );
      board.position.set(sx * (w / 2 + rand(4.5, 9)), rand(1.2, 5.0), -len * (0.2 + k * 0.55));
      board.rotation.y = -sx * rand(0.12, 0.4);
      board.castShadow = true;
      group.add(board); objs.push(board);

      const frame = new THREE.Mesh(
        new THREE.BoxGeometry(bw + 0.16, bh + 0.16, 0.2),
        new THREE.MeshBasicMaterial({ color: pick([PAL.neonCyan, PAL.neonPink, PAL.neonLime, PAL.neonPurple]) })
      );
      frame.position.copy(board.position);
      frame.position.z -= 0.06;
      frame.rotation.copy(board.rotation);
      group.add(frame); objs.push(frame);

      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: ART.glow(frame.material.color.getHex(), 1.9), transparent: true, opacity: 0.35, depthWrite: false,
      }));
      halo.position.copy(board.position);
      halo.position.z -= 0.3;
      halo.scale.set(bw * 2.6, bh * 2.4, 1);
      group.add(halo); objs.push(halo);

      groups.push({ type: 'board', objs });
    }
    return groups;
  }

  /* 远景天际线（视差更慢，制造纵深） */
  _buildScenery() {
    this.skyline = [];
    for (let i = 0; i < CFG.quality.skyline; i++) {
      const h = rand(10, 38), w = rand(6, 14), d = rand(6, 14);
      const color = pick([0xe9eeff, 0xeee6ff, 0xe6f2ff]);
      const b = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshStandardMaterial({ map: i % 3 ? null : ART.windows(color), color, roughness: 0.85, fog: true })
      );
      const sx = Math.random() < 0.5 ? -1 : 1;
      b.position.set(sx * rand(46, 120), -6 + h / 2 + rand(-4, 6), 0);
      b.rotation.y = rand(-0.5, 0.5);
      this.scene.add(b);

      const cap = new THREE.Mesh(GEO.unitBox, new THREE.MeshBasicMaterial({
        color: pick([PAL.neonCyan, PAL.neonPink, PAL.neonPurple, PAL.neonLime]),
      }));
      cap.scale.set(w * 1.02, 0.5, d * 1.02);
      cap.position.set(0, h / 2 + 0.2, 0);
      b.add(cap);

      this.skyline.push({ b, s: i * 58 + rand(0, 30) });
    }
  }

  /* ================================================================
   * 物体池
   * ================================================================ */
  _acquire(kind) {
    const p = this.pool[kind];
    for (const o of p) if (!o.active) return o;
    if (p.length >= (kind === 'orb' ? 150 : kind === 'bigOrb' ? 30 : 28)) return null;
    const o = this._create(kind);
    p.push(o);
    return o;
  }

  _create(kind) {
    const g = new THREE.Group();
    let data = {};
    if (kind === 'block') data = this._makeBlock(g);
    else if (kind === 'bar') data = this._makeBar(g);
    else if (kind === 'wall') data = this._makeWall(g);
    else data = this._makeOrb(g, kind === 'bigOrb');
    g.visible = false;
    this.scene.add(g);
    return { mesh: g, active: false, kind, data, s: 0, spin: 0 };
  }

  /* 低矮方块：跳过去（或绕开） */
  _makeBlock(g) {
    const w = 1.85, h = 1.15, d = 1.3;
    const color = pick(PAL.obstacle);
    const colorC = new THREE.Color(color);
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({
      color, roughness: 0.5, metalness: 0.05, emissive: color, emissiveIntensity: 0.12,
    }));
    body.position.y = h / 2;
    body.castShadow = true;
    g.add(body);

    const top = new THREE.Mesh(new THREE.BoxGeometry(w * 0.94, 0.08, d * 0.94), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    top.position.y = h + 0.02;
    g.add(top);

    // 用比本体更深的同色描边，浅色世界里更容易一眼看清
    const edgeC = colorC.clone().lerp(new THREE.Color(0x2f3358), 0.42);
    const edge = new THREE.LineSegments(GEO.edgeFor(body.geometry), new THREE.LineBasicMaterial({ color: edgeC }));
    edge.position.y = h / 2;
    g.add(edge);

    for (const sx of [-1, 1]) {
      const strip = new THREE.Mesh(GEO.unitBox, new THREE.MeshBasicMaterial({ color: PAL.neonCyan }));
      strip.scale.set(0.1, 0.1, d * 1.02);
      strip.position.set(sx * w / 2, h * 0.62, 0);
      g.add(strip);
    }

    this._addHalo(g, color, w + 1.2, h + 1.2, h * 0.55);
    return { x: 0, halfW: w / 2, yMin: 0, yMax: h, halfD: d / 2, kind: 'block' };
  }

  /* 全宽低矮横杆：必须滑铲通过 */
  _makeBar(g) {
    const w = CFG.track.width, h = 1.05, d = 0.7;
    const y0 = 1.30;
    const bodyMat = new THREE.MeshStandardMaterial({ map: MAT.stripeTex, roughness: 0.6 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bodyMat);
    body.position.y = y0 + h / 2;
    body.castShadow = true;
    g.add(body);

    const edge = new THREE.LineSegments(GEO.edgeFor(body.geometry), new THREE.LineBasicMaterial({ color: PAL.neonPink }));
    edge.position.y = y0 + h / 2;
    g.add(edge);

    // 下沿霓虹条 + 警示条
    const under = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, d * 1.1), new THREE.MeshBasicMaterial({ color: PAL.neonPink }));
    under.position.y = y0 + 0.02;
    g.add(under);

    const warn = new THREE.Mesh(
      new THREE.PlaneGeometry(w, 0.5),
      new THREE.MeshBasicMaterial({ map: MAT.warnTex, transparent: true, side: THREE.DoubleSide })
    );
    warn.position.set(0, y0 + h * 0.5, d / 2 + 0.02);
    g.add(warn);
    const warn2 = warn.clone();
    warn2.position.z = -d / 2 - 0.02;
    warn2.rotation.y = Math.PI;
    g.add(warn2);

    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(GEO.unitBox, new THREE.MeshStandardMaterial({ color: 0xe8edff, roughness: 0.6 }));
      post.scale.set(0.24, y0 + 0.4, 0.24);
      post.position.set(sx * (w / 2 - 0.2), (y0 + 0.4) / 2, 0);
      post.castShadow = true;
      g.add(post);
      const lamp = new THREE.Mesh(GEO.unitBox, new THREE.MeshBasicMaterial({ color: PAL.neonYellow }));
      lamp.scale.set(0.34, 0.2, 0.34);
      lamp.position.set(sx * (w / 2 - 0.2), y0 + h + 0.16, 0);
      g.add(lamp);
      this._addHaloAt(g, PAL.neonYellow, 2.6, lamp.position.clone());
    }

    this._addHalo(g, PAL.neonPink, w, h + 2.2, y0 + h * 0.5);
    return { x: 0, halfW: w / 2, yMin: y0, yMax: y0 + h, halfD: d / 2, kind: 'bar' };
  }

  /* 高墙：只能左右闪避 */
  _makeWall(g) {
    const w = 3.0, h = 2.9, d = 1.0;
    const color = pick([PAL.neonPurple, PAL.neonCyan, PAL.neonPink]);
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({
      color: 0xe9e6ff, roughness: 0.55, emissive: color, emissiveIntensity: 0.06,
    }));
    body.position.y = h / 2;
    body.castShadow = true;
    g.add(body);

    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(w * 0.86, h * 0.9),
      new THREE.MeshBasicMaterial({ map: ART.windows(color), transparent: false })
    );
    panel.position.set(0, h * 0.52, d / 2 + 0.02);
    g.add(panel);
    const panel2 = panel.clone();
    panel2.position.z = -d / 2 - 0.02;
    panel2.rotation.y = Math.PI;
    g.add(panel2);

    const edge = new THREE.LineSegments(GEO.edgeFor(body.geometry), new THREE.LineBasicMaterial({ color: PAL.neonCyan }));
    edge.position.y = h / 2;
    g.add(edge);

    for (let i = 0; i < 3; i++) {
      const strip = new THREE.Mesh(GEO.unitBox, new THREE.MeshBasicMaterial({ color: i % 2 ? PAL.neonCyan : PAL.neonPink }));
      strip.scale.set(w * 1.01, 0.08, 0.08);
      strip.position.y = 0.6 + i * 0.85;
      g.add(strip);
    }

    this._addHalo(g, color, w + 1.6, h + 1.6, h * 0.5);
    return { x: 0, halfW: w / 2, yMin: 0, yMax: h, halfD: d / 2, kind: 'wall' };
  }

  /* 能量球 */
  _makeOrb(g, big) {
    const color = big ? PAL.neonYellow : PAL.neonCyan;
    const core = new THREE.Mesh(big ? GEO.orb : GEO.orbCore, new THREE.MeshBasicMaterial({ color: 0xffffff }));
    const shell = new THREE.Mesh(GEO.orb, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: big ? 0.85 : 0.7,
    }));
    const ra = new THREE.Mesh(GEO.ringA, new THREE.MeshBasicMaterial({ color: big ? PAL.neonPink : PAL.neonPurple }));
    const rb = new THREE.Mesh(GEO.ringB, new THREE.MeshBasicMaterial({ color: PAL.neonCyan }));
    g.add(shell, core, ra, rb);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: ART.glow(color, 1.8), transparent: true, opacity: 0.8, depthWrite: false,
    }));
    halo.scale.set(1.5, 1.5, 1);
    g.add(halo);
    if (big) g.scale.setScalar(1.35);
    g.userData.rings = [ra, rb];
    return { r: big ? 0.55 : 0.40, big, color };
  }

  _addHalo(g, color, w, h, y) {
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: ART.glow(color, 1.8), transparent: true, opacity: 0.42, depthWrite: false,
    }));
    halo.position.set(0, y, 0);
    halo.scale.set(w * 1.9, h * 1.7, 1);
    g.add(halo);
  }
  _addHaloAt(g, color, size, pos) {
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: ART.glow(color, 1.9), transparent: true, opacity: 0.5, depthWrite: false,
    }));
    halo.position.copy(pos);
    halo.scale.set(size, size, 1);
    g.add(halo);
  }

  /* ================================================================
   * 关卡规划（在赛道里程上前进）
   * ================================================================ */
  _planNext() {
    const d = this.difficulty;
    const lanes = [-3.1, 0, 3.1];
    const r = Math.random();

    let gapT;                    // 与下一个事件的时间间隔（秒）
    const ev = [];

    if (d < 0.16) {
      // 入门：只有低矮方块 + 能量球
      if (r < 0.62) {
        const lx = pick(lanes);
        ev.push({ t: 'hazard', kind: 'block', x: lx });
        ev.push({ t: 'orbArc', x: lx, n: 5 });
      } else {
        ev.push({ t: 'orbLine', x: pick(lanes), n: randInt(4, 6) });
      }
      gapT = rand(0.95, 1.35);
    } else if (d < 0.34) {
      if (r < 0.30) {
        const lx = pick(lanes);
        ev.push({ t: 'hazard', kind: 'block', x: lx });
        if (Math.random() < 0.5) ev.push({ t: 'orbArc', x: lx, n: 5 });
      } else if (r < 0.52) {
        ev.push({ t: 'hazard', kind: 'bar' });
        ev.push({ t: 'orbLine', x: pick(lanes), n: 4 });
      } else if (r < 0.72) {
        ev.push({ t: 'hazard', kind: 'wall', x: pick(lanes) });
        ev.push({ t: 'orbLine', x: pick(lanes), n: 4 });
      } else {
        ev.push({ t: 'orbLine', x: pick(lanes), n: randInt(5, 7) });
      }
      gapT = rand(0.88, 1.22);
    } else if (d < 0.62) {
      if (r < 0.26) {
        ev.push({ t: 'hazard', kind: 'block', x: pick(lanes) });
        ev.push({ t: 'orbArc', x: pick(lanes), n: 5 });
      } else if (r < 0.46) {
        ev.push({ t: 'hazard', kind: 'bar' });
        ev.push({ t: 'orbLine', x: pick(lanes), n: 4 });
      } else if (r < 0.66) {
        // 双墙，留一条通路
        const free = randInt(0, 2);
        const blocked = lanes.filter((_, i) => i !== free);
        blocked.forEach((x) => ev.push({ t: 'hazard', kind: 'wall', x }));
        ev.push({ t: 'orbLine', x: lanes[free], n: 5 });
      } else if (r < 0.84) {
        const two = [...lanes].sort(() => Math.random() - 0.5).slice(0, 2);
        two.forEach((x) => ev.push({ t: 'hazard', kind: 'block', x }));
        ev.push({ t: 'orbArc', x: pick(lanes), n: 4 });
      } else {
        ev.push({ t: 'orbLine', x: pick(lanes), n: randInt(6, 9) });
      }
      gapT = rand(0.80, 1.10);
    } else {
      if (r < 0.28) {
        const two = [...lanes].sort(() => Math.random() - 0.5).slice(0, 2);
        two.forEach((x) => ev.push({ t: 'hazard', kind: 'block', x }));
        ev.push({ t: 'orbArc', x: pick(two), n: 5 });
      } else if (r < 0.48) {
        ev.push({ t: 'hazard', kind: 'bar' });
        ev.push({ t: 'orbLine', x: pick(lanes), n: 5 });
      } else if (r < 0.70) {
        const free = randInt(0, 2);
        const blocked = lanes.filter((_, i) => i !== free);
        blocked.forEach((x) => ev.push({ t: 'hazard', kind: 'wall', x }));
        ev.push({ t: 'orbLine', x: lanes[free], n: 6 });
      } else if (r < 0.88) {
        // 连招：方块 + 紧随其后的横杆（考验跳跃后立刻滑铲）
        const lx = pick(lanes);
        ev.push({ t: 'hazard', kind: 'block', x: lx, then: 0.55 });
        ev.push({ t: 'hazard', kind: 'bar', delayT: 0.6 });
        ev.push({ t: 'orbArc', x: lx, n: 4 });
      } else {
        ev.push({ t: 'orbLine', x: pick(lanes), n: randInt(7, 10) });
      }
      gapT = rand(0.72, 1.02);
    }

    const gap = clamp(this.speed * gapT, 15, 95);
    // 需要横穿两条道的双墙，后面留更宽裕的间隔，避免出现「来不及反应」的死局
    const walls = ev.filter((e) => e.t === 'hazard' && e.kind === 'wall').length;
    const room = walls >= 2 ? 1.18 : 1;
    return { ev, gap: gap * room };
  }

  _spawnEvents(ev, s, gap) {
    for (const e of ev) {
      const at = s + (e.delayT ? this.speed * e.delayT : 0);
      if (e.t === 'hazard') this._spawnHazard(e.kind, at, e.x || 0);
      else if (e.t === 'orbLine') this._spawnOrbLine(at, e.x, e.n);
      else if (e.t === 'orbArc') this._spawnOrbArc(at, e.x, e.n);
    }
  }

  _spawnHazard(kind, s, x) {
    const o = this._acquire(kind);
    if (!o) return;
    o.active = true;
    o.s = s;
    o.mesh.visible = true;
    o.mesh.position.set(x + (o.data.x || 0), 0, this.D - s);
    o.data.worldX = x + (o.data.x || 0);
    o.hit = false;
    this.hazards.push(o);
  }

  _spawnOrbLine(s, x, n) {
    const step = 1.5;
    for (let i = 0; i < n; i++) {
      const isBig = i === Math.floor(n / 2) && Math.random() < 0.45;
      this._spawnOrb(s + i * step, x, isBig ? 1.25 : 0.95, isBig);
    }
  }
  _spawnOrbArc(s, x, n) {
    const span = 9;
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      this._spawnOrb(s + t * span, x, 0.95 + Math.sin(t * Math.PI) * 1.75, false);
    }
  }
  _spawnOrb(s, x, y, big) {
    const o = this._acquire(big ? 'bigOrb' : 'orb');
    if (!o) return;
    o.active = true;
    o.s = s;
    o.baseY = y;
    o.taken = false;
    o.spin = rand(0, 6.28);
    o.mesh.visible = true;
    o.mesh.position.set(x, y, this.D - s);
    this.orbs.push(o);
  }

  /* ================================================================
   * 每帧更新
   * ================================================================ */
  update(dt, D, speed, difficulty, playerX) {
    this.D = D;
    this.speed = speed;
    this.difficulty = difficulty;
    const segLen = CFG.track.segLen;
    const baseK = Math.floor(D / segLen);

    // 赛道段：k = baseK + i 保证最近的一段「中心」落在 [0,20)，从而盖住玩家所在的 z=0
    for (let i = 0; i < this.segs.length; i++) {
      const seg = this.segs[i];
      const k = baseK + i;
      const s = k * segLen;
      seg.group.position.z = D - s;
      if (seg.k !== k) {
        seg.k = k;
        this._dressSegment(seg.group, k);
      }
    }

    // 生成新内容（雾外生成，玩家看不到弹出）
    if (this.spawning) {
      let guard = 0;
      while (this.nextS - D < CFG.fx.spawnAhead && guard++ < 16) {
        const plan = this._planNext();
        this._spawnEvents(plan.ev, this.nextS, plan.gap);
        this.nextS += plan.gap;
      }
    }

    // 障碍物
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const o = this.hazards[i];
      o.mesh.position.z = D - o.s;
      if (o.mesh.position.z > CFG.track.recycleZ) {
        o.active = false;
        o.mesh.visible = false;
        this.hazards.splice(i, 1);
      }
    }

    // 能量球（自转 + 上下浮动）
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i];
      const z = D - o.s;
      o.mesh.position.z = z;
      o.spin += dt * 2.4;
      o.mesh.position.y = o.baseY + Math.sin(o.spin * 1.4) * 0.12;
      const rings = o.mesh.userData.rings;
      if (rings) {
        rings[0].rotation.set(o.spin * 1.3, o.spin * 0.7, 0);
        rings[1].rotation.set(0, o.spin * 1.1, o.spin * 1.5);
      }
      const s = 1 + Math.sin(o.spin * 3) * 0.05;
      o.mesh.scale.setScalar((o.data.big ? 1.35 : 1) * s);
      if (z > CFG.track.recycleZ) {
        o.active = false;
        o.mesh.visible = false;
        this.orbs.splice(i, 1);
      }
    }

    // 云海 / 云（视差）
    for (const t of this.seaTiles) {
      // 回收阈值必须 ≥ 平铺间距，否则玩家脚下会出现没有云海的空洞
      let z = D - t.s;
      if (z > 240) { t.s += this.seaTiles.length * 240; z = D - t.s; }
      t.mesh.position.z = z;
    }
    for (const c of this.cloudSprites) {
      let z = (D * c.par) - c.s;
      if (z > 120) { c.s += this.cloudSprites.length * 30; z = D * c.par - c.s; }
      c.sp.position.z = z;
    }
    for (const b of this.skyline) {
      let z = (D * 0.34) - b.s;
      if (z > 120) { b.s += this.skyline.length * 58; z = D * 0.34 - b.s; }
      b.b.position.z = z;
    }

    // 天空跟随相机（避免看到边界）
    this.sky.position.set(playerX * 0.25, 0, 0);
    this.sky.material.uniforms.uTime.value += dt;
    for (const s of this.sunGroup) s.position.x = playerX * 0.25 - 150;

    // 阴影相机跟随
    this.dirLight.position.set(playerX + 9, 16, 7);
    this.dirLight.target.position.set(playerX, 0, -2);
    this.dirLight.target.updateMatrixWorld();
  }

  /* 按里程做道具节奏变化（避免完全重复的观感） */
  _dressSegment(group, k) {
    const groups = group.userData.props;
    if (!groups) return;
    const p = ((k * 2654435761) % 97) / 97;
    for (const g of groups) {
      let hide = false;
      if (g.type === 'pole' && p < 0.20) hide = true;
      if (g.type === 'board' && p > 0.86) hide = true;
      for (const o of g.objs) o.visible = !hide;
    }
  }

  /* 开局预填充：把 250 单位内的关卡一次性铺好（都在雾里，看不见弹出） */
  prefill(runway = 140) {
    this.nextS = this.D + runway;
    let guard = 0;
    while (this.nextS - this.D < CFG.fx.spawnAhead && guard++ < 20) {
      const plan = this._planNext();
      this._spawnEvents(plan.ev, this.nextS, plan.gap);
      this.nextS += plan.gap;
    }
  }

  reset() {
    this.D = 0;
    this.nextS = 55;
    this.difficulty = 0;
    for (const o of this.hazards) { o.active = false; o.mesh.visible = false; }
    for (const o of this.orbs) { o.active = false; o.mesh.visible = false; }
    this.hazards.length = 0;
    this.orbs.length = 0;
    this.segs.forEach((s) => { s.k = null; });
  }
}
