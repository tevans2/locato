// The simple country modes: show something about one country, reveal the answer.
import {pickCountry, type ModeDef} from './kit';

const COUNTRY = {baseSeconds: 1.5, answer: 'answer.thats', pick: true} as const;

export const flag: ModeDef = {
  ...COUNTRY, id: 'flag', label: 'Flags', tags: '#geography #flags #quiz', aliases: ['flags'],
  build: (k, r) => {
    const c = pickCountry(k, r, r.allowed);
    return {round: {type: 'flag', code: c.code, country: c.name, answer: c.name, note: c.continent}, vars: {answer: c.name, country: c.name}};
  },
};

export const shape: ModeDef = {
  ...COUNTRY, id: 'shape', label: 'Country outlines', tags: '#geography #maps #quiz', aliases: ['shapes'],
  build: (k, r) => {
    const c = pickCountry(k, r, (x) => x.shape && r.allowed(x));
    return {round: {type: 'shape', code: c.code, country: c.name, answer: c.name, note: c.continent}, vars: {answer: c.name, country: c.name}};
  },
};

export const capital: ModeDef = {
  ...COUNTRY, id: 'capital', label: 'Capitals', tags: '#geography #capitals #quiz', aliases: ['capitals'],
  build: (k, r) => {
    const c = pickCountry(k, r, r.allowed);
    return {round: {type: 'capital', code: c.code, country: c.name, answer: c.capital, note: `Capital of ${c.name}`}, vars: {answer: c.capital, country: c.name}};
  },
};

export const capitalOf: ModeDef = {
  ...COUNTRY, id: 'capital-of', label: 'Capitals', tags: '#geography #capitals #quiz',
  build: (k, r) => {
    const c = pickCountry(k, r, r.allowed);
    return {round: {type: 'capital-of', code: c.code, country: c.name, answer: c.name, note: c.capital}, vars: {answer: c.name, country: c.name}};
  },
};

export const code: ModeDef = {
  ...COUNTRY, id: 'code', label: 'Country codes', tags: '#geography #countries #quiz', aliases: ['codes'],
  build: (k, r) => {
    const c = pickCountry(k, r, r.allowed);
    return {round: {type: 'code', code: c.code, country: c.name, answer: c.name, note: c.continent}, vars: {answer: c.name, country: c.name}};
  },
};
