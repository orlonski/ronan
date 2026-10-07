import { Controller, Get, Header, SetMetadata } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { Public } from "../auth/decorators/public.decorator";
import { gerarOpenApi, PAGINA_DOCS } from "./openapi";

/** Marca o único controller da `/v1` que não exige chave: a documentação. */
export const DOCUMENTACAO_PUBLICA = "publica:documentacao";

/**
 * A documentação pública, separada do Swagger interno (`/docs`, que mostra a
 * API inteira do painel e do app e fica atrás de senha em produção).
 *
 * Sem chave de propósito: o integrador lê antes de ter uma. Só mostra o que os
 * contratos `@RotaV1` declaram — rota interna nenhuma aparece aqui.
 */
@ApiExcludeController()
@Public()
@SetMetadata(DOCUMENTACAO_PUBLICA, true)
@Controller("v1")
export class DocumentacaoV1Controller {
  private readonly doc = gerarOpenApi();

  @Get("openapi.json")
  @Header("Cache-Control", "public, max-age=300")
  openapi() {
    return this.doc;
  }

  @Get("docs")
  @Header("Content-Type", "text/html; charset=utf-8")
  @Header("Cache-Control", "public, max-age=300")
  docs() {
    return PAGINA_DOCS;
  }
}
