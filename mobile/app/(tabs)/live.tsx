import { useQuery } from "@tanstack/react-query";
import { StyleSheet, Text, View } from "react-native";

import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { apiGet } from "@/lib/api";
import { colors } from "@/theme/colors";
import { radius } from "@/theme/radius";
import { spacing } from "@/theme/spacing";

type LiveGamesResponse = {
  games: {
    game_id: string;
    sport: string;
    game_label: string;
    game_status: string | null;
    live_player_count: number;
  }[];
};

export default function LiveScreen() {
  const { data } = useQuery({
    queryKey: ["live-games-mobile"],
    queryFn: () => apiGet<LiveGamesResponse>("/live/games"),
  });

  return (
    <Screen>
      <Text style={styles.title}>Live</Text>
      {data?.games.length ? (
        data.games.map((game) => (
          <View key={game.game_id} style={styles.card}>
            <Text style={styles.gameTitle}>{game.game_label}</Text>
            <Text style={styles.meta}>{game.sport} · {game.game_status ?? "In progress"}</Text>
            <Text style={styles.meta}>{game.live_player_count} tracked players</Text>
          </View>
        ))
      ) : (
        <EmptyState title="Nothing live right now" body="When live player tracking is active, the current games will show up here." />
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
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  gameTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
  },
  meta: {
    color: colors.textMuted,
    fontSize: 13,
  },
});
