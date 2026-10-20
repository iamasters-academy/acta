import { useEffect, useState } from 'react';
import { LayoutTemplate, Plus, Sparkles, Lock } from 'lucide-react';
import { api, type Template, type Recipe } from '../api';
import { Button, Input, Modal, PageHeader, Section, Textarea, cx, toast } from '../components/ui';

type TplForm = { id?: string; name: string; description: string; instructions: string; sections: string };
type RcpForm = { id?: string; name: string; slug?: string; description: string; prompt: string };

export function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [tpl, setTpl] = useState<TplForm | null>(null);
  const [rcp, setRcp] = useState<RcpForm | null>(null);
  const [tab, setTab] = useState<'templates' | 'recipes'>('templates');

  const load = () => {
    void api.get<Template[]>('/api/templates').then(setTemplates);
    void api.get<Recipe[]>('/api/recipes').then(setRecipes);
  };
  useEffect(load, []);

  const saveTpl = async () => {
    if (!tpl) return;
    const body = { ...tpl, sections: tpl.sections.split('\n').map((s) => s.trim()).filter(Boolean) };
    if (tpl.id) await api.put(`/api/templates/${tpl.id}`, body); else await api.post('/api/templates', body);
    setTpl(null);
    load();
    toast('Plantilla guardada');
  };
  const saveRcp = async () => {
    if (!rcp) return;
    if (rcp.id) await api.put(`/api/recipes/${rcp.id}`, rcp); else await api.post('/api/recipes', rcp);
    setRcp(null);
    load();
    toast('Receta guardada');
  };

  return (
    <div className="mx-auto max-w-[900px] px-8 pb-24 pt-10">
      <PageHeader
        title="Plantillas y recetas"
        subtitle="Las plantillas dan forma a las notas mejoradas. Las recetas son prompts reutilizables para el chat (escribe / para usarlas)."
        actions={<Button variant="primary" onClick={() => (tab === 'templates' ? setTpl({ name: '', description: '', instructions: '', sections: '' }) : setRcp({ name: '', description: '', prompt: '' }))}><Plus size={14} />{tab === 'templates' ? 'Nueva plantilla' : 'Nueva receta'}</Button>}
      />
      <div className="mb-6 inline-flex rounded-lg bg-soft p-0.5 text-[12.5px]">
        <button onClick={() => setTab('templates')} className={cx('flex items-center gap-1.5 rounded-md px-3 py-1', tab === 'templates' ? 'bg-raised text-ink shadow-card' : 'text-ink-3')}><LayoutTemplate size={12} />Plantillas</button>
        <button onClick={() => setTab('recipes')} className={cx('flex items-center gap-1.5 rounded-md px-3 py-1', tab === 'recipes' ? 'bg-raised text-ink shadow-card' : 'text-ink-3')}><Sparkles size={12} />Recetas</button>
      </div>

      {tab === 'templates' ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {templates.map((t) => (
            <button key={t.id} onClick={() => setTpl({ id: t.id, name: t.name, description: t.description, instructions: t.instructions, sections: t.sections.join('\n') })} className="rounded-2xl border border-hairline bg-raised p-4 text-left hover:border-hairline-strong">
              <div className="flex items-center gap-2 text-[14px] font-medium text-ink">{t.name}{!!t.builtin && <Lock size={11} className="text-ink-4" />}</div>
              <div className="mt-0.5 text-[12.5px] text-ink-3">{t.description}</div>
              <div className="mt-3 flex flex-wrap gap-1">
                {t.sections.slice(0, 6).map((s) => <span key={s} className="rounded-md bg-soft px-1.5 py-0.5 text-[11.5px] text-ink-3">{s}</span>)}
              </div>
            </button>
          ))}
        </div>
      ) : (
        <Section title={`${recipes.length} recetas`}>
          <div className="overflow-hidden rounded-2xl border border-hairline bg-raised">
            {recipes.map((r, i) => (
              <button key={r.id} onClick={() => setRcp({ id: r.id, slug: r.slug, name: r.name, description: r.description, prompt: r.prompt })} className={cx('flex w-full items-baseline gap-3 px-4 py-3 text-left hover:bg-soft', i > 0 && 'border-t border-hairline')}>
                <code className="w-[170px] shrink-0 text-[12.5px] text-accent-ink">/{r.slug}</code>
                <span className="flex-1"><span className="block text-[13.5px] text-ink">{r.name}</span><span className="block text-[12px] text-ink-4">{r.description}</span></span>
                {!!r.builtin && <Lock size={11} className="text-ink-4" />}
              </button>
            ))}
          </div>
        </Section>
      )}

      <Modal open={!!tpl} onClose={() => setTpl(null)} title={tpl?.id ? 'Editar plantilla' : 'Nueva plantilla'} width={560}>
        {tpl && (
          <div className="space-y-3 p-5">
            <Input placeholder="Nombre (ej. Kickoff de proyecto)" value={tpl.name} onChange={(e) => setTpl({ ...tpl, name: e.target.value })} />
            <Input placeholder="Para qué sirve" value={tpl.description} onChange={(e) => setTpl({ ...tpl, description: e.target.value })} />
            <div>
              <div className="mb-1 text-[12px] text-ink-3">Secciones (una por línea, en orden)</div>
              <Textarea rows={6} value={tpl.sections} onChange={(e) => setTpl({ ...tpl, sections: e.target.value })} placeholder={'Contexto\nDecisiones\nPróximos pasos'} />
            </div>
            <div>
              <div className="mb-1 text-[12px] text-ink-3">Instrucciones para la IA</div>
              <Textarea rows={3} value={tpl.instructions} onChange={(e) => setTpl({ ...tpl, instructions: e.target.value })} placeholder="Ej. Recoge siempre presupuesto y plazos con las cifras exactas." />
            </div>
            <div className="flex items-center justify-between pt-1">
              {tpl.id && !templates.find((t) => t.id === tpl.id)?.builtin
                ? <Button variant="danger" onClick={async () => { await api.del(`/api/templates/${tpl.id}`); setTpl(null); load(); }}>Eliminar</Button> : <span />}
              <div className="flex gap-2"><Button variant="ghost" onClick={() => setTpl(null)}>Cancelar</Button><Button variant="primary" disabled={!tpl.name.trim()} onClick={() => void saveTpl()}>Guardar</Button></div>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!rcp} onClose={() => setRcp(null)} title={rcp?.id ? 'Editar receta' : 'Nueva receta'} width={560}>
        {rcp && (
          <div className="space-y-3 p-5">
            <Input placeholder="Nombre (ej. Resumen para el CRM)" value={rcp.name} onChange={(e) => setRcp({ ...rcp, name: e.target.value })} />
            <Input placeholder="Descripción corta" value={rcp.description} onChange={(e) => setRcp({ ...rcp, description: e.target.value })} />
            <div>
              <div className="mb-1 text-[12px] text-ink-3">Prompt. Puedes usar {'{{nombre}}'} para tu nombre.</div>
              <Textarea rows={7} value={rcp.prompt} onChange={(e) => setRcp({ ...rcp, prompt: e.target.value })} />
            </div>
            <div className="flex items-center justify-between pt-1">
              {rcp.id && !recipes.find((r) => r.id === rcp.id)?.builtin
                ? <Button variant="danger" onClick={async () => { await api.del(`/api/recipes/${rcp.id}`); setRcp(null); load(); }}>Eliminar</Button> : <span />}
              <div className="flex gap-2"><Button variant="ghost" onClick={() => setRcp(null)}>Cancelar</Button><Button variant="primary" disabled={!rcp.name.trim() || !rcp.prompt.trim()} onClick={() => void saveRcp()}>Guardar</Button></div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
