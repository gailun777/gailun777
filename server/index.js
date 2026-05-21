import http from 'node:http';
import { URL } from 'node:url';

const config = {
  mode: process.env.TRADING_MODE || 'paper',
  rebateRate: 0.8,
  makerFee: 0.0002,
  takerFee: 0.0005,
  slippageBps: 2,
  spreadBps: 1.5,
  maxLeverage: 20,
  riskThreshold: 55
};

const symbols = ['BTC_USDT','ETH_USDT','SOL_USDT','BNB_USDT','XRP_USDT','DOGE_USDT'];
const state = {
  killSwitch: false,
  equity: 10,
  marginUsed: 0,
  consecutiveLosses: 0,
  pnlToday: 0,
  positions: [],
  tradeLogs: [],
  riskLogs: []
};

function r(min, max){ return Math.random()*(max-min)+min; }
function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

function scanSymbol(symbol){
  const price = Number(r(symbol.includes('BTC')?60000: symbol.includes('ETH')?2500:0.08, symbol.includes('BTC')?70000: symbol.includes('ETH')?3200:300).toFixed(4));
  const volumeScore = r(40,95);
  const depthScore = r(35,95);
  const spreadBps = r(0.5,8);
  const slippageBps = r(0.5,10);
  const fundingRate = r(-0.0006,0.0008);

  const trend15m = pick(['up','down','sideways']);
  const structure5m = pick(['breakout','pullback','support_resistance','weak']);
  const entry1m = pick(['long','short','wait']);

  const fakeSignal = spreadBps > 6 || slippageBps > 8 || structure5m === 'weak';

  const strategy = trend15m === 'sideways' ? 'maker_hft' : (structure5m === 'breakout' ? 'trend_breakout' : 'pullback_rebound');

  const direction = trend15m === 'up' ? 'long' : trend15m === 'down' ? 'short' : (entry1m === 'wait' ? 'wait' : entry1m);
  const rawFee = config.takerFee * 2;
  const effectiveFee = rawFee * (1 - config.rebateRate);
  const edge = r(-0.001,0.004);
  const spreadCost = spreadBps / 10000;
  const slipCost = slippageBps / 10000;
  const fundingCost = Math.max(0, fundingRate);
  const net = edge - effectiveFee - spreadCost - slipCost - fundingCost;

  const margin = Math.max(1, Number((state.equity * 0.1).toFixed(2)));
  const leverages = [1,2,3,5,10,20].map(l => ({ leverage:l, canOpen: margin*l >= 5 }));
  const minNotional = 5;
  const firstAllowed = leverages.find(x=>x.canOpen)?.leverage ?? null;

  const riskLevel = net <= 0 || fakeSignal ? 'red' : (net < 0.0008 ? 'yellow' : 'green');
  const pool = volumeScore > 60 && depthScore > 60 && spreadBps < 4 && slippageBps < 5 && !fakeSignal && net > 0;

  return {
    symbol,price,minNotional,neededLeverage:firstAllowed,leverages,
    trend15m,structure5m,entry1m,strategy,fakeSignal,
    netExpected:Number(net.toFixed(6)),riskLevel,
    recommendPool:pool,
    costs:{rawFee,effectiveFee,spreadCost,slipCost,fundingCost},
    reason: pool ? 'liquid + net positive' : 'risk/cost filter blocked'
  };
}

function runScan(){
  const rows = symbols.map(scanSymbol);
  return {
    mode: config.mode,
    killSwitch: state.killSwitch,
    equity: state.equity,
    marginUsed: state.marginUsed,
    pnlToday: state.pnlToday,
    consecutiveLosses: state.consecutiveLosses,
    rebateRate: config.rebateRate,
    rows,
    ts: new Date().toISOString()
  };
}

function maybeAutoTrade(scan){
  if (config.mode !== 'paper' || state.killSwitch) return;
  for (const row of scan.rows) {
    if (row.riskLevel !== 'green' || !row.recommendPool) continue;
    if (state.consecutiveLosses >= 3 || state.pnlToday <= -0.3) break;
    const side = row.trend15m === 'down' ? 'short' : 'long';
    const margin = Math.max(1, Number((state.equity * 0.1).toFixed(2)));
    const leverage = Math.min(row.neededLeverage || 1, config.maxLeverage);
    const pnl = Number(r(-0.08, 0.12).toFixed(3));
    state.pnlToday += pnl;
    state.equity = Number((state.equity + pnl).toFixed(3));
    state.consecutiveLosses = pnl < 0 ? state.consecutiveLosses + 1 : 0;
    state.tradeLogs.unshift({ ts: new Date().toISOString(), symbol: row.symbol, side, leverage, margin, pnl, strategy: row.strategy });
    if (state.tradeLogs.length > 200) state.tradeLogs.pop();
    state.riskLogs.unshift({ ts: new Date().toISOString(), symbol: row.symbol, status: 'green_auto_executed', netExpected: row.netExpected });
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/api/scan') {
    const scan = runScan();
    maybeAutoTrade(scan);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ...scan, tradeLogs: state.tradeLogs.slice(0,50), riskLogs: state.riskLogs.slice(0,50), positions: state.positions }));
    return;
  }
  if (url.pathname === '/api/kill-switch' && req.method === 'POST') {
    state.killSwitch = !state.killSwitch;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ killSwitch: state.killSwitch }));
    return;
  }
  const file = url.pathname === '/' ? '/index.html' : url.pathname;
  if (file === '/index.html' || file === '/app.js' || file === '/style.css') {
    import('node:fs').then(fs => {
      fs.readFile(new URL(`../public${file}`, import.meta.url), (err, data) => {
        if (err) { res.statusCode = 404; res.end('Not found'); return; }
        if (file.endsWith('.js')) res.setHeader('content-type','text/javascript');
        if (file.endsWith('.css')) res.setHeader('content-type','text/css');
        res.end(data);
      });
    });
    return;
  }
  res.statusCode = 404;
  res.end('Not found');
});

server.listen(3000, () => console.log('server on http://localhost:3000'));
