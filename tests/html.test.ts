import { describe, expect, it } from 'vitest';
import { esc, html, raw } from '../src/lib/html';

describe('html template', () => {
  it('escapes interpolated text', () => {
    expect(html`<p>${'<script>alert("x")</script>'}</p>`.value).toBe('<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>');
    expect(esc(`a&b 'c'`)).toBe('a&amp;b &#39;c&#39;');
  });
  it('does not double-escape nested templates or raw()', () => {
    const items = ['a', '<b>'].map(x => html`<li>${x}</li>`);
    expect(html`<ul>${items}</ul>`.value).toBe('<ul><li>a</li><li>&lt;b&gt;</li></ul>');
    expect(html`<i>${raw('<svg/>')}</i>`.value).toBe('<i><svg/></i>');
  });
  it('drops null, undefined and booleans but keeps 0', () => {
    expect(html`${null}${undefined}${false}${true}${0}`.value).toBe('0');
  });
  it('stringifies', () => {
    expect(`${html`<b>${'&'}</b>`}`).toBe('<b>&amp;</b>');
  });
});
