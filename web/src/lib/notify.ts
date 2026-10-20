// Native notifications: Electron bridge when available, the Web Notification API otherwise.
declare global {
  interface Window { acta?: { notify: (title: string, body: string, id: string) => void; onNotificationClick: (cb: (id: string) => void) => void; isDesktop: boolean } }
}

const handlers = new Map<string, () => void>();
let wired = false;

export function notify(title: string, body: string, onClick?: () => void) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  if (onClick) handlers.set(id, onClick);
  if (window.acta?.notify) {
    if (!wired) {
      window.acta.onNotificationClick((nid) => { handlers.get(nid)?.(); handlers.delete(nid); });
      wired = true;
    }
    window.acta.notify(title, body, id);
    return;
  }
  if (!('Notification' in window)) return;
  const show = () => {
    const n = new Notification(title, { body, tag: id });
    n.onclick = () => { window.focus(); onClick?.(); n.close(); };
  };
  if (Notification.permission === 'granted') show();
  else if (Notification.permission !== 'denied') Notification.requestPermission().then((p) => p === 'granted' && show());
}
