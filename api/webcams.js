// Vercel-Funktion: /api/webcams?lat=…&lon=…&r=…
import { windyWebcams, CACHE_HEADER } from '../server/webcams.js';

export default async function handler(req, res) {
  const params = new URL(req.url, 'http://localhost').searchParams;
  let out;
  try {
    out = await windyWebcams(params, process.env.WINDY_WEBCAMS_KEY);
  } catch (e) {
    out = { status: 502, body: { error: e.message } };
  }
  if (out.status === 200) res.setHeader('Cache-Control', CACHE_HEADER);
  res.status(out.status).json(out.body);
}
