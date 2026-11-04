# QuickBooks API through an AI connection

An AI assistant connected to Prime Accountax (Settings → AI connections) has **full access**
to the QuickBooks Online API through the `qbo_api` tool: any Accounting API path and
parameter, Employee records, PDFs, attachments, and the QuickBooks Payments API. It uses
the organisation's existing QuickBooks connection, so no extra keys or sign-in.

## Who can use it

- **Organisation admins only** (`company_admin`, `super_admin`). The QuickBooks API
  sees the whole company file and does not know the app's per-user limits (for example
  a rep who sees only their own customers), so other roles get a 403.
- What a connection may do depends on what was ticked when it was connected:

| Call | Needs |
|---|---|
| Any GET: `query`, `<entity>/<id>`, `<entity>/<id>/pdf`, `reports/<Name>`, `cdc`, `download/<id>`, `payments/...` | Read |
| Any other POST: create, update, `batch`, `upload`, Payments tokens/cards | Change QuickBooks / Xero |
| Delete or void (`operation` or `include` naming delete/void; a Payments DELETE or `/void`) | Change QuickBooks / Xero **and** Delete |
| Email a document: `<entity>/<id>/send` | Change QuickBooks / Xero **and** Send email & settings |
| Move money: Payments `charges`, `echecks`, `capture`, `refunds` | Change QuickBooks / Xero **and** Send email & settings |

- An admin can switch off all AI changes, or just deletes, for the whole organisation on
  the same settings page. That overrides every connection's grants immediately.

## How a change runs

1. The first call does **not** send anything. It returns a confirmation token.
2. `preview: true` returns the exact request and, for an update, the record as it stands
   in QuickBooks now. QuickBooks has no validate-only mode, so this is not QuickBooks'
   own check.
3. Repeating the identical call with `confirm: <token>` (valid 5 minutes) sends it.

Every change carries a QuickBooks `requestid`. Pass your own `idempotencyKey` to control
it; otherwise one is derived from the confirmed call. Retrying the same call returns
QuickBooks' first answer rather than creating a second record.

After a successful change the app's QuickBooks sync is queued, so the change appears in
the app within a minute or two.

## Behaviour

- **Minor version**: 73 by default; pass `query.minorversion` to use another.
- **Rate limit**: 450 calls a minute per QuickBooks company (QuickBooks allows 500 and the
  app's own sync needs room). Over that, the call returns 429 with `retryAfter`.
  429 and 5xx answers from QuickBooks are retried up to 3 times with backoff; a change is
  retried only because it carries a `requestid`. QuickBooks' limit of 10 concurrent
  requests is not tracked.
- **Errors**: QuickBooks' `Fault` comes back in full, with its `intuit_tid`.
- **Paging**: put `STARTPOSITION` / `MAXRESULTS` in the query (QuickBooks maximum 1000).
  `withCount: true` adds `totalCount`. `limit`, `offset` and `fields` trim what reaches the
  assistant.
- **Any path, any parameter.** A path the tool doesn't know is classified by its method: GET
  reads, POST changes, and a delete/void operation makes it a delete. A `requestid` you pass
  is used as QuickBooks' idempotency key as given.
- **PDFs**: `GET <entity>/<id>/pdf` returns a download link to give the user. It downloads that
  one PDF, lasts 10 minutes, and stops working as soon as the person loses admin access.
- **Attachments**: `POST upload` with body `{ fileName, contentType, base64, attachable:
  { AttachableRef: [{ EntityRef: { type: "Invoice", value: "145" } }], Note } }`, up to 3 MB
  (the hosting platform's request limit). `GET download/<attachableId>` returns QuickBooks'
  temporary URL for an existing attachment.
- **Payments API**: paths starting `payments/` go to `/quickbooks/v4/payments/` (e.g.
  `payments/charges`, `payments/customers/<id>/cards`); DELETE is allowed there.
- **Redaction**: `qbo_api` hides only credentials, bank account and card numbers. Employee
  records, tax ids and birth dates come through. (The app's own routes still hide them.)
- **Soft deletes are writes**: making a record inactive (`Active: false`) only needs the
  change grant, not the delete grant, because QuickBooks treats it as an update.
- **Logging**: every call (read or change) is in the audit trail as `qbo_api_call`, with
  the user, `via: mcp`, the request, the status and a redacted copy of the response.

## Examples

Payments received in October, with the account they were deposited to:

```json
{ "method": "GET", "path": "query",
  "query": { "query": "select Id, TxnDate, TotalAmt, CustomerRef, DepositToAccountRef from Payment where TxnDate >= '2026-10-01' and TxnDate <= '2026-10-31' STARTPOSITION 1 MAXRESULTS 500" },
  "withCount": true }
```

Create an estimate:

```json
{ "method": "POST", "path": "estimate",
  "body": { "CustomerRef": { "value": "58" },
            "Line": [{ "Amount": 1200, "DetailType": "SalesItemLineDetail",
                       "SalesItemLineDetail": { "ItemRef": { "value": "12" }, "Qty": 4, "UnitPrice": 300 } }] } }
```

Apply a payment to an invoice:

```json
{ "method": "POST", "path": "payment",
  "body": { "CustomerRef": { "value": "58" }, "TotalAmt": 500, "TxnDate": "2026-11-04",
            "DepositToAccountRef": { "value": "35" },
            "Line": [{ "Amount": 500, "LinkedTxn": [{ "TxnId": "1452", "TxnType": "Invoice" }] }] } }
```

Each of the last two first returns a token; send it back as `confirm` once the user agrees.

## QuickBooks connection

- The connection uses the `com.intuit.quickbooks.accounting` scope, which covers the whole
  Accounting API. The Payments API needs `com.intuit.quickbooks.payment` as well, which is
  requested only when `QBO_PAYMENTS_SCOPE=1` is set. Switch that on only after enabling
  Payments on the Intuit developer app: asking for a scope the app isn't set up for makes every
  QuickBooks connect fail. An org then has to reconnect QuickBooks, and needs a QuickBooks
  Payments merchant account. Until then Payments calls return 401/403 with a hint saying so.
- Production API (`quickbooks.api.intuit.com`). Set `QBO_ENV=sandbox` to use the sandbox.
- Access tokens last an hour and are refreshed automatically before they expire. If
  QuickBooks refuses the refresh (the refresh token is about 100 days and a reconnect
  renews it), the call returns 409 asking an admin to reconnect QuickBooks in
  Settings → Integrations.
