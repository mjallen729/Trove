# Trove Security Audit Report

**Date:** January 11, 2026  
**Auditor:** Gemini Security Agent

## 1. Executive Summary

Trove implements a zero-knowledge, client-side encrypted cloud storage system. Its "accountless" architecture, relying on BIP39 seed phrases for identity and encryption, significantly reduces the attack surface for traditional credential theft. The implementation of cryptographic primitives (Argon2id, XChaCha20-Poly1305) is aligned with modern best practices.

However, the architectural decision to use a derived "Vault UID" as the sole authentication token (Bearer token) for the API introduces specific integrity risks if this ID is leaked. Additionally, the lack of rate limiting or authentication on resource creation (`INSERT`) policies exposes the system to Denial of Service (DoS) and database exhaustion attacks.

## 2. Architecture Review

- **Authentication**: No server-side sessions. Identity is derived from a 12/24-word BIP39 seed phrase.
- **Key Management**:
  - **Master Secret**: Derived via Argon2id (2 iterations, 16MB memory) using a fixed application salt.
  - **Encryption Key**: Derived from Master Secret via Blake2b (libsodium `crypto_kdf`). Never leaves the client.
  - **Vault UID**: SHA-256 hash of a separate derived key. Used as the database Primary Key and API authentication token.
- **Encryption**:
  - **Algorithm**: XChaCha20-Poly1305 (Authenticated Encryption).
  - **Scope**: Files (chunked), Filenames (in schema), Directory Structure.
  - **Nonce**: Random 24-byte nonce prepended to ciphertext.
- **Backend**: Supabase (PostgreSQL + Blob Storage) with Row Level Security (RLS).

## 3. Vulnerability Analysis

### 3.1. High Severity: Vault UID as Static Bearer Token

**Description:**
The `Vault UID` is sent in the `x-vault-uid` header for all API requests. The RLS policies grant full `UPDATE` and `DELETE` privileges to any request bearing this header.

```sql
CREATE POLICY "vaults_update_by_header" ON vaults
  FOR UPDATE
  USING (uid = current_setting('request.headers', true)::json->>'x-vault-uid');
```

**Risk:**
Since the `Vault UID` is deterministically derived from the seed phrase, it cannot be rotated without changing the seed phrase (migrating the vault). If this ID leaks (e.g., via a shared screenshot of network logs, malware, or logging infrastructure), an attacker can:

1.  **Destructive Access**: Overwrite the `schema_cipher` with garbage, effectively deleting the vault's contents.
2.  **Metadata Access**: List all files, view timestamps, and file sizes.
3.  **Upload Manipulation**: Insert fake files or delete pending uploads.

**Mitigation:**

- **Short-term**: Ensure strict logging policies (never log `x-vault-uid`).
- **Long-term**: Implement a challenge-response mechanism. The client should sign a timestamped challenge with a derived "Auth Key" (separate from Encryption Key), and the server should verify this signature. (Note: Difficult with standard Supabase RLS).

### 3.2. Medium Severity: Denial of Service via Public INSERTs

**Description:**
The RLS policies for `vaults` and `storage_transacts` allow public insertion without checks:

```sql
CREATE POLICY "vaults_insert_public" ON vaults FOR INSERT WITH CHECK (true);
CREATE POLICY "transacts_insert_public" ON storage_transacts FOR INSERT WITH CHECK (true);
```

**Risk:**
An attacker can flood the database with millions of junk vaults and storage transactions. This leads to:

1.  **Storage Exhaustion**: Database disk space fills up.
2.  **Performance Degradation**: Index sizes grow, slowing down lookups for legitimate users.
3.  **Cost Spikes**: Increased usage costs for the hosting provider.

**Mitigation:**

- Implement strict **Rate Limiting** on the `POST` endpoints at the infrastructure level (e.g., Supabase generic API limits or a proxy).
- Require a proof-of-work (client-side puzzle) or a CAPTCHA for vault creation.

### 3.3. Low Severity: Fixed Salt for Key Derivation

**Description:**
The application uses a hardcoded salt `trove-v1-salt-2024` for Argon2id derivation:

```typescript
const FIXED_SALT = "trove-v1-salt-2024";
```

**Risk:**
A fixed salt allows an attacker who gains access to the database (specifically the `uid` column) to build a single rainbow table targeting the entire user base.

- **Mitigating Factor**: BIP39 seed phrases provide high entropy (128-bit minimum). A rainbow table attack is infeasible against properly generated seeds.
- **Residual Risk**: Users manually importing weak/non-random "brain wallet" seeds are vulnerable.

**Mitigation:**

- Ideally, use per-vault random salts. However, this is difficult in an "accountless" model (where to retrieve the salt before deriving the key?).
- Enforce BIP39 checksum validation strictly in the UI (already implemented) to discourage manual text entry of non-standard phrases.

### 3.4. Low Severity: Memory Residency of Sensitive Data

**Description:**
`VaultContext` stores the decrypted `schema` (containing filenames) in React state. While encryption keys are stored in `useRef` and wiped on logout, the Javascript Garbage Collector (GC) manages the heap.

```typescript
// keys wiped:
await secureWipe(encryptionKeyRef.current);
// state reset:
dispatch({ type: "LOGOUT" });
```

Resetting state allows memory to be freed but does not overwrite it immediately. Copies of filenames may persist in memory.

**Risk:**
An attacker with local physical access or a browser exploit (e.g., core dump) could recover metadata.

**Mitigation:**

- Acceptable risk for a web application.
- Ensure `useRef` is used for the most critical data (keys), which is already done.

## 4. Code Quality & Best Practices

- **Good**: Usage of `libsodium` (WASM) for crypto guarantees constant-time operations and prevents side-channel attacks common in JS-based crypto libraries.
- **Good**: Strict CSP in `vercel.json` mitigates XSS risks.
- **Good**: Immediate key wiping on logout.
- **Good**: Authenticated encryption (Poly1305) ensures file integrity; tampering is detected upon decryption.

## 5. Conclusion

Trove achieves a high level of confidentiality through its client-side encryption model. The server cannot read user files. The primary security risks are operational (DoS) and integrity-related (Vault UID leakage). Addressing the public `INSERT` policies and considering a more robust authentication proof would significantly harden the application.

**Audit Status: PASSED (with warnings)**
The core cryptography is sound. The noted vulnerabilities are architectural trade-offs common in decentralized/accountless designs but require awareness and mitigation at the infrastructure layer.
