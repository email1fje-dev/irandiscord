'use strict';
// Ensures the built-in root admin account exists on every boot: username "Nava" (stored lowercase), admin + blue tick.
// Password: ADMIN_PASSWORD env var if set (re-applied on boot), otherwise a random one printed ONCE in the logs at creation.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { one, q } = require('./db');
const { ROOT_USERNAME, ROOT_DISPLAY } = require('./config');

async function seedRoot() {
  let pw = process.env.ADMIN_PASSWORD || '';
  if (pw && pw.length < 6) { console.warn('[admin] ADMIN_PASSWORD is shorter than 6 characters and was ignored.'); pw = ''; }
  const ex = await one('SELECT id, password_hash FROM users WHERE username=$1', [ROOT_USERNAME]);
  if (!ex) {
    const generated = !pw;
    if (generated) pw = crypto.randomBytes(9).toString('base64url');
    await q(`INSERT INTO users(username,display_name,password_hash,is_admin,verified) VALUES($1,$2,$3,TRUE,TRUE)`,
      [ROOT_USERNAME, ROOT_DISPLAY, await bcrypt.hash(pw, 10)]);
    console.log('====================================================');
    console.log(`[admin] Created admin account  username: ${ROOT_USERNAME}`);
    if (generated) console.log(`[admin] Generated password (shown once, change it in Settings or set ADMIN_PASSWORD): ${pw}`);
    else console.log('[admin] Password taken from ADMIN_PASSWORD.');
    console.log('====================================================');
    return;
  }
  await q('UPDATE users SET is_admin=TRUE, verified=TRUE, banned=FALSE WHERE id=$1', [ex.id]);
  if (pw && !(await bcrypt.compare(pw, ex.password_hash))) {
    await q('UPDATE users SET password_hash=$1, token_version=token_version+1 WHERE id=$2', [await bcrypt.hash(pw, 10), ex.id]);
    console.log('[admin] Password of the admin account was updated from ADMIN_PASSWORD.');
  }
}
module.exports = { seedRoot };
