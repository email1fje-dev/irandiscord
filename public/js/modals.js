'use strict';
// ---------- modals: settings, server management, profile, invites, admin ----------
const CHG = {}; // change handlers: <input data-change="name">
const PERM_LABELS = [['MANAGE_SERVER', 'مدیریت سرور'], ['MANAGE_CHANNELS', 'مدیریت کانال‌ها'], ['MANAGE_ROLES', 'مدیریت نقش‌ها'], ['KICK', 'اخراج اعضا'], ['BAN', 'مسدود کردن اعضا'],
  ['SEND_MESSAGES', 'ارسال پیام'], ['ATTACH_FILES', 'ارسال فایل'], ['CONNECT_VOICE', 'اتصال به کانال صوتی'], ['MENTION_EVERYONE', 'منشن همه (@everyone)'], ['MANAGE_MESSAGES', 'مدیریت پیام‌ها (حذف و پین)'], ['TIMEOUT', 'تایم‌اوت اعضا']];
const val = id => ($('#' + id) || {}).value;

function tabbed(title, tabs, opts) {
  let cur = tabs[0].id;
  const m = modal(title, '<div class="tabs"></div><div class="tab-body"></div>', opts);
  m.draw = () => {
    $('.tabs', m).innerHTML = tabs.map(t => `<button class="${t.id === cur ? 'on' : ''}" data-tab="${t.id}">${t.label}</button>`).join('');
    const t = tabs.find(x => x.id === cur), b = $('.tab-body', m); b.innerHTML = t.html(); if (t.mount) t.mount(b, m);
  };
  m.addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) { cur = b.dataset.tab; m.draw(); } });
  m.draw(); return m;
}
const field = (label, inner) => `<label class="field"><span>${label}</span>${inner}</label>`;

// ----- user settings -----
let settingsModal;
ACT.settings = () => {
  closePop();
  settingsModal = tabbed('تنظیمات کاربر', [
    { id: 'acc', label: 'حساب', html: () => `
      <div class="row">${avatar(S.me, 'av-xl')}<div><button class="btn" data-act="avatar-pick">تغییر تصویر</button>${S.me.avatar ? ' <button class="btn ghost" data-act="avatar-del">حذف</button>' : ''}<input type="file" id="avatar-in" accept="image/*" hidden data-change="avatar"></div></div>
      ${field('نام نمایشی', `<input id="s-name" maxlength="32" value="${esc(S.me.display_name)}">`)}
      ${field('نام کاربری', `<input value="@${esc(S.me.username)}" disabled>`)}
      ${field('وضعیت (متن)', `<input id="s-status" maxlength="100" value="${esc(S.me.status_text || '')}" placeholder="مثلاً: مشغول کار">`)}
      ${field('حضور', `<select id="s-pres">${['online', 'idle', 'dnd', 'offline'].map(p => `<option value="${p}" ${S.me.presence === p ? 'selected' : ''}>${PRESENCE_FA[p]}${p === 'offline' ? ' (نامرئی)' : ''}</option>`).join('')}</select>`)}
      <button class="btn primary" data-act="acc-save">ذخیره</button><hr>
      <h4>تغییر گذرواژه</h4>${field('گذرواژه فعلی', '<input id="s-pw0" type="password" autocomplete="current-password">')}${field('گذرواژه جدید', '<input id="s-pw1" type="password" autocomplete="new-password">')}
      <button class="btn" data-act="pw-save">تغییر گذرواژه</button><hr>
      ${S.me.is_admin ? `<button class="btn" data-act="admin">${ico('shield')} پنل مدیریت سایت</button> ` : ''}<button class="btn danger" data-act="logout">خروج از حساب</button>` },
    { id: 'look', label: 'ظاهر', html: () => `<div class="seg">${[['dark', ico('moon') + ' تیره'], ['light', ico('sun') + ' روشن']].map(([k, t]) => `<button class="${prefs.theme === k ? 'on' : ''}" data-act="theme" data-t="${k}">${t}</button>`).join('')}</div>` },
    { id: 'notif', label: 'اعلان‌ها', html: () => `
      <label class="check"><input type="checkbox" data-change="pref-sound" ${prefs.sound ? 'checked' : ''}> صدای پیام‌های جدید</label>
      <label class="check"><input type="checkbox" data-change="pref-desktop" ${prefs.desktop ? 'checked' : ''}> اعلان مرورگر (وقتی صفحه در پس‌زمینه است)</label>
      <p class="muted">در حالت «مزاحم نشوید» هیچ صدا یا اعلانی پخش نمی‌شود.</p>` },
    { id: 'voice', label: 'صدا و تصویر', html: () => `${field('میکروفون', '<select id="d-mic"><option value="">پیش‌فرض</option></select>')}${field('خروجی صدا', '<select id="d-spk"><option value="">پیش‌فرض</option></select>')}${field('دوربین', '<select id="d-cam"><option value="">پیش‌فرض</option></select>')}
      <button class="btn" data-act="dev-perm">اجازه دسترسی به دستگاه‌ها</button><p class="muted">تغییر دستگاه از اتصال بعدی اعمال می‌شود.</p>`,
      mount: fillDevices }]);
};
async function fillDevices() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
  const devs = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  [['d-mic', 'audioinput', 'mic'], ['d-spk', 'audiooutput', 'spk'], ['d-cam', 'videoinput', 'cam']].forEach(([id, kind, key]) => {
    const sel = $('#' + id); if (!sel) return;
    devs.filter(d => d.kind === kind).forEach((d, i) => sel.insertAdjacentHTML('beforeend', `<option value="${esc(d.deviceId)}" ${prefs[key] === d.deviceId ? 'selected' : ''}>${esc(d.label || 'دستگاه ' + fa(i + 1))}</option>`));
    refreshCustomSelect(sel);
    sel.onchange = () => { prefs[key] = sel.value; savePrefs(); };
  });
}
ACT['dev-perm'] = async () => { try { (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach(t => t.stop()); } catch (_) { toast('دسترسی داده نشد', 'warn'); } settingsModal.draw(); };
ACT.theme = el => { prefs.theme = el.dataset.t; savePrefs(); settingsModal.draw(); };
CHG['pref-sound'] = el => { prefs.sound = el.checked; savePrefs(); };
CHG['pref-desktop'] = async el => {
  if (el.checked && 'Notification' in window && Notification.permission !== 'granted') { const p = await Notification.requestPermission(); if (p !== 'granted') { el.checked = false; toast('اجازه اعلان داده نشد', 'warn'); } }
  prefs.desktop = el.checked; savePrefs();
};
ACT['avatar-pick'] = () => $('#avatar-in').click();
CHG.avatar = guard(async el => { const f = el.files[0]; if (!f) return; const u = await upload(f); const r = await patch('/api/me', { avatar: u.url }); S.me = r.user; cacheUser(r.user); renderAll({ keepMain: true }); settingsModal.draw(); });
ACT['avatar-del'] = guard(async () => { const r = await patch('/api/me', { avatar: null }); S.me = r.user; cacheUser(r.user); renderAll({ keepMain: true }); settingsModal.draw(); });
ACT['acc-save'] = guard(async () => {
  const r = await patch('/api/me', { display_name: val('s-name'), status_text: val('s-status'), presence: val('s-pres') });
  S.me = r.user; cacheUser(r.user); renderAll({ keepMain: true }); toast('ذخیره شد');
});
ACT['pw-save'] = guard(async () => { await patch('/api/me', { current_password: val('s-pw0'), new_password: val('s-pw1') }); $('#s-pw0').value = $('#s-pw1').value = ''; toast('گذرواژه تغییر کرد'); });
ACT.logout = () => logout();

// ----- create / join server, invites -----
ACT['server-discover'] = guard(async () => {
  const m = modal('سرورهای برتر', '<div class="discover-loading">در حال دریافت سرورها…</div>', { cls: 'wide' });
  const r = await get('/api/servers/discover');
  if (!m.isConnected) return;
  const list = r.servers || [];
  m.querySelector('.modal-body').innerHTML = list.length ? '<div class="discover-grid">' + list.map((s, i) =>
    '<article class="discover-card"><div class="discover-card-top">' +
    (s.icon ? '<img class="discover-icon" src="' + esc(s.icon) + '" alt="">' : '<div class="discover-icon fallback">' + esc(Array.from(s.name)[0] || '?') + '</div>') +
    '<div class="discover-info"><b>' + esc(s.name) + (s.verified ? ' ' + vtick(s) : '') + '</b><small>' + fa(s.member_count) + ' عضو · ' + fa(s.online_count) + ' آنلاین</small></div>' +
    (i < 3 ? '<span class="discover-rank">' + fa(i + 1) + '</span>' : '') + '</div>' +
    '<button class="btn primary discover-join" data-act="discover-join" data-id="' + s.id + '">' + ico('plus') + ' پیوستن به سرور</button></article>'
  ).join('') + '</div>' : '<div class="empty discover-empty">' + ico('users') + '<p>فعلاً سرور عمومی‌ای برای نمایش وجود ندارد.</p><small>بعداً دوباره سر بزن.</small></div>';
});
ACT['discover-join'] = guard(async el => {
  const id = +el.dataset.id;
  el.disabled = true; el.textContent = 'در حال پیوستن…';
  const r = await post('/api/servers/' + id + '/join');
  closeModals(); await loadBootstrap(); await loadServer(r.server_id, true); openServer(r.server_id);
  toast('با موفقیت به سرور پیوستید');
});

ACT['server-new'] = () => modal('ساخت سرور', `${field('نام سرور', '<input id="n-name" maxlength="60" placeholder="مثلاً: دورهمی ما">')}<button class="btn primary" data-act="server-create">ساختن</button><hr><p class="muted">دعوت‌نامه دارید؟</p><button class="btn" data-act="server-join-open">پیوستن به سرور</button>`);
ACT['server-create'] = guard(async () => {
  const r = await post('/api/servers', { name: val('n-name') }); closeModals();
  await loadBootstrap(); await loadServer(r.server.id, true); openServer(r.server.id);
});
ACT['server-join-open'] = () => { closeModals(); modal('پیوستن به سرور', `${field('لینک یا کد دعوت', '<input id="j-code" dir="ltr" placeholder="https://…/invite/abc123">')}<button class="btn primary" data-act="server-join">پیوستن</button>`); };
ACT['server-join'] = guard(async () => { const code = val('j-code').trim().split('/').pop(); if (!code) return; await joinInvite(code); closeModals(); });
async function joinInvite(code) {
  const r = await post(`/api/invites/${encodeURIComponent(code)}/join`);
  await loadBootstrap(); await loadServer(r.server_id, true); openServer(r.server_id); toast('به سرور پیوستید');
}
ACT.invite = guard(async () => {
  const r = await post(`/api/servers/${S.cur.serverId}/invites`); const link = `${location.origin}/invite/${r.code}`;
  modal('دعوت دوستان', `<p>این لینک را برای دوستانتان بفرستید:</p><input id="inv-link" dir="ltr" readonly value="${esc(link)}"><button class="btn primary" data-act="copy-link">کپی لینک</button>`);
});
ACT['copy-link'] = () => { const i = $('#inv-link'); i.select(); (navigator.clipboard ? navigator.clipboard.writeText(i.value) : Promise.reject()).then(() => toast('کپی شد'), () => document.execCommand('copy')); };

// ----- server menu -----
ACT['server-menu'] = el => {
  const sv = curServer(), p = S.cfg.perms, has = b => sv.perms & b;
  const b = (a, t, c = '') => `<button class="${c}" data-act="${a}">${t}</button>`;
  pop(el, b('invite', ico('plus') + ' دعوت دوستان') + (has(p.MANAGE_SERVER | p.MANAGE_CHANNELS | p.MANAGE_ROLES | p.BAN) ? b('server-settings', ico('settings') + ' تنظیمات سرور') : '') +
    (has(p.MANAGE_CHANNELS) ? b('ch-new', '＃ ساخت کانال') + b('cat-new', ico('folder') + ' ساخت دسته‌بندی') : '') +
    (sv.owner ? b('server-delete', ico('trash') + ' حذف سرور', 'danger') : b('server-leave', ico('door') + ' ترک سرور', 'danger')), 'menu');
};
ACT['server-leave'] = guard(async () => { if (confirm('این سرور را ترک می‌کنید؟')) await post(`/api/servers/${S.cur.serverId}/leave`); });
ACT['server-delete'] = guard(async () => { if (confirm('سرور و همهٔ پیام‌های آن برای همیشه حذف می‌شود. مطمئنید؟')) await del(`/api/servers/${S.cur.serverId}`); });
ACT['ch-new'] = el => channelForm(el.dataset.parent ? +el.dataset.parent : null, el.dataset.type || 'text');
ACT['cat-new'] = () => channelForm(null, 'category');
function channelForm(parent, type) {
  const sv = curServer(), cats = sv.channels.filter(c => c.type === 'category');
  modal('ساخت کانال', `${field('نوع', `<select id="c-type"><option value="text" ${type === 'text' ? 'selected' : ''}>متنی</option><option value="voice" ${type === 'voice' ? 'selected' : ''}>صوتی</option><option value="category" ${type === 'category' ? 'selected' : ''}>دسته‌بندی</option></select>`)}
    ${field('نام', '<input id="c-name" maxlength="50">')}${field('دسته‌بندی', `<select id="c-parent"><option value="">— بدون دسته —</option>${cats.map(c => `<option value="${c.id}" ${c.id === parent ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>`)}
    <button class="btn primary" data-act="ch-create">ساختن</button>`);
}
ACT['ch-create'] = guard(async () => {
  await post(`/api/servers/${S.cur.serverId}/channels`, { type: val('c-type'), name: val('c-name'), parent_id: val('c-parent') ? +val('c-parent') : null });
  closeModals(); await loadServer(S.cur.serverId, true); renderAll({ keepMain: true });
});

// ----- server settings (overview / channels / roles / bans) -----
let ssModal, ssRole = null, ssBans = null;
const sid = () => S.cur.serverId;
const redrawSS = async () => { await loadServer(sid(), true); renderAll({ keepMain: true }); ssModal && ssModal.draw(); };
ACT['server-settings'] = () => {
  closePop(); ssRole = null; ssBans = null; const p = S.cfg.perms, has = b => curServer().perms & b;
  const tabs = [];
  if (has(p.MANAGE_SERVER)) tabs.push({ id: 'ov', label: 'نمای کلی', html: () => { const s = curServer().server; return `<div class="row">${s.icon ? `<img class="av av-xl" src="${esc(s.icon)}" alt="">` : avatar({ id: s.id, display_name: s.name }, 'av-xl')}<div><button class="btn" data-act="icon-pick">تغییر آیکون</button> ${s.icon ? '<button class="btn ghost" data-act="icon-del">حذف</button>' : ''}<input type="file" id="icon-in" accept="image/*" hidden data-change="server-icon"></div></div>${field('نام سرور', `<input id="ss-name" maxlength="60" value="${esc(s.name)}">`)}<button class="btn primary" data-act="ss-save">ذخیره</button>`; } });
  if (has(p.MANAGE_CHANNELS)) tabs.push({ id: 'ch', label: 'کانال‌ها', html: channelsTab });
  if (has(p.MANAGE_ROLES)) tabs.push({ id: 'roles', label: 'نقش‌ها', html: rolesTab });
  if (has(p.BAN)) tabs.push({ id: 'bans', label: 'مسدودشده‌ها', html: bansTab, mount: async b => { if (!ssBans) { ssBans = (await get(`/api/servers/${sid()}/bans`).catch(() => ({ bans: [] }))).bans; ssModal.draw(); } } });
  if (!tabs.length) return;
  ssModal = tabbed('تنظیمات سرور', tabs, { cls: 'wide' });
};
ACT['icon-pick'] = () => $('#icon-in').click();
CHG['server-icon'] = guard(async el => { const f = el.files[0]; if (!f) return; const u = await upload(f); await patch(`/api/servers/${sid()}`, { icon: u.url }); await redrawSS(); });
ACT['icon-del'] = guard(async () => { await patch(`/api/servers/${sid()}`, { icon: null }); await redrawSS(); });
ACT['ss-save'] = guard(async () => { await patch(`/api/servers/${sid()}`, { name: val('ss-name') }); await redrawSS(); toast('ذخیره شد'); });

function channelsTab() {
  const chs = curServer().channels, cats = chs.filter(c => c.type === 'category');
  const row = (c, ic) => `<div class="list-row"><span>${ic} ${esc(c.name)}</span><span class="grow"></span>
    <button class="icon-btn" data-act="ch-move" data-id="${c.id}" data-d="-1">▲</button><button class="icon-btn" data-act="ch-move" data-id="${c.id}" data-d="1">▼</button>
    <button class="icon-btn" data-act="ch-rename" data-id="${c.id}">✎</button><button class="icon-btn" data-act="ch-del" data-id="${c.id}">${ico('trash')}</button></div>`;
  const groups = [...cats.map(c => ({ cat: c, kids: chs.filter(x => x.parent_id === c.id) })), { cat: null, kids: chs.filter(x => x.type !== 'category' && !x.parent_id) }];
  return `<div class="row"><button class="btn" data-act="ch-new">＋ کانال</button><button class="btn" data-act="cat-new">＋ دسته‌بندی</button></div>` +
    groups.map(g => (g.cat ? row(g.cat, ico('folder')) : (g.kids.length ? '<div class="muted">بدون دسته</div>' : '')) + `<div class="indent">${g.kids.map(k => row(k, k.type === 'voice' ? ico('volume') : '#')).join('')}</div>`).join('');
}
ACT['ch-rename'] = guard(async el => { const c = curServer().channels.find(x => x.id === +el.dataset.id), n = prompt('نام جدید:', c.name); if (n && n.trim()) { await patch(`/api/channels/${c.id}`, { name: n }); await redrawSS(); } });
ACT['ch-del'] = guard(async el => { if (confirm('این مورد حذف شود؟ پیام‌های کانال هم پاک می‌شوند.')) { await del(`/api/channels/${el.dataset.id}`); await redrawSS(); } });
ACT['ch-move'] = guard(async el => {
  const chs = curServer().channels, c = chs.find(x => x.id === +el.dataset.id), d = +el.dataset.d;
  const sib = chs.filter(x => (c.type === 'category') === (x.type === 'category') && x.parent_id === c.parent_id).sort((a, b) => a.position - b.position || a.id - b.id);
  const i = sib.findIndex(x => x.id === c.id), j = i + d; if (j < 0 || j >= sib.length) return;
  [sib[i], sib[j]] = [sib[j], sib[i]];
  await put(`/api/servers/${sid()}/channels/order`, { items: sib.map((x, k) => ({ id: x.id, parent_id: x.parent_id, position: k })) }); await redrawSS();
});

function rolesTab() {
  const sv = curServer(), roles = sv.roles, r = roles.find(x => x.id === ssRole);
  const list = roles.map(x => `<button class="list-row sel${x.id === ssRole ? ' on' : ''}" data-act="role-sel" data-id="${x.id}"><i class="rdot" style="background:${esc(x.color || '#8b98a5')}"></i> ${esc(x.name)}</button>`).join('');
  const ed = !r ? '<p class="muted">یک نقش را انتخاب کنید یا نقش جدید بسازید.</p>' : `
    ${r.is_default ? '' : field('نام نقش', `<input id="r-name" maxlength="32" value="${esc(r.name)}">`)}
    ${field('رنگ', `<input id="r-color" type="color" value="${esc(r.color || '#8b98a5')}">`)}
    <div class="perms">${PERM_LABELS.map(([k, t]) => `<label class="check"><input type="checkbox" class="r-perm" data-bit="${S.cfg.perms[k]}" ${r.permissions & S.cfg.perms[k] ? 'checked' : ''}> ${t}</label>`).join('')}</div>
    <div class="row"><button class="btn primary" data-act="role-save">ذخیره</button>
    ${sv.owner && !r.is_default ? '<button class="btn" data-act="role-move" data-d="-1">▲ بالاتر</button><button class="btn" data-act="role-move" data-d="1">▼ پایین‌تر</button>' : ''}
    ${r.is_default ? '' : '<button class="btn danger" data-act="role-del">حذف</button>'}</div>`;
  return `<div class="two-col"><div><button class="btn" data-act="role-new">＋ نقش جدید</button><div class="list">${list}</div></div><div>${ed}</div></div>`;
}
ACT['role-sel'] = el => { ssRole = +el.dataset.id; ssModal.draw(); };
ACT['role-new'] = guard(async () => { const r = await post(`/api/servers/${sid()}/roles`, { name: 'نقش جدید', permissions: 0 }); ssRole = r.role.id; await redrawSS(); });
ACT['role-save'] = guard(async () => {
  let perms = 0; $$('.r-perm').forEach(c => { if (c.checked) perms |= +c.dataset.bit; });
  const body = { permissions: perms, color: val('r-color') }; if ($('#r-name')) body.name = val('r-name');
  await patch(`/api/roles/${ssRole}`, body); await redrawSS(); toast('ذخیره شد');
});
ACT['role-del'] = guard(async () => { if (confirm('این نقش حذف شود؟')) { await del(`/api/roles/${ssRole}`); ssRole = null; await redrawSS(); } });
ACT['role-move'] = guard(async el => {
  const ids = curServer().roles.filter(r => !r.is_default).map(r => r.id), i = ids.indexOf(ssRole), j = i + +el.dataset.d; if (j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]]; await put(`/api/servers/${sid()}/roles/order`, { ids }); await redrawSS();
});
function bansTab() {
  if (!ssBans) return '<p class="muted">در حال بارگذاری…</p>';
  return ssBans.length ? ssBans.map(b => `<div class="list-row">${avatar(b.user, 'av-s')} <b>${esc(b.user.display_name)}</b><span class="muted">${esc(b.reason || '')}</span><span class="grow"></span><button class="btn" data-act="unban" data-id="${b.user.id}">رفع مسدودی</button></div>`).join('') : '<p class="muted">کسی مسدود نشده است.</p>';
}
ACT.unban = guard(async el => { await del(`/api/servers/${sid()}/bans/${el.dataset.id}`); ssBans = null; ssModal.draw(); });

// ----- profile card + moderation -----
ACT.profile = guard(async el => {
  closePop(); const uid = +el.dataset.uid, u = userOf(uid); if (!u) return;
  const sv = curServer(), mem = sv && sv.members.find(m => m.id === uid), p = S.cfg.perms, mine = uid === S.me.id;
  const isF = S.social.friends.some(f => f.id === uid), inc = S.social.incoming.some(f => f.id === uid), out = S.social.outgoing.some(f => f.id === uid), blk = S.social.blocked.some(f => f.id === uid);
  const b = (a, t, c = '') => `<button class="btn ${c}" data-act="${a}" data-uid="${uid}">${t}</button>`;
  let html = `<div class="profile">${avatar(u, 'av-xl')}<div><h3>${esc(u.display_name)}${vtick(u)}</h3><div class="muted">@${esc(u.username)} · ${dot(u.presence)} ${PRESENCE_FA[u.presence]}</div>${u.status_text ? `<p>${esc(u.status_text)}</p>` : ''}${mem ? `<div class="muted">عضویت: ${esc(jDate(mem.joined_at))}</div>` : ''}</div></div>`;
  if (mem && sv) html += `<div class="chips">${sv.roles.filter(r => !r.is_default && mem.role_ids.includes(r.id)).map(r => `<span class="chip"><i class="rdot" style="background:${esc(r.color || '#8b98a5')}"></i>${esc(r.name)}</span>`).join('')}</div>`;
  if (!mine) {
    html += `<div class="row">${b('dm-open', ico('message') + ' پیام')}${isF ? b('friend-rm', 'حذف دوست') : inc ? b('friend-acc', 'پذیرفتن درخواست') : out ? b('friend-cancel', 'لغو درخواست') : blk ? '' : b('friend-add', ico('plus') + ' افزودن دوست')}${blk ? b('unblock', 'رفع مسدودی') : b('block', 'مسدود', 'ghost')}</div>`;
    if (mem && sv) {
      if (sv.perms & p.MANAGE_ROLES) html += `<h4>نقش‌ها</h4><div class="perms">${sv.roles.filter(r => !r.is_default).map(r => `<label class="check"><input type="checkbox" class="m-role" data-id="${r.id}" ${mem.role_ids.includes(r.id) ? 'checked' : ''}> ${esc(r.name)}</label>`).join('') || '<span class="muted">نقشی ساخته نشده</span>'}</div><button class="btn" data-act="roles-save" data-uid="${uid}">ذخیرهٔ نقش‌ها</button>`;
      const mods = [];
      if (sv.perms & p.TIMEOUT) mods.push(b('timeout', '⏱ تایم‌اوت') + b('untimeout', 'لغو تایم‌اوت', 'ghost'));
      if (sv.perms & p.KICK) mods.push(b('kick', 'اخراج', 'danger'));
      if (sv.perms & p.BAN) mods.push(b('ban', 'مسدود از سرور', 'danger'));
      if (mods.length) html += `<h4>مدیریت</h4><div class="row">${mods.join('')}</div>`;
    }
  }
  modal('پروفایل', html);
});
const tuid = el => +el.dataset.uid;
ACT['dm-open'] = guard(async el => { closeModals(); await openDmWith(tuid(el)); });
ACT['friend-add'] = guard(async el => { await post('/api/friends/request', { username: userOf(tuid(el)).username }); toast('درخواست ارسال شد'); closeModals(); });
ACT['friend-acc'] = guard(async el => { await post(`/api/friends/${tuid(el)}/accept`); closeModals(); });
ACT['friend-cancel'] = ACT['friend-dec'] = guard(async el => { await post(`/api/friends/${tuid(el)}/decline`); closeModals(); });
ACT['friend-rm'] = guard(async el => { if (confirm('از فهرست دوستان حذف شود؟')) { await del(`/api/friends/${tuid(el)}`); closeModals(); } });
ACT.block = guard(async el => { if (confirm('این کاربر مسدود شود؟')) { await post(`/api/blocks/${tuid(el)}`); closeModals(); } });
ACT.unblock = guard(async el => { await del(`/api/blocks/${tuid(el)}`); closeModals(); });
ACT['roles-save'] = guard(async el => { await put(`/api/servers/${sid()}/members/${tuid(el)}/roles`, { role_ids: $$('.m-role').filter(c => c.checked).map(c => +c.dataset.id) }); await loadServer(sid(), true); closeModals(); renderAll({ keepMain: true }); toast('نقش‌ها ذخیره شد'); });
ACT.kick = guard(async el => { if (confirm('این عضو اخراج شود؟')) { await post(`/api/servers/${sid()}/members/${tuid(el)}/kick`); closeModals(); } });
ACT.ban = guard(async el => { const r = prompt('دلیل مسدودسازی (اختیاری):'); if (r !== null) { await post(`/api/servers/${sid()}/members/${tuid(el)}/ban`, { reason: r }); closeModals(); } });
ACT.timeout = guard(async el => { const m = prompt('مدت تایم‌اوت به دقیقه (حداکثر ۴۰۳۲۰):', '10'); if (m) { await post(`/api/servers/${sid()}/members/${tuid(el)}/timeout`, { minutes: +m }); closeModals(); toast('انجام شد'); } });
ACT.untimeout = guard(async el => { await post(`/api/servers/${sid()}/members/${tuid(el)}/timeout`, { minutes: 0 }); closeModals(); toast('تایم‌اوت لغو شد'); });

// ----- group DM -----
ACT['group-new'] = () => {
  const fr = S.social.friends;
  modal('ساخت گروه', fr.length ? `${field('نام گروه (اختیاری)', '<input id="g-name" maxlength="50">')}<div class="perms">${fr.map(f => `<label class="check"><input type="checkbox" class="g-u" data-id="${f.id}"> ${esc(f.display_name)}</label>`).join('')}</div><button class="btn primary" data-act="group-create">ساختن</button>` : '<p class="muted">برای ساخت گروه ابتدا دوست اضافه کنید.</p>');
};
ACT['group-create'] = guard(async () => {
  const ids = $$('.g-u').filter(c => c.checked).map(c => +c.dataset.id); if (!ids.length) return toast('حداقل یک نفر را انتخاب کنید', 'warn');
  const r = await post('/api/dms', { user_ids: ids, name: val('g-name') }); closeModals(); await reloadSocial(); openDm(r.dm.id);
});

// ----- announcement popup -----
function showAnnouncement(text) { if (text) modal(ico('megaphone') + ' اطلاعیه', `<p>${esc(text).replace(/\n/g, '<br>')}</p>`); }

// ----- site admin panel (stats, users, blue ticks, servers, announcements, settings, audit log...) -----
const adm = { users: [], servers: [], online: [], log: [], stats: {}, settings: {}, q: '' };
let admModal;
const ADM_ACTIONS = { 'ban-user': 'مسدود کاربر', 'unban-user': 'رفع مسدودی', 'verify-user': 'تیک آبی کاربر', 'unverify-user': 'برداشتن تیک کاربر', 'grant-admin': 'دادن مدیریت', 'revoke-admin': 'گرفتن مدیریت', 'reset-password': 'ریست گذرواژه', 'force-logout': 'خروج اجباری', 'edit-profile': 'ویرایش پروفایل', 'purge-messages': 'حذف پیام‌های کاربر', 'delete-user': 'حذف حساب', 'verify-server': 'تیک آبی سرور', 'unverify-server': 'برداشتن تیک سرور', 'delete-server': 'حذف سرور', 'announce': 'ارسال اطلاعیه', 'clear-announcement': 'پاک کردن اطلاعیه', 'open-registration': 'باز کردن ثبت‌نام', 'close-registration': 'بستن ثبت‌نام' };
const admLoad = guard(async () => {
  const [st, us, sv, on, lg, se] = await Promise.all([get('/api/admin/stats'), get('/api/admin/users'), get('/api/admin/servers'), get('/api/admin/online'), get('/api/admin/log'), get('/api/admin/settings')]);
  Object.assign(adm, { stats: st.stats, users: us.users, servers: sv.servers, online: on.users, log: lg.log, settings: se.settings });
  if (admModal && document.body.contains(admModal)) admModal.draw();
});
const admUserRows = () => adm.users.filter(u => !adm.q || (u.username + ' ' + u.display_name).toLowerCase().includes(adm.q.toLowerCase())).map(u =>
  `<button class="list-row" data-act="adm-user" data-id="${u.id}">${avatar(u, 'av-s')}<b>${esc(u.display_name)}</b>${vtick(u)}<span class="muted">@${esc(u.username)}</span>${u.is_admin ? '<span class="chip">مدیر</span>' : ''}${u.banned ? '<span class="chip red">مسدود</span>' : ''}<span class="grow"></span><small>${fa(u.message_count)} پیام</small></button>`).join('') || '<p class="muted center">کاربری پیدا نشد.</p>';
ACT.admin = () => {
  closeModals();
  admModal = tabbed('پنل مدیریت سایت', [
    { id: 'ov', label: 'نمای کلی', html: () => { const s = adm.stats; return `<div class="stats">${[['کاربران', s.users], ['آنلاین', s.online], ['سرورها', s.servers], ['کانال‌ها', s.channels], ['پیام‌ها', s.messages], ['پیام ۲۴ ساعت', s.messages_24h], ['عضو جدید (۷ روز)', s.new_users_7d], ['مسدودشده', s.banned], ['تیک کاربران', s.verified_users], ['تیک سرورها', s.verified_servers]].map(([t, n]) => `<div class="stat"><b>${fa(n || 0)}</b><small>${t}</small></div>`).join('')}</div>
      <label class="check"><input type="checkbox" data-change="adm-reg" ${adm.settings.registration_open ? 'checked' : ''}> ثبت‌نام کاربران جدید باز باشد</label><hr>
      <h4>اطلاعیهٔ سراسری</h4><textarea id="adm-ann" rows="3" maxlength="500" placeholder="متن اطلاعیه برای همهٔ کاربران…">${esc(adm.settings.announcement || '')}</textarea>
      <div class="row"><button class="btn primary" data-act="adm-announce">ارسال به همه</button><button class="btn ghost" data-act="adm-announce-clear">پاک کردن</button></div>`; } },
    { id: 'u', label: 'کاربران', html: () => `<input id="adm-q" placeholder="جستجوی کاربر…" value="${esc(adm.q)}"><div id="adm-list">${admUserRows()}</div>`,
      mount: b => { const i = $('#adm-q', b); i.oninput = () => { adm.q = i.value; $('#adm-list').innerHTML = admUserRows(); }; } },
    { id: 's', label: 'سرورها', html: () => adm.servers.map(s => `<div class="list-row"><b>${esc(s.name)}</b>${vtick(s)}<span class="muted">مالک: ${esc(s.owner_name)} · ${fa(s.member_count)} عضو · ${fa(s.channel_count)} کانال</span><span class="grow"></span><button class="btn ${s.verified ? '' : 'primary'}" data-act="adm-stick" data-id="${s.id}" data-v="${s.verified ? 0 : 1}">${s.verified ? 'برداشتن تیک' : '✔ تیک آبی'}</button><button class="btn danger" data-act="adm-del" data-id="${s.id}">حذف</button></div>`).join('') || '<p class="muted center">سروری وجود ندارد.</p>' },
    { id: 'on', label: 'آنلاین‌ها', html: () => adm.online.map(u => `<button class="list-row" data-act="adm-user" data-id="${u.id}">${avatar(u, 'av-s')}<b>${esc(u.display_name)}</b>${vtick(u)}<span class="muted">@${esc(u.username)}</span></button>`).join('') || '<p class="muted center">کسی آنلاین نیست.</p>' },
    { id: 'log', label: 'گزارش', html: () => adm.log.map(l => `<div class="list-row"><b>${esc(l.admin_name || '؟')}</b><span>${esc(ADM_ACTIONS[l.action] || l.action)}</span><span class="muted">${esc(l.target || '')}</span><span class="grow"></span><small>${esc(jStamp(l.created_at))}</small></div>`).join('') || '<p class="muted center">هنوز رویدادی ثبت نشده است.</p>' }], { cls: 'wide' });
  admLoad();
};
CHG['adm-reg'] = guard(async el => { await post('/api/admin/settings', { registration_open: el.checked }); await admLoad(); });
ACT['adm-announce'] = guard(async () => { await post('/api/admin/announce', { text: val('adm-ann') }); toast('ارسال شد'); await admLoad(); });
ACT['adm-announce-clear'] = guard(async () => { await post('/api/admin/announce', { text: '' }); await admLoad(); });
ACT['adm-stick'] = guard(async el => { await post(`/api/admin/servers/${el.dataset.id}/verify`, { verified: el.dataset.v === '1' }); await admLoad(); });
ACT['adm-del'] = guard(async el => { if (confirm('این سرور برای همیشه حذف شود؟')) { await del(`/api/admin/servers/${el.dataset.id}`); await admLoad(); } });
ACT['adm-user'] = el => {
  const u = adm.users.find(x => x.id === +el.dataset.id) || adm.online.find(x => x.id === +el.dataset.id); if (!u) return;
  const me = S.me, root = u.is_root, b = (a, t, c = '') => `<button class="btn ${c}" data-act="${a}" data-id="${u.id}">${t}</button>`;
  modal(u.display_name, `<div class="profile">${avatar(u, 'av-xl')}<div><h3>${esc(u.display_name)}${vtick(u)}</h3><div class="muted">@${esc(u.username)}</div>${u.created_at ? `<div class="muted">عضویت: ${esc(jDate(u.created_at))}</div>` : ''}</div></div><hr>
    <div class="admin-actions">${b('adm-tick', u.verified ? 'برداشتن تیک آبی' : '✔ دادن تیک آبی', u.verified ? '' : 'primary')}${b('adm-rename', '✎ ویرایش نام / پاک کردن وضعیت')}
    ${b('adm-pass', ico('key') + ' ریست گذرواژه')}${b('adm-logout', '⎋ خروج اجباری')}
    ${root ? '' : b('adm-purge', ico('broom') + ' حذف همهٔ پیام‌ها', 'ghost')}${!root && me.is_root ? b('adm-admin', u.is_admin ? 'گرفتن دسترسی مدیریت' : ico('shield') + ' دادن دسترسی مدیریت') : ''}
    ${root || u.is_admin ? '' : b('adm-ban', u.banned ? 'رفع مسدودی' : ico('ban') + ' مسدود کردن', u.banned ? '' : 'danger')}${root || u.is_admin ? '' : b('adm-user-del', ico('trash') + ' حذف حساب', 'danger')}</div>`);
};
const admDo = fn => guard(async el => { const r = await fn(el, adm.users.find(x => x.id === +el.dataset.id) || adm.online.find(x => x.id === +el.dataset.id)); if (r === false) return; const m = el.closest('.modal-back'); if (m) m.close(); await admLoad(); toast('انجام شد'); });
ACT['adm-tick'] = admDo((el, u) => post(`/api/admin/users/${u.id}/verify`, { verified: !u.verified }));
ACT['adm-ban'] = admDo((el, u) => post(`/api/admin/users/${u.id}/ban`, { banned: !u.banned }));
ACT['adm-admin'] = admDo((el, u) => post(`/api/admin/users/${u.id}/admin`, { admin: !u.is_admin }));
ACT['adm-logout'] = admDo((el, u) => post(`/api/admin/users/${u.id}/logout`));
ACT['adm-pass'] = admDo((el, u) => { const p = prompt(`گذرواژهٔ جدید برای ${u.display_name} (حداقل ۶ نویسه):`); return p ? post(`/api/admin/users/${u.id}/password`, { password: p }) : false; });
ACT['adm-rename'] = admDo((el, u) => { const n = prompt('نام نمایشی جدید (برای فقط پاک کردن وضعیت، خالی بگذارید):', u.display_name); return n === null ? false : post(`/api/admin/users/${u.id}/rename`, { display_name: n, clear_status: confirm('متن وضعیت هم پاک شود؟') }); });
ACT['adm-purge'] = admDo((el, u) => confirm(`همهٔ پیام‌های ${u.display_name} حذف شود؟`) ? del(`/api/admin/users/${u.id}/messages`) : false);
ACT['adm-user-del'] = admDo((el, u) => confirm(`حساب ${u.display_name} و سرورهای او برای همیشه حذف شود؟`) ? del(`/api/admin/users/${u.id}`) : false);
