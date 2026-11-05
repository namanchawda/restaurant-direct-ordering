"use client";

import { FormEvent, useState } from "react";
import { api, Category, jsonBody } from "@/lib/api";
import { Button, Dialog, Input, useToast } from "@/components/ui";

type CategoryDraft = {
  name: string;
  available_from: string;
  available_to: string;
};

const blankDraft: CategoryDraft = { name: "", available_from: "", available_to: "" };

function windowLabel(from: string | null, to: string | null) {
  if (!from && !to) return "All day";
  if (!from || !to) return "Incomplete time window";
  return `Served ${from.slice(0, 5)} to ${to.slice(0, 5)}`;
}

export function CategoryManager({
  open,
  onOpenChange,
  categories,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: Category[];
  onChanged: () => Promise<void>;
}) {
  const toast = useToast();
  const [drafts, setDrafts] = useState<Record<string, CategoryDraft>>(() =>
    Object.fromEntries(
      categories.map((category) => [
        category.id,
        {
          name: category.name,
          available_from: category.available_from?.slice(0, 5) || "",
          available_to: category.available_to?.slice(0, 5) || "",
        },
      ]),
    ),
  );
  const [newCategory, setNewCategory] = useState<CategoryDraft>(blankDraft);
  const [saving, setSaving] = useState(false);

  async function saveCategory(id: string) {
    const draft = drafts[id];
    if (!draft?.name.trim()) {
      toast("Add a category name before saving.", "error");
      return;
    }
    if (Boolean(draft.available_from) !== Boolean(draft.available_to)) {
      toast("Add both start and end times, or leave both blank.", "error");
      return;
    }
    setSaving(true);
    try {
      await api(`/admin/categories/${id}`, {
        method: "PATCH",
        body: jsonBody({
          name: draft.name.trim(),
          available_from: draft.available_from || null,
          available_to: draft.available_to || null,
        }),
      });
      await onChanged();
      toast("Category saved.", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not save this category.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function addCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (Boolean(newCategory.available_from) !== Boolean(newCategory.available_to)) {
      toast("Add both start and end times, or leave both blank.", "error");
      return;
    }
    setSaving(true);
    try {
      const category = await api<Category>("/admin/categories", {
        method: "POST",
        body: jsonBody({
          name: newCategory.name.trim(),
          sort_order: Math.max(0, ...categories.map((category) => category.sort_order)) + 1,
          available_from: newCategory.available_from || null,
          available_to: newCategory.available_to || null,
        }),
      });
      setDrafts((current) => ({
        ...current,
        [category.id]: {
          name: category.name,
          available_from: category.available_from?.slice(0, 5) || "",
          available_to: category.available_to?.slice(0, 5) || "",
        },
      }));
      setNewCategory(blankDraft);
      await onChanged();
      toast("Category added.", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not add this category.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function moveCategory(category: Category, direction: -1 | 1) {
    const ordered = [...categories].sort((a, b) => a.sort_order - b.sort_order);
    const index = ordered.findIndex((entry) => entry.id === category.id);
    const swap = ordered[index + direction];
    if (!swap) return;
    const reordered = [...ordered];
    [reordered[index], reordered[index + direction]] = [reordered[index + direction], reordered[index]];
    setSaving(true);
    try {
      await Promise.all(
        reordered.map((entry, order) =>
          api(`/admin/categories/${entry.id}`, {
            method: "PATCH",
            body: jsonBody({ sort_order: order }),
          }),
        ),
      );
      await onChanged();
      toast("Category order updated.", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not reorder categories.", "error");
      await onChanged();
    } finally {
      setSaving(false);
    }
  }

  function updateDraft(id: string, key: keyof CategoryDraft, value: string) {
    setDrafts((current) => ({ ...current, [id]: { ...current[id], [key]: value } }));
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Manage categories"
      description="Set the display order and optional service hours."
      className="dialog-wide"
    >
      <div className="category-list">
        {categories.length === 0 && <p className="muted-copy">No categories yet. Add the first one below.</p>}
        {[...categories].sort((a, b) => a.sort_order - b.sort_order).map((category, index) => {
          const draft = drafts[category.id] || blankDraft;
          return (
            <section className="category-row" key={category.id}>
              <div className="category-order" aria-label={`Category position ${index + 1}`}>
                <Button
                  size="small"
                  variant="quiet"
                  aria-label={`Move ${category.name} up`}
                  disabled={saving || index === 0}
                  onClick={() => moveCategory(category, -1)}
                >↑</Button>
                <Button
                  size="small"
                  variant="quiet"
                  aria-label={`Move ${category.name} down`}
                  disabled={saving || index === categories.length - 1}
                  onClick={() => moveCategory(category, 1)}
                >↓</Button>
              </div>
              <div className="category-fields">
                <label className="field">
                  <span>Category name</span>
                  <Input
                    value={draft.name}
                    maxLength={120}
                    onChange={(event) => updateDraft(category.id, "name", event.target.value)}
                  />
                </label>
                <div className="time-window">
                  <label className="field">
                    <span>Available from</span>
                    <Input
                      type="time"
                      value={draft.available_from}
                      onChange={(event) => updateDraft(category.id, "available_from", event.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>Available to</span>
                    <Input
                      type="time"
                      value={draft.available_to}
                      onChange={(event) => updateDraft(category.id, "available_to", event.target.value)}
                    />
                  </label>
                </div>
                <p className="service-window">{windowLabel(draft.available_from || null, draft.available_to || null)}</p>
              </div>
              <Button size="small" disabled={saving} onClick={() => saveCategory(category.id)}>Save</Button>
            </section>
          );
        })}
      </div>
      <form className="add-category-form" onSubmit={addCategory}>
        <h3>Add a category</h3>
        <label className="field">
          <span>Category name</span>
          <Input
            required
            maxLength={120}
            value={newCategory.name}
            onChange={(event) => setNewCategory((current) => ({ ...current, name: event.target.value }))}
          />
        </label>
        <div className="time-window">
          <label className="field">
            <span>Available from</span>
            <Input
              type="time"
              value={newCategory.available_from}
              onChange={(event) => setNewCategory((current) => ({ ...current, available_from: event.target.value }))}
            />
          </label>
          <label className="field">
            <span>Available to</span>
            <Input
              type="time"
              value={newCategory.available_to}
              onChange={(event) => setNewCategory((current) => ({ ...current, available_to: event.target.value }))}
            />
          </label>
        </div>
        <p className="service-window">{windowLabel(newCategory.available_from || null, newCategory.available_to || null)}</p>
        <Button type="submit" variant="primary" disabled={saving || !newCategory.name.trim()}>Add category</Button>
      </form>
    </Dialog>
  );
}
