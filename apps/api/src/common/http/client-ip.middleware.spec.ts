import http from 'http';
import express from 'express';
import { cloudflareClientIp } from './client-ip.middleware';

/**
 * `trust proxy` is 2, matching production (Caddy, then the hop in front of it).
 * The test client connects from 127.0.0.1, which stands in for the Docker peer.
 * Audit logging and ThrottlerGuard.getTracker both read `req.ip`.
 */
describe('cloudflareClientIp', () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    const app = express();
    app.set('trust proxy', 2);
    app.use(cloudflareClientIp);
    app.get('/ip', (req, res) => {
      res.type('text/plain').send(req.ip || '');
    });
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const address = server.address();
        port = typeof address === 'object' && address ? address.port : 0;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  function get(headers: Record<string, string>): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port, path: '/ip', headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      });
      req.on('error', reject);
      req.end();
    });
  }

  it('uses CF-Connecting-IP when the trusted hop is a Cloudflare edge address', async () => {
    await expect(
      get({
        'x-forwarded-for': '172.70.42.10',
        'cf-connecting-ip': '203.0.113.8',
      }),
    ).resolves.toBe('203.0.113.8');

    await expect(
      get({
        'x-forwarded-for': '172.68.10.4',
        'cf-connecting-ip': '2001:db8::5',
      }),
    ).resolves.toBe('2001:db8::5');
  });

  it('ignores a spoofed CF-Connecting-IP when the request did not come through Cloudflare', async () => {
    await expect(
      get({
        'x-forwarded-for': '198.51.100.20',
        'cf-connecting-ip': '203.0.113.9',
      }),
    ).resolves.toBe('198.51.100.20');

    await expect(get({ 'cf-connecting-ip': '203.0.113.9' })).resolves.toBe('127.0.0.1');
  });

  it('keeps the visitor already present in X-Forwarded-For ahead of the edge', async () => {
    await expect(
      get({
        'x-forwarded-for': '203.0.113.5, 172.70.1.1',
        'cf-connecting-ip': '198.51.100.99',
      }),
    ).resolves.toBe('203.0.113.5');
  });

  it('ignores a CF-Connecting-IP that is not a single address', async () => {
    await expect(
      get({
        'x-forwarded-for': '172.70.1.1',
        'cf-connecting-ip': '203.0.113.8, 198.51.100.1',
      }),
    ).resolves.toBe('172.70.1.1');
  });
});
