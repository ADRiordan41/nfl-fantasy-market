import Link from "next/link";

const LAST_UPDATED = "March 6, 2026";

export default function CommunityGuidelinesPage() {
  return (
    <main className="page-shell">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Policy</p>
          <h1>Community Guidelines</h1>
          <p className="subtle">Standards for forum and direct-message behavior on MatchupMarket.</p>
          <p className="policy-meta">Last updated: {LAST_UPDATED}</p>
        </div>
      </section>

      <section className="table-panel policy-panel">
        <h3>Expected Conduct</h3>
        <ul className="policy-list">
          <li>Debate ideas, not people.</li>
          <li>Use respectful language and keep discussion relevant to sports and trading topics.</li>
          <li>Flag harmful content instead of escalating conflicts.</li>
        </ul>
      </section>

      <section className="table-panel policy-panel">
        <h3>Not Allowed</h3>
        <ul className="policy-list">
          <li>Harassment, hate speech, sexual content, threats, or intimidation.</li>
          <li>Doxxing, impersonation, scams, spam, or malicious links.</li>
          <li>Sharing private account or personal data without consent.</li>
          <li>Market manipulation, including coordinated pump-and-dump behavior, wash trading, or deceptive signals.</li>
          <li>Operating multiple accounts to gain unfair trading, voting, messaging, or moderation advantage.</li>
        </ul>
      </section>

      <section className="table-panel policy-panel">
        <h3>Moderation Actions</h3>
        <ul className="policy-list">
          <li>Content can be removed when it violates policy or platform safety expectations.</li>
          <li>Accounts can receive warnings, temporary restrictions, or permanent suspension.</li>
          <li>Severe abuse may result in immediate account termination.</li>
        </ul>
      </section>

      <section className="table-panel policy-panel">
        <h3>How To Report</h3>
        <p className="subtle">
          Use the in-app Feedback button and include usernames, links, and evidence. For escalation routes, see{" "}
          <Link href="/support">Support</Link>.
        </p>
      </section>
    </main>
  );
}
