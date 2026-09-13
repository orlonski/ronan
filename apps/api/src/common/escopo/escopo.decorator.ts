import { SetMetadata } from "@nestjs/common";
import type { RecursoEscopado } from "./escopo";

export const ESCOPO_KEY = "escopo";
export const IGNORA_ESCOPO_KEY = "ignora-escopo";

/**
 * Declara que o handler (ou o controller inteiro) filtra pelo escopo do usuário.
 *
 * O decorator é uma DECLARAÇÃO, não uma implementação: quem aplica o filtro é o
 * service, via `filtroEscopo`/`comEscopo`. Marcar sem filtrar é pior que não
 * marcar, porque passa a impressão de que foi tratado — foi o que aconteceu em
 * `descargasSuspeitas`, que tinha o decorator e não filtrava.
 *
 * ⚠️ O texto antigo daqui dizia que, sem a declaração, um usuário restrito
 * levava 403. Isso era verdade quando existia um guard de escopo; ele foi
 * removido em `279abd5` e o comentário ficou mentindo. HOJE quem não declara
 * simplesmente NÃO FILTRA — e o que sobrou lendo esta metadata é o
 * `EscopoRegistryService`, que só alimenta o selo "frota" na matriz de papéis.
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
