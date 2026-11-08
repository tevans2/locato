// "Which one is it?": a flag with 2–3 look-alike names to choose from (the game's look-alike sets).
import type {ModeDef} from './kit';

export const which: ModeDef = {
  id: 'which', label: 'Which one is it?', tags: '#geography #flags #quiz', baseSeconds: 1.5, answer: 'answer.thats', pick: true,
  build: (k, r) => {
    const {byCode} = k.game;
    const fits = (codes: string[]) => codes.every((x) => byCode.has(x) && !k.used.has(x) && r.allowed(byCode.get(x)!));
    // a fixed pick chooses the set it belongs to
    const sets = r.pick
      ? k.game.lookalikes.filter((s) => s.skill === 'flag' && s.codes.length <= 3 && s.codes.includes(r.pick!.code) && fits(s.codes))
      : k.shuffle(k.game.lookalikes.filter((s) => s.skill === 'flag' && s.codes.length <= 3 && fits(s.codes)));
    const set = sets[0];
    if (!set) throw new Error(r.pick ? `${r.pick.name} isn't in a usable look-alike set` : 'Out of look-alike sets for this selection');
    set.codes.forEach((x) => k.used.add(x));
    const target = r.pick ?? byCode.get(k.shuffle(set.codes)[0])!;
    const round = {type: 'which' as const, skill: 'flag' as const, code: target.code, country: target.name, answer: target.name, options: k.shuffle(set.codes.map((x) => byCode.get(x)!.name))};
    return {round, vars: {answer: target.name, country: target.name}};
  },
};
