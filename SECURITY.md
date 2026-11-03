# Security Policy

## Supported versions

Security reports are accepted for the latest source on the default branch. Older snapshots may not receive fixes.

## Reporting a vulnerability

Please do not disclose suspected vulnerabilities, credentials, personal data, or exploitable details in a public issue. Use GitHub's private vulnerability reporting for this repository when it is enabled. If private reporting is unavailable, contact the repository maintainers privately before publishing details.

Include the affected version/commit, DSH and Node.js versions, impact, and a minimal reproduction that contains no real credentials or user data. Do not attach production logs or secrets.

## Credential handling

- Never commit Bot IDs together with their secrets, App Secrets, access tokens, pairing codes, credential-store exports, or `.env` files.
- If a credential is accidentally exposed, revoke/rotate it at the provider immediately and remove it from repository history; deleting the latest file alone does not invalidate leaked credentials.
- Use test tenants and synthetic data for issue reports and CI.
