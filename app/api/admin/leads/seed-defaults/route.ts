import { requireAuth, isSuperAdmin, ok, bad } from "@/lib/api";
import { db } from "@/db";
import { leadEmailTemplates, leadSequences, leadSequenceSteps } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";

// ── Default stage templates ───────────────────────────────────────────────────

const STAGE_TEMPLATES = [
  {
    stage: "new",
    name: "New Lead — First Touch",
    subject: "Getting paid faster at {{companyName}}",
    body: `Hi {{firstName}},

I came across {{companyName}} and wanted to reach out.

Most finance teams lose hours every week chasing overdue invoices by hand. Prime Accountax plugs straight into your QuickBooks or Xero and does the chasing for you — automated, polite payment reminders, a portal where customers can see and pay invoices, and a live view of who owes what.

Teams using us typically get paid 1–2 weeks sooner and cut the manual follow-up almost entirely.

Worth a quick 15-minute look to see what it would do for {{companyName}}'s cash flow?

Best,
[Your Name]`,
  },
  {
    stage: "contacted",
    name: "Contacted — Follow-Up",
    subject: "Following up — automating collections for {{companyName}}",
    body: `Hi {{firstName}},

Just circling back on my note — I know month-end gets hectic.

Quick question: how many hours does your team spend each week chasing unpaid invoices, and what's your average time-to-pay right now?

That's exactly what Prime Accountax fixes — it reminds customers automatically, escalates the ones that go quiet, and tells you who to call today. Most clients see overdue balances drop within the first month.

Even 10 minutes this week and I'll show you the numbers on your own QuickBooks/Xero data.

Best,
[Your Name]`,
  },
  {
    stage: "qualified",
    name: "Qualified — Demo Invitation",
    subject: "Let's book your walkthrough, {{firstName}}",
    body: `Hi {{firstName}},

Based on our conversation, I think Prime Accountax is a strong fit for {{companyName}}. In a 30-minute walkthrough I'll show you, on your own data:

- Automated reminder sequences that chase invoices for you (so your team doesn't)
- A self-serve payment portal — customers view and pay in one click
- A collections dashboard: aging, who's overdue, promises to pay, who to call now
- Live two-way sync with QuickBooks / Xero — no double entry

Would [Day] at [Time] work? Reply and I'll send the invite.

Best,
[Your Name]`,
  },
  {
    stage: "converted",
    name: "Converted — Welcome Aboard",
    subject: "Welcome to Prime Accountax, {{firstName}}!",
    body: `Hi {{firstName}},

Welcome aboard — delighted to have {{companyName}} with us!

Here's what happens next:
1. We connect your QuickBooks/Xero (takes a few minutes) and pull in your invoices
2. We set up your reminder sequences and payment portal with you
3. You'll see your first automated reminders going out — and start getting paid faster — within days

Anything you need before then, just reply to this email.

Excited to help you get paid sooner,
[Your Name] & the Prime Accountax team`,
  },
  {
    stage: "rejected",
    name: "Rejected — Re-engage",
    subject: "Has anything changed with collections at {{companyName}}?",
    body: `Hi {{firstName}},

Totally understood that the timing wasn't right when we last spoke.

I'm reaching back out because we've shipped a few things that often change the conversation — a redesigned customer payment portal and smarter, fully automated reminder workflows.

If late payments or manual chasing are still costing {{companyName}} time, I'd be glad to reconnect for a quick update. No pressure at all.

Best,
[Your Name]`,
  },
  {
    stage: "archived",
    name: "Archived — Win-Back",
    subject: "Still chasing invoices at {{companyName}}?",
    body: `Hi {{firstName}},

It's been a while since we connected, so one last note from me.

Cash flow only gets more important, and we've helped a lot of businesses like {{companyName}} cut their overdue balances and stop chasing invoices by hand — all on top of the QuickBooks/Xero they already use.

If you're open to it, I'd love to show you what's new. If not, no worries — the door stays open.

Best,
[Your Name]`,
  },
];

// ── Default drip sequence (6 steps over 25 days) ─────────────────────────────

const DEFAULT_SEQUENCE = {
  name: "New Lead Nurture — 6 Step",
  description:
    "Automated 6-email sequence for new leads over 25 days. Takes a QuickBooks/Xero business from cold introduction through to a demo booked or a clean close — selling AR automation, faster payment and less manual chasing.",
  steps: [
    {
      stepNumber: 1,
      delayDays: 0,
      subject: "Getting paid faster at {{companyName}}",
      body: `Hi {{firstName}},

I came across {{companyName}} and wanted to reach out.

Prime Accountax connects to your QuickBooks or Xero and automates the bit everyone hates — chasing unpaid invoices. Automatic reminders, a portal where customers can pay in one click, and a live view of who owes what.

Most teams get paid 1–2 weeks sooner and stop the manual follow-up.

Worth a quick 15-minute look?

Best,
[Your Name]`,
    },
    {
      stepNumber: 2,
      delayDays: 3,
      subject: "What late payments are really costing {{companyName}}",
      body: `Hi {{firstName}},

A quick one: every extra day an invoice sits unpaid is cash you can't use — and the average SME carries weeks of it.

Prime Accountax shortens that. It chases overdue invoices automatically (politely, on your schedule), escalates the ones that go quiet, and shows you exactly who to call today.

I can show you the impact on {{companyName}}'s own numbers in under 15 minutes.

Best,
[Your Name]`,
    },
    {
      stepNumber: 3,
      delayDays: 7,
      subject: "How one finance team cut their overdue balance in half",
      body: `Hi {{firstName}},

One client — a services business on Xero — was spending half a day a week chasing invoices and still letting balances slip past 60 days.

Within a month of switching the chasing over to Prime Accountax, their overdue balance roughly halved and the manual follow-up basically disappeared.

I'd love to show {{companyName}} how. Open to a short walkthrough this week?

Best,
[Your Name]`,
    },
    {
      stepNumber: 4,
      delayDays: 12,
      subject: "3 things {{companyName}} would use every single day",
      body: `Hi {{firstName}},

Three Prime Accountax features that make an immediate difference:

1. Automated reminder sequences — invoices get chased for you, end to end
2. Customer payment portal — clients view and pay in one click (less back-and-forth)
3. Collections dashboard — aging, overdue, promises to pay, and who to call now, synced live from QuickBooks/Xero

Want to see these on your own data in a 20-minute walkthrough?

Best,
[Your Name]`,
    },
    {
      stepNumber: 5,
      delayDays: 18,
      subject: "A couple of onboarding slots left this month, {{firstName}}",
      body: `Hi {{firstName}},

We take on a limited number of new clients each month so onboarding gets proper attention. I've a couple of slots left and wanted to offer one to {{companyName}}.

If getting paid faster is on your list for this quarter, now's a good time to lock in a 30-minute walkthrough. Reply and I'll sort the calendar.

Best,
[Your Name]`,
    },
    {
      stepNumber: 6,
      delayDays: 25,
      subject: "Should I close your file, {{firstName}}?",
      body: `Hi {{firstName}},

I've reached out a few times without hearing back — usually that means the timing's off or it's just not a priority right now.

Either way, completely fine — I'll stop here.

But if getting paid sooner and ending the manual chasing is still worth a look, I'm one reply away. Happy to pick up whenever suits {{companyName}}.

Wishing you well,
[Your Name]`,
    },
  ],
};

export async function POST(_req: NextRequest) {
  const { error, session } = await requireAuth();
  if (error) return error;
  if (!isSuperAdmin(session)) return bad("Forbidden", 403);

  let templatesCreated = 0;
  let sequencesCreated = 0;

  // ── Insert missing stage templates ────────────────────────────────────────
  for (const tpl of STAGE_TEMPLATES) {
    const [existing] = await db
      .select({ id: leadEmailTemplates.id })
      .from(leadEmailTemplates)
      .where(eq(leadEmailTemplates.name, tpl.name))
      .limit(1);

    if (!existing) {
      await db.insert(leadEmailTemplates).values({
        name:    tpl.name,
        subject: tpl.subject,
        body:    tpl.body,
        stage:   tpl.stage,
      });
      templatesCreated++;
    }
  }

  // ── Insert sequence if it doesn't exist ───────────────────────────────────
  const [existingSeq] = await db
    .select({ id: leadSequences.id })
    .from(leadSequences)
    .where(eq(leadSequences.name, DEFAULT_SEQUENCE.name))
    .limit(1);

  if (!existingSeq) {
    const [seq] = await db
      .insert(leadSequences)
      .values({
        name:        DEFAULT_SEQUENCE.name,
        description: DEFAULT_SEQUENCE.description,
        isActive:    true,
      })
      .returning();

    for (const step of DEFAULT_SEQUENCE.steps) {
      await db.insert(leadSequenceSteps).values({
        sequenceId: seq.id,
        stepNumber: step.stepNumber,
        delayDays:  step.delayDays,
        subject:    step.subject,
        body:       step.body,
      });
    }
    sequencesCreated++;
  }

  return ok({ templatesCreated, sequencesCreated });
}
