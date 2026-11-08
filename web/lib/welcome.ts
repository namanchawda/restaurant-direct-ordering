export function shouldShowWelcome(locationStored: boolean, welcomeSeen: boolean): boolean {
  return !locationStored && !welcomeSeen;
}
