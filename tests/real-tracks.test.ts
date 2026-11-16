/** Recorded real Jellyfin 12 media sources: untagged subtitle tracks (a TV episode carries 40 of them). */
import { describe, expect, it } from 'vitest';
import undef from './fixtures/real-mediasource-undefined-subs.json';
import ext from './fixtures/real-mediasource-external-sub.json';
import { dropUndefined, normaliseVersion, type MediaSourceDto } from '../src/api/normalise';
import { subtitleSummary } from '../src/pages/details/views';

import listJson from './fixtures/real-series-list.json';
import { normaliseItem, rankSearch, type BaseItemDto } from '../src/api/normalise';

describe('search ranking (real show names)', () => {
  const names = (listJson as { Items: BaseItemDto[] }).Items.map(normaliseItem);
  it('a name that starts with the text beats one that merely contains it', () => {
    const sorted = [...names].sort((a, b) => a.name.localeCompare(b.name));
    expect(rankSearch(sorted, 'pla')[0]?.name).toBe('Prehistoric Planet'); // a word starts with "pla"
    expect(rankSearch(sorted, 'sil')[0]?.name).toBe('Silo');
    expect(rankSearch(sorted, 'ter').length).toBe(names.length); // nothing is dropped
  });
  it('ignores a leading "The" and keeps server order inside a group', () => {
    const r = rankSearch([{ name: 'Ghost' }, { name: 'The Last Viking' }, { name: 'Lantern' }], 'la').map(t => t.name);
    expect(r).toEqual(['The Last Viking', 'Lantern', 'Ghost']);
  });
});

describe('untagged tracks (real data)', () => {
  const v = normaliseVersion(undef as MediaSourceDto);

  it('does not show the word "Undefined" to anyone', () => {
    expect(v.subtitles.length).toBe(6);
    for (const s of v.subtitles) expect(s.label).not.toMatch(/undefined/i);
    expect(v.audio[0]?.label).toBe('Dolby Digital+ - 5.1 - Default');
  });

  it('numbers them and keeps what tells them apart', () => {
    expect(v.subtitles[0]?.label).toBe('Subtitles 1 · default');
    expect(v.subtitles[1]?.label).toBe('Subtitles 2 · hearing impaired');
    expect(v.subtitles[2]?.label).toBe('Subtitles 3');
  });

  it('a tagged external track keeps its own name', () => {
    const e = normaliseVersion(ext as MediaSourceDto);
    expect(e.subtitles[0]?.label).toBe('English - SUBRIP - External');
    expect(e.subtitles[0]?.isExternal).toBe(true);
  });

  it('the episode summary counts tracks when no language is known', () => {
    expect(subtitleSummary(v.subtitles)).toBe('6 subtitle tracks');
    expect(subtitleSummary([{ language: 'eng' }, { language: 'fra' }, { language: 'eng' }])).toBe('subtitles: eng, fra');
  });

  it('dropUndefined only trims a leading placeholder', () => {
    expect(dropUndefined('Undefined - SUBRIP')).toBe('SUBRIP');
    expect(dropUndefined('English - SUBRIP')).toBe('English - SUBRIP');
  });
});
