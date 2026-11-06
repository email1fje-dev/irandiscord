'use strict';
// Entry point: Express (REST + static files) and Socket.IO on the same HTTP server.
const http = require('http');
const path = require('path');
const fs = require('fs');
const express = require('express');
const { Server } = require('socket.io');
const cfg = require('./config');

if (!process.env.DATABASE_URL) {
  console.error('[fatal] DATABASE_URL is not set. On Railway: add the PostgreSQL plugin and reference its DATABASE_URL variable.');
  process.exit(1);
}
const db = require('./db');
const bus = require('./bus');
const { HttpError } = require('./util');
const { router: authRouter, meRouter, auth } = require('./routes/auth');

const PUBLIC = path.join(__dirname, 'public');
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Health check always answers 200 as soon as the process is up (Railway healthcheck)
app.get('/health', (req, res) => res.status(200).json({ ok: true, db: bus.ready }));
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'SAMEORIGIN' });
  next();
});

// Uploaded files: only media is rendered inline, everything else is forced to download (prevents XSS via uploads)
fs.mkdirSync(cfg.UPLOAD_DIR, { recursive: true });
const INLINE = /\.(png|jpe?g|gif|webp|mp4|webm|mov|mp3|ogg|wav|m4a)$/i;
app.use('/uploads', express.static(cfg.UPLOAD_DIR, {
  index: false, maxAge: '365d', immutable: true,
  setHeaders: (res, p) => { if (!INLINE.test(p)) res.setHeader('Content-Disposition', 'attachment'); },
}));

// index.html is a template so the brand name lives only in config.js
const escHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const indexHtml = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8')
  .replace(/{{APP_NAME}}/g, escHtml(cfg.APP_NAME)).replace(/{{APP_TAGLINE}}/g, escHtml(cfg.APP_TAGLINE));
const sendIndex = (req, res) => res.set('Cache-Control', 'no-cache').type('html').send(indexHtml);
app.get('/', sendIndex);
app.get('/invite/:code', sendIndex);
app.use(express.static(PUBLIC, { index: false }));

// ---- API ----
app.use('/api', express.json({ limit: '1mb' }));
app.use('/api', (req, res, next) => bus.ready ? next() : res.status(503).json({ error: 'سرور در حال آماده‌سازی است؛ چند ثانیه دیگر دوباره تلاش کنید' }));
app.get('/api/config', async (req, res, next) => {
  try {
    res.json({ name: cfg.APP_NAME, tagline: cfg.APP_TAGLINE, perms: cfg.P, iceServers: cfg.iceServers(),
      announcement: await db.getSetting('announcement', ''), registration_open: (await db.getSetting('registration_open', '1')) === '1' });
  } catch (e) { next(e); }
});
app.use('/api/auth', authRouter);
// Everything below requires a valid session (auth runs once for the whole group)
const api = express.Router();
api.use(auth, meRouter, require('./routes/social').router, require('./routes/servers').router,
  require('./routes/messages').router, require('./routes/admin').router);
api.use((req, res) => res.status(404).json({ error: 'مسیر پیدا نشد' }));
app.use('/api', api);

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'حجم فایل بیش از حد مجاز (۲۵ مگابایت) است' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'درخواست نامعتبر است' });
  console.error('[error]', err);
  res.status(500).json({ error: 'خطای داخلی سرور' });
});

const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e6 });
require('./socket')(io);

// ---- Vazirmatn font: fetched once at boot by the server and then served locally from /fonts ----
const RANGES = {
  arabic: 'U+0600-06FF,U+0750-077F,U+08A0-08FF,U+200C-200F,U+FB50-FDFF,U+FE70-FEFF',
  latin: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2013-2014,U+2018-201D,U+2022,U+2026,U+20AC,U+2122',
};
async function ensureFonts() {
  const dir = path.join(PUBLIC, 'fonts');
  fs.mkdirSync(dir, { recursive: true });
  const faces = [['arabic', 400], ['arabic', 700], ['latin', 400], ['latin', 700]];
  const fileOf = (s, w) => `Vazirmatn-${s}-${w}.woff2`;
  const writeCss = () => {
    const css = faces.filter(([s, w]) => fs.existsSync(path.join(dir, fileOf(s, w)))).map(([s, w]) =>
      `@font-face{font-family:'Vazirmatn';font-style:normal;font-weight:${w};font-display:swap;src:url('/fonts/${fileOf(s, w)}') format('woff2');unicode-range:${RANGES[s]}}`).join('\n');
    fs.writeFileSync(path.join(dir, 'fonts.css'), css || '/* Vazirmatn files not available: system fonts are used */');
  };
  writeCss();
  for (const [s, w] of faces) {
    const dest = path.join(dir, fileOf(s, w));
    if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) continue;
    try {
      const r = await fetch(`https://cdn.jsdelivr.net/npm/@fontsource/vazirmatn@5/files/vazirmatn-${s}-${w}-normal.woff2`, { signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
    } catch (e) { console.warn(`[fonts] could not fetch ${fileOf(s, w)}: ${e.message} (system fonts will be used)`); }
  }
  writeCss();
}
ensureFonts().catch(e => console.warn('[fonts]', e.message));

const PORT = parseInt(process.env.PORT, 10) || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`[server] ${cfg.APP_NAME} listening on 0.0.0.0:${PORT}`));
db.init().then(() => require('./seed').seedRoot()).then(() => { bus.ready = true; console.log('[server] database ready'); })
  .catch(e => { console.error('[fatal] database init failed:', e.message); process.exit(1); });
process.on('unhandledRejection', e => console.error('[unhandledRejection]', e));
