import Link from "next/link";

const LAST_UPDATED = "March 6, 2026";

export default function RiskPage() {
  return (
    <main className="page-shell">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Disclosure</p>
          <h1>Risk Disclosure</h1>
          <p className="subtle">Important risk and reliability disclosures for beta participants.</p>
          <p className="policy-meta">Last updated: {LAST_UPDATED}</p>
        </div>
      </section>

      <section className="table-panel policy-panel">
        <h3>Market and Pricing Risk</h3>
        <ul className="policy-list">
          <li>Player prices can move quickly from trade flow and live performance updates.</li>
          <li>Quote previews can differ from executed outcomes if market state changes before execution.</li>
          <li>Season and IPO controls can change which players are tradable.</li>
        </ul>
      </section>

      <section className="table-panel policy-panel">
        <h3>Data and Timing Risk</h3>
        <ul className="policy-list">
          <li>Live stats are dependent on external provider availability and polling intervals.</li>
          <li>Temporary delays, stale data, or corrected stats may occur.</li>
          <li>Displayed rankings, movers, and leaderboards are informational and may lag.</li>
        </ul>
      </section>

      <section className="table-panel policy-panel">
        <h3>Platform and Beta Risk</h3>
        <ul className="policy-list">
          <li>Downtime, bugs, and behavior changes are possible in beta.</li>
          <li>Administrative interventions may be required to protect market integrity.</li>
          <li>No guarantee is provided for uninterrupted access or error-free operation.</li>
        </ul>
      </section>

      <section className="table-panel policy-panel">
        <h3>Acknowledgement</h3>
        <p className="subtle">
          By using MatchupMarket beta, you acknowledge these risks and agree to the <Link href="/terms">Terms of Use</Link>.
        </p>
      </section>
    </main>
  );
}

