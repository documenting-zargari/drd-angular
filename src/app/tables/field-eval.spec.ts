import { resolveOne, resolveText } from './field-eval';

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
  });
});
