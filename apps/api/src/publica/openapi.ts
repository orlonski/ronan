import { OpenAPIRegistry, OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { ESCOPOS_INTEGRACAO } from "@ronan/shared-types";
import { ErroV1 } from "./contrato";
import { ERROS_PUBLICOS } from "./erros";
import { ROTAS_V1 } from "./rota-v1";

/** Versão do contrato. Mudou o que entra ou sai? Sobe aqui e anota em docs/api-publica/CHANGELOG.md. */
export const VERSAO_CONTRATO = "2026-10-08";

const DESCRICAO = `
A API do Movatruck pro sistema de vocês (ERP, sistema de frete, app próprio) mandar viagens sem ninguém digitar.

**Como entrar.** Quem administra a empresa no Movatruck cria a integração em *Ajustes › Conectar outro sistema* e copia a chave
(\`mvt_live_…\`, aparece uma vez só). Toda chamada leva o cabeçalho \`Authorization: Bearer mvt_live_…\`. Comece por \`GET /v1/eu\`.

**O número de vocês.** Motorista, caminhão, local e viagem podem ser criados e achados pelo número que eles têm no sistema de
vocês (\`/externo/{idExterno}\`). Mandar de novo com o mesmo número atualiza, não duplica.

**Regras que não mudam.**
- Viagem sem peso entra como \`AGUARDANDO_PESO\` e não conta em fechamento até ter peso.
- O valor (R$) sai da tabela de preço da empresa no Movatruck. Não é aceito de fora.
- Viagem lançada pelo motorista no app é só dele: a integração lê, não altera.
- Uma pessoa conferiu, fechou ou corrigiu no painel? A integração não desfaz.
- Referência não achada (material, obra, local) não recusa a viagem: ela entra com pendência e a resposta traz \`avisos\`.
  Só motorista e caminhão são obrigatórios.

**Erros.** Sempre \`{ "erro": { "codigo", "mensagem", "detalhes"?, "requisicaoId" } }\`. O \`codigo\` é estável.
Campo que não existe no contrato é recusado (400), nunca ignorado.

**Limites.** 120 leituras e 60 escritas por minuto por chave; 600 por minuto somando as chaves da empresa; corpo até 1 MB.
Acima disso, 429 com \`Retry-After\`.

**Escopos.** ${ESCOPOS_INTEGRACAO.map((e) => `\`${e.chave}\` (${e.titulo})`).join(" · ")}.
`.trim();

const IdempotencyKey = z
  .string()
  .min(8)
  .max(255)
  .optional()
  .openapi({
    param: { name: "Idempotency-Key", in: "header" },
    description: "Um UUID por pedido. Reenviar o mesmo pedido com a mesma chave devolve a mesma resposta, sem gravar de novo (vale 24 h).",
    example: "6f1c2a8e-7b3d-4c9a-9e2f-1a2b3c4d5e6f",
  });

/** O documento OpenAPI 3.1 da `/v1`, gerado SÓ dos contratos declarados com `@RotaV1`. */
export function gerarOpenApi(): Record<string, unknown> {
  const registro = new OpenAPIRegistry();
  const erro = registro.register("Erro", ErroV1);
  registro.registerComponent("securitySchemes", "chave", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "mvt_live_…",
    description: "A chave da integração, criada no painel do Movatruck.",
  });

  const chave = (r: (typeof ROTAS_V1)[number]) => `${r.grupo}|${r.caminho}|${r.metodo}`;
  // Ordem por código de caractere, não por idioma: o contrato tem que sair igual em qualquer máquina.
  const rotas = [...ROTAS_V1].sort((a, b) => (chave(a) < chave(b) ? -1 : chave(a) > chave(b) ? 1 : 0));
  for (const r of rotas) {
    const porStatus = new Map<number, (keyof typeof ERROS_PUBLICOS)[]>();
    for (const c of r.erros) {
      const s = ERROS_PUBLICOS[c].status;
      porStatus.set(s, [...(porStatus.get(s) ?? []), c]);
    }
    const respostas: Record<string, unknown> = {
      [r.sucesso.status]: { description: r.sucesso.descricao, content: { "application/json": { schema: r.sucesso.schema } } },
    };
    for (const o of r.outrosSucessos ?? []) {
      respostas[o.status] = { description: o.descricao, content: { "application/json": { schema: r.sucesso.schema } } };
    }
    for (const [status, codigos] of [...porStatus].sort((a, b) => a[0] - b[0])) {
      respostas[status] = {
        description: codigos.map((c) => `\`${c}\`: ${ERROS_PUBLICOS[c].mensagem}`).join("\n\n"),
        content: { "application/json": { schema: erro } },
      };
    }
    registro.registerPath({
      method: r.metodo,
      path: `/v1${r.caminho}`,
      tags: [r.grupo],
      summary: r.resumo,
      description: [r.descricao, r.escopo ? `Escopo: \`${r.escopo}\`.` : "Qualquer chave válida."].filter(Boolean).join("\n\n"),
      security: [{ chave: [] }],
      request: {
        ...(r.params ? { params: r.params as never } : {}),
        ...(r.query ? { query: r.query as never } : {}),
        ...(r.idempotente ? { headers: [IdempotencyKey] } : {}),
        ...(r.corpo ? { body: { required: true, content: { "application/json": { schema: r.corpo } } } } : {}),
      },
      responses: respostas as never,
    });
  }

  const doc = new OpenApiGeneratorV31(registro.definitions).generateDocument({
    openapi: "3.1.0",
    info: { title: "Movatruck — API de integração", version: VERSAO_CONTRATO, description: DESCRICAO },
    servers: [{ url: "https://api.schaba.com.br", description: "Produção" }],
  });
  return doc as unknown as Record<string, unknown>;
}

/** Texto canônico (chaves ordenadas) pra comparar com o contrato commitado. */
export function openApiCanonico(doc: unknown = gerarOpenApi()): string {
  return `${JSON.stringify(ordenar(doc), null, 2)}\n`;
}

function ordenar(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(ordenar);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.keys(v as Record<string, unknown>)
        .sort()
        .map((k) => [k, ordenar((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}

/** A página de documentação (Scalar, do CDN): lê o `/v1/openapi.json`. */
export const PAGINA_DOCS = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Movatruck — API de integração</title>
</head>
<body>
  <script id="api-reference" data-url="/v1/openapi.json"></script>
  <script>
    document.getElementById("api-reference").dataset.configuration = JSON.stringify({
      theme: "default", hideClientButton: false, defaultOpenAllTags: true,
      customCss: ":root { --scalar-color-accent: #DF7234; }",
    });
  </script>
  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@1"></script>
</body>
</html>`;
