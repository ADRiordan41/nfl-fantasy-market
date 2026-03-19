import { useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { StyleSheet, Text, TextInput, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { ApiHttpError, apiGet, apiPost } from "@/lib/api";
import { colors } from "@/theme/colors";
import { radius } from "@/theme/radius";
import { spacing } from "@/theme/spacing";

type CommentResponse = {
  id: number;
  body: string;
  author_username: string;
  created_at: string;
};

type PostDetailResponse = {
  id: number;
  title: string;
  body: string;
  author_username: string;
  comment_count: number;
  view_count: number;
  created_at: string;
  comments: CommentResponse[];
};

export default function CommunityPostDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const postId = Number(params.id);
  const queryClient = useQueryClient();
  const [comment, setComment] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  const { data, refetch } = useQuery({
    queryKey: ["community-post-mobile", postId],
    enabled: Number.isFinite(postId),
    queryFn: () => apiGet<PostDetailResponse>(`/forum/posts/${postId}`),
  });

  async function submitComment() {
    if (!comment.trim()) return;
    setIsSubmitting(true);
    setMessage("");
    try {
      await apiPost(`/forum/posts/${postId}/comments`, { body: comment.trim() });
      setComment("");
      await Promise.all([
        refetch(),
        queryClient.invalidateQueries({ queryKey: ["community-mobile"] }),
        queryClient.invalidateQueries({ queryKey: ["notifications-mobile"] }),
      ]);
    } catch (error) {
      setMessage(error instanceof ApiHttpError ? error.message : "Comment failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Screen>
      {data ? (
        <>
          <View style={styles.card}>
            <Text style={styles.title}>{data.title}</Text>
            <Text style={styles.meta}>
              @{data.author_username} · {data.comment_count} comments · {data.view_count} views
            </Text>
            <Text style={styles.body}>{data.body}</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Reply</Text>
            <TextInput
              multiline
              numberOfLines={4}
              onChangeText={setComment}
              placeholder="Add your comment..."
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              value={comment}
            />
            {message ? <Text style={styles.message}>{message}</Text> : null}
            <Button
              disabled={isSubmitting || !comment.trim()}
              label={isSubmitting ? "Posting..." : "Post comment"}
              onPress={() => void submitComment()}
            />
          </View>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Comments</Text>
            {data.comments.map((entry) => (
              <View key={entry.id} style={styles.commentCard}>
                <Text style={styles.commentAuthor}>@{entry.author_username}</Text>
                <Text style={styles.commentBody}>{entry.body}</Text>
                <Text style={styles.commentMeta}>{new Date(entry.created_at).toLocaleString()}</Text>
              </View>
            ))}
            {!data.comments.length ? <Text style={styles.message}>No comments yet.</Text> : null}
          </View>
        </>
      ) : (
        <EmptyState title="Post unavailable" body="We couldn't load this discussion right now." />
      )}
    </Screen>
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
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "800",
  },
  meta: {
    color: colors.textMuted,
    fontSize: 13,
  },
  body: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "700",
  },
  input: {
    minHeight: 110,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    textAlignVertical: "top",
    color: colors.text,
  },
  message: {
    color: colors.textMuted,
    fontSize: 13,
  },
  commentCard: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
    gap: spacing.xs,
  },
  commentAuthor: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
  },
  commentBody: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  commentMeta: {
    color: colors.textMuted,
    fontSize: 12,
  },
});
