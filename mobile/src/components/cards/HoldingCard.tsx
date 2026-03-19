import { StyleSheet, Text, View } from "react-native";

import type { PortfolioHolding } from "@shared/types";
import { formatCurrency, formatSignedCurrency } from "@shared/format";
import { colors } from "@/theme/colors";
import { radius } from "@/theme/radius";
import { spacing } from "@/theme/spacing";

type HoldingCardProps = {
  holding: PortfolioHolding;
};

export function HoldingCard({ holding }: HoldingCardProps) {
  const gainColor = holding.gainLoss >= 0 ? colors.success : colors.danger;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.name}>{holding.playerName}</Text>
          <Text style={styles.meta}>{holding.position} · {holding.sport}</Text>
        </View>
        <Text style={styles.value}>{formatCurrency(holding.marketValue)}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Shares</Text>
        <Text style={styles.info}>{holding.shares}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Avg price</Text>
        <Text style={styles.info}>{formatCurrency(holding.avgPrice)}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>P/L</Text>
        <Text style={[styles.info, { color: gainColor }]}>{formatSignedCurrency(holding.gainLoss)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
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
    fontSize: 16,
    fontWeight: "700",
  },
  meta: {
    color: colors.textMuted,
    fontSize: 13,
  },
  value: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  label: {
    color: colors.textMuted,
    fontSize: 13,
  },
  info: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "600",
  },
});
