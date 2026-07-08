import { describe, expect, test } from 'vitest';
import { sanitizeNgaContent } from '../community/sources/nga.js';

describe('NGA content sanitization', () => {
  test('removes HTML break tags and forum markup from comments', () => {
    expect(sanitizeNgaContent('第一行<br>第二行<br />[s:ac:哭笑]<b>重点</b>'))
      .toBe('第一行 第二行 重点');
  });

  test('decodes escaped break tags before stripping HTML', () => {
    expect(sanitizeNgaContent('A&lt;br&gt;B&nbsp;&amp;&nbsp;C'))
      .toBe('A B & C');
  });
});
