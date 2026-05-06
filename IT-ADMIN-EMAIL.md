# Email to your IT / Microsoft 365 admin

When you're ready to add Microsoft 365 email sending to the Ledger app, send this email to whoever manages your Azure AD / Microsoft 365 environment.

Copy everything below the line into a new email. Replace the bracketed bits with your actual values.

---

**Subject:** Azure AD app registration request — Ledger Collections CRM

Hi [Admin name],

I'm setting up an internal tool for our finance team called Ledger that helps us manage accounts receivable. I'd like to connect it to Microsoft 365 so it can send reminder emails from each user's actual Outlook mailbox (rather than from a generic noreply address). This requires registering the app in our Azure tenant.

Could you please register a new app for me with these settings?

**App registration:**
- Name: `Ledger Collections CRM`
- Supported account types: *Accounts in this organizational directory only* (single tenant)
- Redirect URI (Web): `https://[OUR-VERCEL-URL].vercel.app/api/auth/callback/microsoft-entra-id`
  - Replace `[OUR-VERCEL-URL]` with the URL I'll send you separately

**API permissions** (delegated, on behalf of signed-in user):
- `Mail.Send` — required, so the app can send email as the signed-in user
- `Mail.Read` — optional but recommended, lets us match incoming replies back to invoices
- `User.Read` — required, lets us know who's signed in
- `offline_access` — required, so users don't have to re-authenticate every hour

Please grant admin consent on these permissions so individual users don't get prompted.

**Client secret:**
After registration, please create a new client secret (24-month expiry is fine) and send me:
1. The **Application (client) ID**
2. The **Directory (tenant) ID**
3. The **client secret value** (note: this is only visible right after creation, so please copy it immediately)

Please send these via a secure channel — internal chat with disappearing messages, password manager share, or encrypted email. Don't put them in plain email.

**Why these permissions:**
- We're not reading anyone's inbox indiscriminately. The app only sends emails the user is composing in our tool, and only matches replies to invoices the user is already tracking.
- All access is scoped to the user who's signed in. The app cannot access other users' mailboxes.
- The app runs in our Vercel environment and the secrets stay in Vercel's environment variables — they never appear in code or in our GitHub repo.

If you'd prefer to use application permissions (sending from a shared mailbox) instead of delegated permissions, that's also workable — just let me know and I'll adjust the app config on my end.

Happy to jump on a quick call if it's easier to walk through together.

Thanks,
[Your name]

---

## What happens after you get those three values back

Once your admin sends you the **Tenant ID**, **Client ID**, and **Client secret**, you'll need to:

1. Add three new environment variables in Vercel (Settings → Environment Variables):
   - `AZURE_AD_TENANT_ID`
   - `AZURE_AD_CLIENT_ID`
   - `AZURE_AD_CLIENT_SECRET`
2. Update the auth config to enable the Microsoft Entra ID provider (small code change)
3. Redeploy

Step 2 is a code change. Drop me a note when you have the values and I'll send you the updated `lib/auth.ts` file to drop in.
