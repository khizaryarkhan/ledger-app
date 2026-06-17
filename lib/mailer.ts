/**
 * Unified mailer — routes outbound email through the best available transport:
 *   1. Gmail OAuth (if the org has connected Gmail)
 *   2. Microsoft OAuth / Outlook (if the org has connected Microsoft)
 *   3. SMTP fallback (org-level settings or global SMTP_* env vars)
 *
 * Usage:
 *   import { sendEmail } from "@/lib/mailer";
 *   await sendEmail(orgId, { to, subject, body, cc, attachments });
 *
 * SMTP credentials come from:
 *   1. org_smtp_settings table (org-specific, set in Settings → Email)
 *   2. SMTP_* environment variables (global fallback)
 */

import * as nodemailer from "nodemailer";
import { db } from "@/db";
import { orgSmtpSettings, orgEmailSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getValidGmailToken, sendGmail } from "@/lib/gmail";
import { getValidMicrosoftToken, sendMicrosoft } from "@/lib/microsoft";
import { decryptSecret } from "@/lib/crypto";

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface MailOptions {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  replyTo?: string;
  attachments?: MailAttachment[];
}

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;       // "Name <email>" or just "email"
  fromEmail: string;  // bare email address (for BCC-to-self)
  ccEmail?: string | null;
  ccEnabled?: boolean;
}

/**
 * Load SMTP config for an org. Returns null if not configured.
 */
export async function getSmtpConfig(orgId: string): Promise<SmtpConfig | null> {
  const [smtp] = await db
    .select()
    .from(orgSmtpSettings)
    .where(eq(orgSmtpSettings.orgId, orgId))
    .limit(1);

  // NEVER fall back to global env vars — that would leak one org's SMTP
  // credentials into another org's outbound mail. Each org must configure
  // their own transport (Gmail OAuth, Microsoft OAuth, or SMTP).
  const host      = smtp?.host;
  const port      = smtp?.port      ?? 2525;
  const user      = smtp?.user;
  const pass      = decryptSecret(smtp?.pass);  // encrypted at rest (legacy plaintext passes through)
  const fromEmail = smtp?.fromEmail;
  const fromName  = smtp?.fromName;

  if (!host || !user || !pass || !fromEmail) return null;

  const from = fromName ? `"${fromName}" <${fromEmail}>` : fromEmail;

  return {
    host,
    port: typeof port === "number" ? port : parseInt(String(port)),
    user,
    pass,
    from,
    fromEmail,
    ccEmail:   smtp?.ccEmail  ?? null,
    ccEnabled: smtp?.ccEnabled ?? false,
  };
}

/**
 * Load the org-level default CC setting (transport-agnostic).
 * Returns null if not configured or the table doesn't exist yet.
 */
async function getOrgDefaultCc(orgId: string): Promise<string | null> {
  try {
    const [row] = await db
      .select({ ccEmail: orgEmailSettings.ccEmail, ccEnabled: orgEmailSettings.ccEnabled })
      .from(orgEmailSettings)
      .where(eq(orgEmailSettings.orgId, orgId))
      .limit(1);
    return row?.ccEnabled && row.ccEmail ? row.ccEmail : null;
  } catch {
    return null;
  }
}

/** Merge caller-supplied CC with the org default CC. */
function mergeCC(callerCc: string | undefined, defaultCc: string | null): string | undefined {
  const parts = [callerCc || null, defaultCc].filter(Boolean);
  return parts.length > 0 ? parts.join(",") : undefined;
}

/**
 * True if the org has ANY working email transport (Gmail, Microsoft, or SMTP).
 * Use this to gate bulk sends so Gmail/MS365-only orgs aren't skipped.
 */
export async function hasEmailTransport(orgId: string): Promise<boolean> {
  if (await getValidGmailToken(orgId).catch(() => null)) return true;
  if (await getValidMicrosoftToken(orgId).catch(() => null)) return true;
  if (await getSmtpConfig(orgId).catch(() => null)) return true;
  return false;
}

/**
 * Unified send — tries Gmail → Microsoft → SMTP in order.
 * Throws if no transport is configured or the send fails.
 * Returns an object describing which transport was used.
 */
export async function sendEmail(
  orgId: string,
  opts: MailOptions,
): Promise<{ transport: "gmail" | "microsoft" | "smtp"; from: string }> {
  // Load org-level default CC (applies to all transports)
  const defaultCc = await getOrgDefaultCc(orgId);
  const effectiveCc = mergeCC(opts.cc, defaultCc);
  const enriched = { ...opts, cc: effectiveCc };

  // --- 1. Gmail ---
  const gmailToken = await getValidGmailToken(orgId);
  if (gmailToken) {
    await sendGmail(gmailToken.accessToken, gmailToken.email, {
      to:          enriched.to,
      subject:     enriched.subject,
      body:        enriched.body,
      cc:          enriched.cc,
      attachments: enriched.attachments,
    });
    return { transport: "gmail", from: gmailToken.email };
  }

  // --- 2. Microsoft ---
  const msToken = await getValidMicrosoftToken(orgId);
  if (msToken) {
    await sendMicrosoft(msToken.accessToken, {
      to:          enriched.to,
      subject:     enriched.subject,
      body:        enriched.body,
      cc:          enriched.cc,
      attachments: enriched.attachments,
    });
    return { transport: "microsoft", from: msToken.email };
  }

  // --- 3. SMTP fallback ---
  const config = await getSmtpConfig(orgId);
  if (!config) {
    throw new Error(
      "No email transport configured. Connect Gmail, Microsoft, or set up SMTP in Settings → Email.",
    );
  }
  // Pass enriched opts — SMTP's own legacy CC logic is bypassed since
  // defaultCc is already merged in above.
  await sendSmtp(config, enriched);
  return { transport: "smtp", from: config.fromEmail };
}

/**
 * Send an email via SMTP. Throws on failure.
 */
export async function sendSmtp(config: SmtpConfig, opts: MailOptions): Promise<void> {
  const transporter = nodemailer.createTransport({
    host:              config.host,
    port:              config.port,
    secure:            false,
    auth:              { user: config.user, pass: config.pass },
    connectionTimeout: 9_000,
    greetingTimeout:   9_000,
    socketTimeout:     9_000,
  });

  await transporter.sendMail({
    from:        config.from,
    to:          opts.to,
    cc:          opts.cc || undefined,
    bcc:         config.fromEmail, // BCC-to-self so every sent email lands in your inbox
    replyTo:     opts.replyTo || config.fromEmail,
    subject:     opts.subject,
    text:        opts.body,
    html:        opts.body.replace(/\n/g, "<br>"),
    attachments: opts.attachments?.map((a) => ({
      filename:    a.filename,
      content:     a.content,
      contentType: a.contentType,
    })),
  });
}
