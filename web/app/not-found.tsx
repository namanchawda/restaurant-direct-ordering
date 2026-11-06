import Link from "next/link";

export const metadata = {
  title: "Not found | Hyderabad Biryani",
};

export default function NotFound() {
  return (
    <main className="customer-page">
      <article className="empty-state" role="status">
        <span className="empty-mark" aria-hidden="true">?</span>
        <h2>Page not found</h2>
        <p>This link doesn&apos;t lead to a page. Start from the menu instead.</p>
        <Link className="button button-primary" href="/">
          Back to ordering
        </Link>
      </article>
    </main>
  );
}
