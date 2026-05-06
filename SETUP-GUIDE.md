# Ledger Setup Guide

A non-developer's step-by-step guide to deploying the Collections CRM.

**Time required:** 30–45 minutes the first time.
**Cost:** €0 to start. Maybe €20-50/month at full company scale.
**Skill level:** You can copy-paste, click buttons, and run a few terminal commands.

---

## What you'll have at the end

A live URL — something like `https://your-app.vercel.app` — that you and your team can sign into. All data persists in a real database. Multi-user. Email/password login (we'll add Microsoft 365 later if you want).

---

## Before you start: install one tool

You need **Git** so the deployment service (Vercel) can pull your code. You probably already have it.

**Check if Git is installed.** Open a terminal and run:

```bash
git --version
```

If you get a version number, you're good. If you get "command not found", install Git:

- **Mac:** Run `xcode-select --install` and accept the popup
- **Windows:** Download from https://git-scm.com/download/win
- **Linux:** `sudo apt install git`

That's the only tool you need to install. Everything else runs in your browser.

---

## Step 1 — Create accounts (5 min)

You need three free accounts. Sign up for each:

1. **GitHub** — https://github.com/signup *(this stores your code)*
2. **Vercel** — https://vercel.com/signup *(this hosts your app)* — sign up with GitHub, easiest path
3. **Neon** — https://neon.tech *(this is your database)* — sign up with GitHub

Use the same email for all three if you want. None of them require credit cards for the free tier.

---

## Step 2 — Get the code into GitHub (10 min)

You're going to upload the project files to a private GitHub repo. There are two ways. Pick whichever sounds easier.

### Option A: Use the GitHub website (no terminal)

1. Unzip the project file you received (`ledger-app.zip`). You'll get a folder called `ledger-app` containing many files.
2. Go to https://github.com/new
3. Repository name: `ledger-app`
4. Set it to **Private**
5. Tick **"Add a README file"**
6. Click **Create repository**
7. On the new repo page, click **"Add file" → "Upload files"**
8. Drag the *contents* of the unzipped `ledger-app` folder (not the folder itself — the files inside) into the upload area. There will be a lot of files. That's normal.
9. Wait for the upload to complete (1-2 minutes), then click **Commit changes**

### Option B: Use the terminal

1. Unzip the project to a folder called `ledger-app`
2. Go to https://github.com/new — create a private repo called `ledger-app`. Don't tick any of the "initialize with..." boxes
3. Open a terminal in the unzipped `ledger-app` folder and run:

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/ledger-app.git
git push -u origin main
```

Replace `YOUR-USERNAME` with your actual GitHub username.

---

## Step 3 — Create the database on Neon (5 min)

1. Go to https://console.neon.tech
2. Click **Create project**
3. Project name: `ledger-prod`
4. Postgres version: leave default
5. Region: pick the closest one to you
6. Click **Create project**
7. After it loads, you'll see a connection string starting with `postgres://`. **Copy this entire string** and paste it somewhere safe (a notes app, Word doc, anywhere). You need it in the next step.

It looks something like:
```
postgres://neondb_owner:abc123XYZ@ep-cool-meadow-12345.eu-central-1.aws.neon.tech/neondb?sslmode=require
```

> **Save this connection string.** You'll need it in Step 5.

---

## Step 4 — Generate two random secrets (1 min)

The app needs two random strings to encrypt sessions and protect the cron endpoint. Run these in your terminal:

```bash
openssl rand -base64 32
```

That spits out a random string. Run it **twice** — once for `AUTH_SECRET`, once for `CRON_SECRET`. Save both somewhere.

**On Windows without openssl?** Just go to https://generate-secret.vercel.app/32 and grab two random strings from there.

---

## Step 5 — Deploy on Vercel (5 min)

1. Go to https://vercel.com/new
2. You'll see a list of your GitHub repos. Click **Import** next to `ledger-app`
3. **Framework Preset:** should auto-detect as Next.js
4. **Root Directory:** leave as `./`
5. Expand **Environment Variables** and add these (one at a time):

| Name | Value |
|------|-------|
| `DATABASE_URL` | The Neon connection string from Step 3 |
| `AUTH_SECRET` | The first random string from Step 4 |
| `AUTH_URL` | Leave blank for now — we'll fill it after deploy |
| `CRON_SECRET` | The second random string from Step 4 |
| `DISABLE_PUBLIC_SIGNUP` | `false` |

6. Click **Deploy**. Wait 2-3 minutes.
7. When it finishes, you'll see a URL like `https://ledger-app-xyz.vercel.app`. **Copy that URL.**

### One more env var

Now go back to **Settings → Environment Variables** in Vercel:

- Edit `AUTH_URL` and paste in the URL from step 7 (the full `https://...vercel.app` URL)
- Save

Then redeploy: **Deployments tab → click the three dots on the most recent deployment → Redeploy**.

---

## Step 6 — Create the database tables (3 min)

Your database exists but it's empty. We need to create the tables. The easiest way is from your local machine.

1. Open a terminal in your unzipped `ledger-app` folder
2. Create a file called `.env` in that folder. Open it in any text editor (TextEdit on Mac, Notepad on Windows). Paste in just this one line, with your actual Neon connection string:

```
DATABASE_URL="paste-your-neon-connection-string-here"
```

Save the file.

3. In the terminal, run:

```bash
npm install
npm run db:push
```

The first command takes a minute or two. The second creates all the tables. You should see output ending with something like "Changes applied".

If it fails saying `node` is not installed, install Node.js from https://nodejs.org first (pick the LTS version), then re-run.

---

## Step 7 — Sign in for the first time (2 min)

1. Open your Vercel URL in a browser: `https://ledger-app-xyz.vercel.app`
2. You'll be redirected to a sign-in page
3. Click **Create an account**
4. Fill in your name, email, and a password (8+ chars)
5. Click **Create account**

🎉 You're in. Because you're the first person to sign up, you got the **Admin** role automatically.

---

## Step 8 — Load demo data (optional, 30 seconds)

Want to see the app populated before adding real data?

1. Go to **Settings** in the sidebar
2. Scroll to **Demo data**
3. Click **Load demo data**

You'll get 8 customers and 14 invoices in various states (overdue, disputed, paid, etc.) so you can see how the dashboard, board, and reports look.

> **Heads up:** Click this only once. Clicking again creates duplicates.

---

## Step 9 — Invite your team (5 min)

Two ways to add people, depending on how locked-down you want it.

### Option A: Open registration (easier for piloting)

Just send your colleagues the URL: `https://ledger-app-xyz.vercel.app/register`

They sign up themselves. Anyone with the link can join. New users get the `FinanceUser` role (not Admin).

### Option B: Locked down (recommended for production)

1. Have your colleagues sign up first using the URL above (or wait until you're ready to add each one)
2. Once everyone you want is in, go to Vercel → Settings → Environment Variables
3. Edit `DISABLE_PUBLIC_SIGNUP` and set it to `true`
4. Redeploy (Deployments → three dots → Redeploy)

After this, the registration page rejects new signups. To add someone, set the env var back to `false` temporarily, have them sign up, then set it to `true` again.

---

## Step 10 (optional) — Use your own domain

Want `ledger.yourcompany.com` instead of `ledger-app-xyz.vercel.app`?

1. In Vercel, go to your project → Settings → Domains
2. Type your desired domain and click **Add**
3. Vercel shows you DNS records to add at your domain registrar (the place where you bought the domain — GoDaddy, Cloudflare, etc.)
4. Add those DNS records at your registrar. Wait 5-30 minutes for them to propagate
5. Once Vercel says "Valid Configuration", **also update the `AUTH_URL` env var** to your new domain (e.g. `https://ledger.yourcompany.com`)
6. Redeploy

---

## Troubleshooting

### The app loads but everything is empty

Did you load the demo data? Settings → Load demo data. Or just create a customer and invoice manually to test.

### "DATABASE_URL is not set" error

Your env vars in Vercel didn't save correctly. Go to Settings → Environment Variables and confirm `DATABASE_URL` is listed with the full connection string. Also check `AUTH_SECRET` is there. After fixing, redeploy.

### "Invalid email or password" when I know the password is right

Two possible causes:
1. Database tables don't exist yet → re-run Step 6
2. `AUTH_SECRET` was changed after you created your account → all sessions invalidated. Sign in fresh; it'll work

### npm run db:push fails

Most common cause: your `.env` file isn't in the right folder, or the `DATABASE_URL` quotes are wrong. The line should look exactly like:

```
DATABASE_URL="postgres://...?sslmode=require"
```

Including the quotes. Including `?sslmode=require` at the end.

### Vercel build fails

Click into the failed deployment to see the error log. The most common issue is forgetting to set `DATABASE_URL` or `AUTH_SECRET` in env vars before deploying. Fix the env vars, then **Redeploy**.

### Cron job isn't running

Check **Vercel → Cron Jobs** in your project settings. The free tier on Vercel allows daily crons. The endpoint runs at 09:00 UTC each day to auto-escalate invoices that are 30+ days overdue. If you don't see the cron, redeploy and it'll register.

### I want to delete all data and start fresh

Run in your terminal (with the `.env` file in place):

```bash
npm run db:push -- --force
```

That recreates all tables empty. You'll need to register again.

### The page loads but says "Loading…" forever

Check the browser console (right-click → Inspect → Console tab). Most often this means an API call is failing. The error there will tell you what's wrong — usually a missing env var or a DB connection issue.

---

## Adding Microsoft 365 later

When you're ready to send real emails through Outlook, you'll need:

1. Your IT admin or someone with Azure AD permissions to register an app
2. Mail.Send and Mail.Read API permissions
3. A code update to wire up the OAuth flow

The `IT-ADMIN-EMAIL.md` file has a pre-written email you can send to your IT team to get this started. It explains exactly what they need to do.

---

## Costs to watch

You're on free tiers. Here's when you'll need to upgrade:

- **Neon free** = 0.5 GB storage, suspends after 5 mins of inactivity. Fine for piloting and small teams. Upgrade to Pro (~$19/month) when storage runs out or you want zero cold-starts.
- **Vercel free** = unlimited deploys but 100 GB bandwidth/month. Plenty for an internal tool unless you have hundreds of users.
- **GitHub free** = unlimited private repos. No upgrade needed.

You can monitor usage at: Vercel dashboard → Usage tab. Neon dashboard → top-right gauge.

---

## Getting help

If something doesn't work and the troubleshooting above doesn't help:

1. Take a screenshot of the error
2. Copy the URL where it happened
3. Note which step in this guide you were on

That's enough info to ask anyone (including the AI that built this) to help debug.
