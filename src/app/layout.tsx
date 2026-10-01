import type { Metadata, Viewport } from 'next';
import { GeoHeader } from '@/components/shell/GeoHeader';
import { SiteHeader } from '@/components/shell/SiteHeader';
import { MoneyProvider } from '@/components/shell/MoneyProvider';
import { resolveGeo } from '@/lib/geo';
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

/**
 * The geo-banner needs the visitor's market, so the root layout is dynamic.
 * It stays dynamic for the whole app because the header renders on every page
 * — a single geo resolution per request is cheap (edge header or cookie) and
 * the alternative, a client-side guess, means showing the wrong currency first.
 */
export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const geo = await resolveGeo();

  return (
    <html lang={geo.locale}>
      <body className="flex min-h-full flex-col">
        <MoneyProvider
          initialCountry={geo.country}
          initialCurrency={geo.currency}
          initialLocale={geo.locale}
          initialIsGuess={geo.isGuess}
        >
          <GeoHeader />
          <SiteHeader />
          <div className="flex-1">{children}</div>
          <footer className="mt-16 border-t border-stone-200 bg-white">
            <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 text-xs text-stone-500 sm:flex-row sm:items-center sm:justify-between">
              <p>
                © {new Date().getFullYear()} Vemporium. Every piece sourced from a named Indian workshop.
              </p>
              <nav className="flex gap-4">
                <a href="/catalog" className="hover:text-maroon">Shop</a>
                <a href="/fitting-room" className="hover:text-maroon">Fitting room</a>
                <a href="/vendor" className="hover:text-maroon">Operations demo</a>
              </nav>
            </div>
          </footer>
        </MoneyProvider>
      </body>
    </html>
  );
}

