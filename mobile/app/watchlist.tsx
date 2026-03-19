import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { StyleSheet, Text } from "react-native";

import type { Player } from "@shared/types";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { apiGet } from "@/lib/api";
import { colors } from "@/theme/colors";

type WatchlistEntry = {
  player_id: number;
  name: string;
  team: string;
  position: string;
  sport: string;
  spot_price: number;
  base_price: number;
};

export default function WatchlistScreen() {
  const { data } = useQuery({
    queryKey: ["watchlist-page-mobile"],
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

  return (
    <Screen>
      <Text style={styles.title}>Watchlist</Text>
      {data?.length ? (
        data.map((player) => (
          <PlayerCard key={player.id} onPress={() => router.push(`/player/${player.id}`)} player={player} />
        ))
      ) : (
        <EmptyState title="No watched players yet" body="Tap Watch on a player to build your list here." />
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
});
