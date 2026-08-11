import { z } from 'zod';

/**
 * Environment contract. Validated at boot (fail fast on missing/invalid config).
 * Never read process.env directly outside this file — inject ConfigService instead.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  API_BASE_URL: z.string().url().default('http://localhost:4000'),
  WEB_BASE_URL: z.string().url().default('http://localhost:3000'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL: z.coerce.number().int().positive().default(2_592_000),
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{32,}$/, 'ENCRYPTION_KEY must be hex, >=16 bytes')
    .default('00000000000000000000000000000000'),

  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  EMAIL_FROM: z.string().default('ShopStop <no-reply@shopstop.local>'),

  S3_ENDPOINT: z.string().url().default('http://localhost:9000'),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('shopstop-media'),
  S3_ACCESS_KEY: z.string().default('shopstop'),
  S3_SECRET_KEY: z.string().default('shopstop-secret'),
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  CDN_BASE_URL: z.string().default('http://localhost:9000/shopstop-media'),

  RAZORPAY_KEY_ID: z.string().default('rzp_test_xxxxxxxx'),
  RAZORPAY_KEY_SECRET: z.string().default('xxxxxxxx'),
  RAZORPAY_WEBHOOK_SECRET: z.string().default('whsec_xxxxxxxx'),

  GOOGLE_CLIENT_ID: z.string().optional().default(''),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(''),

  RATE_LIMIT_WINDOW_SEC: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),

  // Platform take rate in basis points (200 = 2.00%). The business changes this
  // without a code change; 10_000 bps = 100% is the hard ceiling.
  PLATFORM_FEE_BPS: z.coerce.number().int().min(0).max(10_000).default(200),
  // Boost price per day, in minor units (₹49.00/day). Sponsored placement is
  // sold, not given away.
  BOOST_PRICE_PER_DAY_MINOR: z.coerce.number().int().min(0).default(4900),
  // Pro seller plan, minor units per 30-day period (₹799.00).
  SUBSCRIPTION_PRO_PRICE_MINOR: z.coerce.number().int().min(0).default(79900),
  // Card merchant-discount rate in basis points, used to estimate what the
  // gateway takes so net margin can be reported. This is a planning default —
  // replace it with the rate actually contracted with the gateway. UPI is
  // treated as zero-MDR (docs/16); see revenue.service.ts for the full map.
  MDR_CARD_BPS: z.coerce.number().int().min(0).max(10_000).default(200),

  OTP_TTL_SEC: z.coerce.number().int().positive().default(300),
  OTP_DEV_LOG: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
