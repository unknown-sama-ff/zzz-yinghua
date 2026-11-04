import { Router } from 'express';
import { createRateLimiter, requestKey } from '../lib/rateLimit.js';
import { createParallaxService, ParallaxError } from './service.js';

export function createPuzzleLayersRouter(options) {
  const router = Router();
  const service = createParallaxService(options);
  const limit = createRateLimiter({ max: 4, windowMs: 60000, keyFn: requestKey });
  router.post('/', limit, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { return res.json({ ok: true, ...await service.prepare(req.body?.galleryId) }); }
    catch (error) {
      if (error instanceof ParallaxError) return res.status(error.status).json({ ok: false, message: error.message });
      console.warn('[puzzle-layers]', error.message);
      return res.status(503).json({ ok: false, message: '这张图片暂时无法分层，可继续查看原图，或稍后重试' });
    }
  });
  router.get('/:key/:layer', async (req, res) => {
    const file = await service.asset(req.params.key, req.params.layer);
    if (!file) return res.status(404).set('Cache-Control', 'no-store').end();
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    return res.sendFile(file, (error) => { if (error && !res.headersSent) res.status(404).set('Cache-Control', 'no-store').end(); });
  });
  return router;
}
