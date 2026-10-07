import { instalarRegistroDeChamadas, comGatilho, rotularRobosAgendados } from "./common/chamadas-externas/interceptor";
import { rotaSemIds } from "./common/chamadas-externas/registro";
// Antes de qualquer SDK guardar a referência do `fetch`: tudo que sai pra fora
// passa pelo registro de chamadas externas (tela da plataforma).
instalarRegistroDeChamadas();
rotularRobosAgendados();
import { NestFactory } from "@nestjs/core";
import { ValidationPipe, Logger } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import compression from "compression";
import { randomUUID, timingSafeEqual } from "node:crypto";
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
  // exposedHeaders: sem isso o browser não deixa o dashboard LER headers
  // customizados cross-origin (X-Imagem-Tipo diz se a foto do local é Street
  // View ou satélite; Content-Disposition traz o nome do PDF baixado).
  //
  // maxAge: toda chamada do painel leva `Authorization`, então o navegador
  // pergunta antes (OPTIONS) se pode. Sem Max-Age o Chrome lembra a resposta
  // por só 5s — e com o servidor na França cada pergunta é mais uma ida e
  // volta de ~230ms. 7200s é o teto que o Chrome aceita.
  const corsDoPainel = {
    origin,
    credentials: true,
    exposedHeaders: ["X-Imagem-Tipo", "Content-Disposition"],
    maxAge: 7200,
  };
  // A API pública (/v1) NÃO responde a navegador: sem Access-Control-Allow-Origin
  // o browser recusa, e a chave secreta de integração não vai parar no
  // JavaScript do site de ninguém. Quem chama a /v1 é servidor.
  app.enableCors((req: { url?: string }, cb: (err: Error | null, opts: object) => void) =>
    cb(null, req.url?.startsWith("/v1/") ? { origin: false } : corsDoPainel),
  );

  // Gzip nas respostas. Crítico pro app móvel em rede 3G/4G —
  // reduz /catalogos de ~300KB pra ~40KB. Threshold default ignora
  // payloads pequenos (<1KB), então rotas leves não pagam custo de CPU.
  // Cada chamada externa sabe qual requisição a disparou ("POST /admin/…").
  app.use((req: { method: string; originalUrl?: string; url: string }, _res: unknown, next: () => void) =>
    comGatilho(rotaSemIds(req.method, req.originalUrl ?? req.url), next),
  );
  app.use(compression());

  // aumenta limite do body-parser pra aceitar uploads de planilhas e fotos
  // (default do Express e 100KB e barra antes do Multer pegar)
  // /v1 com teto próprio de 1 MB, ANTES do parser global de 50 MB (o primeiro
  // que lê o corpo vence). Integração não manda planilha nem foto por aqui.
  app.use("/v1", json({ limit: "1mb" }));
  // Erro do parser (corpo grande, JSON quebrado) acontece ANTES do Nest: sem
  // isto saía 500 "Internal server error" — que diz ao integrador que o erro é
  // nosso. Sai no formato da /v1, com o código certo.
  app.use("/v1", (err: { type?: string; status?: number } | undefined, _req: unknown, res: { status(n: number): { json(b: unknown): void } }, next: (e?: unknown) => void) => {
    if (!err) return next();
    const grande = err.type === "entity.too.large";
    const codigo = grande ? "CORPO_GRANDE_DEMAIS" : "VALIDACAO";
    const mensagem = grande ? "O corpo passa de 1 MB." : "O corpo não é um JSON válido.";
    res.status(grande ? 413 : 400).json({ erro: { codigo, mensagem, requisicaoId: `req_${randomUUID().replace(/-/g, "").slice(0, 20)}` } });
  });
  app.use(
    json({
      limit: "50mb",
      // O webhook da Meta assina o corpo CRU (HMAC-SHA256). Reserializar o JSON
      // muda espaço e ordem de chave e a assinatura deixa de bater, então o
      // buffer original precisa sobreviver ao parse.
      //
      // Só nesse path: guardar o buffer de TODA requisição faria um upload de
      // 50MB ocupar 100MB de memória, pra nada.
      verify: (req, _res, buf) => {
        const r = req as { url?: string; rawBody?: Buffer };
        if (r.url?.startsWith("/whatsapp/meta/")) r.rawBody = buf;
      },
    }),
  );
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
  // ⚠️ /docs é a API INTERNA inteira (todas as rotas do painel e do app). Em
  // produção ele só existe atrás de usuário e senha (DOCS_USUARIO/DOCS_SENHA no
  // Easypanel); sem os dois, não sobe — fechado por padrão. A documentação pro
  // cliente de integração vai ser outra, só com a API pública.
  const emProducao = process.env.NODE_ENV === "production";
  const docsUsuario = process.env.DOCS_USUARIO?.trim();
  const docsSenha = process.env.DOCS_SENHA?.trim();
  if (!emProducao || (docsUsuario && docsSenha)) {
    if (emProducao) app.use(["/docs", "/docs-json", "/docs-yaml"], protegerDocs(docsUsuario!, docsSenha!));
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup("docs", app, document);
  } else {
    Logger.warn("/docs desligado em produção: defina DOCS_USUARIO e DOCS_SENHA pra abrir com senha.", "Bootstrap");
  }

  const port = Number(process.env.PORT ?? 3000);
  // O que os módulos pedem pra fora enquanto ligam (onModuleInit: ex.: conferir
  // o balde do MinIO) aparece como "subida da API" na tela de chamadas externas.
  // A inicialização roda aqui, fora do listen, pra o servidor HTTP não herdar o rótulo.
  await comGatilho("subida da API", () => app.init());
  await app.listen(port);
  Logger.log(`Ronan API rodando em http://localhost:${port} (docs em /docs)`, "Bootstrap");
}

bootstrap();

/** Usuário e senha (HTTP Basic) na frente do /docs, com comparação em tempo constante. */
function protegerDocs(usuario: string, senha: string) {
  const esperado = Buffer.from(`${usuario}:${senha}`);
  return (req: { headers: Record<string, string | string[] | undefined> }, res: { setHeader: (k: string, v: string) => void; status: (n: number) => { end: (s?: string) => void } }, next: () => void) => {
    const h = String(req.headers.authorization ?? "");
    const recebido = h.startsWith("Basic ") ? Buffer.from(h.slice(6), "base64") : Buffer.alloc(0);
    if (recebido.length === esperado.length && timingSafeEqual(recebido, esperado)) return next();
    res.setHeader("WWW-Authenticate", 'Basic realm="Movatruck API interna"');
    res.status(401).end("Documentação interna: precisa de usuário e senha.");
  };
}
