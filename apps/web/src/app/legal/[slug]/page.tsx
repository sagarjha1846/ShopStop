import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

// Policy content (docs/01 §Legal, docs/03 §Legal & Consent). These are plain-language
// templates and MUST be reviewed by counsel before launch (India DPDP Act + GDPR-aware).
const POLICIES: Record<string, { title: string; body: string[] }> = {
  terms: {
    title: 'Terms of Service',
    body: [
      'ShopStop is a facilitator that connects buyers and sellers. We do not own, sell, or take possession of listed items; the contract of sale is between the buyer and the seller.',
      'You agree to provide accurate information, to list only legal items you have the right to sell, and not to circumvent the platform’s trust, safety, or payment mechanisms.',
      'We may suspend, restrict, or ban accounts that violate these terms or our policies, and remove listings that breach the Prohibited Items Policy.',
      'The platform is provided “as is”. To the extent permitted by law, ShopStop is not liable for the quality, safety, or legality of items, or for the conduct of users.',
    ],
  },
  privacy: {
    title: 'Privacy Policy',
    body: [
      'We collect only the personal data needed to operate the marketplace: account details (email, phone), profile, listings, orders, messages, and device/usage signals used for fraud prevention.',
      'Lawful basis & consent: we process data to provide the service and, where required, on the basis of your consent (managed in settings). You may withdraw consent for non-essential processing at any time.',
      'Your rights (DPDP Act 2023 / GDPR-aware): access, correction, and erasure of your personal data via a Data Subject Request. We minimize data, encrypt it in transit and at rest, and never sell it.',
      'We never store raw KYC documents or card data on our servers; verification and payments are handled by licensed partners. Security incidents are handled per our breach-response process.',
    ],
  },
  refund: {
    title: 'Refund Policy',
    body: [
      'Because ShopStop facilitates peer-to-peer sales, refunds are governed by the agreement between buyer and seller and by the order’s status.',
      'If an item is not delivered or is materially not as described, open a dispute on the order. Our Trust & Safety team reviews the order timeline, chat, and evidence and may resolve with a full or partial refund.',
      'Escrow-backed protection (where available) holds funds until delivery is confirmed and freezes settlement while a dispute is open.',
    ],
  },
  seller: {
    title: 'Seller Agreement',
    body: [
      'As a seller you confirm you own or are authorized to sell each item, that listings are accurate, and that you will fulfil accepted orders promptly.',
      'You authorize the platform’s risk checks and moderation. High-risk or policy-violating listings may be held for review or removed.',
      'Applicable taxes and legal obligations for your sales are your responsibility.',
    ],
  },
  buyer: {
    title: 'Buyer Agreement',
    body: [
      'As a buyer you agree to communicate and transact in good faith, to pay through the platform’s supported methods, and to use the dispute process rather than off-platform coercion.',
      'Review sellers honestly after completed orders; reviews power the trust system that protects everyone.',
    ],
  },
  prohibited: {
    title: 'Prohibited Items Policy',
    body: [
      'The following may not be listed: weapons, ammunition and explosives; illegal drugs and controlled substances; counterfeit or stolen goods; endangered wildlife and regulated animal products; human remains or organs; hazardous materials; government IDs and documents; and anything otherwise illegal in the buyer’s or seller’s jurisdiction.',
      'Regulated categories (e.g., certain pets, alcohol, medical devices) are permitted only where legally allowed and may require verification.',
      'Listings are screened automatically and by human moderators. Violations are removed and may result in account action.',
    ],
  },
  cookies: {
    title: 'Cookie Policy',
    body: [
      'We use strictly necessary cookies for authentication and security (including the httpOnly session cookie). Optional analytics cookies are used only with your consent.',
      'You can manage non-essential cookie preferences in settings; declining them does not affect core functionality.',
    ],
  },
  dmca: {
    title: 'Copyright / DMCA Policy',
    body: [
      'If you believe a listing infringes your intellectual property, submit a notice with the work identified, the infringing listing URL, your contact details, and a good-faith statement.',
      'We remove infringing content and provide a counter-notice process. Repeat infringers are removed from the platform.',
    ],
  },
};

export function generateStaticParams() {
  return Object.keys(POLICIES).map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  return { title: POLICIES[slug]?.title ?? 'Legal' };
}

export default async function LegalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const policy = POLICIES[slug];
  if (!policy) notFound();
  return (
    <article className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-title font-semibold">{policy.title}</h1>
      <p className="rounded-md bg-surface shadow-card p-3 text-caption text-muted">
        Template for the ShopStop MVP — review by legal counsel is required before launch.
      </p>
      {policy.body.map((p, i) => (
        <p key={i} className="text-footnote leading-relaxed">
          {p}
        </p>
      ))}
    </article>
  );
}
