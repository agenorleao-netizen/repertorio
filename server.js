#!/usr/bin/env node
/*
 * Repertório — servidor local, sem dependências.
 * Serve o app (pasta /public), lê as cifras (.txt) da pasta /cifras
 * e guarda os repertórios (setlists) em /data/setlists.json.
 *
 * Uso:  node server.js         (porta padrão 8080)
 *       PORT=3000 node server.js
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const CIFRAS_DIR = path.join(ROOT, 'cifras');
const DATA_DIR = path.join(ROOT, 'data');
const SETLISTS_FILE = path.join(DATA_DIR, 'setlists.json');
const PORT = parseInt(process.env.PORT, 10) || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, Object.assign({ 'Cache-Control': 'no-cache' }, headers));
  res.end(body);
}

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': MIME['.json'] });
}

// Deriva "Artista" e "Título" do nome do arquivo.
// Aceita "Artista - Título.txt" ou apenas "Título.txt".
function parseName(fileName) {
  const base = fileName.replace(/\.txt$/i, '');
  const sep = base.indexOf(' - ');
  if (sep > -1) {
    return { artist: base.slice(0, sep).trim(), title: base.slice(sep + 3).trim() };
  }
  return { artist: '', title: base.trim() };
}

function listSongs() {
  let files = [];
  try {
    files = fs.readdirSync(CIFRAS_DIR).filter((f) => /\.txt$/i.test(f) && !f.startsWith('.'));
  } catch (_) {
    return [];
  }
  return files
    .map((f) => {
      const meta = parseName(f);
      return { id: f, file: f, artist: meta.artist, title: meta.title };
    })
    .sort((a, b) =>
      (a.artist + a.title).localeCompare(b.artist + b.title, 'pt-BR', { sensitivity: 'base' })
    );
}

// Impede path traversal: só permite arquivos .txt diretos dentro de /cifras.
function safeSongPath(id) {
  const name = path.basename(id);
  if (!/\.txt$/i.test(name)) return null;
  return path.join(CIFRAS_DIR, name);
}

function readSetlists() {
  try {
    return JSON.parse(fs.readFileSync(SETLISTS_FILE, 'utf8'));
  } catch (_) {
    return [];
  }
}

function writeSetlists(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SETLISTS_FILE, JSON.stringify(data, null, 2));
}

function serveStatic(res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, 'Forbidden');
  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, 'Não encontrado');
    const ext = path.extname(filePath).toLowerCase();
    send(res, 200, data, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  });
}

function readBody(req, cb) {
  const chunks = [];
  let size = 0;
  req.on('data', (c) => {
    size += c.length;
    if (size > 5 * 1024 * 1024) req.destroy(); // 5MB de guarda
    chunks.push(c);
  });
  req.on('end', () => cb(Buffer.concat(chunks).toString('utf8')));
}

const server = http.createServer((req, res) => {
  const url = req.url || '/';

  // ---- API ----
  if (url === '/api/songs' && req.method === 'GET') {
    return sendJson(res, 200, listSongs());
  }

  if (url.startsWith('/api/song/') && req.method === 'GET') {
    let id;
    try { id = decodeURIComponent(url.slice('/api/song/'.length).split('?')[0]); }
    catch (_) { return sendJson(res, 400, { error: 'id inválido' }); }
    const p = safeSongPath(id);
    if (!p) return sendJson(res, 400, { error: 'id inválido' });
    return fs.readFile(p, 'utf8', (err, content) => {
      if (err) return sendJson(res, 404, { error: 'cifra não encontrada' });
      const meta = parseName(path.basename(p));
      sendJson(res, 200, { id: path.basename(p), title: meta.title, artist: meta.artist, content });
    });
  }

  if (url === '/api/setlists' && req.method === 'GET') {
    return sendJson(res, 200, readSetlists());
  }

  if (url === '/api/setlists' && req.method === 'PUT') {
    return readBody(req, (body) => {
      try {
        const data = JSON.parse(body);
        if (!Array.isArray(data)) throw new Error('esperava um array');
        writeSetlists(data);
        sendJson(res, 200, { ok: true });
      } catch (e) {
        sendJson(res, 400, { error: String(e.message || e) });
      }
    });
  }

  if (url.startsWith('/api/')) {
    return sendJson(res, 404, { error: 'rota não encontrada' });
  }

  // ---- Estáticos ----
  return serveStatic(res, url);
});

function localIps() {
  const ips = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const net of ifaces[name] || []) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }
  return ips;
}

server.listen(PORT, '0.0.0.0', () => {
  fs.mkdirSync(CIFRAS_DIR, { recursive: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const ips = localIps();
  console.log('\n  🎸  Repertório rodando!\n');
  console.log('  No notebook:   http://localhost:' + PORT);
  ips.forEach((ip) => console.log('  No iPad:       http://' + ip + ':' + PORT + '   (mesma rede Wi-Fi)'));
  console.log('\n  Cifras em:     ' + CIFRAS_DIR);
  console.log('  Ctrl+C para parar.\n');
});
