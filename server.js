const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DOMAIN = process.env.PUBLIC_DOMAIN || `http://localhost:${PORT}`;
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Ensure upload directory exists on boot
function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}
ensureUploadDir();

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
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
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

// Routes
app.post('/api/upload', upload.single('photo'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No photo received' });
  }

  const filename = req.file.filename;
  const url = `${PUBLIC_DOMAIN}/v/${filename}`;

  res.status(201).json({ success: true, filename, url });
});

app.get('/api/photos', (req, res) => {
  ensureUploadDir();

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
          timestamp: stat.mtime.getTime()
        };
      })
      .sort((a, b) => b.timestamp - a.timestamp);

    res.json(photos);
  });
});

app.get('/v/:filename', (req, res) => {
  const { filename } = req.params;
  const filePath = safeFilePath(filename);

  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).send(renderNotFound());
  }

  res.send(renderPhotoView(filename));
});

function serveGallery(req, res) {
  res.sendFile(path.join(PUBLIC_DIR, 'gallery.html'));
}

app.get('/', serveGallery);
app.get('/gallery', serveGallery);

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
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Photo Snapshot</title>
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
    .card img {
      width: 100%;
      height: auto;
      display: block;
      background: #334155;
    }
    .card-body {
      padding: 24px;
    }
    h1 { margin: 0 0 8px; font-size: 22px; }
    p { margin: 0 0 24px; color: #94a3b8; font-size: 14px; }
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
    <img src="${imageUrl}" alt="Snapshot" loading="eager">
    <div class="card-body">
      <h1>Your Snapshot</h1>
      <p>Tap below to save this photo to your camera roll.</p>
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
