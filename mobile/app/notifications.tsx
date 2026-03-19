import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text } from "react-native";

import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { apiGet, apiPost } from "@/lib/api";
import { colors } from "@/theme/colors";
import { radius } from "@/theme/radius";
import { spacing } from "@/theme/spacing";

type NotificationResponse = {
  unread_count: number;
  items: {
    id: number;
    message: string;
    href: string | null;
    created_at: string;
  }[];
};

export default function NotificationsScreen() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["notifications-mobile"],
    queryFn: () => apiGet<NotificationResponse>("/notifications"),
  });

  async function handleOpen(id: number, href: string | null) {
    await apiPost("/notifications/read", { ids: [id] });
    await queryClient.invalidateQueries({ queryKey: ["notifications-mobile"] });
    if (!href) return;
    if (href.startsWith("/inbox")) {
      const threadMatch = href.match(/thread=(\d+)/);
      if (threadMatch) {
        router.push({
          pathname: "/inbox",
          params: { thread: threadMatch[1] },
        });
      } else {
        router.push("/inbox");
      }
      return;
    }
    if (href.startsWith("/community/")) {
      router.push(href as "/community/[id]");
      return;
    }
    if (href.startsWith("/profile/")) {
      router.push(href as "/profile/[username]");
      return;
    }
  }

  async function markAllRead() {
    await apiPost("/notifications/read-all", {});
    await queryClient.invalidateQueries({ queryKey: ["notifications-mobile"] });
  }

  return (
    <Screen>
      <Pressable onPress={() => void markAllRead()} style={styles.markAll}>
        <Text style={styles.markAllText}>Mark all read</Text>
      </Pressable>
      <Text style={styles.title}>Notifications</Text>
      {data?.items.length ? (
        data.items.map((item) => (
          <Pressable key={item.id} onPress={() => void handleOpen(item.id, item.href)} style={styles.card}>
            <Text style={styles.message}>{item.message}</Text>
            <Text style={styles.meta}>{new Date(item.created_at).toLocaleString()}</Text>
          </Pressable>
        ))
      ) : (
        <EmptyState title="No notifications yet" body="Reply, DM, and market alerts will show up here." />
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
  markAll: {
    alignSelf: "flex-end",
  },
  markAllText: {
    color: colors.brand,
    fontSize: 13,
    fontWeight: "700",
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  message: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "600",
  },
  meta: {
    color: colors.textMuted,
    fontSize: 12,
  },
});
