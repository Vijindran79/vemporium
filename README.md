# Vemporium

Global marketplace for authentic Indian ethnic wear with an interactive **3D
virtual fitting room**, automatic local-currency pricing by geolocation, and
automated supplier replenishment back to Indian workshops.

Built from the PRD v1.0. Phase 1 (MVP) is implemented and running.

---

## What works today

| Area | Status |
| --- | --- |
| Parametric 3D avatar (women / men / kids) | Working — generated from measurements, not a fixed mesh |
| Garment draping (wrapped / rigid / flowing) | Working — saree, lehenga, kurta, kurti, sherwani, dupatta |
| 360° rotation, zoom, side-by-side compare | Working |
| Size recommendation from body parameters | Working — 30 unit tests covering the rules |
| GeoIP market detection | Working — edge headers → cookie → ipinfo → honest USD fallback |
| Multi-currency pricing (22 currencies) | Working — live rates, 1h cache, native rounding |
| Duties / landed-cost estimate at checkout | Working — de minimis, duty, import VAT, shipping |
| Localised payment routing | Working — KakaoPay, PayPay, iDEAL, Klarna, UPI, Stripe, PayPal |
| Order webhook → decrement stock → auto purchase order | Implemented — needs Postgres to exercise |
| WhatsApp / email dispatch to suppliers | Implemented — simulated mode without credentials |
| Vendor portal | Not started (Phase 2) |
| Checkout UI / cart | Not started (Phase 2) |
| Real `.glb` garment models | Not started — procedural draping stands in |

---

## Quick start

```bash
npm install
cp .env.example .env        # then set DATABASE_URL
npm run dev                 # http://localhost:3000
```

The fitting room and the multi-currency engine work **without a database** —
they read from the bundled catalog. Postgres is only needed for orders,
inventory and the supplier pipeline.

With a database:

```bash
npm run db:push
npm run db:seed
```

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
└── src/
    ├── app/
    │   ├── layout.tsx
    │   ├── page.tsx                    # landing, server-rendered in local currency
    │   ├── globals.css
    │   ├── fitting-room/page.tsx
    │   └── api/
    │       ├── geo/route.ts            # GeoIP + multi-currency
    │       └── webhooks/order/route.ts # order.paid -> stock -> PO -> dispatch
    ├── components/fitting-room/
    │   ├── FittingRoomPage.tsx        # page shell
    │   ├── FittingRoomCanvas.tsx      # <Canvas>, lights, turntable, orbit controls
    │   ├── ParametricAvatar.tsx       # body mesh derived from measurements
    │   ├── Garment.tsx                # draping shells + trim per garment family
    │   ├── AvatarControls.tsx         # sliders, swatches, size guidance
    │   └── GarmentPicker.tsx          # catalog rail
    ├── lib/
    │   ├── sizing.ts           # body params -> size recommendation
    │   ├── currency.ts         # currency table, country->currency/locale maps
    │   ├── fx.ts               # rate fetching, caching, rounding, formatting
    │   ├── geo.ts              # market resolution
    │   ├── duties.ts           # landed cost (duty, VAT, de minimis)
    │   ├── payments.ts         # per-market payment routing
    │   ├── inventory.ts        # replenishment rules (pure, tested)
    │   ├── dispatch.ts         # WhatsApp + email dispatch
    │   ├── catalog.ts          # sample catalog
    │   ├── db.ts               # Prisma singleton
    │   └── business-logic.test.ts
    ├── store/avatar-store.ts   # Zustand: avatar + garment state
    └── types/optional-modules.d.ts
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

**Phase 2** — cart and checkout UI, auth, avatar persistence, vendor portal,
real GLB models with a CDN pipeline, Stripe integration, order email.

**Phase 3** — live WhatsApp Business API + supplier acknowledgements, regional
fulfilment, returns flow, i18n (ko, ja, fr, es), PWA and offline avatar.

---

## Security & compliance notes

- Body measurements are sensitive personal data (GDPR Art. 9). `AvatarProfile`
  is self-hosted and must never be synced to third-party analytics.
- Payments target PCI-DSS scope reduction: card data goes straight to the PSP,
  never through this application.
- Duty bands in `duties.ts` are an approximation for demonstration, not tax
  advice. Replace with a proper duty engine and confirm rates with a customs
  broker before launch.
