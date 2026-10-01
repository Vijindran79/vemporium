import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Vemporium — Indian ethnic wear, fitted to you',
  description:
    'Authentic Indian ethnic wear from master weavers, with a 3D virtual fitting room, local-currency pricing and worldwide delivery.',
  openGraph: {
    title: 'Vemporium — Indian ethnic wear, fitted to you',
    description: 'Try on Kurtas, Sarees, Lehengas and Sherwanis on your own 3D avatar before you buy.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: '#7B1E3A',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-full">
        <header className="sticky top-0 z-40 border-b border-stone-200 bg-ivory/85 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
            <Link href="/" className="font-display text-xl tracking-tight text-maroon">
              Vemporium
            </Link>
            <nav className="flex items-center gap-1 sm:gap-2">
              <Link href="/fitting-room" className="btn-ghost hidden sm:inline-block">
                Fitting room
              </Link>
              <Link href="/fitting-room" className="btn-primary">
                Try it on
              </Link>
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
