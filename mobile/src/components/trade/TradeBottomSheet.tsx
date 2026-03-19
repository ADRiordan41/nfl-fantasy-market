import BottomSheet, { BottomSheetView } from "@gorhom/bottom-sheet";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import type { Player, Quote } from "@shared/types";
import { formatCurrency } from "@shared/format";
import { ApiHttpError, apiPost } from "@/lib/api";
import { colors } from "@/theme/colors";
import { radius } from "@/theme/radius";
import { spacing } from "@/theme/spacing";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";

type TradeBottomSheetProps = {
  player: Player | null;
  onClose?: () => void;
  onTradeComplete?: () => void;
};

const TRADE_OPTIONS = [
  { label: "Buy", value: "BUY" },
  { label: "Sell", value: "SELL" },
  { label: "Short", value: "SHORT" },
  { label: "Cover", value: "COVER" },
];

export function TradeBottomSheet({ player, onClose, onTradeComplete }: TradeBottomSheetProps) {
  const snapPoints = useMemo(() => ["55%"], []);
  const queryClient = useQueryClient();
  const [side, setSide] = useState("BUY");
  const [shares, setShares] = useState("1");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [isQuoting, setIsQuoting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setQuote(null);
    setMessage("");
    setShares("1");
    setSide("BUY");
  }, [player?.id]);

  function endpointFor(action: string, kind: "quote" | "execute") {
    const actionPath = action.toLowerCase();
    return kind === "quote" ? `/trade/quote/${actionPath}` : `/trade/${actionPath}`;
  }

  async function previewQuote() {
    if (!player) return;
    setIsQuoting(true);
    setMessage("");
    try {
      const payload = { player_id: player.id, shares: Number(shares || "0") };
      const response = await apiPost<{
        player_id: number;
        shares: number;
        average_price: number;
        total: number;
      }>(endpointFor(side, "quote"), payload);
      setQuote({
        playerId: response.player_id,
        side: side as Quote["side"],
        quantity: response.shares,
        estimatedPrice: response.average_price,
        estimatedTotal: response.total,
        fee: 0,
      });
    } catch (error) {
      setMessage(error instanceof ApiHttpError ? error.message : "Quote preview failed.");
    } finally {
      setIsQuoting(false);
    }
  }

  async function submitTrade() {
    if (!player) return;
    setIsSubmitting(true);
    setMessage("");
    try {
      const payload = { player_id: player.id, shares: Number(shares || "0") };
      await apiPost(endpointFor(side, "execute"), payload);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["players"] }),
        queryClient.invalidateQueries({ queryKey: ["portfolio-mobile"] }),
        queryClient.invalidateQueries({ queryKey: ["player-detail", player.id] }),
      ]);
      setMessage(`${side} order submitted.`);
      onTradeComplete?.();
      onClose?.();
    } catch (error) {
      setMessage(error instanceof ApiHttpError ? error.message : "Trade failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <BottomSheet index={player ? 0 : -1} enablePanDownToClose onClose={onClose} snapPoints={snapPoints}>
      <BottomSheetView style={styles.content}>
        <Text style={styles.title}>{player ? `Trade ${player.name}` : "Select a player"}</Text>
        <SegmentedControl value={side} options={TRADE_OPTIONS} onChange={setSide} />
        <View style={styles.inputWrap}>
          <Text style={styles.label}>Shares</Text>
          <TextInput
            keyboardType="number-pad"
            onChangeText={setShares}
            style={styles.input}
            value={shares}
          />
        </View>
        <Button
          disabled={!player || isQuoting || isSubmitting}
          label={isQuoting ? "Loading..." : "Preview quote"}
          onPress={previewQuote}
        />
        {quote ? (
          <View style={styles.quoteCard}>
            <View style={styles.quoteRow}>
              <Text style={styles.label}>Avg price</Text>
              <Text style={styles.value}>{formatCurrency(quote.estimatedPrice)}</Text>
            </View>
            <View style={styles.quoteRow}>
              <Text style={styles.label}>Total</Text>
              <Text style={styles.value}>{formatCurrency(quote.estimatedTotal)}</Text>
            </View>
          </View>
        ) : null}
        {message ? <Text style={styles.message}>{message}</Text> : null}
        <Button
          disabled={!player || !quote || isSubmitting || isQuoting}
          label={isSubmitting ? "Submitting..." : `${side} now`}
          onPress={submitTrade}
          tone="secondary"
        />
      </BottomSheetView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    padding: spacing.lg,
    gap: spacing.lg,
  },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800",
  },
  inputWrap: {
    gap: spacing.sm,
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
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    color: colors.text,
  },
  quoteCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  quoteRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  value: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
  },
  message: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
});
