/**
 * Portal auth context — Phase P0-A.
 *
 * Supabase Auth is the identity authority. The provider keeps the official
 * session, mirrors the access token into the API client, and exposes
 * register / login / logout. No password storage, no invented sessions: if
 * Supabase is not configured the portal simply shows the login screen.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { getSupabaseClient } from "@/app/supabase";
import { setApiAccessToken } from "@/app/api";
import { clearPortalQueryCache } from "@/app/query-client";

export interface AuthUser {
  id: string;
  email?: string;
}

export type SignUpResult = "signed-in" | "confirm";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<SignUpResult>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  signIn: async () => {},
  signUp: async () => "confirm",
  signOut: async () => {},
});

function toAuthUser(
  session: {
    user?: { id: string; email?: string | null };
  } | null,
): AuthUser | null {
  if (!session?.user) return null;
  return {
    id: session.user.id,
    ...(session.user.email ? { email: session.user.email } : {}),
  };
}

export function AuthProvider(props: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const client = getSupabaseClient();
    if (!client) {
      setLoading(false);
      return;
    }
    let active = true;
    client.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        setApiAccessToken(data.session?.access_token ?? null);
        setUser(toAuthUser(data.session));
        setLoading(false);
      })
      .catch(() => {
        if (active) setLoading(false);
      });

    const { data: subscription } = client.auth.onAuthStateChange(
      (_event, session) => {
        setApiAccessToken(session?.access_token ?? null);
        setUser(toAuthUser(session));
      },
    );
    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const client = getSupabaseClient();
    if (!client) throw new Error("Supabase Auth is not configured.");
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const client = getSupabaseClient();
    if (!client) throw new Error("Supabase Auth is not configured.");
    const { data, error } = await client.auth.signUp({ email, password });
    if (error) throw error;
    return data.session ? ("signed-in" as const) : ("confirm" as const);
  }, []);

  const signOut = useCallback(async () => {
    const client = getSupabaseClient();
    if (client) {
      await client.auth.signOut();
    }
    setApiAccessToken(null);
    setUser(null);
    clearPortalQueryCache();
  }, []);

  const value = useMemo(
    () => ({ user, loading, signIn, signUp, signOut }),
    [user, loading, signIn, signUp, signOut],
  );

  return (
    <AuthContext.Provider value={value}>{props.children}</AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
