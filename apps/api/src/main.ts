import './instrument';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { cloudflareClientIp } from './common/http/client-ip.middleware';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });

  // Default Express body-parser limit is 100KB. Kiosk signature PNGs from an
  // iPad routinely exceed this; raise both JSON and urlencoded limits so the
  // KioskService's own 2MB signature cap is the binding constraint.
  app.useBodyParser('json', { limit: '5mb' });
  app.useBodyParser('urlencoded', { limit: '5mb', extended: true });

  // Trust exactly 2 proxy hops (Cloudflare edge → Caddy → API container). A
  // count, not `true`, so a client cannot prepend extra X-Forwarded-For hops
  // and have them treated as the visitor. Caddy records its TCP peer in that
  // header, which is the Cloudflare edge — cloudflareClientIp then prefers
  // CF-Connecting-IP, and only when that resolved address is a Cloudflare IP.
  app.set('trust proxy', 2);
  app.use(cloudflareClientIp);

  // Security headers
  app.use(helmet());

  // CORS
  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3002',
    credentials: true,
    // The browser hides this response header unless it is listed. It carries
    // a replacement refresh token for clients that opted into rotation.
    exposedHeaders: ['X-Session-Token'],
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Swagger API docs (dev/staging only)
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('OpenCoop API')
      .setDescription('API for cooperative shareholding management')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document);
  }

  const port = process.env.API_PORT || process.env.PORT || 3001;
  await app.listen(port);
  console.log(`OpenCoop API running on port ${port}`);
}
bootstrap();
