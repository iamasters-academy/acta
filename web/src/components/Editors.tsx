import { useEffect, useRef } from 'react';
import { useEditor, EditorContent, Mark, mergeAttributes } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import TurndownService from 'turndown';
import { renderMarkdown } from './Markdown';
import { cx } from './ui';

/** Marks text that came from the user's own notes inside AI-enhanced notes. */
const UserText = Mark.create({
  name: 'userText',
  parseHTML: () => [{ tag: 'span.u' }],
  renderHTML: ({ HTMLAttributes }) => ['span', mergeAttributes(HTMLAttributes, { class: 'u' }), 0],
});

const turndown = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', emDelimiter: '*' });
turndown.addRule('userText', { filter: (n) => n.nodeName === 'SPAN' && (n as HTMLElement).classList.contains('u'), replacement: (c) => (c.trim() ? `{{${c}}}` : c) });
turndown.addRule('taskItem', {
  filter: (n) => n.nodeName === 'LI' && (n as HTMLElement).getAttribute('data-type') === 'taskItem',
  replacement: (c, n) => `- [${(n as HTMLElement).getAttribute('data-checked') === 'true' ? 'x' : ' '}] ${c.trim()}\n`,
});

export function htmlToMarkdown(html: string) {
  return turndown.turndown(html).replace(/\n{3,}/g, '\n\n').trim();
}

const extensions = (placeholder: string) => [
  StarterKit.configure({ link: { openOnClick: true, autolink: true } }),
  Placeholder.configure({ placeholder }),
  TaskList,
  TaskItem.configure({ nested: true }),
];

/** The user's own notes. Saves HTML + plain text (debounced). */
export function NotesEditor({ html, onChange, placeholder, autoFocus }: {
  html: string; onChange: (html: string, text: string) => void; placeholder?: string; autoFocus?: boolean;
}) {
  const cb = useRef(onChange);
  cb.current = onChange;
  const timer = useRef<number | undefined>(undefined);
  const editor = useEditor({
    extensions: extensions(placeholder || 'Escribe tus notas…'),
    content: html || '',
    autofocus: autoFocus ? 'end' : false,
    onUpdate: ({ editor }) => {
      clearTimeout(timer.current);
      timer.current = window.setTimeout(() => cb.current(editor.getHTML(), editor.getText({ blockSeparator: '\n' })), 400);
    },
  });
  useEffect(() => () => {
    if (timer.current && editor) { clearTimeout(timer.current); cb.current(editor.getHTML(), editor.getText({ blockSeparator: '\n' })); }
  }, [editor]);
  return <div className="note-editor"><EditorContent editor={editor} /></div>;
}

/** AI-enhanced notes: grey AI text, ink user text. Editable; saves back as Markdown. */
export function EnhancedEditor({ markdown, onChange }: { markdown: string; onChange: (md: string) => void }) {
  const cb = useRef(onChange);
  cb.current = onChange;
  const timer = useRef<number | undefined>(undefined);
  const editor = useEditor({
    extensions: [...extensions(''), UserText],
    content: renderMarkdown(markdown),
    onUpdate: ({ editor }) => {
      clearTimeout(timer.current);
      timer.current = window.setTimeout(() => cb.current(htmlToMarkdown(editor.getHTML())), 600);
    },
  });
  // Replace content when a fresh enhancement arrives.
  const last = useRef(markdown);
  useEffect(() => {
    if (editor && markdown !== last.current && htmlToMarkdown(editor.getHTML()) !== markdown) {
      editor.commands.setContent(renderMarkdown(markdown));
    }
    last.current = markdown;
  }, [markdown, editor]);
  return <div className={cx('note-editor enhanced')}><EditorContent editor={editor} /></div>;
}
