/* =========================================================================
 * art.js —— 程序化贴图（全部用 Canvas 现画，0 外部素材，可离线运行）
 * ========================================================================= */

const ART = (() => {
  const cache = {};

  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  function hex(n) {
    return '#' + n.toString(16).padStart(6, '0');
  }
  function rgba(n, a) {
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return `rgba(${r},${g},${b},${a})`;
  }

  function toTexture(c, opts = {}) {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    if (opts.repeat) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(opts.repeat[0], opts.repeat[1]);
    }
    return t;
  }

  /* 往白色方向提亮，做马卡龙色 */
  function lighten(n, amt) {
    const c = new THREE.Color(n).lerp(new THREE.Color(0xffffff), amt);
    return '#' + c.getHexString();
  }

  /* ---------- 柔和光点（粒子用） ---------- */
  function softDot() {
    if (cache.dot) return cache.dot;
    const c = canvas(128, 128), x = c.getContext('2d');
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0.0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.92)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.34)');
    g.addColorStop(1.0, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
    cache.dot = toTexture(c);
    return cache.dot;
  }

  /* ---------- 四角星闪烁（拾取 / 高分表现） ---------- */
  function sparkle() {
    if (cache.sparkle) return cache.sparkle;
    const c = canvas(128, 128), x = c.getContext('2d');
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 40);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.5)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.beginPath(); x.arc(64, 64, 40, 0, Math.PI * 2); x.fill();
    x.globalCompositeOperation = 'lighter';
    x.strokeStyle = 'rgba(255,255,255,0.85)';
    x.lineWidth = 5; x.lineCap = 'round';
    x.beginPath(); x.moveTo(64, 6); x.lineTo(64, 122); x.moveTo(6, 64); x.lineTo(122, 64); x.stroke();
    cache.sparkle = toTexture(c);
    return cache.sparkle;
  }

  /* ---------- 圆形光晕（霓虹发光贴片） ---------- */
  function glow(color = 0xffffff, power = 2.4) {
    const key = 'glow' + color + power;
    if (cache[key]) return cache[key];
    const c = canvas(256, 256), x = c.getContext('2d');
    const img = x.createImageData(256, 256);
    const r = (color >> 16) & 255, g2 = (color >> 8) & 255, b = color & 255;
    for (let y = 0; y < 256; y++) {
      for (let xx = 0; xx < 256; xx++) {
        const dx = (xx - 128) / 128, dy = (y - 128) / 128;
        const d = Math.min(1, Math.sqrt(dx * dx + dy * dy));
        const a = Math.pow(1 - d, power);
        const i = (y * 256 + xx) * 4;
        img.data[i] = r; img.data[i + 1] = g2; img.data[i + 2] = b;
        img.data[i + 3] = Math.max(0, Math.min(255, a * 255));
      }
    }
    x.putImageData(img, 0, 0);
    cache[key] = toTexture(c);
    return cache[key];
  }

  /* ---------- 云朵 ---------- */
  function cloud() {
    if (cache.cloud) return cache.cloud;
    const c = canvas(512, 256), x = c.getContext('2d');
    const blobs = [
      [150, 150, 92], [250, 118, 116], [352, 152, 88], [206, 168, 86],
      [300, 172, 80], [110, 176, 58], [400, 180, 54],
    ];
    x.globalCompositeOperation = 'lighter';
    for (const [bx, by, br] of blobs) {
      const g = x.createRadialGradient(bx, by - br * 0.2, br * 0.1, bx, by, br);
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(0.62, 'rgba(255,255,255,0.72)');
      g.addColorStop(1, 'rgba(233,244,255,0)');
      x.fillStyle = g;
      x.beginPath(); x.arc(bx, by, br, 0, Math.PI * 2); x.fill();
    }
    // 底部淡淡的粉蓝色冷调，避免纯白死板
    const shade = x.createLinearGradient(0, 150, 0, 256);
    shade.addColorStop(0, 'rgba(198,226,255,0)');
    shade.addColorStop(1, 'rgba(196,220,255,0.35)');
    x.globalCompositeOperation = 'source-atop';
    x.fillStyle = shade;
    x.fillRect(0, 0, 512, 256);
    cache.cloud = toTexture(c);
    return cache.cloud;
  }

  /* ---------- 赛道地面贴图 ---------- */
  function road() {
    if (cache.road) return cache.road;
    const W = 512, H = 1024;              // 对应 9.6 x 20 世界单位
    const c = canvas(W, H), x = c.getContext('2d');
    const ux = W / CFG.track.width;       // 每世界单位的像素
    const uz = H / CFG.track.segLen;

    x.fillStyle = '#f2eeff';
    x.fillRect(0, 0, W, H);

    // 深浅交替的横向色带（像柔软的跑道）
    const band = 2 * uz;
    for (let i = 0; i < H / band; i++) {
      x.fillStyle = i % 2 ? 'rgba(214,206,250,0.32)' : 'rgba(255,255,255,0.22)';
      x.fillRect(0, i * band, W, band);
    }

    // 纵向引导线（帮助判断左右位置）
    for (let gx = -4; gx <= 4; gx++) {
      const px = W / 2 + gx * 1.2 * ux;
      const strong = gx % 2 === 0;
      x.strokeStyle = strong ? 'rgba(102,205,255,0.62)' : 'rgba(150,190,255,0.34)';
      x.lineWidth = strong ? 3.5 : 2;
      x.setLineDash(strong ? [30, 20] : [12, 26]);
      x.beginPath(); x.moveTo(px, 0); x.lineTo(px, H); x.stroke();
    }
    x.setLineDash([]);

    // 横向扫描线（速度感）
    for (let i = 0; i < 10; i++) {
      const py = i * (H / 10);
      const g = x.createLinearGradient(0, py - 14, 0, py + 14);
      g.addColorStop(0, 'rgba(255,150,220,0)');
      g.addColorStop(0.5, 'rgba(255,140,215,0.30)');
      g.addColorStop(1, 'rgba(255,150,220,0)');
      x.fillStyle = g;
      x.fillRect(0, py - 14, W, 28);
    }

    // 两侧霓虹边线
    const edge = 14;
    const gradL = x.createLinearGradient(0, 0, edge * 3, 0);
    gradL.addColorStop(0, 'rgba(24,196,255,1)');
    gradL.addColorStop(0.55, 'rgba(53,216,255,0.55)');
    gradL.addColorStop(1, 'rgba(53,216,255,0)');
    x.fillStyle = gradL; x.fillRect(0, 0, edge * 3, H);
    const gradR = x.createLinearGradient(W, 0, W - edge * 3, 0);
    gradR.addColorStop(0, 'rgba(255,64,190,1)');
    gradR.addColorStop(0.55, 'rgba(255,111,216,0.55)');
    gradR.addColorStop(1, 'rgba(255,111,216,0)');
    x.fillStyle = gradR; x.fillRect(W - edge * 3, 0, edge * 3, H);

    // 段头段尾边条，滚动时更有节奏
    x.fillStyle = 'rgba(150,120,255,0.34)';
    x.fillRect(0, 0, W, 5);
    x.fillRect(0, H - 5, W, 5);

    cache.road = toTexture(c);
    return cache.road;
  }

  /* ---------- 云海（赛道下方） ---------- */
  function sea() {
    if (cache.sea) return cache.sea;
    const S = 512;
    const c = canvas(S, S), x = c.getContext('2d');
    // 淡蓝色的云海底色，让赛道看起来漂在空中
    const bg = x.createLinearGradient(0, 0, 0, S);
    bg.addColorStop(0, '#cfe6ff');
    bg.addColorStop(1, '#bcd9f7');
    x.fillStyle = bg;
    x.fillRect(0, 0, S, S);
    x.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 110; i++) {
      const bx = Math.random() * S, by = Math.random() * S;
      const br = rand(36, 120);
      const g = x.createRadialGradient(bx, by, 0, bx, by, br);
      g.addColorStop(0, 'rgba(255,255,255,0.85)');
      g.addColorStop(0.6, 'rgba(255,255,255,0.45)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g;
      x.beginPath(); x.arc(bx, by, br, 0, Math.PI * 2); x.fill();
    }
    // 一点冷调阴影，增加体积感
    x.globalCompositeOperation = 'source-atop';
    for (let i = 0; i < 44; i++) {
      const bx = Math.random() * S, by = Math.random() * S;
      const br = rand(30, 90);
      const g = x.createRadialGradient(bx, by, 0, bx, by, br);
      g.addColorStop(0, 'rgba(150,186,230,0.32)');
      g.addColorStop(1, 'rgba(150,186,230,0)');
      x.fillStyle = g;
      x.beginPath(); x.arc(bx, by, br, 0, Math.PI * 2); x.fill();
    }
    cache.sea = toTexture(c, { repeat: [1, 1] });
    return cache.sea;
  }

  /* ---------- 霓虹招牌贴图（悬浮广告牌 / 建筑面板） ---------- */
  function windows(baseColor) {
    const key = 'win' + baseColor;
    if (cache[key]) return cache[key];
    const W = 256, H = 512;
    const c = canvas(W, H), x = c.getContext('2d');
    // 浅色底 + 大块霓虹招牌，避免远看变成一团灰
    x.fillStyle = lighten(baseColor, 0.62);
    x.fillRect(0, 0, W, H);
    x.fillStyle = 'rgba(255,255,255,0.55)';
    x.fillRect(0, 0, W, H);

    const panelColors = [PAL.neonCyan, PAL.neonPink, PAL.neonLime, PAL.neonYellow, PAL.neonPurple];
    const rows = 4;
    for (let r = 0; r < rows; r++) {
      const ph = H / rows;
      const py = r * ph + ph * 0.14;
      const pw = rand(W * 0.42, W * 0.76);
      const px = rand(10, W - pw - 10);
      const color = pick(panelColors);
      // 招牌底光
      const g = x.createLinearGradient(px, py, px + pw, py + ph * 0.6);
      g.addColorStop(0, rgba(color, 0.95));
      g.addColorStop(1, rgba(color, 0.55));
      x.fillStyle = g;
      x.fillRect(px, py, pw, ph * 0.58);
      // 白色描边
      x.strokeStyle = 'rgba(255,255,255,0.9)';
      x.lineWidth = 4;
      x.strokeRect(px, py, pw, ph * 0.58);
      // 招牌上的小字条
      x.fillStyle = 'rgba(255,255,255,0.85)';
      for (let k = 0; k < 3; k++) {
        x.fillRect(px + 10 + k * (pw / 3.4), py + ph * 0.3, pw / 5, 6);
      }
    }
    // 上下霓虹边条
    x.fillStyle = rgba(pick(panelColors), 0.9);
    x.fillRect(0, 0, W, 7);
    x.fillRect(0, H - 7, W, 7);
    cache[key] = toTexture(c);
    return cache[key];
  }

  return { softDot, sparkle, glow, cloud, road, sea, windows, lighten, hex, rgba, toTexture, canvas };
})();
