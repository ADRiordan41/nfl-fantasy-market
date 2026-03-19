import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

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

export default function HomeScreen() {
  const { user, logout } = useSession();
  const { data } = useQuery({
    queryKey: ["notifications-mobile"],
    enabled: Boolean(user),
    queryFn: () => apiGet<NotificationResponse>("/notifications"),
  });

  return (
    <Screen>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>Mobile starter</Text>
        <Text style={styles.title}>Welcome back{user ? `, ${user.username}` : ""}</Text>
        <Text style={styles.subtitle}>
          This starter app already has tabs, auth, and shared domain types wired up for the next build phase.
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
            label={`Notifications${data?.unread_count ? ` (${data.unread_count})` : ""}`}
            onPress={() => router.push("/notifications")}
            tone="secondary"
          />
          <Button label="Leaderboard" onPress={() => router.push("/leaderboard")} tone="secondary" />
          <Button label="Watchlist" onPress={() => router.push("/watchlist")} tone="secondary" />
          <Button label="Inbox" onPress={() => router.push("/inbox")} tone="secondary" />
        </View>
      </View>
      <EmptyState
        title="Next mobile milestones"
        body="Push notifications, richer charts, and deeper messaging are the main follow-ups once this v1 mobile loop is settled."
      />
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
});
