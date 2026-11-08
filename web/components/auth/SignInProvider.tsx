"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { SignInPanel } from "@/components/auth/SignInPanel";
import type { SignInMode } from "@/lib/sign-in";

export type SignInOptions = {
  mode?: SignInMode;
  redirectTo?: string;
  onSuccess?: () => void;
};

type SignInContextValue = {
  openSignIn: (options?: SignInOptions) => void;
  closeSignIn: () => void;
};

const SignInContext = createContext<SignInContextValue | null>(null);

export function SignInProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<SignInOptions | null>(null);
  const [count, setCount] = useState(0);
  const openSignIn = useCallback((next: SignInOptions = {}) => {
    setOptions(next);
    setCount((value) => value + 1);
  }, []);
  const closeSignIn = useCallback(() => setOptions(null), []);
  const value = useMemo(() => ({ openSignIn, closeSignIn }), [openSignIn, closeSignIn]);
  return (
    <SignInContext.Provider value={value}>
      {children}
      {options && <SignInPanel key={count} options={options} onClose={closeSignIn} />}
    </SignInContext.Provider>
  );
}

export function useSignIn() {
  const context = useContext(SignInContext);
  if (!context) throw new Error("useSignIn must be used within SignInProvider.");
  return context;
}
