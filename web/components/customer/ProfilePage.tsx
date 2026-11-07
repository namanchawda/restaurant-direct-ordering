"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Input,
  Select,
  Skeleton,
  Switch,
  Textarea,
  useToast,
} from "@/components/ui";
import { FavouriteCard } from "@/components/customer/FavouriteCard";
import { MAX_ADDRESSES, promoteAfterDelete, switchDefault } from "@/lib/customer-address";
import {
  api,
  ApiError,
  describeApiError,
  CustomerAddress,
  CustomerFavorite,
  CustomerProfile,
  createAddress,
  deleteAddress,
  deleteMyAccount,
  listFavourites,
  patchAddress,
  patchProfile,
  removeFavourite,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";

type AddressForm = {
  label: CustomerAddress["label"];
  address: string;
  lat: string;
  lng: string;
  is_default: boolean;
};

function emptyForm(): AddressForm {
  return { label: "home", address: "", lat: "", lng: "", is_default: false };
}

export function ProfilePage() {
  const { user } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [favourites, setFavourites] = useState<CustomerFavorite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [form, setForm] = useState<AddressForm>(emptyForm());
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const active = useRef(true);

  async function load() {
    try {
      setError(null);
      const [profileResult, addressResult, favouriteResult] = await Promise.all([
        api<CustomerProfile>("/me/profile"),
        api<CustomerAddress[]>("/me/addresses"),
        api<CustomerFavorite[]>("/me/favourites"),
      ]);
      if (!active.current) return;
      setProfile(profileResult);
      setAddresses(addressResult);
      setFavourites(favouriteResult);
    } catch (requestError) {
      if (!active.current) return;
      setError(describeApiError(requestError, "We couldn't load your profile. Please try again."));
    } finally {
      if (active.current) setLoading(false);
    }
  }

  useEffect(() => {
    active.current = true;
    if (!user || user.role !== "customer") {
      router.replace(`/login?next=${encodeURIComponent("/profile")}`);
      return;
    }
    const timer = window.setTimeout(() => {
      if (!active.current) return;
      void load();
    }, 0);
    return () => {
      active.current = false;
      window.clearTimeout(timer);
    };
  }, [user, router]);

  if (loading) {
    return (
      <main className="customer-page profile-page">
        <header className="simple-page-header">
          <Link href="/" className="back-link"><span aria-hidden="true">←</span> Home</Link>
          <div className="header-end" />
        </header>
        <h2 className="profile-heading">Your profile</h2>
        <div className="profile-skeleton"><Skeleton className="profile-skeleton-line" /><Skeleton className="profile-skeleton-line short" /><Skeleton className="profile-skeleton-line short" /></div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="customer-page profile-page">
        <header className="simple-page-header">
          <Link href="/" className="back-link"><span aria-hidden="true">←</span> Home</Link>
          <div className="header-end" />
        </header>
        <h2 className="profile-heading">Your profile</h2>
        <div className="profile-error" role="alert">
          <p>{error}</p>
          <Button variant="secondary" onClick={() => void load()}>Try again</Button>
        </div>
      </main>
    );
  }

  return (
    <main className="customer-page profile-page">
        <header className="simple-page-header">
          <Link href="/" className="back-link"><span aria-hidden="true">←</span> Home</Link>
          <div className="header-end" />
        </header>

        <h2 className="profile-heading">Your profile</h2>
        {error && <div className="profile-error" role="alert">{error}</div>}

        <section className="profile-section" aria-labelledby="profile-details-heading">
          <div className="profile-section-head" id="profile-details-heading">
            <p className="customer-eyebrow">Details</p>
            <h2>Your details</h2>
          </div>
          <Card className="profile-card">
            <form className="profile-form" onSubmit={(event) => { event.preventDefault(); void saveProfile(); }}>
              <label className="field">
                <span>Name</span>
                <Input
                  autoComplete="name"
                  id="profile-name"
                  maxLength={160}
                  name="name"
                  placeholder="Your name"
                  value={profile?.name ?? ""}
                  onChange={(event) => setProfile((current) => current ? { ...current, name: event.target.value } : current)}
                />
              </label>
              <label className="field">
                <span>Mobile number</span>
                <Input
                  autoComplete="tel"
                  id="profile-phone"
                  disabled
                  value={profile?.phone ?? ""}
                />
                <p className="profile-field-note">Your number is read-only. Sign in with a different number to change it.</p>
              </label>
              <label className="consent-row">
                <Switch
                  checked={Boolean(profile?.marketing_opt_in)}
                  id="profile-marketing"
                  label="Send me offers by WhatsApp or SMS"
                  onCheckedChange={(checked) => setProfile((current) => current ? { ...current, marketing_opt_in: checked } : current)}
                />
              </label>
              <p className="profile-field-note">Optional. You can opt out any time in Settings or by replying STOP.</p>
              {busy && <p className="profile-field-note" role="status">Saving…</p>}
              <Button type="submit" variant="primary" disabled={busy}>Save details</Button>
            </form>
          </Card>
        </section>

        <section className="profile-section" aria-labelledby="profile-addresses-heading">
          <div className="profile-section-head" id="profile-addresses-heading">
            <p className="customer-eyebrow">Saved addresses</p>
            <h2>Delivery addresses</h2>
          </div>
          <div className="profile-address-toolbar">
            <Button variant="secondary" onClick={() => { setForm(emptyForm()); setFormErrors({}); setEditId(null); setAddOpen(true); }}>
              {addresses.length >= MAX_ADDRESSES ? "Address limit reached" : "Add address"}
            </Button>
            {addresses.length >= MAX_ADDRESSES && <span className="profile-capacity">{addresses.length} of {MAX_ADDRESSES} saved addresses</span>}
          </div>
          {addresses.length === 0 && (
            <EmptyState title="No saved addresses" description="Add a delivery address to speed up checkout." action={<Button variant="primary" onClick={() => { setForm(emptyForm()); setFormErrors({}); setEditId(null); setAddOpen(true); }}>Add address</Button>} />
          )}
          {addresses.length > 0 && (
            <ul className="profile-address-list" role="list" aria-label="Your saved addresses">
              {addresses.map((address) => (
                <li key={address.id} className={`profile-address-card${address.is_default ? " profile-address-default" : ""}`}>
                  <div className="profile-address-main">
                    <div className="profile-address-label-row">
                      <Badge tone={address.label === "home" ? "neutral" : "neutral"}>{address.label[0].toUpperCase() + address.label.slice(1)}</Badge>
                      {address.is_default && <Badge tone="success">Default</Badge>}
                    </div>
                    <p className="profile-address-text">{address.address}</p>
                    <p className="profile-address-coords">{address.lat.toFixed(4)}, {address.lng.toFixed(4)}</p>
                  </div>
                  <div className="profile-address-actions">
                    {!address.is_default && (
                      <Button type="button" variant="secondary" size="small" onClick={() => void setDefault(address.id)}>
                        Set default
                      </Button>
                    )}
                    <Button type="button" variant="secondary" size="small" onClick={() => openEdit(address)}>
                      Edit
                    </Button>
                    <Button type="button" variant="danger" size="small" onClick={() => setDeleteId(address.id)}>
                      Delete
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="profile-section" aria-labelledby="profile-favourites-heading">
          <div className="profile-section-head" id="profile-favourites-heading">
            <p className="customer-eyebrow">Favourites</p>
            <h2>Your favourites</h2>
          </div>
          {favourites.length === 0 && (
            <EmptyState title="No favourites yet" description="Tap the heart on a dish to save it here. Favourites are never added to your cart by themselves." action={<Link className="button button-primary" href="/">Browse the menu</Link>} />
          )}
          {favourites.length > 0 && (
            <div className="profile-favourite-grid" role="list" aria-label="Your favourite dishes">
              {favourites.map((favourite) => (
                <FavouriteCard key={favourite.item_id} favourite={favourite} onRemove={(itemId) => void removeFavouriteItem(itemId)} />
              ))}
            </div>
          )}
        </section>

        <section className="profile-section" aria-labelledby="profile-privacy-heading">
          <div className="profile-section-head" id="profile-privacy-heading">
            <p className="customer-eyebrow">Privacy</p>
            <h2>Your data</h2>
          </div>
          <Card className="profile-card">
            <p className="profile-privacy-copy">
              Your name, mobile number, saved addresses, favourites and order history are kept so you can
              reorder and track deliveries. Read our{" "}
              <a className="profile-privacy-link" href="/privacy">privacy notice</a>.
            </p>
            <Button
              type="button"
              variant="danger"
              className="profile-delete-button"
              onClick={() => setDeleteAccountOpen(true)}
            >
              Delete my account
            </Button>
          </Card>
        </section>

        {/* Add / edit address dialog */}
        <Dialog open={addOpen || editId !== null} onOpenChange={(open) => { if (!open) { setAddOpen(false); setEditId(null); setFormErrors({}); } }} title={editId ? "Edit address" : "Add address"} description={`Maximum ${MAX_ADDRESSES} saved addresses. One can be your default.`}>
          <div className="dialog-content">
            <form className="profile-address-form" onSubmit={(event) => { event.preventDefault(); void saveAddress(); }}>
              <label className="field">
                <span>Label</span>
                <Select id="profile-address-label" value={form.label} onChange={(event) => setForm((current) => ({ ...current, label: event.target.value as CustomerAddress["label"] }))}>
                  <option value="home">Home</option>
                  <option value="work">Work</option>
                  <option value="other">Other</option>
                </Select>
              </label>
              <label className="field">
                <span>Address</span>
                <Textarea
                  error={formErrors.address}
                  id="profile-address"
                  maxLength={500}
                  name="address"
                  placeholder="Flat, building, street, area"
                  rows={3}
                  value={form.address}
                  onChange={(event) => {
                    setForm((current) => ({ ...current, address: event.target.value }));
                    if (formErrors.address) setFormErrors((current) => { const next = { ...current }; delete next.address; return next; });
                  }}
                />
              </label>
              <label className="field">
                <span>Latitude</span>
                <Input error={formErrors.lat} id="profile-address-lat" inputMode="numeric" maxLength={12} name="lat" placeholder="e.g. 17.4401" value={form.lat} onChange={(event) => setForm((current) => ({ ...current, lat: event.target.value }))} />
              </label>
              <label className="field">
                <span>Longitude</span>
                <Input error={formErrors.lng} id="profile-address-lng" inputMode="numeric" maxLength={12} name="lng" placeholder="e.g. 78.3489" value={form.lng} onChange={(event) => setForm((current) => ({ ...current, lng: event.target.value }))} />
              </label>
              <label className="consent-row">
                <Switch
                  checked={form.is_default}
                  id="profile-address-default"
                  label="Make this my default address"
                  onCheckedChange={(checked) => setForm((current) => ({ ...current, is_default: checked }))}
                />
              </label>
              {Object.values(formErrors).length > 0 && <p className="form-error" role="alert">Please fix the fields marked above.</p>}
              <div className="dialog-actions">
                <Button type="button" variant="secondary" onClick={() => { setAddOpen(false); setEditId(null); setFormErrors({}); }}>Cancel</Button>
                <Button type="submit" variant="primary" disabled={busy}>{busy ? "Saving…" : editId ? "Save changes" : "Add address"}</Button>
              </div>
            </form>
          </div>
        </Dialog>

        {/* Delete address confirm */}
        <Dialog open={deleteId !== null} onOpenChange={(open) => { if (!open) setDeleteId(null); }} title="Delete this address?" description="This can’t be undone. If it was your default, your most recent saved address becomes the default.">
          <div className="dialog-content">
            <div className="dialog-actions">
              <Button type="button" variant="secondary" onClick={() => setDeleteId(null)}>Cancel</Button>
              <Button type="button" variant="danger" onClick={() => void confirmDeleteAddress()} disabled={busy}>{busy ? "Deleting…" : "Delete address"}</Button>
            </div>
          </div>
        </Dialog>

        {/* Delete account confirm */}
        <Dialog open={deleteAccountOpen} onOpenChange={setDeleteAccountOpen} className="profile-delete-dialog" title="Delete my account" description="This erases your personal data. This can’t be undone.">
          <div className="dialog-content">
            <ul className="profile-delete-what">
              <li><strong>Deleted:</strong> your name, mobile number, marketing consent, saved addresses, favourites and loyalty records.</li>
              <li><strong>Kept:</strong> your past orders, for food-safety, tax and accounting records. Your order records will no longer show your name or number.</li>
            </ul>
            <p className="profile-delete-note">If you change your mind, you can sign in again with a new one-time code.</p>
            <div className="dialog-actions">
              <Button type="button" variant="secondary" onClick={() => setDeleteAccountOpen(false)}>Keep my account</Button>
              <Button type="button" variant="danger" onClick={() => void confirmDeleteAccount()} disabled={busy}>{busy ? "Deleting…" : "Delete my account"}</Button>
            </div>
          </div>
        </Dialog>
      </main>
  );

  async function saveProfile() {
    setBusy(true);
    try {
      const result = await patchProfile({
        name: profile?.name?.trim() || undefined,
        marketing_opt_in: profile?.marketing_opt_in ?? false,
      });
      setProfile(result);
      toast("Details saved.", "success");
    } catch (requestError) {
      setError(describeApiError(requestError, "We couldn't save your details. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  function openEdit(address: CustomerAddress) {
    setForm({
      label: address.label,
      address: address.address,
      lat: String(address.lat),
      lng: String(address.lng),
      is_default: address.is_default,
    });
    setFormErrors({});
    setEditId(address.id);
    setAddOpen(true);
  }

  async function saveAddress() {
    setFormErrors({});
    const lat = Number(form.lat);
    const lng = Number(form.lng);
    let invalid = false;
    if (!form.address.trim()) { setFormErrors((c) => ({ ...c, address: "Enter your address." })); invalid = true; }
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) { setFormErrors((c) => ({ ...c, lat: "Enter a valid latitude." })); invalid = true; }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) { setFormErrors((c) => ({ ...c, lng: "Enter a valid longitude." })); invalid = true; }
    if (invalid) return;

    setBusy(true);
    try {
      if (editId) {
        const result = await patchAddress(editId, {
          label: form.label,
          address: form.address.trim(),
          lat,
          lng,
          is_default: form.is_default,
        });
        setAddresses((current) => current.map((address) => address.id === result.id ? result : address));
        toast("Address saved.", "success");
      } else {
        if (addresses.length >= MAX_ADDRESSES) {
          toast(addressLimitError(), "error");
          return;
        }
        const result = await createAddress({
          label: form.label,
          address: form.address.trim(),
          lat,
          lng,
          is_default: form.is_default,
        });
        setAddresses((current) => [result, ...current]);
        toast("Address added.", "success");
      }
      setAddOpen(false);
      setEditId(null);
      setForm(emptyForm());
      setFormErrors({});
    } catch (requestError) {
      const apiError = requestError as ApiError;
      if (apiError.status === 409) {
        toast(describeApiError(requestError, addressLimitError()), "error");
        return;
      }
      const fieldError = apiError.fields;
      if (fieldError && Object.keys(fieldError).length > 0) {
        setFormErrors(fieldError as Record<string, string>);
      } else {
        setError(describeApiError(requestError, "We couldn't save the address. Please try again."));
      }
    } finally {
      setBusy(false);
    }
  }

  async function setDefault(addressId: string) {
    setBusy(true);
    try {
      const address = addresses.find((item) => item.id === addressId);
      if (!address || address.is_default) return;
      const result = await patchAddress(addressId, { is_default: true });
      setAddresses(switchDefault(addresses, result.id));
      toast("Default address updated.", "success");
    } catch (requestError) {
      setError(describeApiError(requestError, "We couldn't update your default address. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeleteAddress() {
    if (!deleteId) return;
    setBusy(true);
    try {
      await deleteAddress(deleteId);
      setAddresses((current) => {
        const remaining = current.filter((item) => item.id !== deleteId);
        if (remaining.length === 0) return remaining;
        const deleted = current.find((item) => item.id === deleteId);
        if (deleted?.is_default) {
          const promoted = promoteAfterDelete(current, deleteId);
          return remaining.map((item) => item.id === promoted.id ? { ...item, is_default: true } : item);
        }
        return remaining;
      });
      toast("Address deleted.", "success");
    } catch (requestError) {
      setError(describeApiError(requestError, "We couldn't delete the address. Please try again."));
    } finally {
      setBusy(false);
      setDeleteId(null);
    }
  }

  async function removeFavouriteItem(itemId: string) {
    setFavourites((current) => current.filter((item) => item.item_id !== itemId));
    try {
      await removeFavourite(itemId);
      toast("Removed from favourites.", "success");
    } catch (requestError) {
      setFavourites((current) => [...current]); // revert handled by optimistic removal above; re-add is not tracked, so refresh
      void listFavourites().then((updated) => setFavourites(updated)).catch(() => undefined);
      setError(describeApiError(requestError, "We couldn't remove the favourite. Please try again."));
    }
  }

  async function confirmDeleteAccount() {
    setBusy(true);
    try {
      await deleteMyAccount();
      toast("Your account has been deleted.", "success");
      router.push("/");
    } catch (requestError) {
      setError(describeApiError(requestError, "We couldn't delete your account. Please try again."));
    } finally {
      setBusy(false);
      setDeleteAccountOpen(false);
    }
  }
}

function addressLimitError(): string {
  return "You can save up to 5 addresses.";
}
