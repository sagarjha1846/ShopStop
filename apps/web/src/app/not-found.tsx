import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-3xl font-bold">404</h1>
      <p className="mt-2 text-muted">That page or listing doesn’t exist (or was removed).</p>
      <Link href="/" className="mt-4 inline-block text-brand underline">
        Back to home
      </Link>
    </div>
  );
}
