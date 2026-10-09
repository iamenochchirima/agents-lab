import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';

/** Backend integration network policy. DNS is validated and pinned per request,
 * including token/metadata calls, to avoid a second lookup changing destinations.
 * Explicit local providers remain usable; link-local/metadata targets never do.
 */
export class IntegrationNetworkPolicy {
  constructor(private readonly privateHosts: readonly string[] = []) {}
  async destination(value: string | URL): Promise<{ url: URL; address: string; family: 4 | 6 }> {
    const url = new URL(value); const hostname = url.hostname.replace(/^\[|\]$/g, '');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || /(?:token|secret|api[_-]?key|password)=/i.test(url.search)) throw new Error('Integration endpoint requires HTTP(S) without embedded credentials.');
    const loopback = ['localhost', '127.0.0.1', '::1'].includes(hostname);
    if (url.protocol === 'http:' && !loopback) throw new Error('Remote integrations require HTTPS.');
    const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await lookup(hostname, { all: true });
    if (!addresses.length || addresses.some(item => blocked(item.address, loopback, this.privateHosts.includes(hostname)))) throw new Error('Integration destination is outside the configured network policy.');
    const first = addresses[0]!;
    return { url, address: first.address, family: first.family as 4 | 6 };
  }
  readonly fetch: typeof fetch = async (input, init = {}) => {
    const source = input instanceof Request ? input.url : input;
    const target = await this.destination(String(source));
    if (input instanceof Request) throw new Error('Managed integration requests require explicit bounded request parameters.');
    if (init.body !== undefined && init.body !== null && typeof init.body !== 'string' && !(init.body instanceof Uint8Array) && !(init.body instanceof URLSearchParams)) throw new Error('Integration request body must be bounded text or bytes.');
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    // Host routing and TLS verification follow the original validated hostname.
    delete headers.host;
    delete headers['accept-encoding'];
    return new Promise<Response>((resolve, reject) => {
      const request = (target.url.protocol === 'https:' ? httpsRequest : httpRequest)(target.url, {
        method: init.method ?? 'GET', headers, signal: init.signal ?? undefined, agent: false,
        // DNS has already been validated and pinned. Node's automatic family
        // selection otherwise requests an address array from this scalar lookup.
        family: target.family,
        lookup: (_hostname, _options, callback) => callback(null, target.address, target.family),
      }, response => {
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) { response.destroy(); reject(new Error('Integration redirects require a separately validated endpoint.')); return; }
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(response.headers)) if (value !== undefined) responseHeaders.set(name, Array.isArray(value) ? value.join(', ') : value);
        // Native fetch normally decompresses, but this adapter never negotiates compression.
        const status = response.statusCode ?? 500;
        const body = [204, 205, 304].includes(status) || init.method === 'HEAD' ? null : Readable.toWeb(response) as ReadableStream<Uint8Array>;
        if (body === null) response.resume();
        resolve(new Response(body, { status, headers: responseHeaders }));
      });
      request.once('error', () => reject(new Error('Integration network request could not complete.')));
      if (init.body) request.write(init.body instanceof URLSearchParams ? init.body.toString() : init.body);
      request.end();
    });
  };
}
function blocked(address: string, explicitLoopback: boolean, allowPrivate: boolean): boolean {
  let normalized = address.toLowerCase();
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(normalized);
  if (mapped) {
    const high = parseInt(mapped[1]!, 16), low = parseInt(mapped[2]!, 16);
    normalized = `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  } else normalized = normalized.replace(/^::ffff:/, '');
  if (isIP(normalized) === 4) {
    const [a, b] = normalized.split('.').map(Number);
    if (a === 169 && b === 254 || a === 0 || a! >= 224) return true;
    if (a === 127) return !explicitLoopback;
    return !allowPrivate && (a === 10 || a === 172 && b! >= 16 && b! <= 31 || a === 192 && b === 168 || a === 100 && b! >= 64 && b! <= 127);
  }
  if (normalized === '::1') return !explicitLoopback;
  if (normalized === '::' || /^fe[89ab]/.test(normalized) || normalized.startsWith('ff')) return true;
  if (/^f[cd]/.test(normalized)) return !allowPrivate;
  // Other special IPv6 ranges (including NAT64 and IPv4-compatible forms) are
  // outside the public provider boundary; prevent embedded-address bypasses.
  return !/^[23][0-9a-f]{3}:/.test(normalized);
}
