import Link from "next/link";

export function LandingFooter() {
  return (
    <footer className="landing-footer">
      <div className="hb-checker" aria-hidden="true" />
      <div className="landing-footer-inner">
        <p className="landing-footer-mark" aria-hidden="true">biryani</p>
        <nav className="landing-footer-links" aria-label="Footer">
          <Link href="#top">Back to top</Link>
          <Link href="/menu">Menu</Link>
          <Link href="/party">Party orders</Link>
          <Link href="/rewards">Rewards</Link>
          <Link href="/privacy">Privacy</Link>
        </nav>
        <p className="landing-footer-note">Hyderabad Biryani · Prices include 5% GST · FSSAI numbers are shown for each kitchen above.</p>
      </div>
    </footer>
  );
}
