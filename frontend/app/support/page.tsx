import Link from "next/link";

const LAST_UPDATED = "March 6, 2026";

export default function SupportPage() {
  return (
    <main className="page-shell">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Support</p>
          <h1>Support</h1>
          <p className="subtle">Where to report bugs, account issues, and abusive behavior during beta.</p>
          <p className="policy-meta">Last updated: {LAST_UPDATED}</p>
        </div>
      </section>

      <section className="table-panel policy-panel">
        <h3>How To Get Help</h3>
        <ol className="policy-list">
          <li>Use the in-app Feedback button for bug reports and feature requests.</li>
          <li>For sign-in or access issues, use the same beta invite channel used for onboarding.</li>
          <li>For abuse reports, include usernames, post/message links, and screenshots when available.</li>
        </ol>
      </section>

      <section className="table-panel policy-panel">
        <h3>Expected Response Times</h3>
        <ul className="policy-list">
          <li>Critical platform outage: target response within 4 hours.</li>
          <li>Login or transaction issues: target response within 24 hours.</li>
          <li>General feedback and feature requests: target response within 48 hours.</li>
        </ul>
      </section>

      <section className="table-panel policy-panel">
        <h3>Before You Report</h3>
        <ul className="policy-list">
          <li>Include exact page path, device, browser, and timestamp.</li>
          <li>Describe expected behavior vs actual behavior.</li>
          <li>If trading-related, include sport, player, side, quantity, and quote/execute outcome.</li>
        </ul>
        <p className="subtle">
          Related policies: <Link href="/terms">Terms</Link>, <Link href="/privacy">Privacy</Link>,{" "}
          <Link href="/community-guidelines">Community Guidelines</Link>.
        </p>
      </section>
    </main>
  );
}

