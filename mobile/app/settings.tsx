import { useState } from "react";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { Screen } from "@/components/ui/Screen";
import { useSession } from "@/hooks/useSession";
import { ApiHttpError, apiPost } from "@/lib/api";
import { colors } from "@/theme/colors";
import { radius } from "@/theme/radius";
import { spacing } from "@/theme/spacing";

export default function SettingsScreen() {
  const { logout, user } = useSession();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [message, setMessage] = useState("");

  async function updatePassword() {
    if (!currentPassword || !newPassword) return;
    setIsSavingPassword(true);
    setMessage("");
    try {
      await apiPost("/auth/password", {
        current_password: currentPassword,
        new_password: newPassword,
      });
      setCurrentPassword("");
      setNewPassword("");
      setMessage("Password updated.");
    } catch (error) {
      setMessage(error instanceof ApiHttpError ? error.message : "Password update failed.");
    } finally {
      setIsSavingPassword(false);
    }
  }

  return (
    <Screen>
      <Text style={styles.title}>Settings</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Account</Text>
        <Text style={styles.primaryText}>@{user?.username ?? "guest"}</Text>
        <Text style={styles.secondaryText}>{user?.email ?? "Signed in with your MatchupMarket account"}</Text>
        {user ? (
          <Pressable onPress={() => router.push(`/profile/${user.username}`)} style={styles.linkRow}>
            <Text style={styles.linkLabel}>Open profile</Text>
            <Text style={styles.linkArrow}>›</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Security</Text>
        <TextInput
          onChangeText={setCurrentPassword}
          placeholder="Current password"
          placeholderTextColor={colors.textMuted}
          secureTextEntry
          style={styles.input}
          value={currentPassword}
        />
        <TextInput
          onChangeText={setNewPassword}
          placeholder="New password"
          placeholderTextColor={colors.textMuted}
          secureTextEntry
          style={styles.input}
          value={newPassword}
        />
        <Button
          disabled={isSavingPassword || !currentPassword || !newPassword}
          label={isSavingPassword ? "Updating..." : "Update password"}
          onPress={() => void updatePassword()}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Go to</Text>
        <Pressable onPress={() => router.push("/leaderboard")} style={styles.linkRow}>
          <Text style={styles.linkLabel}>Leaderboard</Text>
          <Text style={styles.linkArrow}>›</Text>
        </Pressable>
        <Pressable onPress={() => router.push("/watchlist")} style={styles.linkRow}>
          <Text style={styles.linkLabel}>Watchlist</Text>
          <Text style={styles.linkArrow}>›</Text>
        </Pressable>
        <Pressable onPress={() => router.push("/notifications")} style={styles.linkRow}>
          <Text style={styles.linkLabel}>Notifications</Text>
          <Text style={styles.linkArrow}>›</Text>
        </Pressable>
        <Pressable onPress={() => router.push("/inbox")} style={styles.linkRow}>
          <Text style={styles.linkLabel}>Inbox</Text>
          <Text style={styles.linkArrow}>›</Text>
        </Pressable>
      </View>

      <Button label="Sign out" onPress={() => void logout()} tone="secondary" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: "800",
  },
  message: {
    color: colors.textMuted,
    fontSize: 13,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.md,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "700",
  },
  primaryText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
  },
  secondaryText: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  input: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.md,
    color: colors.text,
  },
  linkRow: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  linkLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "600",
  },
  linkArrow: {
    color: colors.textMuted,
    fontSize: 20,
    lineHeight: 20,
  },
});
