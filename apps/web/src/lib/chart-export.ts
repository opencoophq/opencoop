/**
 * Utilities for exporting charts and tables for use in presentations.
 * Uses browser-native APIs (Canvas, Clipboard, XMLSerializer) — no dependencies.
 */

/**
 * Resolve CSS custom properties (hsl(var(--xxx))) in SVG elements
 * to computed RGB values before serialization.
 */
function inlineComputedStyles(svgEl: SVGElement): SVGElement {
  const clone = svgEl.cloneNode(true) as SVGElement;
  const elements = clone.querySelectorAll('*');

  elements.forEach((el) => {
    const computed = window.getComputedStyle(el);
    const htmlEl = el as SVGElement;

    // Inline fill/stroke if they use CSS variables
    const fill = htmlEl.getAttribute('fill');
    if (fill && fill.includes('var(')) {
      htmlEl.setAttribute('fill', computed.fill || fill);
    }
    const stroke = htmlEl.getAttribute('stroke');
    if (stroke && stroke.includes('var(')) {
      htmlEl.setAttribute('stroke', computed.stroke || stroke);
    }

    // Inline color for text elements
    if (el.tagName === 'text' || el.tagName === 'tspan') {
      const color = computed.fill;
      if (color) htmlEl.setAttribute('fill', color);
    }
  });

  return clone;
}

/**
 * Capture a recharts container as a PNG blob.
 * Serializes the SVG, renders onto a canvas at 2x for retina quality.
 */
export async function chartToPngBlob(containerEl: HTMLElement, scale = 2): Promise<Blob> {
  const svgEl = containerEl.querySelector('svg');
  if (!svgEl) throw new Error('No SVG found in container');

  const inlined = inlineComputedStyles(svgEl);
  const svgData = new XMLSerializer().serializeToString(inlined);
  const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  const img = new Image();
  img.src = url;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
  });

  const bbox = svgEl.getBoundingClientRect();
  const canvas = document.createElement('canvas');
  canvas.width = bbox.width * scale;
  canvas.height = bbox.height * scale;

  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, bbox.width, bbox.height);
  ctx.drawImage(img, 0, 0, bbox.width, bbox.height);

  URL.revokeObjectURL(url);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to create PNG blob'));
    }, 'image/png');
  });
}

/**
 * Copy a PNG blob to clipboard via the Clipboard API.
 */
export async function copyImageToClipboard(blob: Blob): Promise<void> {
  await navigator.clipboard.write([
    new ClipboardItem({ 'image/png': blob }),
  ]);
}

/**
 * Download SVG from a recharts container.
 */
export function downloadChartSvg(containerEl: HTMLElement, filename: string): void {
  const svgEl = containerEl.querySelector('svg');
  if (!svgEl) return;

  const inlined = inlineComputedStyles(svgEl);
  const svgData = new XMLSerializer().serializeToString(inlined);
  const blob = new Blob([svgData], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.svg`;
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(url);
  a.remove();
}

/**
 * Download PNG from a recharts container.
 */
export async function downloadChartPng(containerEl: HTMLElement, filename: string, scale = 2): Promise<void> {
  const blob = await chartToPngBlob(containerEl, scale);
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.png`;
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(url);
  a.remove();
}

/**
 * Copy an HTML table to clipboard as rich HTML.
 * Inlines basic styles so pasting into PowerPoint/Keynote preserves formatting.
 */
export async function copyTableAsHtml(tableEl: HTMLTableElement): Promise<void> {
  const clone = tableEl.cloneNode(true) as HTMLTableElement;
  clone.style.borderCollapse = 'collapse';
  clone.style.fontFamily = 'Arial, sans-serif';
  clone.style.fontSize = '12px';

  clone.querySelectorAll('th, td').forEach((cell) => {
    const el = cell as HTMLElement;
    el.style.border = '1px solid #ddd';
    el.style.padding = '6px 10px';
  });
  clone.querySelectorAll('th').forEach((th) => {
    const el = th as HTMLElement;
    el.style.backgroundColor = '#f0f4ff';
    el.style.fontWeight = 'bold';
  });

  const html = clone.outerHTML;
  const blob = new Blob([html], { type: 'text/html' });
  const textBlob = new Blob([tableEl.innerText], { type: 'text/plain' });

  await navigator.clipboard.write([
    new ClipboardItem({
      'text/html': blob,
      'text/plain': textBlob,
    }),
  ]);
}

/**
 * Check if the ClipboardItem API is available (required for image/html copy).
 */
export function isClipboardWriteSupported(): boolean {
  return typeof ClipboardItem !== 'undefined' && typeof navigator?.clipboard?.write === 'function';
}
