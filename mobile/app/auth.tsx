import { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { Screen } from "@/components/ui/Screen";
import { useSession } from "@/hooks/useSession";
import { colors } from "@/theme/colors";
import { radius } from "@/theme/radius";
import { spacing } from "@/theme/spacing";

export default function AuthScreen() {
  const { login, isLoading } = useSession();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit() {
    setIsSubmitting(true);
    setError("");
    try {
      await login(username.trim(), password);
    } catch {
      setError("We couldn't sign you in with those credentials.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Screen scrollable={false}>
      <View style={styles.hero}>
        <Text style={styles.title}>MatchupMarket</Text>
        <Text style={styles.subtitle}>Carry the market in your pocket with a native mobile shell.</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>Username</Text>
        <TextInput autoCapitalize="none" onChangeText={setUsername} style={styles.input} value={username} />
        <Text style={styles.label}>Password</Text>
        <TextInput onChangeText={setPassword} secureTextEntry style={styles.input} value={password} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button
          disabled={isSubmitting || isLoading || !username.trim() || !password}
          label={isSubmitting ? "Signing in..." : "Sign in"}
          onPress={handleSubmit}
        />
        {isLoading ? <ActivityIndicator color={colors.brand} /> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    paddingTop: spacing.xxl,
    gap: spacing.sm,
  },
  title: {
    color: colors.text,
    fontSize: 30,
    fontWeight: "800",
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 16,
    lineHeight: 22,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    gap: spacing.md,
  },
  label: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "600",
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
  error: {
    color: colors.danger,
    fontSize: 13,
  },
});
