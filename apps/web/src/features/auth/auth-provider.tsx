"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext } from "react";
import { apiFetch } from "@/lib/api";
import type { User } from "@/lib/types";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["auth", "me"],
    queryFn: () => apiFetch<{ user: User }>("/auth/me"),
    retry: false,
  });

  async function login(email: string, password: string) {
    const result = await apiFetch<{ user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    queryClient.setQueryData(["auth", "me"], result);
    return result.user;
  }

  async function logout() {
    await apiFetch<void>("/auth/logout", { method: "POST" }, false);
    queryClient.clear();
  }

  return (
    <AuthContext.Provider
      value={{
        user: query.data?.user ?? null,
        loading: query.isLoading,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
