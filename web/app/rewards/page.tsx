"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AccountMenu } from "@/components/customer/AccountMenu";
import { Card } from "@/components/ui";
import { api } from "@/lib/api";
import { formatINR } from "@/lib/customer";

type Rewards = { balance_points: number; value_inr: number; tier: string; lifetime_points: number; next_tier_points: number | null; transactions: { type: string; points: number; balance_after: number; note: string | null; created_at: string }[] };

export default function RewardsPage() {
  const [rewards, setRewards] = useState<Rewards | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void api<Rewards>("/loyalty/me").then(setRewards).catch((value: unknown) => setError(value instanceof Error ? value.message : "Sign in to view rewards.")); }, []);
  return <main className="customer-page"><header className="simple-page-header"><Link className="back-link" href="/">← Menu</Link><div className="header-end"><Link className="brand-lockup" href="/"><span className="brand-mark" aria-hidden="true">H</span><span>Hyderabad Biryani</span></Link><AccountMenu /></div></header><section className="privacy-content"><p className="customer-eyebrow">Rewards</p><h1>Direct-order rewards</h1>{error ? <Card className="checkout-card"><p>{error}</p><Link className="button button-primary" href="/login">Sign in</Link></Card> : rewards && <><Card className="checkout-card"><p className="checkout-step-label">{rewards.tier} tier</p><h2>{rewards.balance_points} points</h2><p className="checkout-card-copy">Worth {formatINR(rewards.value_inr)}. Lifetime points: {rewards.lifetime_points}.</p>{rewards.next_tier_points && <p className="checkout-hint">{Math.max(0, rewards.next_tier_points - rewards.lifetime_points)} points to Gold.</p>}</Card><Card className="checkout-card"><h2>History</h2><ul className="checkout-summary-lines">{rewards.transactions.map((tx, index) => <li key={`${tx.created_at}-${index}`}><span>{tx.note ?? tx.type}</span><strong>{tx.points > 0 ? "+" : ""}{tx.points}</strong></li>)}</ul></Card></>}</section></main>;
}
