import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from "react-native";

import type { Portfolio, PortfolioHolding } from "@shared/types";
import { formatCurrency } from "@shared/format";
import { HoldingCard } from "@/components/cards/HoldingCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { apiGet } from "@/lib/api";
import { colors } from "@/theme/colors";
import { radius } from "@/theme/radius";
import { spacing } from "@/theme/spacing";

type PortfolioResponse = {
  cash_balance: number;
  equity: number;
  holdings: {
    player_id: number;
    shares_owned: number;
    average_entry_price: number;
    basis_amount: number;
    spot_price: number;
    market_value: number;
  }[];
};

type PlayerLookup = Record<number, { name: string; position: string; sport: string }>;

export default function PortfolioScreen() {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("value");

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["portfolio-mobile"],
    queryFn: async () => {
      const [portfolio, players] = await Promise.all([
        apiGet<PortfolioResponse>("/portfolio"),
        apiGet<{ id: number; name: string; position: string; sport: string }[]>("/players"),
      ]);
      const byId = players.reduce<PlayerLookup>((acc, player) => {
        acc[player.id] = { name: player.name, position: player.position, sport: player.sport };
        return acc;
      }, {});

      const holdings: PortfolioHolding[] = portfolio.holdings.map((holding) => {
        const player = byId[holding.player_id];
        const gainLoss = holding.market_value - holding.basis_amount;
        return {
          playerId: holding.player_id,
          playerName: player?.name ?? `Player ${holding.player_id}`,
          sport: player?.sport ?? "",
          position: player?.position ?? "",
          shares: holding.shares_owned,
          avgPrice: holding.average_entry_price,
          currentPrice: holding.spot_price,
          gainLoss,
          gainLossPct: holding.basis_amount ? (gainLoss / holding.basis_amount) * 100 : 0,
          marketValue: holding.market_value,
        };
      });

      return {
        cash: portfolio.cash_balance,
        holdingsValue: holdings.reduce((sum, holding) => sum + holding.marketValue, 0),
        totalValue: portfolio.equity,
        realizedPnL: 0,
        unrealizedPnL: holdings.reduce((sum, holding) => sum + holding.gainLoss, 0),
        holdings,
      } satisfies Portfolio;
    },
  });

  const visibleHoldings = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const filtered = (data?.holdings ?? []).filter((holding) => {
      if (!normalizedSearch) return true;
      return `${holding.playerName} ${holding.position} ${holding.sport}`.toLowerCase().includes(normalizedSearch);
    });

    return [...filtered].sort((left, right) => {
      if (sort === "gain") return right.gainLoss - left.gainLoss;
      if (sort === "name") return left.playerName.localeCompare(right.playerName);
      return right.marketValue - left.marketValue;
    });
  }, [data?.holdings, search, sort]);

  return (
    <Screen onRefresh={() => void refetch()} refreshing={isRefetching}>
      <Text style={styles.title}>Portfolio</Text>
      {isLoading ? (
        <View style={styles.loadingCard}>
          <ActivityIndicator color={colors.brand} />
          <Text style={styles.loadingText}>Loading portfolio...</Text>
        </View>
      ) : data ? (
        <>
          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <Text style={styles.label}>Equity</Text>
              <Text style={styles.value}>{formatCurrency(data.totalValue)}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.label}>Cash</Text>
              <Text style={styles.value}>{formatCurrency(data.cash)}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.label}>Unrealized P/L</Text>
              <Text style={styles.value}>{formatCurrency(data.unrealizedPnL)}</Text>
            </View>
          </View>

          <View style={styles.controlsCard}>
            <TextInput
              autoCapitalize="none"
              onChangeText={setSearch}
              placeholder="Search holdings"
              placeholderTextColor={colors.textMuted}
              style={styles.search}
              value={search}
            />
            <SegmentedControl
              onChange={setSort}
              options={[
                { label: "Value", value: "value" },
                { label: "Gain", value: "gain" },
                { label: "Name", value: "name" },
              ]}
              value={sort}
            />
          </View>

          {visibleHoldings.map((holding) => (
            <HoldingCard holding={holding} key={holding.playerId} />
          ))}
          {!visibleHoldings.length ? <EmptyState title="No holdings match" body="Try a different search or sort." /> : null}
        </>
      ) : (
        <EmptyState title="Portfolio unavailable" body="We couldn't load your account snapshot right now." />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: "800",
  },
  summaryCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    gap: spacing.sm,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  label: {
    color: colors.textMuted,
    fontSize: 13,
  },
  value: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
  },
  controlsCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
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
