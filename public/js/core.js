'use strict';
// ---------- global state, API client, socket wiring ----------
const ACT = {}; // click actions registered by other files: ACT.name = (el, event) => ...
const S = {
  token: localStorage.getItem('nv_token'), me: null, cfg: null, socket: null,
  servers: [], dms: [], social: { friends: [], incoming: [], outgoing: [], blocked: [] },
  sv: {},        // serverId -> { server, channels, roles, members, perms, owner, voice }
  users: {},     // userId -> public user (cache)
  unread: {},    // channelId -> { count, mentions, server_id }
  chat: {},      // channelId -> { list, more, loading, loaded, reply, attachments, ... }
  typing: {},    // channelId -> { userId: { name, t } }
  voice: {},     // channelId -> participants[]
  cur: { mode: 'home', serverId: null, channelId: null, view: 'friends' },
};

let prefs = { theme: 'dark', sound: true, desktop: false, mic: '', spk: '', cam: '' };
try { Object.assign(prefs, JSON.parse(localStorage.getItem('nv_prefs') || '{}')); } catch (_) {}
function savePrefs() { localStorage.setItem('nv_prefs', JSON.stringify(prefs)); applyTheme(); }
function applyTheme() {
  document.documentElement.dataset.theme = prefs.theme;
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = prefs.theme === 'light' ? '#f3f5f8' : '#0b0f14';
}
applyTheme();

// ---------- API ----------
async function api(method, url, body) {
  const opt = { method, headers: {} };
  if (S.token) opt.headers.Authorization = 'Bearer ' + S.token;
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  let r; try { r = await fetch(url, opt); } catch (_) { throw new Error('ارتباط با سرور برقرار نشد'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { if (r.status === 401 && S.token) logout(); throw new Error(j.error || 'خطای ناشناخته'); }
  return j;
}
const get = u => api('GET', u), post = (u, b = {}) => api('POST', u, b), patch = (u, b) => api('PATCH', u, b),
  put = (u, b) => api('PUT', u, b), del = u => api('DELETE', u);
async function upload(file) {
  const fd = new FormData(); fd.append('file', file);
  let r; try { r = await fetch('/api/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + S.token }, body: fd }); }
  catch (_) { throw new Error('ارتباط با سرور برقرار نشد'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'بارگذاری ناموفق بود');
  return j;
}
// socket emit with acknowledgement -> {ok, ...}
const ack = (ev, data) => new Promise(res => {
  if (!S.socket || !S.socket.connected) return res({ ok: false, error: 'اتصال به سرور برقرار نیست' });
  S.socket.timeout(10000).emit(ev, data, (err, r) => res(err ? { ok: false, error: 'پاسخی از سرور دریافت نشد' } : r));
});
const guard = fn => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message, 'err'); } };

// ---------- caches / helpers ----------
function cacheUser(u) { if (u && u.id) S.users[u.id] = Object.assign(S.users[u.id] || {}, u); return S.users[u.id]; }
const userOf = id => S.users[id] || null;
const nameOf = id => (S.users[id] && S.users[id].display_name) || null;
const mdCtx = () => ({ name: nameOf, me: S.me && S.me.id });
const curServer = () => (S.cur.serverId ? S.sv[S.cur.serverId] : null);
const can = bit => { const sv = curServer(); return !!(sv && (sv.perms & bit)); };
function findChannel(cid) {
  for (const id in S.sv) { const c = S.sv[id].channels.find(x => x.id === cid); if (c) return c; }
  const d = S.dms.find(x => x.id === cid); return d ? { ...d, server_id: null } : null;
}
function dmTitle(d) {
  if (d.type === 'group') return d.name || d.members.filter(m => m.id !== S.me.id).map(m => m.display_name).join('، ') || 'گروه';
  const o = d.members.find(m => m.id !== S.me.id); return o ? o.display_name : 'کاربر';
}
function roleColorOf(serverId, uid) {
  const sv = S.sv[serverId]; if (!sv) return '';
  const m = sv.members.find(x => x.id === uid); if (!m) return '';
  let best = null;
  for (const r of sv.roles) if (!r.is_default && r.color && m.role_ids.includes(r.id) && (!best || r.position > best.position)) best = r;
  return best ? best.color : '';
}
const unreadOfServer = sid => Object.values(S.unread).filter(u => u.server_id === sid).reduce((a, u) => ({ c: a.c + u.count, m: a.m + u.mentions }), { c: 0, m: 0 });

// ---------- data loading ----------
async function loadBootstrap() {
  const b = await get('/api/bootstrap');
  S.servers = b.servers; S.dms = b.dms; S.social = b.social; S.unread = b.unread;
  S.dms.forEach(d => d.members.forEach(cacheUser));
  Object.values(S.social).forEach(l => l.forEach(cacheUser));
}
async function loadServer(id, force) {
  if (S.sv[id] && !force) return S.sv[id];
  const d = await get('/api/servers/' + id);
  d.members.forEach(cacheUser);
  S.sv[id] = d;
  const i = S.servers.findIndex(s => s.id === id); if (i >= 0) S.servers[i] = d.server;
  d.channels.filter(c => c.type === 'voice').forEach(c => { S.voice[c.id] = d.voice[c.id] || []; });
  return d;
}
async function reloadSocial() {
  const r = await get('/api/social'); S.social = r.social; S.dms = r.dms;
  S.dms.forEach(d => d.members.forEach(cacheUser)); Object.values(S.social).forEach(l => l.forEach(cacheUser));
}

// ---------- socket ----------
let firstConnect = true;
function connectSocket() {
  if (S.socket) S.socket.disconnect();
  firstConnect = true;
  const s = S.socket = io({ auth: { token: S.token } });
  s.on('connect_error', e => { if (e.message === 'unauthorized') logout(); });
  s.on('connect', () => { if (firstConnect) { firstConnect = false; return; } onReconnect(); });
  s.on('msg:new', onMsgNew);
  s.on('msg:edit', onMsgEdit);
  s.on('msg:delete', onMsgDelete);
  s.on('msg:reactions', onMsgReactions);
  s.on('msg:pin', onMsgPin);
  s.on('typing', onTyping);
  s.on('user:update', onUserUpdate);
  s.on('server:changed', d => refreshServer(d.serverId));
  s.on('server:removed', d => onServerGone(d.serverId, 'شما از این سرور خارج شدید'));
  s.on('server:deleted', d => onServerGone(d.serverId, 'این سرور حذف شد'));
  s.on('channel:deleted', d => { if (S.cur.channelId === d.channelId) { S.cur.channelId = null; } });
  s.on('servers:refresh', debounce(guard(async () => { await loadBootstrap(); renderAll(); }), 300));
  s.on('dm:refresh', debounce(guard(async () => { await reloadSocial(); renderAll(); }), 300));
  s.on('social:refresh', debounce(guard(async () => { await reloadSocial(); renderAll(); if (typeof refreshFriendsModal === 'function') refreshFriendsModal(); }), 300));
  s.on('site:announce', d => showAnnouncement(d.text));
  s.on('voice:update', onVoiceUpdate);
  s.on('voice:signal', onVoiceSignal);
  s.on('voice:kicked', () => { voiceCleanup(); toast('از کانال صوتی خارج شدید', 'warn'); renderAll(); });
}
const refreshServer = debounce(guard(async id => {
  if (!S.sv[id]) return;
  await loadServer(id, true);
  if (S.cur.serverId === id) {
    const ch = S.sv[id].channels.find(c => c.id === S.cur.channelId);
    if (!ch) { const f = firstTextChannel(id); S.cur.channelId = f ? f.id : null; renderAll(); if (S.cur.channelId) openChannel(S.cur.channelId); return; }
    renderAll(S.cur.view === 'chat' ? { keepMain: true } : undefined);
  } else renderRail();
}), 250);
function onServerGone(sid, msg) {
  delete S.sv[sid]; S.servers = S.servers.filter(s => s.id !== sid);
  if (V.serverId === sid) voiceCleanup();
  if (S.cur.serverId === sid) { toast(msg, 'warn'); goHome(); } else renderRail();
}
function onUserUpdate(u) {
  cacheUser(u);
  if (S.me && u.id === S.me.id) Object.assign(S.me, { display_name: u.display_name, avatar: u.avatar, status_text: u.status_text });
  const upd = l => l.forEach((x, i) => { if (x.id === u.id) l[i] = { ...x, ...u }; });
  for (const id in S.sv) upd(S.sv[id].members);
  Object.values(S.social).forEach(upd); S.dms.forEach(d => upd(d.members));
  renderAll({ keepMain: true }); if (S.cur.view === 'chat') refreshAuthors(u.id);
}
async function onReconnect() {
  if (V.channelId) { voiceCleanup(); toast('اتصال صوتی قطع شد', 'warn'); }
  try {
    await loadBootstrap();
    for (const id of Object.keys(S.sv)) await loadServer(+id, true).catch(() => {});
    if (S.cur.channelId && S.chat[S.cur.channelId]) { S.chat[S.cur.channelId].loaded = false; await loadMessages(S.cur.channelId); }
    renderAll();
  } catch (_) {}
}

// ---------- auth state ----------
function logout() {
  localStorage.removeItem('nv_token'); S.token = null; S.me = null;
  if (typeof voiceCleanup === 'function') voiceCleanup();
  if (S.socket) { S.socket.disconnect(); S.socket = null; }
  Object.assign(S, { servers: [], dms: [], sv: {}, users: {}, unread: {}, chat: {}, typing: {}, voice: {}, cur: { mode: 'home', serverId: null, channelId: null, view: 'friends' } });
  closeModals(); showAuth();
}
