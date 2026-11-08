"use client";

export function QuantityStepper({
  quantity,
  label,
  onDecrease,
  onIncrease,
}: {
  quantity: number;
  label: string;
  onDecrease: () => void;
  onIncrease: () => void;
}) {
  return (
    <div className="quantity-stepper" aria-label={label}>
      <button type="button" aria-label={`Decrease ${label}`} onClick={onDecrease}>
        −
      </button>
      <span aria-live="polite">{quantity}</span>
      <button
        type="button"
        aria-label={`Increase ${label}`}
        onClick={onIncrease}
        disabled={quantity >= 20}
      >
        +
      </button>
    </div>
  );
}
