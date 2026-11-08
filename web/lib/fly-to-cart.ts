/* Put this file at src/lib/fly-to-cart.ts */
export function flyToCart(source: HTMLElement) {
  if (typeof window === "undefined") return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const target = document.querySelector<HTMLElement>(".site-cart");
  if (!target) return;

  const from = source.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  const startX = from.left + from.width / 2 - 20;
  const startY = from.top + from.height / 2 - 20;
  const dx = to.left + to.width / 2 - 20 - startX;
  const dy = to.top + to.height / 2 - 20 - startY;

  const dot = document.createElement("div");
  dot.textContent = "🍛";
  dot.setAttribute("aria-hidden", "true");
  Object.assign(dot.style, {
    position: "fixed", left: `${startX}px`, top: `${startY}px`, width: "40px", height: "40px",
    display: "grid", placeItems: "center", fontSize: "22px", borderRadius: "50%",
    background: "#ffc22e", border: "2px solid #2a0f0c", zIndex: "9999", pointerEvents: "none",
  });
  document.body.appendChild(dot);

  const flight = dot.animate(
    [
      { transform: "translate(0,0) scale(1)", opacity: 1 },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 90}px) scale(1.15) rotate(180deg)`, opacity: 1, offset: 0.5 },
      { transform: `translate(${dx}px, ${dy}px) scale(.35) rotate(360deg)`, opacity: 0.9 },
    ],
    { duration: 750, easing: "cubic-bezier(.45,.05,.55,.95)" },
  );
  flight.onfinish = () => {
    dot.remove();
    target.animate(
      [{ transform: "scale(1)" }, { transform: "scale(1.3) rotate(-12deg)" }, { transform: "scale(1)" }],
      { duration: 380, easing: "ease-out" },
    );
  };
}