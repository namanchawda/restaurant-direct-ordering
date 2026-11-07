export const PARTY_MIN_NOTICE_HOURS = 24;
export const PARTY_MIN_GUESTS = 10;
export const PARTY_MAX_GUESTS = 500;
export const PARTY_MAX_DAYS_AHEAD = 90;

function localDateTimeValue(value: Date): string {
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

export function minimumPartyDateTime(now = new Date()): Date {
  return new Date(now.getTime() + PARTY_MIN_NOTICE_HOURS * 60 * 60 * 1000);
}

export function partyDateInputValue(value: Date): string {
  return localDateTimeValue(value).slice(0, 10);
}

export function partyTimeInputValue(value: Date): string {
  return localDateTimeValue(value).slice(11, 16);
}

export function maximumPartyDateInputValue(now = new Date()): string {
  const latest = new Date(now);
  latest.setDate(latest.getDate() + PARTY_MAX_DAYS_AHEAD);
  return partyDateInputValue(latest);
}

export function isPartySlotValid(dateValue: string, timeValue: string, now = new Date()): boolean {
  if (!dateValue || !timeValue) return false;
  const slot = new Date(`${dateValue}T${timeValue}`);
  if (Number.isNaN(slot.getTime())) return false;
  const earliest = minimumPartyDateTime(now);
  const latest = new Date(now.getTime() + PARTY_MAX_DAYS_AHEAD * 24 * 60 * 60 * 1000);
  return slot >= earliest && slot <= latest;
}

export function isValidPartyGuestCount(guests: number): boolean {
  return Number.isInteger(guests) && guests >= PARTY_MIN_GUESTS && guests <= PARTY_MAX_GUESTS;
}

export function guestLimitMessage(): string {
  return `Party orders are for ${PARTY_MIN_GUESTS} to ${PARTY_MAX_GUESTS} guests.`;
}
