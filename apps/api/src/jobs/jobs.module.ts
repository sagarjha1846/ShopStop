import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { AppConfigService } from '../config/config.service';
import { AppConfigModule } from '../config/config.module';
import { NotifyProducer, NOTIFY_QUEUE } from './notify.producer';
import { NotifyProcessor } from './notify.processor';
import { MediaScanProducer, MEDIA_SCAN_QUEUE } from './media-scan.producer';
import { MediaScanProcessor } from './media-scan.processor';

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
    BullModule.registerQueue({ name: NOTIFY_QUEUE }, { name: MEDIA_SCAN_QUEUE }),
  ],
  providers: [NotifyProducer, NotifyProcessor, MediaScanProducer, MediaScanProcessor],
  exports: [NotifyProducer, MediaScanProducer],
})
export class JobsModule {}
