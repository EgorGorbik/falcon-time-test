'use client';

import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {formatDuration} from '@/lib/time';
import {costFor} from '@/lib/team-plan';
import {formatUsdt} from '@/lib/pay';

const labels: Record<string, string> = {
  off: 'Сегодня не работает',
  under: 'Недобор',
  ok: 'Норма',
  over: 'Переработка',
  none: 'Норма не задана',
};

export function TeamDay({person, day, links, act, busy, canPlan, canNote}: {
  person: {id: string; daily_minutes?: number};
  day?: {timezone: string; date: string; ms: number; norm_ms: number; absent: boolean; status: string};
  links: {id: string; person_id: string; day: string; url: string; note: string}[];
  act: (path: string, body?: Record<string, unknown>) => Promise<unknown>;
  busy: boolean;
  canPlan: boolean;
  canNote: boolean;
}) {
  const [url, setUrl] = useState('');
  const [hours, setHours] = useState(String((person.daily_minutes ?? 360) / 60));
  if (!day) return null;
  const mine = links.filter(link => link.person_id === person.id && link.day === day.date);
  return <div className={'team-day ' + day.status}>
    <strong>{labels[day.status] || day.status}</strong>
    <span>Сегодня {day.date} · {day.timezone}</span>
    <span>{formatDuration(day.ms)}{day.norm_ms ? ` · план ${formatDuration(day.norm_ms)}` : ''}</span>
    {canPlan && <form className="team-day-form" onSubmit={async event => {event.preventDefault(); const minutes = Math.round(Number(hours) * 60); if (await act('plan', {id: person.id, dailyMinutes: minutes})) setHours(String(minutes / 60));}}>
      <Input aria-label="Норма дня, часы" value={hours} onChange={event => setHours(event.target.value)} type="number" min="0" max="24" step="0.5"/>
      <Button type="submit" variant="outline" disabled={busy}>Норма, ч</Button>
    </form>}
    {canNote && <Button type="button" variant="ghost" disabled={busy} onClick={() => act('absence', {personId: person.id, day: day.date, off: !day.absent})}>{day.absent ? 'Снять «не работает»' : 'Сегодня не работает'}</Button>}
    {!!mine.length && <ul className="work-links">{mine.map(link => <li key={link.id}><a href={link.url} target="_blank" rel="noreferrer">{link.note || link.url}</a>{canNote && <button type="button" onClick={() => act('work-link', {remove: true, id: link.id})}>убрать</button>}</li>)}</ul>}
    {canNote && <form className="team-day-form" onSubmit={async event => {event.preventDefault(); if (await act('work-link', {personId: person.id, day: day.date, url})) setUrl('');}}>
      <Input aria-label="Ссылка на результат" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://… PR, коммит, задача" maxLength={500}/>
      <Button type="submit" variant="outline" disabled={busy || !url}>Ссылка</Button>
    </form>}
  </div>;
}

export function ProjectSpend({project, sessions, people}: {
  project: {id: string; budget_cents?: number};
  sessions: {person_id: string; project_id: string; start: number; end: number}[];
  people: {id: string; hourly_rate?: number}[];
}) {
  const spent = costFor(project.id, sessions, Object.fromEntries(people.map(person => [person.id, Number(person.hourly_rate) || 0])));
  const limit = project.budget_cents || 0;
  return <span className={'project-cost' + (limit && spent > limit ? ' over' : '')}>{formatUsdt(spent)}{limit ? ` · лимит ${formatUsdt(limit)} · ${spent > limit ? 'перерасход' : 'в лимите'}` : ''}</span>;
}
