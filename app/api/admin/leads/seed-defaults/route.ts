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
    subject: "Quick question about food safety at {{companyName}}",
    body: `Hi {{firstName}},

I came across {{companyName}} and wanted to reach out briefly.

We help food businesses stay audit-ready and compliant without the paper chaos — FoodReady automates your HACCP plans, temperature logs, and supplier checklists all in one place.

Would it make sense to have a quick 15-minute call to see if it could be a fit?

Best,
[Your Name]`,
  },
  {
    stage: "contacted",
    name: "Contacted — Follow-Up",
    subject: "Following up — FoodReady for {{companyName}}",
    body: `Hi {{firstName}},

Just following up on my previous note — I know things get busy.

We're currently helping food manufacturers cut audit prep time by up to 70%. I'd love to show you how {{companyName}} could benefit.

Even 10 minutes works. What does your calendar look like this week?

Best,
[Your Name]`,
  },
  {
    stage: "qualified",
    name: "Qualified — Demo Invitation",
    subject: "Let's book a demo for {{companyName}}, {{firstName}}",
    body: `Hi {{firstName}},

Based on our conversation, I think FoodReady could make a real difference at {{companyName}}.

I'd love to set up a personalised demo to show you exactly how we handle:
- Digital HACCP plans and corrective actions
- Automated temperature and checklist logs
- Supplier and allergen management
- Audit-ready reports in one click

Would [Day] at [Time] work for a 30-minute walkthrough? Reply and I'll send a calendar invite.

Best,
[Your Name]`,
  },
  {
    stage: "converted",
    name: "Converted — Welcome Aboard",
    subject: "Welcome to FoodReady, {{firstName}}!",
    body: `Hi {{firstName}},

Welcome to FoodReady — we're thrilled to have {{companyName}} on board!

Here's what to expect next:
1. Your onboarding call is being scheduled (check your inbox)
2. Our team will guide you through your first HACCP plan setup
3. You'll be audit-ready within your first week

If you have any questions in the meantime, just reply to this email.

Excited to work with you,
[Your Name] & The FoodReady Team`,
  },
  {
    stage: "rejected",
    name: "Rejected — Re-engage",
    subject: "Checking in — has anything changed at {{companyName}}?",
    body: `Hi {{firstName}},

I know the timing wasn't right when we last spoke — completely understandable.

I'm reaching out because we've recently launched some new features that often change the conversation, including automated audit scheduling and a new supplier portal.

If circumstances have changed at {{companyName}}, I'd love to reconnect for a quick update. No pressure at all.

Best,
[Your Name]`,
  },
  {
    stage: "archived",
    name: "Archived — Win-Back",
    subject: "Still thinking about compliance at {{companyName}}?",
    body: `Hi {{firstName}},

It's been a while since we last connected and I wanted to reach out one more time.

Food safety regulations are only getting stricter, and we've helped dozens of businesses like {{companyName}} stay ahead of audits without the stress.

If you're open to it, I'd love to show you what's new. If not, no worries — I'll leave the door open.

Best,
[Your Name]`,
  },
];

// ── Default drip sequence (6 steps over 25 days) ─────────────────────────────

const DEFAULT_SEQUENCE = {
  name: "New Lead Nurture — 6 Step",
  description:
    "Automated 6-email sequence for new leads over 25 days. Takes a lead from cold introduction through to a demo booked or a clean close.",
  steps: [
    {
      stepNumber: 1,
      delayDays: 0,
      subject: "Quick question about food safety at {{companyName}}",
      body: `Hi {{firstName}},

I came across {{companyName}} and wanted to reach out.

We help food businesses automate compliance — HACCP plans, temperature logs, supplier checklists — all in one place, on any device.

Would a quick 15-minute call make sense?

Best,
[Your Name]`,
    },
    {
      stepNumber: 2,
      delayDays: 3,
      subject: "The #1 reason food businesses fail audits",
      body: `Hi {{firstName}},

Most food businesses fail audits for the same reason: paper-based records that are incomplete, illegible, or simply missing.

FoodReady replaces paper with digital logs your team actually fills in — on any device, in seconds — so every inspection is effortless.

Worth a look? I can walk you through it in under 15 minutes.

Best,
[Your Name]`,
    },
    {
      stepNumber: 3,
      delayDays: 7,
      subject: "From 3 days of prep to 4 hours — a quick story",
      body: `Hi {{firstName}},

One of our customers — a mid-size food manufacturer — used to spend 3 days preparing for every audit.

After switching to FoodReady, their prep time dropped to 4 hours. Everything was already logged, verified, and ready to export.

I'd love to show {{companyName}} the same results. Open to a short demo this week?

Best,
[Your Name]`,
    },
    {
      stepNumber: 4,
      delayDays: 12,
      subject: "3 FoodReady features {{companyName}} would use every day",
      body: `Hi {{firstName}},

Based on what I know about {{companyName}}, here are three FoodReady features that would make an immediate difference:

1. Smart checklists — mobile-friendly, with auto-reminders on incomplete items
2. Corrective action tracking — log issues, assign tasks, close the loop automatically
3. One-click audit reports — export everything an inspector needs in seconds

Would you like to see these in a 20-minute walkthrough?

Best,
[Your Name]`,
    },
    {
      stepNumber: 5,
      delayDays: 18,
      subject: "Last chance to book a demo this month, {{firstName}}",
      body: `Hi {{firstName}},

We only onboard a limited number of new customers each month to make sure everyone gets proper support.

I have a couple of spots left this month and wanted to offer one to {{companyName}} before they fill up.

If you're at all curious, now is a great time to lock in a 30-minute walkthrough. Just reply and I'll sort the calendar.

Best,
[Your Name]`,
    },
    {
      stepNumber: 6,
      delayDays: 25,
      subject: "Should I close your file, {{firstName}}?",
      body: `Hi {{firstName}},

I've reached out a few times but haven't heard back — which usually means the timing is off or this just isn't a priority right now.

Either way, completely fine. I'll stop reaching out after this.

But if there's still some interest, I'm one reply away. Happy to pick up where we left off whenever works for {{companyName}}.

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
