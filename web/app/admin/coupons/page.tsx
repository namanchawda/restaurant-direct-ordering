"use client";

import { FormEvent, useEffect, useState } from "react";
import { Button, Card, Input } from "@/components/ui";
import { api } from "@/lib/api";

type Coupon = { id: string; code: string; type: string; value: number; min_order_inr: number; active: boolean; is_demo: boolean };
export default function CouponsPage() {
  const [coupons, setCoupons] = useState<Coupon[]>([]); const [code, setCode] = useState(""); const [message, setMessage] = useState("");
  const load = () => { void api<Coupon[]>("/admin/coupons").then(setCoupons).catch(() => setMessage("Unable to load coupons.")); };
  useEffect(load, []);
  async function create(event: FormEvent) { event.preventDefault(); try { await api("/admin/coupons", { method: "POST", body: JSON.stringify({ code, type: "percent", value: 10, min_order_inr: 0 }) }); setCode(""); setMessage("Coupon created."); load(); } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to create coupon."); } }
  return <section className="admin-section"><div className="admin-page-heading"><div><p className="admin-eyebrow">Offers</p><h1>Coupons</h1></div></div><Card><form className="admin-form-grid" onSubmit={create}><label className="field"><span>Coupon code</span><Input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="MONSOON10" /></label><Button type="submit" variant="primary">Create 10% coupon</Button></form>{message && <p role="status">{message}</p>}</Card><Card><ul className="checkout-summary-lines">{coupons.map((coupon) => <li key={coupon.id}><span><strong>{coupon.code}</strong> · {coupon.type} {coupon.value}{coupon.is_demo ? " · demo" : ""}</span><Button type="button" variant="secondary" size="small" onClick={() => void api(`/admin/coupons/${coupon.id}`, { method: "PATCH", body: JSON.stringify({ active: !coupon.active }) }).then(load)}>{coupon.active ? "Deactivate" : "Activate"}</Button></li>)}</ul></Card></section>;
}
