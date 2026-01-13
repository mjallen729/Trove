## Security Vulnerabilities

- [.] Remove console logging of any vault credentials when not in dev (testing)
- [ ] Enable RLS for postgres
- [.] Enable RLS for storage
- [.] Disable public mode on storage bucket (in both url const and edge function)
- [ ] Review gemini audit in ./audits/ and apply fixes
<!-- - [ ] Migrate downloads to signed URLs (safest) -->
- [ ] Make sure ALL logging uses custom logger
- [ ] Put all files in the root dir for storage instead of putting into vault folders (less intel about approx vault size)
  - Instead, the manifest should reference the files via uid in the db
- [ ] For deriving file chunks names in storage, instead of hash(fileUid:chunkIndex) it should be hash(fileUid_Manifest.id:chunkIndex). The Manifest.id is located inside of the encrypted manifest so only the client can access it, therefore no one can derive the file storage name from the file_uid except the client.

## Bugs

- [.] Multiple GoTrueClient warning on the console
- [.] Individual checkboxes on files do not work at all (but check all works fine)
- [.] Uploaded two files of the same name, one overwrote the other.
- [.] Storage used not updating!
- [.] Rename vault schema to vault manifest (its actual name), including in db cols ("manifest_cipher"), logs, code, etc.
- [ ] Double clicking a file downloads it (bad)
- [ ] Uploading a folder just unpacks it instead of uploading as a singular "folder" unit
  - If unpacking is unavoidable, unpack into one of our virtualized folders with the same name to mimic this behavior
- [ ] Arrow is facing wrong direction each state in upload queue component
- [ ] Uploads table in DB not working at all, investigate its functionality

## Features & Improvements

- [.] Custom logger that logs console only if not in dev environment (meta.env.DEV), wrapper class. Migrate all logs
- [ ] Resume upload does not work (upload queue component should display incomplete uploads upon login with a resume button which prompts user to reupload the file)
  - If a user clicks the x button electing not to resume the upload, all the file chunks should be removed from storage; currently they stay. Maybe `received_chunks` can be improved, right now it is an array of numbers.
- [ ] Feature: buy more storage via Stripe
  - Mandatory: it's ok if the purchase itself isnt anonymous (Stripe & credit card) but under no circumstancecs can we allow the user to be traced to any transaction or vault
  - Remove created_at field from storage_transacts db, as it can be used for correlation attacks
  - How else can we maximize privacy?
  - We need to also design the pricing model
- [ ] Include JS Doc file headers in every file including module and description tags
- [ ] Drag and drop for file/folder reorganization
- [ ] Display time in burn countdown in header
- [ ] Remove created_at from file schema entries
- [ ] Change `modified` column in vault to `uploaded`
- [ ] Burn info in the header (orange) should be displayed to the left of current storage

## Quality Control

- [.] vault creation
- [.] vault login
- [.] small file upload (<5mb)
- [.] small file download (<5mb)
- [.] small file delete
- [.] folders and organization
- [.] large file upload (chunked)
- [ ] large file download (chunked)
- [.] large file delete
