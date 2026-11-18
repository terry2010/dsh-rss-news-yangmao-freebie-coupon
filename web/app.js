/* 每日羊毛看板 SPA — 走本插件 /dsh-rss-news-yangmao-freebie-coupon/api/* */
const BASE = '/dsh-rss-news-yangmao-freebie-coupon';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 主题：?theme= 首帧 + rnd-theme postMessage 跟随主阅读器
(function theme() {
  const p = new URLSearchParams(location.search).get('theme');
  if (p) document.documentElement.dataset.theme = p;
  window.addEventListener('message', (e) => {
    if (e.data?.type === 'rnd-theme' && e.data.theme) document.documentElement.dataset.theme = e.data.theme;
  });
})();

const api = async (p, opts) => {
  const r = await fetch(BASE + p, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
};
const post = (p, body) => api(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });

const CLAIM = { direct: '直领', redeem: '兑换码', claim: '需领取', checkin: '签到' };
const CHNAME = { ai: 'AI福利', vps: 'VPS/云', deal: '优惠', game: '游戏', software: '软件', credit: '信用卡' };
const chName = (c) => CHNAME[c] ?? c ?? '-';

let tab = 'all', channel = '', q = '', page = 1;
const state = { counts: {}, channels: [] };

/* ---------- 列表 ---------- */
function daysLeft(d) { return d ? Math.ceil((new Date(d + 'T23:59:59') - Date.now()) / 864e5) : null; }

function card(it) {
  const dl = daysLeft(it.deadline);
  const expired = dl !== null && dl < 0;
  const el = document.createElement('div');
  el.className = 'card' + (it.breaking ? ' brk' : '') + (expired ? ' expired' : '');
  const go = it.outboundUrl || `https://go.chuishiban.com/go/${it.slug}?ch=dsh`;
  el.innerHTML = `
    <div class="row1">
      ${it.breaking ? '<span class="badge brk">🔥 突发</span>' : ''}
      ${it.trusted ? '<span class="badge trust">可信</span>' : `<span class="badge">${esc(chName(it.category))}</span>`}
      ${it.hit ? '<span class="badge hitb">订阅命中</span>' : ''}
      <span class="ttl">${esc(it.title)}</span>
    </div>
    ${it.summary ? `<div class="sum">${esc(it.summary)}</div>` : ''}
    <div class="meta">
      ${it.platform ? `<span>${esc(it.platform)}</span>` : ''}
      ${it.quota ? `<span>额度 ${esc(it.quota)}</span>` : ''}
      ${it.claimType ? `<span>${esc(CLAIM[it.claimType] ?? it.claimType)}</span>` : ''}
      ${expired ? '<span class="badge">已失效</span>'
        : dl !== null ? `<span class="dl${dl <= 3 ? ' soon' : ''}">⏳ ${dl <= 0 ? '今日到期' : `剩 ${dl} 天`}</span>` : ''}
      ${it.sourceName ? `<span>· ${esc(it.sourceName)}</span>` : ''}
      <span>👁${it.views} 领${it.clicks}</span>
    </div>
    <div class="acts">
      ${!expired ? `<a class="go" href="${esc(go)}" target="_blank" rel="noopener">去领取 →</a>` : ''}
      ${it.officialUrl && it.officialUrl !== go ? `<a class="go" style="color:var(--dim)" href="${esc(it.officialUrl)}" target="_blank" rel="noopener">官方页</a>` : ''}
      <button data-m="claimed" class="${it.marks.claimed ? 'on' : ''}">${it.marks.claimed ? '✓已领取' : '领取'}</button>
      <button data-m="favorite" class="${it.marks.favorite ? 'on' : ''}">${it.marks.favorite ? '★' : '☆'}</button>
      <button data-m="hidden">${it.marks.hidden ? '恢复' : '隐藏'}</button>
    </div>`;
  $$('.acts button', el).forEach((b) => b.onclick = async () => {
    const m = b.dataset.m;
    await post('/api/marks', { id: it.id, [m]: m === 'hidden' ? !it.marks.hidden : !it.marks[m] });
    refresh(false);
  });
  return el;
}

async function refresh(reset = true) {
  if (reset) { page = 1; $('#list').innerHTML = ''; }
  const sp = new URLSearchParams({ tab, page: String(page), pageSize: '50' });
  if (channel) sp.set('channel', channel);
  if (q) sp.set('q', q);
  try {
    const r = await api('/api/items?' + sp);
    state.counts = r.counts; state.channels = r.channels;
    paintCounts(); paintChips();
    if (reset) $('#list').innerHTML = '';
    for (const it of r.items) $('#list').appendChild(card(it));
    if (!r.items.length && reset) $('#list').innerHTML =
      `<div class="empty">暂无条目——${tab === 'hits' ? '先在「订阅管理」加关键词' : '等下一次同步'}</div>`;
    $('#more').hidden = r.items.length < 50;
  } catch (e) {
    if (reset) $('#list').innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`;
  }
}
function paintCounts() {
  for (const [k, v] of Object.entries(state.counts)) {
    const el = $('#n-' + k); if (el) el.textContent = v ? `(${v})` : '';
  }
}
function paintChips() {
  const el = $('#chips');
  el.innerHTML = '';
  const all = document.createElement('button');
  all.textContent = '全部频道'; all.className = channel === '' ? 'on' : '';
  all.onclick = () => { channel = ''; refresh(); };
  el.appendChild(all);
  for (const c of state.channels) {
    const b = document.createElement('button');
    b.textContent = `${chName(c.category)} ${c.n}`;
    b.className = channel === c.category ? 'on' : '';
    b.onclick = () => { channel = channel === c.category ? '' : c.category; refresh(); };
    el.appendChild(b);
  }
  // 订阅频道下拉
  const sel = $('#subCh');
  if (sel.options.length <= 1) {
    for (const c of state.channels) {
      const o = document.createElement('option');
      o.value = c.category; o.textContent = chName(c.category);
      sel.appendChild(o);
    }
  }
}

/* ---------- 状态栏 ---------- */
async function status() {
  try {
    const s = await api('/api/status');
    const dot = $('#dot'), info = $('#syncinfo');
    dot.className = 'syncdot' + (s.lastError ? ' err' : '');
    info.textContent = s.lastError
      ? `同步异常：${s.lastError.slice(0, 40)}`
      : `rev ${s.pulledRev} · active ${s.manifest?.active ?? '-'} · ${s.lastOkAt ? new Date(s.lastOkAt).toLocaleTimeString() : ''}`;
    $('#pubstate').hidden = !s.publishing;
    state.counts = s.counts; state.channels = s.channels;
    paintCounts(); paintChips();
    // cfg
    const f = $('#cfgForm');
    if (!f.apiBase.value) {
      f.apiBase.value = s.cfg.apiBase; f.dataBase.value = s.cfg.dataBase; f.syncSec.value = s.cfg.syncSec;
    }
    $('#cfgInfo').textContent = `manifest rev=${s.manifest?.rev ?? '-'} datarev=${s.manifest?.datarev ?? '-'} · 上次成功 ${s.lastOkAt ?? '-'}`;
  } catch { $('#dot').className = 'syncdot err'; $('#syncinfo').textContent = 'API 不可达'; }
}

/* ---------- 订阅 ---------- */
async function subs() {
  const r = await api('/api/subs');
  $('#subN').textContent = r.items.length;
  $('#subList').innerHTML = r.items.map((s) => `
    <div class="subrow">
      <label><input type="checkbox" data-id="${s.id}" ${s.enabled ? 'checked' : ''}></label>
      <span class="kw">${esc(s.keywords.join(', ') || '(全部)')}</span>
      <span class="badge">${s.channels.length ? esc(s.channels.map(chName).join('/')) : '全部频道'}</span>
      <button data-del="${s.id}">删除</button>
    </div>`).join('') || '<div class="empty">还没有订阅规则</div>';
  $$('#subList [data-del]').forEach((b) => b.onclick = async () => {
    await api(`/api/subs?id=${b.dataset.del}`, { method: 'DELETE' }); subs(); refresh();
  });
  $$('#subList input[type=checkbox]').forEach((c) => c.onchange = async () => {
    const s = r.items.find((x) => x.id === Number(c.dataset.id));
    await post('/api/subs', { id: s.id, keywords: s.keywords, channels: s.channels, enabled: c.checked });
    refresh();
  });
}
$('#subForm').onsubmit = async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const channels = f.get('channel') ? [f.get('channel')] : [];
  await post('/api/subs', { keywords: String(f.get('keywords') || ''), channels });
  e.target.reset(); subs(); refresh();
};

/* ---------- 投稿 ---------- */
const SUB_ST = { new: '已受理', extracting: '抓取中', pending: '待审核', approved: '已上架 🚀',
  duplicated: '重复', rejected: '未通过', failed: '失败' };
async function submissions() {
  const r = await api('/api/submissions');
  $('#submN').textContent = r.items.length;
  $('#submList').innerHTML = r.items.map((s) => `
    <div class="submrow">
      <span class="st st-${esc(s.status)}">${esc(SUB_ST[s.status] ?? s.status)}</span>
      <span class="kw" style="flex:1">${esc(s.url.slice(0, 60))}</span>
      ${s.item_slug ? `<a href="https://chuishiban.com/item/${esc(s.item_slug)}/" target="_blank">查看条目</a>` : ''}
      <button data-del="${esc(s.id)}">移除</button>
    </div>`).join('') || '<div class="empty">还没有投稿记录</div>';
  $$('#submList [data-del]').forEach((b) => b.onclick = async () => {
    await api(`/api/submissions?id=${encodeURIComponent(b.dataset.del)}`, { method: 'DELETE' });
    submissions();
  });
}
$('#trackForm').onsubmit = async (e) => {
  e.preventDefault();
  const id = new FormData(e.target).get('id');
  const r = await post('/api/track', { id });
  if (!r.ok) alert(r.error || '跟踪失败');
  e.target.reset(); submissions();
};

$('#btnSubmit').onclick = () => $('#dlgSubmit').showModal();
$('#dlgForm').onsubmit = async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  $('#dlgMsg').textContent = '提交中…';
  try {
    const r = await post('/api/submit', { url: f.get('url'), note: f.get('note'), notifyEmail: f.get('notifyEmail') });
    $('#dlgMsg').innerHTML = r.ok
      ? `<span style="color:var(--ok)">已受理！ID：<code>${esc(r.id)}</code></span>`
      : `<span style="color:var(--danger)">${esc(r.error || '失败')}</span>`;
    if (r.ok) { setTimeout(() => { $('#dlgSubmit').close(); $('#dlgMsg').textContent = ''; submissions(); }, 1500); }
  } catch (err) { $('#dlgMsg').textContent = err.message; }
};

/* ---------- 设置 ---------- */
$('#cfgForm').onsubmit = async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  await post('/api/settings', { apiBase: f.get('apiBase'), dataBase: f.get('dataBase'), syncSec: Number(f.get('syncSec')) });
  status();
};
$('#btnSync').onclick = async () => { await post('/api/sync'); setTimeout(status, 1500); };

/* ---------- tabs / search / paging ---------- */
$$('#tabs button').forEach((b) => b.onclick = () => {
  tab = b.dataset.tab;
  $$('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
  refresh();
});
let qt;
$('#q').oninput = (e) => { clearTimeout(qt); qt = setTimeout(() => { q = e.target.value.trim(); refresh(); }, 300); };
$('#more').onclick = () => { page++; refresh(false); };

refresh();
subs();
submissions();
status();
setInterval(status, 60_000);
