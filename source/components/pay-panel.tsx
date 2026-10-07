'use client';
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {duration, formatDuration} from '@/lib/time';
import {formatUsdt, payCents} from '@/lib/pay';

type Any=Record<string,any>;

export function owedCents(sessions: Any[], people: Any[]) {
  return people.reduce((sum, person) => sum + payCents(duration(sessions.filter(s => s.person_id === person.id)), person.hourly_rate || 0), 0);
}

export function PayTotal({sessions, people, onOpen}: {sessions: Any[]; people: Any[]; onOpen: () => void}) {
  const active = people.filter(p => p.active !== 0);
  const cents = owedCents(sessions, active);
  return <p className="pay-hint">К выплате по этому экрану: <strong>{formatUsdt(cents)}</strong>. События на проверке не входят. <button type="button" onClick={onOpen}>Открыть оплату</button></p>;
}

export function PayPanel({data, act, busy, period, setPeriod, date, setDate, moveDate, admin}: {
  data: Any;
  act: (path: string, body: Any, success?: string) => Promise<any>;
  busy: boolean;
  period: string;
  setPeriod: (period: string) => void;
  date: string;
  setDate: (date: string) => void;
  moveDate: (direction: number) => void;
  admin: boolean;
}) {
  const [edit, setEdit] = useState<Any|null>(null);
  const [error, setError] = useState('');
  const people = (data.people || []).filter((p: Any) => p.active);
  const sessions = data.sessions || [];
  const payouts = data.payouts || [];
  return <section className="pay-panel">
    <div className="heading"><div><div className="eyebrow">USDT TRC-20</div><h1>Оплата</h1><p className="muted">Сумма = учтённые часы × ставка. Кабинет только готовит выплату. USDT уходит после подтверждения в Trust Wallet, ключ здесь не хранится.</p></div></div>
    <div className="report-toolbar"><div className="report-controls"><div className="segmented">{[['day','День'],['week','Неделя'],['month','Месяц'],['year','Год']].map(([value, label]) => <button key={value} aria-pressed={period === value} onClick={() => setPeriod(value)}>{label}</button>)}</div><div className="date-control"><Button variant="ghost" size="icon" aria-label="Предыдущий период" onClick={() => moveDate(-1)}>‹</Button><Input aria-label="Дата периода" type="date" value={date} onChange={event => setDate(event.target.value)}/><Button variant="ghost" size="icon" aria-label="Следующий период" onClick={() => moveDate(1)}>›</Button></div></div></div>
    {people.map((person: Any) => {
      const payout = payouts.find((item: Any) => item.person_id === person.id);
      const liveMs = duration(sessions.filter((s: Any) => s.person_id === person.id));
      const rate = payout ? payout.hourly_rate : (person.hourly_rate || 0);
      const ms = payout ? payout.milliseconds : liveMs;
      const amount = payout ? payout.amount : payCents(liveMs, person.hourly_rate || 0);
      const status = payout?.status === 'paid' ? 'Оплачено' : payout?.status === 'awaiting' ? 'Ждёт подписи в Trust Wallet' : 'Начислено';
      return <article className="pay-row" key={person.id}>
        <div><strong>{person.name}</strong><small>{formatDuration(ms)} · {rate ? formatUsdt(rate) + '/ч' : 'ставка не задана'}</small>{person.wallet_trc20 && <small className="wallet">{person.wallet_trc20}</small>}</div>
        <div className="pay-amount"><strong>{formatUsdt(amount)}</strong><span className={payout?.status === 'paid' ? 'good' : 'warn'}>{status}</span>{payout?.tx_hash && <small className="wallet">{payout.tx_hash}</small>}</div>
        {admin && <div className="card-actions">
          <Button variant="outline" onClick={() => {setError(''); setEdit(person);}}>Ставка и адрес</Button>
          {!payout && <Button disabled={busy || amount <= 0} onClick={() => act('pay/prepare', {personId: person.id, period, date}, 'Выплата подготовлена. Подтвердите её в Trust Wallet')}>Подготовить</Button>}
          {payout?.status === 'awaiting' && <form className="pay-confirm" onSubmit={async event => {event.preventDefault(); const tx = new FormData(event.currentTarget).get('tx'); const saved = await act('pay/confirm', {id: payout.id, txHash: tx}, 'Выплата отмечена оплаченной'); if (saved) event.currentTarget.reset();}}><Input name="tx" placeholder="Хеш транзакции" required minLength={64} maxLength={64}/><Button disabled={busy}>Оплачено</Button></form>}
        </div>}
      </article>;
    })}
    <Dialog open={!!edit} onOpenChange={open => !open && setEdit(null)}><DialogContent className="dialog-surface"><DialogTitle>Ставка и кошелёк</DialogTitle><DialogDescription>USDT TRC-20. Отправка из кабинета не выполняется.</DialogDescription>{edit && <form className="form-stack" onSubmit={async event => {event.preventDefault(); const form = new FormData(event.currentTarget); const dollars = Number(form.get('rate')); if (!Number.isFinite(dollars) || dollars < 0 || dollars > 1000) {setError('Ставка от 0 до 1000 USDT в час'); return;} const saved = await act('pay/rate', {id: edit.id, hourlyRate: Math.round(dollars * 100), wallet: String(form.get('wallet') || '')}, 'Ставка сохранена'); if (saved) setEdit(null); else setError('Не сохранилось. Проверьте адрес: T и 34 символа.');}}><label>USDT в час<Input name="rate" inputMode="decimal" defaultValue={((edit.hourly_rate || 0) / 100).toFixed(2)} required/></label><label>Адрес TRC-20<Input name="wallet" defaultValue={edit.wallet_trc20 || ''} placeholder="T…"/></label>{error && <p className="error" role="alert">{error}</p>}<Button disabled={busy}>Сохранить</Button></form>}</DialogContent></Dialog>
  </section>;
}
