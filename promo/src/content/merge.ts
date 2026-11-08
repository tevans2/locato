// Content = defaults (content/*.json, in git) + online additions/overrides (the promo service's D1 database).
// Merged by id: an online item adds to or replaces a default; "disabled": true hides one. Invalid items are skipped
// and reported. Pure: the promo Worker and the Mac tools both use it.
import {CONTENT_KINDS, type Content, type ContentKind} from './types';

export const KINDS = Object.keys(CONTENT_KINDS) as ContentKind[];
export type Source = 'default' | 'online' | 'online-override';
export type Merged = Content & {problems: string[]; sources: Record<string, Source>};

export function mergeContent(defaults: Partial<Record<ContentKind, unknown[]>>, online: Partial<Record<ContentKind, unknown[]>>): Merged {
  const problems: string[] = [];
  const sources: Record<string, Source> = {};
  const out = {} as Content;
  for (const kind of KINDS) {
    const schema = CONTENT_KINDS[kind];
    const items = new Map<string, any>();
    const take = (raw: unknown[], from: 'default' | 'online') =>
      raw.forEach((x, i) => {
        const r = schema.safeParse(x);
        if (!r.success) {
          problems.push(`${from} ${kind}[${i}]${(x as any)?.id ? ` "${(x as any).id}"` : ''}: ${r.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ')}`);
          return;
        }
        const id = (r.data as any).id;
        sources[`${kind}:${id}`] = from === 'online' && items.has(id) ? 'online-override' : from;
        items.set(id, r.data);
      });
    take(defaults[kind] ?? [], 'default');
    take(online[kind] ?? [], 'online');
    (out as any)[kind] = [...items.values()].filter((x) => !x.disabled);
  }
  return {...out, problems, sources};
}

/** Check one item before saving it online. */
export function validateItem(kind: ContentKind, item: unknown) {
  const r = CONTENT_KINDS[kind].safeParse(item);
  return r.success ? {ok: true as const, item: r.data} : {ok: false as const, error: r.error.issues.map((e) => `${e.path.join('.') || '(item)'}: ${e.message}`).join('; ')};
}
