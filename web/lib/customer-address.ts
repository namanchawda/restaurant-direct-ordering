import type { CustomerAddress } from "./api";

export const MAX_ADDRESSES = 5;

export function addressLimitError(): string {
  return "You can save up to 5 addresses.";
}

export function switchDefault(
  addresses: CustomerAddress[],
  targetId: string,
): CustomerAddress[] {
  return addresses.map((address) => ({
    ...address,
    is_default: address.id === targetId,
  }));
}

export function promoteAfterDelete(
  addresses: CustomerAddress[],
  deletedId: string,
): CustomerAddress {
  const remaining = addresses.filter((address) => address.id !== deletedId);
  if (remaining.length === 0) throw new Error("No addresses remain.");
  const promoted = remaining.sort(
    (left, right) =>
      new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
  )[0];
  return { ...promoted, is_default: true };
}
