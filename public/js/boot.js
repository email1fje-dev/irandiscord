'use strict';
// ---------- startup, login / register screen ----------
let pendingInvite = location.pathname.startsWith('/invite/') ? location.pathname.split('/')[2] : null;

function showAuth(mode = 'login') {
  $('#app').hidden = true; $('#boot').hidden = true; const a = $('#auth'); a.hidden = false;
  const reg = mode === 'register';
  a.innerHTML = `<form class="auth-card" id="auth-form" autocomplete="on"><div class="auth-logo">${LOGO}</div><h1>${esc(window.APP_NAME)}</h1><p class="muted">${esc(window.APP_TAGLINE)}</p>
    ${pendingInvite ? '<div class="notice">برای پیوستن به سرور دعوت‌شده، وارد شوید یا ثبت‌نام کنید.</div>' : ''}
    <label class="field"><span>نام کاربری</span><input id="a-user" dir="ltr" autocomplete="username" required></label>
    ${reg ? '<label class="field"><span>نام نمایشی</span><input id="a-name" maxlength="32" autocomplete="nickname"></label>' : ''}
    <label class="field"><span>گذرواژه</span><input id="a-pass" type="password" dir="ltr" autocomplete="${reg ? 'new-password' : 'current-password'}" required></label>
    <div id="a-err" class="err"></div>
    <button class="btn primary big" type="submit">${reg ? 'ثبت‌نام' : 'ورود'}</button>
    ${!reg && S.cfg && S.cfg.registration_open === false ? '<p class="muted">ثبت‌نام موقتاً بسته است.</p>' : `<button class="btn link" type="button" id="a-switch">${reg ? 'حساب دارید؟ وارد شوید' : 'حساب ندارید؟ ثبت‌نام کنید'}</button>`}</form>`;
  if ($('#a-switch')) $('#a-switch').onclick = () => showAuth(reg ? 'login' : 'register');
  $('#auth-form').onsubmit = async e => {
    e.preventDefault(); $('#a-err').textContent = '';
    try {
      const r = await api('POST', '/api/auth/' + (reg ? 'register' : 'login'), { username: $('#a-user').value, password: $('#a-pass').value, display_name: reg ? $('#a-name').value : undefined });
      S.token = r.token; localStorage.setItem('nv_token', r.token); S.me = r.user; cacheUser(r.user); await startApp();
    } catch (err) { $('#a-err').textContent = err.message; }
  };
}

async function startApp() {
  $('#auth').hidden = true; $('#boot').hidden = true; $('#app').hidden = false;
  await loadBootstrap(); connectSocket();
  if (pendingInvite) {
    const code = pendingInvite; pendingInvite = null; history.replaceState(null, '', '/');
    try { await joinInvite(code); } catch (e) { toast(e.message, 'err'); goHome(); }
  } else goHome();
  renderAll();
  if (S.cfg.announcement && localStorage.getItem('nv_ann') !== S.cfg.announcement) { localStorage.setItem('nv_ann', S.cfg.announcement); showAnnouncement(S.cfg.announcement); }
}

(async function boot() {
  $('#boot-logo').innerHTML = LOGO;
  for (let i = 0; i < 30; i++) { // the API answers 503 for a few seconds while the database starts
    try {
      const r = await fetch('/api/config');
      if (r.ok) { S.cfg = await r.json(); break; }
    } catch (_) {}
    await new Promise(res => setTimeout(res, 1500));
  }
  if (!S.cfg) { document.querySelector('.boot-text').textContent = 'ارتباط با سرور برقرار نشد. صفحه را دوباره بارگذاری کنید.'; return; }
  document.title = S.cfg.name;
  if (S.token) {
    try { const r = await api('GET', '/api/me'); S.me = r.user; cacheUser(r.user); await startApp(); return; }
    catch (e) { /* invalid session: fall through to login */ }
  }
  showAuth();
})();
