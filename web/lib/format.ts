export function formatINR(amount: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatItemCount(count: number): string {
  return `${count} ${count === 1 ? "item" : "items"}`;
}

const KOLKATA_TIME = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const KOLKATA_DATE_TIME = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

export function formatTime(value: string | number | Date): string {
  return KOLKATA_TIME.format(new Date(value)).toLowerCase();
}

export function formatDateTime(value: string | number | Date): string {
  return KOLKATA_DATE_TIME.format(new Date(value));
}

export function minutesUntil(value: string | number | Date, now = Date.now()): number {
  return Math.ceil((new Date(value).getTime() - now) / 60000);
}

export function minutesSince(value: string | number | Date, now = Date.now()): number {
  return Math.max(0, Math.ceil((now - new Date(value).getTime()) / 60000));
}
