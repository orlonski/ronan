import { NestFactory } from "@nestjs/core";
import { ValidationPipe, Logger } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import compression from "compression";
import { json, urlencoded } from "express";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // CORS antes do body-parser — assim mesmo se body-parser falhar com 413,
  // a resposta de erro ainda vem com o header Access-Control-Allow-Origin.
  const rawCors = (process.env.CORS_ORIGINS ?? "").trim();
  const origin =
    rawCors === "" || rawCors === "*"
      ? true
      : rawCors.split(",").map((s) => s.trim()).filter(Boolean);
  app.enableCors({ origin, credentials: true });

  // Gzip nas respostas. Crítico pro app móvel em rede 3G/4G —
  // reduz /catalogos de ~300KB pra ~40KB. Threshold default ignora
  // payloads pequenos (<1KB), então rotas leves não pagam custo de CPU.
  app.use(compression());

  // aumenta limite do body-parser pra aceitar uploads de planilhas e fotos
  // (default do Express e 100KB e barra antes do Multer pegar)
  app.use(json({ limit: "50mb" }));
  app.use(urlencoded({ extended: true, limit: "50mb" }));

  app.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
  );

  const config = new DocumentBuilder()
    .setTitle("Ronan API")
    .setDescription("API do sistema de viagens da transportadora")
    .setVersion("0.1.0")
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("docs", app, document);

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(`Ronan API rodando em http://localhost:${port} (docs em /docs)`, "Bootstrap");
}

bootstrap();
