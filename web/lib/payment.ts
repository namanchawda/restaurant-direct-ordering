export type PaymentMethod = "upi" | "card";

export function digitsOnly(value: string): string {
  return value.replace(/\D+/g, "");
}

export function formatCardNumber(value: string): string {
  return digitsOnly(value).slice(0, 19).replace(/(\d{4})(?=\d)/g, "$1 ");
}

export function formatExpiry(value: string): string {
  const digits = digitsOnly(value).slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

export function luhnCheck(value: string): boolean {
  const digits = digitsOnly(value);
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

export function isValidExpiry(value: string, now = new Date()): boolean {
  const match = /^(\d{2})\/(\d{2})$/.exec(value.trim());
  if (!match) return false;
  const month = Number(match[1]);
  const year = 2000 + Number(match[2]);
  if (month < 1 || month > 12) return false;
  const endOfMonth = new Date(year, month, 1);
  const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  return endOfMonth > currentMonth;
}

export function isValidUpiId(value: string): boolean {
  const trimmed = value.trim();
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,}@[a-zA-Z0-9.-]{2,}$/.test(trimmed);
}

export function isValidCvv(value: string): boolean {
  return /^\d{3,4}$/.test(value);
}

export function validatePayment(
  method: PaymentMethod,
  values: { upiId: string; cardNumber: string; expiry: string; cvv: string },
  now = new Date(),
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (method === "upi") {
    if (!values.upiId.trim()) errors.upi_id = "Enter your UPI ID.";
    else if (!isValidUpiId(values.upiId)) errors.upi_id = "Enter a UPI ID like name@bank.";
    return errors;
  }

  if (!values.cardNumber.trim()) errors.card_number = "Enter your card number.";
  else if (!luhnCheck(values.cardNumber)) errors.card_number = "Check the card number and try again.";

  if (!values.expiry.trim()) errors.expiry = "Enter the expiry date.";
  else if (!isValidExpiry(values.expiry, now)) errors.expiry = "Enter a future expiry date as MM/YY.";

  if (!values.cvv.trim()) errors.cvv = "Enter the CVV.";
  else if (!isValidCvv(values.cvv)) errors.cvv = "CVV should be 3 or 4 digits.";

  return errors;
}
