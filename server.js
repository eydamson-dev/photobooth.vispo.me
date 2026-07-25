const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DOMAIN = process.env.PUBLIC_DOMAIN || `http://localhost:${PORT}`;
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const ASSETS_DIR = path.join(__dirname, 'public', 'assets');

// Ensure required directories exist on boot
function ensureDirs() {
  [UPLOAD_DIR, DATA_DIR, ASSETS_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
}
ensureDirs();

// Multer disk storage with unique filenames
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`;
    cb(null, unique);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB per file
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image uploads are allowed'));
    }
  }
});

// Middleware
app.use(express.json());
app.use(express.static(PUBLIC_DIR));
app.use('/uploads', express.static(UPLOAD_DIR));

// Helpers
function isValidFilename(filename) {
  return typeof filename === 'string' && /^[a-zA-Z0-9._-]+$/.test(filename);
}

function safeFilePath(filename) {
  if (!isValidFilename(filename)) return null;
  const resolved = path.resolve(UPLOAD_DIR, filename);
  // Prevent path traversal outside upload directory
  if (!resolved.startsWith(path.resolve(UPLOAD_DIR) + path.sep)) return null;
  return resolved;
}

function publicViewUrl(filename) {
  return `${PUBLIC_DOMAIN}/v/${filename}`;
}

// Settings persistence
const DEFAULT_SETTINGS = {
  orgName: 'Church of Jesus Christ the Risen Son of God',
  orgShortName: 'CJCRSG',
  logoUrl: ''
};

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      return { ...DEFAULT_SETTINGS, ...data };
    }
  } catch (err) {
    console.error('Settings load error:', err);
  }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(settings) {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error('Settings save error:', err);
  }
}

const appSettings = loadSettings();

// Logo upload
const logoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, ASSETS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    const unique = `logo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    cb(null, unique);
  }
});

const logoUpload = multer({
  storage: logoStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image uploads are allowed for logos'));
    }
  }
}).single('logo');

// Routes

// OBS single-photo upload
app.post('/api/upload', upload.single('photo'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No photo received' });
  }

  const filename = req.file.filename;
  const url = publicViewUrl(filename);

  res.status(201).json({ success: true, filename, url });
});

// Web multi-photo upload
app.post('/api/upload/batch', upload.array('photos', 100), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ success: false, error: 'No photos received' });
  }

  const files = req.files.map((file) => {
    const filename = file.filename;
    return {
      filename,
      url: `${PUBLIC_DOMAIN}/uploads/${filename}`,
      viewUrl: publicViewUrl(filename)
    };
  });

  res.status(201).json({ success: true, count: files.length, files });
});

// Gallery / API
app.get('/api/photos', (req, res) => {
  ensureDirs();

  fs.readdir(UPLOAD_DIR, (err, files) => {
    if (err) {
      return res.status(500).json({ error: 'Unable to read photos' });
    }

    const imageExt = /\.(png|jpe?g|webp|gif)$/i;
    const photos = files
      .filter((f) => imageExt.test(f))
      .map((filename) => {
        const stat = fs.statSync(path.join(UPLOAD_DIR, filename));
        return {
          filename,
          url: `/uploads/${filename}`,
          viewUrl: `/v/${filename}`,
          qrUrl: `/api/qr?url=${encodeURIComponent(publicViewUrl(filename))}`,
          timestamp: stat.mtime.getTime()
        };
      })
      .sort((a, b) => b.timestamp - a.timestamp);

    res.json(photos);
  });
});

// Single photo delete
app.delete('/api/photos/:filename', (req, res) => {
  const { filename } = req.params;
  const filePath = safeFilePath(filename);

  if (!filePath) {
    return res.status(400).json({ success: false, error: 'Invalid filename' });
  }
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, error: 'Photo not found' });
  }

  try {
    fs.unlinkSync(filePath);
    res.json({ success: true, deleted: filename });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ success: false, error: 'Unable to delete photo' });
  }
});

// Bulk photo delete
app.post('/api/photos/delete', (req, res) => {
  const filenames = req.body && Array.isArray(req.body.filenames) ? req.body.filenames : [];
  if (filenames.length === 0) {
    return res.status(400).json({ success: false, error: 'No filenames provided' });
  }

  const result = { deleted: [], missing: [], errors: [] };
  filenames.forEach((filename) => {
    const filePath = safeFilePath(filename);
    if (!filePath) {
      result.errors.push({ filename, error: 'Invalid filename' });
      return;
    }
    if (!fs.existsSync(filePath)) {
      result.missing.push(filename);
      return;
    }
    try {
      fs.unlinkSync(filePath);
      result.deleted.push(filename);
    } catch (err) {
      result.errors.push({ filename, error: err.message });
    }
  });

  res.json({ success: true, ...result });
});

// Settings API
app.get('/api/settings', (req, res) => {
  res.json(loadSettings());
});

app.post('/api/settings', (req, res) => {
  logoUpload(req, res, (err) => {
    if (err) {
      return res.status(400).json({ success: false, error: err.message });
    }

    const settings = loadSettings();
    const newOrgName = req.body && req.body.orgName ? String(req.body.orgName).trim() : '';
    const newOrgShortName = req.body && req.body.orgShortName ? String(req.body.orgShortName).trim() : '';
    if (newOrgName) settings.orgName = newOrgName;
    if (newOrgShortName) settings.orgShortName = newOrgShortName;

    if (req.file) {
      // Remove previous logo file to avoid piling up old assets
      if (settings.logoUrl) {
        const oldPath = safeAssetPath(settings.logoUrl);
        if (oldPath && fs.existsSync(oldPath)) {
          try { fs.unlinkSync(oldPath); } catch (e) { console.error('Old logo delete error:', e); }
        }
      }
      settings.logoUrl = `/assets/${req.file.filename}`;
    }

    saveSettings(settings);
    res.json({ success: true, settings });
  });
});

function safeAssetPath(assetUrl) {
  if (typeof assetUrl !== 'string' || !assetUrl.startsWith('/assets/')) return null;
  const filename = path.basename(assetUrl);
  if (!/^[a-zA-Z0-9._-]+$/.test(filename)) return null;
  const resolved = path.resolve(ASSETS_DIR, filename);
  if (!resolved.startsWith(path.resolve(ASSETS_DIR) + path.sep)) return null;
  return resolved;
}

// QR code generator (offline, returns SVG)
app.get('/api/qr', async (req, res) => {
  const target = req.query.url;
  if (!target || typeof target !== 'string') {
    return res.status(400).type('text/plain').send('Missing url query parameter');
  }

  try {
    const svg = await QRCode.toString(target, {
      type: 'svg',
      margin: 1,
      width: 320,
      color: { dark: '#000000', light: '#ffffff' }
    });
    res.set('Content-Type', 'image/svg+xml');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(svg);
  } catch (err) {
    console.error('QR generation error:', err);
    res.status(500).type('text/plain').send('QR generation failed');
  }
});

// Per-photo mobile view
app.get('/v/:filename', (req, res) => {
  const { filename } = req.params;
  const filePath = safeFilePath(filename);

  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).send(renderNotFound());
  }

  res.send(renderPhotoView(filename));
});

// Web pages
function serveGallery(req, res) {
  res.sendFile(path.join(PUBLIC_DIR, 'gallery.html'));
}

app.get('/', serveGallery);
app.get('/gallery', serveGallery);
app.get('/upload', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'upload.html'));
});
app.get('/settings', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'settings.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ success: false, error: err.message });
  }
  if (err.message === 'Only image uploads are allowed') {
    return res.status(400).json({ success: false, error: err.message });
  }
  res.status(500).json({ success: false, error: 'Server error' });
});

// View templates
function renderPhotoView(filename) {
  const imageUrl = `/uploads/${filename}`;
  const viewUrl = publicViewUrl(filename);
  const qrUrl = `/api/qr?url=${encodeURIComponent(viewUrl)}`;
  const settings = loadSettings();
  const logoBlock = settings.logoUrl
    ? `<img src="${settings.logoUrl}" alt="${escapeHtml(settings.orgName)}" style="width:48px;height:48px;object-fit:contain;border-radius:12px;background:#fff;">`
    : `<div style="width:48px;height:48px;border-radius:12px;background:#3b82f6;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;">${escapeHtml(settings.orgShortName || 'P')}</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>${escapeHtml(settings.orgShortName)} Snapshot</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: #0f172a;
      color: #f8fafc;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 16px;
    }
    .card {
      width: 100%;
      max-width: 520px;
      background: #1e293b;
      border-radius: 20px;
      overflow: hidden;
      box-shadow: 0 20px 40px rgba(0,0,0,0.35);
      text-align: center;
    }
    .card img.photo {
      width: 100%;
      height: auto;
      display: block;
      background: #334155;
    }
    .qr-wrap {
      background: #fff;
      border-radius: 14px;
      padding: 12px;
      margin: 0 auto 20px;
      width: fit-content;
      max-width: 90%;
    }
    .qr-wrap img {
      width: 180px;
      height: 180px;
      display: block;
    }
    .card-body { padding: 24px; }
    .brand {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      margin-bottom: 18px;
    }
    .brand-text { text-align: left; }
    .brand-text .org { font-size: 14px; font-weight: 700; color: #f8fafc; }
    .brand-text .sub { font-size: 12px; color: #94a3b8; }
    h1 { margin: 0 0 8px; font-size: 22px; }
    p { margin: 0 0 20px; color: #94a3b8; font-size: 14px; }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      width: 100%;
      padding: 16px;
      border: none;
      border-radius: 12px;
      font-size: 16px;
      font-weight: 600;
      color: #fff;
      background: #3b82f6;
      text-decoration: none;
      cursor: pointer;
      transition: transform .15s ease, background .15s ease;
    }
    .btn:hover { background: #2563eb; transform: translateY(-1px); }
    .btn svg { width: 20px; height: 20px; }
    .footer {
      margin-top: 18px;
      font-size: 12px;
      color: #64748b;
    }
  </style>
</head>
<body>
  <div class="card">
    <img class="photo" src="${imageUrl}" alt="Snapshot" loading="eager">
    <div class="card-body">
      <div class="brand">
        ${logoBlock}
        <div class="brand-text">
          <div class="org">${escapeHtml(settings.orgName)}</div>
          <div class="sub">${escapeHtml(settings.orgShortName)} Snapshot</div>
        </div>
      </div>
      <h1>Your Snapshot</h1>
      <p>Scan the QR code to open this photo on your device, or tap below to save it.</p>
      <div class="qr-wrap">
        <img src="${qrUrl}" alt="QR code">
      </div>
      <a class="btn" href="${imageUrl}" download="${filename}">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        Download Photo
      </a>
      <div class="footer">Powered by Photobooth</div>
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderNotFound() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Photo Not Found</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: #0f172a;
      color: #f8fafc;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      text-align: center;
      padding: 16px;
    }
    .box { max-width: 420px; }
    h1 { font-size: 26px; margin: 0 0 12px; }
    p { color: #94a3b8; margin: 0 0 24px; line-height: 1.5; }
    a {
      display: inline-block;
      padding: 12px 20px;
      border-radius: 10px;
      background: #3b82f6;
      color: #fff;
      text-decoration: none;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="box">
    <h1>Photo expired or not found</h1>
    <p>This snapshot may have been removed or the link is incorrect. Check the gallery for the latest photos.</p>
    <a href="/">View Gallery</a>
  </div>
</body>
</html>`;
}

app.listen(PORT, () => {
  console.log(`Photobooth server running on http://localhost:${PORT}`);
  console.log(`Public domain: ${PUBLIC_DOMAIN}`);
});
