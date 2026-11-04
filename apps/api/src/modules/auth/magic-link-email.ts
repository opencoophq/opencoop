export interface MagicLinkEmailCopy {
  heading: string;
  /** Full line with a `{code}` placeholder, e.g. "Your sign-in code: {code}". */
  codeLine: string;
  body: string;
  button: string;
  expiry: string;
  footer: string;
}

export function magicLinkDigits(code: string): string {
  return code.replace(/\D/g, '').slice(0, 6);
}

/** Label and code on one line, the shape Apple Mail / Safari AutoFill looks for. */
export function magicLinkCodeLine(template: string, code: string): string {
  return template.replace('{code}', magicLinkDigits(code));
}

/**
 * Same shell as the other auth emails (Arial, branded h1, centered button,
 * grey expiry and footer). The code line is one text node, large and bold,
 * with no letter-spacing, so a mail client reads "Your sign-in code: 123456"
 * as a single line.
 */
export function renderMagicLinkEmail(options: {
  code: string;
  magicLinkUrl: string;
  brandColor: string;
  copy: MagicLinkEmailCopy;
}): string {
  const { magicLinkUrl, brandColor, copy } = options;
  const codeLine = magicLinkCodeLine(copy.codeLine, options.code);
  return `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><style>body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; } h1 { color: ${brandColor}; }</style></head>
        <body>
          <h1>${copy.heading}</h1>
          <p style="text-align: center; margin: 24px 0; font-size: 28px; font-weight: bold; font-family: Consolas, Monaco, monospace; color: ${brandColor};">${codeLine}</p>
          <p>${copy.body}</p>
          <p style="text-align: center; margin: 30px 0;">
            <a href="${magicLinkUrl}"
               style="background-color: ${brandColor}; color: white; padding: 12px 24px;
                      text-decoration: none; border-radius: 6px; display: inline-block;">
              ${copy.button}
            </a>
          </p>
          <p style="color: #666; font-size: 12px;">${copy.expiry}</p>
          <hr><p style="color: #666; font-size: 12px;">${copy.footer}</p>
        </body>
        </html>
      `;
}

/** Plain-text twin of the HTML. The code line is on its own line, digits unspaced. */
export function renderMagicLinkEmailText(options: {
  code: string;
  magicLinkUrl: string;
  copy: MagicLinkEmailCopy;
}): string {
  const codeLine = magicLinkCodeLine(options.copy.codeLine, options.code);
  return [
    options.copy.heading,
    '',
    codeLine,
    '',
    options.copy.body,
    '',
    options.magicLinkUrl,
    '',
    options.copy.expiry,
    '',
    options.copy.footer,
  ].join('\n');
}
