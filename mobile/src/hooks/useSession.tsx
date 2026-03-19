import { PropsWithChildren, createContext, useContext, useEffect, useMemo, useState } from "react";
import { router } from "expo-router";

import type { UserAccount } from "@shared/types";
import { apiGet, apiPost, isUnauthorizedError } from "@/lib/api";
import { clearAuthToken, getAuthToken, setAuthToken } from "@/lib/secure-storage";

type AuthSessionResponse = {
  access_token: string;
  token_type: string;
  expires_at: string;
  user: UserAccount;
};

type SessionContextValue = {
  user: UserAccount | null;
  token: string;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<UserAccount | null>(null);
  const [token, setToken] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function restoreSession() {
      try {
        const storedToken = await getAuthToken();
        setToken(storedToken);
        const me = await apiGet<UserAccount>("/auth/me");
        setUser(me);
      } catch (error) {
        if (isUnauthorizedError(error)) {
          await clearAuthToken();
          setToken("");
          setUser(null);
        }
      } finally {
        setIsLoading(false);
      }
    }

    void restoreSession();
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      user,
      token,
      isLoading,
      async login(username: string, password: string) {
        const session = await apiPost<AuthSessionResponse>("/auth/login", { username, password });
        await setAuthToken(session.access_token);
        setToken(session.access_token);
        setUser(session.user);
        router.replace("/(tabs)");
      },
      async logout() {
        try {
          await apiPost("/auth/logout");
        } catch {
          // Logging out locally is still safe if the remote session is already gone.
        }
        await clearAuthToken();
        setToken("");
        setUser(null);
        router.replace("/auth");
      },
    }),
    [isLoading, token, user]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession must be used inside SessionProvider");
  }
  return context;
}
