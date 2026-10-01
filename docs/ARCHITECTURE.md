# Architecture

Phase 1 is a single Next.js application. That is a deliberate choice, not a
shortcut: the three MVP features (fitting room, currency, supply chain) share
no hot path, and splitting them into microservices on day one would cost more in
network calls and deployment complexity than it saves. The seams for splitting
are documented at the bottom.

## Request flows

### Landing page (first paint)

```
Browser ──▶ Next.js server component (src/app/page.tsx)
              │
              ├─▶ resolveGeo()      edge header ─▶ cookie ─▶ ipinfo ─▶ USD default
              ├─▶ getRate()         Redis (1h TTL) ─▶ live feed ─▶ bundled table
              └─▶ calculateLandedCost()  duty band by destination
              │
              └──▶ HTML already priced in the visitor's currency
```

Pricing happens on the **server** so the first paint is already correct. A
client-side effect that swaps `$189` for `₩257,300` after hydration is a
visible flash, and on a storefront that reads as a bug.

### Virtual fitting room

```
User drags "waist" slider
   │
   ├─▶ Zustand setBody()          60fps, no React tree re-render
   │
   └─▶ R3F subscribers
         ├─ deriveMetrics(body)   memoised on the body object
         ├─ ParametricAvatar      new lathe + limb geometry
         └─ GarmentMesh           new drape shell from the same metrics
```

Three deliberate performance choices:

- **Zustand, not Context.** A slider writes every frame; a context update would
  re-render the entire panel tree each tick.
- **Turntable angle lives outside React state** (`stageRotation` in
  `FittingRoomCanvas.tsx`). A 60fps `setState` would re-render the canvas tree
  60 times a second.
- **`frameloop="demand"`** when auto-rotate is off, so an idle fitting room
  costs no CPU — this is the mobile battery win.
- `dpr` capped at `[1, 2]`; a 3x phone display would otherwise spend most of
  the frame budget on fill rate for no visible gain.

### Order → supply chain

```
Payment provider
   │  POST /api/webhooks/order   (HMAC signed)
   ▼
WebhookEvent (idempotency check)  ── duplicate ─▶ return early
   │
   ▼
For each OrderItem
   ├─ Inventory.stockLevel -= qty        (shared with retail; clamped at 0)
   ├─ deriveStatus()                     IN_STOCK / LOW / OUT_OF_STOCK
   ├─ evaluateReorder()
   │     ├─ no supplier            ─▶ skip
   │     ├─ PO already in flight   ─▶ skip   ◀── Diwali-spike guard
   │     └─ below threshold        ─▶ create PO
   └─ dispatchPurchaseOrder()      WhatsApp ─▶ email
         ├─ all channels ok ─▶ PO = SENT
         └─ any failure     ─▶ PO = DRAFT (retry sweep picks it up)
```

## Why these boundaries

**Pure business logic is separated from I/O.** `inventory.ts` and `sizing.ts`
export pure functions with no database or network dependency. That is what
makes the money-critical rules — when to reorder a workshop, which size a
customer gets — testable without a sandbox, and it is why 30 tests run in
half a second.

**Dispatch never throws.** The order is already paid. A WhatsApp outage must not
roll back a sale, so `dispatch.ts` returns a result object and the caller
decides. This is the difference between a lost order and a delayed reorder.

**Optional dependencies are genuinely optional.** Redis and the FX provider are
both reached through guards that degrade to working defaults. The app installs
and runs with `npm install` alone, and `next build` emits no warnings about
missing modules.

## Data model notes

- `Product.basePriceUsd` is the only stored price. Never store a converted one.
- `Inventory.stockLevel` is **shared** across channels. `reservedOnline` and
  `reservedRetail` exist for a later soft-reservation model, but the committed
  stock is one number so an in-store sale and a web sale cannot oversell each
  other.
- `WebhookEvent` is the idempotency ledger. Payment providers retry
  aggressively; without it, a retried webhook silently double-decrements stock.
- `PurchaseOrder.status` encodes the supplier's real vocabulary
  (`IN_PRODUCTION`, `DISPATCHED`), so the vendor portal in Phase 2 is a view
  over existing state rather than a new subsystem.

## Scaling to microservices (when justified)

Split these out when they have independent scaling or release needs — not before:

| Service | Trigger to extract |
| --- | --- |
| **Supplier dispatch worker** | First, once PO volume makes webhook latency matter. Move to a queue (SQS) so a Twilio outage cannot slow checkout. |
| **3D asset pipeline** | When GLB authoring starts. Mesh optimisation (Draco/KTX2) and CDN upload is a batch workload with no business logic. |
| **FX/rates service** | If more products need live rates. Currently a cached lookup inside the app. |
| **Commerce API** | Only if a POS or marketplace integration needs the catalog independently. |

Do **not** extract the catalog or the avatar — they are tightly coupled to the
rendering path and splitting them adds latency exactly where the PRD demands
under 2.5s.

## Known constraints

- Duty bands are indicative, not authoritative. Production needs a real duty
  engine and customs-broker review, especially for the EU's import VAT
  reform.
- The FX feed is a free tier with hourly granularity. Fine for display pricing;
  settle final amounts against the PSP's own rate at capture.
- Procedural draping approximates cloth. It reads correctly for silhouette and
  length, but it is not a substitute for authored meshes or real-time cloth
  simulation.
