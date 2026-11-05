import Link from "next/link";

function ServingDish() {
  return (
    <svg
      aria-hidden="true"
      className="dish-art"
      viewBox="0 0 480 420"
      fill="none"
      role="presentation"
    >
      <circle cx="240" cy="210" r="187" fill="#F2E6DE" />
      <circle cx="240" cy="210" r="145" fill="#FFFDF9" />
      <ellipse cx="240" cy="239" rx="122" ry="76" fill="#783B35" />
      <ellipse cx="240" cy="224" rx="122" ry="76" fill="#9A5546" />
      <path
        d="M142 220c25-41 50-54 70-32 19 21 36 10 54-13 22-27 49-20 72 24-21 25-32 50-65 53-32 3-43-23-70-10-19 10-38 13-61-22Z"
        fill="#F5D99A"
      />
      <path
        d="M166 203c15-22 26-31 42-19m15 17c16-25 29-34 46-19m21 14c15-20 26-22 40-8m-136 53c16-21 30-22 45-10m23 8c14-18 29-20 44-7"
        stroke="#FFF5D9"
        strokeWidth="8"
        strokeLinecap="round"
      />
      <circle cx="197" cy="220" r="5" fill="#6C873E" />
      <circle cx="279" cy="193" r="5" fill="#6C873E" />
      <circle cx="246" cy="247" r="5" fill="#6C873E" />
      <path d="M117 319c37 28 209 39 252 0" stroke="#572923" strokeWidth="6" strokeLinecap="round" />
      <path d="M191 106c7-11 13-11 20 0m47 2c7-11 13-11 20 0" stroke="#B77820" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}

export default function Home() {
  return (
    <main className="min-h-screen bg-canvas text-ink">
      <div className="mx-auto flex min-h-screen max-w-page flex-col px-5 sm:px-8 lg:px-12">
        <header className="flex items-center justify-between border-b border-line py-5 sm:py-6">
          <Link className="wordmark" href="/" aria-label="Hyderabad Biryani home">
            <span className="wordmark-mark" aria-hidden="true">H</span>
            <span>Hyderabad Biryani</span>
          </Link>
          <span className="header-note">A direct line to our kitchens</span>
        </header>

        <section className="hero grid flex-1 items-center gap-8 py-12 sm:py-16 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14 lg:py-20">
          <div className="hero-copy max-w-2xl">
            <p className="eyebrow"><span className="eyebrow-dot" /> Hyderabad, India</p>
            <h1 className="mt-6 font-display text-[clamp(2.75rem,7vw,5.75rem)] leading-[0.98] tracking-[-0.045em]">
              Biryani, made for <span className="text-brand">your table.</span>
            </h1>
            <p className="mt-6 max-w-lg text-lg leading-8 text-muted sm:text-xl">
              We’re bringing our kitchens a little closer. Direct ordering is on its way.
            </p>
            <div className="mt-9 inline-flex items-center gap-3 rounded-full border border-line bg-white px-4 py-3 text-sm font-medium text-ink">
              <span className="status-dot" aria-hidden="true" />
              <span>Getting ready to serve you</span>
            </div>
          </div>

          <div className="dish-panel" aria-label="Illustration of Hyderabadi biryani">
            <div className="dish-caption">
              <span className="dish-caption-label">From our kitchens</span>
              <span className="dish-caption-rule" aria-hidden="true" />
              <span className="dish-caption-label">To your table</span>
            </div>
            <ServingDish />
            <p className="dish-note">Hyderabad, always at the heart of it.</p>
          </div>
        </section>

        <footer className="flex flex-col gap-3 border-t border-line py-5 text-xs leading-5 text-muted sm:flex-row sm:items-center sm:justify-between">
          <p>Made with care in Hyderabad.</p>
          <p>Direct from our kitchens. Coming soon.</p>
        </footer>
      </div>
    </main>
  );
}
