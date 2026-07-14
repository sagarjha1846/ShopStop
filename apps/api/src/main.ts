import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { HttpStatus, ValidationPipe, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { AppConfigService } from './config/config.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(AppConfigService);
  app.useLogger(app.get(Logger));

  // Security headers. CSP is enforced at the web/edge layer; API sends conservative defaults.
  app.use(
    helmet({
      contentSecurityPolicy: config.isProd ? undefined : false,
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  app.use(cookieParser());

  // API surface: /api/v1/*
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // CORS: allow the web origin with credentials (refresh cookie).
  app.enableCors({
    origin: [config.get('WEB_BASE_URL')],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });

  // Global validation: strip unknown props (mass-assignment defense), transform types.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
    }),
  );

  app.enableShutdownHooks();

  // OpenAPI docs (gated off in prod unless explicitly enabled).
  if (!config.isProd) {
    const doc = new DocumentBuilder()
      .setTitle('ShopStop API')
      .setDescription('Trust-first marketplace API')
      .setVersion('1.0.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, doc);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = config.get('API_PORT');
  await app.listen(port, '0.0.0.0');
  app.get(Logger).log(`API listening on :${port}`);
}

void bootstrap();
