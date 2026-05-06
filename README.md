# Ledger — Collections CRM

An accounts receivable collections workflow tool. Track invoices, send reminders, manage customer relationships, and stay on top of overdue payments.

## Quick start

See **SETUP-GUIDE.md** for full deployment instructions.

For local development:

```bash
npm install
cp .env.example .env
# Edit .env with your DATABASE_URL and AUTH_SECRET
npm run db:push
npm run dev
```

Then open http://localhost:3000 and create your first account (becomes admin automatically).

## Stack

- Next.js 14 (App Router)
- PostgreSQL via Neon (serverless)
- Drizzle ORM
- NextAuth v5 with email/password
- Tailwind CSS
- TypeScript
- Vercel for hosting

## Project structure

```
app/
  (app)/         # Authenticated pages (dashboard, invoices, customers, etc.)
  (auth)/        # Login + register
  api/           # API routes
components/      # Shared UI
db/              # Database schema + client
lib/             # Auth, format helpers, API helpers
```

## Cost

Free tier handles up to ~3 users with light data. See SETUP-GUIDE.md for upgrade triggers.
