const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'sombra-admin-2026';

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : null;

async function initDb() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS registrations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      wants_event BOOLEAN NOT NULL DEFAULT false,
      source TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function requireAdmin(req, res, next) {
  const token = req.query.token || req.get('x-admin-token');
  if (token !== ADMIN_TOKEN) return res.status(401).send('No autorizado. Agrega ?token=TU_TOKEN a la URL.');
  next();
}

app.use(express.json());
app.use(express.static(__dirname));

app.post('/api/register', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'database not configured' });
  const { name, email, wantsEvent } = req.body || {};
  if (!name || !email) return res.status(400).json({ error: 'name and email required' });
  try {
    await pool.query(
      'INSERT INTO registrations (name, email, wants_event, source) VALUES ($1, $2, $3, $4)',
      [String(name).slice(0, 200), String(email).slice(0, 200), !!wantsEvent, req.get('referer') || null]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('register failed', err.message);
    res.status(500).json({ error: 'internal error' });
  }
});

app.get('/admin', requireAdmin, async (req, res) => {
  if (!pool) return res.status(503).send('Base de datos no configurada todavía.');
  const { rows } = await pool.query(
    'SELECT id, name, email, wants_event, created_at FROM registrations ORDER BY created_at DESC'
  );
  const token = encodeURIComponent(req.query.token);
  const rowsHtml = rows
    .map(
      (r) =>
        `<tr><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.email)}</td><td>${r.wants_event ? 'Sí' : 'No'}</td><td>${new Date(r.created_at).toLocaleString('es-CL')}</td><td><a class="del" href="/admin/delete/${r.id}?token=${token}" onclick="return confirm('¿Borrar este registro?')">Borrar</a></td></tr>`
    )
    .join('');
  res.send(`<!doctype html><html><head><meta charset="utf-8"><title>Registros — Escuadrón Sombra</title>
  <style>
    body{font-family:-apple-system,sans-serif;background:#221a12;color:#f0e4d2;padding:32px;}
    table{border-collapse:collapse;width:100%;max-width:840px;}
    th,td{border-bottom:1px solid #40331f;padding:8px 12px;text-align:left;font-size:14px;}
    th{color:#dfa159;}
    a.button{display:inline-block;margin-bottom:16px;background:#b3743a;color:#fbf6ec;padding:8px 16px;border-radius:999px;text-decoration:none;font-weight:600;}
    a.del{color:#c4b298;font-size:13px;}
    a.del:hover{color:#dfa159;}
  </style></head><body>
  <h1>Registros de preventa (${rows.length})</h1>
  <a class="button" href="/admin/export.csv?token=${token}">Descargar CSV</a>
  <table><thead><tr><th>Nombre</th><th>Correo</th><th>Evento octubre</th><th>Fecha</th><th></th></tr></thead><tbody>${rowsHtml}</tbody></table>
  </body></html>`);
});

app.get('/admin/delete/:id', requireAdmin, async (req, res) => {
  if (!pool) return res.status(503).send('Base de datos no configurada todavía.');
  await pool.query('DELETE FROM registrations WHERE id = $1', [req.params.id]);
  res.redirect('/admin?token=' + encodeURIComponent(req.query.token));
});

app.get('/admin/export.csv', requireAdmin, async (req, res) => {
  if (!pool) return res.status(503).send('Base de datos no configurada todavía.');
  const { rows } = await pool.query(
    'SELECT name, email, wants_event, source, created_at FROM registrations ORDER BY created_at DESC'
  );
  const header = 'nombre,correo,evento_octubre,origen,fecha\n';
  const csv = rows
    .map((r) =>
      [r.name, r.email, r.wants_event, r.source || '', new Date(r.created_at).toISOString()]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(',')
    )
    .join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="registros-escuadron-sombra.csv"');
  res.send(header + csv);
});

app.listen(PORT, async () => {
  try {
    await initDb();
    console.log('DB ready');
  } catch (e) {
    console.error('DB init failed:', e.message);
  }
  console.log('Server listening on', PORT);
});
