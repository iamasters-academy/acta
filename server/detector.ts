// Meeting detection: the native helper reports mic usage and meeting apps/windows;
// the calendar watcher reports events that are about to start.
import fs from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { HELPER_BIN } from './env.ts';
import { getSetting } from './db.ts';
import { bus, activeSession, stopRecording } from './recorder.ts';
import { upcomingEvents } from './calendar.ts';

export type DetectorState = {
  running: boolean;
  micInUse: boolean;
  meetings: { app: string; bundleId: string; title: string }[];
  lastUpdate: number;
  permissions: Record<string, any>;
};

export const detectorState: DetectorState = { running: false, micInUse: false, meetings: [], lastUpdate: 0, permissions: {} };
let child: ChildProcess | null = null;
const notified = new Map<string, number>();
let meetingGoneSince = 0;

function notifyOnce(key: string, cooldownMs: number, event: any) {
  const last = notified.get(key) || 0;
  if (Date.now() - last < cooldownMs) return;
  notified.set(key, Date.now());
  bus.emit('event', event);
}

export function startDetector() {
  if (child || process.platform !== 'darwin' || !fs.existsSync(HELPER_BIN)) return;
  child = spawn(HELPER_BIN, ['detect', '--interval', '2'], { stdio: ['ignore', 'pipe', 'pipe'] });
  detectorState.running = true;
  let buf = '';
  child.stdout!.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      try { onReading(JSON.parse(line)); } catch { /* ignore */ }
    }
  });
  child.stderr!.on('data', (d) => console.warn('[detector]', String(d).trim()));
  child.on('exit', () => {
    child = null;
    detectorState.running = false;
    setTimeout(startDetector, 10_000);
  });
}

function onReading(r: { micInUse: boolean; meetings: DetectorState['meetings']; permissions?: any }) {
  detectorState.micInUse = r.micInUse;
  detectorState.meetings = r.meetings || [];
  detectorState.lastUpdate = Date.now();
  if (r.permissions) detectorState.permissions = r.permissions;
  bus.emit('event', { type: 'detector', micInUse: r.micInUse, meetings: detectorState.meetings });

  const session = activeSession();
  if (!session) {
    meetingGoneSince = 0;
    if (!getSetting('autoDetect', true)) return;
    const m = detectorState.meetings[0];
    if (m && r.micInUse) {
      notifyOnce(`app:${m.bundleId}:${m.title}`, 20 * 60_000, { type: 'meeting.detected', app: m.app, title: m.title, bundleId: m.bundleId });
    }
    return;
  }
  // Auto-stop when the call window disappears for a while.
  if (!getSetting('autoStopOnMeetingEnd', true)) return;
  if (session.helperInfo.detectedApp && !detectorState.meetings.length) {
    if (!meetingGoneSince) meetingGoneSince = Date.now();
    if (Date.now() - meetingGoneSince > 60_000) {
      bus.emit('event', { type: 'recording.autostop', meetingId: session.meetingId, reason: 'La llamada ha terminado' });
      void stopRecording('meeting-ended');
      meetingGoneSince = 0;
    }
  } else {
    meetingGoneSince = 0;
    if (detectorState.meetings.length) session.helperInfo.detectedApp = detectorState.meetings[0].app;
  }
}

export function startCalendarWatcher() {
  const tick = async () => {
    const minutes = getSetting('calendarNotifyMinutes', 1);
    if (minutes < 0) return;
    try {
      const events = await upcomingEvents({ fromMs: Date.now() - 10 * 60_000, toMs: Date.now() + (minutes + 1) * 60_000 });
      for (const ev of events) {
        const delta = ev.start - Date.now();
        if (delta <= minutes * 60_000 && delta > -5 * 60_000 && !activeSession()) {
          notifyOnce(`cal:${ev.id}`, 24 * 3600_000, { type: 'calendar.starting', event: ev });
        }
      }
    } catch { /* calendar errors surface in the UI */ }
  };
  setInterval(tick, 30_000);
  setTimeout(tick, 3000);
}

export function stopDetector() {
  child?.kill();
}
