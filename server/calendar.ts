// Calendar: Google/Outlook "secret iCal" URLs and, optionally, the macOS Calendar (EventKit via helper).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
// @ts-ignore - no types shipped
import IcalExpander from 'ical-expander';
import { getSetting } from './db.ts';
import { HELPER_BIN } from './env.ts';
import { googleEvents, googleErrors } from './google.ts';

const execFileP = promisify(execFile);

export type CalEvent = {
  id: string;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  location: string;
  description: string;
  meetingUrl: string;
  attendees: { name: string; email: string; self?: boolean }[];
  calendar: string;
};

export type CalendarSource = { id: string; name: string; url: string; enabled: boolean };

const cache = new Map<string, { at: number; ics: string }>();
let macCache: { at: number; events: CalEvent[] } | null = null;
let lastErrors: Record<string, string> = {};

const MEETING_URL = /(https?:\/\/(?:[\w-]+\.)?(?:zoom\.us\/[jw]\/[^\s"<>]+|meet\.google\.com\/[a-z0-9-]+|teams\.microsoft\.com\/l\/meetup-join\/[^\s"<>]+|teams\.live\.com\/meet\/[^\s"<>]+|[\w.-]*webex\.com\/[^\s"<>]+|whereby\.com\/[^\s"<>]+|riverside\.(?:fm|com)\/[^\s"<>]+))/i;

function extractMeetingUrl(...texts: string[]) {
  for (const t of texts) {
    const m = (t || '').match(MEETING_URL);
    if (m) return m[1].replace(/[>)\].,]+$/, '');
  }
  return '';
}

async function fetchIcs(src: CalendarSource) {
  const c = cache.get(src.id);
  if (c && Date.now() - c.at < 5 * 60_000) return c.ics;
  const url = src.url.replace(/^webcal:/i, 'https:');
  const res = await fetch(url, { headers: { 'User-Agent': 'Acta/0.1' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ics = await res.text();
  if (!ics.includes('BEGIN:VCALENDAR')) throw new Error('La URL no devuelve un calendario iCal');
  cache.set(src.id, { at: Date.now(), ics });
  return ics;
}

function attendeesOf(ev: any) {
  const out: { name: string; email: string }[] = [];
  for (const p of ev.attendees || []) {
    const v = String(p.getFirstValue?.() || '');
    const email = v.replace(/^mailto:/i, '').toLowerCase();
    const name = String(p.getParameter?.('cn') || '').replace(/^"|"$/g, '');
    if (email || name) out.push({ name: name && name !== email ? name : email.split('@')[0], email });
  }
  return out;
}

export async function upcomingEvents(opts: { fromMs?: number; toMs?: number } = {}): Promise<CalEvent[]> {
  const from = new Date(opts.fromMs ?? Date.now() - 12 * 3600_000);
  const to = new Date(opts.toMs ?? Date.now() + 7 * 24 * 3600_000);
  const sources = getSetting<CalendarSource[]>('calendars', []).filter((s) => s.enabled && s.url);
  const selfEmails = new Set(getSetting<string[]>('selfEmails', []).map((e) => e.toLowerCase()));
  const events: CalEvent[] = [];
  lastErrors = {};
  await Promise.all(sources.map(async (src) => {
    try {
      const ics = await fetchIcs(src);
      const expander = new IcalExpander({ ics, maxIterations: 2000 });
      const r = expander.between(from, to);
      const push = (item: any, startDate: any, endDate: any) => {
        const start = startDate.toJSDate().getTime();
        const end = endDate.toJSDate().getTime();
        const attendees = attendeesOf(item).map((a) => ({ ...a, self: selfEmails.has(a.email) }));
        events.push({
          id: `${src.id}:${item.uid}:${start}`,
          title: item.summary || '(sin título)',
          start, end,
          allDay: !!startDate.isDate,
          location: item.location || '',
          description: (item.description || '').slice(0, 4000),
          meetingUrl: extractMeetingUrl(item.location || '', item.description || ''),
          attendees,
          calendar: src.name,
        });
      };
      for (const e of r.events) push(e, e.startDate, e.endDate);
      for (const o of r.occurrences) push(o.item, o.startDate, o.endDate);
    } catch (e: any) {
      lastErrors[src.id] = String(e?.message || e);
    }
  }));
  events.push(...(await googleEvents(from, to)));
  Object.assign(lastErrors, googleErrors());
  if (getSetting('macCalendarEnabled', false)) events.push(...(await macEvents(from, to)));
  const seen = new Set<string>();
  return events
    .filter((e) => !e.allDay && e.end >= from.getTime())
    .filter((e) => (seen.has(e.title + e.start) ? false : (seen.add(e.title + e.start), true)))
    .sort((a, b) => a.start - b.start);
}

async function macEvents(from: Date, to: Date): Promise<CalEvent[]> {
  if (!fs.existsSync(HELPER_BIN)) return [];
  if (macCache && Date.now() - macCache.at < 2 * 60_000) return macCache.events.filter((e) => e.start < to.getTime() && e.end > from.getTime());
  try {
    const { stdout } = await execFileP(HELPER_BIN, ['events', '--from', String(from.getTime()), '--to', String(to.getTime())], { timeout: 15000 });
    const raw = JSON.parse(stdout) as any[];
    const events = raw.map((e) => ({
      id: `mac:${e.id}:${e.start}`,
      title: e.title || '(sin título)',
      start: e.start, end: e.end, allDay: !!e.allDay,
      location: e.location || '', description: (e.notes || '').slice(0, 4000),
      meetingUrl: extractMeetingUrl(e.url || '', e.location || '', e.notes || ''),
      attendees: (e.attendees || []).map((a: any) => ({ name: a.name || (a.email || '').split('@')[0], email: (a.email || '').toLowerCase(), self: !!a.self })),
      calendar: e.calendar || 'Calendario del Mac',
    }));
    macCache = { at: Date.now(), events };
    return events;
  } catch (e: any) {
    lastErrors.mac = String(e?.message || e).slice(0, 300);
    return [];
  }
}

export const calendarErrors = () => lastErrors;
export function clearCalendarCache() {
  cache.clear();
  macCache = null;
}
