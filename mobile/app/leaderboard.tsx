import { useQuery } from "@tanstack/react-query";
import { StyleSheet, Text, View } from "react-native";

import { formatCurrency, formatSignedPercent } from "@shared/format";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { apiGet } from "@/lib/api";
import { colors } from "@/theme/colors";
import { radius } from "@/theme/radius";
import { spacing } from "@/theme/spacing";

type LeaderboardResponse = {
  entries: {
    user_id: number;
    username: string;
    equity: number;
    return_pct: number;
    rank: number;
  }[];
};

export default function LeaderboardScreen() {
  const { data } = useQuery({
    queryKey: ["leaderboard-mobile"],
    queryFn: () => apiGet<LeaderboardResponse>("/leaderboard"),
  });

  return (
    <Screen>
      <Text style={styles.title}>Leaderboard</Text>
      {data?.entries.length ? (
        data.entries.map((entry) => (
          <View key={entry.user_id} style={styles.card}>
            <Text style={styles.rank}>#{entry.rank}</Text>
            <View style={styles.body}>
              <Text style={styles.name}>{entry.username}</Text>
              <Text style={styles.meta}>{formatCurrency(entry.equity)} · {formatSignedPercent(entry.return_pct)}</Text>
            </View>
          </View>
        ))
      ) : (
        <EmptyState title="No rankings yet" body="Leaderboard entries will appear here when performance data is available." />
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
  card: {
    flexDirection: "row",
    gap: spacing.md,
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  rank: {
    color: colors.brand,
    fontSize: 18,
    fontWeight: "800",
    width: 42,
  },
  body: {
    flex: 1,
    gap: spacing.xs,
  },
  name: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
  },
  meta: {
    color: colors.textMuted,
    fontSize: 13,
  },
});
