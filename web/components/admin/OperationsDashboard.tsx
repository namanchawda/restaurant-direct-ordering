"use client";

import { useEffect, useState } from "react";
import { api, describeApiError } from "@/lib/api";
import type { OutletResult } from "@/lib/customer";
import styles from "./OperationsDashboard.module.css";

type DateRange = "today" | "7-days" | "30-days";

type DashboardMetrics = {
  orders_count: number;
  revenue_inr: number;
  cancellations_count: number;
  avg_actual_minutes: number | null;
  on_time_rate: number | null;
  repeat_customer_pct: number | null;
};

type OutletMetrics = DashboardMetrics & {
  outlet_id: string;
  outlet: string;
};

type DashboardResponse = {
  total: DashboardMetrics;
  outlets: OutletMetrics[];
  orders_by_hour: { hour: number; orders_count: number }[];
  cancellations_by_reason: { reason: string | null; count: number }[];
};

const INR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const COUNT = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

function istDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((value) => value.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function dateDaysBefore(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function rangeQuery(range: DateRange, today: string): URLSearchParams {
  const daysBack = range === "today" ? 0 : range === "7-days" ? 6 : 29;
  const from = dateDaysBefore(today, daysBack);
  return new URLSearchParams({
    from: `${from}T00:00:00+05:30`,
    to: `${today}T23:59:59+05:30`,
  });
}

function percentage(value: number | null): string {
  return value === null ? "—" : `${new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 0,
  }).format(value)}%`;
}

function averagePrep(value: number | null): string {
  return value === null ? "—" : `${COUNT.format(Math.round(value))} min`;
}

function requestError(error: unknown): string {
  return describeApiError(error, "The dashboard could not load. Try again in a moment.");
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <article className={styles.metric}>
      <h2>{label}</h2>
      <p>{value}</p>
      {detail && <span>{detail}</span>}
    </article>
  );
}

function OrdersByHour({ rows }: { rows: DashboardResponse["orders_by_hour"] }) {
  const hourly = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    count: rows.find((row) => row.hour === hour)?.orders_count ?? 0,
  }));
  const maximum = Math.max(1, ...hourly.map((row) => row.count));
  const peak = hourly.reduce((best, row) => (row.count > best.count ? row : best), hourly[0]);
  const hasOrders = hourly.some((row) => row.count > 0);

  return (
    <section className={styles.panel} aria-labelledby="orders-by-hour-heading">
      <div className={styles.panelHeading}>
        <div>
          <h2 id="orders-by-hour-heading">Orders by hour</h2>
          {hasOrders && (
            <p>
              Busiest hour: {peak.hour.toString().padStart(2, "0")}:00 · {COUNT.format(peak.count)}{" "}
              {peak.count === 1 ? "order" : "orders"}
            </p>
          )}
        </div>
      </div>
      {hasOrders ? (
        <>
          <svg
            className={styles.chart}
            viewBox="0 0 720 160"
            role="img"
            aria-labelledby="orders-chart-title orders-chart-description"
          >
            <title id="orders-chart-title">Orders placed by hour</title>
            <desc id="orders-chart-description">
              Twenty-four bars show paid orders by hour in Indian Standard Time.
            </desc>
            <line x1="0" y1="136" x2="720" y2="136" className={styles.chartBaseline} />
            {hourly.map(({ hour, count }) => {
              const height = count === 0 ? 0 : Math.max(3, (count / maximum) * 112);
              return (
                <rect
                  key={hour}
                  x={hour * 30 + 7}
                  y={136 - height}
                  width="16"
                  height={height}
                  rx="3"
                  className={styles.chartBar}
                />
              );
            })}
          </svg>
          <div className={styles.chartLabels} aria-hidden="true">
            <span>12 am</span>
            <span>6 am</span>
            <span>12 pm</span>
            <span>6 pm</span>
            <span>11 pm</span>
          </div>
        </>
      ) : (
        <p className={styles.emptyChart}>No orders in this period.</p>
      )}
    </section>
  );
}

export function OperationsDashboard({ scope }: { scope: "admin" | "kitchen" }) {
  const [range, setRange] = useState<DateRange>("today");
  const [outletId, setOutletId] = useState("");
  const [outlets, setOutlets] = useState<OutletResult[]>([]);
  const [outletError, setOutletError] = useState<{ retryVersion: number; message: string } | null>(null);
  const [response, setResponse] = useState<{ key: string; data: DashboardResponse } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [retryVersion, setRetryVersion] = useState(0);
  const [today, setToday] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setToday(istDate(new Date())), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (scope !== "admin") return;
    let active = true;
    void api<OutletResult[]>("/outlets")
      .then((result) => {
        if (active) {
          setOutlets(result);
          setOutletError(null);
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setOutletError({ retryVersion, message: requestError(loadError) });
        }
      });
    return () => {
      active = false;
    };
  }, [retryVersion, scope]);

  const query = today ? rangeQuery(range, today) : new URLSearchParams();
  if (scope === "admin" && outletId) query.set("outlet_id", outletId);
  const queryString = query.toString();
  const path = scope === "admin" ? "/admin/dashboard" : "/kitchen/stats";
  const queryKey = `${path}?${queryString}&retry=${retryVersion}`;

  useEffect(() => {
    if (!today) return;
    let active = true;
    void api<DashboardResponse>(`${path}?${queryString}`)
      .then((result) => {
        if (active) {
          setResponse({ key: queryKey, data: result });
          setFailure(null);
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setFailure({ key: queryKey, message: requestError(loadError) });
        }
      });
    return () => {
      active = false;
    };
  }, [path, queryKey, queryString, today]);

  const data = response?.key === queryKey ? response.data : null;
  const error = failure?.key === queryKey ? failure.message : "";
  const loading = data === null && error === "";
  const visibleOutletError = outletError?.retryVersion === retryVersion ? outletError.message : "";
  const retry = () => setRetryVersion((version) => version + 1);
  const title = scope === "admin" ? "Dashboard" : "Kitchen stats";
  const periods: { value: DateRange; label: string }[] = [
    { value: "today", label: "Today" },
    { value: "7-days", label: "7 days" },
    { value: "30-days", label: "30 days" },
  ];

  return (
    <section className={styles.dashboard}>
      <header className={styles.pageHeading}>
        <div>
          <p>Operations</p>
          <h1>{title}</h1>
        </div>
        <div className={styles.filters}>
          <div className={styles.rangeGroup} role="group" aria-label="Date range">
            {periods.map((period) => (
              <button
                type="button"
                key={period.value}
                aria-pressed={range === period.value}
                className={range === period.value ? styles.rangeActive : ""}
                onClick={() => setRange(period.value)}
              >
                {period.label}
              </button>
            ))}
          </div>
          {scope === "admin" && (
            <label className={styles.outletFilter}>
              <span>Outlet</span>
              <select value={outletId} onChange={(event) => setOutletId(event.target.value)}>
                <option value="">All outlets</option>
                {outlets.map((outlet) => (
                  <option value={outlet.id} key={outlet.id}>
                    {outlet.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </header>

      {visibleOutletError && (
        <div className={styles.error} role="alert">
          <span>Outlet filter could not load: {visibleOutletError}</span>
          <button type="button" onClick={retry}>Try again</button>
        </div>
      )}

      {loading ? (
        <p className={styles.status} role="status">Loading {scope === "admin" ? "dashboard" : "kitchen stats"}…</p>
      ) : error ? (
        <div className={styles.error} role="alert">
          <span>{error}</span>
          <button type="button" onClick={retry}>Try again</button>
        </div>
      ) : data ? (
        <>
          <section className={styles.metrics} aria-label="Headline numbers">
            <Metric label="Orders" value={COUNT.format(data.total.orders_count)} />
            <Metric label="Revenue" value={INR.format(data.total.revenue_inr)} />
            <Metric
              label="Avg prep time"
              value={averagePrep(data.total.avg_actual_minutes)}
              detail="From order to ready"
            />
            <Metric label="On-time rate" value={percentage(data.total.on_time_rate)} />
            <Metric label="Repeat customers" value={percentage(data.total.repeat_customer_pct)} />
          </section>

          {data.total.orders_count === 0 && (
            <p className={styles.emptyNotice}>No paid orders for this period.</p>
          )}

          <div className={styles.detailGrid}>
            <section className={styles.panel} aria-labelledby="outlet-comparison-heading">
              <div className={styles.panelHeading}>
                <div>
                  <h2 id="outlet-comparison-heading">By outlet</h2>
                  <p>Performance for the selected period</p>
                </div>
              </div>
              {data.outlets.length > 0 ? (
                <table className={styles.outletTable}>
                  <thead>
                    <tr>
                      <th scope="col">Outlet</th>
                      <th scope="col">Orders</th>
                      <th scope="col">Revenue</th>
                      <th scope="col">Avg prep</th>
                      <th scope="col">On time</th>
                      <th scope="col">Repeat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.outlets.map((row) => (
                      <tr key={row.outlet_id}>
                        <th scope="row" data-label="Outlet">{row.outlet}</th>
                        <td data-label="Orders">{COUNT.format(row.orders_count)}</td>
                        <td data-label="Revenue">{INR.format(row.revenue_inr)}</td>
                        <td data-label="Avg prep">{averagePrep(row.avg_actual_minutes)}</td>
                        <td data-label="On time">{percentage(row.on_time_rate)}</td>
                        <td data-label="Repeat">{percentage(row.repeat_customer_pct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className={styles.emptyChart}>No outlet data for this period.</p>
              )}
            </section>

            <OrdersByHour rows={data.orders_by_hour} />

            <section className={styles.panel} aria-labelledby="cancellations-heading">
              <div className={styles.panelHeading}>
                <div>
                  <h2 id="cancellations-heading">Cancellations</h2>
                  <p>Reasons recorded for the selected period</p>
                </div>
                <strong className={styles.cancellationTotal}>
                  {COUNT.format(data.total.cancellations_count)}
                </strong>
              </div>
              {data.cancellations_by_reason.length > 0 ? (
                <ul className={styles.reasonList}>
                  {data.cancellations_by_reason.map((row, index) => (
                    <li key={`${row.reason ?? "unspecified"}-${index}`}>
                      <span>{row.reason || "Reason not provided"}</span>
                      <strong>{COUNT.format(row.count)}</strong>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.emptyChart}>No cancellations in this period.</p>
              )}
            </section>
          </div>
        </>
      ) : null}
    </section>
  );
}
