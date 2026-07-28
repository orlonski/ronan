import { SetMetadata } from "@nestjs/common";
import type { RecursoEscopado } from "./escopo";

export const ESCOPO_KEY = "escopo";
export const IGNORA_ESCOPO_KEY = "ignora-escopo";

/**
 * Declara que o handler (ou o controller inteiro) filtra pelo escopo do usuário.
 * Sem esta declaração — ou sem `@IgnoraEscopo` —, um usuário restrito leva 403.
 *
 * O decorator é uma DECLARAÇÃO, não uma implementação: quem aplica o filtro é o
 * service, via `filtroEscopo`/`comEscopo`. Marcar sem filtrar é pior que não
 * marcar, porque passa a impressão de que foi tratado.
 */
export const EscopoPor = (recurso: RecursoEscopado) => SetMetadata(ESCOPO_KEY, recurso);

/**
 * Declara que o recurso é seguro pra usuário restrito sem nenhum filtro — porque
 * não expõe dado de outra frota (ex.: `/admin/users/me`).
 *
 * REGRA: todo `@IgnoraEscopo` exige `@RequerPermissao` de verdade no mesmo
 * ponto. O `PermissaoGuard` é fail-open, então sem isso o endpoint fica aberto
 * pra qualquer admin autenticado — e o painel chama a API direto do browser.
 */
export const IgnoraEscopo = () => SetMetadata(IGNORA_ESCOPO_KEY, true);
