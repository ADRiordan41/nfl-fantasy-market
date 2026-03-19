import { Pressable, StyleSheet, Text, View } from "react-native";

import type { Player } from "@shared/types";
import { formatCurrency } from "@shared/format";
import { colors } from "@/theme/colors";
import { radius } from "@/theme/radius";
import { spacing } from "@/theme/spacing";

type PlayerCardProps = {
  player: Player;
  onPress?: () => void;
  onTradePress?: () => void;
};

export function PlayerCard({ player, onPress, onTradePress }: PlayerCardProps) {
  return (
    <Pressable style={styles.card} onPress={onPress}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text numberOfLines={1} style={styles.name}>{player.name}</Text>
          <Text style={styles.meta}>{player.team} · {player.position} · {player.sport}</Text>
        </View>
        <View style={styles.priceWrap}>
          <Text style={styles.price}>{formatCurrency(player.price)}</Text>
          <Text style={styles.subPrice}>
            {formatCurrency(player.bid ?? player.price)} / {formatCurrency(player.ask ?? player.price)}
          </Text>
        </View>
      </View>
      <View style={styles.statsRow}>
        <View>
          <Text style={styles.label}>Held</Text>
          <Text style={styles.value}>{player.sharesHeld ?? 0}</Text>
        </View>
        <View>
          <Text style={styles.label}>Short</Text>
          <Text style={styles.value}>{player.sharesShort ?? 0}</Text>
        </View>
        <View>
          <Text style={styles.label}>Live</Text>
          <Text style={styles.value}>{player.live?.isLive ? "Now" : "Off"}</Text>
        </View>
      </View>
      <Pressable style={styles.tradeButton} onPress={onTradePress}>
        <Text style={styles.tradeLabel}>Trade</Text>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  headerText: {
    flex: 1,
    gap: spacing.xs,
  },
  name: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "700",
  },
  meta: {
    color: colors.textMuted,
    fontSize: 13,
  },
  priceWrap: {
    alignItems: "flex-end",
    gap: spacing.xs,
  },
  price: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "700",
  },
  subPrice: {
    color: colors.textMuted,
    fontSize: 12,
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  label: {
    color: colors.textMuted,
    fontSize: 12,
    marginBottom: spacing.xs,
  },
  value: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "600",
  },
  tradeButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 42,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
  },
  tradeLabel: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
  },
});
