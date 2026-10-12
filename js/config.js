/* =========================================================================
 * config.js —— 全局参数与配色
 * 风格定位：浅色小清新卡通 × 赛博朋克霓虹
 *   · 底子用大量白色 / 马卡龙pastel，保证「清新、明亮、可爱」
 *   · 霓虹只用细亮线、发光贴片与粒子点缀，制造赛博感
 * ========================================================================= */

const CFG = {
  track: {
    width: 9.6,        // 赛道宽度（x 轴）
    segLen: 20,        // 单个赛道段长度（z 轴）
    segCount: 14,      // 循环复用的赛道段数量（务必让最远一段超过雾距，最近一段盖住玩家身后）
    recycleZ: 24,      // 超过这个 z 就回收到最前方
  },

  player: {
    halfW: 0.42,       // 碰撞盒半宽
    halfD: 0.40,       // 碰撞盒半深
    standH: 1.52,      // 站立高度
    slideH: 0.82,      // 滑铲高度
    lateralSpeed: 12,  // 左右最大速度
    lateralAccel: 78,  // 左右加速度
    lateralFriction: 14,
    jumpVel: 11.6,
    doubleJumpVel: 9.8,
    gravity: -31,
    diveGravity: -58,  // 空中按 ↓ 快速落地（飞扑）
    airControl: 0.78,
    slideTime: 0.62,
    slideCooldown: 0.16,
    spawnY: 0,
  },

  speed: {
    base: 19,
    max: 47,
    accel: 0.40,       // 每秒增加
    hitPenalty: 0.55,  // 撞击后速度乘算
    recoverTime: 1.1,
  },

  score: {
    perMeter: 1,
    orbScore: 12,
    bigOrbScore: 60,
    comboWindow: 2.7,  // 连击保持时间
    comboMax: 8,
  },

  rules: {
    shields: 3,        // 护盾（命）数
    invulnTime: 1.9,   // 受击无敌时间
    shieldRegen: 0,    // 0 = 不恢复
  },

  camera: {
    back: 6.4,
    height: 3.1,
    lookAhead: -7.5,
    lookHeight: 1.25,
    followLerp: 7.5,
    fovBase: 62,
    fovMax: 76,
    fovNarrowMax: 88,    // 竖屏/窄屏时放宽的垂直视角上限（保证横向能看到整条赛道）
    minTanHalfH: 0.62,   // 窄屏下想要的水平半角 tan 值
  },

  touch: {
    dragGain: 0.026,     // 手指横向拖动 1px 对应的世界位移（单位）
    maxDragPx: 96,       // 摇杆圆点最多偏移的像素
  },

  fx: {
    maxParticles: 1400,
    trailPoints: 26,   // 拖尾采样点数（总长约 (点数-1) × 0.19 ≈ 4.8，必须短于镜头距离 6.4）
    spawnAhead: 240,   // 关卡内容生成距离（超过这个距离正好被雾完全遮住，看不到弹出）
    fogNear: 60,
    fogFar: 230,
  },
};

/* =========================================================================
 * 设备识别与画质分级
 *   桌面 → high；手机/平板 → mobile；核心少的设备 → low
 *   可用网址参数强制覆盖：?q=high / mobile / low，?touch=1 / 0
 * ========================================================================= */
const Device = (() => {
  const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
  const ua = navigator.userAgent || '';
  const maxTouch = navigator.maxTouchPoints || 0;
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  const uaMobile = /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua);
  const touchCapable = maxTouch > 0 || 'ontouchstart' in window || coarse;
  const smallScreen = Math.min(screen.width || 9999, screen.height || 9999) <= 820;
  const mobile = uaMobile || (touchCapable && (coarse || smallScreen));
  const cores = navigator.hardwareConcurrency || 4;
  const lowEnd = mobile && (cores <= 4 || (navigator.deviceMemory || 4) <= 2);

  const qOverride = params.get('q');
  const quality = (qOverride === 'high' || qOverride === 'mobile' || qOverride === 'low')
    ? qOverride
    : (mobile ? (lowEnd ? 'low' : 'mobile') : 'high');

  const touchOverride = params.get('touch');
  const touch = touchOverride !== null ? touchOverride !== '0' : touchCapable;

  return {
    mobile, quality, touch, lowEnd, cores,
    isPortrait: window.innerHeight > window.innerWidth,
    dpr: window.devicePixelRatio || 1,
  };
})();

/* 画质档位：低端机上减面数、减透明叠加（手机最大的瓶颈是填充率） */
const QUALITY_PRESETS = {
  high: { pixelRatio: 2, shadowSize: 1024, shadowExtent: 12, particles: 1400, glow: true, skyline: 24, clouds: 18, sea: 5, segments: 14 },
  mobile: { pixelRatio: 1.5, shadowSize: 512, shadowExtent: 10, particles: 700, glow: false, skyline: 14, clouds: 10, sea: 4, segments: 14 },
  low: { pixelRatio: 1.25, shadowSize: 0, shadowExtent: 9, particles: 420, glow: false, skyline: 8, clouds: 6, sea: 4, segments: 13 },
};

CFG.quality = QUALITY_PRESETS[Device.quality];
CFG.fx.maxParticles = CFG.quality.particles;
CFG.track.segCount = CFG.quality.segments;

/* 马卡龙霓虹调色板 —— 所有颜色都往浅、往粉嫩偏 */
const PAL = {
  skyTop: 0xa9e4ff,
  skyMid: 0xd8f0ff,
  skyLow: 0xffe2f2,
  fog: 0xeaf6ff,

  road: 0xfdfaff,
  roadLine: 0x9fe6ff,
  roadScan: 0xffb7e4,

  neonCyan: 0x35d8ff,
  neonPink: 0xff6fd8,
  neonLime: 0x8ef0b8,
  neonPurple: 0x9b8cff,
  neonYellow: 0xffdd6b,
  neonOrange: 0xffa96b,

  ink: 0x42456b,
  white: 0xffffff,
  body: 0xf7f9ff,
  visor: 0x28d7ff,

  obstacle: [0x8fe0ff, 0xffa8e0, 0xb8f2a8, 0xffe08f, 0xffb99a],
  cloud: 0xffffff,
  building: 0xdfe4fb,
  buildingAlt: 0xe9e0fb,
};

/* 小工具 */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
/* 帧率无关的指数平滑 */
const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
