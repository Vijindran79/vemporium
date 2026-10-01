/**
 * Database seed.
 *
 * Idempotent: safe to re-run. Products are upserted by slug, suppliers by
 * name, so re-seeding refreshes catalog data without duplicating anything.
 *
 *   npm run db:push && npm run db:seed
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SUPPLIERS = [
  { name: 'Varanasi Zari Works', city: 'Varanasi', state: 'Uttar Pradesh', contactName: 'Ramesh Kumar', whatsappE164: '+919876543210', email: 'orders@varanasizari.in', leadTimeDays: 28 },
  { name: 'Chanderi Weavers Collective', city: 'Chanderi', state: 'Madhya Pradesh', contactName: 'Sunita Bai', whatsappE164: '+919876543211', email: 'hello@chanderiweavers.in', leadTimeDays: 35 },
  { name: 'Lucknow Chikankari House', city: 'Lucknow', state: 'Uttar Pradesh', contactName: 'Imran Khan', whatsappE164: '+919876543212', email: 'sales@chikankarihouse.in', leadTimeDays: 21 },
  { name: 'Bagru Print Studio', city: 'Bagru', state: 'Rajasthan', contactName: 'Arjun Singh', whatsappE164: '+919876543213', email: 'studio@bagruprint.in', leadTimeDays: 25 },
  { name: 'Jaipur Embroidery Unit', city: 'Jaipur', state: 'Rajasthan', contactName: 'Priya Sharma', whatsappE164: '+919876543214', email: 'export@jaipurembroidery.in', leadTimeDays: 30 },
];

// Mirrors src/lib/catalog.ts so the DB and the demo catalog stay in step.
const PRODUCTS = [
  { slug: 'banarasi-silk-saree', title: 'Banarasi Silk Saree', description: 'Handwoven in Varanasi from mulberry silk with real zari brocade. Traditional kadhwa weave with a temple border.', basePriceUsd: 189, category: 'SAREE' as const, fabric: 'BANARASI_BROCATTE' as const, weave: 'HANDLOOM' as const, workType: 'ZARI' as const, drapingType: 'WRAPPED' as const, colourway: 'Deep Maroon / Gold Zari', originCity: 'Varanasi', tags: ['wedding', 'handloom', 'zari'], supplier: 'Varanasi Zari Works', stock: 24 },
  { slug: 'chanderi-saree', title: 'Chanderi Silk Saree', description: 'Featherweight Chanderi from Madhya Pradesh, sheer enough to read as gold in sunlight.', basePriceUsd: 124, category: 'SAREE' as const, fabric: 'CHANDERI' as const, weave: 'HANDLOOM' as const, workType: 'PLAIN' as const, drapingType: 'WRAPPED' as const, colourway: 'Antique Gold / Maroon Border', originCity: 'Chanderi', tags: ['festive', 'handloom'], supplier: 'Chanderi Weavers Collective', stock: 40 },
  { slug: 'flared-lehenga', title: 'Flared Lehenga Set', description: 'Six-metre flare with a hand-embroidered kantha border, structured blouse and net dupatta.', basePriceUsd: 265, category: 'LEHENGA' as const, fabric: 'GEORGETTE' as const, weave: 'POWERLOOM' as const, workType: 'EMBROIDERY' as const, drapingType: 'FLOWING' as const, colourway: 'Ruby Pink / Gold', originCity: 'Jaipur', tags: ['wedding', 'bridal'], supplier: 'Jaipur Embroidery Unit', stock: 12 },
  { slug: 'chikankari-kurta', title: 'Chikankari Cotton Kurta', description: 'Hand-embroidered Lucknow chikankari on breathable cotton, mandarin collar, side slits.', basePriceUsd: 68, category: 'KURTA' as const, fabric: 'COTTON' as const, weave: 'HANDLOOM' as const, workType: 'CHIKANKARI' as const, drapingType: 'RIGID' as const, colourway: 'Ivory / Sand', originCity: 'Lucknow', tags: ['everyday', 'handloom'], supplier: 'Lucknow Chikankari House', stock: 60 },
  { slug: 'silk-kurti', title: 'Raw Silk Kurti', description: 'Featherweight raw silk kurti, hand block printed in Bagru. Works with jeans or a lehenga.', basePriceUsd: 52, category: 'KURTI' as const, fabric: 'RAW_SILK' as const, weave: 'HANDLOOM' as const, workType: 'BLOCK_PRINT' as const, drapingType: 'RIGID' as const, colourway: 'Indigo / Cream', originCity: 'Bagru', tags: ['everyday', 'block-print'], supplier: 'Bagru Print Studio', stock: 55 },
  { slug: 'sherwani', title: 'Zari Sherwani', description: 'Structured brocade sherwani with a matching stole — made for weddings, built to be re-worn.', basePriceUsd: 320, category: 'SHERWANI' as const, fabric: 'SILK' as const, weave: 'JACQUARD' as const, workType: 'ZARI' as const, drapingType: 'RIGID' as const, colourway: 'Deep Purple / Gold', originCity: 'Lucknow', tags: ['wedding', 'menswear'], supplier: 'Varanasi Zari Works', stock: 8 },
  { slug: 'chiffon-dupatta', title: 'Chiffon Dupatta', description: 'Hand-rolled edge chiffon dupatta with a tassel finish, in jewel tones.', basePriceUsd: 38, category: 'DUPATTA' as const, fabric: 'CHIFFON' as const, weave: 'POWERLOOM' as const, workType: 'PLAIN' as const, drapingType: 'WRAPPED' as const, colourway: 'Teal / Gold', originCity: 'Surat', tags: ['everyday'], supplier: 'Jaipur Embroidery Unit', stock: 9 },
];

const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'] as const;

async function main() {
  // Suppliers, keyed by name so the script is safely re-runnable.
  const suppliers = new Map<string, string>();
  for (const s of SUPPLIERS) {
    const existing = await prisma.supplier.findFirst({ where: { name: s.name } });
    const row = existing
      ? await prisma.supplier.update({ where: { id: existing.id }, data: s })
      : await prisma.supplier.create({ data: s });
    suppliers.set(s.name, row.id);
  }
  console.log(`suppliers: ${suppliers.size}`);

  for (const p of PRODUCTS) {
    const supplierId = suppliers.get(p.supplier);

    const existing = await prisma.product.findUnique({ where: { slug: p.slug } });
    const product = existing
      ? await prisma.product.update({
          where: { slug: p.slug },
          data: {
            title: p.title,
            description: p.description,
            basePriceUsd: p.basePriceUsd,
            colourway: p.colourway,
            tags: p.tags,
            isPublished: true,
          },
        })
      : await prisma.product.create({
          data: {
            slug: p.slug,
            title: p.title,
            description: p.description,
            basePriceUsd: p.basePriceUsd,
            category: p.category,
            fabric: p.fabric,
            weave: p.weave,
            workType: p.workType,
            drapingType: p.drapingType,
            colourway: p.colourway,
            tags: p.tags,
            originCity: p.originCity,
            careInstructions: 'Dry clean only. Store folded in a muslin wrap, away from direct sunlight.',
            isPublished: true,
          },
        });

    // Variants + inventory. The threshold is deliberately low so the automated
    // reorder path is easy to demonstrate end to end.
    const perSize = Math.max(1, Math.round(p.stock / SIZES.length));
    for (const [i, size] of SIZES.entries()) {
      // colourHex is nullable, so it cannot be used in a compound unique
      // selector — resolve the variant explicitly instead.
      const found = await prisma.productVariant.findFirst({ where: { productId: product.id, sizeLabel: size } });
      const variant =
        found ?? (await prisma.productVariant.create({ data: { productId: product.id, sizeLabel: size, sizeCode: i + 1 } }));

      const stock = await prisma.inventory.findUnique({ where: { productVariantId: variant.id } });
      if (!stock) {
        await prisma.inventory.create({
          data: {
            productVariantId: variant.id,
            stockLevel: perSize,
            reorderThreshold: 4,
            reorderQuantity: 30,
            status: 'IN_STOCK',
            supplierId,
          },
        });
      }
    }
    console.log(`product: ${p.slug} (${SIZES.length} variants)`);
  }

  console.log('seed complete');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
