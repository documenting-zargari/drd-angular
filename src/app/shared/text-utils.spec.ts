import { foldText, kwicSplit } from './text-utils';

describe('foldText', () => {
  it('lowercases and strips diacritics', () => {
    expect(foldText('Čhavo ŠUKAR džala')).toBe('chavo sukar dzala');
  });
});

describe('kwicSplit', () => {
  it('splits around a plain match', () => {
    const k = kwicSplit('the quick brown fox', 'quick');
    expect(k.hit).toBeTrue();
    expect(k.left).toBe('the ');
    expect(k.match).toBe('quick');
    expect(k.right).toBe(' brown fox');
  });

  it('matches case- and accent-insensitively but preserves the source form', () => {
    const k = kwicSplit('Šun, džahes apo gaba', 'dzahes');
    expect(k.hit).toBeTrue();
    expect(k.match).toBe('džahes');
    expect(k.left).toBe('Šun, ');
    expect(k.right).toBe(' apo gaba');
  });

  it('keeps left-context diacritics intact when the match follows accented text', () => {
    const k = kwicSplit('čačо phral čačo', 'phral');
    expect(k.left).toBe('čačо ');
    expect(k.match).toBe('phral');
  });

  it('reports no hit and returns the whole string as left context', () => {
    const k = kwicSplit('nothing here', 'zzz');
    expect(k.hit).toBeFalse();
    expect(k.left).toBe('nothing here');
    expect(k.match).toBe('');
  });

  it('handles an empty needle', () => {
    const k = kwicSplit('abc', '');
    expect(k.hit).toBeFalse();
    expect(k.left).toBe('abc');
  });
});
