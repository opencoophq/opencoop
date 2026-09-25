import { BadRequestException } from '@nestjs/common';
import {
  sanitizeMessageHtml,
  markdownToMessageHtml,
  textToMessageHtml,
  MESSAGE_BODY_MAX_CHARS,
} from './message-body';

describe('sanitizeMessageHtml', () => {
  it('keeps the allowlisted tags', () => {
    const html =
      '<h2>Titel</h2><p>Een <strong>vet</strong>, <em>schuin</em>, <u>onderlijnd</u>, <s>door</s> woord.</p><ul><li>a</li></ul><ol><li>b</li></ol><blockquote>q</blockquote><p>x<br>y</p>';
    expect(sanitizeMessageHtml(html)).toBe(
      '<h2>Titel</h2><p>Een <strong>vet</strong>, <em>schuin</em>, <u>onderlijnd</u>, <s>door</s> woord.</p><ul><li>a</li></ul><ol><li>b</li></ol><blockquote>q</blockquote><p>x<br />y</p>',
    );
  });

  it('strips script, style, event handlers and unknown tags but keeps their text', () => {
    const html = '<p onclick="x()">hi<script>alert(1)</script><style>p{}</style><div>inner</div></p>';
    const result = sanitizeMessageHtml(html);
    // Ensure dangerous content is removed
    expect(result).not.toContain('<script');
    expect(result).not.toContain('<style');
    expect(result).not.toContain('<div');
    expect(result).not.toContain('onclick');
    expect(result).not.toContain('alert(1)');
    expect(result).not.toContain('p{}');
    // Ensure benign text is preserved
    expect(result).toContain('hi');
    expect(result).toContain('inner');
  });

  it('keeps http, https and mailto links and adds rel', () => {
    expect(sanitizeMessageHtml('<a href="https://bronsgroen.be">site</a>')).toBe(
      '<a href="https://bronsgroen.be" rel="noopener noreferrer">site</a>',
    );
    expect(sanitizeMessageHtml('<a href="mailto:info@bronsgroen.be">mail</a>')).toBe(
      '<a href="mailto:info@bronsgroen.be" rel="noopener noreferrer">mail</a>',
    );
  });

  it('drops javascript: links but keeps the text', () => {
    expect(sanitizeMessageHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a rel="noopener noreferrer">x</a>');
  });

  it('drops h1 and images', () => {
    expect(sanitizeMessageHtml('<h1>big</h1><img src="x.png">')).toBe('big');
  });

  it('rejects bodies over the limit', () => {
    const big = '<p>' + 'a'.repeat(MESSAGE_BODY_MAX_CHARS) + '</p>';
    expect(() => sanitizeMessageHtml(big)).toThrow(BadRequestException);
  });
});

describe('markdownToMessageHtml', () => {
  it('converts headings, emphasis, lists and links', () => {
    const md = '## Wat er is beslist\n\nEen **vet** woord en een [link](https://bronsgroen.be).\n\n- een\n- twee\n';
    expect(markdownToMessageHtml(md)).toBe(
      '<h2>Wat er is beslist</h2>\n<p>Een <strong>vet</strong> woord en een <a href="https://bronsgroen.be" rel="noopener noreferrer">link</a>.</p>\n<ul>\n<li>een</li>\n<li>twee</li>\n</ul>',
    );
  });

  it('downgrades h1 to plain text because h1 is not allowed', () => {
    expect(markdownToMessageHtml('# Titel')).toBe('Titel');
  });

  it('does not let raw html through', () => {
    const result = markdownToMessageHtml('<script>x</script>tekst');
    // Ensure script tags and their content are removed
    expect(result).not.toContain('<script');
    expect(result).not.toContain('alert');
    expect(result).not.toContain('x</script>');
    // Ensure legitimate text is preserved
    expect(result).toContain('tekst');
  });
});

describe('textToMessageHtml', () => {
  it('escapes and wraps paragraphs', () => {
    expect(textToMessageHtml('a < b\n\nc & d\ne')).toBe('<p>a &lt; b</p><p>c &amp; d<br />e</p>');
  });

  it('returns an empty string for empty input', () => {
    expect(textToMessageHtml('')).toBe('');
  });
});
