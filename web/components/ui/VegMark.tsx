export function VegMark({ isVeg }: { isVeg: boolean }) {
  return (
    <span
      className={`veg-mark ${isVeg ? "veg-mark-veg" : "veg-mark-nonveg"}`}
      role="img"
      aria-label={isVeg ? "Vegetarian" : "Non-vegetarian"}
      title={isVeg ? "Vegetarian" : "Non-vegetarian"}
    >
      <span />
    </span>
  );
}
