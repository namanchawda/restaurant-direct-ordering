import Link from "next/link";
import { AccountMenu } from "@/components/customer/AccountMenu";
import { PageShell } from "@/components/customer/PageShell";

export const metadata = {
  title: "Privacy notice | Hyderabad Biryani",
  description: "How Hyderabad Biryani collects, uses and protects your personal data.",
};

export default function PrivacyPage() {
  return (
    <PageShell
      title="Privacy"
      subtitle="Privacy notice"
    >
      <article className="privacy-content">
        <p className="customer-eyebrow">Your data</p>
        <h1>Privacy notice</h1>
        <p className="privacy-updated">Last updated: 5 November 2026</p>
        <p className="privacy-lede">
          This notice explains how Hyderabad Biryani handles personal data when you order
          direct from us. We collect only what we need to cook, deliver and support your order.
        </p>

        <section>
          <h2>What we collect</h2>
          <ul>
            <li><strong>Contact details:</strong> your mobile number and the name you give us for the order.</li>
            <li><strong>Delivery details:</strong> the address and map coordinates you choose, and any note you add for the kitchen or rider.</li>
            <li><strong>Order details:</strong> the dishes, portions, add-ons, quantities, price and order status.</li>
            <li><strong>Payment details:</strong> the method you choose and the outcome of the test payment. We do not store your full card number or CVV.</li>
            <li><strong>Marketing choice:</strong> whether you opted in to offers by WhatsApp or SMS.</li>
          </ul>
        </section>

        <section>
          <h2>Why we use it</h2>
          <ul>
            <li>To sign you in with a one-time code and keep your order history available to you.</li>
            <li>To prepare your food, deliver it to the right address and show you live order updates.</li>
            <li>To take payment, prevent duplicate orders and handle refunds or complaints.</li>
            <li>To meet food-safety, tax and accounting obligations.</li>
            <li>To send offers only when you have opted in. You can opt out at any time.</li>
          </ul>
        </section>

        <section>
          <h2>Who can see it</h2>
          <p>
            The kitchen preparing your order and the delivery partner assigned to it see the
            details needed to fulfil the order. Our service providers process data on our behalf
            for hosting, messaging and payment simulation. We do not sell your personal data.
          </p>
        </section>

        <section>
          <h2>How long we keep it</h2>
          <p>
            We keep order and payment records for as long as needed to meet legal, tax and
            accounting requirements. Marketing consent is kept until you withdraw it. Location
            data is used to check delivery coverage and is not retained longer than needed for
            that purpose.
          </p>
        </section>

        <section>
          <h2>Your choices and rights</h2>
          <p>
            Under the Digital Personal Data Protection Act, 2023, you can ask to access,
            correct or erase your personal data, withdraw consent, or raise a grievance. Some
            records may be kept where the law requires it. To make a request, contact us using
            the details below.
          </p>
          <p>
            You can withdraw marketing consent at any time by replying STOP to a marketing
            message or by contacting us. Withdrawing marketing consent does not affect order
            updates.
          </p>
        </section>

        <section>
          <h2>Security</h2>
          <p>
            Access to customer data is limited to people who need it for their work. We use
            secure connections, short-lived sign-in codes and test payment flows that avoid
            handling real card credentials.
          </p>
        </section>

        <section>
          <h2>Children</h2>
          <p>
            Our ordering service is not intended for children under 18. If you believe a child
            has shared personal data with us, contact us and we will take appropriate action.
          </p>
        </section>

        <section>
          <h2>Grievance officer</h2>
          <p>
            For privacy questions or complaints, contact our grievance officer at{" "}
            <a href="mailto:privacy@hyderabadbiryani.example">privacy@hyderabadbiryani.example</a>.
            We will acknowledge your request and work with you to resolve it.
          </p>
        </section>

        <p className="privacy-back">
          <Link className="button button-secondary" href="/">Back to ordering</Link>
        </p>
      </article>
    </PageShell>
  );
}