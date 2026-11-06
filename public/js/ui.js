'use strict';
// ---------- layout rendering + navigation + global event wiring ----------
const collapsed = new Set(JSON.parse(localStorage.getItem('nv_collapsed') || '[]'));
let friendsTab = 'online';
const setPanel = p => { document.body.dataset.panel = p; };

function renderAll(o) { renderRail(); renderSide(); if (!(o && o.keepMain)) renderMain(); renderMembers(); }
const badge = (c, m) => (m ? `<i class="badge red">${fa(m)}</i>` : c ? `<i class="badge">${fa(c > 99 ? '99+' : c)}</i>` : '');

function renderRail() {
  const dmU = Object.values(S.unread).filter(u => !u.server_id).reduce((a, u) => ({ c: a.c + u.count, m: a.m + u.mentions }), { c: 0, m: 0 });
  $('#rail').innerHTML = `<button class="rail-btn logo${S.cur.mode === 'home' ? ' on' : ''}" data-act="home" title="خانه">${LOGO}${badge(dmU.c, dmU.m)}</button><div class="rail-sep"></div>` +
    S.servers.map(s => { const u = unreadOfServer(s.id);
      return `<button class="rail-btn${S.cur.serverId === s.id ? ' on' : ''}" data-act="srv" data-id="${s.id}" title="${esc(s.name)}${s.verified ? ' ✔' : ''}">${s.icon ? `<img src="${esc(s.icon)}" alt="">` : `<span>${esc(Array.from(s.name)[0])}</span>`}${badge(u.c, u.m)}</button>`; }).join('') +
    `<button class="rail-btn add" data-act="server-new" title="ساخت یا پیوستن به سرور">＋</button>`;
}

function userPanel() {
  const vc = V.channelId && findChannel(V.channelId);
  return `${vc ? `<div class="voice-bar"><span>${ico('volume')} متصل به <b>${esc(vc.name)}</b></span><button class="icon-btn" data-act="v-leave" title="قطع">${ico('phone')}</button></div>` : ''}
    <div class="user-panel"><button class="icon-btn mobile-nav-trigger" data-act="mobile-nav" title="دسترسی به بخش‌ها">${ico('menu')}</button>
    <button class="up-user" data-act="pres-menu">${avatar(S.me, 'av-m')}${dot(S.me.presence)}<span><b>${esc(S.me.display_name)}${vtick(S.me)}</b><small>${esc(S.me.status_text || PRESENCE_FA[S.me.presence])}</small></span></button>
    <button class="icon-btn${VM.muted ? ' off' : ''}" data-act="v-mute" title="میکروفون">${ico(VM.muted ? 'mic-off' : 'mic')}</button>
    <button class="icon-btn${VM.deafened ? ' off' : ''}" data-act="v-deaf" title="ناشنوا">${ico(VM.deafened ? 'headphones-off' : 'headphones')}</button>
    <button class="icon-btn" data-act="settings" title="تنظیمات">${ico('settings')}</button></div>`;
}
function renderSide() {
  const el = $('#side'); if (!S.me) return;
  let body;
  if (S.cur.mode === 'server' && curServer()) {
    const sv = curServer(), chs = sv.channels, mg = can(S.cfg.perms.MANAGE_CHANNELS);
    const item = c => {
      const u = S.unread[c.id], on = S.cur.channelId === c.id;
      if (c.type === 'voice') {
        const parts = S.voice[c.id] || [];
        return `<button class="ch${on ? ' on' : ''}" data-act="chan" data-id="${c.id}">${ico('volume')} <span>${esc(c.name)}</span></button>` +
          parts.map(p => { const x = userOf(p.userId) || { id: p.userId, display_name: 'کاربر' }; const sp = V.an.get(p.socketId);
            return `<div class="vp${sp && sp.on ? ' speaking' : ''}" data-vu="${p.socketId}">${avatar(x, 'av-s')}<span>${esc(x.display_name)}</span>${p.muted || p.deafened ? ico('mic-off') : ''}${p.video || p.screen ? ico('video') : ''}</div>`; }).join('');
      }
      return `<button class="ch${on ? ' on' : ''}${u ? ' unread' : ''}" data-act="chan" data-id="${c.id}"><span class="hash">#</span><span>${esc(c.name)}</span>${u ? badge(u.count, u.mentions) : ''}</button>`;
    };
    const cats = chs.filter(c => c.type === 'category');
    const loose = chs.filter(c => c.type !== 'category' && !c.parent_id);
    body = `<button class="side-head" data-act="server-menu"><b>${esc(sv.server.name)}${vtick(sv.server)}</b><span>⌄</span></button><div class="side-scroll">` +
      loose.map(item).join('') +
      cats.map(cat => `<div class="cat"><div class="cat-head"><button data-act="cat-toggle" data-id="${cat.id}">${collapsed.has(cat.id) ? '◂' : '▾'} ${esc(cat.name)}</button>${mg ? `<button class="icon-btn" data-act="ch-new" data-parent="${cat.id}" title="کانال جدید">＋</button>` : ''}</div>${collapsed.has(cat.id) ? '' : chs.filter(c => c.parent_id === cat.id).map(item).join('')}</div>`).join('') + '</div>';
  } else {
    body = `<div class="side-head static"><b>پیام‌ها</b></div><div class="side-scroll"><button class="ch${S.cur.view === 'friends' ? ' on' : ''}" data-act="friends">${ico('users')} <span>دوستان</span>${S.social.incoming.length ? badge(0, S.social.incoming.length) : ''}</button>
      <div class="cat-head"><span class="muted">پیام‌های مستقیم</span><button class="icon-btn" data-act="group-new" title="گروه جدید">＋</button></div>` +
      S.dms.map(d => { const u = S.unread[d.id], o = d.type === 'dm' ? d.members.find(m => m.id !== S.me.id) : null;
        return `<button class="ch dm${S.cur.channelId === d.id ? ' on' : ''}${u ? ' unread' : ''}" data-act="dm" data-id="${d.id}">${o ? avatar(o, 'av-s') + dot(o.presence) : '<span class="av av-s grp">' + ico('users') + '</span>'}<span>${esc(dmTitle(d))}${o ? vtick(o) : ''}</span>${u ? badge(u.count, u.mentions) : ''}</button>`; }).join('') + '</div>';
  }
  el.innerHTML = body + userPanel();
}

function renderMembers() {
  const el = $('#members'), sv = curServer(); let html = '';
  const row = m => `<button class="mem${m.presence === 'offline' ? ' off' : ''}" data-act="profile" data-uid="${m.id}">${avatar(m, 'av-m')}${dot(m.presence)}<span><b style="${(S.cur.serverId && roleColorOf(S.cur.serverId, m.id)) ? 'color:' + esc(roleColorOf(S.cur.serverId, m.id)) : ''}">${esc(m.display_name)}</b>${vtick(m)}${m.status_text ? `<small>${esc(m.status_text)}</small>` : ''}</span></button>`;
  if (S.cur.mode === 'server' && sv) {
    const top = m => { let b = null; sv.roles.forEach(r => { if (!r.is_default && m.role_ids.includes(r.id) && (!b || r.position > b.position)) b = r; }); return b; };
    const groups = new Map(); const on = [], off = [];
    sv.members.forEach(m => { const r = top(m); if (r) { if (!groups.has(r.id)) groups.set(r.id, []); groups.get(r.id).push(m); } else (m.presence === 'offline' ? off : on).push(m); });
    sv.roles.filter(r => groups.has(r.id)).forEach(r => { html += `<h5>${esc(r.name)} — ${fa(groups.get(r.id).length)}</h5>` + groups.get(r.id).map(row).join(''); });
    if (on.length) html += `<h5>آنلاین — ${fa(on.length)}</h5>` + on.map(row).join('');
    if (off.length) html += `<h5>آفلاین — ${fa(off.length)}</h5>` + off.map(row).join('');
  } else {
    const d = S.dms.find(x => x.id === S.cur.channelId);
    if (d && d.type === 'group') html = `<h5>اعضای گروه — ${fa(d.members.length)}</h5>` + d.members.map(row).join('');
  }
  el.innerHTML = html; document.body.classList.toggle('members-empty', !html);
}

// ----- main area -----
function renderMain() {
  const m = $('#main'), cur = S.cur;
  if (cur.mode === 'home' && cur.view === 'friends') { m.innerHTML = friendsHtml(); const i = $('#fr-name'); if (i) i.addEventListener('keydown', e => { if (e.key === 'Enter') ACT['friend-send'](); }); return; }
  const ch = cur.channelId && findChannel(cur.channelId);
  if (!ch) { m.innerHTML = `<header class="main-head"><button class="icon-btn only-mobile" data-act="panel" data-p="nav">${ico('menu')}</button><h2>${esc(window.APP_NAME)}</h2></header><div class="empty">${LOGO}<p>یک کانال را انتخاب کنید یا کانال جدیدی بسازید.</p></div>`; return; }
  if (ch.type === 'voice') { m.innerHTML = voiceViewHtml(ch); renderVoiceGrid(); renderVoiceControls(); return; }
  const dm = !ch.server_id; m.innerHTML = chatViewHtml(ch, dm ? dmTitle(ch) : ch.name, dm); mountChat(ch.id);
}
function friendsHtml() {
  const f = S.social, tabs = [['online', 'آنلاین'], ['all', 'همه'], ['pending', `در انتظار${f.incoming.length ? ' (' + fa(f.incoming.length) + ')' : ''}`], ['blocked', 'مسدود'], ['add', 'افزودن دوست']];
  const row = (u, btns) => `<div class="list-row">${avatar(u, 'av-m')}${dot(u.presence)}<span><b>${esc(u.display_name)}</b>${vtick(u)}<small class="muted"> @${esc(u.username)}</small></span><span class="grow"></span>${btns}</div>`;
  const b = (a, t, id, c = '') => `<button class="btn ${c}" data-act="${a}" data-uid="${id}">${t}</button>`;
  let list = '';
  if (friendsTab === 'online' || friendsTab === 'all') { const l = f.friends.filter(u => friendsTab === 'all' || u.presence !== 'offline'); list = l.map(u => row(u, b('dm-open', ico('message') + ' پیام', u.id) + b('friend-rm', 'حذف', u.id, 'ghost'))).join('') || '<p class="muted center pad">موردی نیست.</p>'; }
  else if (friendsTab === 'pending') list = f.incoming.map(u => row(u, b('friend-acc', '✓ بپذیر', u.id) + b('friend-dec', '✕ رد', u.id, 'ghost'))).join('') + f.outgoing.map(u => row(u, '<span class="muted">ارسال‌شده</span>' + b('friend-cancel', 'لغو', u.id, 'ghost'))).join('') || '<p class="muted center pad">درخواستی نیست.</p>';
  else if (friendsTab === 'blocked') list = f.blocked.map(u => row(u, b('unblock', 'رفع مسدودی', u.id))).join('') || '<p class="muted center pad">کسی مسدود نشده است.</p>';
  else list = `<div class="pad"><p>نام کاربری دوستتان را وارد کنید:</p><div class="row"><input id="fr-name" dir="ltr" placeholder="username"><button class="btn primary" data-act="friend-send">ارسال درخواست</button></div></div>`;
  return `<header class="main-head"><button class="icon-btn only-mobile" data-act="panel" data-p="nav">${ico('menu')}</button><h2>${ico('users')} دوستان</h2><div class="tabs inline">${tabs.map(([k, t]) => `<button class="${friendsTab === k ? 'on' : ''}" data-act="ftab" data-t="${k}">${t}</button>`).join('')}</div></header><div class="friends">${list}</div>`;
}
const refreshFriendsModal = () => { if (S.cur.mode === 'home' && S.cur.view === 'friends') renderMain(); };

// ----- navigation -----
function firstTextChannel(id) {
  const sv = S.sv[id]; if (!sv) return null;
  const cats = sv.channels.filter(c => c.type === 'category');
  return [...sv.channels.filter(c => c.type === 'text' && !c.parent_id), ...cats.flatMap(c => sv.channels.filter(x => x.parent_id === c.id && x.type === 'text'))][0] || null;
}
function goHome() { S.cur = { mode: 'home', serverId: null, channelId: null, view: 'friends' }; renderAll(); setPanel('nav'); }
async function openServer(id, cid) {
  await loadServer(id); const sv = S.sv[id];
  S.cur = { mode: 'server', serverId: id, channelId: null, view: 'chat' };
  const last = cid || +localStorage.getItem('nv_last_' + id);
  const ch = sv.channels.find(c => c.id === last && c.type !== 'category') || firstTextChannel(id);
  if (ch) openChannel(ch.id); else { renderAll(); setPanel('nav'); }
}
function openChannel(cid) {
  const ch = findChannel(cid); if (!ch) return;
  S.cur.channelId = cid; S.cur.view = ch.type === 'voice' ? 'voice' : 'chat';
  if (ch.server_id) localStorage.setItem('nv_last_' + ch.server_id, cid);
  renderAll(); setPanel('chat');
}
function openDm(id) { S.cur = { mode: 'home', serverId: null, channelId: id, view: 'chat' }; renderAll(); setPanel('chat'); }
async function openDmWith(uid) {
  const r = await post('/api/dms', { user_ids: [uid] }); r.dm.members.forEach(cacheUser);
  if (!S.dms.find(d => d.id === r.dm.id)) S.dms.unshift(r.dm);
  openDm(r.dm.id);
}

// ----- actions -----
ACT.home = () => goHome();
ACT.srv = guard(async el => { await openServer(+el.dataset.id); setPanel('nav'); });
ACT.chan = el => { openChannel(+el.dataset.id); const ch = findChannel(+el.dataset.id); if (ch && ch.type === 'voice' && V.channelId !== ch.id) voiceJoin(ch.id); };
ACT.dm = el => openDm(+el.dataset.id);
ACT.friends = () => { S.cur.view = 'friends'; S.cur.channelId = null; renderAll(); setPanel('chat'); };
ACT.ftab = el => { friendsTab = el.dataset.t; renderMain(); };
ACT['friend-send'] = guard(async () => { const i = $('#fr-name'); if (!i.value.trim()) return; await post('/api/friends/request', { username: i.value }); i.value = ''; toast('درخواست ارسال شد'); await reloadSocial(); renderAll(); });
ACT.panel = el => setPanel(el.dataset.p);
ACT['mobile-nav'] = el => {
  const inServer = S.cur.mode === 'server' && !!curServer();
  const items = inServer
    ? '<button data-act="panel" data-p="nav">'+ico('menu')+' کانال‌های سرور</button><button data-act="panel" data-p="members">'+ico('users')+' اعضای سرور</button><button data-act="server-menu">'+ico('settings')+' تنظیمات سرور</button><button data-act="settings">'+ico('settings')+' تنظیمات حساب</button>'
    : '<button data-act="panel" data-p="chat">'+ico('message')+' گفتگوها</button><button data-act="friends">'+ico('users')+' دوستان</button><button data-act="panel" data-p="members">'+ico('users')+' اعضای گفتگو</button><button data-act="settings">'+ico('settings')+' تنظیمات حساب</button>';
  pop(el, items, 'menu');
};
ACT['toggle-members'] = () => document.body.classList.toggle('no-members');
ACT['cat-toggle'] = el => { const id = +el.dataset.id; collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id); localStorage.setItem('nv_collapsed', JSON.stringify([...collapsed])); renderSide(); };
ACT['pres-menu'] = el => pop(el, ['online', 'idle', 'dnd', 'offline'].map(p => `<button data-act="pres-set" data-p="${p}">${dot(p)} ${PRESENCE_FA[p]}</button>`).join('') + '<button data-act="settings">' + ico('settings') + ' تنظیمات</button>', 'menu');
ACT['pres-set'] = guard(async el => { const r = await patch('/api/me', { presence: el.dataset.p }); S.me = r.user; cacheUser(r.user); renderSide(); });

// ----- global listeners -----
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el || !ACT[el.dataset.act]) return;
  if (!el.hasAttribute('data-keep') && el.closest('.pop')) closePop();
  ACT[el.dataset.act](el, e);
});
document.addEventListener('change', e => { const el = e.target.closest('[data-change]'); if (el && CHG[el.dataset.change]) CHG[el.dataset.change](el, e); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closePop(); const m = $$('.modal-back').pop(); if (m) m.close(); } });
document.addEventListener('visibilitychange', () => {
  if (document.hidden || !S.me || !S.cur.channelId) return;
  const c = S.chat[S.cur.channelId], last = c && c.list[c.list.length - 1]; if (last && S.unread[S.cur.channelId]) markRead(S.cur.channelId, last.id);
});
