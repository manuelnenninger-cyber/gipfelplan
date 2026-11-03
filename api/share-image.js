// Vercel-Funktion: Vorschaubild einer geteilten Tour (/api/share-image?id=<id>)
import { handleShareImage } from '../server/share.js';

export const config = { maxDuration: 20 };

export default async function handler(req, res) {
  const id = new URL(req.url, 'http://localhost').searchParams.get('id') || '';
  await handleShareImage(req, res, id);
}
