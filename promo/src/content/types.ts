// The promo data model. Plain TypeScript + zod, no Node APIs, so the same code runs in the CLI, on the
// server and in the browser (the future admin "Create" tab builds its form from these schemas).
//
//   Recipe  (what you edit: small, readable)  ──compile()──►  Spec (videos/<name>.json: exact rounds, timings, text)
//
// Content (phrases, country lists, presets, week plans) is data, not code: defaults live in promo/content/*.json
// (in git) and the promo service (D1) holds online additions/overrides that the admin can expand. See src/content/merge.ts.
import {z} from 'zod';

// ---- modes ----------------------------------------------------------------------------------------------
export const MODE_IDS = ['flag', 'shape', 'capital', 'capital-of', 'code', 'colours', 'which', 'spot', 'find', 'pin', 'route', 'split'] as const;
export const ModeId = z.enum(MODE_IDS);
export type ModeId = z.infer<typeof ModeId>;

// ---- choosing countries ----------------------------------------------------------------------------------
/**
 * A country, or a group of them:
 *   "JP" / "Japan"            one country (ISO code or name)
 *   "continent:europe"        a continent ("north-america" or "North America")
 *   "theme:islands"           one of the game's daily themes
 *   "level:easy|medium|hard"  by how well known it is (fame tier 1 / 2 / 3)
 *   "list:<id>"               a country list from content (lists.json / R2)
 *   "all"
 */
export const CountryRef = z.string().min(1);
export type CountryRef = z.infer<typeof CountryRef>;

export const Selection = z.object({
  /** Only these. Same kind = alternatives (continent:asia, continent:europe); different kinds narrow (continent:asia + level:easy). Empty = all. */
  include: z.array(CountryRef).optional(),
  /** Never these (any match), anywhere in the video: also not as a route stop or a look-alike option. */
  exclude: z.array(CountryRef).optional(),
  /** Countries must have this asset in the game. */
  require: z.array(z.enum(['flag', 'shape'])).optional(),
});
export type Selection = z.infer<typeof Selection>;

export const Level = z.enum(['easy', 'medium', 'hard']);
export type Level = z.infer<typeof Level>;

// ---- copy: phrases are referenced by id, or written inline ------------------------------------------------
/** A phrase id from content (e.g. "hook.can-you-get"), or literal text (needs a live voice, not the clip library). */
export const PhraseRef = z.union([z.string(), z.object({text: z.string(), say: z.string().optional()})]);
export type PhraseRef = z.infer<typeof PhraseRef>;

export const Copy = z.object({
  hook: PhraseRef.or(z.literal(false)).optional(), // false = no hook line
  answer: PhraseRef.optional(), // spoken on each reveal (country modes); map modes have their own
  question: PhraseRef.optional(),
  note: PhraseRef.optional(),
  cta: PhraseRef.optional(),
  caption: PhraseRef.optional(),
  /** Literal overrides for the on-screen title and badge. */
  title: z.string().optional(),
  badge: z.string().optional(),
});
export type Copy = z.infer<typeof Copy>;

export const Style = z.object({
  /** Library track name, "none", or a file path. */
  music: z.string().optional(),
  musicVolume: z.number().optional(),
  effects: z.boolean().optional(),
  voice: z.string().optional(), // "none" = silent
  intensity: z.enum(['calm', 'lively', 'hype']).optional(),
  engine: z.enum(['chatterbox', 'kokoro']).optional(),
});
export type Style = z.infer<typeof Style>;

// ---- recipes ------------------------------------------------------------------------------------------------
export const RoundRecipe = z.object({
  mode: ModeId,
  /** Narrow this round's countries (any match), within the recipe's selection. */
  from: z.array(CountryRef).optional(),
  exclude: z.array(CountryRef).optional(),
  /** Use exactly this country (route: the start; which: a country in the look-alike set). */
  pick: CountryRef.optional(),
  /** Override the ladder's difficulty for this round. */
  level: Level.optional(),
  seconds: z.number().positive().optional(),
});
export type RoundRecipe = z.infer<typeof RoundRecipe>;

export const QuizRules = z.object({
  mode: z.enum(['score', 'one-life']).optional(), // default score
  /** ladder: 1,1,2,3,3 (boss from the hardest pool) · thirds: easy, medium, hard thirds */
  ladder: z.enum(['ladder', 'thirds']).optional(), // default ladder
  /** Thinking time: grows along the ladder from a per-mode base, or the same fixed time for every round. */
  timer: z.union([z.literal('ladder'), z.object({fixed: z.number().positive()})]).optional(), // default ladder
  /** Override every mode's base seconds on the ladder. */
  baseSeconds: z.number().positive().optional(),
  boss: z.boolean().optional(), // default true: the last round is the boss (3+ rounds)
});
export type QuizRules = z.infer<typeof QuizRules>;

const RecipeBase = {
  countries: Selection.optional(),
  copy: Copy.optional(),
  style: Style.optional(),
  /** Values for phrase placeholders, e.g. {score: 4} for "Beat my score". */
  vars: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  /** Avoid countries used in recent videos (soft: falls back when the pool is small). Default true. */
  fresh: z.boolean().optional(),
};

export const QuizRecipe = z.object({
  format: z.literal('quiz'),
  ...RecipeBase,
  /** Shorthand: count + modes (cycled), or "mix" (one round from each mode, Overland boss). Ignored if `rounds` is set. */
  count: z.number().int().min(1).max(12).optional(),
  modes: z.union([z.array(ModeId).min(1), z.literal('mix')]).optional(),
  rounds: z.array(RoundRecipe).optional(),
  /** Use these countries (sorted easy → hard onto the country rounds), e.g. from comment requests. */
  picks: z.array(CountryRef).optional(),
  /** The final round's country (the boss), e.g. a comment request. */
  boss: CountryRef.optional(),
  rules: QuizRules.optional(),
});
export type QuizRecipe = z.infer<typeof QuizRecipe>;

export const DailyRecipe = z.object({
  format: z.literal('daily'),
  ...RecipeBase,
  /** YYYY-MM-DD (the game's Daily theme for that date). Default: the video's day. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  count: z.number().int().min(1).max(12).optional(),
  modes: z.array(ModeId).min(1).optional(),
  seconds: z.number().positive().optional(),
});
export type DailyRecipe = z.infer<typeof DailyRecipe>;

export const LookalikesRecipe = z.object({
  format: z.literal('lookalikes'),
  ...RecipeBase,
  skill: z.enum(['flag', 'shape']).optional(), // default flag
  count: z.number().int().min(1).max(8).optional(),
  seconds: z.number().positive().optional(),
});
export type LookalikesRecipe = z.infer<typeof LookalikesRecipe>;

export const Recipe = z.discriminatedUnion('format', [QuizRecipe, DailyRecipe, LookalikesRecipe]);
export type Recipe = z.infer<typeof Recipe>;

// ---- content ------------------------------------------------------------------------------------------------
export const SLOTS = ['hook', 'answer', 'question', 'note', 'cta', 'caption'] as const;
export const Phrase = z.object({
  id: z.string().regex(/^[a-z0-9.-]+$/),
  slot: z.enum(SLOTS),
  /** On screen (answer slot: what's said). Placeholders: {n} {score} {theme} {tags} {answer} {country} {k} {names} {side} {pct} */
  text: z.string(),
  /** Spoken version when it differs ("5/5" is read as "5 out of 5" automatically). */
  say: z.string().optional(),
  /** Short CLI name, e.g. hook "a" for --hook a. */
  alias: z.string().optional(),
  /** Used when a recipe doesn't choose one (first default that suits wins). */
  default: z.boolean().optional(),
  suits: z
    .object({format: z.array(z.enum(['quiz', 'daily', 'lookalikes'])).optional(), rules: z.array(z.enum(['score', 'one-life'])).optional(), skill: z.array(z.enum(['flag', 'shape'])).optional()})
    .optional(),
  /** Placeholders that must be given in recipe.vars (e.g. score). */
  needs: z.array(z.string()).optional(),
  note: z.string().optional(),
  disabled: z.boolean().optional(),
});
export type Phrase = z.infer<typeof Phrase>;

export const CountryList = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  description: z.string().optional(),
  codes: z.array(z.string().regex(/^[A-Z]{2}$/)),
  disabled: z.boolean().optional(),
});
export type CountryList = z.infer<typeof CountryList>;

/** A saved recipe; open fields are filled per video (seed, date, overrides). */
export const Preset = z.object({id: z.string().regex(/^[a-z0-9-]+$/), name: z.string(), recipe: Recipe, disabled: z.boolean().optional()});
export type Preset = z.infer<typeof Preset>;

/** A week of slots (one array per day, one entry per posting slot), each a preset id or an inline recipe. */
export const PlanSlot = z.union([z.object({preset: z.string()}), z.object({recipe: Recipe})]);
export const Plan = z.object({id: z.string(), name: z.string(), days: z.array(z.array(PlanSlot)), disabled: z.boolean().optional()});
export type Plan = z.infer<typeof Plan>;

export const CONTENT_KINDS = {phrases: Phrase, lists: CountryList, presets: Preset, plans: Plan} as const;
export type ContentKind = keyof typeof CONTENT_KINDS;
export type Content = {phrases: Phrase[]; lists: CountryList[]; presets: Preset[]; plans: Plan[]};
