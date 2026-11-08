export type SignInMode = "customer" | "staff";

export function roleHome(role: string): string {
  if (role === "admin") return "/admin/menu";
  if (role === "kitchen") return "/kitchen";
  if (role === "catering") return "/catering";
  return "/";
}

export function roleLabel(role: string): string {
  if (role === "customer") return "a customer";
  if (role === "kitchen") return "kitchen staff";
  if (role === "admin") return "an admin";
  if (role === "catering") return "a catering manager";
  return "a user";
}

export function isValidPhone(value: string): boolean {
  return /^\d{10}$/.test(value.trim());
}

export function isValidOtp(value: string): boolean {
  return /^\d{6}$/.test(value.trim());
}

export function safeNext(next: string | null | undefined): string | null {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : null;
}
