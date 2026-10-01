# Vemporium

Global marketplace for authentic Indian ethnic wear with an interactive **3D
virtual fitting room**, automatic local-currency pricing by geolocation, and
automated supplier replenishment back to Indian workshops.

Built from the PRD v1.0. Phase 1 (MVP) is implemented and running.

---

## What works today

| Area | Status |
| --- | --- |
| Global landing + geo-banner with manual country/currency/language override | Working — server-rendered, no currency flash |
| Category navigation by audience, garment type and craft | Working |
| Catalog with search + facet filters | Working — one field searches type, colour, fabric, craft |
| Product detail page with craft story and dynamic pricing | Working |
| Smart size match widget ("Fits 96% best in Size M") | Working — per-size bars, suppresses itself when unsure |
| Duties / landed-cost estimate on PDP and in cart | Working — de minimis, duty, import VAT |
| Parametric 3D avatar (women / men / kids) | Working — generated from measurements, not a fixed mesh |
| Metric/imperial toggle on measurements | Working — internal values stay metric |
| Camera presets: front / three-quarter / side / back | Working |
| Garment draping (wrapped / rigid / flowing) | Working — saree, lehenga, kurta, kurti, sherwani, dupatta |
| 360° rotation, zoom, side-by-side compare | Working |
| Cart with itemised totals and explicit FX rate | Working |
| Localised checkout with per-market payment router | Working — delivery → payment → review |
| Order webhook → decrement stock → auto purchase order | Implemented — needs Postgres to exercise |
| WhatsApp / email dispatch to suppliers | Implemented — simulated mode without credentials |
| Vendor restock dashboard | Working — drives the real `evaluateReorder()` |
| Real `.glb` garment models | Not started — procedural draping stands in |
| Auth / account / avatar persistence | Not started (Phase 2) |
| Real payment capture (Stripe etc.) | Not started (Phase 2) |

---

## Quick start

```bash
npm install
cp .env.example .env        # then set DATABASE_URL
npm run dev                 # http://localhost:3000
```

**Browsing works with no database at all** — the landing page, catalog, PDP,
fitting room, cart and currency engine all read from the bundled catalog. Start
with `npm run dev` and everything renders.

**Placing an order needs Postgres.** `POST /api/orders` refuses to invent a
confirmation when the database is unreachable, and returns a 503 saying so
rather than telling the customer their order succeeded when nothing was
recorded. To exercise the full path:

```bash
npm run db:push
npm run db:seed
```

Until then, checkout still works end to end up to the "Place order" button.

### Verifying it works

```bash
npm test          # 30 unit tests over the business rules
npm run typecheck # tsc --noEmit
npm run build     # production build
```

Try the currency engine live:

```bash
curl 'http://localhost:3000/api/geo?country=KR&amount=189'
# -> {"country":"KR","currency":"KRW","converted":{"formatted":"₩257,300", ...}}
```

---

## Repository structure

```
vemporium/
├── prisma/
│   ├── schema.prisma          # data model (catalog, avatars, supply chain, orders)
│   └── seed.ts                # idempotent: 5 suppliers, 7 products, 42 SKUs
├── docs/
│   ├── ARCHITECTURE.md
│   └── PRD.md
├── src/
│   ├── app/
│   │   ├── layout.tsx                 # geo resolution + market provider + chrome
│   │   ├── page.tsx                   # landing: hero, category nav, featured
│   │   ├── globals.css
│   │   ├── catalog/page.tsx           # Screen 2 — category / catalog
│   │   ├── product/[slug]/page.tsx    # Screen 3 — PDP
│   │   ├── fitting-room/page.tsx      # Screen 2b — virtual fitting studio
│   │   ├── cart/page.tsx
│   │   ├── checkout/page.tsx          # Screen 4 — localised checkout
│   │   ├── vendor/page.tsx            # Screen 5 — restock dispatch dashboard
│   │   └── api/
│   │       ├── geo/route.ts            # GeoIP + multi-currency
│   │       ├── orders/route.ts         # create PENDING_PAYMENT order
│   │       └── webhooks/order/route.ts # order.paid -> stock -> PO -> dispatch
│   ├── components/
│   │   ├── shell/
│   │   │   ├── GeoHeader.tsx           # geo-banner + market selector
│   │   │   ├── SiteHeader.tsx          # nav + cart badge
│   │   │   └── MoneyProvider.tsx       # reactive local-currency formatting
│   │   ├── catalog/CatalogGrid.tsx     # search + facets + cards
│   │   ├── product/ProductPanels.tsx   # size match, size picker, pricing, add-to-cart
│   │   ├── cart/CartView.tsx
│   │   ├── checkout/CheckoutView.tsx   # delivery -> payment -> review
│   │   ├── vendor/VendorDashboard.tsx  # replenishment decision + dispatch payload
│   │   └── fitting-room/
│   │       ├── FittingRoomPage.tsx     # page shell + camera presets
│   │       ├── FittingRoomCanvas.tsx   # <Canvas>, lights, turntable, orbit
│   │       ├── ParametricAvatar.tsx    # body mesh from measurements
│   │       ├── Garment.tsx             # drape shells + trim per garment family
│   │       ├── AvatarControls.tsx      # sliders, swatches, units, size guidance
│   │       └── GarmentPicker.tsx       # wardrobe rail
│   ├── lib/
│   │   ├── sizing.ts           # body params -> size recommendation
│   │   ├── fit.ts              # fit confidence score (PDP widget)
│   │   ├── units.ts            # metric/imperial conversion
│   │   ├── currency.ts         # currency table, country->currency/locale maps
│   │   ├── markets.ts          # country/language reference data (server-safe)
│   │   ├── fx.ts               # rate fetching, caching, rounding, formatting
│   │   ├── geo.ts              # market resolution
│   │   ├── duties.ts           # landed cost (duty, VAT, de minimis)
│   │   ├── payments.ts         # per-market payment routing
│   │   ├── inventory.ts        # replenishment rules (pure, tested)
│   │   ├── dispatch.ts         # WhatsApp + email dispatch
│   │   ├── catalog.ts          # sample catalog
│   │   ├── db.ts               # Prisma singleton
│   │   └── business-logic.test.ts
│   ├── store/
│   │   ├── avatar-store.ts     # Zustand: avatar + garment state
│   │   ├── cart-store.ts       # Zustand + persist: cart
│   │   └── market-store.ts     # Zustand + persist: country/currency/units
│   └── types/optional-modules.d.ts
```

---

## How the virtual fitting room works

The avatar is **generated**, not loaded. `ParametricAvatar` turns six
measurements into renderable proportions:

1. Girths (bust/chest, waist, hip) become radii (`cm / 2 / 100`).
2. Anthropometric ratios set shoulder width, limb girths and the leg-to-height
   ratio — a taller lean person does not get tree-trunk arms.
3. A lathe profile through those radii becomes the torso mesh.
4. `Garment.tsx` builds the clothing from the **same** metrics, adding comfort
   ease and a flare curve. This is why a kurta looks wider on a 96cm chest than
   an 82cm one, and why hems clear the feet.

Garment families map to the PRD's draping types:

- `WRAPPED` — saree, dupatta: pleated front panel, pallu, blouse block
- `RIGID` — kurta, sherwani: suppressed waist, placket, buttons, collar
- `FLOWING` — lehenga: conical flare, kantha border bands, waistband

### Swapping in real 3D models

`ParametricAvatar` and `GarmentMesh` take `BodyParams` and `GarmentSpec`.
Replace the procedural geometry with a loaded `.glb` and feed the same inputs
into the rig's morph targets — no caller changes. `Product.modelAssetUrl` and
`Product.drapingProfile` are already in the schema for this.

---

## Multi-currency design

Three rules hold the system together:

1. **USD is the only stored price.** Local currency is a read-time concern.
   `Order.fxRateAtOrder` records the rate actually charged, so a later FX move
   never rewrites history.
2. **Rates are cached, not fetched per render.** One-hour TTL in Redis (or an
   in-process map in dev). If the provider fails we serve the bundled table and
   flag `stale: true` rather than failing checkout.
3. **Round like a local.** KRW and JPY have no minor unit and round to 100s;
   USD keeps cents. Zero-decimal currencies are never multiplied by 100 when
   building PSP amounts.
4. **The server value wins the first paint.** `MoneyProvider` resolves as
   "manual override if set, else the server-detected market". It deliberately
   does *not* fall back to the store's persisted default, because that default
   is `{ currency: 'USD' }` and would briefly show a Korean visitor a dollar
   price. Reference data lives in `lib/markets.ts`, not in a `'use client'`
   module — Next turns client-module exports into client references, so plain
   data imported by a server component silently arrives as `undefined`.

---

## Automated supply chain

`POST /api/webhooks/order` on a successful payment:

1. Verifies an HMAC signature (constant-time compare).
2. Checks `WebhookEvent` for the provider event id — **providers retry, and a
   duplicate delivery must never double-decrement stock.**
3. Decrements inventory. Online and physical retail share one `stockLevel`
   row, so the channels cannot oversell each other.
4. Evaluates replenishment rules. A SKU with an open purchase order is skipped
   — the guard that stops a Diwali spike from sending forty identical WhatsApp
   messages to a Varanasi workshop.
5. Creates a purchase order and dispatches by WhatsApp, then email.
6. **Never throws on dispatch failure.** The order is already paid; the PO
   stays `DRAFT` for a retry sweep.

Without Twilio/Resend credentials the dispatcher logs the exact message it
would have sent, so the flow is demoable offline.

---

## Configuration

Every integration is optional in development — see `.env.example`.

| Variable | Purpose | Without it |
| --- | --- | --- |
| `DATABASE_URL` | Postgres | Orders/inventory unavailable; catalog + fitting room work |
| `REDIS_URL` | Rate + geo cache | Falls back to an in-process map |
| `IPINFO_TOKEN` | Country lookup | Uses edge headers; otherwise honest USD default |
| `FX_API_URL` | Mid-market rates | Bundled fallback table, `stale: true` |
| `TWILIO_*` | WhatsApp dispatch | Message logged instead of sent |
| `RESEND_API_KEY` | Email dispatch | Email logged instead of sent |
| `SUPPLIER_DISPATCH_SECRET` | Webhook signing | Accepts unsigned only outside production |

---

## Roadmap

**Phase 2** — auth and account, avatar persistence across sessions, real GLB
models with a CDN pipeline, Stripe capture, order confirmation email, and a
writable vendor portal (the dashboard is read-only today).

**Phase 3** — live WhatsApp Business API + supplier acknowledgements, regional
fulfilment, returns flow, i18n (ko, ja, fr, es — the locale plumbing is in
place, the strings are not translated yet), PWA and offline avatar.

---

## Security & compliance notes

- Body measurements are sensitive personal data (GDPR Art. 9). `AvatarProfile`
  is self-hosted and must never be synced to third-party analytics.
- Payments target PCI-DSS scope reduction: card data goes straight to the PSP,
  never through this application.
- Duty bands in `duties.ts` are an approximation for demonstration, not tax
  advice. Replace with a proper duty engine and confirm rates with a customs
  broker before launch.
