import http from 'node:http';
import { URL } from 'node:url';
import { readFile } from 'node:fs/promises';

const config = {
  mode: process.env.TRADING_MODE || 'paper',
  maxLeverageCheck: 20,
  minQuoteVolumeUSDT: Number(process.env.MIN_QUOTE_VOL || 5_000_000),
  maxSpreadBps: Number(process.env.MAX_SPREAD_BPS || 5),
  minDepthNotionalUSDT: Number(process.env.MIN_DEPTH_NOTIONAL || 50_000)
};

const state = {
  killSwitch: false,
  tradeLogs: [],
  riskLogs: []
};

const GATE_API = 'https://api.gateio.ws/api/v4';

export function calcSpreadBps(bestBid, bestAsk) {
  if (!bestBid || !bestAsk || bestBid <= 0 || bestAsk <= 0) return Infinity;
  const mid = (bestBid + bestAsk) / 2;
  return ((bestAsk - bestBid) / mid) * 10_000;
}

export function canOpenWith1UMargin(contractMeta, lastPrice, leverage = 20) {
  const orderSizeMin = Number(contractMeta.order_size_min || 0);
  const quantoMultiplier = Number(contractMeta.quanto_multiplier || contractMeta.quanto_multiplier_float || 0);
  if (!orderSizeMin || !quantoMultiplier || !lastPrice || leverage <= 0) {
    return { canOpen: false, reason: 'missing_contract_specs' };
  }
  const minNotional = orderSizeMin * quantoMultiplier * lastPrice;
  const notionalWith1U = 1 * leverage;
  return {
    canOpen: notionalWith1U >= minNotional,
    minNotional,
    notionalWith1U,
    leverageChecked: leverage
  };
}

export function pickRiskLevel({ spreadBps, quoteVolume, depthNotional, fundingRate, canOpenWith1U20x }) {
  if (!canOpenWith1U20x || spreadBps > 10 || depthNotional < config.minDepthNotionalUSDT / 2) return 'red';
  if (Math.abs(fundingRate) > 0.001 || spreadBps > config.maxSpreadBps || quoteVolume < config.minQuoteVolumeUSDT) return 'yellow';
  return 'green';
}

async function gateGet(path) {
  const resp = await fetch(`${GATE_API}${path}`);
  if (!resp.ok) {
    throw new Error(`gate_api_error ${resp.status} ${path}`);
  }
  return resp.json();
}

async function fetchGateMarketRows() {
  const [contracts, tickers, orderBooks] = await Promise.all([
    gateGet('/futures/usdt/contracts'),
    gateGet('/futures/usdt/tickers'),
    gateGet('/futures/usdt/order_book?contract=BTC_USDT&limit=20') // warmup/health check endpoint behavior
      .then(() => null)
      .catch(() => null)
  ]);

  const tickerMap = new Map(tickers.map(t => [t.contract, t]));

  const usdtContracts = contracts.filter(c => !String(c.name || '').includes('_TEST'));
  const selectedContracts = usdtContracts.slice(0, 60); // protect response time

  const bookData = await Promise.all(
    selectedContracts.map(async c => {
      try {
        const ob = await gateGet(`/futures/usdt/order_book?contract=${encodeURIComponent(c.name)}&limit=20`);
        return [c.name, ob];
      } catch {
        return [c.name, null];
      }
    })
  );
  const bookMap = new Map(bookData);

  const rows = selectedContracts
    .map(c => {
      const t = tickerMap.get(c.name);
      if (!t) return null;

      const lastPrice = Number(t.last);
      const quoteVolume = Number(t.volume_24h_quote || t.volume_24h || 0);
      const fundingRate = Number(t.funding_rate || 0);
      const maxLeverage = Number(c.leverage_max || 0);
      const orderSizeMin = Number(c.order_size_min || 0);
      const quantoMultiplier = Number(c.quanto_multiplier || c.quanto_multiplier_float || 0);

      const ob = bookMap.get(c.name);
      const bestAsk = Number(ob?.asks?.[0]?.p || ob?.asks?.[0]?.[0] || 0);
      const bestBid = Number(ob?.bids?.[0]?.p || ob?.bids?.[0]?.[0] || 0);
      const spreadBps = calcSpreadBps(bestBid, bestAsk);

      const bidDepth = (ob?.bids || []).reduce((sum, b) => sum + Number(b.s || b[1] || 0), 0);
      const askDepth = (ob?.asks || []).reduce((sum, a) => sum + Number(a.s || a[1] || 0), 0);
      const depthNotional = (bidDepth + askDepth) * lastPrice * quantoMultiplier;

      const openCheck = canOpenWith1UMargin(c, lastPrice, config.maxLeverageCheck);
      const riskLevel = pickRiskLevel({
        spreadBps,
        quoteVolume,
        depthNotional,
        fundingRate,
        canOpenWith1U20x: openCheck.canOpen
      });

      const inPool =
        quoteVolume >= config.minQuoteVolumeUSDT &&
        spreadBps <= config.maxSpreadBps &&
        depthNotional >= config.minDepthNotionalUSDT &&
        openCheck.canOpen;

      return {
        symbol: c.name,
        price: lastPrice,
        volume24hQuote: quoteVolume,
        fundingRate,
        orderSizeMin,
        contractMultiplier: quantoMultiplier,
        maxLeverage,
        bestBid,
        bestAsk,
        spreadBps: Number(spreadBps.toFixed(2)),
        depthNotionalUSDT: Number(depthNotional.toFixed(2)),
        openWith1U20x: openCheck.canOpen,
        minNotional: Number((openCheck.minNotional || 0).toFixed(4)),
        notionalWith1U20x: openCheck.notionalWith1U || 20,
        riskLevel,
        recommendPool: inPool
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.volume24hQuote - a.volume24hQuote)
    .filter(r => r.recommendPool);

  return rows;
}

async function runScan() {
  const rows = await fetchGateMarketRows();
  return {
    mode: config.mode,
    killSwitch: state.killSwitch,
    rows,
    ts: new Date().toISOString(),
    source: 'gate_public_api',
    liveTradingEnabled: false
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/scan') {
    try {
      const scan = await runScan();
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ...scan, tradeLogs: state.tradeLogs, riskLogs: state.riskLogs }));
    } catch (err) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'scan_failed', detail: String(err.message || err) }));
    }
    return;
  }

  if (url.pathname === '/api/kill-switch' && req.method === 'POST') {
    state.killSwitch = !state.killSwitch;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ killSwitch: state.killSwitch }));
    return;
  }

  const file = url.pathname === '/' ? '/index.html' : url.pathname;
  if (['/index.html', '/app.js', '/style.css'].includes(file)) {
    try {
      const data = await readFile(new URL(`../public${file}`, import.meta.url));
      if (file.endsWith('.js')) res.setHeader('content-type', 'text/javascript');
      if (file.endsWith('.css')) res.setHeader('content-type', 'text/css');
      res.end(data);
    } catch {
      res.statusCode = 404;
      res.end('Not found');
    }
    return;
  }

  res.statusCode = 404;
  res.end('Not found');
});

if (import.meta.url === `file://${process.argv[1]}`) {
  server.listen(3000, () => console.log('server on http://localhost:3000'));
}

