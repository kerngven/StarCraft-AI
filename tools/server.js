#!/usr/bin/env node
/**
 * server.js — P0.2 / P0.6
 *
 * Local static HTTP server for the StarCraft-AI fork.
 * Serves the game from the repo root so it runs fully self-contained
 * (assets are downloaded locally by tools/download-assets.js).
 *
 * Usage:  node tools/server.js [port]     (default port 8080)
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = parseInt(process.argv[2], 10) || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.ico':  'image/x-icon',
  '.wav':  'audio/wav',
  '.mp3':  'audio/mpeg',
  '.svg':  'image/svg+xml',
  '.txt':  'text/plain; charset=utf-8',
  '.manifest': 'text/cache-manifest'
};

// Code and HTML should always reflect the current checkout. Immutable media is
// addressed by a stable path and can safely be retained by the browser after a
// skin has loaded, making later game launches substantially faster.
const CACHEABLE_ASSETS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.wav', '.mp3', '.svg'
]);

const server = http.createServer((req, res) => {
  // Decode the URL path (handles the "(2)Switchback.jpg" style filenames).
  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split('?')[0]);
  } catch (e) {
    urlPath = req.url.split('?')[0];
  }
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.normalize(path.join(ROOT, urlPath));
  // Prevent path traversal outside ROOT.
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found: ' + urlPath);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const cacheControl = CACHEABLE_ASSETS.has(ext)
      ? 'public, max-age=2592000, immutable'
      : 'no-cache';
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': cacheControl
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`StarCraft-AI local server: http://localhost:${PORT}/`);
  console.log(`Serving from: ${ROOT}`);
});
