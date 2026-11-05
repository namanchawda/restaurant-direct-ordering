const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export function Price({ amount, showGst = true }: { amount: number; showGst?: boolean }) {
  return (
    <span className="price">
      <span>{inr.format(amount)}</span>
      {showGst && <span className="gst-note">incl. 5% GST</span>}
    </span>
  );
}

export function preGst(amount: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount / 1.05);
}
