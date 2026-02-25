"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost, isUnauthorizedError } from "@/lib/api";
import { formatCurrency, formatNumber, formatSignedNumber } from "@/lib/format";
import type {
  AdminIpoActionResult,
  AdminIpoPlayers,
  AdminIpoSport,
  AdminStatsPreview,
  AdminStatsPublishResult,
} from "@/lib/types";

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function statusClass(status: string): string {
  if (status === "READY") return "admin-status ready";
  if (status === "SKIPPED") return "admin-status skipped";
  return "admin-status error";
}

function listedClass(listed: boolean): string {
  return listed ? "admin-status ready" : "admin-status skipped";
}

export default function AdminStatsPage() {
  const router = useRouter();
  const defaultSeason = String(new Date().getFullYear());

  const [csvText, setCsvText] = useState("");
  const [weekOverride, setWeekOverride] = useState("");
  const [preview, setPreview] = useState<AdminStatsPreview | null>(null);
  const [publishResult, setPublishResult] = useState<AdminStatsPublishResult | null>(null);
  const [busyPreview, setBusyPreview] = useState(false);
  const [busyPublish, setBusyPublish] = useState(false);

  const [sportSummaries, setSportSummaries] = useState<AdminIpoSport[]>([]);
  const [reviewSport, setReviewSport] = useState("");
  const [review, setReview] = useState<AdminIpoPlayers | null>(null);
  const [ipoSeasonBySport, setIpoSeasonBySport] = useState<Record<string, string>>({});
  const [busyIpoAction, setBusyIpoAction] = useState("");
  const [ipoMessage, setIpoMessage] = useState("");

  const [error, setError] = useState("");

  const handleApiError = useCallback(
    (err: unknown) => {
      if (isUnauthorizedError(err)) {
        router.replace("/auth");
        return;
      }
      const message = toMessage(err);
      if (message.includes("403")) {
        setError("Admin access required. Sign in as an admin account to manage stats and IPO controls.");
        return;
      }
      setError(message);
    },
    [router],
  );

  const loadIpoSports = useCallback(async () => {
    try {
      const sports = await apiGet<AdminIpoSport[]>("/admin/ipo/sports");
      setSportSummaries(sports);
      setIpoSeasonBySport((previous) => {
        const next = { ...previous };
        for (const sport of sports) {
          if (!next[sport.sport]) {
            next[sport.sport] = String(sport.ipo_season ?? defaultSeason);
          }
        }
        return next;
      });
      setReviewSport((previous) => {
        if (!sports.length) return "";
        if (previous && sports.some((sport) => sport.sport === previous)) return previous;
        return sports[0].sport;
      });
    } catch (err: unknown) {
      handleApiError(err);
    }
  }, [defaultSeason, handleApiError]);

  const loadIpoReview = useCallback(
    async (sport: string) => {
      if (!sport) {
        setReview(null);
        return;
      }
      try {
        const result = await apiGet<AdminIpoPlayers>(
          `/admin/ipo/players?sport=${encodeURIComponent(sport)}&limit=500`,
        );
        setReview(result);
      } catch (err: unknown) {
        handleApiError(err);
      }
    },
    [handleApiError],
  );

  useEffect(() => {
    void loadIpoSports();
  }, [loadIpoSports]);

  useEffect(() => {
    if (!reviewSport) return;
    void loadIpoReview(reviewSport);
  }, [loadIpoReview, reviewSport]);

  function buildPayload(): { csv_text: string; week_override: number | null } | null {
    const trimmed = csvText.trim();
    if (!trimmed) {
      setError("Paste CSV data or upload a CSV file first.");
      return null;
    }

    if (!weekOverride.trim()) {
      return { csv_text: trimmed, week_override: null };
    }

    const parsedWeek = Number.parseInt(weekOverride.trim(), 10);
    if (!Number.isFinite(parsedWeek) || parsedWeek < 1) {
      setError("Week override must be a positive integer.");
      return null;
    }

    return {
      csv_text: trimmed,
      week_override: parsedWeek,
    };
  }

  function parseIpoSeason(sport: string): number | null {
    const raw = (ipoSeasonBySport[sport] ?? "").trim();
    if (!raw) {
      setError(`Enter a season year for ${sport} IPO launch.`);
      return null;
    }

    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 1900 || parsed > 2500) {
      setError(`Season for ${sport} must be a valid year.`);
      return null;
    }
    return parsed;
  }

  async function previewImport() {
    const payload = buildPayload();
    if (!payload) return;

    setBusyPreview(true);
    setError("");
    setPublishResult(null);
    try {
      const result = await apiPost<AdminStatsPreview>("/admin/stats/preview", payload);
      setPreview(result);
    } catch (err: unknown) {
      handleApiError(err);
    } finally {
      setBusyPreview(false);
    }
  }

  async function publishImport() {
    const payload = buildPayload();
    if (!payload) return;

    setBusyPublish(true);
    setError("");
    try {
      const result = await apiPost<AdminStatsPublishResult>("/admin/stats/publish", payload);
      setPublishResult(result);
      const updatedPreview = await apiPost<AdminStatsPreview>("/admin/stats/preview", payload);
      setPreview(updatedPreview);
    } catch (err: unknown) {
      handleApiError(err);
    } finally {
      setBusyPublish(false);
    }
  }

  async function launchIpo(sport: string) {
    const season = parseIpoSeason(sport);
    if (season == null) return;

    setBusyIpoAction(`launch:${sport}`);
    setError("");
    setIpoMessage("");
    try {
      const result = await apiPost<AdminIpoActionResult>("/admin/ipo/launch", { sport, season });
      setIpoMessage(result.message);
      setReviewSport(sport);
      await loadIpoSports();
      await loadIpoReview(sport);
    } catch (err: unknown) {
      handleApiError(err);
    } finally {
      setBusyIpoAction("");
    }
  }

  async function hideIpo(sport: string) {
    setBusyIpoAction(`hide:${sport}`);
    setError("");
    setIpoMessage("");
    try {
      const result = await apiPost<AdminIpoActionResult>("/admin/ipo/hide", { sport });
      setIpoMessage(result.message);
      setReviewSport(sport);
      await loadIpoSports();
      await loadIpoReview(sport);
    } catch (err: unknown) {
      handleApiError(err);
    } finally {
      setBusyIpoAction("");
    }
  }

  async function onFilePicked(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setCsvText(text);
      setError("");
    } catch (err: unknown) {
      setError(toMessage(err));
    } finally {
      event.target.value = "";
    }
  }

  const activeSportOptions = useMemo(
    () => sportSummaries.map((sport) => sport.sport),
    [sportSummaries],
  );

  return (
    <main className="page-shell">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Admin</p>
          <h1>IPO + Weekly Stats Control</h1>
          <p className="subtle">
            Review players by sport, launch IPO visibility per sport/season, and manage weekly stat imports.
          </p>
        </div>
      </section>

      <section className="table-panel">
        <h3>IPO Control Center</h3>
        {ipoMessage && <p className="success-box">{ipoMessage}</p>}
        {!sportSummaries.length ? (
          <p className="subtle">No sports found in the current player catalog.</p>
        ) : (
          <div className="admin-ipo-grid">
            {sportSummaries.map((summary) => (
              <article key={summary.sport} className="admin-ipo-card">
                <div className="admin-ipo-head">
                  <strong>{summary.sport}</strong>
                  <span className={summary.ipo_open ? "admin-status ready" : "admin-status skipped"}>
                    {summary.ipo_open ? "IPO Live" : "Hidden"}
                  </span>
                </div>
                <p className="subtle">
                  Listed {formatNumber(summary.listed_players)} / {formatNumber(summary.total_players)} players
                </p>
                <div className="admin-input-row">
                  <div>
                    <label className="field-label" htmlFor={`ipo-season-${summary.sport}`}>
                      IPO Season
                    </label>
                    <input
                      id={`ipo-season-${summary.sport}`}
                      inputMode="numeric"
                      value={ipoSeasonBySport[summary.sport] ?? ""}
                      onChange={(event) =>
                        setIpoSeasonBySport((previous) => ({
                          ...previous,
                          [summary.sport]: event.target.value,
                        }))
                      }
                      placeholder={defaultSeason}
                    />
                  </div>
                </div>
                <div className="admin-actions">
                  <button
                    className="primary-btn"
                    onClick={() => void launchIpo(summary.sport)}
                    disabled={busyIpoAction.length > 0}
                  >
                    {busyIpoAction === `launch:${summary.sport}` ? "Launching..." : `Launch ${summary.sport} IPO`}
                  </button>
                  <button
                    className="danger-btn"
                    onClick={() => void hideIpo(summary.sport)}
                    disabled={busyIpoAction.length > 0}
                  >
                    {busyIpoAction === `hide:${summary.sport}` ? "Hiding..." : `Hide ${summary.sport}`}
                  </button>
                  <button onClick={() => setReviewSport(summary.sport)} disabled={busyIpoAction.length > 0}>
                    Review Players
                  </button>
                </div>
                <p className="subtle">
                  {summary.ipo_open && summary.ipo_season
                    ? `Launched for season ${formatNumber(summary.ipo_season)}.`
                    : "Not launched."}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="table-panel">
        <h3>Sport Player Review</h3>
        <div className="admin-review-controls">
          <select value={reviewSport} onChange={(event) => setReviewSport(event.target.value)}>
            {activeSportOptions.map((sport) => (
              <option key={sport} value={sport}>
                {sport}
              </option>
            ))}
          </select>
          <button onClick={() => void loadIpoReview(reviewSport)} disabled={!reviewSport}>
            Refresh Sport Review
          </button>
        </div>

        {!review ? (
          <p className="subtle">Select a sport to inspect player listing status.</p>
        ) : (
          <>
            <p className="subtle">
              {review.sport}: listed {formatNumber(review.listed_players)} / {formatNumber(review.total_players)} players.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Team</th>
                    <th>Pos</th>
                    <th>Listed</th>
                    <th>IPO Season</th>
                    <th>Base Price</th>
                  </tr>
                </thead>
                <tbody>
                  {review.players.map((player) => (
                    <tr key={`${player.id}-${player.name}`}>
                      <td>{player.name}</td>
                      <td>{player.team}</td>
                      <td>{player.position}</td>
                      <td>
                        <span className={listedClass(player.listed)}>{player.listed ? "Yes" : "No"}</span>
                      </td>
                      <td>{player.ipo_season == null ? "--" : formatNumber(player.ipo_season)}</td>
                      <td>{formatCurrency(player.base_price, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="admin-panel">
        <label className="field-label" htmlFor="csv-text">
          CSV Data
        </label>
        <textarea
          id="csv-text"
          className="admin-textarea"
          value={csvText}
          onChange={(event) => setCsvText(event.target.value)}
          placeholder={"player_name,team,week,fantasy_points\nJosh Allen,BUF,1,27.4"}
        />

        <div className="admin-input-row">
          <div>
            <label className="field-label" htmlFor="week-override">
              Week Override (optional)
            </label>
            <input
              id="week-override"
              inputMode="numeric"
              value={weekOverride}
              onChange={(event) => setWeekOverride(event.target.value)}
              placeholder="e.g. 5"
            />
          </div>
          <div>
            <label className="field-label" htmlFor="csv-file">
              Upload CSV
            </label>
            <input id="csv-file" type="file" accept=".csv,text/csv" onChange={onFilePicked} />
          </div>
        </div>

        <div className="admin-actions">
          <button onClick={() => void previewImport()} disabled={busyPreview || busyPublish}>
            {busyPreview ? "Previewing..." : "Preview Import"}
          </button>
          <button className="primary-btn" onClick={() => void publishImport()} disabled={busyPublish || busyPreview}>
            {busyPublish ? "Publishing..." : "Publish Stats"}
          </button>
        </div>

        {error && <p className="error-box">{error}</p>}
      </section>

      {preview && (
        <section className="metrics-grid">
          <article className="kpi-card">
            <span>Rows</span>
            <strong>{formatNumber(preview.total_rows)}</strong>
          </article>
          <article className="kpi-card">
            <span>Ready</span>
            <strong>{formatNumber(preview.ready_count)}</strong>
          </article>
          <article className="kpi-card">
            <span>Skipped</span>
            <strong>{formatNumber(preview.skipped_count)}</strong>
          </article>
          <article className="kpi-card">
            <span>Errors</span>
            <strong>{formatNumber(preview.error_count)}</strong>
          </article>
        </section>
      )}

      {publishResult && (
        <section className="table-panel">
          <h3>Publish Result</h3>
          <p className="subtle">
            Applied {formatNumber(publishResult.applied_count)} updates ({formatNumber(publishResult.created_count)} new,{" "}
            {formatNumber(publishResult.updated_count)} updated). Skipped {formatNumber(publishResult.skipped_count)}.
            Errors {formatNumber(publishResult.error_count)}.
          </p>
        </section>
      )}

      {preview && (
        <section className="table-panel">
          <h3>Preview Rows</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Status</th>
                  <th>Input</th>
                  <th>Match</th>
                  <th>Week</th>
                  <th>Points</th>
                  <th>Existing</th>
                  <th>Delta</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={`${row.row_number}-${row.input_name}-${row.week}-${row.player_id ?? "none"}`}>
                    <td>{formatNumber(row.row_number)}</td>
                    <td>
                      <span className={statusClass(row.status)}>{row.status}</span>
                    </td>
                    <td>
                      {row.input_name}
                      {row.input_team ? ` (${row.input_team})` : ""}
                    </td>
                    <td>
                      {row.matched_name ? `${row.matched_name} (${row.matched_team})` : "--"}
                    </td>
                    <td>{row.week ?? "--"}</td>
                    <td>{row.fantasy_points == null ? "--" : formatNumber(row.fantasy_points, 2)}</td>
                    <td>{row.existing_points == null ? "--" : formatNumber(row.existing_points, 2)}</td>
                    <td>{row.delta_points == null ? "--" : formatSignedNumber(row.delta_points, 2)}</td>
                    <td>{row.message ?? "--"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
