import { SetMetadata } from "@nestjs/common";
import type { CapacidadeApp } from "@ronan/shared-types";

export const CAPACIDADE_KEY = "capacidadeApp";
export const CAPACIDADE_LIVRE_KEY = "capacidadeAppLivre";

export type ExigenciaCapacidade = CapacidadeApp | { algum: CapacidadeApp[] };

/**
 * O que o handler de `/m/*` exige do acesso calculado da pessoa.
 *
 * `@RequerCapacidade("app.ponto.bater")` — precisa ter esta.
 * `@RequerCapacidade({ algum: [...] })` — precisa ter pelo menos uma.
 *
 * Quem cobra é o `CapacidadeAppGuard`, que em cada empresa começa em SOMBRA
 * (registra quem barraria e deixa passar) e só barra a capacidade que a
 * plataforma travou. Ver `docs/acesso-app-desenho.md` §5.3.
 */
export const RequerCapacidade = (exige: ExigenciaCapacidade) => SetMetadata(CAPACIDADE_KEY, exige);

/**
 * O handler não depende de capacidade nenhuma — e diz POR QUÊ.
 *
 * O motivo é obrigatório e é pra gente: "ler o que já é dele", "continuar uma
 * viagem já lançada", "infra do app". Handler sem uma coisa nem outra derruba o
 * boot (`capacidades.boot-check.ts`).
 */
export const CapacidadeLivre = (motivo: string) => SetMetadata(CAPACIDADE_LIVRE_KEY, motivo);
