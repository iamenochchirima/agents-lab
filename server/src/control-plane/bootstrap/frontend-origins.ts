/** Frontend origins trusted by this deployment.
 * Local development treats the three explicit loopback hostnames as aliases,
 * keeping the configured protocol and port. Hosted origins remain exact: this
 * does not trust arbitrary local addresses, subdomains, other ports or schemes.
 */
export function trustedFrontendOrigins(configuredOrigin: string): string[] {
  const url = new URL(configuredOrigin);
  const loopbackHosts = ["localhost", "127.0.0.1", "[::1]"];
  if (!["http:", "https:"].includes(url.protocol) || !loopbackHosts.includes(url.hostname)) {
    return [configuredOrigin];
  }
  return [...new Set([configuredOrigin, ...loopbackHosts.map((hostname) => {
    const alias = new URL(url.origin);
    alias.hostname = hostname;
    return alias.origin;
  })])];
}
