'use strict';
// File upload + message history / search / pins (sending, editing, reactions happen over Socket.IO).
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const { UPLOAD_DIR } = require('../config');
const { wrap, int, channelCtx } = require('../util');
const msgs = require('../msgs');

const router = express.Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, f, cb) => cb(null, UPLOAD_DIR),
    filename: (req, f, cb) => {
      const ext = path.extname(f.originalname || '').toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10);
      cb(null, crypto.randomBytes(12).toString('hex') + ext);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
});

router.post('/upload', upload.single('file'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'فایلی دریافت نشد' });
  // multer decodes names as latin1; restore UTF-8 so Persian file names survive
  const name = Buffer.from(req.file.originalname, 'latin1').toString('utf8').slice(0, 120);
  res.json({ url: '/uploads/' + req.file.filename, name, size: req.file.size, mime: req.file.mimetype || 'application/octet-stream' });
}));

router.get('/channels/:id/messages', wrap(async (req, res) => {
  await channelCtx(int(req.params.id), req.user.id);
  const before = req.query.before ? int(req.query.before) : null;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
  const q = req.query.q ? String(req.query.q).trim().slice(0, 100) : null;
  res.json({ messages: await msgs.history(int(req.params.id), { before, limit, q }) });
}));

router.get('/channels/:id/pins', wrap(async (req, res) => {
  await channelCtx(int(req.params.id), req.user.id);
  res.json({ messages: await msgs.history(int(req.params.id), { limit: 100, pinned: true }) });
}));

module.exports = { router };
