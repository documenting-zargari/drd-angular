import { getByPath, resolveOne, resolveText, setByPath, splitFieldNames } from './field-eval';

describe('field-eval', () => {
  describe('resolveOne', () => {
    it('reads a plain field', () => {
      expect(resolveOne({ form: 'varesar' }, { field: 'form' })).toEqual(['varesar']);
    });

    it('joins a pipe-compound with ": "', () => {
      const a = { origin: { source: 'Current-L2', language: 'Bulgarian' } };
      expect(resolveOne(a, { field: 'origin.source|origin.language' })).toEqual([
        'Current-L2: Bulgarian',
      ]);
    });

    it('drops null parts of a compound', () => {
      const a = { origin: { source: 'Inherited', language: null } };
      expect(resolveOne(a, { field: 'origin.source|origin.language' })).toEqual(['Inherited']);
    });

    it('handles a 3-part top-level compound (first two ": ", rest ", ")', () => {
      const a = { source: 'Current-L2', language: 'Bulgarian', origin: 'x' };
      expect(resolveOne(a, { field: 'source|language|origin' })).toEqual([
        'Current-L2: Bulgarian, x',
      ]);
    });

    it('maps a single path over an array field', () => {
      const a = { markers: [{ marker: 'vare' }, { marker: 'ni' }] };
      expect(resolveOne(a, { field: 'markers.marker' })).toEqual(['vare', 'ni']);
    });

    it('zips a pipe-compound per array element', () => {
      const a = {
        markers: [
          { origin: { source: 'Inherited', language: null } },
          { origin: { source: 'Current-L2', language: 'Serbian' } },
        ],
      };
      expect(
        resolveOne(a, { field: 'markers.origin.source|markers.origin.language' }),
      ).toEqual(['Inherited', 'Current-L2: Serbian']);
    });

    it('returns [] for a missing field', () => {
      expect(resolveOne({ form: 'x' }, { field: 'nope' })).toEqual([]);
    });
  });

  describe('resolveText', () => {
    it('inline: comma-joins de-duplicated values across answers', () => {
      const answers = [{ form: 'a' }, { form: 'b' }, { form: 'a' }];
      expect(resolveText(answers, { field: 'form', layout: 'inline' })).toBe('a, b');
    });

    it('stack: one value per line', () => {
      const answers = [{ markers: [{ marker: 'vare' }, { marker: 'ni' }] }];
      expect(resolveText(answers, { field: 'markers.marker', layout: 'stack' })).toBe('vare\nni');
    });

    it('empty when nothing resolves', () => {
      expect(resolveText([{ x: 1 }], { field: 'form' })).toBe('');
      expect(resolveText([], { field: 'form' })).toBe('');
      expect(resolveText([{ form: 'a' }], null)).toBe('');
    });

    it('filter picks the matching answer among several sharing a questionId (regression: Irregularities Adjective/Adverb columns)', () => {
      const answers = [
        { _key: 'a1', word_class: 'Adjective', stem: 'bet' },
        { _key: 'a2', word_class: 'Adverb', stem: 'betye' },
      ];
      expect(
        resolveText(answers, { field: 'stem', filter: { word_class: 'Adjective' } }),
      ).toBe('bet');
      expect(
        resolveText(answers, { field: 'stem', filter: { word_class: 'Adverb' } }),
      ).toBe('betye');
    });
  });

  describe('splitFieldNames', () => {
    it('splits on | without touching dots', () => {
      expect(splitFieldNames('source|language')).toEqual(['source', 'language']);
      expect(splitFieldNames('origin.source|origin.language')).toEqual([
        'origin.source',
        'origin.language',
      ]);
    });

    it('keeps a single dotted field as one name', () => {
      expect(splitFieldNames('origin.source')).toEqual(['origin.source']);
    });
  });

  describe('getByPath / setByPath', () => {
    it('reads a nested path', () => {
      expect(getByPath({ origin: { source: 'Current-L2' } }, 'origin.source')).toBe('Current-L2');
    });

    it('reads a flat path', () => {
      expect(getByPath({ form: 'varesar' }, 'form')).toBe('varesar');
    });

    it('returns undefined for a missing nested path, without throwing', () => {
      expect(getByPath({ form: 'x' }, 'origin.source')).toBeUndefined();
      expect(getByPath(null, 'origin.source')).toBeUndefined();
    });

    it('writes a nested path, creating intermediate objects', () => {
      const answer: any = { form: 'varesar' };
      setByPath(answer, 'origin.source', 'Current-L2');
      expect(answer).toEqual({ form: 'varesar', origin: { source: 'Current-L2' } });
    });

    it('writing two dotted fields under the same prefix merges into one object', () => {
      // This is the exact bug the legacy edit path had: it treated
      // "origin.source" as a literal flat key, so a PATCH payload built from
      // it (`{"origin.source": v}`) never touched the real nested field.
      const updates: Record<string, any> = {};
      setByPath(updates, 'origin.source', 'Current-L2');
      setByPath(updates, 'origin.language', 'Bulgarian');
      expect(updates).toEqual({ origin: { source: 'Current-L2', language: 'Bulgarian' } });
    });

    it('writes a flat path', () => {
      const answer: any = {};
      setByPath(answer, 'form', 'varesar');
      expect(answer).toEqual({ form: 'varesar' });
    });
  });
});
