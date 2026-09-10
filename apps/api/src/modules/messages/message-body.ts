import { BadRequestException } from '@nestjs/common';
import sanitizeHtml from 'sanitize-html';
import { marked } from 'marked';

export const MESSAGE_BODY_MAX_CHARS = 100_000;

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'br', 'strong', 'em', 'u', 's', 'h2', 'h3', 'ul', 'ol', 'li', 'a', 'blockquote'],
  allowedAttributes: { a: ['href', 'rel'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false,
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }),
    b: 'strong',
    i: 'em',
    h1: (tagName, attribs) => ({ tagName: '', attribs }),
  },
  // Text of dropped tags stays; script/style content is removed by the defaults.
  nonTextTags: ['script', 'style', 'textarea', 'option'],
};

/** Allowlist-sanitise an HTML message body. Throws 400 when the result is too long. */
export function sanitizeMessageHtml(html: string): string {
  const clean = sanitizeHtml(html ?? '', SANITIZE_OPTIONS).trim();
  if (clean.length > MESSAGE_BODY_MAX_CHARS) {
    throw new BadRequestException('Message body too long');
  }
  return clean;
}

/** Markdown (what agents write) → the same sanitised HTML the editor produces. */
export function markdownToMessageHtml(markdown: string): string {
  const html = marked.parse(markdown ?? '', { async: false, gfm: true, breaks: false }) as string;
  return sanitizeMessageHtml(html);
}

/** Plain text (legacy TEXT messages, shareholder replies) → escaped paragraphs. */
export function textToMessageHtml(text: string): string {
  if (!text) return '';
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return text
    .split(/\n{2,}/)
    .map((para) => `<p>${escape(para).replace(/\n/g, '<br />')}</p>`)
    .join('');
}
