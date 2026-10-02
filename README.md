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
| Auth (email + password, DB sessions) | Working — bcrypt, 8h sessions, revocable |
| GDPR export / erase (Art. 15/17/20) | Working — hard delete, orders retained anonymised |
| Real `.glb` avatar models | Supported — `AvatarAsset` loads GLB rigs, falls back to procedural |
| Real `.glb` garment models | Not started — procedural draping stands in |
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
    |   |       |-- AvatarAsset.tsx        # GLB loader + procedural fallback
│   │       ├── Garment.tsx             # drape shells + trim per garment family
│   │       ├── AvatarControls.tsx      # sliders, swatches, units, size guidance
│   │       └── GarmentPicker.tsx       # wardrobe rail
│   ├── lib/
│   │   ├── sizing.ts           # body params -> size recommendation
│   │   ├── fit.ts              # fit confidence score (PDP widget)
    |   |   |-- rig.ts              # GLB bone scaling (pure, tested)
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

`AvatarAsset` already implements the GLB path: pass `modelUrl` to
`FittingRoomCanvas` and a `.glb` rig is loaded, cloned and driven by the same
measurements. It **scales bones rather than the mesh** — a uniform
`scale={[waist, 1, hips]}` stretches the head and arms with the torso and
renders anyone with different bust and hip as a barrel. Bone scaling is
normalised against the rig's rest pose (`src/lib/rig.ts`, with its own tests).

The app degrades safely at every step: no URL, a 404, or a rig with no
recognisable bones all fall back to the procedural body. Artist contract, rest
measurements and export settings are in `docs/GLB-PIPELINE.md`.

Garment meshes overlay the procedural drape shell rather than replacing it, so
hems stay correctly placed against a changing body. `Product.modelAssetUrl`
and `Product.drapingProfile` are already in the schema.

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

## Accounts, avatars and GDPR

Body measurements are **special-category personal data** (GDPR Art. 9), so the
account layer is built around that rather than treating it as a convenience
profile.

**Auth.** Credentials provider with bcrypt (cost 12). Two decisions worth
knowing:

- **JWT sessions with server-side revocation.** Auth.js will not pair the
  Credentials provider with `strategy: "database"` — it throws
  `UnsupportedStrategy` at sign-in. Password login *forces* JWTs, so
  database-session revocation was never available. It is recovered with
  `User.sessionVersion`: the session callback re-reads the user on every
  request and discards the session if the account is gone or the version moved,
  so erasure still signs the shopper out immediately rather than at token
  expiry. `SESSION_STRATEGY` is a named constant with a test, because this was
  originally configured wrong and the failure was invisible to the build.
- **Sign-in failure is timing-indistinguishable.** A missing user still runs a
  bcrypt comparison against a dummy hash, so "no such account" and "wrong
  password" take the same time. Without it, response latency is a free
  account-enumeration oracle.

**Avatar persistence.** `GET/POST/DELETE /api/avatars`. Every handler resolves
the user from the **session**, never the request body — accepting a `userId`
from the client would make each route an IDOR over Art. 9 data. Measurements
are range-checked and clamped on the way in.

**Order linking.** `POST /api/orders` resolves the session and attaches
`userId`. Guest checkout still works but requires an email — an order with no
owner and no email could never be delivered or refunded. `idempotencyKey` makes
a double-clicked "Place order" return the original order rather than creating a
second one.

**Fitting snapshot.** `Order.fittingSnapshot` freezes the buyer's measurements
at purchase time. A foreign key to the avatar is not enough: the shopper edits
their profile next month, and a return three months later would be judged
against the wrong body. Measurements only — no skin tone or hair, because that
column outlives the account it came from.

**Data rights.** `GET /api/account` exports everything (Art. 15/20);
`DELETE /api/account` erases (Art. 17). Erasure is a **hard delete** — a
soft-deleted row is still personal data under GDPR. Sales records are retained
because tax law requires it, but are re-parented to a tombstone account first,
so the retained record is no longer personal data. That trade-off is stated to
the customer in `RETENTION_NOTICE` rather than left implicit.

Erasure also **scrubs `fittingSnapshot`** while keeping the money. Tax law
requires the transaction, not the customer's waist measurement — so without
that, "erase my account" would leave body data on disk indefinitely and the
retention notice would be a lie.

The delete endpoint requires an explicit `{"confirm":"DELETE"}` body. A stray
double-click should not be enough to destroy someone's saved avatars.

---

## Automated supply chain

Two distinct supplier messages, because they are genuinely different events:

| Message | Trigger | Says |
| --- | --- | --- |
| **Order alert** | Every paid order | "Prepare these N units for export" |
| **Reorder PO** | Stock below threshold | "Make 30 more units" |

Conflating them is how you end up telling a workshop to *make* 30 units for an
order for 1. Order alerts are also **grouped by supplier**, so a karigah who
made three items gets one message, not three — three messages is three
interruptions, and the replies no longer map to lines.

Both use a numeric reply protocol (`1` = accepted, `2` = out of fabric) because
a free-text "ok thanks" is not machine-readable, and a workshop that is out of
fabric must be able to say so in one tap.

`POST /api/webhooks/stripe` on `payment_intent.succeeded`:

1. Verifies the Stripe signature against the **raw body** (no dev-mode bypass).
2. Ignores every event type except `payment_intent.succeeded`.
3. Guards the transition with a conditional `updateMany` on
   `status === PENDING_PAYMENT`. Concurrent retries race on the row lock and
   exactly one wins; the losers get a 200 so Stripe stops retrying.
4. Decrements stock **conditionally** (`stockLevel >= qty`), so two orders racing
   for the last unit cannot drive it negative. A shortfall is recorded but does
   **not** block fulfilment — the money is captured, and refusing would be worse.
5. Queues a `DispatchOutbox` row per supplier, then sends **after** the
   transaction commits.

Without Twilio/Resend credentials the dispatcher logs the exact message it
would have sent, so the flow is demoable offline.

### Notifications are not in the transaction

`markPaidAndFulfil()` commits the status change, the stock decrement and the
outbox rows atomically, and *then* sends the WhatsApp messages. Sending inside
the transaction is wrong in both directions:

- send, then roll back → a karigah has been told to start work on an order that
  does not exist;
- commit, then send fails → the customer has paid and nobody told the workshop,
  so the order rots in `PENDING_PAYMENT` forever.

A failed dispatch leaves the outbox row `FAILED` for a retry sweep. It never
un-pays an order. The trade is deliberate: at-least-once notification in exchange
for never telling a supplier about a rolled-back order.

### Deprecated: `POST /api/webhooks/order`

This endpoint used to accept `order.created` and `order.paid` and run the same
fulfilment. One payment could therefore decrement stock twice and message a
workshop twice — and two implementations of a state transition will drift. The
path was **deleted**, not merely discouraged:

- `order.created` / `order.paid` → `410 Gone`, naming `/api/webhooks/stripe`
- `PAID` is not settable through it at all, so it cannot become a side door
- still handles `order.refunded` and manual corrections, and never touches stock
  or contacts a supplier

---

### Stripe Elements

Checkout is a four-step flow — delivery → method → review → pay. The last step
mounts `<PaymentElement/>`, which renders whatever methods Stripe has enabled for
the intent (cards, KakaoPay, Klarna, wallets) localised to the shopper. We pass a
client secret and let Stripe decide; we do not maintain that list.

`stripe.confirmPayment()` uses `redirect: 'if_required'`, so a **card** payment
settles in place with no navigation and the result renders directly. Redirect
methods still leave for the provider and return to
`/orders/[id]/confirmation`.

**The confirmation screen polls, and it has to.** The shopper usually arrives
*before* our webhook has run: Stripe redirects the instant payment succeeds, and
the signed webhook is a separate request that may be seconds behind. So
`PENDING_PAYMENT` on arrival is the **normal** case for a successful payment, not
a failure, and the screen says so instead of showing an error. Polling uses a
backoff, stops on a terminal status, and always stops at the cap.

Polling rather than WebSockets/SSE: this is a serverless deployment, where
long-lived connections are expensive to hold open for one status field.

### The checkout token never goes in a URL

The spec for the confirmation route was `return_url` pointing at
`?token=[checkoutToken]`. That is undone on purpose:

- `confirmParams.return_url` carries only `/orders/[id]/confirmation`
- the token is held in `sessionStorage` and sent as an `x-checkout-token` **header**
- authorisation reads the header only; a `token` query parameter is ignored

A bearer credential in a query string ends up in browser history, in the
`Referer` header sent to every third-party script on the page, in access logs and
in analytics. `sessionStorage` is tab-scoped and self-clearing, which also suits
a credential that authorises exactly one checkout attempt.

### One authorisation rule, two endpoints

`src/lib/order-access.ts` exports `orderAccessWhere()` — a Prisma `where`
predicate, not a fetch helper, so the rule can be unit tested without a database.
Both `/api/checkout/create-intent` and `/api/orders/[id]` use it, so "can I pay
for this order" and "can I look at this order" cannot drift apart.

A signed-in session takes precedence over a token, so a signed-in shopper
presenting someone else's token is still scoped to their own orders.

Without a `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` the payment step renders an
explicit "payments not configured" panel instead of failing silently, and the
order is left `PENDING_PAYMENT` rather than marked paid.

## Configuration

Every integration is optional in development — see `.env.example`.

| Variable | Purpose | Without it |
| --- | --- | --- |
| `DATABASE_URL` | Postgres | Orders/inventory unavailable; catalog + fitting room work |
| `AUTH_SECRET` | Signs session cookies | Falls back to a **published dev secret** — never in production |
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