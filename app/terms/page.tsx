import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms governing use of the Service.",
};

// Public Terms of Service — required alongside the Privacy Policy for OAuth
// verification. Edit COMPANY / CONTACT below to your real details.
const COMPANY = "Prime Accountax";
const APP = "the Receivables application";
const CONTACT_EMAIL = "support@primeaccountax.com";
const LAST_UPDATED = "5 June 2026";

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white text-stone-800">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-semibold text-stone-900 tracking-tight">Terms of Service</h1>
        <p className="text-sm text-stone-500 mt-2">Last updated: {LAST_UPDATED}</p>

        <div className="mt-8 space-y-6 text-[15px] leading-relaxed">
          <p>
            These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and use of {APP} (the
            &ldquo;Service&rdquo;) provided by {COMPANY} (&ldquo;we&rdquo;, &ldquo;us&rdquo;). By accessing or
            using the Service, you agree to these Terms.
          </p>

          <section>
            <h2 className="text-lg font-semibold text-stone-900">1. The Service</h2>
            <p className="mt-2">
              The Service helps businesses manage accounts receivable — syncing accounting data from QuickBooks
              Online, tracking invoices and collections, and sending invoice reminders and statements through a
              mailbox you connect (Google, Microsoft, or SMTP).
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-stone-900">2. Accounts &amp; responsibilities</h2>
            <p className="mt-2">
              You are responsible for maintaining the confidentiality of your login credentials and for all
              activity under your account. You must provide accurate information and use the Service in
              compliance with applicable laws, including rules governing commercial email and debt collection in
              your jurisdiction.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-stone-900">3. Connected integrations</h2>
            <p className="mt-2">
              You authorize connections to third-party services (QuickBooks Online, Google, Microsoft) via
              OAuth. You are responsible for ensuring you have the right to access and send email from the
              accounts you connect, and for the content of emails you send through the Service. You may
              disconnect any integration at any time.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-stone-900">4. Acceptable use</h2>
            <p className="mt-2">
              You agree not to use the Service to send unlawful, deceptive, or abusive communications, to
              infringe any rights, or to attempt to disrupt or gain unauthorized access to the Service or other
              users&rsquo; data.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-stone-900">5. Data &amp; privacy</h2>
            <p className="mt-2">
              Your use of the Service is also governed by our{" "}
              <a className="text-blue-600 underline" href="/privacy">Privacy Policy</a>, which explains how we
              handle your data.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-stone-900">6. Disclaimers</h2>
            <p className="mt-2">
              The Service is provided &ldquo;as is&rdquo; without warranties of any kind. We do not guarantee
              that the Service will be uninterrupted or error-free, or that data synced from third parties will
              be complete or accurate.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-stone-900">7. Limitation of liability</h2>
            <p className="mt-2">
              To the maximum extent permitted by law, {COMPANY} will not be liable for any indirect, incidental,
              or consequential damages arising from your use of the Service.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-stone-900">8. Termination</h2>
            <p className="mt-2">
              You may stop using the Service at any time. We may suspend or terminate access for violations of
              these Terms. Upon termination, your right to use the Service ends.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-stone-900">9. Changes</h2>
            <p className="mt-2">
              We may update these Terms from time to time. Continued use of the Service after changes take
              effect constitutes acceptance of the revised Terms.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-stone-900">10. Contact</h2>
            <p className="mt-2">
              Questions about these Terms? Email us at{" "}
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
