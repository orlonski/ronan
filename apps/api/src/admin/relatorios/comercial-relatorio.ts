import { ForbiddenException } from "@nestjs/common";
import {
  type AgruparPorRelatorio,
  DIMENSOES_COMERCIAIS,
  type GrupoRelatorioViagens,
} from "@ronan/shared-types";
import type { AuthAdminUser } from "../../auth/types";

/**
 * `admin/viagens/comercial.ts` protege LINHAS de viagem. Num agregado a mesma
 * proteção precisa de três camadas, porque o dado vaza por caminhos que a
 * omissão de campo não cobre:
 *
 *  1. A DIMENSÃO. Agrupar por cliente devolve, literalmente, a carteira da
 *     Schaba com o volume de cada um. Nenhuma poda de campo conserta isso — o
 *     vazamento são as próprias linhas do resultado.
 *  2. O FILTRO. Filtrar por um clienteId e ler o total revela o volume daquele
 *     cliente; iterando ids, revela a carteira inteira. Um oráculo é tão bom
 *     quanto a listagem.
 *  3. A MÉTRICA. km/toneladas faturados (mínimo aplicado) são comerciais mesmo
 *     agrupados por motorista — estão em CAMPOS_COMERCIAIS lá.
 *
 * Vive aqui, e não num decorator, pelo mesmo motivo do `exigirComercial` do
 * compartilhamento: `@RequerPermissao` é OR entre chaves, e o que precisamos é
 * AND com `relatorios.ver`.
 */

export function podeVerComercial(user: AuthAdminUser): boolean {
  return user.permissoes.includes("viagens.ver-comercial");
}

/** Camada 1 — bloqueia a dimensão antes de tocar no banco. */
export function exigirComercialParaDimensao(
  agruparPor: AgruparPorRelatorio,
  user: AuthAdminUser,
): void {
  if (DIMENSOES_COMERCIAIS.includes(agruparPor) && !podeVerComercial(user)) {
    throw new ForbiddenException(
      "Agrupar por cliente ou empresa mostra a carteira de clientes — exige a permissão de dados comerciais.",
    );
  }
}

// Camada 2 mora em `admin/viagens/comercial.ts` (exigirComercialParaFiltros) —
// é a mesma regra da listagem de viagens e não pode divergir dela.
export { exigirComercialParaFiltros } from "../viagens/comercial";

/**
 * Camada 3 — poda as métricas derivadas do mínimo faturado, espelhando
 * CAMPOS_COMERCIAIS. O real (`toneladas`/`km`) fica: é operação, não comércio.
 */
export function omitirComercialDoGrupo<T extends Partial<GrupoRelatorioViagens>>(grupo: T): T {
  const copia = { ...grupo };
  delete copia.toneladasEfetiva;
  delete copia.toneladasAjustadas;
  delete copia.kmEfetivo;
  delete copia.kmAjustados;
  return copia;
}
