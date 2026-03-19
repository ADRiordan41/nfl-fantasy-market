import { Pressable, StyleSheet, Text, View } from "react-native";

import type { ForumPostSummary } from "@shared/types";
import { colors } from "@/theme/colors";
import { radius } from "@/theme/radius";
import { spacing } from "@/theme/spacing";

type PostCardProps = {
  post: ForumPostSummary;
  onPress?: () => void;
};

export function PostCard({ post, onPress }: PostCardProps) {
  return (
    <Pressable style={styles.card} onPress={onPress}>
      <Text style={styles.title}>{post.title}</Text>
      <Text numberOfLines={3} style={styles.body}>{post.body}</Text>
      <View style={styles.footer}>
        <Text style={styles.meta}>@{post.authorUsername}</Text>
        <Text style={styles.meta}>{post.commentCount} comments</Text>
      </View>
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
    gap: spacing.sm,
  },
  title: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
  },
  body: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  meta: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "600",
  },
});
