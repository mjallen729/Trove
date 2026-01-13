# Trove Implementation Specification v2

This document details the technical implementation decisions for Trove, a zero-knowledge anonymous cloud storage platform.

---

## Overview

Trove is a MEGA-like encrypted cloud storage platform that uses BIP39 seed phrases instead of user accounts. All encryption is client-side, zero-knowledge, and 256-bit. Target users include investigative journalists and whistleblowers who need secure, anonymous file storage.

**MVP Scope:**

- Free 5GB vaults (payments deferred to v2)
- Full upload/download with resumable uploads
- Folder structure support
- Burn timer functionality

---

## Tech Stack

| Layer              | Technology                         |
| ------------------ | ---------------------------------- |
| Frontend Framework | React 19 + Vite 7                  |
| Styling            | Tailwind CSS 4                     |
| State Management   | React Context + useReducer         |
| Routing            | React Router v6                    |
| Backend            | Supabase (Postgres + Blob Storage) |
| Cryptography       | libsodium-wrappers (WASM)          |
| BIP39              | bip39 (bitcoinjs)                  |
| Language           | TypeScript (strict mode)           |
| Hosting            | Vercel                             |

### Environment Variables

```env
# client/.env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### Dependencies

**Already installed:**

- `@supabase/supabase-js` - Supabase client
- `tailwindcss` + `@tailwindcss/vite` - Styling
- `react`, `react-dom` - React 19

**To install:**

```bash
npm install libsodium-wrappers bip39 react-router-dom
npm install -D @types/libsodium-wrappers
```

---

## Cryptography

### Key Derivation

1. **BIP39 Seed Phrases**: Support 12 or 24 word phrases (English wordlist only)
   - 12 words = 128-bit entropy
   - 24 words = 256-bit entropy

2. **KDF**: Argon2id for deriving master secret from seed phrase
   - **Light parameters** for better UX (~100ms target):
     - Memory: 16 MB (`16 * 1000 * 1000`)
     - Iterations: 2
     - Parallelism: 1
   - Salt: Fixed application-specific salt (e.g., `"trove-v1-salt-2024"`)

3. **Key Expansion**: libsodium's `crypto_kdf_derive_from_key` (Blake2b-based) to derive multiple keys from master secret:
   - `encryption_key`: 32 bytes for file/manifest encryption (context: `"trove_ek"`, subkey_id: 1)
   - `vault_uid`: SHA256 hash of a separate derivation (context: `"trove_id"`, subkey_id: 2)
   - Note: Using `crypto_kdf` instead of HKDF-SHA256 for simplicity; equally secure for this use case

### Encryption

- **Algorithm**: XChaCha20-Poly1305
  - 24-byte nonce (safe for random generation)
  - 16-byte authentication tag
  - No timing side-channels
- **Library**: `libsodium-wrappers` using `crypto_aead_xchacha20poly1305_ietf_*`
- **Nonce Storage**: Prepend 24-byte nonce to ciphertext (standard practice)
  - Encrypted chunk format: `[nonce (24 bytes)][ciphertext][auth tag (16 bytes)]`

### Chunk UID Derivation

- Deterministic: `chunk_uid = SHA256(file_uid || chunk_index)`
- No explicit chunk tracking needed in manifest
- File UID generated as random UUID on upload start

---

## File Handling

### Chunking

- **Chunk Size**: 5 MB
- Large files split into 5MB chunks before encryption
- Each chunk encrypted independently with random nonce
- **Concurrent uploads**: Up to 3 chunks/files uploading simultaneously

### Folder Upload Support

- Support drag-and-drop of entire folders
- Preserve folder structure in manifest
- Use `webkitdirectory` attribute and `DataTransferItem.webkitGetAsEntry()` for folder detection

### Manifest Structure

Flat array with parent references (document store pattern):

```typescript
interface ManifestEntry {
  id: string; // UUID
  name: string; // File/folder name (max 255 chars)
  type: "file" | "folder";
  parent: string | null; // Parent folder ID, null = root
  // File-specific fields:
  file_uid?: string; // UUID for blob storage lookup
  size?: number; // Original file size in bytes
  chunk_count?: number; // Number of chunks
  mime_type?: string; // MIME type for download
  created_at: string; // ISO timestamp
}

type VaultManifest = ManifestEntry[];
```

### Resumable Uploads

- **Server-tracked**: Separate `uploads` table tracks in-progress uploads
- **Resume flow**:
  1. Server stores: `upload_id`, `vault_uid`, `file_uid`, `total_chunks`, `received_chunks[]`, `created_at`
  2. On resume, client queries for received chunk indices
  3. User re-selects original file (plaintext not stored)
  4. Client encrypts and uploads only missing chunks
- **UX**: Incomplete files shown in vault with warning icon, click to resume

---

## Database Schema

### Supabase Tables

```sql
-- Main vault storage
CREATE TABLE vaults (
  uid TEXT PRIMARY KEY,           -- Hash derived from seed phrase
  manifest_cipher BYTEA NOT NULL, -- Encrypted vault manifest (nonce prepended)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  burn_at TIMESTAMPTZ,            -- When to auto-delete (NULL = never)
  storage_used BIGINT DEFAULT 0,  -- Bytes used
  storage_limit BIGINT DEFAULT 5368709120  -- 5GB default limit
);

-- Track in-progress uploads for resume
CREATE TABLE uploads (
  upload_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_uid TEXT NOT NULL REFERENCES vaults(uid) ON DELETE CASCADE,
  file_uid UUID NOT NULL,
  file_name_encrypted BYTEA,      -- Encrypted filename for resume UI
  total_chunks INTEGER NOT NULL,
  received_chunks INTEGER[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Storage purchase transactions (v2 - deferred)
CREATE TABLE storage_transacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_uid TEXT NOT NULL,
  vault_uid TEXT NOT NULL REFERENCES vaults(uid) ON DELETE CASCADE,
  storage_gb INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_uploads_vault ON uploads(vault_uid);
CREATE INDEX idx_uploads_file ON uploads(file_uid);
CREATE INDEX idx_storage_vault ON storage_transacts(vault_uid);
CREATE INDEX idx_vaults_burn ON vaults(burn_at) WHERE burn_at IS NOT NULL;
```

### Burn Timer Cron Job (pg_cron)

```sql
-- Enable pg_cron extension (run once in Supabase SQL editor)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule burn job to run every hour
SELECT cron.schedule(
  'burn-expired-vaults',
  '0 * * * *',  -- Every hour at minute 0
  $$
    -- Delete expired vaults (CASCADE will delete uploads too)
    DELETE FROM vaults WHERE burn_at IS NOT NULL AND burn_at <= NOW();
  $$
);
```

Note: Blob storage cleanup requires a separate Edge Function since pg_cron can't directly delete from storage.

### Blob Cleanup Edge Function

Located at `supabase/functions/cleanup-burned-vaults/`:

```typescript
// Triggered by pg_cron or database webhook after vault deletion
// Deletes all blobs with prefix matching the burned vault_uid
// Implementation: List and delete all objects in vault-files/{vault_uid}/*
```

### Blob Storage

- **Bucket name**: `vault-files`
- **Path structure**: `{vault_uid}/{chunk_uid}`
- Enables prefix-based deletion for vault burn
- `chunk_uid` = SHA256(file_uid || chunk_index)

### Row Level Security (RLS)

```sql
-- Enable RLS
ALTER TABLE vaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE uploads ENABLE ROW LEVEL SECURITY;

-- Vault policies (using x-vault-uid header)
CREATE POLICY "Vaults are accessible by vault_uid header"
  ON vaults FOR ALL
  USING (uid = current_setting('request.headers', true)::json->>'x-vault-uid');

-- Upload policies
CREATE POLICY "Uploads are accessible by vault_uid header"
  ON uploads FOR ALL
  USING (vault_uid = current_setting('request.headers', true)::json->>'x-vault-uid');

-- Storage bucket policy (in Supabase dashboard)
-- Path pattern: {vault_uid}/*
-- Allowed operations: SELECT, INSERT, DELETE
-- Condition: (bucket_id = 'vault-files') AND (storage.foldername(name))[1] = current_setting('request.headers', true)::json->>'x-vault-uid'
```

---

## Authentication & Security

### No Traditional Auth

- No user accounts, no sessions, no cookies
- Vault access = possessing correct seed phrase
- Server never sees encryption key, only vault UID (hash of derived material)

### Session Behavior

- **No persistence**: Nothing stored in localStorage/sessionStorage/cookies
- **Memory-only state**: Encryption key held only in React context
- **Idle timeout**: 15 minutes of inactivity
  - Warning dialog at 13 minutes with "Stay logged in" option
  - Auto-logout at 15 minutes if no interaction
- **Network drop**: Immediate logout, clear all state
- **Tab close**: No warning (server-tracked resume handles incomplete uploads)

### Route Protection

- Protected routes (`/vault`) check for encryption key in React context
- If no key present, redirect to `/login`
- No URL-based key storage (security risk)

### Vault Existence

- **No disclosure**: If vault doesn't exist, return generic "Unable to access vault" error
- Prevents enumeration attacks
- Same error for invalid vault_uid and network errors

---

## Vault Lifecycle

### Creation Flow

1. User clicks "Create vault"
2. User selects seed phrase length: 12 or 24 words
3. User selects burn timer: 24h, 7d, 30d, 90d, 1yr, or never
4. Client generates BIP39 seed phrase using `bip39.generateMnemonic()`
5. Client derives `encryption_key` and `vault_uid` via Argon2id + crypto_kdf
6. Client sends `vault_uid` and `burn_at` timestamp to server
7. Server checks uniqueness, creates vault record with empty manifest (`[]` encrypted)
8. Client displays seed words in grid for user to record
   - No clipboard copy button (security: forces users to write it down physically)
   - Words displayed in numbered grid matching input layout
9. User confirms they've saved the phrase (checkbox acknowledgment), proceeds to vault

### Login Flow

1. User enters seed phrase in grid input (with autocomplete)
2. Client validates all words are in BIP39 wordlist
3. Client derives `encryption_key` and `vault_uid`
4. Client sends `vault_uid` to server via `x-vault-uid` header
5. Server returns encrypted manifest (or generic error if not found)
6. Client decrypts manifest, renders vault contents

### Burn Timer Options

| Option   | Value                         |
| -------- | ----------------------------- |
| 24 hours | `NOW() + INTERVAL '24 hours'` |
| 7 days   | `NOW() + INTERVAL '7 days'`   |
| 30 days  | `NOW() + INTERVAL '30 days'`  |
| 90 days  | `NOW() + INTERVAL '90 days'`  |
| 1 year   | `NOW() + INTERVAL '1 year'`   |
| Never    | `NULL`                        |

### Burn Behavior

- **Hard delete**: Server permanently deletes all blobs + vault record
- pg_cron job checks `burn_at` timestamps hourly
- Blob deletion via Supabase Edge Function triggered by vault deletion

---

## File Operations

### Upload Flow

1. User drags/drops or selects file(s) via button
2. For each file (max 3 concurrent):
   a. Client generates `file_uid` (UUID)
   b. Client creates upload record on server (for resume capability)
   c. Client splits file into 5MB chunks
   d. For each chunk (with concurrency limit):
   - Derive `chunk_uid = SHA256(file_uid || index)`
   - Generate random 24-byte nonce
   - Encrypt chunk with XChaCha20-Poly1305
   - Prepend nonce to ciphertext
   - Upload to `{vault_uid}/{chunk_uid}`
   - Update `received_chunks[]` on server
     e. Update manifest with new file entry
     f. Encrypt and save updated manifest
     g. Delete upload record (complete)

### Download Flow

1. User selects file to download
2. Client reads file entry from manifest
3. For each chunk (0 to chunk_count-1):
   - Derive `chunk_uid = SHA256(file_uid || index)`
   - Download from `{vault_uid}/{chunk_uid}`
   - Extract nonce (first 24 bytes)
   - Decrypt chunk
4. Concatenate chunks, trigger browser download with original filename

### Delete Flow

1. User selects file/folder, confirms deletion (modal)
2. If folder: recursively collect all descendant files
3. Client removes entries from manifest
4. Client sends delete requests for all associated blobs
5. Encrypt and save updated manifest
6. Update `storage_used` on vault record

---

## UI/UX Specifications

### Visual Design

- **Style**: Dark & minimal
- **Background**: Dark gray/black (`#0a0a0a` or similar)
- **Accent Color**: Blue/Cyan (`#0ea5e9` or similar)
- **Typography**: Clean, modern sans-serif (Inter or system fonts)
- **Cards/Panels**: Subtle borders or slightly lighter backgrounds

### Routes

| Path      | Description                    |
| --------- | ------------------------------ |
| `/`       | Minimal landing page           |
| `/login`  | Seed phrase entry (find vault) |
| `/create` | New vault creation             |
| `/vault`  | Vault file browser (protected) |

### Landing Page (Minimal v1)

- Dark background
- Trove logo with lock icon
- Hero text: "Take back control of your data"
- Subtext: Brief privacy pitch
- Two CTAs: "Create vault" (primary), "Open vault" (secondary/outline)

### Seed Phrase Input

- **Grid layout**: 3 columns × 4 rows (12 words) or 4 columns × 6 rows (24 words)
- **Sequential unlocking**: Next input enables only after current is valid
- **Autocomplete**: Dropdown suggestions from BIP39 English wordlist as user types
- **Paste support**: Pasting full phrase auto-fills all boxes
- **Validation**: Per-word validation with visual feedback (green checkmark / red border)
- **Tab navigation**: Tab moves to next input

### Vault Browser

- **Layout**: Single pane with breadcrumb navigation
- **Header**: Logo, breadcrumbs, logout button, storage indicator
- **Toolbar**: New folder, Upload file, Upload folder buttons
- **File list**: Icon, name, size, date columns
- **Selection**: Checkboxes on hover + Shift/Ctrl keyboard modifiers
- **Actions**: Download, Delete (with confirmation modal)
- **Empty state**: Friendly message + upload prompt
- **Responsiveness**: Fully responsive, touch-friendly

### Progress Indicators

- **Inline progress**: Progress bar on each uploading file in list
- **Upload queue panel**: Expandable panel showing all active uploads
- **Per-file info**: Filename, progress %, speed (MB/s), ETA
- **Cancel button**: Ability to cancel individual uploads

### Notifications

- Toast notifications for:
  - Upload complete
  - Download complete
  - Errors (network, decryption failure, etc.)
  - Idle timeout warning
- Position: Bottom-right
- Auto-dismiss after 5 seconds (errors persist until dismissed)

### Confirmations

- Simple modal for destructive actions:
  - Delete file/folder
  - Logout (if uploads in progress)
- "Are you sure?" with Cancel/Confirm buttons
- Red accent for destructive confirm button

### Idle Timeout UI

- At 13 minutes: Modal appears
  - "Session expiring soon"
  - "You'll be logged out in 2 minutes due to inactivity"
  - "Stay logged in" button (resets timer)
  - Countdown timer
- At 15 minutes: Auto-logout, redirect to landing

---

## Code Organization

### Project Root Structure

```
trove/
├── client/                  # React frontend (Vite)
├── supabase/
│   ├── migrations/          # SQL migration files
│   ├── functions/           # Edge Functions (Deno)
│   │   └── cleanup-burned-vaults/
│   └── config.toml
└── docs/
    └── spec.md
```

### Client Source Structure

Note: This structure is a guideline; adapt as sensible during implementation.

```
client/src/
├── components/          # Reusable UI components
│   ├── ui/              # Base UI primitives
│   │   ├── Button.tsx
│   │   ├── Modal.tsx
│   │   ├── Toast.tsx
│   │   ├── Input.tsx
│   │   └── Spinner.tsx
│   ├── SeedPhraseInput.tsx
│   ├── FileList.tsx
│   ├── FileRow.tsx
│   ├── FolderBreadcrumbs.tsx
│   ├── UploadQueue.tsx
│   ├── UploadDropzone.tsx
│   ├── IdleTimeoutModal.tsx
│   └── ConfirmModal.tsx
├── pages/               # Route components
│   ├── Landing.tsx
│   ├── Login.tsx
│   ├── Create.tsx
│   └── Vault.tsx
├── hooks/               # Custom React hooks
│   ├── useVault.ts      # Vault context consumer
│   ├── useUpload.ts     # Upload queue management
│   ├── useDownload.ts   # Download with decryption
│   ├── useIdleTimeout.ts
│   └── useNetworkStatus.ts
├── lib/                 # Core utilities
│   ├── crypto.ts        # Encryption/decryption, key derivation
│   ├── bip39.ts         # Seed phrase generation/validation
│   ├── supabase.ts      # Supabase client setup
│   ├── manifest.ts      # Manifest manipulation helpers
│   └── chunks.ts        # File chunking utilities
├── context/             # React Context providers
│   ├── VaultContext.tsx # Holds encryption key, manifest, vault state
│   └── ToastContext.tsx # Toast notification state
├── types/               # TypeScript types
│   └── index.ts
├── App.tsx              # Router setup
├── main.tsx             # Entry point
└── index.css            # Tailwind config + custom styles
```

---

## Error Handling

### Manifest Corruption

- If decryption fails (wrong key or corrupted data):
  - Show "Unable to access vault" error
  - Do not differentiate from non-existent vault
- Encrypted blobs remain in storage but unrecoverable without valid key

### Upload Failures

- Retry failed chunks automatically (3 attempts with exponential backoff)
- After all retries fail, show error toast with "Retry" option
- Upload record preserved for resume

### Network Errors

- Detect offline via `navigator.onLine` + `online`/`offline` events
- Immediate logout on network drop
- Toast notification: "Connection lost. You've been logged out for security."

### File Validation

- Maximum file name: 255 characters (truncate with warning if longer)
- Any Unicode characters allowed in names
- No file size limit (limited by storage quota)

---

## Security Checklist

- [ ] All encryption client-side only
- [ ] Server never receives encryption key
- [ ] Vault UID is hash, not key itself
- [ ] No session persistence (no localStorage/sessionStorage/cookies)
- [ ] Encryption key in memory only (React context)
- [ ] Generic errors (no vault existence disclosure)
- [ ] Immediate logout on network drop
- [ ] 15-minute idle timeout with 2-minute warning
- [ ] Hard delete on burn (blobs + records)
- [ ] RLS policies on all tables
- [ ] HTTPS only (Vercel default)
- [ ] No file previews (download only)
- [ ] CSP headers configured
- [ ] Nonces prepended to ciphertext (not stored separately)
- [ ] Random nonces for each encryption operation

---

## Implementation Phases

### Phase 1: Foundation

1. Install crypto dependencies (libsodium-wrappers, bip39)
2. Implement key derivation (Argon2id + HKDF)
3. Implement encrypt/decrypt utilities
4. Set up Supabase client with custom headers
5. Create database tables and RLS policies
6. Create storage bucket with policies

### Phase 2: Auth Flow

1. Build seed phrase input component (grid with autocomplete)
2. Implement vault creation flow
3. Implement login flow
4. Set up React Router with protected routes
5. Build VaultContext for state management

### Phase 3: Vault Browser

1. Build file list component
2. Build breadcrumb navigation
3. Implement folder creation
4. Build empty state and loading states

### Phase 4: File Operations

1. Implement file chunking
2. Build upload flow with progress
3. Build download flow with decryption
4. Implement delete with confirmation
5. Build upload queue panel

### Phase 5: Advanced Features

1. Implement resumable uploads (server tracking)
2. Add folder upload support
3. Build idle timeout with warning
4. Implement network drop detection
5. Add concurrent upload limiting (max 3)

### Phase 6: Polish

1. Build minimal landing page
2. Implement toast notifications
3. Add burn timer selection to creation
4. Set up pg_cron for burn job
5. Responsive design pass
6. Error handling improvements

### Phase 7: Deployment

1. Configure Vercel deployment
2. Set environment variables
3. Configure CSP headers
4. Final security audit
5. Performance testing

---

## Deferred to v2

- **Payments**: Anonymous storage purchases (Stripe + crypto)
- **Storage tiers**: Paid storage beyond 5GB
- **Full landing page**: Marketing sections, feature highlights
- **File sharing**: Shareable links with separate encryption
- **Multi-device sync**: Real-time updates across sessions
- **Comprehensive testing**: Unit tests, integration tests, E2E tests
