import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { AppConfigService } from '../config/config.service';
import { AppConfigModule } from '../config/config.module';
import { NotifyProducer, NOTIFY_QUEUE } from './notify.producer';
import { NotifyProcessor } from './notify.processor';

/**
 * BullMQ wiring. Connection derived from REDIS_URL. The queue + in-process worker
 * live together for MVP; extract the worker to its own process at scale (docs/17).
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => {
        const url = new URL(config.get('REDIS_URL'));
        return {
          connection: {
            host: url.hostname,
            port: Number(url.port || 6379),
          },
        };
      },
    }),
    BullModule.registerQueue({ name: NOTIFY_QUEUE }),
  ],
  providers: [NotifyProducer, NotifyProcessor],
  exports: [NotifyProducer],
})
export class JobsModule {}
