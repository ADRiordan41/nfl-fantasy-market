import Link from "next/link";

const LAST_UPDATED = "March 6, 2026";

export default function TermsPage() {
  return (
    <main className="page-shell">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Policy</p>
          <h1>Terms of Use</h1>
          <p className="subtle">Rules for using MatchupMarket beta.</p>
          <p className="policy-meta">Last updated: {LAST_UPDATED}</p>
        </div>
      </section>

      <section className="table-panel policy-panel">
        <h3>1. Beta Service</h3>
        <ul className="policy-list">
          <li>MatchupMarket is provided as a beta product and can change without notice.</li>
          <li>Features, pricing logic, and data feeds may be updated, paused, or removed.</li>
          <li>Service availability is not guaranteed.</li>
        </ul>
      </section>

      <section className="table-panel policy-panel">
        <h3>2. Eligibility and Accounts</h3>
        <ul className="policy-list">
          <li>You are responsible for safeguarding your credentials and session access.</li>
          <li>You may not impersonate others or create abusive/spam accounts.</li>
          <li>Accounts can be suspended or terminated for policy violations.</li>
        </ul>
      </section>

      <section className="table-panel policy-panel">
        <h3>3. Market Simulation Disclaimer</h3>
        <ul className="policy-list">
          <li>MatchupMarket is not investment advice, brokerage, or financial planning.</li>
          <li>Prices and outcomes are simulation mechanics tied to platform rules.</li>
          <li>You are solely responsible for your actions taken on the platform.</li>
        </ul>
      </section>

      <section className="table-panel policy-panel">
        <h3>4. Prohibited Conduct</h3>
        <ul className="policy-list">
          <li>No exploitation, automation abuse, scraping abuse, or denial-of-service behavior.</li>
          <li>No harassment, hate speech, doxxing, threats, or illegal content.</li>
          <li>No attempts to bypass admin controls or security restrictions.</li>
          <li>No market manipulation, including coordinated pump-and-dump behavior, wash trading, or deceptive signals.</li>
          <li>No use of multiple accounts to gain unfair trading, messaging, voting, or moderation advantage.</li>
        </ul>
      </section>

      <section className="table-panel policy-panel">
        <h3>5. Liability and Changes</h3>
        <ul className="policy-list">
          <li>The service is provided &quot;as is&quot; without warranties.</li>
          <li>We are not liable for data loss, downtime, or indirect damages from beta use.</li>
          <li>Continued use after updates means acceptance of revised terms.</li>
        </ul>
        <p className="subtle">
          See also <Link href="/privacy">Privacy Policy</Link> and <Link href="/risk">Risk Disclosure</Link>.
        </p>
      </section>
    </main>
  );
}
