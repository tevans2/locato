// compile(recipe) → the spec a template renders. Pure: game data, content and file access are passed in,
// so the CLI, the server and the admin's live preview all produce the same video from the same recipe + seed.
import type {LookalikesProps, QuizProps, QuizRound} from '../locato/schema';
import {findCountry, seededRandom, selector, themeForDate, type Country, type Game} from './game';
import {MIX, MIX_LABEL, MIX_TAGS, MODES} from './modes';
import {ladderSeconds, ladderTier, thirdsTier, type Assets, type Kit} from './modes/kit';
import {resolveLine, spokenHook, spokenText, type PhraseCtx, type Vars} from './phrases';
import {Recipe, type Content, type PhraseRef, type DailyRecipe, type LookalikesRecipe, type ModeId, type QuizRecipe, type RoundRecipe, type Selection} from './types';

export type CompileEnv = {
  game: Game;
  content: Content;
  /** Same seed + same recipe = same video. */
  seed: string;
  /** Codes used in recent videos (avoided when possible). */
  avoid?: Set<string>;
  /** Codes that must not appear (e.g. the real Daily's countries, so a warm-up never spoils it). */
  exclude?: string[];
  assets: Assets;
  /** For default names (YYYYMMDD). */
  today?: string;
};

export type Compiled = {
  template: 'quiz' | 'daily' | 'lookalikes';
  props: QuizProps | LookalikesProps;
  caption: string;
  /** Suggested file name (videos/<name>.json). */
  name: string;
  /** Generated files to write under public/ (path → contents), e.g. flag-colour stages. */
  files: Record<string, string>;
  /** Things worth a second look (a hook that doesn't suit the rules, a pick that was moved…). */
  warnings: string[];
  /** The recipe after validation (store it with the spec). */
  recipe: Recipe;
};

export function compile(input: unknown, env: CompileEnv): Compiled {
  const recipe = Recipe.parse(input);
  switch (recipe.format) {
    case 'quiz':
      return compileQuiz(recipe, env);
    case 'daily':
      return compileDaily(recipe, env);
    case 'lookalikes':
      return compileLookalikes(recipe, env);
  }
}

// ---- shared ---------------------------------------------------------------------------------------------------
const stampOf = (env: CompileEnv) => (env.today ?? new Date().toISOString().slice(0, 10)).replace(/-/g, '');
const exclusion = (env: CompileEnv): Selection => ({exclude: env.exclude?.length ? env.exclude : undefined});

/** Hook, closing question, note and call to action → on-screen props + what the voice says. */
function outroCopy(recipe: Recipe, env: CompileEnv, ctx: PhraseCtx, vars: Vars, warn: (s: string) => void, title: string, hookSay: string | null) {
  const {phrases} = env.content;
  const c = recipe.copy ?? {};
  const q = resolveLine(phrases, 'question', c.question, ctx, vars, warn);
  const note = resolveLine(phrases, 'note', c.note, ctx, vars, warn);
  const cta = resolveLine(phrases, 'cta', c.cta, ctx, vars, warn);
  const noteSay = note.say ?? spokenText(note.text);
  return {
    outro: {question: q.text, note: note.text, cta: cta.text},
    voiceText: {
      ...(title.trim() ? {hook: hookSay ?? spokenHook(title)} : {}),
      outro: `${q.say ?? q.text} ${noteSay}`,
      cta: cta.say ?? cta.text,
    },
    ids: {question: q.id, note: note.id, cta: cta.id},
  };
}

function makeKit(game: Game, seed: string, avoid: Set<string>, assets: Assets) {
  const {rand, shuffle} = seededRandom(seed);
  const files: Record<string, string> = {};
  const kit: Kit = {game, rand, shuffle, used: new Set(), avoid, assets, emit: (path, contents) => ((files[path] = contents), path)};
  return {kit, files};
}

/** Build the rounds: ladder difficulty, per-round selection, timers, the boss, and the spoken reveal. */
function buildRounds(
  plan: RoundRecipe[],
  env: CompileEnv,
  kit: Kit,
  opts: {selection: Selection[]; ladder: 'ladder' | 'thirds'; timer: 'ladder' | {fixed: number}; baseSeconds?: number; boss: boolean; answer?: PhraseRef; ctx: PhraseCtx; vars: Vars},
  warn: (s: string) => void,
) {
  const {game} = env;
  const n = plan.length;
  return plan.map((rr, i): QuizRound => {
    const def = MODES[rr.mode];
    const sel = selector(game, env.content.lists, ...opts.selection, {include: rr.from, exclude: rr.exclude});
    if (rr.pick && !def.pick) throw new Error(`Round ${i + 1}: ${def.label} can't take a fixed pick`);
    const pick = rr.pick ? findCountry(rr.pick, game) : undefined;
    if (pick && !sel.allowed(pick)) warn(`Round ${i + 1}: ${pick.name} is outside the selection (used anyway, as picked)`);
    const tier = rr.level ? ({easy: 1, medium: 2, hard: 3} as const)[rr.level] : (opts.ladder === 'thirds' ? thirdsTier : ladderTier)(i, n);
    const {round, vars} = def.build(kit, {i, n, tier, allowed: pick ? () => true : sel.allowed, excluded: sel.excluded, pick, recipe: rr});
    if (rr.seconds) round.seconds = rr.seconds;
    else if (opts.timer === 'ladder') round.seconds ??= ladderSeconds(i, n, opts.baseSeconds ?? def.baseSeconds);
    if (opts.boss && i === n - 1 && n > 2) round.boss = true;
    // the spoken reveal: the mode's own line, or the recipe's choice for the generic "That's X!"
    const answerRef = def.answer === 'answer.thats' && opts.answer ? opts.answer : def.answer;
    const line = resolveLine(env.content.phrases, 'answer', answerRef, opts.ctx, {...opts.vars, ...vars}, warn);
    round.say = line.say ?? line.text;
    return round;
  });
}

/** Recipe picks (e.g. from comments) → onto the country rounds, easiest first, so the ladder still climbs. */
function placePicks(plan: RoundRecipe[], picks: string[] | undefined, game: Game) {
  if (!picks?.length) return plan;
  const cs: Country[] = picks.map((p) => findCountry(p, game)).sort((a, b) => a.tier - b.tier);
  const out = plan.map((r) => ({...r}));
  const open = out.filter((r) => !r.pick && MODES[r.mode].pick && r.mode !== 'route');
  if (cs.length > open.length) throw new Error(`${cs.length} picked countr${cs.length === 1 ? 'y' : 'ies'} but only ${open.length} round(s) here can use one (Overland, MapTap and Worldsplit rounds can't)`);
  // the last open rounds take the picks, easiest first, so the boss gets the hardest one
  const slots = open.slice(open.length - cs.length);
  slots.forEach((r, k) => (r.pick = cs[k].code));
  return out;
}

// ---- quiz: the Score Challenge --------------------------------------------------------------------------------
function compileQuiz(recipe: QuizRecipe, env: CompileEnv): Compiled {
  const warnings: string[] = [];
  const warn = (s: string) => warnings.push(s);
  const rules = recipe.rules ?? {};
  const mode = rules.mode ?? 'score';
  const oneLife = mode === 'one-life';
  const isMix = !recipe.rounds && recipe.modes === 'mix';
  const n0 = recipe.count ?? 5;
  let plan: RoundRecipe[] =
    recipe.rounds ??
    (isMix
      ? [...MIX.slice(0, Math.max(0, n0 - 1)), 'route' as ModeId].map((m) => ({mode: m}))
      : Array.from({length: n0}, (_, i) => ({mode: (recipe.modes as ModeId[] | undefined)?.[i % ((recipe.modes as ModeId[] | undefined)?.length ?? 1)] ?? 'flag'})));
  if (recipe.boss) {
    const last = plan[plan.length - 1];
    if (!MODES[last.mode].pick) throw new Error(`The last round (${MODES[last.mode].label}) can't take a fixed boss`);
    plan = [...plan.slice(0, -1), {...last, pick: recipe.boss}];
  }
  plan = placePicks(plan, recipe.picks, env.game);
  const n = plan.length;
  const modes = [...new Set(plan.map((r) => r.mode))];
  const single = modes.length === 1 ? MODES[modes[0]] : null;
  const ctx: PhraseCtx = {format: 'quiz', rules: mode};
  const vars: Vars = {n, ...recipe.vars, tags: single?.tags ?? MIX_TAGS};
  const {kit, files} = makeKit(env.game, env.seed, recipe.fresh === false ? new Set() : env.avoid ?? new Set(), env.assets);

  const rounds = buildRounds(plan, env, kit, {
    selection: [recipe.countries ?? {}, exclusion(env)],
    ladder: rules.ladder ?? 'ladder',
    timer: rules.timer ?? 'ladder',
    baseSeconds: rules.baseSeconds,
    boss: rules.boss ?? true,
    answer: recipe.copy?.answer,
    ctx,
    vars,
  }, warn);

  const copy = recipe.copy ?? {};
  const hook = copy.hook === false ? {id: 'none', text: '', say: null} : copy.title !== undefined ? {id: 'custom', text: copy.title, say: null} : resolveLine(env.content.phrases, 'hook', copy.hook, ctx, vars, warn);
  const out = outroCopy(recipe, env, ctx, vars, warn, hook.text, hook.say);
  const caption = resolveLine(env.content.phrases, 'caption', copy.caption, ctx, vars, warn);
  const hookPhrase = env.content.phrases.find((p) => p.id === hook.id);
  const kind = isMix ? 'mix' : single ? single.aliases?.[0] ?? single.id : 'custom';
  const hookKey = hookPhrase?.alias ?? hook.id ?? 'custom';
  const continents = (recipe.countries?.include ?? []).filter((r) => r.startsWith('continent:')).map((r) => r.slice(10));

  const props: QuizProps = {
    mode,
    title: hook.text,
    badge: copy.badge ?? (isMix ? MIX_LABEL : single?.label ?? 'Mixed modes'),
    rounds,
    outro: out.outro,
    voiceText: out.voiceText,
    meta: {
      format: 'score-challenge', kind, mode, hook: hookKey, hookId: hook.id, hookText: hook.text, count: n,
      modes: plan.map((r) => r.mode), timers: rounds.map((r) => r.seconds), continent: continents[0] ?? null,
      copy: {question: out.ids.question, note: out.ids.note, cta: out.ids.cta, caption: caption.id},
    },
  };
  return {template: 'quiz', props, caption: caption.text, name: `${kind}-${oneLife ? 'onelife' : 'score'}-${hookKey}-${stampOf(env)}`, files, warnings, recipe};
}

// ---- daily warm-up: the day's theme, easy → hard, never the real Daily's countries ----------------------------------
function compileDaily(recipe: DailyRecipe, env: CompileEnv): Compiled {
  const warnings: string[] = [];
  const warn = (s: string) => warnings.push(s);
  const date = recipe.date ?? env.today ?? new Date().toISOString().slice(0, 10);
  const theme = themeForDate(env.game.themes, date);
  const n = recipe.count ?? 5;
  const cycle: ModeId[] = recipe.modes ?? ['flag', 'capital', 'shape'];
  const plan: RoundRecipe[] = Array.from({length: n}, (_, i) => ({mode: cycle[i % cycle.length]}));
  const ctx: PhraseCtx = {format: 'daily'};
  const vars: Vars = {n, theme: theme.title, date, ...recipe.vars, tags: MIX_TAGS};
  const {kit, files} = makeKit(env.game, env.seed, recipe.fresh ? env.avoid ?? new Set() : new Set(), env.assets);
  const seconds = recipe.seconds ?? 3;
  const rounds = buildRounds(plan, env, kit, {
    selection: [{include: [`theme:${theme.id}`], require: ['shape']}, recipe.countries ?? {}, exclusion(env)],
    ladder: 'thirds',
    timer: {fixed: seconds},
    boss: false,
    answer: recipe.copy?.answer,
    ctx,
    vars,
  }, warn);
  const copy = recipe.copy ?? {};
  const hook = copy.hook === false ? {id: 'none', text: '', say: null} : copy.title !== undefined ? {id: 'custom', text: copy.title, say: null} : resolveLine(env.content.phrases, 'hook', copy.hook, ctx, vars, warn);
  const out = outroCopy(recipe, env, ctx, vars, warn, hook.text, hook.say);
  const caption = resolveLine(env.content.phrases, 'caption', copy.caption, ctx, vars, warn);
  const props: QuizProps = {
    variant: 'daily',
    title: hook.text,
    badge: copy.badge ?? theme.title,
    rounds,
    secondsPerRound: seconds,
    outro: out.outro,
    voiceText: out.voiceText,
    meta: {format: 'daily-warmup', date, theme: theme.id, hookId: hook.id, count: n, modes: plan.map((r) => r.mode)},
  };
  return {template: 'daily', props, caption: caption.text, name: `daily-${date}`, files, warnings, recipe};
}

// ---- look-alikes: the game's look-alike sets, side by side -------------------------------------------------------
function compileLookalikes(recipe: LookalikesRecipe, env: CompileEnv): Compiled {
  const warnings: string[] = [];
  const warn = (s: string) => warnings.push(s);
  const skill = recipe.skill ?? 'flag';
  const n = recipe.count ?? 3;
  const {game} = env;
  const {shuffle} = seededRandom(env.seed);
  const sel = selector(game, env.content.lists, recipe.countries ?? {}, exclusion(env));
  const ok = (code: string) => game.byCode.has(code) && sel.allowed(game.byCode.get(code)!);
  const sets = shuffle(game.lookalikes.filter((s) => s.skill === skill && s.codes.length <= 4 && s.codes.every(ok)))
    .slice(0, n)
    .map((s) => ({skill, items: shuffle(s.codes).map((code) => ({code, name: game.byCode.get(code)!.name})), tip: s.tip}));
  if (!sets.length) throw new Error(`No look-alike sets for "${skill}" in this selection`);
  if (sets.length < n) warn(`Only ${sets.length} look-alike set(s) fit (asked for ${n})`);
  const ctx: PhraseCtx = {format: 'lookalikes', skill};
  const vars: Vars = {n: sets.length, ...recipe.vars, tags: '#geography #flags #quiz'};
  const copy = recipe.copy ?? {};
  const hook = copy.hook === false ? {id: 'none', text: '', say: null} : copy.title !== undefined ? {id: 'custom', text: copy.title, say: null} : resolveLine(env.content.phrases, 'hook', copy.hook, ctx, vars, warn);
  const out = outroCopy(recipe, env, ctx, vars, warn, hook.text, hook.say);
  const caption = resolveLine(env.content.phrases, 'caption', copy.caption, ctx, vars, warn);
  const props: LookalikesProps = {
    title: hook.text,
    badge: copy.badge ?? 'Look-alikes',
    sets,
    secondsPerSet: recipe.seconds ?? 4,
    outro: out.outro,
    voiceText: out.voiceText,
  };
  return {template: 'lookalikes', props, caption: caption.text, name: `lookalikes-${skill}-${stampOf(env)}`, files: {}, warnings, recipe};
}
