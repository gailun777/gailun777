import test from 'node:test';
import assert from 'node:assert/strict';

test('effective fee with 80% rebate', ()=>{
  const raw = 0.001;
  const rebateRate = 0.8;
  const effective = raw * (1 - rebateRate);
  assert.ok(Math.abs(effective - 0.0002) < 1e-12);
});

test('net profit rejects non-positive', ()=>{
  const priceEdge = 0.001;
  const effectiveFee = 0.0008;
  const slippage = 0.0002;
  const spread = 0.0002;
  const funding = 0.0001;
  const net = priceEdge - effectiveFee - slippage - spread - funding;
  assert.ok(net <= 0);
});
