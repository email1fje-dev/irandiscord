'use strict';
// Registration, login, token verification, and the "me" (profile) endpoints.
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { one, q, getSetting } = require('../db');
const { JWT_SECRET, ROOT_USERNAME } = require('../config');
const bus = require('../bus');
const { HttpError, bad, wrap, pub, forbidden } = require('../util');

const router = express.Router();   // public: /api/auth/*
const meRouter = express.Router(); // authenticated: /api/me

const sign = u => jwt.sign({ id: u.id, v: u.token_version || 0 }, JWT_SECRET, { expiresIn: '60d' });
const meView = u => ({ ...pub(u), presence: u.presence, is_admin: u.is_admin, is_root: u.username === ROOT_USERNAME });

// Returns the user row for a valid token, or null (also null for banned users)
async function verifyToken(token) {
  if (!token) return null;
  let p; try { p = jwt.verify(token, JWT_SECRET); } catch (_) { return null; }
  const u = await one('SELECT * FROM users WHERE id=$1', [p.id]);
  return u && !u.banned && (p.v || 0) === u.token_version ? u : null;
}
async function auth(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    const t = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!t) throw new HttpError(401, 'ابتدا وارد شوید');
    let p; try { p = jwt.verify(t, JWT_SECRET); } catch (_) { throw new HttpError(401, 'نشست نامعتبر یا منقضی است'); }
    const u = await one('SELECT * FROM users WHERE id=$1', [p.id]);
    if (!u) throw new HttpError(401, 'کاربر پیدا نشد');
    if ((p.v || 0) !== u.token_version) throw new HttpError(401, 'نشست شما توسط مدیر پایان یافت؛ دوباره وارد شوید');
    if (u.banned) throw new HttpError(403, 'حساب شما مسدود شده است');
    req.user = u; next();
  } catch (e) { next(e); }
}

// Tiny in-memory rate limiter (per IP) for credential endpoints
const hits = new Map();
const limit = (max, ms) => (req, res, next) => {
  const k = req.ip + req.path, now = Date.now();
  let h = hits.get(k); if (!h || now - h.t > ms) { h = { n: 0, t: now }; hits.set(k, h); }
  if (++h.n > max) return next(new HttpError(429, 'تلاش‌های زیاد؛ چند دقیقه بعد دوباره امتحان کنید'));
  next();
};
setInterval(() => { const now = Date.now(); for (const [k, h] of hits) if (now - h.t > 3600e3) hits.delete(k); }, 600e3).unref();

router.post('/register', limit(15, 600e3), wrap(async (req, res) => {
  if ((await getSetting('registration_open', '1')) !== '1') throw forbidden('ثبت‌نام در حال حاضر بسته است');
  let { username, password, display_name } = req.body || {};
  username = String(username || '').trim().toLowerCase();
  password = String(password || '');
  if (!/^[\p{L}\p{N}_.]{3,24}$/u.test(username)) throw bad('نام کاربری باید ۳ تا ۲۴ نویسه و فقط شامل حرف، عدد، _ یا . باشد');
  if (password.length < 6 || password.length > 100) throw bad('گذرواژه باید حداقل ۶ نویسه باشد');
  display_name = String(display_name || '').trim().slice(0, 32) || username;
  const hash = await bcrypt.hash(password, 10);
  let u;
  try {
    // The very first registered user becomes the site admin (atomic in a single statement)
    u = await one(`INSERT INTO users(username,display_name,password_hash,is_admin)
                   VALUES($1,$2,$3, NOT EXISTS(SELECT 1 FROM users)) RETURNING *`, [username, display_name, hash]);
  } catch (e) {
    if (e.code === '23505') throw new HttpError(409, 'این نام کاربری قبلاً گرفته شده است');
    throw e;
  }
  res.json({ token: sign(u), user: meView(u) });
}));

router.post('/login', limit(30, 600e3), wrap(async (req, res) => {
  const username = String((req.body || {}).username || '').trim().toLowerCase();
  const password = String((req.body || {}).password || '');
  const u = await one('SELECT * FROM users WHERE username=$1', [username]);
  if (!u || !(await bcrypt.compare(password, u.password_hash))) throw new HttpError(401, 'نام کاربری یا گذرواژه اشتباه است');
  if (u.banned) throw new HttpError(403, 'حساب شما مسدود شده است');
  res.json({ token: sign(u), user: meView(u) });
}));

meRouter.get('/me', (req, res) => res.json({ user: meView(req.user) }));

meRouter.patch('/me', wrap(async (req, res) => {
  const b = req.body || {}, sets = [], vals = [];
  const set = (col, v) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
  if (b.display_name !== undefined) {
    const v = String(b.display_name).trim().slice(0, 32);
    if (!v) throw bad('نام نمایشی نمی‌تواند خالی باشد');
    set('display_name', v);
  }
  if (b.status_text !== undefined) set('status_text', String(b.status_text).trim().slice(0, 100));
  if (b.presence !== undefined) {
    if (!['online', 'idle', 'dnd', 'offline'].includes(b.presence)) throw bad();
    set('presence', b.presence);
  }
  if (b.avatar !== undefined) {
    if (b.avatar && !/^\/uploads\/[a-f0-9]{24}\.(png|jpe?g|gif|webp)$/i.test(b.avatar)) throw bad('تصویر نامعتبر است');
    set('avatar', b.avatar || null);
  }
  if (b.new_password) {
    if (!(await bcrypt.compare(String(b.current_password || ''), req.user.password_hash))) throw bad('گذرواژه فعلی اشتباه است');
    if (String(b.new_password).length < 6) throw bad('گذرواژه جدید باید حداقل ۶ نویسه باشد');
    set('password_hash', await bcrypt.hash(String(b.new_password), 10));
  }
  if (!sets.length) return res.json({ user: meView(req.user) });
  vals.push(req.user.id);
  const r = await q(`UPDATE users SET ${sets.join(',')} WHERE id=$${vals.length} RETURNING *`, vals);
  bus.broadcastUser(req.user.id);
  res.json({ user: meView(r.rows[0]) });
}));

module.exports = { router, meRouter, auth, verifyToken };
