import { useEffect, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import type { Player } from "@shared/types";
import { formatCurrency, formatSignedPercent } from "@shared/format";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { useSession } from "@/hooks/useSession";
import { ApiHttpError, apiGet, apiPatch } from "@/lib/api";
import { colors } from "@/theme/colors";
import { radius } from "@/theme/radius";
import { spacing } from "@/theme/spacing";

type ProfileResponse = {
  id: number;
  username: string;
  profile_image_url: string | null;
  bio: string | null;
  cash_balance: number;
  holdings_value: number;
  equity: number;
  return_pct: number;
  leaderboard_rank: number | null;
  holdings: {
    player_id: number;
    player_name: string;
    sport: string;
    team: string;
    position: string;
    shares_owned: number;
    spot_price: number;
    market_value: number;
  }[];
};

type WatchlistEntry = {
  player_id: number;
  name: string;
  team: string;
  position: string;
  sport: string;
  spot_price: number;
};

export default function ProfileScreen() {
  const params = useLocalSearchParams<{ username: string }>();
  const username = params.username;
  const { user } = useSession();
  const queryClient = useQueryClient();
  const isOwnProfile = user?.username?.toLowerCase() === username?.toLowerCase();
  const [isEditing, setIsEditing] = useState(false);
  const [bioDraft, setBioDraft] = useState("");
  const [imageDraft, setImageDraft] = useState("");
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const { data, refetch, isRefetching } = useQuery({
    queryKey: ["profile-mobile", username, isOwnProfile],
    enabled: Boolean(username),
    queryFn: () => apiGet<ProfileResponse>(isOwnProfile ? "/users/me/profile" : `/users/${username}/profile`),
  });

  const { data: watchlist } = useQuery({
    queryKey: ["watchlist-mobile", username],
    enabled: isOwnProfile,
    queryFn: async () => {
      const response = await apiGet<WatchlistEntry[]>("/watchlist/players");
      return response.map(
        (player): Player => ({
          id: player.player_id,
          name: player.name,
          team: player.team,
          position: player.position,
          sport: player.sport,
          price: player.spot_price,
          bid: player.spot_price,
          ask: player.spot_price,
          spread: 0,
          changePct: 0,
        })
      );
    },
  });

  useEffect(() => {
    if (data && !isEditing) {
      setBioDraft(data.bio ?? "");
      setImageDraft(data.profile_image_url ?? "");
    }
  }, [data, isEditing]);

  async function saveProfile() {
    setIsSaving(true);
    setMessage("");
    try {
      await apiPatch("/users/me/profile", {
        bio: bioDraft.trim() || null,
        profile_image_url: imageDraft.trim() || null,
      });
      await Promise.all([
        refetch(),
        queryClient.invalidateQueries({ queryKey: ["profile-mobile"] }),
      ]);
      setIsEditing(false);
      setMessage("Profile updated.");
    } catch (error) {
      setMessage(error instanceof ApiHttpError ? error.message : "Profile update failed.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Screen onRefresh={() => void refetch()} refreshing={isRefetching}>
      {data ? (
        <>
          <Text style={styles.title}>@{data.username}</Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}
          <View style={styles.card}>
            {isEditing ? (
              <>
                <TextInput
                  multiline
                  numberOfLines={4}
                  onChangeText={setBioDraft}
                  placeholder="Bio"
                  placeholderTextColor={colors.textMuted}
                  style={[styles.input, styles.multiline]}
                  value={bioDraft}
                />
                <TextInput
                  autoCapitalize="none"
                  onChangeText={setImageDraft}
                  placeholder="Profile image URL"
                  placeholderTextColor={colors.textMuted}
                  style={styles.input}
                  value={imageDraft}
                />
                <View style={styles.actionRow}>
                  <Button disabled={isSaving} label={isSaving ? "Saving..." : "Save profile"} onPress={() => void saveProfile()} />
                  <Button label="Cancel" onPress={() => setIsEditing(false)} tone="secondary" />
                </View>
              </>
            ) : (
              <>
                <Text style={styles.bio}>{data.bio || "No bio yet."}</Text>
                {data.profile_image_url ? <Text style={styles.subtle}>Avatar URL set</Text> : null}
                {isOwnProfile ? (
                  <Pressable onPress={() => setIsEditing(true)} style={styles.editButton}>
                    <Text style={styles.editButtonText}>Edit profile</Text>
                  </Pressable>
                ) : null}
              </>
            )}
            <View style={styles.row}>
              <Text style={styles.label}>Equity</Text>
              <Text style={styles.value}>{formatCurrency(data.equity)}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Cash / Holdings</Text>
              <Text style={styles.value}>
                {formatCurrency(data.cash_balance)} / {formatCurrency(data.holdings_value)}
              </Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Return</Text>
              <Text style={styles.value}>{formatSignedPercent(data.return_pct)}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Rank</Text>
              <Text style={styles.value}>{data.leaderboard_rank ? `#${data.leaderboard_rank}` : "Unranked"}</Text>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Current holdings</Text>
            {data.holdings.length ? (
              data.holdings.map((holding) => (
                <View key={holding.player_id} style={styles.holdingRow}>
                  <View style={styles.holdingInfo}>
                    <Text style={styles.holdingName}>{holding.player_name}</Text>
                    <Text style={styles.subtle}>
                      {holding.team} · {holding.position} · {holding.sport}
                    </Text>
                  </View>
                  <View style={styles.holdingValueWrap}>
                    <Text style={styles.value}>{formatCurrency(holding.market_value)}</Text>
                    <Text style={styles.subtle}>{holding.shares_owned} shares</Text>
                  </View>
                </View>
              ))
            ) : (
              <Text style={styles.subtle}>No holdings visible yet.</Text>
            )}
          </View>

          {isOwnProfile ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Watchlist</Text>
              {watchlist?.length ? (
                watchlist.map((player) => (
                  <PlayerCard key={player.id} onPress={() => router.push(`/player/${player.id}`)} player={player} />
                ))
              ) : (
                <Text style={styles.subtle}>Tap Watch on a player to build your list here.</Text>
              )}
            </View>
          ) : null}
        </>
      ) : (
        <EmptyState title="Profile unavailable" body="We couldn't load this user profile." />
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
  message: {
    color: colors.textMuted,
    fontSize: 13,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    gap: spacing.md,
  },
  bio: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  subtle: {
    color: colors.textMuted,
    fontSize: 12,
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
  sectionTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "700",
  },
  editButton: {
    alignSelf: "flex-start",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  editButtonText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
  },
  input: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.text,
  },
  multiline: {
    minHeight: 96,
    textAlignVertical: "top",
  },
  actionRow: {
    gap: spacing.sm,
  },
  holdingRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  holdingInfo: {
    flex: 1,
    gap: spacing.xs,
  },
  holdingName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
  },
  holdingValueWrap: {
    alignItems: "flex-end",
    gap: spacing.xs,
  },
});
