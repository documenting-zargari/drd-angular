import {
  contactLanguageLabel, contactLanguageOptions, parseContactLanguageToken, sampleMatchesContactLanguages,
} from './contact-languages';

describe('contact-language filter', () => {
  const ru = { sample_ref: 'UA-1', contact_languages: [{ language: 'Russian', level: 'Current-L2' }, { language: 'Greek', level: 'Old-L2' }] };
  const bg = { sample_ref: 'BG-1', contact_languages: [{ language: 'Bulgarian', level: 'Current-L2' }, { language: 'russian', level: 'Recent-L2' }] };
  const none = { sample_ref: 'XX-1' };

  it('parses and labels tokens, rejecting bad levels', () => {
    expect(parseContactLanguageToken('Current-L2:Russian')).toEqual({ level: 'Current-L2', language: 'Russian' });
    expect(parseContactLanguageToken('Inherited:Russian')).toBeNull();
    expect(parseContactLanguageToken('Russian')).toBeNull();
    expect(contactLanguageLabel('any:Russian')).toBe('Any L2: Russian');
  });

  it('matches level + language case-insensitively; "any" ignores the level', () => {
    expect(sampleMatchesContactLanguages(ru, ['Current-L2:russian'])).toBeTrue();
    expect(sampleMatchesContactLanguages(bg, ['Current-L2:Russian'])).toBeFalse();
    expect(sampleMatchesContactLanguages(bg, ['any:Russian'])).toBeTrue();
    expect(sampleMatchesContactLanguages(none, ['any:Russian'])).toBeFalse();
  });

  it('matches any of several tokens; no tokens matches everything', () => {
    expect(sampleMatchesContactLanguages(bg, ['Old-L2:Greek', 'Current-L2:Bulgarian'])).toBeTrue();
    expect(sampleMatchesContactLanguages(none, [])).toBeTrue();
  });

  it('lists options per level with sample counts, merging spelling case', () => {
    expect(contactLanguageOptions([ru, bg, none], 'Current-L2')).toEqual([
      { language: 'Bulgarian', count: 1 }, { language: 'Russian', count: 1 },
    ]);
    expect(contactLanguageOptions([ru, bg], 'any')).toEqual([
      { language: 'Bulgarian', count: 1 }, { language: 'Greek', count: 1 }, { language: 'Russian', count: 2 },
    ]);
  });
});
