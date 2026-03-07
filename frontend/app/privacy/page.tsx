import Link from "next/link";

const LAST_UPDATED = "March 6, 2026";

export default function PrivacyPage() {
  return (
    <main className="page-shell">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Policy</p>
          <h1>Privacy Policy</h1>
          <p className="subtle">What data is collected, why it is used, and how it is handled.</p>
          <p className="policy-meta">Last updated: {LAST_UPDATED}</p>
        </div>
      </section>

      <section className="table-panel policy-panel">
        <h3>Data We Collect</h3>
        <ul className="policy-list">
          <li>Account data: username, email address, password hash, session tokens, and account role flags.</li>
          <li>Profile data: avatar URL, bio, and public profile metadata.</li>
          <li>Activity data: trades, quotes, holdings, forum posts/comments, direct messages, and feedback reports.</li>
          <li>Operational logs: request metadata, errors, and service diagnostics.</li>
        </ul>
      </section>

      <section className="table-panel policy-panel">
        <h3>How We Use Data</h3>
        <ul className="policy-list">
          <li>To operate authentication, trading, portfolio, community, and messaging features.</li>
          <li>To support account recovery, account notices, and product communications where enabled.</li>
          <li>To detect abuse, enforce policies, and protect platform integrity.</li>
          <li>To troubleshoot reliability issues and improve product quality.</li>
        </ul>
      </section>

      <section className="table-panel policy-panel">
        <h3>Data Sharing and Processors</h3>
        <ul className="policy-list">
          <li>Data is processed by infrastructure providers used for hosting, database, and monitoring.</li>
          <li>We do not sell personal data.</li>
          <li>Data may be disclosed if required by law or to enforce platform safety and policy compliance.</li>
        </ul>
      </section>

      <section className="table-panel policy-panel">
        <h3>Retention and Account Requests</h3>
        <ul className="policy-list">
          <li>Data is retained for platform operation, security, and audit integrity.</li>
          <li>You can request account deletion or profile correction through the support process.</li>
          <li>Some records may be retained where legally required or needed for fraud prevention.</li>
        </ul>
        <p className="subtle">
          For support, visit <Link href="/support">Support</Link>. For conduct rules, see{" "}
          <Link href="/community-guidelines">Community Guidelines</Link>.
        </p>
      </section>
    </main>
  );
}
