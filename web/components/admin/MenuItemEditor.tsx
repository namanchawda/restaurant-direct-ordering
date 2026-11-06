"use client";

import Link from "next/link";
import Image from "next/image";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Addon,
  ApiError,
  Category,
  CityPrice,
  MenuItem,
  Variant,
  api,
  describeApiError,
  jsonBody,
} from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Price,
  Select,
  Skeleton,
  Switch,
  Textarea,
  useToast,
  VegMark,
  preGst,
} from "@/components/ui";

const ALLERGENS = ["milk", "gluten", "nuts", "egg", "fish", "shellfish", "soy", "sesame"];

type PriceOverride = { id?: string; city: string; price_inr: string };
type FormValues = {
  name: string;
  description: string;
  category_id: string;
  photo_url: string;
  is_veg: boolean;
  spice_level: number;
  allergens: string[];
  base_price_inr: string;
  active: boolean;
  variants: Variant[];
  addon_ids: string[];
  city_prices: PriceOverride[];
};

const emptyForm: FormValues = {
  name: "",
  description: "",
  category_id: "",
  photo_url: "",
  is_veg: true,
  spice_level: 0,
  allergens: [],
  base_price_inr: "",
  active: true,
  variants: [],
  addon_ids: [],
  city_prices: [],
};

function imageUrlIsValid(value: string) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function MenuItemEditor({ itemId }: { itemId?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [values, setValues] = useState<FormValues>(emptyForm);
  const [initialValues, setInitialValues] = useState<FormValues>(emptyForm);
  const [categories, setCategories] = useState<Category[]>([]);
  const [addons, setAddons] = useState<Addon[]>([]);
  const [loading, setLoading] = useState(Boolean(itemId));
  const [loadError, setLoadError] = useState("");
  const [imageFailed, setImageFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [newAddonName, setNewAddonName] = useState("");
  const [newAddonPrice, setNewAddonPrice] = useState("");
  const [addingAddon, setAddingAddon] = useState(false);
  const loaded = useRef(false);

  const isDirty = useMemo(
    () => JSON.stringify(values) !== JSON.stringify(initialValues),
    [values, initialValues],
  );

  const load = useCallback(async () => {
    try {
      const [nextCategories, nextAddons, itemList, cityPriceList] = await Promise.all([
        api<Category[]>("/admin/categories"),
        api<Addon[]>("/admin/addons"),
        itemId ? api<MenuItem[]>("/admin/items") : Promise.resolve([] as MenuItem[]),
        itemId ? api<CityPrice[]>("/admin/city-prices") : Promise.resolve([] as CityPrice[]),
      ]);
      setLoadError("");
      const selectedItem = itemId ? itemList.find((item) => item.id === itemId) : undefined;
      if (itemId && !selectedItem) {
        setLoadError("This menu item could not be found.");
        setCategories(nextCategories);
        setAddons(nextAddons);
        return;
      }
      const cityPrices = selectedItem
        ? cityPriceList
            .filter((entry) => entry.item_id === selectedItem.id)
            .map((entry) => ({ id: entry.id, city: entry.city, price_inr: String(entry.price_inr) }))
        : [];
      const nextValues: FormValues = selectedItem
        ? {
            name: selectedItem.name,
            description: selectedItem.description,
            category_id: selectedItem.category_id,
            photo_url: selectedItem.photo_url,
            is_veg: selectedItem.is_veg,
            spice_level: selectedItem.spice_level,
            allergens: selectedItem.allergens,
            base_price_inr: String(selectedItem.base_price_inr),
            active: selectedItem.active,
            variants: selectedItem.variants.map((variant) => ({ ...variant })),
            addon_ids: [...selectedItem.addon_ids],
            city_prices: cityPrices,
          }
        : { ...emptyForm, category_id: nextCategories[0]?.id || "" };
      setCategories(nextCategories);
      setAddons(nextAddons);
      setValues(nextValues);
      setInitialValues(nextValues);
      loaded.current = true;
    } catch (error) {
      setLoadError(describeApiError(error, "Could not load item details."));
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!loaded.current || !isDirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const guardLink = (event: globalThis.MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target || anchor.download) return;
      if (anchor.origin !== window.location.origin || anchor.href === window.location.href) return;
      if (!window.confirm("You have unsaved changes. Leave without saving?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", guardLink, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", guardLink, true);
    };
  }, [isDirty]);

  function update<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: "" }));
  }

  function validate() {
    const nextErrors: Record<string, string> = {};
    const parsedPrice = Number(values.base_price_inr);
    if (!values.name.trim()) nextErrors.name = "Enter an item name.";
    if (!values.category_id) nextErrors.category_id = "Choose a category.";
    if (!values.description.trim()) nextErrors.description = "Enter a short description.";
    if (!imageUrlIsValid(values.photo_url)) nextErrors.photo_url = "Enter a valid http or https image URL.";
    if (!Number.isInteger(parsedPrice) || parsedPrice <= 0) nextErrors.base_price_inr = "Price must be a whole number greater than ₹0.";
    if (!Number.isInteger(values.spice_level) || values.spice_level < 0 || values.spice_level > 3) {
      nextErrors.spice_level = "Choose a spice level from 0 to 3.";
    }
    values.variants.forEach((variant, index) => {
      if (!variant.name.trim()) nextErrors[`variant-${index}-name`] = "Enter a portion name.";
      if (!Number.isInteger(variant.price_inr) || variant.price_inr <= 0) {
        nextErrors[`variant-${index}-price`] = "Price must be greater than ₹0.";
      }
    });
    values.city_prices.forEach((entry, index) => {
      if (!entry.city.trim()) nextErrors[`city-${index}-city`] = "Enter a city.";
      if (!Number.isInteger(Number(entry.price_inr)) || Number(entry.price_inr) <= 0) {
        nextErrors[`city-${index}-price`] = "Price must be greater than ₹0.";
      }
    });
    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function saveCityPrices(savedItemId: string) {
    for (const entry of values.city_prices) {
      const payload = {
        item_id: savedItemId,
        city: entry.city.trim(),
        price_inr: Number(entry.price_inr),
      };
      if (entry.id) {
        await api(`/admin/city-prices/${entry.id}`, { method: "PATCH", body: jsonBody(payload) });
      } else {
        await api("/admin/city-prices", { method: "POST", body: jsonBody(payload) });
      }
    }
    const retainedIds = new Set(values.city_prices.flatMap((entry) => entry.id ? [entry.id] : []));
    const existing = itemId
      ? await api<CityPrice[]>("/admin/city-prices")
      : [];
    for (const entry of existing) {
      if (entry.item_id === savedItemId && !retainedIds.has(entry.id)) {
        await api(`/admin/city-prices/${entry.id}`, { method: "DELETE" });
      }
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    setFieldErrors({});
    if (!validate()) {
      setFormError("Fix the highlighted fields before saving.");
      return;
    }
    setSubmitting(true);
    const payload = {
      name: values.name.trim(),
      description: values.description.trim(),
      category_id: values.category_id,
      photo_url: values.photo_url.trim(),
      is_veg: values.is_veg,
      spice_level: values.spice_level,
      allergens: values.allergens,
      base_price_inr: Number(values.base_price_inr),
      active: values.active,
      variants: values.variants.map(({ id, name, price_inr }) => ({ id, name: name.trim(), price_inr })),
      addon_ids: values.addon_ids,
    };
    try {
      const saved = itemId
        ? await api<MenuItem>(`/admin/items/${itemId}`, { method: "PATCH", body: jsonBody(payload) })
        : await api<MenuItem>("/admin/items", { method: "POST", body: jsonBody({ ...payload, sort_order: 0 }) });
      await saveCityPrices(saved.id);
      setInitialValues(values);
      toast(itemId ? "Menu item updated." : "Menu item created.", "success");
      router.replace("/admin/menu");
    } catch (error) {
      if (error instanceof ApiError) {
        setFieldErrors(error.fields);
        setFormError(
          Object.keys(error.fields).length
            ? "Some fields need attention. Review the messages below."
            : describeApiError(error),
        );
      } else {
        setFormError(describeApiError(error, "Could not save this item."));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function createAddon() {
    const price = Number(newAddonPrice);
    if (!newAddonName.trim() || !Number.isInteger(price) || price <= 0) {
      toast("Enter an add-on name and a price greater than ₹0.", "error");
      return;
    }
    setAddingAddon(true);
    try {
      const addon = await api<Addon>("/admin/addons", {
        method: "POST",
        body: jsonBody({ name: newAddonName.trim(), price_inr: price }),
      });
      setAddons((current) => [...current, addon].sort((a, b) => a.name.localeCompare(b.name)));
      update("addon_ids", [...values.addon_ids, addon.id]);
      setNewAddonName("");
      setNewAddonPrice("");
      toast("Add-on created and linked.", "success");
    } catch (error) {
      toast(describeApiError(error, "Could not create this add-on."), "error");
    } finally {
      setAddingAddon(false);
    }
  }

  function navigateBack(event: React.MouseEvent<HTMLAnchorElement>) {
    if (isDirty && !window.confirm("You have unsaved changes. Leave without saving?")) {
      event.preventDefault();
    }
  }

  if (loading) {
    return <div className="editor-loading" aria-label="Loading item"><Skeleton className="editor-skeleton" /><Skeleton className="editor-skeleton" /><Skeleton className="editor-skeleton" /></div>;
  }
  if (loadError) {
    return (
      <div className="error-panel" role="alert">
        <div><h2>Item couldn’t load</h2><p>{loadError}</p></div>
        <Button onClick={() => { setLoading(true); void load(); }}>Try again</Button>
      </div>
    );
  }
  if (!categories.length) {
    return (
      <EmptyState
        title="Add a category first"
        description="Every menu item needs a category. Create one before adding a dish."
        action={<Link className="button button-primary" href="/admin/menu">Back to menu</Link>}
      />
    );
  }

  return (
    <form className="editor-form" onSubmit={submit} noValidate>
      <div className="page-heading editor-heading">
        <div>
          <Link className="back-link" href="/admin/menu" onClick={navigateBack}>← Menu</Link>
          <p className="eyebrow">{itemId ? "Menu item" : "Menu / New item"}</p>
          <h1>{itemId ? "Edit item" : "New item"}</h1>
          <p className="page-subtitle">Keep the menu accurate across every outlet.</p>
        </div>
        <div className="heading-actions editor-actions">
          <Link className="button button-secondary" href="/admin/menu" onClick={navigateBack}>Cancel</Link>
          <Button type="submit" variant="primary" disabled={submitting}>
            {submitting ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>
      {formError && <p className="form-error editor-form-error" role="alert">{formError}</p>}

      <div className="editor-grid">
        <div className="editor-main-column">
          <Card className="editor-section">
            <div className="section-heading"><div><h2>Basics</h2><p>Name, description and menu placement.</p></div></div>
            <label className="field">
              <span>Item name</span>
              <Input id="name" required maxLength={160} value={values.name} error={fieldErrors.name} onChange={(event) => update("name", event.target.value)} />
            </label>
            <label className="field">
              <span>Description</span>
              <Textarea id="description" rows={3} value={values.description} error={fieldErrors.description} onChange={(event) => update("description", event.target.value)} />
            </label>
            <div className="form-two-column">
              <label className="field">
                <span>Category</span>
                <Select id="category_id" value={values.category_id} error={fieldErrors.category_id} onChange={(event) => update("category_id", event.target.value)}>
                  <option value="">Choose category</option>
                  {categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}
                </Select>
              </label>
              <fieldset className="field choice-field">
                <legend>Food type</legend>
                <div className="choice-group">
                  <button type="button" className={`food-choice ${values.is_veg ? "is-selected" : ""}`} aria-pressed={values.is_veg} onClick={() => update("is_veg", true)}><VegMark isVeg />Vegetarian</button>
                  <button type="button" className={`food-choice ${!values.is_veg ? "is-selected" : ""}`} aria-pressed={!values.is_veg} onClick={() => update("is_veg", false)}><VegMark isVeg={false} />Non-veg</button>
                </div>
              </fieldset>
            </div>
          </Card>

          <Card className="editor-section">
            <div className="section-heading"><div><h2>Photo</h2><p>Use a direct image URL. The preview updates as you type.</p></div></div>
            <label className="field">
              <span>Photo URL</span>
              <Input
                id="photo_url"
                type="url"
                placeholder="https://example.com/dish.jpg"
                value={values.photo_url}
                error={fieldErrors.photo_url}
                onChange={(event) => { update("photo_url", event.target.value); setImageFailed(false); }}
              />
            </label>
            {values.photo_url && imageUrlIsValid(values.photo_url) && (
              <div className={`photo-preview ${imageFailed ? "photo-preview-failed" : ""}`}>
                {imageFailed ? (
                  <p role="alert">This image could not be loaded. Check the URL and try again.</p>
                ) : (
                  <Image src={values.photo_url} alt={`Preview of ${values.name || "menu item"}`} width={800} height={500} unoptimized onError={() => setImageFailed(true)} />
                )}
              </div>
            )}
          </Card>

          <Card className="editor-section">
            <div className="section-heading"><div><h2>Details</h2><p>Give guests clear food and spice information.</p></div></div>
            <fieldset className="field">
              <legend>Spice level</legend>
              <div className="segmented" role="group" aria-label="Spice level from 0 to 3">
                {[0, 1, 2, 3].map((level) => <button type="button" key={level} aria-pressed={values.spice_level === level} className={values.spice_level === level ? "selected" : ""} onClick={() => update("spice_level", level)}>{level === 0 ? "Mild" : `${level}`}</button>)}
              </div>
              {fieldErrors.spice_level && <span className="field-error" role="alert">{fieldErrors.spice_level}</span>}
            </fieldset>
            <fieldset className="field allergen-field">
              <legend>Allergens</legend>
              <p className="field-hint">Select all ingredients that apply.</p>
              <div className="chip-list">
                {ALLERGENS.map((allergen) => {
                  const checked = values.allergens.includes(allergen);
                  return (
                    <button
                      type="button"
                      key={allergen}
                      className={`toggle-chip ${checked ? "is-selected" : ""}`}
                      aria-pressed={checked}
                      onClick={() => update("allergens", checked ? values.allergens.filter((value) => value !== allergen) : [...values.allergens, allergen])}
                    >{allergen}</button>
                  );
                })}
              </div>
            </fieldset>
          </Card>

          <Card className="editor-section">
            <div className="section-heading"><div><h2>Pricing</h2><p>Set the base price, portions and city-specific prices.</p></div></div>
            <div className="price-input-wrap">
              <label className="field">
                <span>Base price (₹)</span>
                <Input
                  id="base_price_inr"
                  type="number"
                  inputMode="numeric"
                  min="1"
                  step="1"
                  required
                  value={values.base_price_inr}
                  error={fieldErrors.base_price_inr}
                  onChange={(event) => update("base_price_inr", event.target.value)}
                />
              </label>
              <p className="pricing-help">Prices include 5% GST</p>
              {Number(values.base_price_inr) > 0 && <p className="pre-gst">Before GST: {preGst(Number(values.base_price_inr))}</p>}
            </div>
            <div className="subsection-heading"><h3>Portion variants</h3><Button size="small" onClick={() => update("variants", [...values.variants, { name: "", price_inr: Number(values.base_price_inr) || 1 }])}>Add portion</Button></div>
            {values.variants.length === 0 ? <p className="muted-copy">No portions. The base price will be used.</p> : values.variants.map((variant, index) => (
              <div className="repeat-row" key={variant.id || `variant-${index}`}>
                <label className="field"><span>Portion name</span><Input value={variant.name} maxLength={100} error={fieldErrors[`variant-${index}-name`]} onChange={(event) => update("variants", values.variants.map((entry, row) => row === index ? { ...entry, name: event.target.value } : entry))} /></label>
                <label className="field"><span>Price (₹)</span><Input type="number" min="1" step="1" value={variant.price_inr} error={fieldErrors[`variant-${index}-price`]} onChange={(event) => update("variants", values.variants.map((entry, row) => row === index ? { ...entry, price_inr: Number(event.target.value) } : entry))} />{variant.price_inr > 0 && <small className="pre-gst">Before GST: {preGst(variant.price_inr)}</small>}</label>
                <Button size="small" variant="quiet" className="delete-link" aria-label={`Remove ${variant.name || "portion"}`} onClick={() => update("variants", values.variants.filter((_, row) => row !== index))}>Remove</Button>
              </div>
            ))}
            <div className="subsection-heading city-heading"><div><h3>City price overrides</h3><p>Optional prices that replace the base price in selected cities.</p></div><Button size="small" onClick={() => update("city_prices", [...values.city_prices, { city: "", price_inr: values.base_price_inr || "" }])}>Add city</Button></div>
            {values.city_prices.map((entry, index) => (
              <div className="repeat-row city-price-row" key={entry.id || `city-${index}`}>
                <label className="field"><span>City</span><Input value={entry.city} maxLength={100} error={fieldErrors[`city-${index}-city`]} onChange={(event) => update("city_prices", values.city_prices.map((row, position) => position === index ? { ...row, city: event.target.value } : row))} /></label>
                <label className="field"><span>Price (₹)</span><Input type="number" min="1" step="1" value={entry.price_inr} error={fieldErrors[`city-${index}-price`]} onChange={(event) => update("city_prices", values.city_prices.map((row, position) => position === index ? { ...row, price_inr: event.target.value } : row))} />{Number(entry.price_inr) > 0 && <small className="pre-gst">Before GST: {preGst(Number(entry.price_inr))}</small>}</label>
                <Button size="small" variant="quiet" className="delete-link" aria-label={`Remove ${entry.city || "city"} price`} onClick={() => update("city_prices", values.city_prices.filter((_, position) => position !== index))}>Remove</Button>
              </div>
            ))}
          </Card>

          <Card className="editor-section">
            <div className="section-heading"><div><h2>Add-ons</h2><p>Link extras already available in the menu.</p></div></div>
            {addons.length === 0 ? <p className="muted-copy">No add-ons yet. Create one below.</p> : (
              <div className="addon-list">
                {addons.map((addon) => {
                  const checked = values.addon_ids.includes(addon.id);
                  return (
                    <button
                      className={`addon-choice ${checked ? "is-selected" : ""}`}
                      type="button"
                      aria-pressed={checked}
                      key={addon.id}
                      onClick={() => update("addon_ids", checked ? values.addon_ids.filter((id) => id !== addon.id) : [...values.addon_ids, addon.id])}
                    >
                      <span className={`check-mark ${checked ? "checked" : ""}`} aria-hidden="true">{checked ? "✓" : ""}</span>
                      <span>{addon.name}</span>
                      <Price amount={addon.price_inr} />
                    </button>
                  );
                })}
              </div>
            )}
            <div className="inline-addon">
              <h3>Create an add-on</h3>
              <div className="inline-addon-fields">
                <label className="field"><span>Name</span><Input value={newAddonName} maxLength={120} onChange={(event) => setNewAddonName(event.target.value)} /></label>
                <label className="field"><span>Price (₹)</span><Input type="number" min="1" step="1" value={newAddonPrice} onChange={(event) => setNewAddonPrice(event.target.value)} />{Number(newAddonPrice) > 0 && <small className="pre-gst">Before GST: {preGst(Number(newAddonPrice))}</small>}</label>
                <Button disabled={addingAddon} onClick={() => void createAddon()}>{addingAddon ? "Adding…" : "Create add-on"}</Button>
              </div>
            </div>
          </Card>
        </div>

        <aside className="editor-aside">
          <Card className="status-card">
            <div className="aside-heading"><h2>Menu status</h2><Badge tone={values.active ? "success" : "neutral"}>{values.active ? "Active" : "Inactive"}</Badge></div>
            <p>{values.active ? "Guests can order this dish where it is available." : "This dish is hidden from customer menus."}</p>
            <div className="status-switch"><span>Active</span><Switch checked={values.active} onCheckedChange={(active) => update("active", active)} label="Set item active" /></div>
          </Card>
          <Card className="preview-card">
            <p className="eyebrow">Menu preview</p>
            <div className="preview-food">
              {imageUrlIsValid(values.photo_url) && !imageFailed ? <Image src={values.photo_url} alt="" width={600} height={400} unoptimized onError={() => setImageFailed(true)} /> : <div className="preview-placeholder">Photo preview</div>}
            </div>
            <div className="preview-name"><h2>{values.name || "Your dish name"}</h2><VegMark isVeg={values.is_veg} /></div>
            <p className="preview-description">{values.description || "A short, appetising description appears here."}</p>
            {Number(values.base_price_inr) > 0 && <Price amount={Number(values.base_price_inr)} />}
          </Card>
          <p className="aside-note">Food marks and allergen details help guests choose with confidence.</p>
        </aside>
      </div>
      <div className="editor-mobile-footer">
        <Button type="submit" variant="primary" disabled={submitting}>{submitting ? "Saving…" : "Save changes"}</Button>
      </div>
    </form>
  );
}

export function MenuItemRoute() {
  const params = useParams<{ id: string }>();
  return <MenuItemEditor itemId={params.id} />;
}
