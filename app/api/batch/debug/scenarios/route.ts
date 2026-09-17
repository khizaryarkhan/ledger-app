/**
 * POST /api/batch/debug/scenarios?confirm=RUN-IN-SANDBOX
 *
 * End-to-end proof that Data Studio's UPDATE does what an accountant expects —
 * run against a real QuickBooks company, through the REAL pipeline
 * (entity.toRows → groupDocs → commitOneDoc), not a re-implementation of it.
 *
 * ── WHY ──────────────────────────────────────────────────────────────────────
 *
 * The unit suite proves the pure functions. It cannot prove what QuickBooks
 * actually DOES with the payload, and that is where the money is: a customer
 * downloaded Expenses, added a Class, re-uploaded, and lines vanished. Two
 * separate defects were found by reading code, and both were fixed — but "we
 * read the code and it looks right" is exactly the standard that let the bug
 * ship in the first place.
 *
 * The open question that no amount of code-reading settles: on an update, does
 * QuickBooks REPLACE the Line array or APPEND to it? It is documented in
 * CLAUDE.md that a Deposit keeps lines omitted from a full update — returns 200
 * and silently ignores the deletion. If Bills and Expenses behave the same way,
 * then the repair plan (re-upload the original file) multiplies lines instead
 * of restoring them, and would make a damaged book worse.
 *
 * So: ask QuickBooks.
 *
 * ── SAFETY ───────────────────────────────────────────────────────────────────
 *
 * This WRITES to QuickBooks, so it is hedged four ways:
 *
 *   1. Platform admin only.
 *   2. An explicit ?confirm= value — it can never fire by accident or by a
 *      crawler hitting the URL.
 *   3. IT REFUSES TO RUN unless the connected company's name says "sandbox".
 *      This is the guard that matters. A scenario suite that seeds and deletes
 *      transactions must never touch a real company's books, and the only
 *      reliable way to know which one we are pointed at is to ask QuickBooks
 *      for its own name and check before writing anything.
 *   4. Everything it creates is namespaced CLDSCEN-<runId> and deleted again in
 *      a finally block, so a failure mid-scenario still cleans up.
 *
 * Nothing here is reachable from the product UI. It is a diagnostic.
 */

import { requirePlatformAdmin } from "@/lib/billing";
import { requireOrg, ok, bad } from "@/lib/api";
import { getOrgQboToken, type OrgQboToken } from "@/lib/qbo-token";
import { getEntity } from "@/lib/batch/entities";
import { RefResolver } from "@/lib/batch/ref-resolver";
import { groupDocs } from "@/lib/batch/engine";
import { commitOneDoc } from "@/lib/batch/commit-one";
import { qboPost, qboReadOne, qboDelete, qboQueryTop } from "@/lib/batch/qbo-client";

export const runtime = "nodejs";
export const maxDuration = 300;

const CONFIRM = "RUN-IN-SANDBOX";

type Check = { name: string; pass: boolean; expected: string; actual: string };
type Scenario = {
  id: string;
  accountantDoes: string;
  checks: Check[];
  error?: string;
  skipped?: string;
};

const check = (name: string, expected: any, actual: any): Check => ({
  name,
  pass: JSON.stringify(expected) === JSON.stringify(actual),
  expected: JSON.stringify(expected),
  actual: JSON.stringify(actual),
});

/** Sum of a record's line amounts, ignoring QBO's derived subtotal/tax lines. */
const lineSum = (r: any) =>
  Math.round(
    ((r?.Line ?? []) as any[])
      .filter((l) => !["SubTotalLineDetail", "TaxLineDetail"].includes(l?.DetailType))
      .reduce((s, l) => s + (Number(l?.Amount) || 0), 0) * 100,
  ) / 100;

const realLines = (r: any) =>
  ((r?.Line ?? []) as any[]).filter(
    (l) => !["SubTotalLineDetail", "TaxLineDetail"].includes(l?.DetailType),
  );

/**
 * Push rows back through the exact path a re-uploaded spreadsheet takes.
 * Deliberately calls groupDocs and commitOneDoc rather than reproducing their
 * logic — a harness that re-implements the thing it is testing proves nothing.
 */
async function reupload(
  token: OrgQboToken,
  entityId: string,
  rows: any[],
  resolver: RefResolver,
): Promise<{ okCount: number; errors: string[] }> {
  const entity = getEntity(entityId);
  if (!entity) throw new Error(`Unknown entity ${entityId}`);
  const docs = groupDocs(rows, entity);
  let okCount = 0;
  const errors: string[] = [];
  for (const doc of docs) {
    const r = await commitOneDoc(token, entity, "modify", doc, resolver);
    if (r.ok) okCount++;
    else errors.push((r as any).error);
  }
  return { okCount, errors };
}

export async function POST(req: Request) {
  const { error: adminErr } = await requirePlatformAdmin();
  if (adminErr) return adminErr;
  const { error: orgErr, orgId } = await requireOrg();
  if (orgErr) return orgErr;

  const url = new URL(req.url);
  if (url.searchParams.get("confirm") !== CONFIRM) {
    return bad(`This writes to QuickBooks. Add ?confirm=${CONFIRM} to run it.`);
  }

  const token = await getOrgQboToken(orgId!).catch(() => null);
  if (!token) return bad("QuickBooks is not connected for this organisation");

  // ── THE GUARD ─────────────────────────────────────────────────────────────
  // Ask QuickBooks which company this is, and refuse anything that is not
  // obviously a sandbox. Seeding and deleting transactions in a real company
  // is not a diagnostic, it is an incident.
  const resolver = new RefResolver(token);
  const [info] = await qboQueryTop(token, "CompanyInfo", 1);
  const companyName = String(info?.CompanyName ?? info?.LegalName ?? "");
  if (!/sandbox/i.test(companyName)) {
    return bad(
      `Refused: "${companyName || "unknown company"}" does not look like a sandbox. ` +
        `This suite creates and deletes transactions and must never run against real books.`,
    );
  }

  const runId = `CLDSCEN-${Date.now().toString(36).toUpperCase()}`;
  const created: { entity: string; id: string }[] = [];
  const scenarios: Scenario[] = [];

  const track = async (entity: string, payload: any): Promise<any> => {
    const res = await qboPost(token, entity, payload);
    if (!res.ok) throw new Error(`seed ${entity} failed: ${res.error}`);
    const rec = res.data?.[Object.keys(res.data).find((k) => k !== "time")!];
    created.push({ entity, id: String(rec.Id) });
    return rec;
  };

  try {
    // Reference data from the sandbox itself — never hardcoded ids.
    const [vendor] = await qboQueryTop(token, "Vendor", 1, "Active = true");
    const [expenseAcct] = await qboQueryTop(token, "Account", 1, "AccountType = 'Expense'");
    const [bankAcct] = await qboQueryTop(token, "Account", 1, "AccountType = 'Bank'");
    const [cls] = await qboQueryTop(token, "Class", 1, "Active = true");

    if (!vendor || !expenseAcct) {
      return ok({ companyName, error: "Sandbox has no vendor or expense account to test with." });
    }

    const acctLine = (amount: number, desc: string, classRef?: any) => ({
      DetailType: "AccountBasedExpenseLineDetail",
      Amount: amount,
      Description: desc,
      AccountBasedExpenseLineDetail: {
        AccountRef: { value: expenseAcct.Id },
        ...(classRef ? { ClassRef: { value: classRef } } : {}),
      },
    });

    const exportRows = async (entityId: string, id: string) => {
      const entity = getEntity(entityId)!;
      const fresh = await qboReadOne(token, entity.qboEntity!, id);
      return { fresh, rows: await entity.toRows!(fresh, resolver) };
    };

    // ── 1. THE REPORTED BUG ───────────────────────────────────────────────
    // "Downloaded Expenses, added a Class, re-uploaded." Blank Ref No, 3 lines.
    if (bankAcct) {
      const s: Scenario = { id: "expense-add-class-blank-refno", accountantDoes: "Download a 3-line expense with NO Ref No, add a Class to every line, re-upload", checks: [] };
      try {
        const seeded = await track("purchase", {
          PaymentType: "Cash",
          AccountRef: { value: bankAcct.Id },
          EntityRef: { value: vendor.Id, type: "Vendor" },
          // DocNumber deliberately omitted — this is the shape that lost data.
          Line: [acctLine(120, `${runId} line A`), acctLine(340, `${runId} line B`), acctLine(60, `${runId} line C`)],
        });

        const { rows } = await exportRows("expense", seeded.Id);
        s.checks.push(check("export produced one row per line", 3, rows.length));
        if (cls) for (const r of rows) r["Expense Class"] = cls.Name;

        const { okCount, errors } = await reupload(token, "expense", rows, resolver);
        s.checks.push(check("one update sent (not one per line)", 1, okCount));
        if (errors.length) s.error = errors.join(" | ");

        const after = await qboReadOne(token, "purchase", seeded.Id);
        s.checks.push(check("ALL THREE LINES SURVIVE", 3, realLines(after).length));
        s.checks.push(check("total unchanged", 520, lineSum(after)));
      } catch (e: any) { s.error = e?.message ?? String(e); }
      scenarios.push(s);
    }

    // ── 2. REPLACE vs APPEND ──────────────────────────────────────────────
    // The question that decides whether a repair re-upload is safe at all.
    {
      const s: Scenario = { id: "bill-roundtrip-unchanged", accountantDoes: "Download a 2-line bill and re-upload it with NO edits (twice)", checks: [] };
      try {
        const seeded = await track("bill", {
          VendorRef: { value: vendor.Id },
          DocNumber: `${runId}-RT`,
          Line: [acctLine(100, `${runId} rt1`), acctLine(250, `${runId} rt2`)],
        });
        for (let pass = 1; pass <= 2; pass++) {
          const { rows } = await exportRows("bill", seeded.Id);
          await reupload(token, "bill", rows, resolver);
          const after = await qboReadOne(token, "bill", seeded.Id);
          s.checks.push(check(`after re-upload #${pass}: still 2 lines (append would give ${2 * (pass + 1)})`, 2, realLines(after).length));
          s.checks.push(check(`after re-upload #${pass}: total still 350`, 350, lineSum(after)));
        }
      } catch (e: any) { s.error = e?.message ?? String(e); }
      scenarios.push(s);
    }

    // ── 3. DELETING A LINE ────────────────────────────────────────────────
    {
      const s: Scenario = { id: "bill-remove-a-line", accountantDoes: "Delete one row from a 3-line bill in the sheet and re-upload", checks: [] };
      try {
        const seeded = await track("bill", {
          VendorRef: { value: vendor.Id },
          DocNumber: `${runId}-DEL`,
          Line: [acctLine(100, `${runId} d1`), acctLine(200, `${runId} d2`), acctLine(300, `${runId} d3`)],
        });
        const { rows } = await exportRows("bill", seeded.Id);
        await reupload(token, "bill", rows.slice(0, 2), resolver);  // drop the last row
        const after = await qboReadOne(token, "bill", seeded.Id);
        s.checks.push(check("the removed line is GONE (not silently kept)", 2, realLines(after).length));
        s.checks.push(check("total drops to 300", 300, lineSum(after)));
      } catch (e: any) { s.error = e?.message ?? String(e); }
      scenarios.push(s);
    }

    // ── 4. ADDING A LINE ──────────────────────────────────────────────────
    {
      const s: Scenario = { id: "bill-add-a-line", accountantDoes: "Add a new row to a 1-line bill and re-upload", checks: [] };
      try {
        const seeded = await track("bill", {
          VendorRef: { value: vendor.Id },
          DocNumber: `${runId}-ADD`,
          Line: [acctLine(100, `${runId} a1`)],
        });
        const { rows } = await exportRows("bill", seeded.Id);
        rows.push({ ...rows[0], "Expense Description": `${runId} a2`, "Expense Line Amount": 75 });
        await reupload(token, "bill", rows, resolver);
        const after = await qboReadOne(token, "bill", seeded.Id);
        s.checks.push(check("now 2 lines", 2, realLines(after).length));
        s.checks.push(check("total 175", 175, lineSum(after)));
      } catch (e: any) { s.error = e?.message ?? String(e); }
      scenarios.push(s);
    }

    // ── 5. THE DUPLICATE DOC NUMBER ───────────────────────────────────────
    // The University of Michigan case: two different bills, same Bill No.
    {
      const s: Scenario = { id: "two-bills-same-bill-no", accountantDoes: "Two DIFFERENT bills share a Bill No (vendor reused an invoice number); edit both and re-upload", checks: [] };
      try {
        const shared = `${runId}-DUP`;
        const a = await track("bill", { VendorRef: { value: vendor.Id }, DocNumber: shared, Line: [acctLine(900, `${runId} rent`)] });
        const b = await track("bill", { VendorRef: { value: vendor.Id }, DocNumber: shared, Line: [acctLine(150, `${runId} cleaning`)] });

        const ra = (await exportRows("bill", a.Id)).rows;
        const rb = (await exportRows("bill", b.Id)).rows;
        const sheet = [...ra, ...rb];
        if (cls) for (const r of sheet) r["Expense Class"] = cls.Name;

        const { okCount } = await reupload(token, "bill", sheet, resolver);
        s.checks.push(check("BOTH bills updated (not merged into one)", 2, okCount));

        const afterA = await qboReadOne(token, "bill", a.Id);
        const afterB = await qboReadOne(token, "bill", b.Id);
        s.checks.push(check("bill A keeps only its own line", 1, realLines(afterA).length));
        s.checks.push(check("bill A total still 900", 900, lineSum(afterA)));
        s.checks.push(check("bill B keeps only its own line", 1, realLines(afterB).length));
        s.checks.push(check("bill B total still 150", 150, lineSum(afterB)));
      } catch (e: any) { s.error = e?.message ?? String(e); }
      scenarios.push(s);
    }

    // ── 6. EDITING AN AMOUNT ──────────────────────────────────────────────
    {
      const s: Scenario = { id: "bill-change-amount", accountantDoes: "Correct an amount on one line of a 2-line bill", checks: [] };
      try {
        const seeded = await track("bill", {
          VendorRef: { value: vendor.Id },
          DocNumber: `${runId}-AMT`,
          Line: [acctLine(100, `${runId} m1`), acctLine(200, `${runId} m2`)],
        });
        const { rows } = await exportRows("bill", seeded.Id);
        rows[1]["Expense Line Amount"] = 999;
        await reupload(token, "bill", rows, resolver);
        const after = await qboReadOne(token, "bill", seeded.Id);
        s.checks.push(check("still 2 lines", 2, realLines(after).length));
        s.checks.push(check("total reflects the edit", 1099, lineSum(after)));
      } catch (e: any) { s.error = e?.message ?? String(e); }
      scenarios.push(s);
    }

    // ── 7. INVOICES ───────────────────────────────────────────────────────
    // The sales side, and the entity this product exists for. Same machinery,
    // different builder and mapper, so it needs its own proof.
    const [customer] = await qboQueryTop(token, "Customer", 1, "Active = true");
    const [item] = await qboQueryTop(token, "Item", 1, "Active = true and Type = 'Service'");

    if (customer && item) {
      const itemLine = (amount: number, desc: string) => ({
        DetailType: "SalesItemLineDetail",
        Amount: amount,
        Description: desc,
        SalesItemLineDetail: { ItemRef: { value: item.Id }, Qty: 1, UnitPrice: amount },
      });

      {
        const sc: Scenario = { id: "invoice-add-class", accountantDoes: "Download a 3-line invoice, add a Class to every line, re-upload", checks: [] };
        try {
          const seeded = await track("invoice", {
            CustomerRef: { value: customer.Id },
            DocNumber: `${runId.slice(-8)}I`,
            Line: [itemLine(100, `${runId} i1`), itemLine(200, `${runId} i2`), itemLine(300, `${runId} i3`)],
          });
          const { rows } = await exportRows("invoice", seeded.Id);
          sc.checks.push(check("export produced one row per line", 3, rows.length));
          if (cls) for (const r of rows) r["Product/Service Class"] = cls.Name;
          const { okCount, errors } = await reupload(token, "invoice", rows, resolver);
          sc.checks.push(check("one update sent", 1, okCount));
          if (errors.length) sc.error = errors.join(" | ");
          const after = await qboReadOne(token, "invoice", seeded.Id);
          sc.checks.push(check("all three lines survive", 3, realLines(after).length));
          sc.checks.push(check("total unchanged", 600, lineSum(after)));
        } catch (e: any) { sc.error = e?.message ?? String(e); }
        scenarios.push(sc);
      }

      // ── 8. THE SAFETY GUARD ─────────────────────────────────────────────
      // An invoice carrying a line type the spreadsheet cannot represent must
      // be REFUSED, not silently stripped of it. Proving the guard fires is the
      // whole point — an unproven guard is decoration.
      {
        const sc: Scenario = { id: "invoice-unrepresentable-line-refused", accountantDoes: "Re-upload an invoice containing a description-only line (which the sheet cannot carry)", checks: [] };
        try {
          const seeded = await track("invoice", {
            CustomerRef: { value: customer.Id },
            DocNumber: `${runId.slice(-8)}D`,
            Line: [
              itemLine(100, `${runId} keep`),
              { DetailType: "DescriptionOnly", Description: `${runId} note to client` },
            ],
          });
          const before = await qboReadOne(token, "invoice", seeded.Id);
          const beforeCount = realLines(before).length;

          const { rows } = await exportRows("invoice", seeded.Id);
          const { okCount, errors } = await reupload(token, "invoice", rows, resolver);

          sc.checks.push(check("the update is REFUSED, not silently applied", 0, okCount));
          sc.checks.push(check("the refusal explains itself", true, /cannot carry|QuickBooks/i.test(errors[0] ?? "")));

          const after = await qboReadOne(token, "invoice", seeded.Id);
          sc.checks.push(check("the invoice is left completely untouched", beforeCount, realLines(after).length));
        } catch (e: any) { sc.error = e?.message ?? String(e); }
        scenarios.push(sc);
      }

      // ── 9. RECEIVED PAYMENTS ────────────────────────────────────────────
      // The highest-stakes update in an AR product: the Line array IS the set
      // of invoice applications, so a bad write un-pays invoices.
      {
        const sc: Scenario = { id: "payment-applied-to-two-invoices", accountantDoes: "A payment settling TWO invoices — edit the memo and re-upload", checks: [] };
        try {
          const i1 = await track("invoice", { CustomerRef: { value: customer.Id }, DocNumber: `${runId.slice(-8)}P1`, Line: [itemLine(100, `${runId} p1`)] });
          const i2 = await track("invoice", { CustomerRef: { value: customer.Id }, DocNumber: `${runId.slice(-8)}P2`, Line: [itemLine(250, `${runId} p2`)] });
          const pmt = await track("payment", {
            CustomerRef: { value: customer.Id },
            TotalAmt: 350,
            Line: [
              { Amount: 100, LinkedTxn: [{ TxnId: String(i1.Id), TxnType: "Invoice" }] },
              { Amount: 250, LinkedTxn: [{ TxnId: String(i2.Id), TxnType: "Invoice" }] },
            ],
          });

          const { rows } = await exportRows("receivepayment", pmt.Id);
          sc.checks.push(check("export produced one row per applied invoice", 2, rows.length));
          for (const r of rows) r["Memo"] = `${runId} edited memo`;

          const { okCount, errors } = await reupload(token, "receivepayment", rows, resolver);
          sc.checks.push(check("one update sent for the payment", 1, okCount));
          if (errors.length) sc.error = errors.join(" | ");

          const after = await qboReadOne(token, "payment", pmt.Id);
          sc.checks.push(check("BOTH invoice applications survive", 2, realLines(after).length));
          sc.checks.push(check("the payment still totals 350", 350, Number(after?.TotalAmt ?? 0)));

          // What actually matters to a customer: are the invoices still paid?
          // An un-applied payment silently reopens them.
          const inv1 = await qboReadOne(token, "invoice", i1.Id);
          const inv2 = await qboReadOne(token, "invoice", i2.Id);
          sc.checks.push(check("invoice 1 still fully paid (balance 0)", 0, Number(inv1?.Balance ?? -1)));
          sc.checks.push(check("invoice 2 still fully paid (balance 0)", 0, Number(inv2?.Balance ?? -1)));
        } catch (e: any) { sc.error = e?.message ?? String(e); }
        scenarios.push(sc);
      }
    }

    // ── 10. JOURNAL ENTRIES ───────────────────────────────────────────────
    // Debits and credits round-trip through a SIGN convention in the sheet
    // (debit positive, credit negative). Getting that backwards on a re-upload
    // would flip an entry without changing its total — the kind of error that
    // reconciles and is still wrong.
    if (bankAcct) {
      const sc: Scenario = { id: "journal-entry-roundtrip", accountantDoes: "Download a balanced journal entry, change the memo, re-upload", checks: [] };
      try {
        const seeded = await track("journalentry", {
          DocNumber: `${runId.slice(-8)}J`,
          Line: [
            { DetailType: "JournalEntryLineDetail", Amount: 500, Description: `${runId} dr`, JournalEntryLineDetail: { PostingType: "Debit",  AccountRef: { value: expenseAcct.Id } } },
            { DetailType: "JournalEntryLineDetail", Amount: 500, Description: `${runId} cr`, JournalEntryLineDetail: { PostingType: "Credit", AccountRef: { value: bankAcct.Id } } },
          ],
        });
        const { rows } = await exportRows("journalentry", seeded.Id);
        sc.checks.push(check("export produced one row per journal line", 2, rows.length));
        for (const r of rows) r["Memo"] = `${runId} edited`;

        const { okCount, errors } = await reupload(token, "journalentry", rows, resolver);
        if (errors.length) sc.error = errors.join(" | ");
        sc.checks.push(check("one update sent", 1, okCount));

        const after = await qboReadOne(token, "journalentry", seeded.Id);
        const jlines = realLines(after);
        const dr = jlines.filter((l: any) => l.JournalEntryLineDetail?.PostingType === "Debit").reduce((n: number, l: any) => n + Number(l.Amount || 0), 0);
        const cr = jlines.filter((l: any) => l.JournalEntryLineDetail?.PostingType === "Credit").reduce((n: number, l: any) => n + Number(l.Amount || 0), 0);
        sc.checks.push(check("still 2 lines", 2, jlines.length));
        sc.checks.push(check("debits still 500 — the sign convention survived", 500, dr));
        sc.checks.push(check("credits still 500 — not flipped", 500, cr));
      } catch (e: any) { sc.error = e?.message ?? String(e); }
      scenarios.push(sc);
    }

    // ── 11. THE IMPORT (CREATE) PATH ──────────────────────────────────────
    // Deliberately NOT changed when the update grouping was fixed, because a
    // create has no record id to group on. This measures what it actually does,
    // so the behaviour is known rather than assumed: a multi-line expense typed
    // into a sheet with NO Ref No. If the importer sees three documents instead
    // of one, that is a real and separate defect, and this is how we find out.
    // Measures grouping only — it creates nothing, so there is nothing to clean.
    if (bankAcct) {
      const sc: Scenario = { id: "create-multiline-no-refno", accountantDoes: "Type a NEW 3-line expense into a sheet with no Ref No and import it", checks: [] };
      try {
        const entity = getEntity("expense")!;
        const rows = [1, 2, 3].map((n) => ({
          "Account": bankAcct.Name,
          "Payee": vendor.DisplayName,
          "Payment Date": new Date().toISOString().slice(0, 10),
          "Expense Account": expenseAcct.Name,
          "Expense Description": `${runId} create ${n}`,
          "Expense Line Amount": n * 10,
        }));
        const docs = groupDocs(rows as any, entity);
        sc.checks.push(check("documents the importer sees (1 = one expense, 3 = three separate ones)", 1, docs.length));
      } catch (e: any) { sc.error = e?.message ?? String(e); }
      scenarios.push(sc);
    }

    return ok({
      companyName,
      runId,
      scenarios,
      summary: {
        scenarios: scenarios.length,
        checks: scenarios.reduce((n, s) => n + s.checks.length, 0),
        failed: scenarios.reduce((n, s) => n + s.checks.filter((c) => !c.pass).length, 0),
        errored: scenarios.filter((s) => s.error).length,
      },
      cleanedUp: created.length,
    });
  } finally {
    // Always clean up, even if a scenario threw — a half-run suite must not
    // leave seeded transactions behind for someone to find later and wonder at.
    for (const c of created.reverse()) {
      try {
        const rec = await qboReadOne(token, c.entity, c.id);
        if (rec) await qboDelete(token, c.entity, c.id, String(rec.SyncToken ?? "0"));
      } catch { /* best effort — they are all namespaced CLDSCEN- */ }
    }
  }
}
