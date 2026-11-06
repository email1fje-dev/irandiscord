'use strict';
// Central configuration. Rename the product in ONE place: APP_NAME below.
const crypto = require('crypto');
const path = require('path');

const APP_NAME = 'نوا';
const APP_TAGLINE = 'گپ، صدا و تصویر؛ همه‌جا با هم';

let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  JWT_SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('[warn] JWT_SECRET is not set. Using a random one: all sessions will be reset on every restart.');
}

// Permission bitfield (shared with the client through /api/config)
const P = {
  MANAGE_SERVER: 1 << 0, MANAGE_CHANNELS: 1 << 1, MANAGE_ROLES: 1 << 2, KICK: 1 << 3, BAN: 1 << 4,
  SEND_MESSAGES: 1 << 5, ATTACH_FILES: 1 << 6, CONNECT_VOICE: 1 << 7, MENTION_EVERYONE: 1 << 8,
  MANAGE_MESSAGES: 1 << 9, TIMEOUT: 1 << 10,
};
const ALL_PERMS = Object.values(P).reduce((a, b) => a | b, 0);
const DEFAULT_PERMS = P.SEND_MESSAGES | P.ATTACH_FILES | P.CONNECT_VOICE;

// Built-in root admin account (created/ensured on every boot, see seed.js)
const ROOT_USERNAME = 'nava';
const ROOT_DISPLAY = 'Nava';

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || './uploads');

function iceServers() {
  const s = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
  if (process.env.TURN_URL) {
    s.push({ urls: process.env.TURN_URL.split(',').map(x => x.trim()), username: process.env.TURN_USERNAME || '', credential: process.env.TURN_CREDENTIAL || '' });
  }
  return s;
}

module.exports = { APP_NAME, APP_TAGLINE, JWT_SECRET, P, ALL_PERMS, DEFAULT_PERMS, ROOT_USERNAME, ROOT_DISPLAY, UPLOAD_DIR, iceServers };
