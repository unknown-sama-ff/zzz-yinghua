import express from 'express';

const app = express();
const PORT = Number(process.env.PORT || 8080);

app.get('/', (_req, res) => res.send('<h1>Yinghua Workshop OK</h1>'));
app.get('/api/health', (_req, res) => res.json({ ok: true, port: PORT }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[test] listening on 0.0.0.0:${PORT}`);
});
