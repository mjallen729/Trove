## Security Vulnerabilities

- [.] Remove console logging of any vault credentials when not in dev (testing)
- [ ] Enable RLS for postgres
- [.] Enable RLS for storage
- [.] Disable public mode on storage bucket (in both url const and edge function)
- [ ] Review gemini audit in ./audits/ and apply fixes
- [ ] Migrate downloads to signed URLs (safest)
- [ ] Make sure ALL logging uses custom logger
- [ ] Put all files in the root dir for storage instead of putting into vault folders (less intel about approx vault size)
  - Instead, the manifest should reference the files via uid in the db

## Bugs

- [.] Multiple GoTrueClient warning on the console
- [.] Individual checkboxes on files do not work at all (but check all works fine)
- [ ] Double clicking a file downloads it (bad)
- [ ] Rename vault schema to vault manifest (its actual name)
- [.] Uploaded two files of the same name, one overwrote the other.
- [.] Storage used not updating!
- [ ] Ensure upload progress bar updates each time a chunk is uploaded
- [ ] Uploads table in DB not working at all

## Features & Improvements

- [.] Custom logger that logs console only if not in dev environment (meta.env.DEV), wrapper class. Migrate all logs
- [ ] Feature: buy more storage via Stripe
  - Mandatory: it's ok if the purchase itself isnt anonymous (Stripe & credit card) but under no circumstancecs can we allow the user to be traced to any transaction or vault
  - Remove created_at field from storage_transacts db, as it can be used for correlation attacks
  - How else can we maximize privacy?
- [ ] Include JS Doc file headers in every file including module and description tags
- [ ] Drag and drop for file/folder reorganization

## Quality Control

- [.] vault creation
- [.] vault login
- [.] small file upload (<5mb)
- [.] small file download (<5mb)
- [.] small file delete
- [ ] large file upload (chunked)
- [ ] large file download (chunked)
- [ ] large file delete
- [.] folders and organization