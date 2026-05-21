import test from 'node:test';
import assert from 'node:assert/strict';
import { calcSpreadBps, canOpenWith1UMargin } from '../server/index.js';

test('calc spread bps', ()=>{
  const bps = calcSpreadBps(100, 100.1);
  assert.ok(bps > 9.9 && bps < 10.1);
});

test('1U margin * 20x can open when min notional low enough', ()=>{
  const contract = { order_size_min: 1, quanto_multiplier: 0.001 };
  const out = canOpenWith1UMargin(contract, 10000, 20);
  assert.equal(out.canOpen, true);
  assert.equal(out.minNotional, 10);
});

test('1U margin * 20x cannot open when min notional too high', ()=>{
  const contract = { order_size_min: 10, quanto_multiplier: 0.01 };
  const out = canOpenWith1UMargin(contract, 1000, 20);
  assert.equal(out.canOpen, false);
});
