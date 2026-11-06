"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Switch } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { OutletResult } from "@/lib/customer";
import type { KitchenLiveStatus } from "@/lib/useKitchenLive";

type TextSize = "normal" | "large" | "xlarge";

type KitchenSettings = {
  soundEnabled: boolean;
  textSize: TextSize;
  highContrast: boolean;
};

type SettingsContextValue = KitchenSettings & {
  setSoundEnabled: (value: boolean) => void;
  enableSound: () => Promise<void>;
  playChime: () => void;
  setTextSize: (value: TextSize) => void;
  setHighContrast: (value: boolean) => void;
};

type ConnectionContextValue = {
  status: KitchenLiveStatus;
  setStatus: (status: KitchenLiveStatus) => void;
};

const DEFAULT_SETTINGS: KitchenSettings = {
  soundEnabled: false,
  textSize: "normal",
  highContrast: false,
};
const SETTINGS_KEY = "hyderabad-biryani-kitchen-settings";

const SettingsContext = createContext<SettingsContextValue | null>(null);
const ConnectionContext = createContext<ConnectionContextValue | null>(null);

function readStoredSettings(): KitchenSettings | null {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const record = value as Record<string, unknown>;
    const textSize =
      record.textSize === "large" || record.textSize === "xlarge"
        ? record.textSize
        : "normal";
    return {
      soundEnabled: record.soundEnabled === true,
      textSize,
      highContrast: record.highContrast === true,
    };
  } catch {
    return null;
  }
}

type SettingsSnapshot = {
  settings: KitchenSettings;
  loaded: boolean;
};

const SERVER_SETTINGS_SNAPSHOT: SettingsSnapshot = {
  settings: DEFAULT_SETTINGS,
  loaded: false,
};
let settingsSnapshot = SERVER_SETTINGS_SNAPSHOT;
let settingsLoaded = false;
const settingsListeners = new Set<() => void>();

function notifySettingsListeners() {
  settingsListeners.forEach((listener) => listener());
}

function loadStoredSettings() {
  if (settingsLoaded || typeof window === "undefined") return;
  settingsLoaded = true;
  settingsSnapshot = {
    settings: readStoredSettings() ?? DEFAULT_SETTINGS,
    loaded: true,
  };
}

function subscribeSettings(listener: () => void) {
  settingsListeners.add(listener);
  loadStoredSettings();
  listener();
  const onStorage = (event: StorageEvent) => {
    if (event.key !== SETTINGS_KEY && event.key !== null) return;
    settingsLoaded = false;
    loadStoredSettings();
    notifySettingsListeners();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    settingsListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function getSettingsSnapshot() {
  return settingsSnapshot;
}

function getServerSettingsSnapshot() {
  return SERVER_SETTINGS_SNAPSHOT;
}

function updateStoredSettings(update: (current: KitchenSettings) => KitchenSettings) {
  loadStoredSettings();
  settingsSnapshot = {
    settings: update(settingsSnapshot.settings),
    loaded: true,
  };
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settingsSnapshot.settings));
  } catch (error) {
    console.error("Could not save the kitchen display settings.", error);
  }
  notifySettingsListeners();
}

const STATUS_LABELS: Record<KitchenLiveStatus, string> = {
  idle: "",
  connecting: "Connecting",
  live: "Live",
  reconnecting: "Reconnecting",
  polling: "Polling",
  offline: "Offline",
};

const CLOCK_FORMAT = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
});

function KitchenClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <time
      className="kd-clock"
      dateTime={now.toISOString()}
      suppressHydrationWarning
    >
      {CLOCK_FORMAT.format(now)}
    </time>
  );
}

export function KitchenChrome({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const { settings } = useSyncExternalStore(
    subscribeSettings,
    getSettingsSnapshot,
    getServerSettingsSnapshot,
  );
  const [status, setStatus] = useState<KitchenLiveStatus>("idle");
  const [outletName, setOutletName] = useState<string | null>(null);
  const audioRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!user?.outlet_id) return;
    let active = true;
    api<OutletResult[]>("/outlets")
      .then((outlets) => {
        if (!active) return;
        setOutletName(
          outlets.find((outlet) => outlet.id === user.outlet_id)?.name ?? null,
        );
      })
      .catch(() => {
        if (active) setOutletName(null);
      });
    return () => {
      active = false;
    };
  }, [user?.outlet_id]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.wakeLock) return;
    let sentinel: WakeLockSentinel | null = null;
    let stopped = false;

    async function acquire() {
      if (stopped || document.visibilityState !== "visible") return;
      try {
        sentinel = await navigator.wakeLock.request("screen");
      } catch {
        sentinel = null;
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible" && !sentinel) {
        void acquire();
      }
    }

    void acquire();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (sentinel) {
        void sentinel.release().catch(() => undefined);
        sentinel = null;
      }
    };
  }, []);

  const playChimeNow = useCallback(() => {
    const context = audioRef.current;
    if (!context || context.state !== "running") return;
    const start = context.currentTime;
    for (const [index, frequency] of [880, 660].entries()) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const offset = start + index * 0.18;
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, offset);
      gain.gain.exponentialRampToValueAtTime(0.16, offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, offset + 0.16);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(offset);
      oscillator.stop(offset + 0.18);
    }
  }, []);

  const enableSound = useCallback(async () => {
    try {
      const AudioContextConstructor =
        window.AudioContext ??
        (
          window as typeof window & {
            webkitAudioContext?: typeof AudioContext;
          }
        ).webkitAudioContext;
      if (!AudioContextConstructor) return;
      if (!audioRef.current) {
        audioRef.current = new AudioContextConstructor();
      }
      await audioRef.current.resume();
      updateStoredSettings((current) => ({ ...current, soundEnabled: true }));
      playChimeNow();
    } catch {
      updateStoredSettings((current) => ({ ...current, soundEnabled: false }));
    }
  }, [playChimeNow]);

  const setSoundEnabled = useCallback(
    (value: boolean) => {
      if (value) {
        void enableSound();
      } else {
        updateStoredSettings((current) => ({ ...current, soundEnabled: false }));
      }
    },
    [enableSound],
  );

  const playChime = useCallback(() => {
    if (!settings.soundEnabled) return;
    playChimeNow();
  }, [playChimeNow, settings.soundEnabled]);

  const settingsValue = useMemo<SettingsContextValue>(
    () => ({
      ...settings,
      setSoundEnabled,
      enableSound,
      playChime,
      setTextSize: (value) =>
        updateStoredSettings((current) => ({ ...current, textSize: value })),
      setHighContrast: (value) =>
        updateStoredSettings((current) => ({ ...current, highContrast: value })),
    }),
    [settings, setSoundEnabled, enableSound, playChime],
  );

  const connectionValue = useMemo<ConnectionContextValue>(
    () => ({ status, setStatus }),
    [status],
  );

  const boardActive = pathname === "/kitchen";
  const itemsActive = pathname.startsWith("/kitchen/items");
  const statsActive = pathname.startsWith("/kitchen/stats");

  return (
    <SettingsContext.Provider value={settingsValue}>
      <ConnectionContext.Provider value={connectionValue}>
        <div
          className="kd-app"
          data-text-size={settings.textSize}
          data-theme={settings.highContrast ? "contrast" : "light"}
        >
          <a className="kd-skip" href="#kd-main">
            Skip to orders
          </a>
          <header className="kd-header">
            <div className="kd-brand">
              <span className="brand-mark" aria-hidden="true">
                H
              </span>
              <div>
                <span className="kd-outlet">{outletName ?? "Kitchen"}</span>
                <span className="kd-subtitle">Kitchen display</span>
              </div>
            </div>
            <div className="kd-header-right">
              <KitchenClock />
              {status !== "idle" && (
                <span
                  className={`kd-status kd-status-${status}`}
                  role="status"
                  aria-live="polite"
                >
                  <span className="kd-status-dot" aria-hidden="true" />
                  {STATUS_LABELS[status]}
                </span>
              )}
              <nav className="kd-nav" aria-label="Kitchen sections">
                <Link
                  href="/kitchen"
                  className={boardActive ? "is-active" : ""}
                  aria-current={boardActive ? "page" : undefined}
                >
                  Board
                </Link>
                <Link
                  href="/kitchen/items"
                  className={itemsActive ? "is-active" : ""}
                  aria-current={itemsActive ? "page" : undefined}
                >
                  Items
                </Link>
                <Link href="/kitchen/stats" className={statsActive ? "is-active" : ""} aria-current={statsActive ? "page" : undefined}>Stats</Link>
              </nav>
              <details className="kd-settings">
                <summary>Settings</summary>
                <div
                  className="kd-settings-panel"
                  role="group"
                  aria-label="Kitchen display settings"
                >
                  <div className="kd-setting-row">
                    <div>
                      <strong>New order sound</strong>
                      <span>Beep when a paid order arrives.</span>
                    </div>
                    <Switch
                      checked={settings.soundEnabled}
                      onCheckedChange={setSoundEnabled}
                      label="New order sound"
                    />
                  </div>
                  <div className="kd-setting-block">
                    <strong>Text size</strong>
                    <div className="kd-segmented" role="group" aria-label="Text size">
                      {(["normal", "large", "xlarge"] as TextSize[]).map((size) => (
                        <button
                          key={size}
                          type="button"
                          aria-pressed={settings.textSize === size}
                          className={
                            settings.textSize === size ? "is-selected" : ""
                          }
                          onClick={() => settingsValue.setTextSize(size)}
                        >
                          {size === "normal"
                            ? "Normal"
                            : size === "large"
                              ? "Large"
                              : "Extra large"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="kd-setting-row">
                    <div>
                      <strong>High contrast</strong>
                      <span>Dark theme for bright kitchens.</span>
                    </div>
                    <Switch
                      checked={settings.highContrast}
                      onCheckedChange={settingsValue.setHighContrast}
                      label="High contrast theme"
                    />
                  </div>
                  <button
                    type="button"
                    className="button button-secondary kd-signout"
                    onClick={logout}
                  >
                    Sign out
                  </button>
                </div>
              </details>
            </div>
          </header>
          <main id="kd-main" className="kd-main">
            {children}
          </main>
        </div>
      </ConnectionContext.Provider>
    </SettingsContext.Provider>
  );
}

export function useKitchenSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useKitchenSettings must be used within KitchenChrome.");
  }
  return context;
}

export function useKitchenConnection(): ConnectionContextValue {
  const context = useContext(ConnectionContext);
  if (!context) {
    throw new Error("useKitchenConnection must be used within KitchenChrome.");
  }
  return context;
}
