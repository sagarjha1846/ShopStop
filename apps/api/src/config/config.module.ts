import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { validateEnv } from './env.schema';
import { AppConfigService } from './config.service';

// Re-export so existing imports of AppConfigService from this path keep working.
// Leaf services should import from './config.service' directly to avoid triggering
// ConfigModule.forRoot()'s env validation at import time (breaks isolated unit tests).
export { AppConfigService } from './config.service';

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
      envFilePath: ['.env', '../../.env'],
    }),
  ],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
