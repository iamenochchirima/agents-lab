import { createHash, randomUUID } from 'node:crypto';
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { ManagedRepository, ManagedRevisionConflict } from './repository.js';
import { emptyManagedState, validateManagedState, type ManagedState, type ManagedConnectionRecord, type ManagedPackageRecord, type ManagedProfileRecord } from './records.js';
import { EncryptedCredentialStore, type CredentialBinding, type CredentialSecret } from './credentials.js';
import { IntegrationNetworkPolicy } from './network-policy.js';
import { ConnectionManager, type ConnectionDefinition } from '../integrations/connections.js';
import type { OAuthTokenSet, SecretStore } from '../integrations/oauth/flow.js';
import { EncryptedFileSecretStore } from '../integrations/oauth/encrypted-file-store.js';
import { loadCapabilityPackageRecords, type LoadedCapabilityPackages, type PackageConnectionResolver } from '../extensions/packages.js';
import { createPackageCapabilityCatalog } from '../extensions/catalog.js';
import { CapabilityCatalog, type CapabilityProfile } from '../catalog.js';
import { CapabilityHost } from '../extensions/host.js';
import { loadMcpSource } from '../extensions/connected-sources.js';
import type { HostedToolContribution } from '../extensions/contracts.js';
import { skillContributions } from '../extensions/skills.js';
import { digest, toolName } from '../extensions/package-utils.js';
import { discoverHttpMcp } from './mcp-discovery.js';
import { StdioMcpServer } from '../integrations/mcp/stdio-server.js';
import type { McpToolManifest } from '../integrations/mcp/local-transport.js';
import { PackageInstaller } from './installations.js';
import { discoverMcpOAuth, selectMcpOAuthClient } from './oauth-discovery.js';

export class CapabilitySetupRequired extends Error {}

export interface CapabilityManagementOptions {
  root: string; seedPath?: string; legacyOAuthRoot?: string; environment?: NodeJS.ProcessEnv;
  connectedEnabled?: boolean;
}
/** Application owner for validated records, secret bindings and catalog publication.
 * Browser payloads must pass managed record validation before source construction.
 * One repository writer owns administration. Native agents only see admitted data.
 */
export class CapabilityManagement {
  readonly repository: ManagedRepository;
  readonly credentials?: EncryptedCredentialStore;
  readonly connections: ConnectionManager;
  readonly installer: PackageInstaller;
  readonly network: IntegrationNetworkPolicy;
  loaded: LoadedCapabilityPackages = { tools: [], profiles: [], packages: [], resolveSkillContexts: async () => [] };
  private host?: CapabilityHost;
  private catalog?: CapabilityCatalog;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly discovery = new Map<string, readonly McpToolManifest[]>();
  private readonly environment: NodeJS.ProcessEnv;
  private synchronizeCredentialDefinitions: () => void = () => undefined;
  private constructor(readonly options: CapabilityManagementOptions, repository: ManagedRepository, credentials: EncryptedCredentialStore | undefined, connections: ConnectionManager, network: IntegrationNetworkPolicy) {
    this.repository = repository; this.credentials = credentials; this.connections = connections;
    this.network = network; this.installer = new PackageInstaller(join(options.root, 'installed'));
    this.environment = options.environment ?? process.env;
  }
  static async create(options: CapabilityManagementOptions): Promise<CapabilityManagement> {
    const environment = options.environment ?? process.env;
    const repository = await ManagedRepository.open(join(options.root, 'registry'));
    try {
      if (repository.read().revision === 0 && options.seedPath) {
        const bytes = await readFile(options.seedPath);
        if (bytes.length > 256 * 1024) throw new Error('Capability seed exceeds its size limit.');
        const seed = JSON.parse(bytes.toString()) as { packages: Record<string, unknown>[]; profiles?: { id: string; version: string; packages: string[] }[]; connections?: ConnectionDefinition[] };
        const state = emptyManagedState();
        state.connections = (seed.connections ?? []).map(connection => ({ ...connection, owner: 'local-workspace', enabled: connection.enabled !== false })) as ManagedConnectionRecord[];
        state.packages = seed.packages.map(pkg => ({ ...pkg, ...(pkg.source === 'skills' ? { root: resolve(dirname(options.seedPath!), String(pkg.root)) } : {}) })) as ManagedPackageRecord[];
        state.profiles = (seed.profiles ?? []).map(profile => ({ ...profile, displayName: profile.id }));
        validateManagedState(state);
        await repository.importSeed(state);
      }
      let credentials: EncryptedCredentialStore | undefined;
      if (environment.AGENTLAB_CREDENTIAL_KEY_HEX || environment.AGENTLAB_CREDENTIAL_KEYRING_JSON || environment.AGENTLAB_OAUTH_SECRET_KEY_HEX) credentials = EncryptedCredentialStore.fromEnvironment(join(options.root, 'credentials'), environment);
      const network = new IntegrationNetworkPolicy((environment.AGENTLAB_CAPABILITY_PRIVATE_HOSTS ?? '').split(',').map(value => value.trim()).filter(Boolean));
      const credentialDefinitions = new Map(repository.read().connections.map(connection => [connection.ref, connection]));
      const synchronizeCredentialDefinitions = () => {
        credentialDefinitions.clear();
        for (const connection of repository.read().connections) credentialDefinitions.set(connection.ref, connection);
      };
      const definition = (ref: string) => {
        // ConnectionManager closes and drains the old authority before deleting
        // its tokens. Keep that old binding until applyDefinitions completes,
        // even though the repository has already published replacement metadata.
        const value = credentialDefinitions.get(ref);
        if (!value) throw new Error('Connection is not managed.'); return value;
      };
      const binding = (connection: ManagedConnectionRecord, purpose: string): CredentialBinding => ({ ownerId: connection.owner, connectionId: connection.ref, resource: connection.resource, purpose });
      const tokenId = (connection: ManagedConnectionRecord) => `oauth_${createHash('sha256').update(JSON.stringify(binding(connection, 'oauth-grant'))).digest('hex').slice(0, 40)}`;
      let legacy: EncryptedFileSecretStore | undefined;
      if (options.legacyOAuthRoot && environment.AGENTLAB_OAUTH_SECRET_KEY_HEX) legacy = EncryptedFileSecretStore.fromEnvironment(options.legacyOAuthRoot, environment);
      const invalidatedLegacyRefs = new Set<string>();
      if (legacy) {
        // Legacy files authenticate a reference, but carry no resource binding.
        // Published history can establish that a reference changed resources;
        // such a token must be discarded rather than rebound during recovery.
        const current = repository.read().connections;
        for (const generation of await repository.readGenerations()) for (const old of generation.connections) {
          const latest = current.find(connection => connection.ref === old.ref);
          if (!latest || latest.resource !== old.resource || latest.owner !== old.owner) invalidatedLegacyRefs.add(old.ref);
        }
        for (const ref of invalidatedLegacyRefs) await legacy.delete(ref);
      }
      const secrets: SecretStore | undefined = credentials ? {
        read: async ref => {
          const connection = definition(ref), id = tokenId(connection);
          let secret = await credentials.get(id, binding(connection, 'oauth-grant'));
          if (!secret && legacy && !invalidatedLegacyRefs.has(ref)) {
            const old = await legacy.read(ref);
            if (old) { await credentials.upsert(id, binding(connection, 'oauth-grant'), { kind: 'oauth-tokens', ...old }); await legacy.delete(ref); secret = { kind: 'oauth-tokens', ...old }; }
          }
          if (!secret) return null;
          if (secret.kind !== 'oauth-tokens') throw new Error('OAuth credential type does not match.');
          return { accessToken: secret.accessToken, refreshToken: secret.refreshToken, expiresAt: secret.expiresAt, scopes: [...secret.scopes] } as OAuthTokenSet;
        },
        write: async (ref, tokens) => { const connection = definition(ref); await credentials.upsert(tokenId(connection), binding(connection, 'oauth-grant'), { kind: 'oauth-tokens', ...tokens }); },
        delete: async ref => { const connection = definition(ref); await credentials.delete(tokenId(connection), binding(connection, 'oauth-grant')); await legacy?.delete(ref); },
      } : undefined;
      const connections = await ConnectionManager.create(repository.read().connections as ConnectionDefinition[], {
        stateRoot: join(options.root, 'authority'), secrets, environment, fetchImplementation: network.fetch,
        ...(!credentials ? { oauthUnavailableReason: 'Configure the deployment credential encryption key before saving credentials or connecting OAuth.' } : {}),
        resolveStoredHeaders: async (config, signal) => {
          signal.throwIfAborted(); if (!credentials || config.auth.kind !== 'stored') throw new Error('Saved credentials are unavailable.');
          const connection = definition(config.ref);
          const secret = await credentials.get(config.auth.credentialRef, binding(connection, 'connection-auth'));
          if (!secret) throw new Error('Connection credentials are missing.');
          if (secret.kind === 'personal-access-token') {
            if (secret.expiresAt && Date.parse(secret.expiresAt) <= Date.now()) throw new Error('Connection token expired. Replace it to reconnect.');
            return { Authorization: `Bearer ${secret.token}` };
          }
          if (secret.kind === 'static-headers') return secret.headers;
          throw new Error('Connection credential type does not match.');
        },
        resolveClientSecret: async config => {
          if (!credentials || config.auth.kind !== 'oauth' || !config.auth.clientSecretRef) throw new Error('OAuth client credential is unavailable.');
          const secret = await credentials.get(config.auth.clientSecretRef, binding(definition(config.ref), 'oauth-client'));
          if (!secret || secret.kind !== 'oauth-client' || secret.clientId !== config.auth.clientId) throw new Error('OAuth client credential does not match.');
          return secret.clientSecret;
        },
      });
      const service = new CapabilityManagement(options, repository, credentials, connections, network);
      service.synchronizeCredentialDefinitions = synchronizeCredentialDefinitions;
      await repository.reconcileOperations(async () => 'abandoned');
      await service.reload(); return service;
    } catch (error) { await repository.close(); throw error; }
  }
  attach(host: CapabilityHost, catalog: CapabilityCatalog): void { this.host = host; this.catalog = catalog; }
  async close(): Promise<void> { await this.queue.catch(() => undefined); await this.repository.close(); }
  async view() {
    const state = this.repository.read();
    const summaries = await this.connections.summaries();
    const skillsByPackage = Object.fromEntries(this.loaded.packages.map(pkg => [pkg.id, pkg.skills.map(skill => ({ ...skill, id: `${pkg.id}:${skill.name}` }))]));
    for (const pkg of state.packages) if (pkg.source === 'skills' && !skillsByPackage[pkg.id]) {
      const inspected = await skillContributions({ id: pkg.id, version: pkg.version }, pkg.root);
      skillsByPackage[pkg.id] = inspected.skills.map(skill => ({ ...skill, id: `${pkg.id}:${skill.name}` }));
    }
    const connections = await Promise.all(state.connections.map(async connection => {
      let credential: { present: boolean; externallyManaged?: boolean; kind?: string; updatedAt?: string; expiresAt: string | null; expirySource?: 'user' | 'provider' | null } = { present: false, expiresAt: null };
      if (connection.auth.kind === 'static') credential = { present: Object.values(connection.auth.headersEnv).every(ref => !!this.environment[ref]), externallyManaged: true, expiresAt: null };
      else if (this.credentials) {
        const purpose = connection.auth.kind === 'oauth' ? 'oauth-grant' : 'connection-auth';
        const id = connection.auth.kind === 'stored' ? connection.auth.credentialRef : connection.auth.kind === 'oauth'
          ? `oauth_${createHash('sha256').update(JSON.stringify(this.credentialBinding(connection, purpose))).digest('hex').slice(0, 40)}` : undefined;
        if (id) {
          try {
            const saved = await this.credentials.summary(id, this.credentialBinding(connection, purpose));
            if (saved) { const { id: _id, ...safe } = saved; credential = safe; }
          } catch { /* Summary errors reveal absence/unavailability, never secret-store details. */ }
        }
      }
      let clientCredential: { present: boolean; externallyManaged?: boolean } | undefined;
      if (connection.auth.kind === 'oauth') {
        clientCredential = { present: false };
        if (connection.auth.clientSecretEnv) clientCredential = { present: !!this.environment[connection.auth.clientSecretEnv], externallyManaged: true };
        else if (connection.auth.clientSecretRef && this.credentials) {
          try { clientCredential.present = !!await this.credentials.summary(connection.auth.clientSecretRef, this.credentialBinding(connection, 'oauth-client')); } catch { /* Keep credential diagnostics masked. */ }
        }
      }
      return { ...connection, ...summaries.find(summary => summary.ref === connection.ref), credential, ...(clientCredential ? { clientCredential } : {}) };
    }));
    return { ...state, connections,
      credentialStorageAvailable: !!this.credentials, stdioAvailable: true,
      discovery: Object.fromEntries(this.discovery),
      capabilitiesByPackage: Object.fromEntries(this.loaded.packages.map(pkg => [pkg.id, this.loaded.tools.filter(tool => tool.descriptor.source.id === pkg.id).map(tool => ({ name: tool.descriptor.definition.name, description: tool.descriptor.definition.description, riskClass: tool.descriptor.definition.riskClass, approvalMode: tool.descriptor.definition.approvalMode }))])),
      skillsByPackage,
    };
  }
  async saveConnection(expectedRevision: number, input: ManagedConnectionRecord, credential?: CredentialSecret) {
    return this.serial(async () => {
      const connection = structuredClone(input), current = this.repository.read();
      if (expectedRevision !== current.revision) throw new ManagedRevisionConflict(expectedRevision, current.revision);
      if (connection.owner !== 'local-workspace') throw new Error('Connection must belong to the local workspace.');
      await this.network.destination(connection.resource);
      if (connection.auth.kind === 'oauth' && connection.auth.clientId === 'auto') {
        const auth = connection.auth;
        if (!auth.discovery) throw new Error('Automatic OAuth requires an explicitly trusted authorization issuer.');
        const metadata = await discoverMcpOAuth({ resource: connection.resource, allowedIssuers: auth.discovery.allowedIssuers, requestedScopes: connection.scopes, fetchImplementation: this.network.fetch }, AbortSignal.timeout(15000));
        const selected = await selectMcpOAuthClient({ metadata, redirectUri: auth.redirectUri, clientMetadataUrl: auth.clientMetadataUrl, fetchImplementation: this.network.fetch }, AbortSignal.timeout(15000));
        if (selected.kind !== 'ready') throw new CapabilitySetupRequired(selected.reason);
        Object.assign(auth, { clientId: selected.clientId, issuer: metadata.issuer, authorizationEndpoint: metadata.authorizationEndpoint, tokenEndpoint: metadata.tokenEndpoint, ...(metadata.revocationEndpoint ? { revocationEndpoint: metadata.revocationEndpoint } : {}) });
        if (selected.clientSecret) credential = { kind: 'oauth-client', clientId: selected.clientId, clientSecret: selected.clientSecret };
      }
      const candidate = structuredClone(current); upsert(candidate.connections, connection, 'ref'); validateManagedState(candidate);
      let createdId: string | undefined;
      try {
        if (credential) {
          if (!this.credentials) throw new Error('Saved credentials require a deployment encryption key.');
          const purpose = credential.kind === 'oauth-client' ? 'oauth-client' : 'connection-auth';
          if (credential.kind === 'oauth-tokens') throw new Error('OAuth grants are managed through authorization.');
          const stored = await this.credentials.put(this.credentialBinding(connection, purpose), credential); createdId = stored.id;
          if (credential.kind === 'oauth-client') {
            if (connection.auth.kind !== 'oauth' || connection.auth.clientId !== credential.clientId) throw new Error('OAuth client identity differs from connection.');
            connection.auth.clientSecretRef = stored.id;
          } else connection.auth = { kind: 'stored', credentialRef: stored.id };
        }
        await this.repository.mutate(expectedRevision, draft => { upsert(draft.connections, connection, 'ref'); });
      } catch (error) { if (createdId) await this.credentials!.delete(createdId, this.credentialBinding(connection, credential!.kind === 'oauth-client' ? 'oauth-client' : 'connection-auth')); throw error; }
      await this.reload(); return this.view();
    });
  }
  async savePackage(expectedRevision: number, input: ManagedPackageRecord, environment?: Record<string, string>) {
    return this.serial(async () => {
      if (input.source === 'skills') {
        const skillInput = input;
        const installed = this.repository.read().installations.some(item => item.packageIds.includes(skillInput.id) && resolve(skillInput.root).startsWith(resolve(item.root) + '/'));
        const existing = this.repository.read().packages.find(item => item.id === input.id);
        if (!installed && !(existing?.source === 'skills' && existing.root === input.root)) throw new Error('Import skills through the package installer.');
      }
      if (input.source === 'stdio' && input.cwd) throw new Error('Managed process working directories are assigned by the integration host.');
      if (input.source === 'mcp') await this.network.destination(input.endpoint);
      if (input.source === 'http') await this.network.destination(input.baseUrl);
      const created: { id: string; binding: CredentialBinding }[] = [];
      try {
        if (environment && Object.keys(environment).length) {
          if (!this.credentials || input.source !== 'stdio' || Object.keys(environment).length > 32) throw new Error('Saved process credentials require a configured secret store.');
          input = structuredClone(input);
          for (const [name, value] of Object.entries(environment)) {
            if (!/^[A-Z][A-Z0-9_]{0,127}$/.test(name)) throw new Error('Invalid process environment name.');
            const binding = { ownerId: 'local-workspace', connectionId: input.id, resource: `stdio://${input.id}`, purpose: `process-env:${name}` };
            const stored = await this.credentials.put(binding, { kind: 'personal-access-token', token: value });
            created.push({ id: stored.id, binding });
            input.envCredentialRefs = { ...input.envCredentialRefs, [name]: stored.id };
          }
        }
        await this.repository.mutate(expectedRevision, async draft => { upsert(draft.packages, input, 'id'); validateManagedState(draft); createPackageCapabilityCatalog(await this.load(draft), this.options.connectedEnabled); });
      } catch (error) { for (const credential of created) await this.credentials!.delete(credential.id, credential.binding); throw error; }
      await this.reload(); return this.view();
    });
  }
  async saveProfile(expectedRevision: number, profile: ManagedProfileRecord) {
    return this.serial(async () => { await this.repository.mutate(expectedRevision, async draft => {
      upsert(draft.profiles, profile, 'id'); validateManagedState(draft); createPackageCapabilityCatalog(await this.load(draft), this.options.connectedEnabled);
    }); await this.reload(); return this.view(); });
  }
  async remove(expectedRevision: number, kind: 'connections' | 'packages' | 'profiles' | 'installations', id: string) {
    return this.serial(async () => {
      const current = this.repository.read();
      if (expectedRevision !== current.revision) throw new ManagedRevisionConflict(expectedRevision, current.revision);
      if (kind === 'connections' && current.packages.some(pkg => 'connectionRef' in pkg && pkg.connectionRef === id)) throw new Error('Remove or rebind dependent tool packages before deleting this connection.');
      if (kind === 'packages' && current.profiles.some(profile => profile.packages.includes(id))) throw new Error('Remove this package from dependent profiles before deletion.');
      if (kind === 'installations') {
        const item = current.installations.find(item => item.id === id);
        if (current.installations.some(item => item.dependencies.some(dependency => dependency.id === id)) || current.profiles.some(profile => item?.packageIds.some(pkg => profile.packages.includes(pkg)))) throw new Error('Remove dependent profiles or bundles before uninstalling.');
      }
      if (kind === 'connections') await this.connections.revoke(id);
      await this.repository.mutate(expectedRevision, draft => {
        if (kind === 'connections') draft.connections = draft.connections.filter(item => item.ref !== id);
        else if (kind === 'profiles') draft.profiles = draft.profiles.filter(item => item.id !== id);
        else if (kind === 'packages') draft.packages = draft.packages.filter(item => item.id !== id);
        else { const item = draft.installations.find(item => item.id === id); draft.packages = draft.packages.filter(pkg => !item?.packageIds.includes(pkg.id)); draft.installations = draft.installations.filter(item => item.id !== id); }
      }); await this.reload(); return this.view();
    });
  }
  async connectionAction(ref: string, action: 'connect' | 'refresh' | 'revoke' | 'discover') {
    return this.serial(async () => {
      let authorizationUrl: string | undefined;
      if (action === 'connect') authorizationUrl = (await this.connections.connect(ref)).authorizationUrl;
      else if (action === 'revoke') await this.connections.revoke(ref);
      else if (action === 'refresh') await this.connections.refresh(ref);
      let tools: readonly McpToolManifest[] | undefined;
      if (action === 'discover') {
        const connection = this.repository.read().connections.find(value => value.ref === ref);
        if (!connection) throw new Error('Connection not found.');
        const binding = await this.connections.binding(ref);
        const discovered = await discoverHttpMcp({ endpoint: connection.resource, resolveHeaders: binding.resolveHeaders, fetchImplementation: this.network.fetch, maxResponseBytes: 4 * 1024 * 1024 }, AbortSignal.timeout(30000));
        tools = discovered.tools;
        this.discovery.set(ref, tools);
        const state = this.repository.read();
        const id = `mcp-${ref.replace(/^conn_/, '').replaceAll('_', '-').slice(0, 32)}`;
        if (!state.packages.some(pkg => 'connectionRef' in pkg && pkg.connectionRef === ref && pkg.source === 'mcp')) {
          await this.repository.mutate(state.revision, draft => { draft.packages.push({ id, version: '1.0.0', source: 'mcp', endpoint: connection.resource, connectionRef: ref, protocolVersion: discovered.protocolVersion, tools: tools!.map(tool => ({ remoteName: tool.name, name: toolName(id, tool.name), riskClass: 'external', approvalMode: 'invocation' })) }); });
        }
      }
      await this.reload(); return { state: await this.view(), ...(authorizationUrl ? { authorizationUrl } : {}), ...(tools ? { tools } : {}) };
    });
  }
  async inspectSkill(packageId: string, name: string) {
    const pkg = this.repository.read().packages.find(value => value.id === packageId);
    if (!pkg || pkg.source !== 'skills') throw new Error('Skill package not found.');
    return (await skillContributions({ id: pkg.id, version: pkg.version }, pkg.root)).inspect(name);
  }
  async previewInstallation(input: { archiveBase64?: string; repositoryUrl?: string; commit?: string; id?: string; version?: string }) {
    const installed = this.repository.read().installations;
    const identity = input.id && input.version ? { id: input.id, version: input.version } : undefined;
    if (input.archiveBase64 && !input.repositoryUrl) return this.installer.previewZip(decodeArchive(input.archiveBase64), installed, identity);
    if (input.repositoryUrl && input.commit && !input.archiveBase64) { await this.network.destination(input.repositoryUrl); return this.installer.previewGit({ url: input.repositoryUrl, commit: input.commit }, installed, identity); }
    throw new Error('Choose a ZIP upload or pinned Git source.');
  }
  async install(expectedRevision: number, input: { archiveBase64?: string; repositoryUrl?: string; commit?: string; id?: string; version?: string }) {
    return this.serial(async () => {
      const current = this.repository.read(); if (current.revision !== expectedRevision) throw new ManagedRevisionConflict(expectedRevision, current.revision);
      await this.previewInstallation(input);
      const operationId = `install_${randomUUID()}`; const identity = input.id && input.version ? { id: input.id, version: input.version } : undefined;
      const staged = await this.repository.mutate(expectedRevision, draft => { draft.operations.push({ id: operationId, kind: 'install', status: 'staged', resourceRef: input.id ?? 'bundle', startedAt: new Date().toISOString() }); });
      try {
        const prepared = input.archiveBase64 ? await this.installer.installZip(decodeArchive(input.archiveBase64), current.installations, identity) : await this.installer.importGit({ url: input.repositoryUrl!, commit: input.commit! }, current.installations, identity);
        await this.repository.mutate(staged.revision, async draft => {
          for (const connection of prepared.connections) if (!draft.connections.some(value => value.ref === connection.ref)) draft.connections.push(connection);
          upsert(draft.installations, prepared.installation, 'id'); for (const pkg of prepared.packages) upsert(draft.packages, pkg, 'id');
          const operation = draft.operations.find(value => value.id === operationId)!; operation.status = 'committed'; operation.resourceRef = prepared.installation.id;
          validateManagedState(draft); createPackageCapabilityCatalog(await this.load(draft), this.options.connectedEnabled);
        }); await this.reload(); return this.view();
      } catch (error) { await this.repository.mutate(this.repository.read().revision, draft => { draft.operations.find(value => value.id === operationId)!.status = 'abandoned'; }); throw error; }
    });
  }
  async reload(): Promise<void> {
    await this.connections.applyDefinitions(this.repository.read().connections as ConnectionDefinition[]);
    this.synchronizeCredentialDefinitions();
    await this.reconcileCredentialReferences();
    const current = await this.load(this.repository.read());
    // Atomic catalog validation happens before swapping live owners.
    const catalog = createPackageCapabilityCatalog(current, this.options.connectedEnabled);
    const historical: HostedToolContribution[] = [];
    for (const generation of await this.repository.readGenerations()) {
      if (generation.revision === this.repository.read().revision) continue;
      try { historical.push(...(await this.load(generation)).tools); } catch { /* Historical evidence remains inspectable when a retired provider cannot be reconstructed. */ }
    }
    this.host?.replace([...historical, ...current.tools]); this.catalog?.replace(catalog); this.loaded = current;
    for (const connection of this.repository.read().connections) this.connections.reportSourceAvailability(connection.ref, null);
    for (const pkg of current.packages) if (pkg.connectionRef && pkg.unavailableReason) this.connections.reportSourceAvailability(pkg.connectionRef, pkg.unavailableReason);
  }
  private async reconcileCredentialReferences(): Promise<void> {
    if (!this.credentials) return;
    const state = this.repository.read(), references = new Set<string>();
    for (const connection of state.connections) {
      if (connection.auth.kind === 'stored') references.add(connection.auth.credentialRef);
      else if (connection.auth.kind === 'oauth') {
        if (connection.auth.clientSecretRef) references.add(connection.auth.clientSecretRef);
        if (connection.auth.tokenCredentialRef) references.add(connection.auth.tokenCredentialRef);
        references.add(`oauth_${createHash('sha256').update(JSON.stringify(this.credentialBinding(connection, 'oauth-grant'))).digest('hex').slice(0, 40)}`);
      }
    }
    for (const pkg of state.packages) if (pkg.source === 'stdio') for (const ref of Object.values(pkg.envCredentialRefs ?? {})) references.add(ref);
    // Published authority, including disabled connections, owns credential
    // retention. Immutable historical generations cannot restore retired grants.
    await this.credentials.reconcileReferences(references);
  }
  private async load(state: ManagedState): Promise<LoadedCapabilityPackages> {
    const enabled = state.packages.filter(pkg => pkg.enabled !== false);
    for (const pkg of state.packages) {
      if (!('connectionRef' in pkg) || !pkg.connectionRef) continue;
      const connection = state.connections.find(value => value.ref === pkg.connectionRef);
      if (!connection) throw new Error('Package connection is unknown.');
      const target = pkg.source === 'mcp' ? pkg.endpoint : pkg.source === 'http' ? pkg.baseUrl : undefined;
      if (target) {
        const destination = new URL(target), resource = new URL(connection.resource);
        const rootPath = resource.pathname.replace(/\/$/, '');
        if (destination.origin !== resource.origin || (pkg.source === 'mcp' && destination.pathname !== resource.pathname && !destination.pathname.startsWith(rootPath + '/'))) throw new Error('Package endpoint does not match its credential resource.');
      }
    }
    const resolver: PackageConnectionResolver = {
      summary: ref => this.connections.summary(ref),
      binding: async ref => {
        const admitted = await this.connections.binding(ref);
        return { connection: admitted.connection, resolveHeaders: async signal => {
          const current = await this.connections.binding(ref);
          if (current.connection.authorityRevision !== admitted.connection.authorityRevision) throw new Error('Admitted connection access changed. Readmit this run.');
          return current.resolveHeaders(signal);
        } };
      },
    };
    const standard = enabled.filter(pkg => pkg.source !== 'stdio').map(pkg => {
      const { enabled: _enabled, displayName: _displayName, installationRef: _installationRef, ...value } = pkg;
      return value;
    });
    const loaded = standard.length ? await loadCapabilityPackageRecords({ schemaVersion: 1, packages: standard }, this.options.root, { connections: resolver, allowUnavailable: true, fetchImplementation: this.network.fetch }) : { tools: [], profiles: [], packages: [], resolveSkillContexts: async () => [] } as LoadedCapabilityPackages;
    for (const pkg of enabled.filter((pkg): pkg is Extract<ManagedPackageRecord, { source: 'stdio' }> => pkg.source === 'stdio')) {
      const cwd = join(this.options.root, 'processes', pkg.id); await mkdir(cwd, { recursive: true, mode: 0o700 });
      const env = Object.fromEntries(Object.entries(pkg.envRefs ?? {}).map(([name, variable]) => { const value = this.environment[variable]; if (!value) throw new Error('Configured process credential is unavailable.'); return [name, value]; }));
      for (const [name, id] of Object.entries(pkg.envCredentialRefs ?? {})) {
        if (!this.credentials) throw new Error('Process credential store is unavailable.');
        const secret = await this.credentials.get(id, { ownerId: 'local-workspace', connectionId: pkg.id, resource: `stdio://${pkg.id}`, purpose: `process-env:${name}` });
        if (!secret || secret.kind !== 'personal-access-token') throw new Error('Process credential is unavailable.'); env[name] = secret.token;
      }
      try {
        const processDigest = digest(JSON.stringify(pkg));
        const authority = async (signal: AbortSignal) => {
          signal.throwIfAborted();
          const current = this.repository.read().packages.find(value => value.id === pkg.id && value.enabled !== false);
          if (!current || digest(JSON.stringify(current)) !== processDigest) throw new Error('Admitted process access changed. Readmit this run.');
          return {};
        };
        const tools = await loadMcpSource({ id: pkg.id, version: pkg.version, endpoint: `stdio://${pkg.id}`, tools: pkg.tools,
          implementationDigest: processDigest, resolveHeaders: authority,
          createServer: (_headers, onDispatch) => {
            const server = new StdioMcpServer({ executable: pkg.command, args: pkg.args, cwd, env, serverName: pkg.id, protocolVersion: pkg.protocolVersion, onDispatch });
            if (!onDispatch) return server; // Candidate discovery precedes publication.
            return {
              get serverName() { return server.serverName; }, get protocolVersion() { return server.protocolVersion; },
              get progressDiagnostics() { return server.progressDiagnostics; }, close: () => server.close(),
              listTools: async signal => { await authority(signal); return server.listTools(signal); },
              callToolResult: async (...args) => { await authority(args[3]); return server.callToolResult(...args); },
            };
          },
        });
        loaded.tools.push(...tools); loaded.packages.push({ id: pkg.id, version: pkg.version, source: 'stdio', digest: digest(JSON.stringify(tools.map(tool => tool.descriptor))), tools: tools.map(tool => tool.descriptor.definition.name), skills: [] });
      } catch { loaded.packages.push({ id: pkg.id, version: pkg.version, source: 'stdio', digest: digest(pkg.id), tools: [], skills: [], unavailableReason: 'Managed process unavailable. Check executable, pinned installation and environment.' }); }
    }
    for (const record of state.profiles) {
      for (const selection of record.tools ?? []) {
        const known = loaded.tools.find(tool => record.packages.includes(tool.descriptor.source.id) && tool.descriptor.definition.name === selection.name);
        if (known && selection.riskClass !== known.descriptor.definition.riskClass) throw new Error('Tool risk classification belongs to its package; profiles select approval policy.');
        if (!known && !record.packages.some(id => loaded.packages.some(pkg => pkg.id === id && pkg.unavailableReason))) throw new Error('Selected profile tool is unavailable or unknown.');
      }
      const selected = loaded.tools.filter(tool => record.packages.includes(tool.descriptor.source.id) && (record.tools === undefined || record.tools.some(selected => selected.name === tool.descriptor.definition.name && selected.enabled)));
      let tools = selected;
      const availableSkills = loaded.packages.filter(pkg => record.packages.includes(pkg.id)).flatMap(pkg => pkg.skills.map(skill => ({ ...skill, version: pkg.version, id: `${pkg.id}:${skill.name}` }))).filter(skill => record.skills === undefined || record.skills.includes(skill.id));
      if (record.skills !== undefined) {
        tools = selected.filter(tool => !enabled.some(pkg => pkg.source === 'skills' && pkg.id === tool.descriptor.source.id));
        for (const pkg of enabled.filter((pkg): pkg is Extract<ManagedPackageRecord, { source: 'skills' }> => pkg.source === 'skills' && record.packages.includes(pkg.id))) {
          const allowed = availableSkills.filter(skill => skill.id.startsWith(pkg.id + ':')).map(skill => skill.name);
          const scoped = await skillContributions({ id: pkg.id, version: pkg.version }, pkg.root, allowed);
          const namespaced = scoped.tools.map(tool => {
            const name = toolName(record.id, tool.descriptor.definition.name);
            const definition = { ...tool.descriptor.definition, name };
            return { ...tool, descriptor: { ...tool.descriptor, definition, source: { ...tool.descriptor.source, digest: digest(JSON.stringify({ descriptor: tool.descriptor, profile: record.id })) }, execution: { kind: 'hosted' as const, key: `${record.id}:${name}` } }, implementation: { ...tool.implementation, definition } };
          });
          loaded.tools.push(...namespaced); tools.push(...namespaced);
        }
      }
      const unavailable = record.packages.some(id => !loaded.packages.some(pkg => pkg.id === id && !pkg.unavailableReason));
      loaded.profiles.push({ ...makeProfile(record, tools), availableSkills, ...(unavailable ? { unavailableReason: 'A selected package is disabled or unavailable.' } : {}) });
    }
    return loaded;
  }
  credentialBinding(connection: ManagedConnectionRecord, purpose = 'connection-auth'): CredentialBinding { return { ownerId: connection.owner, connectionId: connection.ref, resource: connection.resource, purpose }; }
  private serial<T>(operation: () => Promise<T>): Promise<T> { const next = this.queue.catch(() => undefined).then(operation); this.queue = next; return next; }
}
function upsert<T>(items: T[], value: T, key: keyof T): void { const index = items.findIndex(item => item[key] === value[key]); if (index < 0) items.push(structuredClone(value)); else items[index] = structuredClone(value); }
function makeProfile(record: ManagedProfileRecord, tools: readonly HostedToolContribution[]): CapabilityProfile {
  return { id: record.id, version: record.version, displayName: record.displayName, description: record.description ?? 'Selected connected tools and skills.',
    policy: { schemaVersion: 1, policyId: record.id, version: record.version, allowedCapabilityIds: tools.map(tool => tool.descriptor.definition.name), allowedRiskClasses: ['pure', 'read', 'write', 'external'], requiredApprovalRiskClasses: [], allowedConnectionRefs: [...new Set(tools.flatMap(tool => tool.descriptor.connection ? [tool.descriptor.connection.ref] : []))], maxTimeoutMs: 120000, maxInputBytes: 1048576, maxOutputBytes: 1048576 },
    grants: tools.map(tool => { const { definition, source, connection } = tool.descriptor; const selection = record.tools?.find(selected => selected.name === definition.name); const mode = selection?.approvalMode ?? definition.approvalMode ?? (definition.riskClass === 'read' || definition.riskClass === 'pure' ? 'automatic' : 'invocation'); return { schemaVersion: 1, capabilityId: definition.name, version: source.version, enabled: true, allowedOperations: ['execute'], ...(connection ? { connectionRef: connection.ref } : {}), approvalMode: mode === 'invocation' ? 'invocation' : mode === 'tool_grant' ? 'required' : 'none', timeoutMs: definition.limits.timeoutMs, maxInputBytes: definition.limits.maxArgumentBytes, maxOutputBytes: definition.limits.maxResultBytes }; }),
  };
}

function decodeArchive(value: string): Buffer {
  if (value.length > 24 * 1024 * 1024 || !/^[a-zA-Z0-9+/]*={0,2}$/.test(value)) throw new Error('Invalid bounded ZIP upload.');
  return Buffer.from(value, 'base64');
}
