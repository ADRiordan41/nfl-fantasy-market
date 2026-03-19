import { useEffect, useMemo, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import type { DirectMessage, DirectThreadDetail, DirectThreadSummary, FriendsDashboard } from "@shared/types";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { ApiHttpError, apiGet, apiPost } from "@/lib/api";
import { colors } from "@/theme/colors";
import { radius } from "@/theme/radius";
import { spacing } from "@/theme/spacing";

type DirectThreadSummaryResponse = {
  id: number;
  counterpart_user_id: number;
  counterpart_username: string;
  counterpart_profile_image_url: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_message_sender_username: string | null;
  message_count: number;
  unread_count: number;
};

type DirectMessageResponse = {
  id: number;
  thread_id: number;
  sender_user_id: number;
  sender_username: string;
  body: string;
  created_at: string;
  own_message: boolean;
};

type DirectThreadDetailResponse = DirectThreadSummaryResponse & {
  messages: DirectMessageResponse[];
};

type FriendsDashboardResponse = {
  friends: {
    friendship_id: number;
    user_id: number;
    username: string;
    profile_image_url: string | null;
    since: string;
  }[];
  incoming_requests: {
    friendship_id: number;
    user_id: number;
    username: string;
    profile_image_url: string | null;
    requested_at: string;
    requested_by_user_id: number;
    direction: "incoming" | "outgoing";
  }[];
  outgoing_requests: {
    friendship_id: number;
    user_id: number;
    username: string;
    profile_image_url: string | null;
    requested_at: string;
    requested_by_user_id: number;
    direction: "incoming" | "outgoing";
  }[];
};

function mapThreadSummary(thread: DirectThreadSummaryResponse): DirectThreadSummary {
  return {
    id: thread.id,
    counterpartUserId: thread.counterpart_user_id,
    counterpartUsername: thread.counterpart_username,
    counterpartProfileImageUrl: thread.counterpart_profile_image_url,
    createdAt: thread.created_at,
    updatedAt: thread.updated_at,
    lastMessageAt: thread.last_message_at,
    lastMessagePreview: thread.last_message_preview,
    lastMessageSenderUsername: thread.last_message_sender_username,
    messageCount: thread.message_count,
    unreadCount: thread.unread_count,
  };
}

function mapMessage(message: DirectMessageResponse): DirectMessage {
  return {
    id: message.id,
    threadId: message.thread_id,
    senderUserId: message.sender_user_id,
    senderUsername: message.sender_username,
    body: message.body,
    createdAt: message.created_at,
    ownMessage: message.own_message,
  };
}

function mapFriendsDashboard(data: FriendsDashboardResponse): FriendsDashboard {
  return {
    friends: data.friends.map((friend) => ({
      friendshipId: friend.friendship_id,
      userId: friend.user_id,
      username: friend.username,
      profileImageUrl: friend.profile_image_url,
      since: friend.since,
    })),
    incomingRequests: data.incoming_requests.map((request) => ({
      friendshipId: request.friendship_id,
      userId: request.user_id,
      username: request.username,
      profileImageUrl: request.profile_image_url,
      requestedAt: request.requested_at,
      requestedByUserId: request.requested_by_user_id,
      direction: request.direction,
    })),
    outgoingRequests: data.outgoing_requests.map((request) => ({
      friendshipId: request.friendship_id,
      userId: request.user_id,
      username: request.username,
      profileImageUrl: request.profile_image_url,
      requestedAt: request.requested_at,
      requestedByUserId: request.requested_by_user_id,
      direction: request.direction,
    })),
  };
}

export default function InboxScreen() {
  const params = useLocalSearchParams<{ thread?: string }>();
  const requestedThreadId = Number(params.thread ?? "0") || null;
  const queryClient = useQueryClient();

  const [selectedThreadId, setSelectedThreadId] = useState<number | null>(requestedThreadId);
  const [newThreadUsername, setNewThreadUsername] = useState("");
  const [initialMessage, setInitialMessage] = useState("");
  const [draftMessage, setDraftMessage] = useState("");
  const [busyFriendAction, setBusyFriendAction] = useState("");
  const [busyOpenThread, setBusyOpenThread] = useState(false);
  const [busySend, setBusySend] = useState(false);
  const [message, setMessage] = useState("");

  const { data: threads, refetch: refetchThreads } = useQuery({
    queryKey: ["inbox-threads-mobile"],
    queryFn: async () => {
      const response = await apiGet<DirectThreadSummaryResponse[]>("/inbox/threads?limit=200");
      return response.map(mapThreadSummary);
    },
  });

  const { data: friendsDashboard, refetch: refetchFriends } = useQuery({
    queryKey: ["friends-dashboard-mobile"],
    queryFn: async () => {
      const response = await apiGet<FriendsDashboardResponse>("/friends");
      return mapFriendsDashboard(response);
    },
  });

  const { data: selectedThread, refetch: refetchSelectedThread } = useQuery({
    queryKey: ["inbox-thread-mobile", selectedThreadId],
    enabled: Boolean(selectedThreadId),
    queryFn: async () => {
      const response = await apiGet<DirectThreadDetailResponse>(`/inbox/threads/${selectedThreadId}`);
      const summary = mapThreadSummary(response);
      const detail: DirectThreadDetail = {
        ...summary,
        messages: response.messages.map(mapMessage),
      };
      return detail;
    },
  });

  useEffect(() => {
    if (requestedThreadId) {
      setSelectedThreadId(requestedThreadId);
      return;
    }
    if (!selectedThreadId && threads?.length) {
      setSelectedThreadId(threads[0].id);
    }
  }, [requestedThreadId, selectedThreadId, threads]);

  const friendUsernames = useMemo(
    () => new Set((friendsDashboard?.friends ?? []).map((friend) => friend.username.toLowerCase())),
    [friendsDashboard?.friends]
  );

  async function openThread() {
    const username = newThreadUsername.trim();
    if (!username) {
      setMessage("Choose a friend username first.");
      return;
    }
    if (!friendUsernames.has(username.toLowerCase())) {
      setMessage("You can only open threads with accepted friends.");
      return;
    }
    setBusyOpenThread(true);
    setMessage("");
    try {
      const response = await apiPost<DirectThreadSummaryResponse>("/inbox/threads", {
        username,
        initial_message: initialMessage.trim() || undefined,
      });
      const opened = mapThreadSummary(response);
      setNewThreadUsername("");
      setInitialMessage("");
      setSelectedThreadId(opened.id);
      await Promise.all([
        refetchThreads(),
        queryClient.invalidateQueries({ queryKey: ["inbox-thread-mobile"] }),
        queryClient.invalidateQueries({ queryKey: ["notifications-mobile"] }),
      ]);
    } catch (error) {
      setMessage(error instanceof ApiHttpError ? error.message : "Thread open failed.");
    } finally {
      setBusyOpenThread(false);
    }
  }

  async function sendMessage() {
    if (!selectedThreadId || !draftMessage.trim()) return;
    setBusySend(true);
    setMessage("");
    try {
      await apiPost(`/inbox/threads/${selectedThreadId}/messages`, {
        body: draftMessage.trim(),
      });
      setDraftMessage("");
      await Promise.all([
        refetchSelectedThread(),
        refetchThreads(),
        queryClient.invalidateQueries({ queryKey: ["notifications-mobile"] }),
      ]);
    } catch (error) {
      setMessage(error instanceof ApiHttpError ? error.message : "Message send failed.");
    } finally {
      setBusySend(false);
    }
  }

  async function respondToRequest(friendshipId: number, action: "accept" | "decline") {
    setBusyFriendAction(`${action}:${friendshipId}`);
    setMessage("");
    try {
      await apiPost(`/friends/requests/${friendshipId}/${action}`, {});
      await Promise.all([
        refetchFriends(),
        queryClient.invalidateQueries({ queryKey: ["notifications-mobile"] }),
      ]);
    } catch (error) {
      setMessage(error instanceof ApiHttpError ? error.message : "Friend request update failed.");
    } finally {
      setBusyFriendAction("");
    }
  }

  return (
    <Screen>
      <Text style={styles.title}>Inbox</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Open a thread</Text>
        <TextInput
          autoCapitalize="none"
          onChangeText={setNewThreadUsername}
          placeholder="Friend username"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          value={newThreadUsername}
        />
        <TextInput
          multiline
          numberOfLines={3}
          onChangeText={setInitialMessage}
          placeholder="Optional first message"
          placeholderTextColor={colors.textMuted}
          style={[styles.input, styles.multiline]}
          value={initialMessage}
        />
        <Button
          disabled={busyOpenThread || !newThreadUsername.trim()}
          label={busyOpenThread ? "Opening..." : "Open thread"}
          onPress={() => void openThread()}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Incoming requests</Text>
        {friendsDashboard?.incomingRequests.length ? (
          friendsDashboard.incomingRequests.map((request) => (
            <View key={request.friendshipId} style={styles.friendRow}>
              <View style={styles.friendMeta}>
                <Text style={styles.friendName}>@{request.username}</Text>
                <Text style={styles.friendSubtle}>
                  Requested {new Date(request.requestedAt).toLocaleDateString()}
                </Text>
              </View>
              <View style={styles.friendActions}>
                <Pressable
                  disabled={Boolean(busyFriendAction)}
                  onPress={() => void respondToRequest(request.friendshipId, "accept")}
                  style={[styles.inlineButton, styles.inlineButtonPrimary]}
                >
                  <Text style={styles.inlineButtonPrimaryText}>Accept</Text>
                </Pressable>
                <Pressable
                  disabled={Boolean(busyFriendAction)}
                  onPress={() => void respondToRequest(request.friendshipId, "decline")}
                  style={styles.inlineButton}
                >
                  <Text style={styles.inlineButtonText}>Decline</Text>
                </Pressable>
              </View>
            </View>
          ))
        ) : (
          <Text style={styles.subtle}>No incoming friend requests.</Text>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Friends</Text>
        {friendsDashboard?.friends.length ? (
          friendsDashboard.friends.map((friend) => (
            <Pressable
              key={friend.friendshipId}
              onPress={() => setNewThreadUsername(friend.username)}
              style={styles.friendSelector}
            >
              <Text style={styles.friendName}>@{friend.username}</Text>
              <Text style={styles.friendSubtle}>Tap to use in compose</Text>
            </Pressable>
          ))
        ) : (
          <Text style={styles.subtle}>Accept a friend request to unlock direct messages.</Text>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Threads</Text>
        {threads?.length ? (
          threads.map((thread) => {
            const active = thread.id === selectedThreadId;
            return (
              <Pressable
                key={thread.id}
                onPress={() => setSelectedThreadId(thread.id)}
                style={[styles.threadCard, active && styles.threadCardActive]}
              >
                <View style={styles.threadHeader}>
                  <Text style={styles.friendName}>@{thread.counterpartUsername}</Text>
                  {thread.unreadCount > 0 ? <Text style={styles.unreadBadge}>{thread.unreadCount}</Text> : null}
                </View>
                <Text numberOfLines={2} style={styles.threadPreview}>
                  {thread.lastMessagePreview ?? "Thread opened. Send the first message."}
                </Text>
                <Text style={styles.friendSubtle}>
                  {thread.messageCount} messages
                  {thread.lastMessageAt ? ` · ${new Date(thread.lastMessageAt).toLocaleString()}` : ""}
                </Text>
              </Pressable>
            );
          })
        ) : (
          <EmptyState
            body="Once you start a conversation with a friend, it will show up here."
            title="No threads yet"
          />
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>
          {selectedThread ? `Conversation with @${selectedThread.counterpartUsername}` : "Conversation"}
        </Text>
        {selectedThread ? (
          <>
            <View style={styles.messageList}>
              {selectedThread.messages.length ? (
                selectedThread.messages.map((entry) => (
                  <View
                    key={entry.id}
                    style={[
                      styles.bubbleWrap,
                      entry.ownMessage ? styles.bubbleWrapOwn : styles.bubbleWrapOther,
                    ]}
                  >
                    <View style={[styles.bubble, entry.ownMessage ? styles.bubbleOwn : styles.bubbleOther]}>
                      <Text style={[styles.bubbleMeta, entry.ownMessage && styles.bubbleMetaOwn]}>
                        {entry.ownMessage ? "You" : entry.senderUsername} ·{" "}
                        {new Date(entry.createdAt).toLocaleString()}
                      </Text>
                      <Text style={[styles.bubbleBody, entry.ownMessage && styles.bubbleBodyOwn]}>{entry.body}</Text>
                    </View>
                  </View>
                ))
              ) : (
                <Text style={styles.subtle}>No messages yet.</Text>
              )}
            </View>
            <TextInput
              multiline
              numberOfLines={4}
              onChangeText={setDraftMessage}
              placeholder={`Message @${selectedThread.counterpartUsername}`}
              placeholderTextColor={colors.textMuted}
              style={[styles.input, styles.multiline]}
              value={draftMessage}
            />
            <Button
              disabled={busySend || !draftMessage.trim()}
              label={busySend ? "Sending..." : "Send message"}
              onPress={() => void sendMessage()}
            />
          </>
        ) : (
          <Text style={styles.subtle}>Select a thread to read or reply.</Text>
        )}
      </View>
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
    lineHeight: 18,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.md,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 17,
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
    minHeight: 92,
    textAlignVertical: "top",
  },
  subtle: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  friendRow: {
    gap: spacing.sm,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  friendMeta: {
    gap: spacing.xs,
  },
  friendName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
  },
  friendSubtle: {
    color: colors.textMuted,
    fontSize: 12,
  },
  friendActions: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  inlineButton: {
    minHeight: 34,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.surfaceMuted,
  },
  inlineButtonPrimary: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  inlineButtonText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
  },
  inlineButtonPrimaryText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "700",
  },
  friendSelector: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  threadCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  threadCardActive: {
    borderColor: colors.brand,
    backgroundColor: colors.surfaceMuted,
  },
  threadHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md,
  },
  threadPreview: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
  },
  unreadBadge: {
    color: "#ffffff",
    backgroundColor: colors.accent,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    fontSize: 11,
    fontWeight: "800",
  },
  messageList: {
    gap: spacing.md,
  },
  bubbleWrap: {
    width: "100%",
  },
  bubbleWrapOwn: {
    alignItems: "flex-end",
  },
  bubbleWrapOther: {
    alignItems: "flex-start",
  },
  bubble: {
    maxWidth: "92%",
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.xs,
  },
  bubbleOwn: {
    backgroundColor: colors.brand,
  },
  bubbleOther: {
    backgroundColor: colors.surfaceMuted,
  },
  bubbleMeta: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "700",
  },
  bubbleMetaOwn: {
    color: "rgba(255,255,255,0.75)",
  },
  bubbleBody: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  bubbleBodyOwn: {
    color: "#ffffff",
  },
});
