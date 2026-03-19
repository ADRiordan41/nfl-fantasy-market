import { useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { StyleSheet, Text, View } from "react-native";

import type { Player } from "@shared/types";
import { formatCurrency } from "@shared/format";
import { TradeBottomSheet } from "@/components/trade/TradeBottomSheet";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { LineChart } from "@/components/ui/LineChart";
import { Screen } from "@/components/ui/Screen";
import { apiDelete, apiGet, apiPost } from "@/lib/api";
import { colors } from "@/theme/colors";
import { radius } from "@/theme/radius";
import { spacing } from "@/theme/spacing";

type PlayerDetailResponse = {
  id: number;
  name: string;
  team: string;
  position: string;
  sport: string;
  spot_price: number;
  bid_price: number;
  ask_price: number;
  points_to_date: number;
  base_price: number;
  fundamental_price: number;
  shares_held: number;
  shares_short: number;
  live: {
    live_now: boolean;
    game_label: string | null;
    game_status: string | null;
    game_stat_line: string | null;
    game_fantasy_points: number | null;
  } | null;
};

type HistoryPoint = {
  created_at: string;
  spot_price: number;
  fundamental_price: number;
};

type GameHistoryPoint = {
  game_id: string;
  game_label: string | null;
  game_status: string | null;
  game_fantasy_points: number;
  recorded_at: string;
};

export default function PlayerDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const playerId = Number(params.id);
  const [tradeOpen, setTradeOpen] = useState(false);

  const { data, refetch, isRefetching } = useQuery({
    queryKey: ["player-detail", playerId],
    enabled: Number.isFinite(playerId),
    queryFn: () => apiGet<PlayerDetailResponse>(`/players/${playerId}`),
  });

  const { data: history } = useQuery({
    queryKey: ["player-history", playerId],
    enabled: Number.isFinite(playerId),
    queryFn: () => apiGet<HistoryPoint[]>(`/players/${playerId}/history`),
  });

  const { data: gameHistory } = useQuery({
    queryKey: ["player-game-history", playerId],
    enabled: Number.isFinite(playerId),
    queryFn: () => apiGet<GameHistoryPoint[]>(`/players/${playerId}/game-history`),
  });

  const { data: watchlist, refetch: refetchWatchlist } = useQuery({
    queryKey: ["watchlist-mobile"],
    queryFn: () => apiGet<{ player_id: number }[]>("/watchlist/players"),
  });

  const isWatching = Boolean(watchlist?.some((entry) => entry.player_id === playerId));

  async function toggleWatch() {
    if (!playerId) return;
    if (isWatching) {
      await apiDelete(`/watchlist/players/${playerId}`);
    } else {
      await apiPost(`/watchlist/players/${playerId}`, {});
    }
    await Promise.all([refetch(), refetchWatchlist()]);
  }

  const tradePlayer: Player | null =
    data && tradeOpen
      ? {
          id: data.id,
          name: data.name,
          team: data.team,
          position: data.position,
          sport: data.sport,
          price: data.spot_price,
          bid: data.bid_price,
          ask: data.ask_price,
          spread: data.ask_price - data.bid_price,
          changePct: 0,
          sharesHeld: data.shares_held,
          sharesShort: data.shares_short,
          live: data.live
            ? {
                isLive: data.live.live_now,
                gameLabel: data.live.game_label,
                league: data.sport,
                gameClock: null,
                gameStatus: data.live.game_status,
              }
            : null,
        }
      : null;

  return (
    <Screen onRefresh={() => void Promise.all([refetch(), refetchWatchlist()])} refreshing={isRefetching}>
      {data ? (
        <>
          <Text style={styles.title}>{data.name}</Text>
          <View style={styles.card}>
            <Text style={styles.meta}>{data.team} · {data.position} · {data.sport}</Text>
            <View style={styles.row}>
              <Text style={styles.label}>Spot</Text>
              <Text style={styles.value}>{formatCurrency(data.spot_price)}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Bid / Ask</Text>
              <Text style={styles.value}>
                {formatCurrency(data.bid_price)} / {formatCurrency(data.ask_price)}
              </Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Points to date</Text>
              <Text style={styles.value}>{data.points_to_date.toFixed(1)}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Base / Fundamental</Text>
              <Text style={styles.value}>
                {formatCurrency(data.base_price)} / {formatCurrency(data.fundamental_price)}
              </Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Held / Short</Text>
              <Text style={styles.value}>
                {data.shares_held} / {data.shares_short}
              </Text>
            </View>
            {data.live ? (
              <View style={styles.liveCard}>
                <Text style={styles.liveTitle}>Live now</Text>
                <Text style={styles.liveMeta}>
                  {data.live.game_label ?? "Active game"} · {data.live.game_status ?? "In progress"}
                </Text>
                {data.live.game_stat_line ? <Text style={styles.liveMeta}>{data.live.game_stat_line}</Text> : null}
              </View>
            ) : null}
          </View>
          <View style={styles.actions}>
            <Button label="Trade player" onPress={() => setTradeOpen(true)} />
            <Button
              label={isWatching ? "Remove from watchlist" : "Watch player"}
              onPress={() => void toggleWatch()}
              tone="secondary"
            />
          </View>
          <LineChart title="Spot price trend" values={(history ?? []).slice(-12).map((point) => point.spot_price)} />
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Recent price points</Text>
            {history?.slice(-5).reverse().map((point) => (
              <View key={point.created_at} style={styles.row}>
                <Text style={styles.label}>{new Date(point.created_at).toLocaleDateString()}</Text>
                <Text style={styles.value}>
                  {formatCurrency(point.spot_price)} / {formatCurrency(point.fundamental_price)}
                </Text>
              </View>
            ))}
            {!history?.length ? <Text style={styles.emptyText}>No price history yet.</Text> : null}
          </View>
          <LineChart title="Game fantasy points" values={(gameHistory ?? []).slice(-12).map((game) => game.game_fantasy_points)} />
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Recent game updates</Text>
            {gameHistory?.slice(-5).reverse().map((game) => (
              <View key={`${game.game_id}-${game.recorded_at}`} style={styles.row}>
                <Text style={styles.label}>{game.game_label ?? "Game update"}</Text>
                <Text style={styles.value}>{game.game_fantasy_points.toFixed(1)} pts</Text>
              </View>
            ))}
            {!gameHistory?.length ? <Text style={styles.emptyText}>No game history yet.</Text> : null}
          </View>
        </>
      ) : (
        <EmptyState title="Player unavailable" body="We couldn't load this player right now." />
      )}
      <TradeBottomSheet
        onClose={() => setTradeOpen(false)}
        onTradeComplete={() => void refetch()}
        player={tradePlayer}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: "800",
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    gap: spacing.md,
  },
  meta: {
    color: colors.textMuted,
    fontSize: 14,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  label: {
    color: colors.textMuted,
    fontSize: 13,
    flex: 1,
  },
  value: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
    flexShrink: 1,
    textAlign: "right",
  },
  actions: {
    gap: spacing.md,
  },
  liveCard: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  liveTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
  },
  liveMeta: {
    color: colors.textMuted,
    fontSize: 13,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "700",
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 13,
  },
});
