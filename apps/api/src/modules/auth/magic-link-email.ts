export interface MagicLinkEmailCopy {
  heading: string;
  codeLabel: string;
  body: string;
  button: string;
  expiry: string;
  footer: string;
}

/**
 * Same shell as the other auth emails (Arial, branded h1, centered button,
 * grey expiry and footer). The code sits above the button in a large
 * monospace line so it is the first thing a member sees.
 */
export function renderMagicLinkEmail(options: {
  code: string;
  magicLinkUrl: string;
  brandColor: string;
  copy: MagicLinkEmailCopy;
}): string {
  const { magicLinkUrl, brandColor, copy } = options;
  const code = options.code.replace(/\D/g, '').slice(0, 6);
  return `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><style>body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; } h1 { color: ${brandColor}; }</style></head>
        <body>
          <h1>${copy.heading}</h1>
          <p style="text-align: center; margin: 24px 0 0; color: #666; font-size: 14px;">${copy.codeLabel}</p>
          <p style="text-align: center; margin: 8px 0 24px;">
            <span style="display: inline-block; font-family: Consolas, Monaco, monospace; font-size: 32px; font-weight: bold; letter-spacing: 8px; color: ${brandColor};">${code}</span>
          </p>
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
