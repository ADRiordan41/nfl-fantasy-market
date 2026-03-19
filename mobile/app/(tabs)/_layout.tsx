import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Redirect, Tabs, router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { apiGet } from "@/lib/api";
import { useSession } from "@/hooks/useSession";
import { colors } from "@/theme/colors";
import { spacing } from "@/theme/spacing";

type NotificationResponse = {
  unread_count: number;
};

export default function TabsLayout() {
  const { user, isLoading } = useSession();
  const { data: notifications } = useQuery({
    queryKey: ["notifications-mobile"],
    enabled: Boolean(user),
    queryFn: () => apiGet<NotificationResponse>("/notifications"),
    refetchInterval: 60_000,
  });

  if (!isLoading && !user) {
    return <Redirect href="/auth" />;
  }

  function HeaderActions() {
    const unreadCount = notifications?.unread_count ?? 0;

    return (
      <View style={styles.actions}>
        <Pressable onPress={() => router.push("/notifications")} style={styles.iconButton}>
          <Ionicons color={colors.text} name="notifications-outline" size={22} />
          {unreadCount > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{unreadCount > 9 ? "9+" : unreadCount}</Text>
            </View>
          ) : null}
        </Pressable>
        <Pressable onPress={() => router.push("/settings")} style={styles.iconButton}>
          <Ionicons color={colors.text} name="ellipsis-horizontal-circle-outline" size={22} />
        </Pressable>
      </View>
    );
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        headerShadowVisible: false,
        headerStyle: {
          backgroundColor: colors.bg,
        },
        headerTitleStyle: {
          color: colors.text,
          fontWeight: "700",
        },
        headerRight: HeaderActions,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.textMuted,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, size }) => <Ionicons color={color} name="home-outline" size={size} />,
        }}
      />
      <Tabs.Screen
        name="market"
        options={{
          title: "Market",
          tabBarIcon: ({ color, size }) => <Ionicons color={color} name="trending-up-outline" size={size} />,
        }}
      />
      <Tabs.Screen
        name="portfolio"
        options={{
          title: "Portfolio",
          tabBarIcon: ({ color, size }) => <Ionicons color={color} name="wallet-outline" size={size} />,
        }}
      />
      <Tabs.Screen
        name="community"
        options={{
          title: "Community",
          tabBarIcon: ({ color, size }) => <Ionicons color={color} name="chatbubbles-outline" size={size} />,
        }}
      />
      <Tabs.Screen
        name="live"
        options={{
          title: "Live",
          tabBarIcon: ({ color, size }) => <Ionicons color={color} name="flash-outline" size={size} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  iconButton: {
    minWidth: 36,
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    right: -2,
    top: -2,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "800",
  },
});
