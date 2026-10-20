import { useNavigate } from 'react-router-dom';
import { FileText, Mic, Upload } from 'lucide-react';
import { dayBucket, fmtDuration, fmtTime, meetingTime, type MeetingSummary } from '../api';
import { useApp } from '../store';
import { AvatarStack, cx } from './ui';
import { folderColor } from './Sidebar';

export function MeetingRow({ m }: { m: MeetingSummary }) {
  const nav = useNavigate();
  const { live, folders } = useApp();
  const recording = live?.meetingId === m.id;
  const folder = folders.find((f) => f.id === m.folder_id);
  const names = m.attendees.filter((a) => !a.self).map((a) => a.name || a.email || '');
  return (
    <button
      onClick={() => nav(`/nota/${m.id}`)}
      className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-soft"
    >
      <span className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-hairline', recording ? 'bg-accent-wash text-accent-ink' : 'bg-raised text-ink-4')}>
        {recording ? <Mic size={15} className="pulse-dot" /> : m.source === 'import' ? <Upload size={14} /> : <FileText size={15} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className={cx('truncate text-[14px]', m.title ? 'text-ink' : 'text-ink-4')}>{m.title || 'Sin título'}</span>
          {folder && (
            <span className="inline-flex items-center gap-1 text-[11.5px] text-ink-4">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: folderColor(folder.color) }} />{folder.name}
            </span>
          )}
        </span>
        {m.summary ? <span className="mt-0.5 block truncate text-[12.5px] text-ink-3">{m.summary}</span> : m.status === 'importing' ? <span className="mt-0.5 block text-[12.5px] text-ink-4">Transcribiendo…</span> : null}
      </span>
      <AvatarStack names={names} />
      <span className="w-[86px] shrink-0 text-right text-[12px] tabular-nums text-ink-4">
        {fmtTime(meetingTime(m))}
        {m.duration_ms > 30000 && <span className="block text-[11px]">{fmtDuration(m.duration_ms)}</span>}
      </span>
    </button>
  );
}

export function MeetingList({ meetings, empty }: { meetings: MeetingSummary[]; empty?: React.ReactNode }) {
  if (!meetings.length) return <>{empty}</>;
  const groups: { label: string; items: MeetingSummary[] }[] = [];
  for (const m of meetings) {
    const label = dayBucket(meetingTime(m));
    const g = groups[groups.length - 1];
    if (g && g.label === label) g.items.push(m);
    else groups.push({ label, items: [m] });
  }
  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <div key={g.label}>
          <div className="mb-1 px-3 text-[12px] font-medium text-ink-4">{g.label}</div>
          <div className="flex flex-col">
            {g.items.map((m) => <MeetingRow key={m.id} m={m} />)}
          </div>
        </div>
      ))}
    </div>
  );
}
