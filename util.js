'use strict';
const { one, all } = require('./db');
const { ALL_PERMS } = require('./config');
const bus = require('./bus');

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (m = 'درخواست نامعتبر است') => new HttpError(400, m);
const forbidden = (m = 'دسترسی لازم را ندارید') => new HttpError(403, m);
const notFound = (m = 'پیدا نشد') => new HttpError(404, m);
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const int = v => { const n = parseInt(v, 10); if (!Number.isInteger(n)) throw bad(); return n; };

// Columns safe to expose publicly (never password_hash)
const USER_COLS = 'u.id, u.username, u.display_name, u.avatar, u.status_text, u.presence, u.verified';
const pub = u => u && ({
  id: u.id, username: u.username, display_name: u.display_name, avatar: u.avatar,
  status_text: u.status_text || '', presence: bus.effPresence(u), verified: !!u.verified,
});

// Membership + effective permissions of a user inside a server (null = not a member)
async function memberInfo(serverId, userId) {
  const s = await one('SELECT owner_id FROM servers WHERE id=$1', [serverId]);
  if (!s) return null;
  const m = await one('SELECT timeout_until FROM members WHERE server_id=$1 AND user_id=$2', [serverId, userId]);
  if (!m) return null;
  const rows = await all(
    `SELECT permissions, position FROM roles WHERE server_id=$1
     AND (is_default OR id IN (SELECT role_id FROM member_roles WHERE user_id=$2))`, [serverId, userId]);
  let perms = 0, top = 0;
  for (const r of rows) { perms |= r.permissions; top = Math.max(top, r.position); }
  const owner = s.owner_id === userId;
  return {
    owner, perms: owner ? ALL_PERMS : perms, top: owner ? Infinity : top,
    timeout: !!(m.timeout_until && new Date(m.timeout_until) > new Date()),
  };
}
// Require membership (+ optional permission bit)
async function need(serverId, userId, bit) {
  const info = await memberInfo(serverId, userId);
  if (!info) throw forbidden('شما عضو این سرور نیستید');
  if (bit && !(info.perms & bit)) throw forbidden('مجوز لازم برای این کار را ندارید');
  return info;
}
// Actor may moderate target only if the actor outranks the target (owner always can, nobody can touch the owner)
async function needOutrank(serverId, actorId, targetId, bit) {
  const actor = await need(serverId, actorId, bit);
  const target = await memberInfo(serverId, targetId);
  if (!target) throw notFound('کاربر عضو این سرور نیست');
  if (target.owner) throw forbidden('مالک سرور قابل مدیریت نیست');
  if (!actor.owner && actor.top <= target.top) throw forbidden('نقش شما از نقش این کاربر بالاتر نیست');
  return { actor, target };
}
// Resolve a channel the user may access (server channel or DM)
async function channelCtx(channelId, userId) {
  const ch = await one('SELECT * FROM channels WHERE id=$1', [channelId]);
  if (!ch) throw notFound('کانال پیدا نشد');
  if (ch.server_id) {
    const info = await memberInfo(ch.server_id, userId);
    if (!info) throw forbidden('شما عضو این سرور نیستید');
    return { ch, info };
  }
  const m = await one('SELECT 1 FROM dm_members WHERE channel_id=$1 AND user_id=$2', [channelId, userId]);
  if (!m) throw forbidden();
  return { ch, info: null };
}
async function roomsFor(ch) {
  if (ch.server_id) return ['server:' + ch.server_id];
  return (await all('SELECT user_id FROM dm_members WHERE channel_id=$1', [ch.id])).map(r => 'user:' + r.user_id);
}
async function isBlocked(a, b) {
  return !!(await one('SELECT 1 FROM blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)', [a, b]));
}
const markRead = (uid, cid, lastId) => require('./db').q(
  `INSERT INTO reads(user_id,channel_id,last_id) VALUES($1,$2,$3)
   ON CONFLICT (user_id,channel_id) DO UPDATE SET last_id=GREATEST(reads.last_id,EXCLUDED.last_id)`, [uid, cid, lastId]);

module.exports = { HttpError, bad, forbidden, notFound, wrap, int, USER_COLS, pub, memberInfo, need, needOutrank, channelCtx, roomsFor, isBlocked, markRead };
