require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const { Pool } = require('pg');

const app  = express();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Railway and most cloud Postgres providers require SSL
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));

// 15 MB limit to accommodate base64-encoded images
app.use(express.json({ limit: '15mb' }));

// ── DB INIT ──────────────────────────────────────────────────

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS uploads (
      id          SERIAL PRIMARY KEY,
      name        VARCHAR(255)  NOT NULL,
      description TEXT          DEFAULT '',
      img         TEXT,
      img_type    VARCHAR(100),
      created_at  TIMESTAMPTZ   DEFAULT NOW()
    )
  `);
  console.log('Database ready');
}

// ── ROUTES ───────────────────────────────────────────────────

app.get('/health', (_, res) => res.json({ ok: true, time: new Date() }));

// Create upload
app.post('/api/upload', async (req, res) => {
  const { name, description, img_base64, img_type } = req.body ?? {};

  if (!name?.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO uploads (name, description, img, img_type)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, description, img_type, created_at`,
      [name.trim(), description?.trim() ?? '', img_base64 ?? null, img_type ?? null]
    );
    res.status(201).json({ ok: true, upload: rows[0] });
  } catch (err) {
    console.error('POST /api/upload', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

// List recent uploads (no image data — keeps response small)
app.get('/api/uploads', async (_, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, description, img_type, created_at
       FROM uploads
       ORDER BY created_at DESC
       LIMIT 20`
    );
    res.json(rows);
  } catch (err) {
    console.error('GET /api/uploads', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

// Serve image binary for a specific upload
app.get('/api/upload/:id/image', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).end();

  try {
    const { rows } = await pool.query(
      'SELECT img, img_type FROM uploads WHERE id = $1',
      [id]
    );
    if (!rows.length || !rows[0].img) return res.status(404).end();

    const buf = Buffer.from(rows[0].img, 'base64');
    res.set('Content-Type', rows[0].img_type ?? 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(buf);
  } catch (err) {
    console.error('GET /api/upload/:id/image', err.message);
    res.status(500).end();
  }
});

// ── START ────────────────────────────────────────────────────

const PORT = process.env.PORT ?? 3000;
initDB()
  .then(() => app.listen(PORT, () => console.log(`Dezba backend on port ${PORT}`)))
  .catch(err => { console.error('Startup failed:', err); process.exit(1); });
