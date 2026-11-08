// The mode registry. A new game mode = one ModeDef here (+ its renderer in templates/Quiz.tsx).
import type {ModeId} from '../types';
import {colours} from './colours';
import {capital, capitalOf, code, flag, shape} from './country';
import type {ModeDef} from './kit';
import {find, pin, spot} from './map';
import {route} from './route';
import {split} from './split';
import {which} from './which';

export const MODES: Record<ModeId, ModeDef> = {flag, shape, capital, 'capital-of': capitalOf, code, colours, which, spot, find, pin, route, split};

/** "mix": one round from each mode, ending on an Overland boss. */
export const MIX: ModeId[] = ['flag', 'shape', 'capital', 'spot', 'colours', 'code', 'find'];
export const MIX_LABEL = 'Every mode';
export const MIX_TAGS = '#geography #quiz #maps';

/** A mode by id or CLI alias ("flags" → flag). */
export const modeByName = (name: string): ModeDef => {
  const m = (MODES as Record<string, ModeDef>)[name] ?? Object.values(MODES).find((d) => d.aliases?.includes(name));
  if (!m) throw new Error(`Unknown mode "${name}" (${Object.values(MODES).map((d) => d.aliases?.[0] ?? d.id).join(', ')}, mix)`);
  return m;
};

export type {ModeDef};
