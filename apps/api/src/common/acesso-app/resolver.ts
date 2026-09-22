import {
  CAPACIDADES_APP,
  CAPACIDADE_POR_CHAVE,
  ehCapacidadeApp,
  type CamadaCorte,
  type CapacidadeApp,
  type CapacidadeAppDef,
} from "@ronan/shared-types";

/**
 * O QUE ESTA PESSOA PODE FAZER NO APP — a conta, num lugar só.
 *
 * Função pura, no molde de `viagem-minimos.ts`: recebe tudo o que precisa e
 * não fala com o banco. Quem carrega e grava é o `AcessoAppService`; quem
 * testa é o spec ao lado, sem Postgres.
 *
 * A ORDEM, que é o desenho inteiro:
 *   1. BASE, por vínculo (motorista e funcionário separados, depois unidos):
 *      perfil fixado → senão a primeira regra ativa que casa → senão o
 *      padrão da empresa → senão nada. Não existe soma de perfis.
 *   2. + exceções CONCEDER vivas.
 *   3. − exceções NEGAR vivas. Negar sempre vence conceder.
 *   4. CORTES, que nenhuma exceção fura:
 *      VINCULO     — capacidade que mora num cadastro que a pessoa não tem.
 *                    Sempre ativo: é estrutura, não política.
 *      APROVACAO   — cadastro não aprovado ou inativo.
 *      REGIME      — regime vivo proibido pela capacidade (empregado × diária).
 *      PLATAFORMA  — rollout/diagnóstico que a plataforma não liberou na empresa.
 *      CONTRATO    — módulo não contratado (exceto o que sobrevive ao cancelamento).
 *      DEPENDENCIA — por último: guiada sem lançar viagem não faz sentido.
 *
 * ⚠️ SOMBRA. Cada camada listada em `camadasEmSombra` CALCULA mas não corta:
 * o corte vai pra `sombra` e pra explicação, e o acesso segue valendo. É o
 * que deixa a empresa em produção intocada até o dono decidir ligar uma
 * camada, vendo antes a lista de quem perderia o quê.
 */

export type RegimeAcesso = "PARCEIRO" | "EMPREGADO";

export type PessoaAcesso = {
  cpf: string;
  /** Regime VIVO nesta empresa (`RegimeVigente`), ou null = não declarado. */
  regime: RegimeAcesso | null;
  motorista: {
    id: string;
    ativo: boolean;
    aprovado: boolean;
    modalidadeId: string | null;
    transportadoraId: string | null;
    perfilFixadoId: string | null;
  } | null;
  funcionario: {
    id: string;
    ativo: boolean;
    perfilFixadoId: string | null;
  } | null;
};

export type PerfilAcessoCtx = { id: string; nome: string; ativo: boolean; capacidades: string[] };

export type RegraAcessoCtx = {
  id: string;
  ordem: number;
  nome: string;
  ativo: boolean;
  vinculo: "QUALQUER" | "MOTORISTA" | "FUNCIONARIO";
  regime: "QUALQUER" | "PARCEIRO" | "EMPREGADO" | "NAO_DECLARADO";
  modalidadeId: string | null;
  transportadoraId: string | null;
  perfilId: string;
};

export type ExcecaoAcessoCtx = {
  id: string;
  capacidade: string;
  efeito: "CONCEDER" | "NEGAR";
  motivo: string;
  expiraEm: Date | null;
  revogadaEm: Date | null;
};

export type ContaAcessoCtx = {
  /** Módulos vigentes hoje (`modulosDaConta`). */
  modulos: ReadonlySet<string>;
  /** `Conta.rolloutsApp`: rollout/diagnóstico liberado pela plataforma. */
  rolloutsApp: ReadonlySet<string>;
  perfis: ReadonlyMap<string, PerfilAcessoCtx>;
  regras: readonly RegraAcessoCtx[];
  perfilPadraoMotoristaId: string | null;
  perfilPadraoFuncionarioId: string | null;
  camadasEmSombra: ReadonlySet<CamadaCorte>;
};

export type BaseAcesso = {
  perfilId: string;
  perfilNome: string;
  via: "FIXADO" | "REGRA" | "PADRAO";
  regraId?: string;
  regraNome?: string;
};

export type CorteAcesso = {
  camada: CamadaCorte | "VINCULO";
  /** true = só calculou, não cortou (camada em sombra). */
  sombra: boolean;
  detalhe: string;
};

export type ExplicacaoCapacidade = {
  ligado: boolean;
  /** Como ficaria com TODAS as camadas cortando. */
  ligadoSombra: boolean;
  /** De onde veio o "sim" antes dos cortes. null = ninguém concedeu. */
  origem:
    | { tipo: "PERFIL"; vinculo: "MOTORISTA" | "FUNCIONARIO"; perfilId: string }
    | { tipo: "EXCECAO"; excecaoId: string; motivo: string }
    | null;
  negadaPor?: { excecaoId: string; motivo: string };
  cortes: CorteAcesso[];
};

export type ResultadoAcesso = {
  efetivo: CapacidadeApp[];
  sombra: CapacidadeApp[];
  base: { motorista: BaseAcesso | null; funcionario: BaseAcesso | null };
  explicacao: Record<string, ExplicacaoCapacidade>;
  proximaMudanca: Date | null;
};

export function excecaoViva(e: ExcecaoAcessoCtx, agora: Date): boolean {
  return !e.revogadaEm && (!e.expiraEm || e.expiraEm.getTime() > agora.getTime());
}

function regraCasa(
  r: RegraAcessoCtx,
  vinculo: "MOTORISTA" | "FUNCIONARIO",
  pessoa: PessoaAcesso,
): boolean {
  if (!r.ativo) return false;
  if (r.vinculo !== "QUALQUER" && r.vinculo !== vinculo) return false;
  if (r.regime !== "QUALQUER") {
    if (r.regime === "NAO_DECLARADO" ? pessoa.regime !== null : pessoa.regime !== r.regime) {
      return false;
    }
  }
  // Modalidade e frota são atributos do cadastro de MOTORISTA. Regra que as
  // exige não alcança o funcionário — e não "casa por omissão".
  if (r.modalidadeId && (vinculo !== "MOTORISTA" || pessoa.motorista?.modalidadeId !== r.modalidadeId)) {
    return false;
  }
  if (
    r.transportadoraId &&
    (vinculo !== "MOTORISTA" || pessoa.motorista?.transportadoraId !== r.transportadoraId)
  ) {
    return false;
  }
  return true;
}

/** Qual perfil vale pra um vínculo da pessoa, e por quê. */
export function baseDoVinculo(
  vinculo: "MOTORISTA" | "FUNCIONARIO",
  pessoa: PessoaAcesso,
  conta: ContaAcessoCtx,
): BaseAcesso | null {
  const fixadoId =
    vinculo === "MOTORISTA" ? pessoa.motorista?.perfilFixadoId : pessoa.funcionario?.perfilFixadoId;
  const fixado = fixadoId ? conta.perfis.get(fixadoId) : undefined;
  if (fixado?.ativo) return { perfilId: fixado.id, perfilNome: fixado.nome, via: "FIXADO" };

  const regras = [...conta.regras].sort((a, b) => a.ordem - b.ordem);
  for (const r of regras) {
    if (!regraCasa(r, vinculo, pessoa)) continue;
    const p = conta.perfis.get(r.perfilId);
    // Regra apontando pra perfil desligado não é "sem acesso": passa pra
    // próxima. Desligar um perfil nunca pode tirar acesso de ninguém.
    if (!p?.ativo) continue;
    return { perfilId: p.id, perfilNome: p.nome, via: "REGRA", regraId: r.id, regraNome: r.nome };
  }

  const padraoId =
    vinculo === "MOTORISTA" ? conta.perfilPadraoMotoristaId : conta.perfilPadraoFuncionarioId;
  const padrao = padraoId ? conta.perfis.get(padraoId) : undefined;
  if (padrao?.ativo) return { perfilId: padrao.id, perfilNome: padrao.nome, via: "PADRAO" };
  return null;
}

function moraNoVinculo(def: CapacidadeAppDef, vinculo: "MOTORISTA" | "FUNCIONARIO"): boolean {
  return def.vinculo === "QUALQUER" || def.vinculo === vinculo;
}

function cortesDe(def: CapacidadeAppDef, pessoa: PessoaAcesso, conta: ContaAcessoCtx): CorteAcesso[] {
  const out: CorteAcesso[] = [];
  const sombra = (c: CamadaCorte) => conta.camadasEmSombra.has(c);
  const m = pessoa.motorista;
  const f = pessoa.funcionario;

  // VINCULO — sempre ativo.
  const temVinculo =
    def.vinculo === "MOTORISTA" ? !!m : def.vinculo === "FUNCIONARIO" ? !!f : !!m || !!f;
  if (!temVinculo) {
    out.push({
      camada: "VINCULO",
      sombra: false,
      detalhe:
        def.vinculo === "FUNCIONARIO"
          ? "Só pra quem é registrado (tem cadastro de funcionário)."
          : "Só pra quem tem cadastro de motorista.",
    });
    return out; // sem vínculo, o resto nem se pergunta
  }

  // APROVACAO
  const motoristaOk = !!m && m.ativo && m.aprovado;
  const funcionarioOk = !!f && f.ativo;
  const aprovado =
    def.vinculo === "MOTORISTA"
      ? motoristaOk
      : def.vinculo === "FUNCIONARIO"
        ? funcionarioOk
        : motoristaOk || funcionarioOk;
  if (!aprovado) {
    out.push({
      camada: "APROVACAO",
      sombra: sombra("APROVACAO"),
      detalhe: m && !m.aprovado ? "Cadastro ainda não aprovado." : "Cadastro inativo.",
    });
  }

  // REGIME
  if (pessoa.regime && def.regimesProibidos?.includes(pessoa.regime)) {
    out.push({
      camada: "REGIME",
      sombra: sombra("REGIME"),
      detalhe:
        pessoa.regime === "EMPREGADO"
          ? "É registrado em carteira: isto é de quem é parceiro."
          : "É parceiro: isto é de quem é registrado.",
    });
  }

  // PLATAFORMA
  if (def.tipo !== "EMPRESA" && !conta.rolloutsApp.has(def.chave)) {
    out.push({
      camada: "PLATAFORMA",
      sombra: sombra("PLATAFORMA"),
      detalhe:
        def.tipo === "ROLLOUT"
          ? "Ainda em liberação gradual, e não foi liberado nesta empresa."
          : "É ferramenta da plataforma, não liberada nesta empresa.",
    });
  }

  // CONTRATO
  if (!conta.modulos.has(def.modulo) && !def.sobreviveCancelamento) {
    out.push({
      camada: "CONTRATO",
      sombra: sombra("CONTRATO"),
      detalhe: `O módulo "${def.modulo}" não está contratado.`,
    });
  }
  return out;
}

export function resolverAcessoApp(
  pessoa: PessoaAcesso,
  conta: ContaAcessoCtx,
  excecoes: readonly ExcecaoAcessoCtx[],
  agora: Date,
): ResultadoAcesso {
  const explicacao: Record<string, ExplicacaoCapacidade> = {};
  for (const def of CAPACIDADES_APP) {
    explicacao[def.chave] = { ligado: false, ligadoSombra: false, origem: null, cortes: [] };
  }

  // 1. Base, por vínculo.
  const base = {
    motorista: pessoa.motorista ? baseDoVinculo("MOTORISTA", pessoa, conta) : null,
    funcionario: pessoa.funcionario ? baseDoVinculo("FUNCIONARIO", pessoa, conta) : null,
  };
  const concedido = new Set<CapacidadeApp>();
  for (const vinculo of ["MOTORISTA", "FUNCIONARIO"] as const) {
    const b = vinculo === "MOTORISTA" ? base.motorista : base.funcionario;
    if (!b) continue;
    for (const chave of conta.perfis.get(b.perfilId)?.capacidades ?? []) {
      if (!ehCapacidadeApp(chave)) continue; // chave que saiu do catálogo não volta à vida
      if (!moraNoVinculo(CAPACIDADE_POR_CHAVE[chave], vinculo)) continue;
      if (!concedido.has(chave)) {
        concedido.add(chave);
        explicacao[chave]!.origem = { tipo: "PERFIL", vinculo, perfilId: b.perfilId };
      }
    }
  }

  // 2 e 3. Exceções vivas: conceder, depois negar.
  const vivas = excecoes.filter((e) => excecaoViva(e, agora) && ehCapacidadeApp(e.capacidade));
  for (const e of vivas) {
    if (e.efeito !== "CONCEDER") continue;
    const chave = e.capacidade as CapacidadeApp;
    if (!concedido.has(chave)) {
      concedido.add(chave);
      explicacao[chave]!.origem = { tipo: "EXCECAO", excecaoId: e.id, motivo: e.motivo };
    }
  }
  for (const e of vivas) {
    if (e.efeito !== "NEGAR") continue;
    const chave = e.capacidade as CapacidadeApp;
    concedido.delete(chave);
    explicacao[chave]!.negadaPor = { excecaoId: e.id, motivo: e.motivo };
  }

  // 4. Cortes. `efetivo` só sofre os ativos; `sombra`, todos.
  const efetivo = new Set<CapacidadeApp>();
  const sombra = new Set<CapacidadeApp>();
  for (const chave of concedido) {
    const cortes = cortesDe(CAPACIDADE_POR_CHAVE[chave], pessoa, conta);
    explicacao[chave]!.cortes = cortes;
    if (!cortes.some((c) => !c.sombra)) efetivo.add(chave);
    if (cortes.length === 0) sombra.add(chave);
  }

  // DEPENDENCIA, por último e contra o conjunto já cortado. A ordem do
  // catálogo resolve as cadeias (lançar → guiada → OCR).
  const depSombra = conta.camadasEmSombra.has("DEPENDENCIA");
  for (const def of CAPACIDADES_APP) {
    if (!def.dependeDe?.length) continue;
    const faltaNoEfetivo = efetivo.has(def.chave) && !def.dependeDe.some((d) => efetivo.has(d));
    const faltaNaSombra = sombra.has(def.chave) && !def.dependeDe.some((d) => sombra.has(d));
    if (faltaNaSombra) sombra.delete(def.chave);
    if (faltaNoEfetivo && !depSombra) efetivo.delete(def.chave);
    if (faltaNoEfetivo || faltaNaSombra) {
      explicacao[def.chave]!.cortes.push({
        camada: "DEPENDENCIA",
        // Só é corte de verdade se tirou do efetivo.
        sombra: depSombra || !faltaNoEfetivo,
        detalhe: `Só funciona junto de: ${def.dependeDe
          .map((d) => CAPACIDADE_POR_CHAVE[d].label)
          .join(" ou ")}.`,
      });
    }
  }

  for (const def of CAPACIDADES_APP) {
    explicacao[def.chave]!.ligado = efetivo.has(def.chave);
    explicacao[def.chave]!.ligadoSombra = sombra.has(def.chave);
  }

  let proximaMudanca: Date | null = null;
  for (const e of vivas) {
    if (e.expiraEm && (!proximaMudanca || e.expiraEm < proximaMudanca)) proximaMudanca = e.expiraEm;
  }

  const ordem = (s: Set<CapacidadeApp>) =>
    CAPACIDADES_APP.map((d) => d.chave).filter((c) => s.has(c));
  return { efetivo: ordem(efetivo), sombra: ordem(sombra), base, explicacao, proximaMudanca };
}
