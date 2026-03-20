import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { formatCurrency, formatSignedPercent } from "@shared/format";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { useSession } from "@/hooks/useSession";
import { apiGet } from "@/lib/api";
import { colors } from "@/theme/colors";
import { radius } from "@/theme/radius";
import { spacing } from "@/theme/spacing";

type NotificationResponse = {
  unread_count: number;
};

type LeaderboardResponse = {
  entries: {
    user_id: number;
    username: string;
    equity: number;
    return_pct: number;
    rank: number;
  }[];
};

export default function HomeScreen() {
  const { user, logout } = useSession();
  const { data: notifications } = useQuery({
    queryKey: ["notifications-mobile"],
    enabled: Boolean(user),
    queryFn: () => apiGet<NotificationResponse>("/notifications"),
  });
  const { data: leaderboard } = useQuery({
    queryKey: ["leaderboard-mobile"],
    enabled: Boolean(user),
    queryFn: () => apiGet<LeaderboardResponse>("/leaderboard"),
  });

  return (
    <Screen>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>Home</Text>
        <Text style={styles.title}>Welcome back{user ? `, ${user.username}` : ""}</Text>
        <Text style={styles.subtitle}>
          Open the market, check your account, and keep an eye on the current standings from one place.
        </Text>
      </View>
      <View style={styles.grid}>
        <Button label="Open Market" onPress={() => router.push("/(tabs)/market")} />
        <Button label="View Portfolio" onPress={() => router.push("/(tabs)/portfolio")} tone="secondary" />
      </View>
      <View style={styles.shortcutCard}>
        <Text style={styles.shortcutTitle}>More</Text>
        <View style={styles.shortcutGrid}>
          <Button
            label={`Notifications${notifications?.unread_count ? ` (${notifications.unread_count})` : ""}`}
            onPress={() => router.push("/notifications")}
            tone="secondary"
          />
          <Button label="My Profile" onPress={() => user ? router.push(`/profile/${user.username}`) : undefined} tone="secondary" />
          <Button label="Inbox" onPress={() => router.push("/inbox")} tone="secondary" />
        </View>
      </View>
      <View style={styles.leaderboardCard}>
        <Text style={styles.leaderboardTitle}>Leaderboard</Text>
        {leaderboard?.entries.length ? (
          leaderboard.entries.slice(0, 5).map((entry) => (
            <View key={entry.user_id} style={styles.leaderboardRow}>
              <Text style={styles.rank}>#{entry.rank}</Text>
              <View style={styles.leaderboardBody}>
                <Text style={styles.leaderboardName}>{entry.username}</Text>
                <Text style={styles.leaderboardMeta}>
                  {formatCurrency(entry.equity)} · {formatSignedPercent(entry.return_pct)}
                </Text>
              </View>
            </View>
          ))
        ) : (
          <EmptyState title="No rankings yet" body="Leaderboard entries will appear here when account performance is available." />
        )}
      </View>
      <Button label="Sign out" onPress={() => void logout()} tone="secondary" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    gap: spacing.sm,
  },
  eyebrow: {
    color: colors.brand,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: "800",
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
  },
  grid: {
    gap: spacing.md,
  },
  shortcutCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    gap: spacing.md,
  },
  shortcutTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "700",
  },
  shortcutGrid: {
    gap: spacing.sm,
  },
  leaderboardCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    gap: spacing.md,
  },
  leaderboardTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "700",
  },
  leaderboardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  rank: {
    color: colors.brand,
    fontSize: 16,
    fontWeight: "800",
    width: 34,
  },
  leaderboardBody: {
    flex: 1,
    gap: spacing.xs,
  },
  leaderboardName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
  },
  leaderboardMeta: {
    color: colors.textMuted,
    fontSize: 12,
  },
});
