## Security

- [x] Remove console logging of any vault credentials when not in dev (testing)
- [x] Enable RLS for postgres
- [x] Enable RLS for storage
- [x] Disable public mode on storage bucket (in both url const and edge function)
- [x] Review first gemini audit in ./audits/ and apply fixes
<!-- - [ ] Migrate downloads to signed URLs (safest) -->
- [x] Make sure ALL logging uses custom logger
<!-- - [ ] Put all files in the root dir for storage instead of putting into vault folders (less intel about approx vault size)
  - Instead, the manifest should reference the files via uid in the db -->
- [x] For deriving file chunks names in storage, instead of hash(fileUid:chunkIndex) it should be hash(fileUid_Manifest.id:chunkIndex). The Manifest.id is located inside of the encrypted manifest so only the client can access it, therefore no one can derive the file storage name from the file_uid except the client.
- [ ] Fixed salt, change to dynamic

## Bug

- [x] Multiple GoTrueClient warning on the console
- [x] Individual checkboxes on files do not work at all (but check all works fine)
- [x] Uploaded two files of the same name, one overwrote the other.
- [x] Storage used not updating!
- [x] Rename vault schema to vault manifest (its actual name), including in db cols ("manifest_cipher"), logs, code, etc.
- [x] Double clicking a file downloads it (bad)
- [x] Uploading a folder just unpacks it instead of uploading as a singular "folder" unit
  - If unpacking is unavoidable, unpack into one of our virtualized folders with the same name to mimic this behavior
- [x] Arrow is facing wrong direction each state in upload queue component
- [x] Uploads table in DB not working at all, investigate its functionality

## Feature

- [x] Custom logger that logs console only if not in dev environment (meta.env.DEV), wrapper class. Migrate all logs
- [ ] Resume upload does not work (upload queue component should display incomplete uploads upon login with a resume button which prompts user to reupload the file)
  - If a user clicks the x button electing not to resume the upload, all the file chunks should be removed from storage; currently they stay. Maybe `received_chunks` can be improved, right now it is an array of numbers.
- [ ] Feature: buy more storage via Stripe
  - It's ok if the purchase itself isnt anonymous (Stripe & credit card) but under no circumstancecs can we allow a user to be traced to any storage transaction or vault
  - Remove created_at field from storage_transacts db, as it can be used for correlation attacks
  - How else can we maximize privacy?
  - We need to also design the pricing model
- [x] Include JS Doc file headers in every file; include module and description tags
- [ ] Drag and drop for file/folder reorganization within vault
- [ ] Display time in burn countdown in header
- [ ] Remove created_at from file schema entries
- [ ] Change `modified` column in vault to `uploaded`
- [x] Burn info in the header (orange) should be displayed to the left of current storage

## QA

- [x] vault creation
- [x] vault login
- [x] small file upload (<5mb)
- [x] small file download (<5mb)
- [x] small file delete
- [x] folders and organization
- [x] large file upload (chunked)
- [x] large file download (chunked)
- [x] large file delete
- [ ] verify vault burn after specified time
- [x] Final prettier
- [x] Final eslint
