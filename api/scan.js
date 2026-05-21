import { runScan } from '../lib/gateScanner.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  try {
    const data = await runScan();
    res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=30');
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: 'scan_failed', detail: String(err.message || err) });
  }
}
