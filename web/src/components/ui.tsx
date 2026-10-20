import { useEffect, useRef, useState, type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { initials } from '../api';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'accent' | 'soft' | 'ghost' | 'outline' | 'danger'; size?: 'sm' | 'md' };
export function Button({ variant = 'soft', size = 'md', className, ...p }: BtnProps) {
  return (
    <button
      {...p}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-45 disabled:pointer-events-none whitespace-nowrap select-none',
        size === 'sm' ? 'h-7 px-2.5 text-[12.5px]' : 'h-8 px-3 text-[13px]',
        variant === 'primary' && 'bg-primary text-primary-ink hover:opacity-90',
        variant === 'accent' && 'bg-accent text-on-accent hover:bg-accent-hover',
        variant === 'soft' && 'bg-soft text-ink hover:bg-soft-hover',
        variant === 'ghost' && 'text-ink-3 hover:bg-soft hover:text-ink',
        variant === 'outline' && 'border border-hairline-strong text-ink hover:bg-soft',
        variant === 'danger' && 'text-danger hover:bg-soft',
        className,
      )}
    />
  );
}

export function IconButton({ className, title, ...p }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      title={title}
      aria-label={title}
      {...p}
      className={cx('inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-3 hover:bg-soft hover:text-ink transition-colors disabled:opacity-40', className)}
    />
  );
}

export function Chip({ children, onClick, className, active }: { children: ReactNode; onClick?: () => void; className?: string; active?: boolean }) {
  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag
      onClick={onClick}
      className={cx(
        'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] transition-colors',
        active ? 'border-accent-tint bg-accent-wash text-accent-ink' : 'border-hairline text-ink-3',
        onClick && 'hover:bg-soft hover:text-ink cursor-pointer',
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function Input({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...p}
      className={cx(
        'h-8 w-full rounded-lg border border-hairline-strong bg-raised px-2.5 text-[13px] text-ink placeholder:text-ink-4 outline-none focus:border-accent-ink focus:ring-2 focus:ring-accent-tint',
        className,
      )}
    />
  );
}

export function Textarea({ className, ...p }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...p}
      className={cx(
        'w-full rounded-lg border border-hairline-strong bg-raised px-2.5 py-2 text-[13px] leading-relaxed text-ink placeholder:text-ink-4 outline-none focus:border-accent-ink focus:ring-2 focus:ring-accent-tint',
        className,
      )}
    />
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx('relative h-5 w-9 shrink-0 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-hairline-strong')}
    >
      <span className={cx('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
    </button>
  );
}

export function Avatar({ name, size = 22, className }: { name: string; size?: number; className?: string }) {
  const hues = ['#e5eacd', '#eaf4fe', '#f3f0fa', '#fbe7d9', '#f6efd0', '#e2f1ea'];
  const h = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % hues.length;
  return (
    <span
      title={name}
      className={cx('inline-flex shrink-0 items-center justify-center rounded-full font-medium text-[#292929] ring-2 ring-canvas', className)}
      style={{ width: size, height: size, fontSize: size * 0.42, background: hues[h] }}
    >
      {initials(name)}
    </span>
  );
}

export function AvatarStack({ names, max = 3 }: { names: string[]; max?: number }) {
  if (!names.length) return null;
  return (
    <span className="flex items-center -space-x-1.5">
      {names.slice(0, max).map((n, i) => <Avatar key={i} name={n} size={20} />)}
      {names.length > max && <span className="ml-2 text-[11px] text-ink-4">+{names.length - max}</span>}
    </span>
  );
}

export function Modal({ open, onClose, title, children, width = 520 }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; width?: number }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 p-4 pt-[12vh] backdrop-blur-[1px]" onMouseDown={onClose}>
      <div
        className="fade-up w-full overflow-hidden rounded-2xl border border-hairline bg-elevated shadow-pop"
        style={{ maxWidth: width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="flex items-center justify-between border-b border-hairline px-5 py-3.5">
            <div className="text-[14px] font-semibold">{title}</div>
            <IconButton title="Cerrar" onClick={onClose}><X size={16} /></IconButton>
          </div>
        )}
        <div className="max-h-[70vh] overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export type MenuItem = { label: ReactNode; icon?: ReactNode; onClick: () => void; danger?: boolean; hint?: string } | 'sep';
export function Menu({ trigger, items, align = 'left', side = 'bottom', className }: { trigger: (open: () => void) => ReactNode; items: MenuItem[]; align?: 'left' | 'right'; side?: 'bottom' | 'top'; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', h);
    window.addEventListener('keydown', k);
    return () => { window.removeEventListener('mousedown', h); window.removeEventListener('keydown', k); };
  }, [open]);
  return (
    <div ref={ref} className={cx('relative', className)}>
      {trigger(() => setOpen((o) => !o))}
      {open && (
        <div className={cx('fade-up absolute z-40 max-h-[60vh] min-w-[200px] overflow-y-auto rounded-xl border border-hairline bg-elevated p-1 shadow-pop', side === 'top' ? 'bottom-full mb-2' : 'mt-1', align === 'right' ? 'right-0' : 'left-0')}>
          {items.map((it, i) =>
            it === 'sep' ? <div key={i} className="my-1 border-t border-hairline" /> : (
              <button
                key={i}
                onClick={() => { setOpen(false); it.onClick(); }}
                className={cx('flex w-full items-center gap-2 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-soft', it.danger ? 'text-danger' : 'text-ink')}
              >
                {it.icon && <span className="text-ink-3">{it.icon}</span>}
                <span className="flex-1">{it.label}</span>
                {it.hint && <span className="text-[11px] text-ink-4">{it.hint}</span>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

let toastPush: ((t: { id: number; text: ReactNode; tone?: 'info' | 'error'; action?: { label: string; onClick: () => void } }) => void) | null = null;
export function toast(text: ReactNode, opts: { tone?: 'info' | 'error'; action?: { label: string; onClick: () => void } } = {}) {
  toastPush?.({ id: Date.now() + Math.random(), text, ...opts });
}
export function Toaster() {
  const [items, setItems] = useState<{ id: number; text: ReactNode; tone?: 'info' | 'error'; action?: { label: string; onClick: () => void } }[]>([]);
  useEffect(() => {
    toastPush = (t) => {
      setItems((x) => [...x.slice(-3), t]);
      setTimeout(() => setItems((x) => x.filter((y) => y.id !== t.id)), t.action ? 12000 : 5000);
    };
    return () => { toastPush = null; };
  }, []);
  return createPortal(
    <div className="pointer-events-none fixed right-4 top-4 z-[60] flex w-[340px] flex-col gap-2">
      {items.map((t) => (
        <div key={t.id} className={cx('fade-up pointer-events-auto rounded-xl border bg-elevated px-3.5 py-3 text-[13px] shadow-pop', t.tone === 'error' ? 'border-danger/40' : 'border-hairline')}>
          <div className={t.tone === 'error' ? 'text-danger' : 'text-ink'}>{t.text}</div>
          {t.action && (
            <div className="mt-2">
              <Button size="sm" variant="primary" onClick={() => { t.action!.onClick(); setItems((x) => x.filter((y) => y.id !== t.id)); }}>{t.action.label}</Button>
            </div>
          )}
        </div>
      ))}
    </div>,
    document.body,
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      {icon && <div className="mb-3 text-ink-4">{icon}</div>}
      <div className="font-display text-[19px] text-ink">{title}</div>
      {children && <div className="mt-1.5 max-w-sm text-[13px] text-ink-3">{children}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-[28px] font-normal leading-tight text-ink">{title}</h1>
        {subtitle && <div className="mt-1 text-[13px] text-ink-3">{subtitle}</div>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Section({ title, children, right }: { title: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="mb-8">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-4">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}
