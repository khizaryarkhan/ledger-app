/**
 * Shared SMTP mailer — used by the manual EmailComposer API, the
 * Automations trigger, and the scheduled cron.
 *
 * Reads SMTP credentials from:
 *   1. org_smtp_settings table (org-specific, set in Settings → Email)
 *   2. SMTP_* environment variables (global fallback)
 */

import * as nodemailer from "nodemailer";
import { db } from "@/db";
import { orgSmtpSettings } from "@/db/schema";
import { eq } from "drizzle-orm";

export interface MailOptions {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  replyTo?: string;
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
    from:    config.from,
    to:      opts.to,
    cc,
    bcc:     config.fromEmail, // BCC-to-self so every sent email lands in your inbox
    replyTo: opts.replyTo || config.fromEmail,
    subject: opts.subject,
    text:    opts.body,
    html:    opts.body.replace(/\n/g, "<br>"),
  });
}
