import Link from 'next/link';

/**
 * 404.
 *
 * A dead end is a lost sale. So this does what a good store does: it offers the
 * category rail and the fitting room, because someone who typed a broken URL or
 * followed a stale link is usually still in the mood to shop.
 */

export default function NotFound() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col items-center px-4 py-20 text-center">
      <p className="label-xs">404</p>
      <h1 className="mt-3 font-display text-3xl text-maroon">
        We could not find that piece.
      </h1>
      <p className="mt-3 max-w-prose text-sm leading-relaxed text-stone-600">
        It may have sold out, or the link may be old. The collection is still
        here, and so is the fitting room.
      </p>

      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link href="/catalog" className="btn-primary">
          Browse the collection
        </Link>
        <Link href="/fitting-room" className="btn-ghost">
          Open the fitting room
        </Link>
      </div>

      <div className="mt-12 w-full">
        <p className="label-xs">Start with a category</p>
        <div className="mt-3 flex flex-wrap justify-center gap-1.5">
          {['Sarees', 'Lehengas', 'Kurtas', 'Kurtis', 'Sherwanis', 'Dupattas'].map((c) => (
            <Link
              key={c}
              href="/catalog"
              className="rounded-full border border-stone-300 bg-white px-4 py-2 text-sm text-stone-700 transition-colors hover:border-maroon/40 hover:text-maroon"
            >
              {c}
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
