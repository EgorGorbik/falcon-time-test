import {test} from 'node:test';
import assert from 'node:assert/strict';
import {payCents, isTrc20, isTronTx, formatUsdt} from '../lib/pay.ts';

test('Hourly USDT rounds half up and ignores nothing under half a cent', () => {
  assert.equal(payCents(3_600_000, 1000), 1000);
  assert.equal(payCents(5_400_000, 1000), 1500);
  assert.equal(payCents(1_800_000, 1), 1);
  assert.equal(payCents(1_799_999, 1), 0);
  assert.equal(formatUsdt(1500), '15.00 USDT');
});

test('TRC-20 address and TRON tx hash are checked by shape only', () => {
  const wallet = 'T123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  assert.equal(wallet.length, 34);
  assert.equal(isTrc20(wallet), true);
  assert.equal(isTrc20('0x'+'a'.repeat(40)), false);
  assert.equal(isTronTx('a'.repeat(64)), true);
  assert.equal(isTronTx('zz'+'a'.repeat(62)), false);
});
