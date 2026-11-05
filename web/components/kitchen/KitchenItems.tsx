"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button, Input, Switch, VegMark } from "@/components/ui";
import { useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type KitchenItem = {
  id: string;
  name: string;
  category: string;
  available: boolean;
  is_veg: boolean;
  spice_level: number;
};

export function KitchenItems() {
  const { user } = useAuth();
  const toast = useToast();
  const [items, setItems] = useState<KitchenItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    api<KitchenItem[]>("/kitchen/items")
      .then((rows) => {
        if (!active) return;
        setItems(rows);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(
          reason instanceof Error
            ? reason.message
            : "We couldn’t load the kitchen items.",
        );
      })
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  const loading = !loaded;

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const grouped = new Map<string, KitchenItem[]>();
    for (const item of items) {
      if (needle && !item.name.toLowerCase().includes(needle)) continue;
      const rows = grouped.get(item.category) ?? [];
      rows.push(item);
      grouped.set(item.category, rows);
    }
    return [...grouped.entries()];
  }, [items, query]);

  const availableCount = items.filter((item) => item.available).length;

  async function toggle(item: KitchenItem, next: boolean) {
    if (!user?.outlet_id) return;
    setSaving((current) => new Set(current).add(item.id));
    setItems((current) =>
      current.map((row) =>
        row.id === item.id ? { ...row, available: next } : row,
      ),
    );
    try {
      await api(
        `/kitchen/outlets/${user.outlet_id}/items/${item.id}/availability`,
        {
          method: "PATCH",
          body: JSON.stringify({ available: next }),
        },
      );
    } catch (reason) {
      setItems((current) =>
        current.map((row) =>
          row.id === item.id ? { ...row, available: item.available } : row,
        ),
      );
      toast(
        reason instanceof Error
          ? reason.message
          : "Could not update this item.",
        "error",
      );
    } finally {
      setSaving((current) => {
        const copy = new Set(current);
        copy.delete(item.id);
        return copy;
      });
    }
  }

  return (
    <div className="kd-page kd-items-page">
      <div className="kd-page-heading">
        <div>
          <p className="eyebrow">Menu availability</p>
          <h1>Pause items</h1>
          <p className="kd-page-subtitle">
            Turn an item off when it runs out. The ordering menu updates
            immediately.
          </p>
        </div>
        <Link className="button button-secondary" href="/kitchen">
          Back to board
        </Link>
      </div>

      <div className="kd-items-toolbar">
        <Input
          type="search"
          aria-label="Find an item"
          placeholder="Find an item"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span>
          {availableCount} of {items.length} available
        </span>
      </div>

      {loading ? (
        <div className="kd-loading" role="status">
          Loading kitchen items…
        </div>
      ) : error ? (
        <div className="kd-error" role="alert">
          <h2>We couldn’t load the item list</h2>
          <p>{error}</p>
          <Button
            variant="primary"
            onClick={() => {
              setLoaded(false);
              setAttempt((value) => value + 1);
            }}
          >
            Try again
          </Button>
        </div>
      ) : groups.length === 0 ? (
        <p className="kd-empty kd-empty-search">No items match “{query}”.</p>
      ) : (
        <div className="kd-items-groups">
          {groups.map(([category, rows]) => (
            <section className="kd-items-group" key={category}>
              <header>
                <h2>{category}</h2>
                <span>{rows.length}</span>
              </header>
              <div className="kd-items-list">
                {rows.map((item) => {
                  const isSaving = saving.has(item.id);
                  return (
                    <div className="kd-item-row" key={item.id}>
                      <VegMark isVeg={item.is_veg} />
                      <div className="kd-item-name">
                        <strong>{item.name}</strong>
                        <span>
                          {item.spice_level > 0
                            ? `Spice ${item.spice_level}/3`
                            : "Mild"}
                        </span>
                      </div>
                      <span
                        className={`kd-item-state ${
                          item.available ? "is-available" : "is-paused"
                        }`}
                      >
                        {item.available ? "Available" : "Paused"}
                      </span>
                      <Switch
                        checked={item.available}
                        disabled={isSaving}
                        label={`Mark ${item.name} ${
                          item.available ? "unavailable" : "available"
                        }`}
                        onCheckedChange={(next) => void toggle(item, next)}
                      />
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
