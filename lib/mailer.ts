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
import { orgSmtpSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getValidGmailToken, sendGmail } from "@/lib/gmail";
import { getValidMicrosoftToken, sendMicrosoft } from "@/lib/microsoft";

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

  const host      = smtp?.host      || process.env.SMTP_HOST;
  const port      = smtp?.port      || parseInt(process.env.SMTP_PORT || "2525");
  const user      = smtp?.user      || process.env.SMTP_USER;
  const pass      = smtp?.pass      || process.env.SMTP_PASS;
  const fromEmail = smtp?.fromEmail || process.env.SMTP_FROM;
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
  // --- 1. Gmail ---
  const gmailToken = await getValidGmailToken(orgId);
  if (gmailToken) {
    await sendGmail(gmailToken.accessToken, gmailToken.email, {
      to:          opts.to,
      subject:     opts.subject,
      body:        opts.body,
      cc:          opts.cc,
      attachments: opts.attachments,
    });
    return { transport: "gmail", from: gmailToken.email };
  }

  // --- 2. Microsoft ---
  const msToken = await getValidMicrosoftToken(orgId);
  if (msToken) {
    await sendMicrosoft(msToken.accessToken, {
      to:          opts.to,
      subject:     opts.subject,
      body:        opts.body,
      cc:          opts.cc,
      attachments: opts.attachments,
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
  await sendSmtp(config, opts);
  return { transport: "smtp", from: config.fromEmail };
}

/**
 * Send an email via SMTP. Throws on failure.
 */
export async function sendSmtp(config: SmtpConfig, opts: MailOptions): Promise<void> {
  const transporter = nodemailer.createTransport({
    host:   config.host,
    port:   config.port,
    secure: false,
    auth:   { user: config.user, pass: config.pass },
  });

  // Merge caller CC with org-level default CC
  const ccParts = [
    opts.cc || null,
    config.ccEnabled && config.ccEmail ? config.ccEmail : null,
  ].filter(Boolean);
  const cc = ccParts.length > 0 ? ccParts.join(",") : undefined;

  await transporter.sendMail({
    from:        config.from,
    to:          opts.to,
    cc,
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
