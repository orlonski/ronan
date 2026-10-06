import { describe, expect, it } from "vitest";
import {
  CAMPOS_PADRAO,
  KIT_TIPOS_DESPESA,
  lerConfigCampos,
  nomeReservadoTipoDespesa,
  resolverCamposDoTipo,
  CamposDoTipoInput,
  sugerirViagens,
  janelaDaViagem,
  textoJanela,
  diaSaoPauloDe,
} from "@ronan/shared-types";
import {
  chaveDeComprovante,
  decisaoInicial,
  detectarRepetido,
  editavelPeloMotorista,
  marcasDoLancamento,
  MOTIVO_POR_SUA_CONTA,
  situacaoParaMotorista,
  validarDecisao,
  type CandidatoRepetido,
} from "./despesa-regras";
import { itensReembolsoDespesa, resolverRemuneracao } from "./acerto-motorista";
import { dvChave } from "./chave-fiscal";

/** Monta uma chave de 44 dígitos VÁLIDA (DV certo) com o modelo pedido. */
function chave(modelo: string): string {
  const base = `41` + `2610` + `12345678000190` + modelo + `001` + `000012345` + `1` + `12345678`;
  expect(base).toHaveLength(43);
  return base + dvChave(base);
}

describe("campos do tipo: leitor tolerante (nunca lança)", () => {
  it("lixo, null e versão desconhecida viram o padrão", () => {
    for (const lixo of [null, undefined, 42, "x", [], { v: 2, foto: "EXIGE" }]) {
      expect(lerConfigCampos(lixo)).toEqual(CAMPOS_PADRAO);
    }
  });

  it("campo ausente vale o padrão; modo inválido vale o padrão; chave desconhecida é ignorada", () => {
    const r = lerConfigCampos({
      v: 1,
      foto: "EXIGE",
      campos: { placa: { modo: "OBRIGATORIO" }, litros: { modo: "TALVEZ" }, inventado: { modo: "OBRIGATORIO" } },
    });
    expect(r.foto).toBe("EXIGE");
    expect(r.campos.placa.modo).toBe("OBRIGATORIO");
    expect(r.campos.litros.modo).toBe("OCULTO");
    expect(r.campos.descricao.modo).toBe("OCULTO");
    expect(Object.keys(r.campos)).not.toContain("inventado");
  });

  it("foto inválida vale 'Pede' (o padrão), pergunta/exemplo vazios somem", () => {
    const r = lerConfigCampos({ v: 1, foto: "SEMPRE", campos: { descricao: { modo: "OPCIONAL", pergunta: "  " } } });
    expect(r.foto).toBe("PEDE");
    expect(r.campos.descricao).toEqual({ modo: "OPCIONAL" });
  });

  it("manutenção trava a placa em obrigatória, mesmo que a config diga oculto", () => {
    const r = resolverCamposDoTipo({ slug: "borracharia", manutencao: true, campos: CAMPOS_PADRAO });
    expect(r.campos.placa.modo).toBe("OBRIGATORIO");
  });

  it("'Outro' sempre pede a descrição, com pergunta padrão", () => {
    const r = resolverCamposDoTipo({ slug: "outro", campos: { v: 1, foto: "PEDE", campos: {} } });
    expect(r.campos.descricao.modo).toBe("OBRIGATORIO");
    expect(r.campos.descricao.pergunta).toBe("O que você pagou?");
  });

  it("o Zod estrito da escrita recusa forma errada (o leitor tolerante é só pra leitura)", () => {
    expect(CamposDoTipoInput.safeParse(CAMPOS_PADRAO).success).toBe(true);
    expect(CamposDoTipoInput.safeParse({ ...CAMPOS_PADRAO, foto: "SEMPRE" }).success).toBe(false);
    expect(CamposDoTipoInput.safeParse({ v: 1, foto: "PEDE", campos: {} }).success).toBe(false);
  });

  it("o kit inicial passa no Zod estrito e termina no 'Outro'", () => {
    for (const t of KIT_TIPOS_DESPESA) expect(CamposDoTipoInput.safeParse(t.campos).success, t.slug).toBe(true);
    expect(KIT_TIPOS_DESPESA.at(-1)!.slug).toBe("outro");
    for (const t of KIT_TIPOS_DESPESA) expect(nomeReservadoTipoDespesa(t.nome), t.nome).toBeNull();
  });
});

describe("nome reservado (dinheiro que já tem caminho próprio)", () => {
  it.each([
    "Pedágio",
    "pedagios",
    "DIESEL",
    "Arla 32",
    "Abastecimento extra",
    "Combustível",
    "Multa",
    "Estadia",
    "Diárias",
    "  diária do motorista ",
  ])("%s é recusado", (nome) => {
    expect(nomeReservadoTipoDespesa(nome)).not.toBeNull();
  });

  it.each(["Alimentação", "Estacionamento", "Borracharia", "Pernoite", "Chapa / descarga", "Balsa", "Lavagem"])(
    "%s passa",
    (nome) => {
      expect(nomeReservadoTipoDespesa(nome)).toBeNull();
    },
  );
});

describe("marcas de atenção (o servidor nunca recusa: carimba)", () => {
  const base = {
    cfg: resolverCamposDoTipo(KIT_TIPOS_DESPESA.find((t) => t.slug === "borracharia")!),
    tipoAtivo: true,
    devolveNoMaximo: 300,
    repetido: false,
    viagemNaoAchada: false,
  };

  it("lançamento completo não tem marca", () => {
    expect(
      marcasDoLancamento({
        ...base,
        dados: { valor: 120, temFoto: true, descricao: "remendo", veiculoId: "v1" },
      }),
    ).toEqual([]);
  });

  it("sem foto, sem placa, acima do máximo, tipo desativado e repetido: tudo carimbado", () => {
    const m = marcasDoLancamento({
      ...base,
      tipoAtivo: false,
      repetido: true,
      viagemNaoAchada: true,
      dados: { valor: 350, temFoto: false, descricao: "remendo" },
    });
    expect(m).toEqual(
      expect.arrayContaining([
        "SEM_COMPROVANTE",
        "CAMPO_EXIGIDO_AUSENTE",
        "ACIMA_DO_MAXIMO",
        "POSSIVEL_REPETIDO",
        "TIPO_INATIVO",
        "VIAGEM_NAO_ACHADA",
      ]),
    );
  });

  it("foto exigida sem papel mas com o motivo escrito: só 'sem comprovante', não 'campo faltando'", () => {
    const m = marcasDoLancamento({
      ...base,
      dados: { valor: 50, temFoto: false, semComprovanteMotivo: "não deu nota", descricao: "x", veiculoId: "v" },
    });
    expect(m).toEqual(["SEM_COMPROVANTE"]);
  });

  it("tipo que não pede foto não marca 'sem comprovante'", () => {
    const m = marcasDoLancamento({
      ...base,
      cfg: { ...CAMPOS_PADRAO, foto: "NAO_PEDE" },
      dados: { valor: 10, temFoto: false },
    });
    expect(m).toEqual([]);
  });
});

describe("como o gasto nasce", () => {
  it("tipo que não devolve: 'por sua conta', nem entra na fila", () => {
    const d = decisaoInicial({ devolve: false, aprovaSozinhoAte: null, valor: 10, marcas: [] });
    expect(d).toMatchObject({ status: "NAO_REEMBOLSADA", motivo: MOTIVO_POR_SUA_CONTA, automatico: true });
  });

  it("aprova sozinho até o limite, se não há ponto de atenção", () => {
    expect(decisaoInicial({ devolve: true, aprovaSozinhoAte: 40, valor: 38, marcas: [] })).toMatchObject({
      status: "APROVADA",
      valorAprovado: 38,
    });
    expect(decisaoInicial({ devolve: true, aprovaSozinhoAte: 40, valor: 41, marcas: [] }).status).toBe(
      "COM_ESCRITORIO",
    );
    expect(
      decisaoInicial({ devolve: true, aprovaSozinhoAte: 40, valor: 10, marcas: ["SEM_COMPROVANTE"] }).status,
    ).toBe("COM_ESCRITORIO");
  });

  it("viagem que ainda não subiu não segura a aprovação automática", () => {
    expect(
      decisaoInicial({ devolve: true, aprovaSozinhoAte: 40, valor: 10, marcas: ["VIAGEM_NAO_ACHADA"] }).status,
    ).toBe("APROVADA");
  });

  it("'aprova sozinho' vazio = o escritório confere tudo", () => {
    expect(decisaoInicial({ devolve: true, aprovaSozinhoAte: null, valor: 1, marcas: [] }).status).toBe(
      "COM_ESCRITORIO",
    );
  });
});

describe("antiduplicação: marca, nunca recusa", () => {
  const dia = new Date("2026-10-05T15:00:00Z");
  const outro = (o: Partial<CandidatoRepetido>): CandidatoRepetido => ({
    id: "x",
    motoristaId: "m1",
    tipoDespesaId: "t1",
    valor: 38,
    data: dia,
    chaveFiscal: null,
    sha256s: [],
    ...o,
  });
  const novo = { motoristaId: "m1", tipoDespesaId: "t1", valor: 38, data: dia, chaveFiscal: null, sha256s: [] };

  it("mesma chave fiscal vence (sinal mais forte), de qualquer motorista", () => {
    const k = chave("65");
    const r = detectarRepetido({ ...novo, chaveFiscal: k, valor: 99 }, [
      outro({ id: "parecido" }),
      outro({ id: "chave", motoristaId: "m2", chaveFiscal: k, valor: 1 }),
    ]);
    expect(r).toEqual({ despesaId: "chave", sinal: "MESMA_CHAVE" });
  });

  it("mesma foto (sha256) pega a foto da galeria reaproveitada", () => {
    const r = detectarRepetido({ ...novo, valor: 50, sha256s: ["abc"] }, [outro({ id: "f", sha256s: ["abc"] })]);
    expect(r).toEqual({ despesaId: "f", sinal: "MESMA_FOTO" });
  });

  it("parecido: mesmo motorista + tipo + valor + dia de SP", () => {
    expect(detectarRepetido(novo, [outro({ id: "p" })])).toEqual({ despesaId: "p", sinal: "PARECIDO" });
    // 02:00 UTC do dia 6 ainda é dia 5 em São Paulo.
    expect(detectarRepetido(novo, [outro({ id: "p", data: new Date("2026-10-06T02:00:00Z") })])?.sinal).toBe(
      "PARECIDO",
    );
    expect(detectarRepetido(novo, [outro({ id: "p", data: new Date("2026-10-06T04:00:00Z") })])).toBeNull();
    expect(detectarRepetido(novo, [outro({ id: "p", tipoDespesaId: "t2" })])).toBeNull();
    expect(detectarRepetido(novo, [outro({ id: "p", motoristaId: "m2" })])).toBeNull();
    expect(detectarRepetido(novo, [outro({ id: "p", valor: 38.01 })])).toBeNull();
  });

  it("não se acusa a si mesmo (correção do mesmo gasto)", () => {
    expect(detectarRepetido({ ...novo, id: "eu" }, [outro({ id: "eu" })])).toBeNull();
  });

  it("chave fiscal só vale se o DV confere e é nota/cupom (55/65)", () => {
    expect(chaveDeComprovante(chave("65"))).toHaveLength(44);
    expect(chaveDeComprovante(chave("55"))).toHaveLength(44);
    expect(chaveDeComprovante(chave("57"))).toBeNull(); // CT-e não é comprovante de gasto
    const errada = chave("65").slice(0, 43) + ((Number(chave("65")[43]) + 1) % 10);
    expect(chaveDeComprovante(errada)).toBeNull();
    expect(chaveDeComprovante("123")).toBeNull();
    expect(chaveDeComprovante(null)).toBeNull();
  });
});

describe("decisão do escritório", () => {
  it("aprovar o valor lançado não pede motivo", () => {
    expect(validarDecisao({ acao: "APROVAR", valorInformado: 58 })).toEqual({
      ok: true,
      valorAprovado: 58,
      motivo: null,
    });
  });

  it("aprovar OUTRO valor exige motivo; o lançado continua guardado à parte", () => {
    expect(validarDecisao({ acao: "APROVAR", valorInformado: 58, valorAprovado: 50 }).ok).toBe(false);
    expect(
      validarDecisao({ acao: "APROVAR", valorInformado: 58, valorAprovado: 50, motivo: "No papel está R$ 50" }),
    ).toEqual({ ok: true, valorAprovado: 50, motivo: "No papel está R$ 50" });
  });

  it("não reembolsar sem motivo não passa", () => {
    expect(validarDecisao({ acao: "NAO_REEMBOLSAR", valorInformado: 58, motivo: "  " }).ok).toBe(false);
  });
});

describe("o que o motorista vê", () => {
  const base = {
    status: "APROVADA" as const,
    valorInformado: 58,
    valorAprovado: 58,
    motivo: null,
    decididoAutomatico: false,
    acerto: null,
    foraDoAcerto: false,
  };
  it("aprovado entra no 'pra receber'; no acerto fechado sai", () => {
    expect(situacaoParaMotorista(base)).toEqual({ situacao: "APROVADA", somaPraReceber: true });
    expect(situacaoParaMotorista({ ...base, acerto: { status: "FECHADO" } }).situacao).toBe("NO_ACERTO");
    expect(situacaoParaMotorista({ ...base, acerto: { status: "PAGO" } }).somaPraReceber).toBe(false);
  });
  it("outro valor, por sua conta, CLT", () => {
    expect(situacaoParaMotorista({ ...base, valorAprovado: 50 }).situacao).toBe("APROVADA_OUTRO_VALOR");
    expect(
      situacaoParaMotorista({
        ...base,
        status: "NAO_REEMBOLSADA",
        valorAprovado: null,
        motivo: MOTIVO_POR_SUA_CONTA,
        decididoAutomatico: true,
      }).situacao,
    ).toBe("POR_SUA_CONTA");
    expect(situacaoParaMotorista({ ...base, foraDoAcerto: true }).situacao).toBe("PAGO_FORA_DO_ACERTO");
  });
  it("modalidade que não devolve gasto: não promete acerto nem soma em 'pra receber'", () => {
    // A régua resolvida é quem diz (motorista com acordo próprio não muda o reembolso).
    const regra = resolverRemuneracao({ tipoRemuneracao: "VALOR_POR_VIAGEM" }, { reembolsaDespesa: false });
    expect(regra.reembolsaDespesa).toBe(false);
    const naoDevolve = { ...base, reembolsaDespesa: regra.reembolsaDespesa };
    expect(situacaoParaMotorista(naoDevolve)).toEqual({
      situacao: "POR_SUA_CONTA",
      somaPraReceber: false,
      naoVoltaNoAcerto: true,
    });
    expect(
      situacaoParaMotorista({ ...naoDevolve, status: "COM_ESCRITORIO", valorAprovado: null }),
    ).toEqual({ situacao: "POR_SUA_CONTA", somaPraReceber: false, naoVoltaNoAcerto: true });
    // E o acerto, com a mesma régua, de fato não paga — os dois lados batem.
    expect(
      itensReembolsoDespesa([{ id: "d", data: new Date(), tipoNome: "Comida", valorAprovado: 58 }], regra),
    ).toEqual([]);
    // O que já entrou num acerto fechado continua sendo o que o acerto diz.
    expect(situacaoParaMotorista({ ...naoDevolve, acerto: { status: "FECHADO" } }).situacao).toBe("NO_ACERTO");
    expect(situacaoParaMotorista({ ...naoDevolve, acerto: { status: "PAGO" } }).situacao).toBe("PAGO");
    // Empregado no dia: pago fora do acerto, a régua do acerto não se aplica.
    expect(situacaoParaMotorista({ ...naoDevolve, foraDoAcerto: true }).situacao).toBe("PAGO_FORA_DO_ACERTO");
    // Decisão do escritório com motivo continua sendo a do escritório.
    expect(
      situacaoParaMotorista({ ...naoDevolve, status: "NAO_REEMBOLSADA", motivo: "sem nota" }).situacao,
    ).toBe("NAO_REEMBOLSADA");
    // Ausente ou true = como sempre foi.
    expect(situacaoParaMotorista({ ...base, reembolsaDespesa: true })).toEqual({
      situacao: "APROVADA",
      somaPraReceber: true,
    });
  });
  it("corrigir/apagar só antes de gente decidir e fora de acerto", () => {
    expect(editavelPeloMotorista({ status: "COM_ESCRITORIO", decididoAutomatico: false, emAcerto: false })).toBe(true);
    expect(editavelPeloMotorista({ status: "APROVADA", decididoAutomatico: true, emAcerto: false })).toBe(true);
    expect(editavelPeloMotorista({ status: "APROVADA", decididoAutomatico: false, emAcerto: false })).toBe(false);
    expect(editavelPeloMotorista({ status: "COM_ESCRITORIO", decididoAutomatico: false, emAcerto: true })).toBe(false);
  });
});

describe("sugestão de viagem (a mesma função no app e na API)", () => {
  const guiada = {
    id: "g",
    motoristaId: "m1",
    veiculoId: "v1",
    data: "2026-10-05",
    iniciadoEm: "2026-10-05T09:40:00Z", // 06:40 SP
    status: "ENVIADA",
  };
  const manual = { id: "m", motoristaId: "m1", veiculoId: "v1", data: "2026-10-05", status: "ENVIADA" };

  it("dentro da janela da guiada e mesmo caminhão → FORTE, primeira", () => {
    const r = sugerirViagens({ data: "2026-10-05T15:18:00Z", motoristaId: "m1", veiculoId: "v1" }, [manual, guiada]);
    expect(r[0]!.viagem.id).toBe("g");
    expect(r[0]!.forca).toBe("FORTE");
  });

  it("viagem sem fim gravado usa a data (fim do dia de SP)", () => {
    const j = janelaDaViagem(guiada, 0)!;
    expect(diaSaoPauloDe(j.fim)).toBe("2026-10-05");
    expect(new Date(j.fim).toISOString()).toBe("2026-10-06T02:59:59.999Z");
  });

  it("em andamento: a janela vai até agora", () => {
    const agora = "2026-10-05T12:00:00Z";
    const j = janelaDaViagem({ ...guiada, status: "EM_ANDAMENTO" }, 0, agora)!;
    expect(j.fim).toBe(new Date(agora).getTime());
  });

  it("outro motorista e viagem cancelada nunca são sugeridos", () => {
    const g = { data: "2026-10-05T15:00:00Z", motoristaId: "m1" };
    expect(sugerirViagens(g, [{ ...guiada, motoristaId: "m2" }])).toEqual([]);
    expect(sugerirViagens(g, [{ ...guiada, status: "CANCELADA" }])).toEqual([]);
  });

  it("outro caminhão no mesmo dia → MEDIA; dia diferente → nada", () => {
    const r = sugerirViagens({ data: "2026-10-05T15:00:00Z", motoristaId: "m1", veiculoId: "v9" }, [manual]);
    expect(r[0]!.forca).toBe("MEDIA");
    expect(sugerirViagens({ data: "2026-10-07T15:00:00Z", motoristaId: "m1" }, [manual])).toEqual([]);
  });

  it("texto da janela em horário de SP", () => {
    expect(textoJanela(janelaDaViagem({ ...guiada, finalizadoEm: "2026-10-05T18:10:00Z" }, 0)!)).toBe(
      "06:40–15:10",
    );
    expect(textoJanela(janelaDaViagem(manual)!)).toBe("dia inteiro");
  });
});

describe("acerto: reembolso de gastos (bloco isolado)", () => {
  const regra = resolverRemuneracao(null, null);
  const d = { id: "d1", data: new Date("2026-10-05T15:00:00Z"), tipoNome: "Alimentação", valorAprovado: "38.00" };

  it("modalidade sem o interruptor (ausente) devolve; um item por gasto, com o APROVADO", () => {
    expect(regra.reembolsaDespesa).toBe(true);
    const itens = itensReembolsoDespesa([d, { ...d, id: "d2", valorAprovado: "50.00" }], regra);
    expect(itens.map((i) => [i.tipo, i.despesaId, i.valor])).toEqual([
      ["REEMBOLSO_DESPESA", "d1", "38.00"],
      ["REEMBOLSO_DESPESA", "d2", "50.00"],
    ]);
    expect(itens[0]!.descricao).toBe("Alimentação 05/10/2026");
  });

  it("modalidade com 'devolve gastos de viagem' desligado: nada entra", () => {
    const r = resolverRemuneracao(null, { reembolsaDespesa: false });
    expect(itensReembolsoDespesa([d], r)).toEqual([]);
  });

  it("o interruptor mora SÓ na modalidade (o acordo do motorista não alcança)", () => {
    const r = resolverRemuneracao({ tipoRemuneracao: "VALOR_POR_VIAGEM" }, { reembolsaDespesa: false });
    expect(r.reembolsaDespesa).toBe(false);
  });

  it("aprovado zero não vira linha", () => {
    expect(itensReembolsoDespesa([{ ...d, valorAprovado: "0" }], regra)).toEqual([]);
  });

  it("descrição usa o dia de SP (23h de SP é o mesmo dia)", () => {
    const [i] = itensReembolsoDespesa([{ ...d, data: new Date("2026-10-06T02:00:00Z") }], regra);
    expect(i!.descricao).toContain("05/10/2026");
  });
});
