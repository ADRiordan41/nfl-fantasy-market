import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from "react-native";

import type { Player } from "@shared/types";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { TradeBottomSheet } from "@/components/trade/TradeBottomSheet";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { apiGet } from "@/lib/api";
import { colors } from "@/theme/colors";
import { radius } from "@/theme/radius";
import { spacing } from "@/theme/spacing";

type PlayerResponse = {
  id: number;
  name: string;
  team: string;
  position: string;
  sport: string;
  spot_price: number;
  bid_price: number;
  ask_price: number;
  shares_held: number;
  shares_short: number;
  live: {
    live_now: boolean;
    game_label: string | null;
    game_status: string | null;
  } | null;
};

export default function MarketScreen() {
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("price");

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["players"],
    queryFn: async () => {
      const response = await apiGet<PlayerResponse[]>("/players");
      return response.map(
        (player): Player => ({
          id: player.id,
          name: player.name,
          team: player.team,
          position: player.position,
          sport: player.sport,
          price: player.spot_price,
          bid: player.bid_price,
          ask: player.ask_price,
          sharesHeld: player.shares_held,
          sharesShort: player.shares_short,
          spread: player.ask_price - player.bid_price,
          changePct: 0,
          live: player.live
            ? {
                isLive: player.live.live_now,
                gameLabel: player.live.game_label,
                league: player.sport,
                gameClock: null,
                gameStatus: player.live.game_status,
              }
            : null,
        })
      );
    },
  });

  const filtered = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const base = (data ?? []).filter((player) => {
      if (normalizedSearch) {
        const haystack = `${player.name} ${player.team} ${player.position} ${player.sport}`.toLowerCase();
        if (!haystack.includes(normalizedSearch)) return false;
      }
      if (filter === "owned") return Boolean((player.sharesHeld ?? 0) > 0 || (player.sharesShort ?? 0) > 0);
      if (filter === "live") return Boolean(player.live?.isLive);
      return true;
    });

    return [...base].sort((left, right) => {
      if (sort === "name") return left.name.localeCompare(right.name);
      if (sort === "spread") return (right.spread ?? 0) - (left.spread ?? 0);
      return (right.price ?? 0) - (left.price ?? 0);
    });
  }, [data, filter, search, sort]);

  return (
    <Screen onRefresh={() => void refetch()} refreshing={isRefetching}>
      <Text style={styles.title}>Market</Text>
      <View style={styles.controlsCard}>
        <TextInput
          autoCapitalize="none"
          onChangeText={setSearch}
          placeholder="Search players, teams, positions"
          placeholderTextColor={colors.textMuted}
          style={styles.search}
          value={search}
        />
        <SegmentedControl
          onChange={setFilter}
          options={[
            { label: "All", value: "all" },
            { label: "Owned", value: "owned" },
            { label: "Live", value: "live" },
          ]}
          value={filter}
        />
        <SegmentedControl
          onChange={setSort}
          options={[
            { label: "Price", value: "price" },
            { label: "Spread", value: "spread" },
            { label: "Name", value: "name" },
          ]}
          value={sort}
        />
      </View>
      {isLoading ? (
        <View style={styles.loadingCard}>
          <ActivityIndicator color={colors.brand} />
          <Text style={styles.loadingText}>Loading market...</Text>
        </View>
      ) : filtered.length ? (
        filtered.map((player) => (
          <PlayerCard
            key={player.id}
            onPress={() => router.push(`/player/${player.id}`)}
            onTradePress={() => setSelectedPlayer(player)}
            player={player}
          />
        ))
      ) : (
        <EmptyState title="No players match" body="Try a different search or filter." />
      )}
      <TradeBottomSheet
        onClose={() => setSelectedPlayer(null)}
        onTradeComplete={() => void refetch()}
        player={selectedPlayer}
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
  controlsCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.md,
  },
  search: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.md,
    color: colors.text,
  },
  loadingCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    gap: spacing.md,
    alignItems: "center",
  },
  loadingText: {
    color: colors.textMuted,
    fontSize: 14,
  },
});
