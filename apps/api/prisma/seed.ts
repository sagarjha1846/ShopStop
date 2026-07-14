/**
 * Seed: category tree with per-category attribute schemas (the data-driven core),
 * default feature flags, and a demo admin in non-production. Idempotent (upserts).
 */
import { PrismaClient, type Prisma } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

type AttrField = {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'boolean';
  required?: boolean;
  options?: string[];
  unit?: string;
};

type CategorySeed = {
  slug: string;
  name: string;
  icon?: string;
  attributeSchema?: { fields: AttrField[] };
  children?: CategorySeed[];
};

// A representative slice of the category-agnostic tree. Adding verticals later is
// pure data — no code change — which is the whole point of the design.
const CATEGORIES: CategorySeed[] = [
  {
    slug: 'electronics',
    name: 'Electronics',
    icon: 'cpu',
    children: [
      {
        slug: 'mobile-phones',
        name: 'Mobile Phones',
        attributeSchema: {
          fields: [
            { key: 'brand', label: 'Brand', type: 'text', required: true },
            { key: 'model', label: 'Model', type: 'text', required: true },
            {
              key: 'storage',
              label: 'Storage',
              type: 'select',
              options: ['32GB', '64GB', '128GB', '256GB', '512GB', '1TB'],
            },
            { key: 'ram', label: 'RAM', type: 'select', options: ['3GB', '4GB', '6GB', '8GB', '12GB', '16GB'] },
          ],
        },
      },
      { slug: 'laptops', name: 'Laptops' },
      { slug: 'audio', name: 'Audio & Headphones' },
    ],
  },
  {
    slug: 'vehicles',
    name: 'Vehicles',
    icon: 'car',
    children: [
      {
        slug: 'cars',
        name: 'Cars',
        attributeSchema: {
          fields: [
            { key: 'make', label: 'Make', type: 'text', required: true },
            { key: 'model', label: 'Model', type: 'text', required: true },
            { key: 'year', label: 'Year', type: 'number', required: true },
            { key: 'kmDriven', label: 'KM Driven', type: 'number', unit: 'km' },
            {
              key: 'fuel',
              label: 'Fuel',
              type: 'select',
              options: ['Petrol', 'Diesel', 'CNG', 'Electric', 'Hybrid'],
            },
            {
              key: 'transmission',
              label: 'Transmission',
              type: 'select',
              options: ['Manual', 'Automatic'],
            },
          ],
        },
      },
      { slug: 'bikes', name: 'Bikes & Scooters' },
    ],
  },
  {
    slug: 'home-furniture',
    name: 'Home & Furniture',
    icon: 'sofa',
    children: [
      { slug: 'furniture', name: 'Furniture' },
      { slug: 'appliances', name: 'Appliances' },
    ],
  },
  {
    slug: 'real-estate',
    name: 'Real Estate',
    icon: 'home',
    children: [
      {
        slug: 'flats-for-sale',
        name: 'Flats for Sale',
        attributeSchema: {
          fields: [
            { key: 'bhk', label: 'BHK', type: 'select', options: ['1', '2', '3', '4', '5+'], required: true },
            { key: 'areaSqft', label: 'Area', type: 'number', unit: 'sqft', required: true },
            { key: 'furnished', label: 'Furnished', type: 'boolean' },
          ],
        },
      },
      { slug: 'rentals', name: 'Rentals' },
    ],
  },
  {
    slug: 'fashion',
    name: 'Fashion',
    icon: 'shirt',
    children: [
      { slug: 'clothing', name: 'Clothing' },
      { slug: 'watches', name: 'Watches' },
    ],
  },
  {
    slug: 'services',
    name: 'Services',
    icon: 'wrench',
    children: [
      { slug: 'home-services', name: 'Home Services' },
      { slug: 'tutoring', name: 'Tutoring' },
    ],
  },
  { slug: 'books', name: 'Books', icon: 'book' },
  { slug: 'collectibles', name: 'Collectibles & Art', icon: 'palette' },
];

async function upsertCategory(node: CategorySeed, parentId: string | null, sort: number): Promise<void> {
  const attributeSchema = (node.attributeSchema ?? {}) as Prisma.InputJsonValue;
  const cat = await prisma.category.upsert({
    where: { slug: node.slug },
    update: { name: node.name, icon: node.icon, parentId, attributeSchema, sortOrder: sort },
    create: { slug: node.slug, name: node.name, icon: node.icon, parentId, attributeSchema, sortOrder: sort },
  });
  let i = 0;
  for (const child of node.children ?? []) {
    await upsertCategory(child, cat.id, i++);
  }
}

async function main(): Promise<void> {
  let sort = 0;
  for (const root of CATEGORIES) {
    await upsertCategory(root, null, sort++);
  }
  console.log(`Seeded categories (${CATEGORIES.length} roots).`);

  const flags = [
    { key: 'payments.escrow', enabled: false },
    { key: 'search.opensearch', enabled: false },
    { key: 'listings.boost', enabled: false },
    { key: 'fraud.ml', enabled: false },
  ];
  for (const f of flags) {
    await prisma.featureFlag.upsert({ where: { key: f.key }, update: {}, create: f });
  }
  console.log(`Seeded ${flags.length} feature flags.`);

  if (process.env.NODE_ENV !== 'production') {
    const email = 'admin@shopstop.local';
    const passwordHash = await argon2.hash('AdminPass123!', { type: argon2.argon2id });
    await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        passwordHash,
        role: 'ADMIN',
        emailVerifiedAt: new Date(),
        profile: { create: { handle: 'shopstop-admin', displayName: 'ShopStop Admin' } },
        trustScore: { create: { score: 100 } },
      },
    });
    console.log(`Seeded demo admin: ${email} / AdminPass123!`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
