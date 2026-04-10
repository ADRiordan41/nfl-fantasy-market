"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiDelete, apiGet, apiPatch, apiPost, isUnauthorizedError } from "@/lib/api";
import { formatCurrency, formatNumber, formatSignedNumber } from "@/lib/format";
import { notifyError, notifySuccess } from "@/lib/toast";
import type {
  AdminActivityAudit,
  AdminBotPersona,
  AdminBotProfile,
  AdminDeleteUserResult,
  AdminFlattenUserEquityResult,
  AdminNormalizeHoldingsResult,
  AdminPricingConfig,
  AdminUserEquity,
  AdminUserListItem,
  AdminBotSimulationStatus,
  AdminFeedbackMessage,
  AdminIpoActionResult,
  AdminIpoPlayerCreateResult,
  AdminModerationReport,
  AdminIpoPlayers,
  AdminIpoSport,
  AdminSeasonEndingCloseoutResult,
  AdminSiteResetResult,
  AdminStatsBackfillMlbResult,
  AdminStatsClearSportResult,
  AdminStatsPreview,
  AdminStatsPublishResult,
  TradingStatus,
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
  const now = new Date();
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const [csvText, setCsvText] = useState("");
  const [weekOverride, setWeekOverride] = useState("");
  const [preview, setPreview] = useState<AdminStatsPreview | null>(null);
  const [publishResult, setPublishResult] = useState<AdminStatsPublishResult | null>(null);
  const [busyPreview, setBusyPreview] = useState(false);
  const [busyPublish, setBusyPublish] = useState(false);
  const [mlbBackfillStartDate, setMlbBackfillStartDate] = useState(todayIso);
  const [mlbBackfillEndDate, setMlbBackfillEndDate] = useState(todayIso);
  const [mlbBackfillWeek, setMlbBackfillWeek] = useState("1");
  const [mlbBackfillGameTypes, setMlbBackfillGameTypes] = useState("R,F,D,L,W,S");
  const [busyMlbBackfill, setBusyMlbBackfill] = useState(false);
  const [mlbBackfillResult, setMlbBackfillResult] = useState<AdminStatsBackfillMlbResult | null>(null);

  const [sportSummaries, setSportSummaries] = useState<AdminIpoSport[]>([]);
  const [reviewSport, setReviewSport] = useState("");
  const [review, setReview] = useState<AdminIpoPlayers | null>(null);
  const [ipoSeasonBySport, setIpoSeasonBySport] = useState<Record<string, string>>({});
  const [seiPayoutByPlayerId, setSeiPayoutByPlayerId] = useState<Record<number, string>>({});
  const [busyIpoAction, setBusyIpoAction] = useState("");
  const [ipoMessage, setIpoMessage] = useState("");
  const [newIpoSport, setNewIpoSport] = useState("NFL");
  const [newIpoName, setNewIpoName] = useState("");
  const [newIpoTeam, setNewIpoTeam] = useState("");
  const [newIpoPosition, setNewIpoPosition] = useState("");
  const [newIpoBasePrice, setNewIpoBasePrice] = useState("10");
  const [newIpoK, setNewIpoK] = useState("0.0025");
  const [newIpoListImmediately, setNewIpoListImmediately] = useState(true);
  const [newIpoSeason, setNewIpoSeason] = useState(defaultSeason);
  const [sportReviewOpen, setSportReviewOpen] = useState(false);
  const [tradingStatus, setTradingStatus] = useState<TradingStatus | null>(null);
  const [globalHaltReason, setGlobalHaltReason] = useState("");
  const [sportHaltReasonBySport, setSportHaltReasonBySport] = useState<Record<string, string>>({});
  const [busyTradingAction, setBusyTradingAction] = useState("");
  const [feedbackRows, setFeedbackRows] = useState<AdminFeedbackMessage[]>([]);
  const [feedbackStatusFilter, setFeedbackStatusFilter] = useState("ALL");
  const [busyFeedback, setBusyFeedback] = useState(false);
  const [selectedFeedbackId, setSelectedFeedbackId] = useState<number | null>(null);
  const [busyFeedbackAction, setBusyFeedbackAction] = useState("");
  const [moderationRows, setModerationRows] = useState<AdminModerationReport[]>([]);
  const [moderationStatusFilter, setModerationStatusFilter] = useState("OPEN");
  const [busyModeration, setBusyModeration] = useState(false);
  const [busyModerationAction, setBusyModerationAction] = useState("");
  const [activityAudit, setActivityAudit] = useState<AdminActivityAudit | null>(null);
  const [busyActivity, setBusyActivity] = useState(false);
  const [botProfiles, setBotProfiles] = useState<AdminBotProfile[]>([]);
  const [botPersonas, setBotPersonas] = useState<AdminBotPersona[]>([]);
  const [busyBots, setBusyBots] = useState(false);
  const [busyBotAction, setBusyBotAction] = useState("");
  const [newBotName, setNewBotName] = useState("");
  const [newBotUsername, setNewBotUsername] = useState("");
  const [newBotPersona, setNewBotPersona] = useState("lurker");
  const [newBotActive, setNewBotActive] = useState(true);
  const [botRunStatus, setBotRunStatus] = useState<AdminBotSimulationStatus | null>(null);
  const [botRunDurationSeconds, setBotRunDurationSeconds] = useState("300");
  const [botRunMinDelayMs, setBotRunMinDelayMs] = useState("800");
  const [botRunMaxDelayMs, setBotRunMaxDelayMs] = useState("2400");
  const [botRunStartupStaggerMs, setBotRunStartupStaggerMs] = useState("250");
  const [resetStartingCash, setResetStartingCash] = useState("100000.00");
  const [resetHideSports, setResetHideSports] = useState("MLB");
  const [resetConfirmation, setResetConfirmation] = useState("");
  const [busySiteReset, setBusySiteReset] = useState(false);
  const [siteResetResult, setSiteResetResult] = useState<AdminSiteResetResult | null>(null);
  const [busyNormalizeHoldings, setBusyNormalizeHoldings] = useState(false);
  const [normalizeHoldingsResult, setNormalizeHoldingsResult] = useState<AdminNormalizeHoldingsResult | null>(null);
  const [pricingConfig, setPricingConfig] = useState<AdminPricingConfig | null>(null);
  const [priceImpactInput, setPriceImpactInput] = useState("0.40");
  const [busyPricingConfig, setBusyPricingConfig] = useState(false);
  const [equityLookupUsername, setEquityLookupUsername] = useState("foreverhopeful");
  const [adminUsers, setAdminUsers] = useState<AdminUserListItem[]>([]);
  const [userPickerQuery, setUserPickerQuery] = useState("");
  const [busyAdminUsers, setBusyAdminUsers] = useState(false);
  const [busyEquityLookup, setBusyEquityLookup] = useState(false);
  const [equityLookupResult, setEquityLookupResult] = useState<AdminUserEquity | null>(null);
  const [busyFlattenUserEquity, setBusyFlattenUserEquity] = useState(false);
  const [flattenUserEquityResult, setFlattenUserEquityResult] = useState<AdminFlattenUserEquityResult | null>(null);
  const [busyDeleteUser, setBusyDeleteUser] = useState(false);
  const [deleteUserResult, setDeleteUserResult] = useState<AdminDeleteUserResult | null>(null);

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
        notifyError("Admin access required.");
        return;
      }
      setError(message);
      notifyError(message);
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

  const applyTradingStatus = useCallback((status: TradingStatus) => {
    setTradingStatus(status);
    setGlobalHaltReason(status.global_halt.halted ? status.global_halt.reason ?? "" : "");
    setSportHaltReasonBySport((previous) => {
      const next = { ...previous };
      for (const row of status.sport_halts) {
        next[row.sport] = row.halted ? row.reason ?? "" : "";
      }
      return next;
    });
  }, []);

  const loadTradingStatus = useCallback(async () => {
    try {
      const status = await apiGet<TradingStatus>("/admin/trading/halt");
      applyTradingStatus(status);
    } catch (err: unknown) {
      handleApiError(err);
    }
  }, [applyTradingStatus, handleApiError]);

  const loadAdminUsers = useCallback(async () => {
    setBusyAdminUsers(true);
    try {
      const trimmed = userPickerQuery.trim();
      const path = trimmed
        ? `/admin/users?q=${encodeURIComponent(trimmed)}&limit=250`
        : "/admin/users?limit=250";
      const rows = await apiGet<AdminUserListItem[]>(path);
      setAdminUsers(rows);
      if (rows.length && !rows.some((row) => row.username === equityLookupUsername)) {
        setEquityLookupUsername(rows[0].username);
      }
    } catch (err: unknown) {
      handleApiError(err);
    } finally {
      setBusyAdminUsers(false);
    }
  }, [equityLookupUsername, handleApiError, userPickerQuery]);

  const loadPricingConfig = useCallback(async () => {
    setBusyPricingConfig(true);
    try {
      const result = await apiGet<AdminPricingConfig>("/admin/pricing/config");
      setPricingConfig(result);
      setPriceImpactInput(result.price_impact_multiplier.toFixed(2));
    } catch (err: unknown) {
      handleApiError(err);
    } finally {
      setBusyPricingConfig(false);
    }
  }, [handleApiError]);

  const loadFeedback = useCallback(async () => {
    setBusyFeedback(true);
    try {
      const query =
        feedbackStatusFilter === "ALL"
          ? "/admin/feedback?limit=200"
          : `/admin/feedback?limit=200&status=${encodeURIComponent(feedbackStatusFilter)}`;
      const rows = await apiGet<AdminFeedbackMessage[]>(query);
      setFeedbackRows(rows);
    } catch (err: unknown) {
      handleApiError(err);
    } finally {
      setBusyFeedback(false);
    }
  }, [feedbackStatusFilter, handleApiError]);

  const selectedFeedback = useMemo(
    () => feedbackRows.find((row) => row.id === selectedFeedbackId) ?? feedbackRows[0] ?? null,
    [feedbackRows, selectedFeedbackId],
  );

  const loadModeration = useCallback(async () => {
    setBusyModeration(true);
    try {
      const query =
        moderationStatusFilter === "ALL"
          ? "/admin/moderation/reports?limit=200"
          : `/admin/moderation/reports?limit=200&status=${encodeURIComponent(moderationStatusFilter)}`;
      const rows = await apiGet<AdminModerationReport[]>(query);
      setModerationRows(rows);
    } catch (err: unknown) {
      handleApiError(err);
    } finally {
      setBusyModeration(false);
    }
  }, [handleApiError, moderationStatusFilter]);

  const loadActivity = useCallback(async () => {
    setBusyActivity(true);
    try {
      const audit = await apiGet<AdminActivityAudit>("/admin/activity?limit=20");
      setActivityAudit(audit);
    } catch (err: unknown) {
      handleApiError(err);
    } finally {
      setBusyActivity(false);
    }
  }, [handleApiError]);

  const loadBotControl = useCallback(async () => {
    setBusyBots(true);
    try {
      const [personas, bots] = await Promise.all([
        apiGet<AdminBotPersona[]>("/admin/bots/personas"),
        apiGet<AdminBotProfile[]>("/admin/bots"),
      ]);
      setBotPersonas(personas);
      setBotProfiles(bots);
      setNewBotPersona((previous) => previous || personas[0]?.key || "lurker");
    } catch (err: unknown) {
      handleApiError(err);
    } finally {
      setBusyBots(false);
    }
  }, [handleApiError]);

  const loadBotRunStatus = useCallback(async () => {
    try {
      const status = await apiGet<AdminBotSimulationStatus>("/admin/bots/run/status");
      setBotRunStatus(status);
    } catch (err: unknown) {
      handleApiError(err);
    }
  }, [handleApiError]);

  useEffect(() => {
    void loadIpoSports();
    void loadTradingStatus();
  }, [loadIpoSports, loadTradingStatus]);

  useEffect(() => {
    void loadPricingConfig();
  }, [loadPricingConfig]);

  useEffect(() => {
    void loadAdminUsers();
  }, [loadAdminUsers]);

  useEffect(() => {
    if (!reviewSport) return;
    void loadIpoReview(reviewSport);
  }, [loadIpoReview, reviewSport]);

  useEffect(() => {
    if (!sportSummaries.length) return;
    if (sportSummaries.some((row) => row.sport === newIpoSport)) return;
    setNewIpoSport(sportSummaries[0].sport);
  }, [newIpoSport, sportSummaries]);

  useEffect(() => {
    void loadFeedback();
  }, [loadFeedback]);

  useEffect(() => {
    if (!feedbackRows.length) {
      setSelectedFeedbackId(null);
      return;
    }
    if (selectedFeedbackId == null || !feedbackRows.some((row) => row.id === selectedFeedbackId)) {
      setSelectedFeedbackId(feedbackRows[0].id);
    }
  }, [feedbackRows, selectedFeedbackId]);

  useEffect(() => {
    void loadModeration();
  }, [loadModeration]);

  useEffect(() => {
    void loadActivity();
  }, [loadActivity]);

  useEffect(() => {
    void loadBotControl();
  }, [loadBotControl]);

  useEffect(() => {
    void loadBotRunStatus();
  }, [loadBotRunStatus]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadBotRunStatus();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [loadBotRunStatus]);

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
      notifySuccess("Stats preview loaded.");
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
      notifySuccess("Stats published.");
    } catch (err: unknown) {
      handleApiError(err);
    } finally {
      setBusyPublish(false);
    }
  }

  async function runMlbBackfill() {
    const startDate = mlbBackfillStartDate.trim();
    const endDate = mlbBackfillEndDate.trim() || startDate;
    if (!startDate) {
      setError("Start date is required for MLB backfill.");
      notifyError("Enter a start date first.");
      return;
    }
    if (!endDate) {
      setError("End date is required for MLB backfill.");
      notifyError("Enter an end date first.");
      return;
    }
    const parsedWeek = Number.parseInt(mlbBackfillWeek.trim(), 10);
    if (!Number.isFinite(parsedWeek) || parsedWeek < 1) {
      setError("MLB backfill week must be a positive integer.");
      notifyError("Invalid MLB week.");
      return;
    }
    const gameTypes = mlbBackfillGameTypes.trim() || "R,F,D,L,W,S";

    setBusyMlbBackfill(true);
    setError("");
    setMlbBackfillResult(null);
    try {
      const result = await apiPost<AdminStatsBackfillMlbResult>("/admin/stats/backfill-mlb", {
        start_date: startDate,
        end_date: endDate,
        week: parsedWeek,
        mlb_allowed_game_types: gameTypes,
      });
      setMlbBackfillResult(result);
      notifySuccess(result.message);
    } catch (err: unknown) {
      handleApiError(err);
    } finally {
      setBusyMlbBackfill(false);
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
      notifySuccess(result.message);
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
      notifySuccess(result.message);
      setReviewSport(sport);
      await loadIpoSports();
      await loadIpoReview(sport);
    } catch (err: unknown) {
      handleApiError(err);
    } finally {
      setBusyIpoAction("");
    }
  }

  async function updateGlobalTradingHalt(halted: boolean) {
    setBusyTradingAction("global");
    setError("");
    try {
      const status = await apiPost<TradingStatus>("/admin/trading/halt/global", {
        halted,
        reason: halted ? (globalHaltReason.trim() || null) : null,
      });
      applyTradingStatus(status);
      setIpoMessage(halted ? "Trading paused globally." : "Trading resumed globally.");
      notifySuccess(halted ? "Global trading paused." : "Global trading resumed.");
    } catch (err: unknown) {
      handleApiError(err);
    } finally {
      setBusyTradingAction("");
    }
  }

  async function clearSportStats(sport: string) {
    setBusyIpoAction(`clear-stats:${sport}`);
    setError("");
    try {
      const result = await apiPost<AdminStatsClearSportResult>("/admin/stats/clear-sport", { sport });
      setIpoMessage(result.message);
      notifySuccess(result.message);
      await loadIpoReview(sport);
    } catch (err: unknown) {
      handleApiError(err);
    } finally {
      setBusyIpoAction("");
    }
  }

  async function createIpoPlayer() {
    const sport = newIpoSport.trim().toUpperCase();
    const name = newIpoName.trim();
    const team = newIpoTeam.trim().toUpperCase();
    const position = newIpoPosition.trim().toUpperCase();
    if (!sport || !name || !team || !position) {
      setError("Sport, name, team, and position are required to add a player.");
      notifyError("Fill in sport, name, team, and position.");
      return;
    }
    const basePrice = Number.parseFloat(newIpoBasePrice.trim());
    if (!Number.isFinite(basePrice) || basePrice < 0) {
      setError("Base price must be a valid non-negative number.");
      notifyError("Invalid base price.");
      return;
    }
    const k = Number.parseFloat(newIpoK.trim());
    if (!Number.isFinite(k) || k <= 0) {
      setError("K must be a valid positive number.");
      notifyError("Invalid K value.");
      return;
    }

    let parsedSeason: number | null = null;
    if (newIpoListImmediately || newIpoSeason.trim()) {
      const parsed = Number.parseInt(newIpoSeason.trim(), 10);
      if (!Number.isFinite(parsed) || parsed < 1900 || parsed > 2500) {
        setError("Season must be a valid year.");
        notifyError("Invalid season year.");
        return;
      }
      parsedSeason = parsed;
    }

    setBusyIpoAction("create-player");
    setError("");
    setIpoMessage("");
    try {
      const result = await apiPost<AdminIpoPlayerCreateResult>("/admin/ipo/player/create", {
        sport,
        name,
        team,
        position,
        base_price: basePrice,
        k,
        list_immediately: newIpoListImmediately,
        season: parsedSeason,
      });
      setIpoMessage(result.message);
      notifySuccess(result.message);
      setNewIpoName("");
      setNewIpoTeam("");
      setNewIpoPosition("");
      setReviewSport(result.sport);
      await loadIpoSports();
      await loadIpoReview(result.sport);
    } catch (err: unknown) {
      handleApiError(err);
    } finally {
      setBusyIpoAction("");
    }
  }

  async function closeOutSeasonEndingInjury(player: { id: number; sport: string; name: string; listed: boolean }) {
    if (!player.listed) {
      notifyError("Player is already hidden.");
      return;
    }

    let payoutPrice: number | null = null;
    try {
      payoutPrice = parseOptionalPayoutPrice(seiPayoutByPlayerId[player.id] ?? "");
    } catch (err: unknown) {
      const message = toMessage(err);
      setError(message);
      notifyError(message);
      return;
    }

    const confirmMessage = payoutPrice == null
      ? `Close out all ${player.name} positions at current spot and delist this player?`
      : `Close out all ${player.name} positions at payout $${payoutPrice.toFixed(2)} and delist this player?`;
    if (!window.confirm(confirmMessage)) return;

    setBusyIpoAction(`closeout:${player.id}`);
    setError("");
    setIpoMessage("");
    try {
      const result = await apiPost<AdminSeasonEndingCloseoutResult>(
        "/admin/ipo/player/season-ending-closeout",
        {
          player_id: player.id,
          payout_price: payoutPrice,
          delist: true,
          reason: "SEASON_ENDING_INJURY",
        },
      );
      setIpoMessage(result.message);
      notifySuccess(result.message);
      setSeiPayoutByPlayerId((previous) => ({
        ...previous,
        [player.id]: "",
      }));
      await loadIpoSports();
      await loadIpoReview(player.sport);
    } catch (err: unknown) {
      handleApiError(err);
    } finally {
      setBusyIpoAction("");
    }
  }

  async function updateFeedbackStatus(feedbackId: number, status: "NEW" | "ACK" | "DONE") {
    setBusyFeedbackAction(`${feedbackId}:${status}`);
    setError("");
    try {
      const updated = await apiPatch<AdminFeedbackMessage>(`/admin/feedback/${feedbackId}`, { status });
      setFeedbackRows((previous) =>
        previous.map((row) => (row.id === feedbackId ? updated : row)),
      );
      setSelectedFeedbackId(updated.id);
      notifySuccess(`Feedback marked ${status}.`);
    } catch (err: unknown) {
      handleApiError(err);
    } finally {
      setBusyFeedbackAction("");
    }
  }

  async function runSiteReset() {
    if (resetConfirmation.trim() !== "RESET SITE") {
      setError('Type "RESET SITE" to confirm.');
      notifyError('Type "RESET SITE" to confirm.');
      return;
    }
    const startingCash = Number.parseFloat(resetStartingCash.trim());
    if (!Number.isFinite(startingCash) || startingCash < 0) {
      setError("Starting cash must be a valid non-negative number.");
      notifyError("Invalid starting cash.");
      return;
    }

    const hideSports = resetHideSports
      .split(",")
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean);

    setBusySiteReset(true);
    setError("");
    try {
      const result = await apiPost<AdminSiteResetResult>("/admin/site/reset", {
        starting_cash: startingCash,
        hide_sports: hideSports,
      });
      setSiteResetResult(result);
      setResetConfirmation("");
      notifySuccess(result.message);
      await Promise.all([
        loadIpoSports(),
        reviewSport ? loadIpoReview(reviewSport) : Promise.resolve(),
        loadActivity(),
      ]);
    } catch (err: unknown) {
      handleApiError(err);
    } finally {
      setBusySiteReset(false);
    }
  }

  async function normalizeOpenHoldings() {
    setBusyNormalizeHoldings(true);
    setError("");
    try {
      const result = await apiPost<AdminNormalizeHoldingsResult>("/admin/holdings/normalize-current", {});
      setNormalizeHoldingsResult(result);
      notifySuccess(result.message);
    } catch (err: unknown) {
      handleApiError(err);
    } finally {
      setBusyNormalizeHoldings(false);
    }
  }

  async function savePricingConfig() {
    const parsed = Number.parseFloat(priceImpactInput.trim());
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError("Trade impact multiplier must be a positive number.");
      notifyError("Invalid trade impact multiplier.");
      return;
    }
    setBusyPricingConfig(true);
    setError("");
    try {
      const result = await apiPost<AdminPricingConfig>("/admin/pricing/config", {
        price_impact_multiplier: parsed,
      });
      setPricingConfig(result);
      setPriceImpactInput(result.price_impact_multiplier.toFixed(2));
      notifySuccess(result.message ?? "Pricing controls updated.");
    } catch (err: unknown) {
      handleApiError(err);
    } finally {
      setBusyPricingConfig(false);
    }
  }

  function jumpToSection(sectionId: string) {
    document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function lookupUserEquity() {
    const trimmed = equityLookupUsername.trim();
    if (!trimmed) {
      setError("Enter a username to inspect.");
      notifyError("Username required.");
      return;
    }
    setBusyEquityLookup(true);
    setError("");
    try {
      const result = await apiGet<AdminUserEquity>(`/admin/users/${encodeURIComponent(trimmed)}/equity`);
      setEquityLookupResult(result);
      setFlattenUserEquityResult(null);
      setDeleteUserResult(null);
      notifySuccess(`Loaded equity snapshot for ${result.username}.`);
    } catch (err: unknown) {
      handleApiError(err);
    } finally {
      setBusyEquityLookup(false);
    }
  }

  async function flattenUserEquity() {
    const trimmed = equityLookupUsername.trim();
    if (!trimmed) {
      setError("Enter a username to flatten.");
      notifyError("Username required.");
      return;
    }
    setBusyFlattenUserEquity(true);
    setError("");
    try {
      const result = await apiPost<AdminFlattenUserEquityResult>(
        `/admin/users/${encodeURIComponent(trimmed)}/flatten-equity`,
        { target_equity: 100000 },
      );
      setFlattenUserEquityResult(result);
      const refreshed = await apiGet<AdminUserEquity>(`/admin/users/${encodeURIComponent(trimmed)}/equity`);
      setEquityLookupResult(refreshed);
      notifySuccess(result.message);
    } catch (err: unknown) {
      handleApiError(err);
    } finally {
      setBusyFlattenUserEquity(false);
    }
  }

  async function deleteUser() {
    const trimmed = equityLookupUsername.trim();
    if (!trimmed) {
      setError("Enter a username to delete.");
      notifyError("Username required.");
      return;
    }
    if (
      !window.confirm(`Delete user ${trimmed} and clear out their positions and related data? This cannot be undone.`)
    ) {
      return;
    }
    setBusyDeleteUser(true);
    setError("");
    try {
      const result = await apiDelete<AdminDeleteUserResult>(`/admin/users/${encodeURIComponent(trimmed)}`);
      setDeleteUserResult(result);
      setEquityLookupResult(null);
      setFlattenUserEquityResult(null);
      notifySuccess(result.message);
    } catch (err: unknown) {
      handleApiError(err);
    } finally {
      setBusyDeleteUser(false);
    }
  }

  async function updateSportTradingHalt(sport: string, halted: boolean) {
    setBusyTradingAction(`sport:${sport}`);
    setError("");
    try {
      const status = await apiPost<TradingStatus>("/admin/trading/halt/sport", {
        sport,
        halted,
        reason: halted ? (sportHaltReasonBySport[sport]?.trim() || null) : null,
      });
      applyTradingStatus(status);
      setIpoMessage(halted ? `${sport} trading paused.` : `${sport} trading resumed.`);
      notifySuccess(halted ? `${sport} trading paused.` : `${sport} trading resumed.`);
    } catch (err: unknown) {
      handleApiError(err);
    } finally {
      setBusyTradingAction("");
    }
  }

  async function resolveModerationReport(
    reportId: number,
    status: "RESOLVED" | "DISMISSED",
    action: "NONE" | "HIDE_CONTENT",
  ) {
    const key = `${reportId}:${status}:${action}`;
    setBusyModerationAction(key);
    setError("");
    try {
      await apiPost<AdminModerationReport>(`/admin/moderation/reports/${reportId}/resolve`, {
        status,
        action,
      });
      notifySuccess(action === "HIDE_CONTENT" ? "Content hidden and report resolved." : "Report updated.");
      await loadModeration();
    } catch (err: unknown) {
      handleApiError(err);
    } finally {
      setBusyModerationAction("");
    }
  }

  async function unhideModeratedContent(contentType: string, contentId: number) {
    const key = `unhide:${contentType}:${contentId}`;
    setBusyModerationAction(key);
    setError("");
    try {
      await apiPost<{ ok: boolean }>("/admin/moderation/content/unhide", {
        content_type: contentType,
        content_id: contentId,
      });
      notifySuccess("Content restored.");
      await loadModeration();
    } catch (err: unknown) {
      handleApiError(err);
    } finally {
      setBusyModerationAction("");
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

  function updateBotDraft(botId: number, patch: Partial<AdminBotProfile>) {
    setBotProfiles((previous) =>
      previous.map((bot) => (bot.id === botId ? { ...bot, ...patch } : bot)),
    );
  }

  async function createBotProfile() {
    const name = newBotName.trim();
    if (!name) {
      setError("Bot name is required.");
      return;
    }
    if (!newBotPersona.trim()) {
      setError("Choose a bot persona.");
      return;
    }

    setBusyBotAction("create");
    setError("");
    try {
      const created = await apiPost<AdminBotProfile>("/admin/bots", {
        name,
        username: newBotUsername.trim() || null,
        persona: newBotPersona,
        is_active: newBotActive,
      });
      setBotProfiles((previous) => [created, ...previous]);
      setNewBotName("");
      setNewBotUsername("");
      setNewBotActive(true);
      notifySuccess(`Added bot profile ${created.name}.`);
    } catch (err: unknown) {
      handleApiError(err);
    } finally {
      setBusyBotAction("");
    }
  }

  function parseRunNumber(raw: string, label: string): number | null {
    const parsed = Number.parseInt(raw.trim(), 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setError(`${label} must be a non-negative integer.`);
      return null;
    }
    return parsed;
  }

  function parseOptionalPayoutPrice(raw: string): number | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const parsed = Number.parseFloat(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error("Payout price must be a non-negative number.");
    }
    return parsed;
  }

  async function saveBotProfile(bot: AdminBotProfile) {
    setBusyBotAction(`save:${bot.id}`);
    setError("");
    try {
      const updated = await apiPatch<AdminBotProfile>(`/admin/bots/${bot.id}`, {
        name: bot.name.trim(),
        persona: bot.persona,
        is_active: bot.is_active,
      });
      setBotProfiles((previous) => previous.map((row) => (row.id === bot.id ? updated : row)));
      notifySuccess(`Saved ${updated.name}.`);
    } catch (err: unknown) {
      handleApiError(err);
    } finally {
      setBusyBotAction("");
    }
  }

  async function toggleBotProfile(bot: AdminBotProfile, isActive: boolean) {
    setBusyBotAction(`toggle:${bot.id}`);
    setError("");
    try {
      const updated = await apiPatch<AdminBotProfile>(`/admin/bots/${bot.id}`, {
        name: bot.name.trim(),
        persona: bot.persona,
        is_active: isActive,
      });
      setBotProfiles((previous) => previous.map((row) => (row.id === bot.id ? updated : row)));
      notifySuccess(isActive ? `${updated.name} activated.` : `${updated.name} deactivated.`);
    } catch (err: unknown) {
      handleApiError(err);
    } finally {
      setBusyBotAction("");
    }
  }

  async function startBotRun() {
    const durationSeconds = parseRunNumber(botRunDurationSeconds, "Duration");
    const minDelayMs = parseRunNumber(botRunMinDelayMs, "Min delay");
    const maxDelayMs = parseRunNumber(botRunMaxDelayMs, "Max delay");
    const startupStaggerMs = parseRunNumber(botRunStartupStaggerMs, "Startup stagger");
    if (
      durationSeconds == null ||
      minDelayMs == null ||
      maxDelayMs == null ||
      startupStaggerMs == null
    ) {
      return;
    }
    if (durationSeconds < 10) {
      setError("Duration must be at least 10 seconds.");
      return;
    }

    setBusyBotAction("run:start");
    setError("");
    try {
      const status = await apiPost<AdminBotSimulationStatus>("/admin/bots/run/start", {
        duration_seconds: durationSeconds,
        min_delay_ms: minDelayMs,
        max_delay_ms: maxDelayMs,
        startup_stagger_ms: startupStaggerMs,
        reuse_existing: true,
        spoof_forwarded_for: true,
      });
      setBotRunStatus(status);
      notifySuccess(status.message ?? "Bot simulation started.");
    } catch (err: unknown) {
      handleApiError(err);
    } finally {
      setBusyBotAction("");
    }
  }

  async function stopBotRun(force: boolean) {
    setBusyBotAction(force ? "run:force-stop" : "run:stop");
    setError("");
    try {
      const status = await apiPost<AdminBotSimulationStatus>(
        `/admin/bots/run/stop?force=${force ? "true" : "false"}`,
        {},
      );
      setBotRunStatus(status);
      notifySuccess(status.message ?? "Bot simulation updated.");
    } catch (err: unknown) {
      handleApiError(err);
    } finally {
      setBusyBotAction("");
    }
  }

  const activeSportOptions = useMemo(
    () => sportSummaries.map((sport) => sport.sport),
    [sportSummaries],
  );

  const availableBotPersonas = useMemo<AdminBotPersona[]>(
    () =>
      botPersonas.length
        ? botPersonas
        : [{ key: "lurker", label: "Lurker", description: "", market_maker: false }],
    [botPersonas],
  );
  const openModerationCount = useMemo(
    () => moderationRows.filter((row) => row.status === "OPEN").length,
    [moderationRows],
  );
  const newFeedbackCount = useMemo(
    () => feedbackRows.filter((row) => row.status === "NEW").length,
    [feedbackRows],
  );

  return (
    <main className="page-shell">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Admin</p>
          <h1>Admin Control Center</h1>
          <p className="subtle">
            Tune market behavior, manage users, review moderation, and run resets without digging through one endless tool list.
          </p>
        </div>
      </section>

      <section className="metrics-grid admin-kpi-grid">
        <article className="kpi-card">
          <span>Trade Impact</span>
          <strong>{pricingConfig ? pricingConfig.price_impact_multiplier.toFixed(2) : "--"}</strong>
        </article>
        <article className="kpi-card">
          <span>Sports</span>
          <strong>{formatNumber(sportSummaries.length)}</strong>
        </article>
        <article className="kpi-card">
          <span>Open Reports</span>
          <strong>{formatNumber(openModerationCount)}</strong>
        </article>
        <article className="kpi-card">
          <span>New Feedback</span>
          <strong>{formatNumber(newFeedbackCount)}</strong>
        </article>
      </section>

      <section className="table-panel">
        <div className="admin-jump-grid">
          <button type="button" onClick={() => jumpToSection("market-config")}>Market Controls</button>
          <button type="button" onClick={() => jumpToSection("user-tools")}>User Tools</button>
          <button type="button" onClick={() => jumpToSection("feedback-inbox")}>Feedback</button>
          <button type="button" onClick={() => jumpToSection("moderation")}>Moderation</button>
          <button type="button" onClick={() => jumpToSection("review")}>Player Review</button>
          <button type="button" onClick={() => jumpToSection("destructive-tools")}>Resets</button>
          <button type="button" onClick={() => jumpToSection("stats-import")}>Stats Import</button>
          <button type="button" onClick={() => jumpToSection("bots")}>Bots</button>
          <button type="button" onClick={() => jumpToSection("activity-audit")}>Activity</button>
        </div>
      </section>

      <section id="market-config" className="table-panel">
        <h3>Market Configuration</h3>
        <p className="subtle">
          Adjust how strongly each trade moves price. Higher values make low-volume markets feel more active but also easier to push around.
        </p>
        <div className="admin-settings-grid">
          <article className="admin-setting-card">
            <div className="admin-setting-head">
              <strong>Trade Impact Multiplier</strong>
              <span className="admin-status ready">Live</span>
            </div>
            <div className="admin-input-grid">
              <div>
                <label className="field-label" htmlFor="price-impact-input">
                  Current Multiplier
                </label>
                <input
                  id="price-impact-input"
                  inputMode="decimal"
                  value={priceImpactInput}
                  onChange={(event) => setPriceImpactInput(event.target.value)}
                  placeholder="0.40"
                />
              </div>
              <div>
                <label className="field-label" htmlFor="price-impact-default">
                  Default Multiplier
                </label>
                <input
                  id="price-impact-default"
                  value={pricingConfig ? pricingConfig.default_price_impact_multiplier.toFixed(2) : "--"}
                  disabled
                />
              </div>
            </div>
            <div className="admin-actions">
              <button className="primary-btn" onClick={() => void savePricingConfig()} disabled={busyPricingConfig}>
                {busyPricingConfig ? "Saving..." : "Save Pricing"}
              </button>
              <button onClick={() => void loadPricingConfig()} disabled={busyPricingConfig}>
                {busyPricingConfig ? "Refreshing..." : "Reload Pricing"}
              </button>
            </div>
            <p className="subtle">
              {pricingConfig?.message ?? "Use this to tune trade responsiveness without redeploying."}
            </p>
          </article>
        </div>
      </section>

      <section className="table-panel">
        <h3>IPO Control Center</h3>
        {ipoMessage && <p className="success-box" role="status">{ipoMessage}</p>}
        <div className="admin-ipo-create-panel">
          <h4>Add Midseason Prospect</h4>
          <div className="admin-input-grid">
            <div>
              <label className="field-label" htmlFor="new-ipo-sport">
                Sport
              </label>
              <select
                id="new-ipo-sport"
                value={newIpoSport}
                onChange={(event) => setNewIpoSport(event.target.value)}
              >
                {activeSportOptions.map((sport) => (
                  <option key={sport} value={sport}>
                    {sport}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="new-ipo-name">
                Player Name
              </label>
              <input
                id="new-ipo-name"
                value={newIpoName}
                onChange={(event) => setNewIpoName(event.target.value)}
                placeholder="Top Prospect"
              />
            </div>
            <div>
              <label className="field-label" htmlFor="new-ipo-team">
                Team
              </label>
              <input
                id="new-ipo-team"
                value={newIpoTeam}
                onChange={(event) => setNewIpoTeam(event.target.value)}
                placeholder="NYY"
              />
            </div>
            <div>
              <label className="field-label" htmlFor="new-ipo-position">
                Position
              </label>
              <input
                id="new-ipo-position"
                value={newIpoPosition}
                onChange={(event) => setNewIpoPosition(event.target.value)}
                placeholder="OF"
              />
            </div>
            <div>
              <label className="field-label" htmlFor="new-ipo-base-price">
                Base Price
              </label>
              <input
                id="new-ipo-base-price"
                inputMode="decimal"
                value={newIpoBasePrice}
                onChange={(event) => setNewIpoBasePrice(event.target.value)}
                placeholder="10"
              />
            </div>
            <div>
              <label className="field-label" htmlFor="new-ipo-k">
                K
              </label>
              <input
                id="new-ipo-k"
                inputMode="decimal"
                value={newIpoK}
                onChange={(event) => setNewIpoK(event.target.value)}
                placeholder="0.0025"
              />
            </div>
            <div>
              <label className="field-label" htmlFor="new-ipo-season">
                IPO Season
              </label>
              <input
                id="new-ipo-season"
                inputMode="numeric"
                value={newIpoSeason}
                onChange={(event) => setNewIpoSeason(event.target.value)}
                placeholder={defaultSeason}
              />
            </div>
            <div className="admin-ipo-checkbox-wrap">
              <label className="field-label" htmlFor="new-ipo-list-now">
                Listing
              </label>
              <label className="admin-ipo-inline-checkbox" htmlFor="new-ipo-list-now">
                <input
                  id="new-ipo-list-now"
                  type="checkbox"
                  checked={newIpoListImmediately}
                  onChange={(event) => setNewIpoListImmediately(event.target.checked)}
                />
                List immediately
              </label>
            </div>
          </div>
          <div className="admin-actions">
            <button
              className="primary-btn"
              type="button"
              onClick={() => void createIpoPlayer()}
              disabled={busyIpoAction.length > 0}
            >
              {busyIpoAction === "create-player" ? "Adding..." : "Add Prospect + IPO"}
            </button>
          </div>
        </div>
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
                <div className="admin-ipo-season-row">
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
                  <button
                    className="danger-btn"
                    onClick={() => void clearSportStats(summary.sport)}
                    disabled={busyIpoAction.length > 0}
                  >
                    {busyIpoAction === `clear-stats:${summary.sport}` ? "Clearing..." : `Clear ${summary.sport} Stats`}
                  </button>
                </div>
                <div className="admin-trading-card-controls">
                  <div className="admin-trading-status-line">
                    <span className={summary.sport && tradingStatus?.sport_halts.find((row) => row.sport === summary.sport)?.halted ? "admin-status error" : "admin-status ready"}>
                      {tradingStatus?.sport_halts.find((row) => row.sport === summary.sport)?.halted ? "Trading Paused" : "Trading Live"}
                    </span>
                  </div>
                  <label className="field-label" htmlFor={`halt-reason-${summary.sport}`}>
                    Halt Reason (optional)
                  </label>
                  <input
                    id={`halt-reason-${summary.sport}`}
                    value={sportHaltReasonBySport[summary.sport] ?? ""}
                    onChange={(event) =>
                      setSportHaltReasonBySport((previous) => ({
                        ...previous,
                        [summary.sport]: event.target.value,
                      }))
                    }
                    placeholder={`Reason for ${summary.sport} halt`}
                  />
                  <div className="admin-actions">
                    <button
                      className="danger-btn"
                      onClick={() => void updateSportTradingHalt(summary.sport, true)}
                      disabled={busyTradingAction.length > 0}
                    >
                      {busyTradingAction === `sport:${summary.sport}` ? "Saving..." : `Pause ${summary.sport}`}
                    </button>
                    <button
                      className="primary-btn"
                      onClick={() => void updateSportTradingHalt(summary.sport, false)}
                      disabled={busyTradingAction.length > 0}
                    >
                      {busyTradingAction === `sport:${summary.sport}` ? "Saving..." : `Resume ${summary.sport}`}
                    </button>
                  </div>
                </div>
                <p className="subtle">
                  {summary.ipo_open && summary.ipo_season
                    ? `Launched for season ${String(summary.ipo_season)}.`
                    : "Not launched."}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="table-panel">
        <h3>Global Trading Controls</h3>
        <div className="admin-trading-global">
          <div className="admin-trading-status-line">
            <span className={tradingStatus?.global_halt.halted ? "admin-status error" : "admin-status ready"}>
              {tradingStatus?.global_halt.halted ? "Global Trading Paused" : "Global Trading Live"}
            </span>
          </div>
          <label className="field-label" htmlFor="global-halt-reason">
            Global Halt Reason (optional)
          </label>
          <input
            id="global-halt-reason"
            value={globalHaltReason}
            onChange={(event) => setGlobalHaltReason(event.target.value)}
            placeholder="Reason for global halt"
          />
          <div className="admin-actions">
            <button
              className="danger-btn"
              onClick={() => void updateGlobalTradingHalt(true)}
              disabled={busyTradingAction.length > 0}
            >
              {busyTradingAction === "global" ? "Saving..." : "Pause All Trading"}
            </button>
            <button
              className="primary-btn"
              onClick={() => void updateGlobalTradingHalt(false)}
              disabled={busyTradingAction.length > 0}
            >
              {busyTradingAction === "global" ? "Saving..." : "Resume All Trading"}
            </button>
          </div>
        </div>
      </section>

      <section id="activity-audit" className="table-panel">
        <h3>Activity Audit</h3>
        <div className="admin-review-controls">
          <div className="subtle">
            {activityAudit
              ? `Generated ${new Date(activityAudit.generated_at).toLocaleString()}`
              : "Load recent sessions, trades, forum activity, and direct messages."}
          </div>
          <button onClick={() => void loadActivity()} disabled={busyActivity}>
            {busyActivity ? "Refreshing..." : "Refresh Activity"}
          </button>
        </div>

        {!activityAudit ? (
          <p className="subtle">No activity audit loaded yet.</p>
        ) : (
          <>
            <div className="metrics-grid">
              <article className="kpi-card">
                <span>Active Sessions</span>
                <strong>{formatNumber(activityAudit.active_sessions_count)}</strong>
              </article>
              <article className="kpi-card">
                <span>Recent Trades</span>
                <strong>{formatNumber(activityAudit.recent_transactions.length)}</strong>
              </article>
              <article className="kpi-card">
                <span>Forum Posts</span>
                <strong>{formatNumber(activityAudit.recent_forum_posts.length)}</strong>
              </article>
              <article className="kpi-card">
                <span>Direct Messages</span>
                <strong>{formatNumber(activityAudit.recent_direct_messages.length)}</strong>
              </article>
            </div>

            <div className="admin-audit-grid">
              <div>
                <h4>Active Sessions</h4>
                {!activityAudit.active_sessions.length ? (
                  <p className="subtle">No active sessions.</p>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>User</th>
                          <th>Status</th>
                          <th>Started</th>
                          <th>Expires</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activityAudit.active_sessions.map((row) => (
                          <tr key={`active-session-${row.id}`}>
                            <td>
                              {row.username} (#{row.user_id})
                            </td>
                            <td>{row.status}</td>
                            <td>{new Date(row.created_at).toLocaleString()}</td>
                            <td>{new Date(row.expires_at).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div>
                <h4>Recent Sessions</h4>
                {!activityAudit.recent_sessions.length ? (
                  <p className="subtle">No recent sessions.</p>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>User</th>
                          <th>Status</th>
                          <th>Started</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activityAudit.recent_sessions.map((row) => (
                          <tr key={`recent-session-${row.id}`}>
                            <td>
                              {row.username} (#{row.user_id})
                            </td>
                            <td>{row.status}</td>
                            <td>{new Date(row.created_at).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            <div className="admin-audit-grid">
              <div>
                <h4>Recent Trades</h4>
                {!activityAudit.recent_transactions.length ? (
                  <p className="subtle">No recent trades.</p>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Time</th>
                          <th>User</th>
                          <th>Player</th>
                          <th>Type</th>
                          <th>Shares</th>
                          <th>Net</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activityAudit.recent_transactions.map((row) => (
                          <tr key={`trade-${row.id}`}>
                            <td>{new Date(row.created_at).toLocaleString()}</td>
                            <td>{row.username}</td>
                            <td>{row.player_name ?? "--"}</td>
                            <td>{row.trade_type}</td>
                            <td>{formatNumber(row.shares, 0)}</td>
                            <td>{formatCurrency(row.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div>
                <h4>Recent Direct Messages</h4>
                {!activityAudit.recent_direct_messages.length ? (
                  <p className="subtle">No recent direct messages.</p>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Time</th>
                          <th>From</th>
                          <th>To</th>
                          <th>Message</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activityAudit.recent_direct_messages.map((row) => (
                          <tr key={`dm-${row.id}`}>
                            <td>{new Date(row.created_at).toLocaleString()}</td>
                            <td>{row.sender_username}</td>
                            <td>{row.recipient_username}</td>
                            <td>{row.body_preview}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            <div className="admin-audit-grid">
              <div>
                <h4>Recent Forum Posts</h4>
                {!activityAudit.recent_forum_posts.length ? (
                  <p className="subtle">No recent forum posts.</p>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Time</th>
                          <th>User</th>
                          <th>Title</th>
                          <th>Comments</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activityAudit.recent_forum_posts.map((row) => (
                          <tr key={`post-${row.id}`}>
                            <td>{new Date(row.created_at).toLocaleString()}</td>
                            <td>{row.username}</td>
                            <td>{row.title}</td>
                            <td>{formatNumber(row.comment_count)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div>
                <h4>Recent Forum Comments</h4>
                {!activityAudit.recent_forum_comments.length ? (
                  <p className="subtle">No recent forum comments.</p>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Time</th>
                          <th>User</th>
                          <th>Post</th>
                          <th>Comment</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activityAudit.recent_forum_comments.map((row) => (
                          <tr key={`comment-${row.id}`}>
                            <td>{new Date(row.created_at).toLocaleString()}</td>
                            <td>{row.username}</td>
                            <td>{row.post_title}</td>
                            <td>{row.body_preview}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </section>

      <section id="bots" className="table-panel">
        <h3>Synthetic Bot Control</h3>
        <p className="subtle">
          Create named bot profiles, choose personas, and toggle which profiles are active for simulator runs.
          Active profiles can be loaded by `python backend/scripts/simulate_users.py --use-admin-bots --admin-token &lt;token&gt;`.
        </p>

        <div className="admin-input-row">
          <div>
            <label className="field-label" htmlFor="new-bot-name">
              Bot Name
            </label>
            <input
              id="new-bot-name"
              value={newBotName}
              onChange={(event) => setNewBotName(event.target.value)}
              placeholder="Market Maker Alpha"
            />
          </div>
          <div>
            <label className="field-label" htmlFor="new-bot-username">
              Username Override
            </label>
            <input
              id="new-bot-username"
              value={newBotUsername}
              onChange={(event) => setNewBotUsername(event.target.value)}
              placeholder="optional custom username"
            />
          </div>
        </div>

        <div className="admin-input-row">
          <div>
            <label className="field-label" htmlFor="new-bot-persona">
              Persona
            </label>
            <select id="new-bot-persona" value={newBotPersona} onChange={(event) => setNewBotPersona(event.target.value)}>
              {availableBotPersonas.map((persona) => (
                <option key={persona.key} value={persona.key}>
                  {persona.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="new-bot-status">
              Status
            </label>
            <select
              id="new-bot-status"
              value={newBotActive ? "active" : "inactive"}
              onChange={(event) => setNewBotActive(event.target.value === "active")}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>

        <div className="admin-actions">
          <button className="primary-btn" onClick={() => void createBotProfile()} disabled={busyBotAction.length > 0}>
            {busyBotAction === "create" ? "Adding..." : "Add Bot Profile"}
          </button>
          <button onClick={() => void loadBotControl()} disabled={busyBots || busyBotAction.length > 0}>
            {busyBots ? "Refreshing..." : "Refresh Bot Profiles"}
          </button>
        </div>

        <div className="admin-input-row">
          <div>
            <label className="field-label" htmlFor="bot-run-duration">
              Run Duration (seconds)
            </label>
            <input
              id="bot-run-duration"
              inputMode="numeric"
              value={botRunDurationSeconds}
              onChange={(event) => setBotRunDurationSeconds(event.target.value)}
              placeholder="300"
            />
          </div>
          <div>
            <label className="field-label" htmlFor="bot-run-min-delay">
              Min Delay (ms)
            </label>
            <input
              id="bot-run-min-delay"
              inputMode="numeric"
              value={botRunMinDelayMs}
              onChange={(event) => setBotRunMinDelayMs(event.target.value)}
              placeholder="800"
            />
          </div>
        </div>

        <div className="admin-input-row">
          <div>
            <label className="field-label" htmlFor="bot-run-max-delay">
              Max Delay (ms)
            </label>
            <input
              id="bot-run-max-delay"
              inputMode="numeric"
              value={botRunMaxDelayMs}
              onChange={(event) => setBotRunMaxDelayMs(event.target.value)}
              placeholder="2400"
            />
          </div>
          <div>
            <label className="field-label" htmlFor="bot-run-stagger">
              Startup Stagger (ms)
            </label>
            <input
              id="bot-run-stagger"
              inputMode="numeric"
              value={botRunStartupStaggerMs}
              onChange={(event) => setBotRunStartupStaggerMs(event.target.value)}
              placeholder="250"
            />
          </div>
        </div>

        <div className="admin-actions">
          <button
            className="primary-btn"
            onClick={() => void startBotRun()}
            disabled={busyBotAction.length > 0 || botRunStatus?.running === true}
          >
            {busyBotAction === "run:start" ? "Starting..." : "Start Background Simulation"}
          </button>
          <button
            onClick={() => void stopBotRun(false)}
            disabled={busyBotAction.length > 0 || botRunStatus?.running !== true}
          >
            {busyBotAction === "run:stop" ? "Stopping..." : "Stop Simulation"}
          </button>
          <button
            className="danger-btn"
            onClick={() => void stopBotRun(true)}
            disabled={busyBotAction.length > 0 || botRunStatus?.running !== true}
          >
            {busyBotAction === "run:force-stop" ? "Stopping..." : "Force Stop"}
          </button>
          <button onClick={() => void loadBotRunStatus()} disabled={busyBotAction.length > 0}>
            Refresh Run Status
          </button>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>PID</th>
                <th>Bots</th>
                <th>Started</th>
                <th>Completed</th>
                <th>Files</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <span className={botRunStatus?.running ? "admin-status ready" : "admin-status skipped"}>
                    {botRunStatus?.running ? "Running" : "Idle"}
                  </span>
                  {botRunStatus?.exit_code != null && !botRunStatus.running ? (
                    <div className="subtle">Exit code: {botRunStatus.exit_code}</div>
                  ) : null}
                  {botRunStatus?.message ? <div className="subtle">{botRunStatus.message}</div> : null}
                </td>
                <td>{botRunStatus?.pid ?? "--"}</td>
                <td>{botRunStatus?.active_bot_count ?? 0}</td>
                <td>{botRunStatus?.started_at ? new Date(botRunStatus.started_at).toLocaleString() : "--"}</td>
                <td>{botRunStatus?.completed_at ? new Date(botRunStatus.completed_at).toLocaleString() : "--"}</td>
                <td>
                  <div className="subtle">Log: {botRunStatus?.log_file ?? "--"}</div>
                  <div className="subtle">Summary: {botRunStatus?.summary_file ?? "--"}</div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {!!botPersonas.length && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Persona</th>
                  <th>Description</th>
                  <th>Role</th>
                </tr>
              </thead>
              <tbody>
                {botPersonas.map((persona) => (
                  <tr key={persona.key}>
                    <td>{persona.label}</td>
                    <td>{persona.description}</td>
                    <td>{persona.market_maker ? "Market Maker" : "User Sim"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!botProfiles.length ? (
          <p className="subtle">No bot profiles yet. Add one above to start building a saved bot roster.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Username</th>
                  <th>Persona</th>
                  <th>Status</th>
                  <th>Account</th>
                  <th>Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {botProfiles.map((bot) => (
                  <tr key={bot.id}>
                    <td>
                      <input
                        value={bot.name}
                        onChange={(event) => updateBotDraft(bot.id, { name: event.target.value })}
                        aria-label={`Bot name for ${bot.username}`}
                      />
                    </td>
                    <td>
                      <div>{bot.username}</div>
                      <div className="subtle">Saved username</div>
                    </td>
                    <td>
                      <select
                        value={bot.persona}
                        onChange={(event) => updateBotDraft(bot.id, { persona: event.target.value })}
                        aria-label={`Persona for ${bot.name}`}
                      >
                        {availableBotPersonas.map((persona) => (
                          <option key={persona.key} value={persona.key}>
                            {persona.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <span className={bot.is_active ? "admin-status ready" : "admin-status skipped"}>
                        {bot.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td>
                      <span className={bot.account_exists ? "admin-status ready" : "admin-status skipped"}>
                        {bot.account_exists ? "Created" : "Pending"}
                      </span>
                    </td>
                    <td>{new Date(bot.updated_at).toLocaleString()}</td>
                    <td>
                      <div className="admin-actions">
                        <button
                          className="primary-btn"
                          onClick={() => void saveBotProfile(bot)}
                          disabled={busyBotAction.length > 0}
                        >
                          {busyBotAction === `save:${bot.id}` ? "Saving..." : "Save"}
                        </button>
                        <button
                          onClick={() => void toggleBotProfile(bot, !bot.is_active)}
                          disabled={busyBotAction.length > 0}
                        >
                          {busyBotAction === `toggle:${bot.id}`
                            ? "Saving..."
                            : bot.is_active
                              ? "Deactivate"
                              : "Activate"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section id="feedback-inbox" className="table-panel">
        <h3>Feedback Inbox</h3>
        <div className="admin-review-controls">
          <select value={feedbackStatusFilter} onChange={(event) => setFeedbackStatusFilter(event.target.value)}>
            <option value="ALL">All Statuses</option>
            <option value="NEW">New</option>
            <option value="ACK">Acknowledged</option>
            <option value="DONE">Done</option>
          </select>
          <button onClick={() => void loadFeedback()} disabled={busyFeedback}>
            {busyFeedback ? "Refreshing..." : "Refresh Feedback"}
          </button>
        </div>
        {!feedbackRows.length ? (
          <p className="subtle">No feedback messages for this filter.</p>
        ) : (
          <div className="admin-feedback-layout">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>User</th>
                    <th>Page</th>
                    <th>Status</th>
                    <th>Message</th>
                    <th>Open</th>
                  </tr>
                </thead>
                <tbody>
                  {feedbackRows.map((row) => (
                    <tr
                      key={row.id}
                      className={selectedFeedback?.id === row.id ? "admin-row-selected" : ""}
                    >
                      <td>{new Date(row.created_at).toLocaleString()}</td>
                      <td>
                        {row.username} (#{row.user_id})
                      </td>
                      <td>{row.page_path ?? "--"}</td>
                      <td>
                        <span
                          className={
                            row.status === "DONE"
                              ? "admin-status ready"
                              : row.status === "ACK"
                                ? "admin-status skipped"
                                : "admin-status error"
                          }
                        >
                          {row.status}
                        </span>
                      </td>
                      <td>{row.message.length > 90 ? `${row.message.slice(0, 90)}...` : row.message}</td>
                      <td>
                        <button type="button" onClick={() => setSelectedFeedbackId(row.id)}>
                          Open
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {selectedFeedback && (
              <section className="admin-feedback-detail" aria-label="Feedback details">
                <div className="admin-feedback-detail-head">
                  <div>
                    <h4>Message Detail</h4>
                    <p className="subtle">
                      {selectedFeedback.username} (#{selectedFeedback.user_id}) •{" "}
                      {new Date(selectedFeedback.created_at).toLocaleString()}
                    </p>
                  </div>
                  <span
                    className={
                      selectedFeedback.status === "DONE"
                        ? "admin-status ready"
                        : selectedFeedback.status === "ACK"
                          ? "admin-status skipped"
                          : "admin-status error"
                    }
                  >
                    {selectedFeedback.status}
                  </span>
                </div>

                <div className="admin-feedback-meta">
                  <div>
                    <strong>User</strong>
                    <a href={`/profile/${selectedFeedback.username}`}>{selectedFeedback.username}</a>
                  </div>
                  <div>
                    <strong>Page</strong>
                    {selectedFeedback.page_path ? (
                      <a href={selectedFeedback.page_path}>{selectedFeedback.page_path}</a>
                    ) : (
                      <span>--</span>
                    )}
                  </div>
                </div>

                <div className="admin-feedback-message">
                  <strong>Message</strong>
                  <p>{selectedFeedback.message}</p>
                </div>

                <div className="admin-actions">
                  <button
                    type="button"
                    onClick={() => void updateFeedbackStatus(selectedFeedback.id, "NEW")}
                    disabled={busyFeedbackAction.length > 0 || selectedFeedback.status === "NEW"}
                  >
                    {busyFeedbackAction === `${selectedFeedback.id}:NEW` ? "Saving..." : "Mark New"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void updateFeedbackStatus(selectedFeedback.id, "ACK")}
                    disabled={busyFeedbackAction.length > 0 || selectedFeedback.status === "ACK"}
                  >
                    {busyFeedbackAction === `${selectedFeedback.id}:ACK` ? "Saving..." : "Acknowledge"}
                  </button>
                  <button
                    type="button"
                    className="primary-btn"
                    onClick={() => void updateFeedbackStatus(selectedFeedback.id, "DONE")}
                    disabled={busyFeedbackAction.length > 0 || selectedFeedback.status === "DONE"}
                  >
                    {busyFeedbackAction === `${selectedFeedback.id}:DONE` ? "Saving..." : "Mark Done"}
                  </button>
                </div>
              </section>
            )}
          </div>
        )}
      </section>

      <section id="moderation" className="table-panel">
        <h3>Moderation Queue</h3>
        <div className="admin-review-controls">
          <select value={moderationStatusFilter} onChange={(event) => setModerationStatusFilter(event.target.value)}>
            <option value="OPEN">Open</option>
            <option value="RESOLVED">Resolved</option>
            <option value="DISMISSED">Dismissed</option>
            <option value="ALL">All Statuses</option>
          </select>
          <button onClick={() => void loadModeration()} disabled={busyModeration}>
            {busyModeration ? "Refreshing..." : "Refresh Moderation"}
          </button>
        </div>
        {!moderationRows.length ? (
          <p className="subtle">No moderation reports for this filter.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Reporter</th>
                  <th>Target</th>
                  <th>Reason</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {moderationRows.map((row) => {
                  const resolveKey = `${row.id}:RESOLVED:HIDE_CONTENT`;
                  const dismissKey = `${row.id}:DISMISSED:NONE`;
                  const unhideKey = `unhide:${row.content_type}:${row.content_id}`;
                  return (
                    <tr key={row.id}>
                      <td>{new Date(row.created_at).toLocaleString()}</td>
                      <td>
                        {row.reporter_username} (#{row.reporter_user_id})
                      </td>
                      <td>
                        <div>{row.target_preview ?? `${row.content_type} #${row.content_id}`}</div>
                        <div className="subtle">
                          {row.content_type} #{row.content_id} {row.target_exists ? "" : "(deleted)"}
                        </div>
                      </td>
                      <td>
                        <div>{row.reason}</div>
                        {row.details && <div className="subtle">{row.details}</div>}
                      </td>
                      <td>
                        <div>{row.status}</div>
                        <div className="subtle">{row.is_content_hidden ? "Hidden" : "Visible"}</div>
                      </td>
                      <td>
                        <div className="admin-actions">
                          <button
                            className="danger-btn"
                            onClick={() => void resolveModerationReport(row.id, "RESOLVED", "HIDE_CONTENT")}
                            disabled={busyModerationAction.length > 0 || row.is_content_hidden || row.status !== "OPEN"}
                          >
                            {busyModerationAction === resolveKey ? "Saving..." : "Hide + Resolve"}
                          </button>
                          <button
                            onClick={() => void resolveModerationReport(row.id, "DISMISSED", "NONE")}
                            disabled={busyModerationAction.length > 0 || row.status !== "OPEN"}
                          >
                            {busyModerationAction === dismissKey ? "Saving..." : "Dismiss"}
                          </button>
                          <button
                            className="primary-btn"
                            onClick={() => void unhideModeratedContent(row.content_type, row.content_id)}
                            disabled={busyModerationAction.length > 0 || !row.is_content_hidden}
                          >
                            {busyModerationAction === unhideKey ? "Saving..." : "Unhide"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section id="review" className="table-panel">
        <div className="home-snapshot-head">
          <h3>Sport Player Review</h3>
          <button type="button" onClick={() => setSportReviewOpen((previous) => !previous)}>
            {sportReviewOpen ? "Hide Review" : "Show Review"}
          </button>
        </div>
        {sportReviewOpen ? (
          <>
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
                <p className="subtle">SEI closeout pays longs at current spot and shorts at current earnings, then delists the player. Payout override only affects the long side.</p>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Player</th>
                        <th>Team</th>
                        <th>Pos</th>
                        <th>Listed</th>
                        <th>IPO Season</th>
                        <th>Purchase Price</th>
                        <th>SEI Closeout</th>
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
                          <td>{player.ipo_season == null ? "--" : String(player.ipo_season)}</td>
                          <td>{formatCurrency(player.base_price, 2)}</td>
                          <td>
                            <div className="admin-ipo-closeout-cell">
                              <input
                                className="admin-ipo-payout-input"
                                inputMode="decimal"
                                value={seiPayoutByPlayerId[player.id] ?? ""}
                                onChange={(event) =>
                                  setSeiPayoutByPlayerId((previous) => ({
                                    ...previous,
                                    [player.id]: event.target.value,
                                  }))
                                }
                                placeholder="spot"
                                aria-label={`Optional long payout for ${player.name}`}
                              />
                              <button
                                type="button"
                                className="danger-btn"
                                onClick={() => void closeOutSeasonEndingInjury(player)}
                                disabled={busyIpoAction.length > 0 || !player.listed}
                              >
                                {busyIpoAction === `closeout:${player.id}` ? "Closing..." : "Close + Pay"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        ) : (
          <p className="subtle">Hidden by default to keep the rest of the admin controls easier to reach.</p>
        )}
      </section>

      <section id="destructive-tools" className="table-panel">
        <h3>Site Reset</h3>
        <p className="subtle">
          Clears all positions, transactions, pricing/stat history, resets all users to starting cash, and optionally
          hides IPO by sport. This is destructive and intended for pricing/payout tuning resets.
        </p>
        <div className="admin-input-grid">
          <div>
            <label className="field-label" htmlFor="site-reset-cash">
              Starting Cash
            </label>
            <input
              id="site-reset-cash"
              inputMode="decimal"
              value={resetStartingCash}
              onChange={(event) => setResetStartingCash(event.target.value)}
              placeholder="100000.00"
            />
          </div>
          <div>
            <label className="field-label" htmlFor="site-reset-hide-sports">
              Hide IPO Sports
            </label>
            <input
              id="site-reset-hide-sports"
              value={resetHideSports}
              onChange={(event) => setResetHideSports(event.target.value)}
              placeholder="MLB"
            />
          </div>
          <div>
            <label className="field-label" htmlFor="site-reset-confirmation">
              Type RESET SITE to confirm
            </label>
            <input
              id="site-reset-confirmation"
              value={resetConfirmation}
              onChange={(event) => setResetConfirmation(event.target.value)}
              placeholder="RESET SITE"
            />
          </div>
        </div>

        <div className="admin-actions">
          <button
            className="danger-btn"
            onClick={() => void runSiteReset()}
            disabled={busySiteReset}
          >
            {busySiteReset ? "Resetting..." : "Reset Site State"}
          </button>
        </div>

        {siteResetResult ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Users Reset</th>
                  <th>Players Reset</th>
                  <th>Holdings</th>
                  <th>Transactions</th>
                  <th>Weekly Stats</th>
                  <th>Price Points</th>
                  <th>Hidden Sports</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{formatNumber(siteResetResult.users_reset)}</td>
                  <td>{formatNumber(siteResetResult.players_reset)}</td>
                  <td>{formatNumber(siteResetResult.holdings_cleared)}</td>
                  <td>{formatNumber(siteResetResult.transactions_cleared)}</td>
                  <td>{formatNumber(siteResetResult.weekly_stats_cleared)}</td>
                  <td>{formatNumber(siteResetResult.price_points_cleared)}</td>
                  <td>{siteResetResult.hidden_sports.join(", ") || "--"}</td>
                </tr>
              </tbody>
            </table>
            <p className="subtle">{siteResetResult.message}</p>
          </div>
        ) : null}
      </section>

      <section className="table-panel">
        <h3>Flatten All Open Positions</h3>
        <p className="subtle">
          One-time repair for all users. This resets every current open position so purchase price equals the player&apos;s current spot price right now, which makes unrealized P/L start from $0 under the final pricing rules.
        </p>
        <div className="admin-actions">
          <button
            className="primary-btn"
            onClick={() => void normalizeOpenHoldings()}
            disabled={busyNormalizeHoldings}
          >
            {busyNormalizeHoldings ? "Flattening..." : "Flatten All Open Positions To Current Spot"}
          </button>
        </div>
        {normalizeHoldingsResult ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Users Affected</th>
                  <th>Holdings Updated</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{formatNumber(normalizeHoldingsResult.users_affected)}</td>
                  <td>{formatNumber(normalizeHoldingsResult.holdings_updated)}</td>
                </tr>
              </tbody>
            </table>
            <p className="subtle">{normalizeHoldingsResult.message}</p>
          </div>
        ) : null}
      </section>

      <section id="user-tools" className="table-panel">
        <h3>User Equity Inspector</h3>
        <p className="subtle">
          Select a user to inspect, flatten, or delete without typing usernames manually.
        </p>
        <div className="admin-input-grid">
          <div>
            <label className="field-label" htmlFor="user-picker-query">
              Filter Users
            </label>
            <input
              id="user-picker-query"
              value={userPickerQuery}
              onChange={(event) => setUserPickerQuery(event.target.value)}
              placeholder="Search usernames"
            />
          </div>
          <div>
            <label className="field-label" htmlFor="equity-lookup-username">
              Selected User
            </label>
            <select
              id="equity-lookup-username"
              value={equityLookupUsername}
              onChange={(event) => setEquityLookupUsername(event.target.value)}
              disabled={busyAdminUsers || !adminUsers.length}
            >
              {!adminUsers.length ? <option value="">No users found</option> : null}
              {adminUsers.map((user) => (
                <option key={user.user_id} value={user.username}>
                  {user.username} (#{formatNumber(user.user_id)})
                </option>
              ))}
            </select>
            <p className="subtle">
              {busyAdminUsers ? "Loading users..." : `${formatNumber(adminUsers.length)} user(s) loaded`}
            </p>
          </div>
        </div>
          <div className="admin-actions">
            <button onClick={() => void lookupUserEquity()} disabled={busyEquityLookup}>
              {busyEquityLookup ? "Loading..." : "Inspect User Equity"}
            </button>
            <button
            className="primary-btn"
            onClick={() => void flattenUserEquity()}
            disabled={busyFlattenUserEquity}
            >
              {busyFlattenUserEquity ? "Flattening..." : "Flatten User To $100k Equity"}
            </button>
            <button
              className="danger-btn"
              onClick={() => void deleteUser()}
              disabled={busyDeleteUser}
            >
              {busyDeleteUser ? "Deleting..." : "Delete User And Clear Positions"}
            </button>
          </div>
        {equityLookupResult ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Cash</th>
                  <th>Cash vs 100k</th>
                  <th>Holdings</th>
                  <th>Gross Exposure</th>
                  <th>Unrealized P/L</th>
                  <th>Implied Realized P/L</th>
                  <th>Equity</th>
                  <th>Return</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    {equityLookupResult.username} (#{formatNumber(equityLookupResult.user_id)})
                  </td>
                  <td>{formatCurrency(equityLookupResult.cash_balance)}</td>
                  <td>{formatSignedNumber(equityLookupResult.cash_vs_starting_cash, 2)}</td>
                  <td>{formatCurrency(equityLookupResult.holdings_value)}</td>
                  <td>{formatCurrency(equityLookupResult.gross_exposure)}</td>
                  <td>{formatSignedNumber(equityLookupResult.unrealized_pnl, 2)}</td>
                  <td>{formatSignedNumber(equityLookupResult.implied_realized_pnl, 2)}</td>
                  <td>{formatCurrency(equityLookupResult.equity)}</td>
                  <td>{formatSignedNumber(equityLookupResult.return_pct, 2)}%</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : null}
          {flattenUserEquityResult ? (
            <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Previous Equity</th>
                  <th>New Equity</th>
                  <th>Previous Cash</th>
                  <th>New Cash</th>
                  <th>Previous Return</th>
                  <th>New Return</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    {flattenUserEquityResult.username} (#{formatNumber(flattenUserEquityResult.user_id)})
                  </td>
                  <td>{formatCurrency(flattenUserEquityResult.previous_equity)}</td>
                  <td>{formatCurrency(flattenUserEquityResult.new_equity)}</td>
                  <td>{formatCurrency(flattenUserEquityResult.previous_cash_balance)}</td>
                  <td>{formatCurrency(flattenUserEquityResult.new_cash_balance)}</td>
                  <td>{formatSignedNumber(flattenUserEquityResult.previous_return_pct, 2)}%</td>
                  <td>{formatSignedNumber(flattenUserEquityResult.new_return_pct, 2)}%</td>
                </tr>
              </tbody>
            </table>
              <p className="subtle">{flattenUserEquityResult.message}</p>
            </div>
          ) : null}
          {deleteUserResult ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Holdings</th>
                    <th>Transactions</th>
                    <th>Sessions</th>
                    <th>Threads</th>
                    <th>Messages</th>
                    <th>Friendships</th>
                    <th>Notifications</th>
                    <th>Forum Posts</th>
                    <th>Forum Comments</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      {deleteUserResult.username} (#{formatNumber(deleteUserResult.user_id)})
                    </td>
                    <td>{formatNumber(deleteUserResult.holdings_deleted)}</td>
                    <td>{formatNumber(deleteUserResult.transactions_deleted)}</td>
                    <td>{formatNumber(deleteUserResult.sessions_deleted)}</td>
                    <td>{formatNumber(deleteUserResult.threads_deleted)}</td>
                    <td>{formatNumber(deleteUserResult.messages_deleted)}</td>
                    <td>{formatNumber(deleteUserResult.friendships_deleted)}</td>
                    <td>{formatNumber(deleteUserResult.notifications_deleted)}</td>
                    <td>{formatNumber(deleteUserResult.forum_posts_deleted)}</td>
                    <td>{formatNumber(deleteUserResult.forum_comments_deleted)}</td>
                  </tr>
                </tbody>
              </table>
              <p className="subtle">{deleteUserResult.message}</p>
            </div>
          ) : null}
        </section>

      <section id="stats-import" className="admin-panel">
        <h3>MLB StatsAPI Backfill</h3>
        <p className="subtle">
          Pull MLB boxscore data for a date range, apply season/game points, and refresh player pricing snapshots.
        </p>
        <div className="admin-input-grid">
          <div>
            <label className="field-label" htmlFor="mlb-backfill-start-date">
              Start Date
            </label>
            <input
              id="mlb-backfill-start-date"
              type="date"
              value={mlbBackfillStartDate}
              onChange={(event) => setMlbBackfillStartDate(event.target.value)}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="mlb-backfill-end-date">
              End Date
            </label>
            <input
              id="mlb-backfill-end-date"
              type="date"
              value={mlbBackfillEndDate}
              onChange={(event) => setMlbBackfillEndDate(event.target.value)}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="mlb-backfill-week">
              Week Slot
            </label>
            <input
              id="mlb-backfill-week"
              inputMode="numeric"
              value={mlbBackfillWeek}
              onChange={(event) => setMlbBackfillWeek(event.target.value)}
              placeholder="1"
            />
          </div>
          <div>
            <label className="field-label" htmlFor="mlb-backfill-game-types">
              Allowed Game Types
            </label>
            <input
              id="mlb-backfill-game-types"
              value={mlbBackfillGameTypes}
              onChange={(event) => setMlbBackfillGameTypes(event.target.value)}
              placeholder="R,F,D,L,W,S"
            />
          </div>
        </div>
        <div className="admin-actions">
          <button
            className="primary-btn"
            onClick={() => void runMlbBackfill()}
            disabled={busyMlbBackfill || busyPreview || busyPublish}
          >
            {busyMlbBackfill ? "Running MLB Backfill..." : "Run MLB Backfill"}
          </button>
        </div>
        {mlbBackfillResult ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Dates</th>
                  <th>Source Games</th>
                  <th>Source Rows</th>
                  <th>Matched</th>
                  <th>Unmatched</th>
                  <th>Applied</th>
                  <th>Changed</th>
                  <th>Unchanged</th>
                  <th>Failed</th>
                  <th>Players Refreshed</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    {mlbBackfillResult.start_date} to {mlbBackfillResult.end_date}
                  </td>
                  <td>{formatNumber(mlbBackfillResult.source_games)}</td>
                  <td>{formatNumber(mlbBackfillResult.source_rows)}</td>
                  <td>{formatNumber(mlbBackfillResult.matched_rows)}</td>
                  <td>{formatNumber(mlbBackfillResult.unmatched_rows)}</td>
                  <td>{formatNumber(mlbBackfillResult.applied_rows)}</td>
                  <td>{formatNumber(mlbBackfillResult.changed_rows)}</td>
                  <td>{formatNumber(mlbBackfillResult.unchanged_rows)}</td>
                  <td>{formatNumber(mlbBackfillResult.failed_rows)}</td>
                  <td>{formatNumber(mlbBackfillResult.players_touched)}</td>
                </tr>
              </tbody>
            </table>
            <p className="subtle">{mlbBackfillResult.message}</p>
            {mlbBackfillResult.unmatched_examples.length ? (
              <p className="subtle">
                Unmatched examples: {mlbBackfillResult.unmatched_examples.join(" | ")}
              </p>
            ) : null}
          </div>
        ) : null}

        <h3>Manual CSV Import</h3>
        <label className="field-label" htmlFor="csv-text">
          CSV Data
        </label>
        <textarea
          id="csv-text"
          className="admin-textarea"
          value={csvText}
          onChange={(event) => setCsvText(event.target.value)}
          placeholder={"player_name,team,week,fantasy_points,game_id,game_fantasy_points\nJosh Allen,BUF,1,27.4,BUF-KC-W1,27.4"}
        />

        <div className="admin-input-row">
          <div>
            <label className="field-label" htmlFor="week-override">
              Progress Week (optional)
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
            {busyPublish ? "Publishing..." : "Publish Import"}
          </button>
        </div>

        {error && <p className="error-box" role="alert">{error}</p>}
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
