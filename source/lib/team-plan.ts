import {payCents} from './pay';
import {clipSessions, duration, localDate, periodBounds, type Session} from './time';

export function dayStatus(humanMs: number, normMs: number, absent: boolean) {
  if (absent) return 'off';
  if (normMs <= 0) return 'none';
  if (humanMs < normMs) return 'under';
  if (humanMs <= normMs + 60 * 60 * 1000) return 'ok';
  return 'over';
}

export function costFor(projectId: string, sessions: {person_id: string; project_id: string; start: number; end: number}[], rates: Record<string, number>) {
  return sessions.filter(session => session.project_id === projectId).reduce((sum, session) => sum + payCents(Math.max(0, session.end - session.start), rates[session.person_id] || 0), 0);
}

export function isWorkUrl(value: string) {
  if (value.length > 500) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export function personDays(people: {id: string; timezone?: string; daily_minutes?: number}[], sessions: Session[], absences: {person_id: string; day: string}[], now: number) {
  return people.map(person => {
    const tz = person.timezone || 'America/New_York';
    const date = localDate(now, tz);
    const day = periodBounds('day', date, tz);
    const human = duration(clipSessions(sessions.filter(session => session.person_id === person.id), day.from, day.to));
    const absent = absences.some(row => row.person_id === person.id && row.day === date);
    const norm = Math.max(0, person.daily_minutes || 0) * 60 * 1000;
    return {person_id: person.id, timezone: tz, date, ms: human, norm_ms: norm, absent, status: dayStatus(human, norm, absent)};
  });
}
