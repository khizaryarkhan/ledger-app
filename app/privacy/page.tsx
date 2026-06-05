import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How we collect, use, and protect your data.",
};

// Public Privacy Policy — required for Google/Microsoft OAuth verification and
// general SaaS compliance. Edit COMPANY / CONTACT below to your real details.
const COMPANY = "Prime Accountax";
const APP = "the Receivables application";
const CONTACT_EMAIL = "support@primeaccountax.com";
const LAST_UPDATED = "5 June 2026";

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-white text-stone-800">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-semibold text-stone-900 tracking-tight">Privacy Policy</h1>
        <p className="text-sm text-stone-500 mt-2">Last updated: {LAST_UPDATED}</p>

        <div className="prose prose-stone mt-8 space-y-6 text-[15px] leading-relaxed">
          <p>
            This Privacy Policy explains how {COMPANY} (&ldquo;we&rdquo;, &ldquo;us&rdquo;) collects, uses, and
            protects information when you use {APP} (the &ldquo;Service&rdquo;). By using the Service you agree
            to the practices described here.
          </p>

          <section>
            <h2 className="text-lg font-semibold text-stone-900">1. Information we collect</h2>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li><strong>Account information:</strong> your name, email address, and login credentials.</li>
              <li><strong>Accounting data:</strong> when you connect QuickBooks Online, we access invoices,
                customers, projects, payments, and related records to provide receivables management.</li>
              <li><strong>Email data:</strong> when you connect a Google, Microsoft, or SMTP mailbox, we use it
                solely to send the collection emails and invoice statements that you initiate or schedule.</li>
              <li><strong>Usage data:</strong> basic logs needed to operate and secure the Service.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-stone-900">2. How we use information</h2>
            <p className="mt-2">
              We use the information only to provide the Service: syncing your accounting data, displaying
              receivables, sending invoice reminders and statements on your behalf, recording customer
              responses, and supporting your account. We do not sell your data or use it for advertising.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-stone-900">3. Google API Services — Limited Use disclosure</h2>
            <p className="mt-2">
              {COMPANY}&rsquo;s use and transfer of information received from Google APIs to any other app will
              adhere to the{" "}
              <a className="text-blue-600 underline" href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">
                Google API Services User Data Policy
              </a>, including the Limited Use requirements. Specifically, we use the Gmail
              <code> gmail.send</code> permission only to send emails that you explicitly compose, trigger, or
              schedule within the Service. We do not read your mailbox, and we do not transfer, sell, or use
              Google user data for advertising, model training, or any purpose other than sending those emails.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-stone-900">4. Third-party services</h2>
            <p className="mt-2">
              We integrate with QuickBooks Online (Intuit), Google, and Microsoft to provide functionality.
              Connecting these services is optional and authorized by you via OAuth; you can disconnect them at
              any time in the Service&rsquo;s settings. Data is hosted on reputable cloud infrastructure
              (Vercel and Neon).
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-stone-900">5. Data security &amp; retention</h2>
            <p className="mt-2">
              Connections use OAuth tokens and encrypted (HTTPS) transport. We retain your data for as long as
              your account is active. You may request deletion of your data at any time by contacting us, after
              which we will remove it within a reasonable period, subject to legal obligations.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-stone-900">6. Your rights</h2>
            <p className="mt-2">
              You may access, correct, export, or delete your personal data, and revoke any connected
              integration, at any time. To exercise these rights, contact us at the address below.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-stone-900">7. Contact</h2>
            <p className="mt-2">
              Questions about this policy or your data? Email us at{" "}
              <a className="text-blue-600 underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
            </p>
          </section>

          <p className="text-sm text-stone-400 pt-6 border-t border-stone-200">
            © {new Date().getFullYear()} {COMPANY}. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
}
