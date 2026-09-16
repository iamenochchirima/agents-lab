import dns from "node:dns/promises";
import net from "node:net";

export interface BrowserUrlPolicyOptions {
  readonly allowedLocalHosts?: readonly string[];
  readonly maxUrlLength?: number;
  readonly dnsLookup?: BrowserDnsLookup;
}

export type BrowserDnsLookup = (hostname: string) => Promise<readonly string[]>;

export interface AllowedBrowserUrl {
  readonly ok: true;
  readonly url: string;
  readonly hostname: string;
  readonly local: boolean;
}

export type BrowserUrlDecision = AllowedBrowserUrl;

const DEFAULT_MAX_URL_LENGTH = 2_048;
const DEFAULT_ALLOWED_SCHEMES = new Set(["http:", "https:"]);
const METADATA_IPV4 = "169.254.169.254";

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/u, "");
}

function parseIpv4(address: string): readonly number[] | undefined {
  if (net.isIP(address) !== 4) return undefined;
  const parts = address.split(".").map((part) => Number(part));
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parts
    : undefined;
}

function isPrivateIpv4(address: string): boolean {
  const parts = parseIpv4(address);
  if (!parts) return false;
  const [first, second] = parts;
  return (
    first === 10 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224
  );
}

function isPrivateIpv6(address: string): boolean {
  if (net.isIP(address) !== 6) return false;
  const normalized = address.toLowerCase().split("%", 1)[0];
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return true;
  if (normalized.startsWith("ff")) return true;
  const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/u)?.[1];
  return mappedIpv4 ? isPrivateIpv4(mappedIpv4) : false;
}

function isPrivateAddress(address: string): boolean {
  return isPrivateIpv4(address) || isPrivateIpv6(address);
}

function isCloudMetadataAddress(address: string): boolean {
  return address === METADATA_IPV4 || address.toLowerCase() === "fe80::a9fe:a9fe";
}

async function resolveAddresses(hostname: string): Promise<readonly string[]> {
  if (net.isIP(hostname) !== 0) return [hostname];
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

/**
 * Validates browser navigation targets before the browser adapter sees them.
 *
 * The policy deliberately has one narrow interface: callers provide a URL and receive
 * either a normalized allowed target or an actionable rejection. DNS lookup is injected
 * only at this seam so tests can exercise private-address and DNS-rebinding cases without
 * contacting the network.
 */
export class BrowserUrlPolicy {
  private readonly allowedLocalHosts: ReadonlySet<string>;
  private readonly maxUrlLength: number;
  private readonly dnsLookup: BrowserDnsLookup;

  constructor(options: BrowserUrlPolicyOptions = {}) {
    this.allowedLocalHosts = new Set((options.allowedLocalHosts ?? []).map(normalizeHost));
    this.maxUrlLength = options.maxUrlLength ?? DEFAULT_MAX_URL_LENGTH;
    this.dnsLookup = options.dnsLookup ?? resolveAddresses;
  }

  async validate(rawUrl: string): Promise<BrowserUrlDecision> {
    if (typeof rawUrl !== "string" || rawUrl.trim().length === 0) {
      throw new Error("A browser URL is required.");
    }
    if (rawUrl.length > this.maxUrlLength) {
      throw new Error(`Browser URL exceeds the ${this.maxUrlLength}-character limit.`);
    }

    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new Error("Browser URL is invalid.");
    }
    if (!DEFAULT_ALLOWED_SCHEMES.has(parsed.protocol)) {
      throw new Error("Only http and https browser URLs are allowed.");
    }
    if (parsed.username || parsed.password) {
      throw new Error("Browser URLs must not contain embedded credentials.");
    }

    const hostname = normalizeHost(parsed.hostname);
    if (hostname.length === 0) throw new Error("Browser URL must include a hostname.");
    let addresses: readonly string[];
    try {
      addresses = await this.dnsLookup(hostname);
    } catch {
      throw new Error("Browser URL hostname could not be resolved safely.");
    }
    const metadata = addresses.some(isCloudMetadataAddress) || isCloudMetadataAddress(hostname);
    if (metadata) throw new Error("Browser navigation to a cloud metadata address is blocked.");

    const local = this.allowedLocalHosts.has(hostname);
    const privateTarget = isPrivateAddress(hostname) || addresses.some(isPrivateAddress);
    if (privateTarget && !local) {
      throw new Error("Browser navigation to a private or internal address is blocked.");
    }

    return { ok: true, url: parsed.toString(), hostname, local };
  }

  async validateRedirect(fromUrl: string, toUrl: string): Promise<BrowserUrlDecision> {
    const from = await this.validate(fromUrl);
    const target = await this.validate(toUrl);
    if (new URL(from.url).protocol === "https:" && new URL(target.url).protocol === "http:") {
      throw new Error("HTTPS navigation cannot redirect to HTTP.");
    }
    return target;
  }
}
