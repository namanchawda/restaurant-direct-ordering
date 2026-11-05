import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../lib/payment.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const paymentModule = { exports: {} };
new Function("require", "module", "exports", compiled)(
  createRequire(import.meta.url),
  paymentModule,
  paymentModule.exports,
);

const {
  digitsOnly,
  formatCardNumber,
  formatExpiry,
  isValidCvv,
  isValidExpiry,
  isValidUpiId,
  luhnCheck,
  validatePayment,
} = paymentModule.exports;

assert.equal(digitsOnly("4242 4242-4242"), "424242424242");
assert.equal(formatCardNumber("4242424242424242"), "4242 4242 4242 4242");
assert.equal(formatCardNumber("42424242424242424242"), "4242 4242 4242 4242 424");
assert.equal(formatExpiry("1228"), "12/28");
assert.equal(formatExpiry("1"), "1");
assert.equal(luhnCheck("4242 4242 4242 4242"), true);
assert.equal(luhnCheck("4000 0000 0000 0002"), true);
assert.equal(luhnCheck("1234 5678 9012"), false);
assert.equal(isValidUpiId("customer@okaxis"), true);
assert.equal(isValidUpiId("customer@fail"), true);
assert.equal(isValidUpiId("not-a-upi-id"), false);
assert.equal(isValidCvv("123"), true);
assert.equal(isValidCvv("1234"), true);
assert.equal(isValidCvv("12"), false);
assert.equal(isValidExpiry("12/30", new Date("2026-11-05T00:00:00Z")), true);
assert.equal(isValidExpiry("10/26", new Date("2026-11-05T00:00:00Z")), false);
assert.equal(isValidExpiry("13/30", new Date("2026-11-05T00:00:00Z")), false);

const upiErrors = validatePayment("upi", {
  upiId: "",
  cardNumber: "",
  expiry: "",
  cvv: "",
});
assert.equal(upiErrors.upi_id, "Enter your UPI ID.");

const cardErrors = validatePayment("card", {
  upiId: "",
  cardNumber: "4000 0000 0000 0002",
  expiry: "10/26",
  cvv: "1",
}, new Date("2026-11-05T00:00:00Z"));
assert.equal(cardErrors.card_number, undefined);
assert.ok(cardErrors.expiry);
assert.ok(cardErrors.cvv);

const badCardErrors = validatePayment("card", {
  upiId: "",
  cardNumber: "4000 0000 0000 0001",
  expiry: "12/30",
  cvv: "123",
}, new Date("2026-11-05T00:00:00Z"));
assert.ok(badCardErrors.card_number);
assert.deepEqual(
  validatePayment("card", {
    upiId: "",
    cardNumber: "4242 4242 4242 4242",
    expiry: "12/30",
    cvv: "123",
  }, new Date("2026-11-05T00:00:00Z")),
  {},
);

console.log("Payment logic passed: formatting, Luhn, expiry, UPI, CVV, and validation.");
