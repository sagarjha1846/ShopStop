import { LinkButton } from '@/components/ui';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-24 text-center">
      <h1 className="text-title font-semibold">This page doesn&rsquo;t exist</h1>
      <p className="mt-2 text-footnote text-muted">
        The listing may have sold, or the link may be wrong.
      </p>
      <div className="mt-7 flex justify-center gap-3">
        <LinkButton href="/search">Browse listings</LinkButton>
        <LinkButton href="/" variant="secondary">
          Go home
        </LinkButton>
      </div>
    </div>
  );
}
