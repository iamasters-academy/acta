import { useMemo } from 'react';
import { marked } from 'marked';
import { useNavigate } from 'react-router-dom';
import { cx } from './ui';

marked.setOptions({ gfm: true, breaks: false });

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** Markdown → HTML. {{text}} marks the user's own words; [[m:ID|Title]] becomes a meeting citation chip. */
export function renderMarkdown(md: string) {
  const withCites = md
    .replace(/\[\[m:([\w]+)\|([^\]]+)\]\]/g, (_, id, t) => `<a class="cite" data-meeting="${esc(id)}" href="/nota/${esc(id)}">${esc(t.trim())}</a>`)
    .replace(/\[\[m:([\w]+)\]\]/g, (_, id) => `<a class="cite" data-meeting="${esc(id)}" href="/nota/${esc(id)}">nota</a>`)
    .replace(/\{\{([\s\S]*?)\}\}/g, '<span class="u">$1</span>');
  // Drop a dangling "{{" or "[[m:" while streaming.
  const cleaned = withCites.replace(/\{\{[^}]*$/, (m) => m.slice(2)).replace(/\[\[m:[^\]]*$/, '');
  return marked.parse(cleaned) as string;
}

export function Markdown({ text, className, ai }: { text: string; className?: string; ai?: boolean }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  const nav = useNavigate();
  return (
    <div
      className={cx('md', ai && 'ai', className)}
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest('a');
        if (!a) return;
        const id = a.getAttribute('data-meeting');
        e.preventDefault();
        if (id) nav(`/nota/${id}`);
        else if (a.href) window.open(a.href, '_blank');
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
