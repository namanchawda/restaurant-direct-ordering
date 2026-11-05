"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, AuthResponse, clearSession, readSession, saveSession, User } from "@/lib/api";

type AuthContextValue = {
  user: User | null;
  ready: boolean;
  login: (phone: string, password: string) => Promise<User>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function isUser(value: unknown): value is User {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "role" in value &&
    "phone" in value &&
    typeof value.id === "string" &&
    typeof value.phone === "string" &&
    (value.role === "admin" || value.role === "kitchen" || value.role === "customer")
  );
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const onSessionCleared = () => setUser(null);
    window.addEventListener("auth:session-cleared", onSessionCleared);
    const timer = window.setTimeout(() => {
      const session = readSession();
      setUser(isUser(session.user) ? session.user : null);
      setReady(true);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("auth:session-cleared", onSessionCleared);
    };
  }, []);

  const login = useCallback(async (phone: string, password: string) => {
    const result = await api<AuthResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ phone, password }),
    });
    saveSession(result.access_token, result.user);
    setUser(result.user);
    return result.user;
  }, []);

  const logout = useCallback(() => {
    clearSession();
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, ready, login, logout }), [user, ready, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider.");
  return context;
}
