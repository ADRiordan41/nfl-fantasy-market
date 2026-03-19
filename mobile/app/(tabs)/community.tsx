import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import type { ForumPostSummary } from "@shared/types";
import { PostCard } from "@/components/cards/PostCard";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { ApiHttpError, apiGet, apiPost } from "@/lib/api";
import { colors } from "@/theme/colors";
import { radius } from "@/theme/radius";
import { spacing } from "@/theme/spacing";

type ForumPostResponse = {
  id: number;
  title: string;
  body_preview: string;
  author_username: string;
  created_at: string;
  comment_count: number;
  view_count: number;
};

export default function CommunityScreen() {
  const queryClient = useQueryClient();
  const [showComposer, setShowComposer] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  const { data } = useQuery({
    queryKey: ["community-mobile"],
    queryFn: async () => {
      const posts = await apiGet<ForumPostResponse[]>("/forum/posts");
      return posts.map(
        (post): ForumPostSummary => ({
          id: post.id,
          title: post.title,
          body: post.body_preview,
          authorUsername: post.author_username,
          createdAt: post.created_at,
          commentCount: post.comment_count,
          likeCount: post.view_count,
          viewerReacted: false,
        })
      );
    },
  });

  async function submitPost() {
    if (!title.trim() || !body.trim()) return;
    setIsSubmitting(true);
    setMessage("");
    try {
      const created = await apiPost<{ id: number }>("/forum/posts", {
        title: title.trim(),
        body: body.trim(),
      });
      setTitle("");
      setBody("");
      setShowComposer(false);
      await queryClient.invalidateQueries({ queryKey: ["community-mobile"] });
      router.push(`/community/${created.id}`);
    } catch (error) {
      setMessage(error instanceof ApiHttpError ? error.message : "Post creation failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Screen>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Community</Text>
        <Pressable onPress={() => setShowComposer((value) => !value)} style={styles.composeToggle}>
          <Text style={styles.composeToggleText}>{showComposer ? "Close" : "New post"}</Text>
        </Pressable>
      </View>
      {showComposer ? (
        <View style={styles.composer}>
          <TextInput
            onChangeText={setTitle}
            placeholder="Title"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            value={title}
          />
          <TextInput
            multiline
            numberOfLines={5}
            onChangeText={setBody}
            placeholder="Share your take..."
            placeholderTextColor={colors.textMuted}
            style={[styles.input, styles.bodyInput]}
            value={body}
          />
          {message ? <Text style={styles.message}>{message}</Text> : null}
          <Button
            disabled={isSubmitting || !title.trim() || !body.trim()}
            label={isSubmitting ? "Posting..." : "Publish post"}
            onPress={() => void submitPost()}
          />
        </View>
      ) : null}
      {data?.length ? (
        data.map((post) => <PostCard key={post.id} onPress={() => router.push(`/community/${post.id}`)} post={post} />)
      ) : (
        <EmptyState title="No posts yet" body="The conversation feed will land here once posts are available." />
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
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md,
  },
  composeToggle: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  composeToggleText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
  },
  composer: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.md,
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
  bodyInput: {
    minHeight: 120,
    textAlignVertical: "top",
  },
  message: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
});
