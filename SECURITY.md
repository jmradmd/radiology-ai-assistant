# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest  | Yes       |

We recommend always running the latest version of Radiology AI Assistant.

---

## Reporting a Vulnerability

**Please do NOT report security vulnerabilities through public GitHub issues.**

If you discover a security vulnerability in Radiology AI Assistant, please report it responsibly by emailing:

**jmradmd@gmail.com**

Alternatively, you may use GitHub's private vulnerability reporting feature if it is enabled on this repository.

### What to Include

When reporting a vulnerability, please include:

- A description of the vulnerability
- Steps to reproduce the issue
- The potential impact of the vulnerability
- Any suggested fix or mitigation (if you have one)

### Response Timeline

- **Acknowledgment**: We will acknowledge receipt of your report within 48 hours.
- **Assessment**: We will provide an initial assessment within 5 business days.
- **Resolution**: We aim to release a fix for critical vulnerabilities within 14 days.

### What to Expect

- We will keep you informed of progress toward a fix.
- We will credit you in the release notes (unless you prefer to remain anonymous).
- We will not take legal action against researchers who report vulnerabilities responsibly.

---

## Security Considerations for Deployments

Radiology AI Assistant is designed with a no-PHI architecture, but deploying it in a clinical environment requires additional security measures:

### PHI Protection

- All user input is scanned for protected health information (PHI) patterns at both client and server layers.
- PHI detection covers MRN, SSN, DOB, patient names, phone numbers, email addresses, and physical addresses.
- Detection events are logged with hashed metadata only -- raw PHI is never stored.
- Despite these safeguards, deployers MUST validate PHI detection coverage against their institutional requirements.

### Authentication and Authorization

- Authentication is handled via Supabase Auth with support for SSO/OIDC providers.
- Role-based access control enforces four privilege levels: public, authenticated, coordinator, and admin.
- Session timeouts are configurable (default: 30 minutes).
- All connections must use TLS.

### Audit Logging

- All data access operations (CREATE, READ, UPDATE, DELETE) are logged.
- Authentication events (LOGIN, LOGOUT) are tracked.
- SEARCH and EXPORT operations generate audit records.
- Audit logs should be reviewed regularly and retained per institutional policy.

### Database Security

- Use row-level security (RLS) policies in PostgreSQL/Supabase.
- Store database credentials securely; never commit them to version control.
- Use separate connection strings for direct and pooled access.
- Regularly update PostgreSQL and pgvector to receive security patches.

### API Security

- All API endpoints require authentication except explicitly public procedures.
- Input validation is enforced via Zod schemas at the tRPC layer.
- Rate limiting should be configured at the infrastructure level.

### Desktop Application

- Auth tokens are encrypted via OS keychain (Electron safeStorage).
- The desktop app communicates exclusively over HTTPS.
- Code signing and notarization are required for distribution.

---

## Responsible Disclosure

We follow a coordinated disclosure process:

1. Reporter submits vulnerability details privately.
2. We acknowledge and assess the report.
3. We develop and test a fix.
4. We release the fix and publish a security advisory.
5. We credit the reporter (with their consent).

We ask that reporters:

- Allow reasonable time for us to address the vulnerability before public disclosure.
- Make a good-faith effort to avoid privacy violations, data destruction, or service disruption during testing.
- Do not access or modify data belonging to other users.

---

## Contact

For security-related inquiries, please email **jmradmd@gmail.com**.
