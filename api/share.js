// Vercel-Funktion: Linkseite einer geteilten Tour (/t/<id> → /api/share?id=<id>)
import { handleSharePage } from '../server/share.js';

export default async function handler(req, res) {
  const id = new URL(req.url, 'http://localhost').searchParams.get('id') || '';
  await handleSharePage(req, res, id);
}
