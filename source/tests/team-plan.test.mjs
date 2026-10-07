import {test} from 'node:test';
import assert from 'node:assert/strict';
import {costFor, dayStatus, isWorkUrl, personDays} from '../lib/team-plan.ts';

test('Day status uses the plan, then an hour of slack, and absence wins', () => {
  assert.equal(dayStatus(5 * 3600000, 6 * 3600000, false), 'under');
  assert.equal(dayStatus(6 * 3600000, 6 * 3600000, false), 'ok');
  assert.equal(dayStatus(7 * 3600000, 6 * 3600000, false), 'ok');
  assert.equal(dayStatus(7 * 3600000 + 1, 6 * 3600000, false), 'over');
  assert.equal(dayStatus(0, 6 * 3600000, true), 'off');
  assert.equal(dayStatus(0, 0, false), 'none');
});

test('Project cost is rate times paid time and a work link is only http(s)', () => {
  assert.equal(costFor('homekept', [{person_id:'zafar', project_id:'homekept', start:0, end:3_600_000}], {zafar:2500}), 2500);
  assert.equal(costFor('other', [{person_id:'zafar', project_id:'homekept', start:0, end:3_600_000}], {zafar:2500}), 0);
  assert.equal(isWorkUrl('https://github.com/example/falcon/pull/1'), true);
  assert.equal(isWorkUrl('http://10.0.0.1/commit'), true);
  assert.equal(isWorkUrl('javascript:alert(1)'), false);
});

test('Today follows each person timezone, not the report timezone', () => {
  const now = Date.parse('2026-10-07T03:00:00Z');
  const days = personDays([
    {id:'ny', timezone:'America/New_York', daily_minutes:360},
    {id:'minsk', timezone:'Europe/Minsk', daily_minutes:360},
  ], [], [{person_id:'minsk', day:'2026-10-07'}], now);
  assert.equal(days.find(day => day.person_id === 'ny').date, '2026-10-06');
  assert.equal(days.find(day => day.person_id === 'minsk').date, '2026-10-07');
  assert.equal(days.find(day => day.person_id === 'minsk').status, 'off');
  assert.equal(days.find(day => day.person_id === 'ny').status, 'under');
});
