// Built-in templates ("recetas de notas") and chat recipes, plus the prompts that use them.
import { all, get, now, run } from './db.ts';

export const BUILTIN_TEMPLATES = [
  {
    id: 'tpl_general',
    name: 'Reunión general',
    description: 'La plantilla por defecto: lo esencial de cualquier reunión.',
    instructions: 'Notas claras y escaneables. Prioriza decisiones y próximos pasos.',
    sections: ['Resumen', 'Puntos clave', 'Decisiones', 'Próximos pasos'],
  },
  {
    id: 'tpl_discovery',
    name: 'Llamada de descubrimiento',
    description: 'Primera llamada con un posible cliente: dolor, contexto y encaje.',
    instructions: 'Piensa como un consultor que va a enviar una propuesta. Recoge cifras, plazos y nombres exactos. Señala las señales de compra y las dudas.',
    sections: ['Contexto del cliente', 'Dolores y necesidades', 'Situación actual y herramientas', 'Presupuesto y plazos', 'Quién decide', 'Objeciones y dudas', 'Siguientes pasos'],
  },
  {
    id: 'tpl_consulting',
    name: 'Sesión de consultoría',
    description: 'Sesión de trabajo con un cliente: diagnóstico, recomendaciones y compromisos.',
    instructions: 'Separa lo que se comprometió el cliente de lo que nos comprometimos nosotros. Incluye riesgos.',
    sections: ['Objetivo de la sesión', 'Diagnóstico', 'Recomendaciones', 'Compromisos del cliente', 'Nuestros compromisos', 'Riesgos y bloqueos'],
  },
  {
    id: 'tpl_sales',
    name: 'Llamada de venta',
    description: 'Llamada de cierre: oferta, objeciones y siguiente paso.',
    instructions: 'Registra el precio y la oferta tal cual se dijeron. Las objeciones, con las palabras del cliente.',
    sections: ['Resumen de la llamada', 'Oferta presentada', 'Objeciones (literal)', 'Nivel de interés', 'Siguiente paso acordado'],
  },
  {
    id: 'tpl_1on1',
    name: '1:1',
    description: 'Reunión individual con alguien del equipo.',
    instructions: 'Tono humano. Registra el estado de ánimo solo si se habló de ello.',
    sections: ['Cómo está', 'Avances', 'Bloqueos', 'Feedback', 'Acuerdos'],
  },
  {
    id: 'tpl_team',
    name: 'Reunión de equipo',
    description: 'Equipo o socios: estado por persona, decisiones y tareas.',
    instructions: 'Agrupa por persona cuando se pueda. Las tareas siempre con responsable.',
    sections: ['Estado por persona', 'Temas tratados', 'Decisiones', 'Tareas por responsable'],
  },
  {
    id: 'tpl_interview',
    name: 'Entrevista de usuario',
    description: 'Investigación con clientes o alumnos.',
    instructions: 'Incluye citas textuales entre comillas. No mezcles interpretación con lo que dijo la persona.',
    sections: ['Perfil', 'Problemas que cuenta', 'Citas textuales', 'Insights', 'Oportunidades'],
  },
  {
    id: 'tpl_podcast',
    name: 'Podcast o entrevista',
    description: 'Grabación de contenido: ideas, citas y momentos para clips.',
    instructions: 'Marca con el minuto los momentos con potencial de clip. Recoge herramientas y recursos mencionados.',
    sections: ['Temas tratados', 'Ideas clave', 'Citas destacables', 'Momentos para clips (con minuto)', 'Recursos mencionados'],
  },
  {
    id: 'tpl_class',
    name: 'Clase o formación',
    description: 'Clase en directo o sesión formativa.',
    instructions: 'Escribe para un alumno que no pudo asistir. Incluye pasos reproducibles.',
    sections: ['Objetivo de la clase', 'Conceptos explicados', 'Herramientas y demos', 'Paso a paso', 'Preguntas de los alumnos'],
  },
];

export const BUILTIN_RECIPES = [
  { slug: 'email-seguimiento', name: 'Email de seguimiento', description: 'Redacta el email para después de la reunión', prompt: 'Escribe un email de seguimiento para enviar a los asistentes. Breve, cálido y concreto: agradece, resume lo acordado en 3-5 viñetas, deja claros los próximos pasos con fechas y responsables. Firma como {{nombre}}. Devuelve asunto y cuerpo.' },
  { slug: 'tareas', name: 'Mis tareas', description: 'Lo que me comprometí a hacer', prompt: 'Lista SOLO las tareas que me tocan a mí ({{nombre}}), con fecha si se dijo. Formato de checklist. Si no hay ninguna, dilo.' },
  { slug: 'resumen-ejecutivo', name: 'Resumen ejecutivo', description: 'Cinco líneas para quien no estuvo', prompt: 'Escribe un resumen ejecutivo de máximo 5 líneas para alguien que no estuvo en la reunión. Empieza por la conclusión.' },
  { slug: 'decisiones', name: 'Decisiones', description: 'Qué se decidió exactamente', prompt: 'Lista las decisiones tomadas, una por línea, con quién la tomó si se sabe. Separa las decisiones firmes de las que quedaron pendientes.' },
  { slug: 'objeciones', name: 'Objeciones', description: 'Dudas del cliente y cómo responderlas', prompt: 'Identifica cada objeción o duda que planteó la otra parte, cítala tal cual y propón cómo responderla en la próxima conversación.' },
  { slug: 'coach', name: 'Coach', description: 'Feedback sobre cómo llevé la reunión', prompt: 'Actúa como un coach de ventas y comunicación exigente. Analiza cómo llevé la reunión: proporción de habla, calidad de las preguntas, escucha, manejo de objeciones y cierre. Da 3 cosas que hice bien y 3 que mejoraría, con ejemplos del transcript.' },
  { slug: 'propuesta', name: 'Borrador de propuesta', description: 'Propuesta comercial a partir de lo hablado', prompt: 'Redacta un borrador de propuesta comercial basado en lo hablado: situación, objetivo, solución propuesta por fases, entregables, plazos y la inversión si se mencionó (no inventes cifras: marca [POR DEFINIR]).' },
  { slug: 'mensaje-equipo', name: 'Mensaje para el equipo', description: 'Resumen listo para WhatsApp o Slack', prompt: 'Escribe un mensaje corto para compartir con el equipo por WhatsApp o Slack: contexto en una línea, 3-5 puntos clave y quién hace qué. Sin markdown pesado.' },
  { slug: 'preguntas-abiertas', name: 'Preguntas abiertas', description: 'Lo que quedó sin resolver', prompt: 'Lista las preguntas o temas que quedaron abiertos o sin respuesta clara, y sugiere a quién preguntar cada uno.' },
  { slug: 'contenido', name: 'Ideas de contenido', description: 'Reels y posts a partir de la reunión', prompt: 'Saca 5 ideas de contenido (reel o post) a partir de lo hablado, sin datos confidenciales de clientes. Para cada una: gancho de una frase y el insight que la sostiene.' },
  { slug: 'semana', name: 'Mi semana', description: 'Resumen de las reuniones de esta semana', prompt: 'Resume mis reuniones de los últimos 7 días: lo más importante de cada una, decisiones y tareas pendientes. Agrupa por proyecto o cliente.' },
  { slug: 'prep', name: 'Prepárame', description: 'Contexto para la próxima reunión', prompt: 'Prepárame para mi próxima reunión: qué hablamos la última vez con estas personas, qué quedó pendiente y 3 preguntas que debería hacer.' },
];

export function seedDefaults() {
  const t = now();
  for (const tpl of BUILTIN_TEMPLATES) {
    if (!get('SELECT id FROM templates WHERE id = ?', tpl.id)) {
      run('INSERT INTO templates(id, name, description, instructions, sections, builtin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)',
        tpl.id, tpl.name, tpl.description, tpl.instructions, JSON.stringify(tpl.sections), t, t);
    }
  }
  for (const r of BUILTIN_RECIPES) {
    if (!get('SELECT id FROM recipes WHERE slug = ?', r.slug)) {
      run('INSERT INTO recipes(id, slug, name, description, prompt, builtin, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)',
        'rcp_' + r.slug, r.slug, r.name, r.description, r.prompt, t);
    }
  }
}

export function getTemplate(id?: string | null): any {
  const row = (id && get('SELECT * FROM templates WHERE id = ?', id)) || get("SELECT * FROM templates WHERE id = 'tpl_general'");
  return { ...row!, sections: JSON.parse(row!.sections || '[]') as string[] };
}

export function listTemplates() {
  return all('SELECT * FROM templates ORDER BY builtin DESC, name').map((t) => ({ ...t, sections: JSON.parse(t.sections || '[]') }));
}

export function enhanceSystemPrompt(opts: { userName: string; templateName: string; sections: string[]; instructions: string; language: string }) {
  return `Eres el motor de notas de Acta, un cuaderno de reuniones con IA. Conviertes las notas rápidas que ${opts.userName || 'el usuario'} escribió durante la reunión y el transcript completo en unas notas finales impecables.

REGLAS
- Las notas del usuario son el esqueleto: todo lo que escribió debe aparecer, ampliado con el contexto del transcript. Lo que el usuario apuntó indica lo que le importa: dale prioridad.
- Envuelve entre dobles llaves {{así}} cualquier fragmento que proceda literalmente o casi literalmente de las notas del usuario. Todo lo demás es tu aportación. No envuelvas encabezados.
- Usa Markdown: encabezados ### para cada sección, viñetas cortas, **negrita** solo para cifras, nombres y fechas importantes.
- Plantilla: «${opts.templateName}». Secciones, en este orden: ${opts.sections.map((s) => `«${s}»`).join(', ')}. Omite una sección si no hay nada real que poner (no rellenes).
- ${opts.instructions}
- No inventes nada. Si algo es dudoso, márcalo con (?). Cifras, nombres y fechas, exactos.
- En el transcript, «Yo» es ${opts.userName || 'el usuario'} y «Ellos» son el resto de participantes.
- Escribe en ${opts.language === 'en' ? 'inglés' : 'español'}. No pongas título principal ni preámbulo: empieza directamente por la primera sección.`;
}

export function enhanceUserPrompt(m: { title: string; attendees: any[]; notes: string; transcript: string; date: string }) {
  return `REUNIÓN: ${m.title || 'Sin título'}
FECHA: ${m.date}
ASISTENTES: ${m.attendees.map((a: any) => a.name || a.email).filter(Boolean).join(', ') || 'desconocidos'}

NOTAS DEL USUARIO (escritas durante la reunión):
${m.notes.trim() || '(no escribió notas: construye las notas solo a partir del transcript)'}

TRANSCRIPT:
${m.transcript.trim() || '(sin transcript)'}`;
}

export const ACTION_ITEMS_SYSTEM = `Extraes tareas accionables de una reunión. Devuelve SOLO JSON válido con la forma {"items":[{"text":"...","owner":"...","due":"..."}]}. "owner" es el nombre de la persona responsable ("Yo" si es el usuario), "due" la fecha o plazo tal como se dijo o "". Máximo 12 tareas. Solo tareas reales y concretas.`;

export const TITLE_SYSTEM = 'Pones títulos a reuniones. Devuelve SOLO el título, de 3 a 7 palabras, en español, sin comillas ni punto final. Concreto: incluye el nombre del cliente o del tema si aparece.';

export function chatSystemPrompt(opts: { userName: string; scopeLabel: string; today: string }) {
  return `Eres el asistente de Acta, el cuaderno de reuniones de ${opts.userName || 'el usuario'}. Respondes usando SOLO el contexto de reuniones que se te da (${opts.scopeLabel}). Hoy es ${opts.today}.
- Responde en español, directo y útil. Markdown ligero.
- Cuando uses información de una reunión concreta, cítala con el formato [[m:ID|Título corto]] usando el ID que aparece en el contexto.
- Si el contexto no contiene la respuesta, dilo claramente; no inventes.
- En los transcripts, «Yo» es ${opts.userName || 'el usuario'}.`;
}

export function briefSystemPrompt(userName: string) {
  return `Preparas a ${userName || 'el usuario'} para una reunión que está a punto de empezar. Con el historial de reuniones anteriores con estas personas o empresa, escribe un brief en Markdown: ### Contexto (quiénes son y relación), ### Lo que hablamos la última vez, ### Pendientes (de ambos lados), ### Preguntas que conviene hacer (3). Breve. Cita reuniones con [[m:ID|Título]]. Si no hay historial, dilo en una línea y sugiere 3 preguntas de descubrimiento.`;
}

export function listRecipes() {
  return all('SELECT * FROM recipes ORDER BY builtin DESC, name');
}
