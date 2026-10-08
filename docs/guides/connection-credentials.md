# Connection credentials

The backend stores connection secrets separately from capability definitions and
run evidence. Its generic credential store supports custom headers, personal
access tokens, OAuth token sets and OAuth client credentials. Browser responses
contain presence and expiry metadata, never a token prefix or secret value.

Each encrypted record has an opaque ID. AES-256-GCM authenticates its version,
key ID, credential type, owner, connection ID, resource URL and purpose. Moving a
record to another connection or changing that metadata fails decryption. The
store directory is private with mode `0700`; its snapshot is `0600`.

## Configure a deployment key

Supply a random 32-byte key through the deployment's protected environment or
secret manager. `AGENTLAB_CREDENTIAL_KEY_HEX` accepts 64 hexadecimal characters.
`AGENTLAB_CREDENTIAL_KEY_ID` identifies the current key and defaults to `primary`.
The previous `AGENTLAB_OAUTH_SECRET_KEY_HEX` setting is accepted as a fallback
when the generic single-key setting is absent. Existing legacy OAuth record
files need explicit migration; configuring this fallback does not move them.
When the configured legacy reader migrates a token, published registry ancestry
must not show that its connection reference previously belonged to a different
resource. Legacy tokens lack resource binding; changed or removed references
have their legacy token discarded and require fresh authorization. This also
covers a restart after publishing a resource change before lifecycle cleanup.

For more than one key, supply `AGENTLAB_CREDENTIAL_KEYRING_JSON`, an object mapping
key IDs to hexadecimal keys. Key IDs contain letters, digits, underscores or
hyphens, with a maximum of 80 characters. Its format is:

```json
{"primary":"<64 hexadecimal characters>","replacement":"<64 hexadecimal characters>"}
```

The placeholders above are explanatory and will be rejected. Do not paste real
keys into documentation, source control, command arguments or run artifacts.
The current key ID must exist in the supplied keyring. If both a keyring and a
single key are supplied, their current-key values must agree. Missing or invalid
keys fail closed. There is no generated key beside the stored records and no
plaintext fallback.

OAuth expiry comes from the provider. A personal access token may have a
user-declared or provider-declared expiry; an opaque token without expiry remains
unknown. The store does not invent a refresh mechanism for personal access
tokens. Connection lifecycle code is responsible for revocation and serializing
OAuth refresh before saving a rotated refresh token.

After publishing configuration and during backend startup, the exclusive
management owner reconciles secret IDs against the current registry. This
atomically removes records left by interrupted setup, replacement or a retired
OAuth resource. Current stored credentials, client secrets, OAuth grant aliases
and process environment references remain retained, including disabled
connections. Historical run configurations retain evidence and implementations;
they cannot retain or restore revoked credentials. Reconciliation removes local
copies and does not establish that an external provider revoked its token.

## Rotate the master key

Use this offline command with the API stopped. One backend process owns the
credential directory; concurrent processes require a transactional external
secret service rather than this local file store.

1. Protect a new random key in the deployment secret manager. Retain the old key.
2. Supply both old and new keys in `AGENTLAB_CREDENTIAL_KEYRING_JSON`. Keep the
   current key ID set to the old key for this command.
3. From the repository root, run:

   ```sh
   pnpm --filter @agent-harness-lab/lab-server exec tsx src/capabilities/management/rotate-credentials.ts /absolute/path/to/credential-directory replacement
   ```

4. On success, set `AGENTLAB_CREDENTIAL_KEY_ID=replacement` and restart the API
   with the new keyring. Verify the saved connection works before removing the
   old key from active configuration.
5. Retain separately protected old keys while encrypted backups using those
   keys still need recovery.

Rotation decrypts and validates every existing record before staging new
ciphertext. One atomic rename publishes the complete snapshot. Failure before
publication leaves the old snapshot authoritative, including when one record
cannot be decrypted. Rotation does not retire or overwrite deployment keys.
Interrupted temporary files are not active snapshots. Atomic publication protects
against partial application; this store does not claim disk-loss durability.

## Backup and recovery

Ordinary capability exports must exclude secrets. An administrator can separately
back up the encrypted snapshot and protect its key through a different recovery
channel. Recovering ciphertext without the corresponding key is insufficient.
Encryption at rest does not protect against a compromised backend process that
already has the key and can read connection secrets.

Validation covers secret round trips after constructing a fresh store, owner and
resource binding, private file modes, masked summaries, wrong keys, ciphertext
tampering, successful rotation and aborting rotation when a record is corrupt.
