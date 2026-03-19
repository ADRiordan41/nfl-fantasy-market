import { StyleSheet, Text, View } from "react-native";
import Svg, { Path, Polyline } from "react-native-svg";

import { formatCurrency } from "@shared/format";
import { colors } from "@/theme/colors";
import { radius } from "@/theme/radius";
import { spacing } from "@/theme/spacing";

type LineChartProps = {
  values: number[];
  title: string;
};

export function LineChart({ values, title }: LineChartProps) {
  if (!values.length) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.empty}>No chart data yet.</Text>
      </View>
    );
  }

  const width = 320;
  const height = 120;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const points = values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * width;
      const y = height - ((value - min) / range) * height;
      return `${x},${y}`;
    })
    .join(" ");

  const areaPath = `M 0 ${height} L ${points.replace(/ /g, " L ")} L ${width} ${height} Z`;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.meta}>
          {formatCurrency(values[0])} → {formatCurrency(values[values.length - 1])}
        </Text>
      </View>
      <Svg height={height} style={styles.chart} viewBox={`0 0 ${width} ${height}`} width="100%">
        <Path d={areaPath} fill="rgba(47, 127, 255, 0.12)" />
        <Polyline fill="none" points={points} stroke={colors.brand} strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.md,
  },
  header: {
    gap: spacing.xs,
  },
  title: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "700",
  },
  meta: {
    color: colors.textMuted,
    fontSize: 12,
  },
  chart: {
    height: 120,
  },
  empty: {
    color: colors.textMuted,
    fontSize: 13,
  },
});
