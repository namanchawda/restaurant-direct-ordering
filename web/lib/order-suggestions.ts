import type { MenuItem } from "./customer";

export function openOrderAgainItem(
  item: MenuItem,
  openItemSheet: (item: MenuItem) => void,
): void {
  openItemSheet(item);
}
