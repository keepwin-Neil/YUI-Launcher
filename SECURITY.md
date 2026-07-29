# Security policy

## Supported versions

Only the most recent Beta release receives security fixes.

## Reporting

If the repository has GitHub Private Vulnerability Reporting enabled, use it
for security reports. Otherwise, open a minimal public Issue asking for a
private contact channel. Do not post API keys, tokens, private conversation
content, model memory, local file paths, or exploit details in a public Issue.

If a credential was accidentally committed, revoke or rotate it immediately.
Deleting it from the latest commit is not sufficient because it may remain in
Git history and caches.

## Release privacy guarantee

Release archives are expected to contain only the Electron launcher allowlist
declared in `package.json`, plus legal notices. Run:

```bash
npm run verify:release
```

before publishing any binary.
