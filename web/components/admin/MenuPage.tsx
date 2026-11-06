"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, describeApiError, Category, MenuItem, Outlet, jsonBody } from "@/lib/api";
import { Button, Dialog, EmptyState, Input, Price, Select, Skeleton, Switch, useToast, VegMark } from "@/components/ui";
import { CategoryManager } from "./CategoryManager";

type OutletAvailability = Pick<Outlet, "id" | "name" | "city"> & { available: boolean };
type AvailabilityMap = Record<string, Record<string, boolean>>;

export function MenuPage() {
  const toast = useToast();
  const [items, setItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [outlets, setOutlets] = useState<Array<Pick<Outlet, "id" | "name" | "city">>>([]);
  const [availability, setAvailability] = useState<AvailabilityMap>({});
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [foodFilter, setFoodFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityError, setAvailabilityError] = useState("");
  const [deleteItem, setDeleteItem] = useState<MenuItem | null>(null);
  const [categoryDialog, setCategoryDialog] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [nextItems, nextCategories, nextOutlets] = await Promise.all([
        api<MenuItem[]>("/admin/items"),
        api<Category[]>("/admin/categories"),
        api<Outlet[]>("/outlets"),
      ]);
      setLoadError("");
      setItems(nextItems);
      setCategories(nextCategories);
      setOutlets(nextOutlets);
    } catch (error) {
      setLoadError(describeApiError(error, "Could not load menu data."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const filteredItems = useMemo(() => {
    return [...items]
      .filter((item) => item.name.toLowerCase().includes(search.trim().toLowerCase()))
      .filter((item) => categoryFilter === "all" || item.category_id === categoryFilter)
      .filter((item) => foodFilter === "all" || item.is_veg === (foodFilter === "veg"))
      .sort((a, b) => {
        const categoryOrder = categories.find((category) => category.id === a.category_id)?.sort_order ?? 0;
        const otherOrder = categories.find((category) => category.id === b.category_id)?.sort_order ?? 0;
        return categoryOrder - otherOrder || a.sort_order - b.sort_order || a.name.localeCompare(b.name);
      });
  }, [items, categories, search, categoryFilter, foodFilter]);

  async function toggleActive(item: MenuItem, next: boolean) {
    setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, active: next } : entry));
    try {
      await api(`/admin/items/${item.id}`, { method: "PATCH", body: jsonBody({ active: next }) });
      toast(next ? `${item.name} is active.` : `${item.name} is inactive.`, "success");
    } catch (error) {
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, active: item.active } : entry));
      toast(describeApiError(error, "Could not update item status."), "error");
    }
  }

  async function toggleAvailability(outlet: Pick<Outlet, "id" | "name" | "city">, item: MenuItem, next: boolean) {
    const previous = availability[item.id]?.[outlet.id] ?? false;
    setAvailability((current) => ({
      ...current,
      [item.id]: { ...current[item.id], [outlet.id]: next },
    }));
    try {
      await api(`/admin/outlets/${outlet.id}/items/${item.id}/availability`, {
        method: "PATCH",
        body: jsonBody({ available: next }),
      });
      toast(`${item.name} ${next ? "available" : "paused"} at ${outlet.name}.`, "success");
    } catch (error) {
      setAvailability((current) => ({
        ...current,
        [item.id]: { ...current[item.id], [outlet.id]: previous },
      }));
      toast(describeApiError(error, "Availability could not be updated."), "error");
    }
  }

  async function deactivate() {
    if (!deleteItem) return;
    setSaving(true);
    try {
      await api(`/admin/items/${deleteItem.id}`, {
        method: "PATCH",
        body: jsonBody({ active: false }),
      });
      setItems((current) =>
        current.map((entry) => entry.id === deleteItem.id ? { ...entry, active: false } : entry),
      );
      toast(`${deleteItem.name} deactivated. You can reactivate it at any time.`, "success");
      setDeleteItem(null);
    } catch (error) {
      toast(describeApiError(error, "Could not deactivate this item."), "error");
    } finally {
      setSaving(false);
    }
  }

  const categoryName = (id: string) => categories.find((category) => category.id === id)?.name || "Uncategorised";

  async function openAvailability(item: MenuItem) {
    setSelectedItem(item);
    setAvailabilityLoading(true);
    setAvailabilityError("");
    try {
      const entries = await api<OutletAvailability[]>(`/admin/items/${item.id}/availability`);
      setAvailability((current) => ({
        ...current,
        [item.id]: Object.fromEntries(entries.map((entry) => [entry.id, entry.available])),
      }));
      setOutlets(entries.map(({ id, name, city }) => ({ id, name, city })));
    } catch (error) {
      setAvailabilityError(describeApiError(error, "Could not load outlet availability."));
    } finally {
      setAvailabilityLoading(false);
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Admin / Menu</p>
          <h1>Menu</h1>
          <p className="page-subtitle">A single menu, ready for every outlet.</p>
        </div>
        <div className="heading-actions">
          <Button onClick={() => setCategoryDialog(true)}>Manage categories</Button>
          <Link className="button button-primary" href="/admin/menu/new">New item <span aria-hidden="true">+</span></Link>
        </div>
      </div>

      <section className="menu-toolbar" aria-label="Menu filters">
        <label className="search-field">
          <span aria-hidden="true" className="search-icon">⌕</span>
          <span className="sr-only">Search menu by name</span>
          <Input
            type="search"
            placeholder="Search menu items"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label className="filter-field">
          <span className="sr-only">Filter by category</span>
          <Select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
            <option value="all">All categories</option>
            {categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}
          </Select>
        </label>
        <label className="filter-field filter-food">
          <span className="sr-only">Filter vegetarian or non-vegetarian</span>
          <Select value={foodFilter} onChange={(event) => setFoodFilter(event.target.value)}>
            <option value="all">All dishes</option>
            <option value="veg">Vegetarian</option>
            <option value="nonveg">Non-vegetarian</option>
          </Select>
        </label>
        <span className="result-count">{filteredItems.length} {filteredItems.length === 1 ? "item" : "items"}</span>
      </section>

      {loading ? (
        <div className="loading-list" role="status" aria-label="Loading menu">
          {Array.from({ length: 5 }, (_, index) => <Skeleton className="menu-skeleton" key={index} />)}
        </div>
      ) : loadError ? (
        <div className="error-panel" role="alert">
          <div><h2>Menu couldn’t load</h2><p>{loadError}</p></div>
          <Button onClick={() => { setLoading(true); void load(); }}>Try again</Button>
        </div>
      ) : filteredItems.length === 0 ? (
        <EmptyState
          title={items.length ? "No matching dishes" : "Your menu is empty"}
          description={items.length ? "Try another name or clear the filters." : "Add your first dish to start building the menu."}
          action={!items.length ? <Link className="button button-primary" href="/admin/menu/new">Create a menu item</Link> : undefined}
        />
      ) : (
        <div className="menu-results">
          <div className="menu-table-wrap">
            <table className="menu-table">
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col">Food</th>
                  <th scope="col">Category</th>
                  <th scope="col">Price</th>
                  <th scope="col">Spice</th>
                  <th scope="col">Active</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div className="item-cell">
                        <Image className="item-thumb" src={item.photo_url} alt="" width={104} height={96} unoptimized />
                        <div><strong>{item.name}</strong><span>{item.description}</span></div>
                      </div>
                    </td>
                    <td><VegMark isVeg={item.is_veg} /></td>
                    <td>{categoryName(item.category_id)}</td>
                    <td><Price amount={item.base_price_inr} /></td>
                    <td><span className="spice-value" aria-label={`Spice level ${item.spice_level} of 3`}>{item.spice_level ? "●".repeat(item.spice_level) : "Mild"}</span></td>
                    <td><Switch checked={item.active} onCheckedChange={(next) => void toggleActive(item, next)} label={`${item.active ? "Deactivate" : "Activate"} ${item.name}`} /></td>
                    <td><div className="row-actions">
                      <Button size="small" onClick={() => void openAvailability(item)}>Availability</Button>
                      <Link className="button button-quiet button-small" href={`/admin/menu/${item.id}`}>Edit</Link>
                      <Button size="small" variant="quiet" className="delete-link" onClick={() => setDeleteItem(item)}>Delete</Button>
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="menu-mobile-list">
            {filteredItems.map((item) => (
              <article className="menu-mobile-card" key={item.id}>
                <div className="mobile-item-top">
                  <Image className="item-thumb" src={item.photo_url} alt="" width={104} height={96} unoptimized />
                  <div className="mobile-item-name"><h2>{item.name}</h2><span>{categoryName(item.category_id)}</span></div>
                  <VegMark isVeg={item.is_veg} />
                </div>
                <p className="mobile-description">{item.description}</p>
                <div className="mobile-item-meta">
                  <Price amount={item.base_price_inr} />
                  <span>Spice: {item.spice_level ? "●".repeat(item.spice_level) : "Mild"}</span>
                </div>
                <div className="mobile-item-actions">
                  <span className="switch-label">Active <Switch checked={item.active} onCheckedChange={(next) => void toggleActive(item, next)} label={`${item.active ? "Deactivate" : "Activate"} ${item.name}`} /></span>
                  <Button size="small" onClick={() => void openAvailability(item)}>Availability</Button>
                  <Link className="button button-quiet button-small" href={`/admin/menu/${item.id}`}>Edit</Link>
                </div>
                <Button size="small" variant="quiet" className="delete-link mobile-delete" onClick={() => setDeleteItem(item)}>Delete</Button>
              </article>
            ))}
          </div>
        </div>
      )}

      <Dialog
        open={Boolean(selectedItem)}
        onOpenChange={(open) => { if (!open) setSelectedItem(null); }}
        title="Outlet availability"
        description={selectedItem ? `Choose where ${selectedItem.name} can be ordered.` : undefined}
      >
        {selectedItem && (
          <div className="availability-list">
            {availabilityLoading ? (
              <div className="availability-loading"><Skeleton /><Skeleton /><Skeleton /></div>
            ) : availabilityError ? (
              <div className="availability-error" role="alert">
                <p>{availabilityError}</p>
                <Button size="small" onClick={() => void openAvailability(selectedItem)}>Try again</Button>
              </div>
            ) : outlets.map((outlet) => (
              <div className="availability-row" key={outlet.id}>
                <div><strong>{outlet.name}</strong><span>{outlet.city}</span></div>
                <span className={`availability-state ${(availability[selectedItem.id]?.[outlet.id] ?? false) ? "is-available" : ""}`}>
                  {(availability[selectedItem.id]?.[outlet.id] ?? false) ? "Available" : "Paused"}
                </span>
                <Switch
                  checked={availability[selectedItem.id]?.[outlet.id] ?? false}
                  onCheckedChange={(next) => void toggleAvailability(outlet, selectedItem, next)}
                  label={`${(availability[selectedItem.id]?.[outlet.id] ?? false) ? "Pause" : "Make available"} ${selectedItem.name} at ${outlet.name}`}
                />
              </div>
            ))}
            {!availabilityLoading && !availabilityError && outlets.length === 0 && <p className="muted-copy">No outlets are configured.</p>}
          </div>
        )}
      </Dialog>

      <Dialog
        open={Boolean(deleteItem)}
        onOpenChange={(open) => { if (!open && !saving) setDeleteItem(null); }}
        title="Deactivate this item?"
        description="This item will no longer appear on customer menus. You can reactivate it later."
      >
        <div className="dialog-actions">
          <Button disabled={saving} onClick={() => setDeleteItem(null)}>Cancel</Button>
          <Button variant="danger" disabled={saving} onClick={() => void deactivate()}>
            {saving ? "Deactivating…" : "Deactivate item"}
          </Button>
        </div>
      </Dialog>

      {categoryDialog && (
        <CategoryManager
          open={categoryDialog}
          onOpenChange={setCategoryDialog}
          categories={categories}
          onChanged={load}
        />
      )}
    </>
  );
}
