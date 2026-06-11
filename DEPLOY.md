# Deploy & Security Checklist

Everything below reflects the security-hardening work. Code is already deployed
via Vercel on each push to `main`; the items here are the **manual steps** that
activate or finish it (database migrations + environment variables).

---

## 1. Neon — run these SQL migrations (in order)

Open the Neon SQL editor (or `psql`) and run each file's contents. All are
idempotent (safe to re-run).

| Order | File | What it does | Required? |
|------|------|--------------|-----------|
| 1 | `db/migration-security-hardening.sql` | rate-limits table, perf indexes, email-token uniques, `reminder_schedules.org_id` | **Yes** — rate limiting is inert without it |
| 2 | `db/migration-mfa.sql` | adds opt-in MFA columns to `users` | **Yes, before any super-admin enables 2FA** |
| 3 | `db/migration-rls.sql` | Row-Level Security scaffolding (inert/safe) | Optional — see file header |

Notes:
- Migration 1's optional `UNIQUE` indexes for invoice number / contact email
  are **commented out on purpose** — your data has legitimate duplicates and
  uniqueness there is not a security requirement. Leave them off.
- Migration 3 (RLS) changes nothing on its own. Real enforcement is a separate,
  deliberate step documented at the bottom of that file.

---

## 2. Vercel — environment variables

| Variable | Status | Purpose |
|----------|--------|---------|
| `ENCRYPTION_KEY` | **Recommended** | Dedicated key for encrypting SMTP passwords + OAuth tokens at rest. Falls back to `AUTH_SECRET` if unset. Generate: `openssl rand -hex 32`. ⚠️ Once set, don't rotate without re-encrypting, or existing encrypted secrets become unreadable (affected orgs must reconnect). |
| `NEXT_PUBLIC_SENTRY_DSN` + `SENTRY_DSN` | Optional | Turns on error monitoring. Same DSN value in both. Until set, Sentry is fully inert. |
| `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` | Optional | Source-map upload during build (better stack traces). Build succeeds without them. |
| `AUTH_SECRET` | Already set | Also keys OAuth `state` signing and the encryption fallback. |
| `CRON_SECRET` | Already set | Gates the cron endpoint. |
| `DATABASE_URL`, QBO/Xero/Gmail/MS client IDs+secrets, `OPENAI_API_KEY`, `STRIPE_*`, `SYSTEM_SMTP_*` | Already set | Core app + integrations. |

---

## 3. Vercel — dashboard settings (one-time)

- **Deployment Protection** (Project → Settings → Deployment Protection): enable
  **Vercel Authentication** for *Preview* deployments so preview URLs can't be
  hit anonymously. Preview builds share env vars and can reach production data —
  don't leave them publicly reachable.
- Confirm production env vars are **not** duplicated into Preview unless intended.

---

## 4. Post-deploy smoke tests (~5 min)

The OAuth-state and encryption changes touched every connect/send/sync path, so
verify once on the live deploy:

- [ ] Reconnect **QuickBooks** and **Xero** (also encrypts their tokens immediately).
- [ ] Reconnect **Gmail** or **Microsoft**; send one test email from the composer.
- [ ] Open one invoice **PDF**.
- [ ] Log in normally (no MFA) — still works.
- [ ] (If enabling MFA) Settings → Company → **Enable 2FA**, scan QR, verify code,
      save recovery codes, then log out and back in with a code.
- [ ] Trigger a wrong-password loop a few times — confirm throttling kicks in.

Already-connected integrations keep working without action; their plaintext
tokens are read transparently and re-encrypt on the next refresh (~1 hour).

---

## 5. What's done (for reference)

App-layer, deployed and live:
- OAuth `state` is HMAC-signed + expiring (QBO/Xero/Gmail/MS) — no connection hijack.
- Reps are scoped server-side to their own book (invoices/customers/projects).
- Create/update routes validate client-supplied IDs belong to the caller's org.
- SMTP password + all OAuth tokens encrypted at rest.
- Rate limiting on login, register/OTP, forgot-password, verify-otp, portal submit.
- Crypto-random OTP; portal-email HTML escaped; SMTP username not exposed; QBO/Xero
  tokens revoked at the provider on disconnect.
- Security audit logging: login, integration connect/disconnect, user
  deactivation/role change, data export.
- Sentry monitoring (inert until DSN set).
- Opt-in super-admin TOTP MFA with recovery codes.

Deferred by design:
- **RLS enforcement** — scaffolding shipped (`migration-rls.sql`); flipping it on
  needs a restricted DB role + per-request GUC (documented in that file). Best done
  when/if you move to a pooled connection.
