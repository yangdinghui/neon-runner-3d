/* =========================================================================
 * leaderboard.js —— 本地排行榜（localStorage，Top 10）
 * ========================================================================= */

const Leaderboard = (() => {
  const KEY = 'neon-runner-3d.leaderboard.v1';
  const NAME_KEY = 'neon-runner-3d.lastname.v1';
  const MAX = 10;

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr
        .filter((e) => e && typeof e.score === 'number')
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX);
    } catch (e) { return []; }
  }

  function save(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))); } catch (e) {}
  }

  function best() {
    const l = load();
    return l.length ? l[0].score : 0;
  }

  function qualifies(score) {
    if (score <= 0) return false;
    const l = load();
    return l.length < MAX || score > l[l.length - 1].score;
  }

  /* 返回 { rank: 1-based, id } */
  function submit({ name, score, dist, combo }) {
    const list = load();
    const entry = {
      id: 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: (name || '匿名玩家').toString().trim().slice(0, 10) || '匿名玩家',
      score: Math.round(score),
      dist: Math.round(dist || 0),
      combo: combo || 1,
      date: new Date().toISOString().slice(0, 10),
    };
    list.push(entry);
    list.sort((a, b) => b.score - a.score || (b.dist || 0) - (a.dist || 0));
    const trimmed = list.slice(0, MAX);
    save(trimmed);
    const rank = trimmed.findIndex((e) => e.id === entry.id) + 1;
    return { rank: rank || 0, id: entry.id };
  }

  function lastName() {
    try { return localStorage.getItem(NAME_KEY) || ''; } catch (e) { return ''; }
  }
  function setLastName(n) {
    try { localStorage.setItem(NAME_KEY, n); } catch (e) {}
  }

  function clear() { save([]); }

  const MEDALS = ['🥇', '🥈', '🥉'];

  /* 把榜单渲染进一个 <ol> */
  function render(el, highlightId = null) {
    if (!el) return;
    const list = load();
    el.innerHTML = '';
    if (!list.length) {
      const li = document.createElement('li');
      li.className = 'lb-empty';
      li.textContent = '还没有记录，来创造第一条吧！';
      el.appendChild(li);
      return;
    }
    list.forEach((e, i) => {
      const li = document.createElement('li');
      li.className = 'lb-row' + (e.id === highlightId ? ' is-new' : '');
      const rank = document.createElement('span');
      rank.className = 'lb-rank';
      rank.textContent = MEDALS[i] || ('#' + (i + 1));
      const name = document.createElement('span');
      name.className = 'lb-name';
      name.textContent = e.name;
      name.title = `${e.date}　距离 ${e.dist}m　最高连击 x${e.combo || 1}`;
      const dist = document.createElement('span');
      dist.className = 'lb-dist';
      dist.textContent = (e.dist || 0) + 'm';
      const sc = document.createElement('span');
      sc.className = 'lb-score';
      sc.textContent = e.score.toLocaleString('en-US');
      li.append(rank, name, dist, sc);
      el.appendChild(li);
    });
  }

  return { load, submit, qualifies, best, lastName, setLastName, clear, render, MAX, KEY };
})();
