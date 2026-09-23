/**
 * O catálogo do que dá pra importar.
 *
 * Cada entidade declara seus campos e, em cada campo, os NOMES que uma planilha
 * de transportadora costuma usar. Isso é o que faz o arquivo do cliente entrar
 * sem ninguém mapear coluna a coluna — e mapear coluna a coluna é exatamente o
 * ponto onde uma implantação trava por duas semanas.
 *
 * Os sinônimos não são chute: são os cabeçalhos que aparecem nas planilhas de
 * controle que as transportadoras mandam (a mesma origem dos parsers de
 * fechamento). Quando o palpite erra, o painel deixa corrigir — o automático é
 * atalho, nunca a única porta.
 */

export type TipoCampo =
  | "texto"
  /** Decimal. O ponto é SEMPRE decimal aqui — é o que preserva lat/lng. */
  | "numero"
  /** Inteiro. O ponto vira separador de milhar ("2.019" é 2019). */
  | "inteiro"
  | "data"
  | "cpf"
  | "cnpjOuCpf"
  | "placa"
  | "uf";

export type CampoImportavel = {
  chave: string;
  rotulo: string;
  tipo: TipoCampo;
  obrigatorio: boolean;
  /** Nomes de coluna que valem por este campo (comparados sem acento/caixa). */
  sinonimos: string[];
  ajuda?: string;
};

export type EntidadeImportavel = {
  chave: "clientes" | "motoristas" | "veiculos" | "locais" | "materiais" | "viagens";
  rotulo: string;
  /** O que o painel diz antes de o usuário subir o arquivo. */
  descricao: string;
  /**
   * O campo que identifica a linha como sendo "a mesma" de um registro que já
   * existe. É o que torna a importação REPETÍVEL: subir a planilha de novo
   * corrige o que mudou em vez de duplicar a base.
   */
  chaveNatural: string;
  campos: CampoImportavel[];
  permissao: string;
};

const UF: CampoImportavel = {
  chave: "uf",
  rotulo: "UF",
  tipo: "uf",
  obrigatorio: false,
  sinonimos: ["uf", "estado", "sigla uf", "sg uf"],
};

const CIDADE: CampoImportavel = {
  chave: "cidade",
  rotulo: "Cidade",
  tipo: "texto",
  obrigatorio: false,
  sinonimos: ["cidade", "municipio", "localidade"],
};

export const ENTIDADES: EntidadeImportavel[] = [
  {
    chave: "clientes",
    rotulo: "Obras",
    descricao:
      "Onde se trabalha — a obra, a loja, o canteiro de cada cliente. Sobe só o nome — é por ele que a importação sabe se a obra já existe, então subir de novo corrige em vez de duplicar.",
    chaveNatural: "nome",
    permissao: "clientes.criar",
    campos: [
      {
        chave: "nome",
        rotulo: "Nome",
        tipo: "texto",
        obrigatorio: true,
        sinonimos: ["nome", "cliente", "razao social", "razao", "nome fantasia", "fantasia"],
      },
      {
        chave: "apelidos",
        rotulo: "Como chamam no dia a dia",
        tipo: "texto",
        obrigatorio: false,
        sinonimos: ["apelido", "apelidos", "sinonimo", "como chamam", "nome curto"],
        ajuda: "Separe por vírgula. É o que faz a busca achar 'shopping novo'.",
      },
    ],
  },
  {
    chave: "motoristas",
    rotulo: "Motoristas",
    descricao:
      "Os motoristas da frota e os terceiros. O CPF é o que evita cadastro repetido — e é por ele que o convite do app chega depois.",
    chaveNatural: "cpf",
    permissao: "motoristas.criar",
    campos: [
      {
        chave: "nome",
        rotulo: "Nome",
        tipo: "texto",
        obrigatorio: true,
        sinonimos: ["nome", "motorista", "nome do motorista", "condutor"],
      },
      {
        chave: "cpf",
        rotulo: "CPF",
        tipo: "cpf",
        obrigatorio: true,
        sinonimos: ["cpf", "documento", "doc"],
      },
      {
        chave: "telefone",
        rotulo: "Telefone",
        tipo: "texto",
        obrigatorio: false,
        sinonimos: ["telefone", "fone", "celular", "whatsapp", "contato"],
        ajuda: "É pra cá que vai o convite do aplicativo.",
      },
      {
        chave: "email",
        rotulo: "E-mail",
        tipo: "texto",
        obrigatorio: false,
        sinonimos: ["email", "e-mail", "mail"],
      },
    ],
  },
  {
    chave: "veiculos",
    rotulo: "Veículos",
    descricao: "A frota. A placa é a chave — subir de novo atualiza, não duplica.",
    chaveNatural: "placa",
    permissao: "veiculos.criar",
    campos: [
      {
        chave: "placa",
        rotulo: "Placa",
        tipo: "placa",
        obrigatorio: true,
        sinonimos: ["placa", "placa do veiculo", "veiculo", "cavalo"],
      },
      {
        chave: "modelo",
        rotulo: "Modelo",
        tipo: "texto",
        obrigatorio: false,
        sinonimos: ["modelo", "descricao", "veiculo modelo", "marca modelo", "marca"],
      },
      {
        chave: "ano",
        rotulo: "Ano",
        tipo: "inteiro",
        obrigatorio: false,
        sinonimos: ["ano", "ano modelo", "ano fabricacao"],
      },
    ],
  },
  {
    chave: "locais",
    rotulo: "Locais",
    descricao:
      "Pedreiras, obras, usinas — de onde sai e pra onde vai a carga. Endereço, cidade e UF são obrigatórios porque é assim que o local existe no sistema; com latitude e longitude o app ainda reconhece o lugar pelo GPS.",
    chaveNatural: "nome",
    permissao: "locais.criar",
    campos: [
      {
        chave: "nome",
        rotulo: "Nome",
        tipo: "texto",
        obrigatorio: true,
        sinonimos: ["nome", "local", "obra", "pedreira", "descricao", "ponto"],
      },
      {
        chave: "logradouro",
        rotulo: "Endereço",
        tipo: "texto",
        obrigatorio: true,
        sinonimos: ["endereco", "logradouro", "rua", "end", "av", "avenida"],
      },
      { ...CIDADE, obrigatorio: true },
      { ...UF, obrigatorio: true },
      {
        chave: "tipo",
        rotulo: "Tipo",
        tipo: "texto",
        obrigatorio: false,
        sinonimos: ["tipo", "tipo local", "carga descarga"],
        ajuda: "Carga, descarga ou ambos. Em branco entra como ambos.",
      },
      {
        chave: "lat",
        rotulo: "Latitude",
        tipo: "numero",
        obrigatorio: false,
        sinonimos: ["lat", "latitude", "y"],
        ajuda: "Sem lat/lng o local não é reconhecido por GPS no app.",
      },
      {
        chave: "lng",
        rotulo: "Longitude",
        tipo: "numero",
        obrigatorio: false,
        sinonimos: ["lng", "lon", "long", "longitude", "x"],
      },
    ],
  },
  {
    chave: "materiais",
    rotulo: "Materiais",
    descricao: "O que é transportado: brita, areia, terra, entulho.",
    chaveNatural: "nome",
    permissao: "materiais.criar",
    campos: [
      {
        chave: "nome",
        rotulo: "Nome",
        tipo: "texto",
        obrigatorio: true,
        sinonimos: ["nome", "material", "produto", "carga", "descricao"],
      },
    ],
  },
];

/**
 * O histórico de viagens.
 *
 * Fica fora de `ENTIDADES` acima porque a ordem importa: viagem só entra depois
 * que motorista, veículo, cliente, material e locais existem — ela é a única
 * entidade que aponta pra todas as outras. A tela mostra isso na ordem.
 *
 * Nada aqui cria cadastro: a viagem que cita uma placa desconhecida vira erro
 * na linha com o nome do que faltou. Criar um veículo "ABC1D23" em silêncio no
 * meio de uma importação de viagens é como se monta uma frota fantasma.
 */
export const VIAGENS: EntidadeImportavel = {
  chave: "viagens",
  rotulo: "Viagens (histórico)",
  descricao:
    "O que já rodou. Importe DEPOIS dos cadastros — cada viagem aponta pra um motorista, um veículo e um local que já precisam existir. Entram como enviadas, do mesmo jeito que uma viagem lançada pelo app.",
  // Data + motorista + veículo + ticket é o que distingue duas viagens do mesmo
  // dia. Sem ticket, duas viagens iguais no mesmo dia são uma só — e é por isso
  // que a tela avisa quando a planilha não tem a coluna.
  chaveNatural: "ticket",
  permissao: "importacao.executar",
  campos: [
    {
      chave: "data",
      rotulo: "Data",
      tipo: "data",
      obrigatorio: true,
      sinonimos: ["data", "dia", "data viagem", "data da viagem", "emissao"],
    },
    {
      chave: "motorista",
      rotulo: "Motorista (CPF ou nome)",
      tipo: "texto",
      obrigatorio: true,
      sinonimos: ["motorista", "nome motorista", "condutor", "cpf motorista", "cpf"],
      ajuda: "CPF casa com certeza; nome casa pelo nome exato do cadastro.",
    },
    {
      chave: "placa",
      rotulo: "Placa",
      tipo: "placa",
      obrigatorio: true,
      sinonimos: ["placa", "veiculo", "placa do veiculo", "cavalo", "frota"],
    },
    {
      chave: "cliente",
      rotulo: "Obra",
      tipo: "texto",
      obrigatorio: false,
      sinonimos: ["cliente", "tomador", "contratante", "obra cliente"],
    },
    {
      chave: "material",
      rotulo: "Material",
      tipo: "texto",
      obrigatorio: false,
      sinonimos: ["material", "produto", "carga", "mercadoria"],
    },
    {
      chave: "origem",
      rotulo: "Local de carga",
      tipo: "texto",
      obrigatorio: false,
      sinonimos: ["origem", "local carga", "carga", "pedreira", "saida", "de"],
    },
    {
      chave: "destino",
      rotulo: "Local de descarga",
      tipo: "texto",
      obrigatorio: false,
      sinonimos: ["destino", "local descarga", "descarga", "obra", "entrega", "para"],
    },
    {
      chave: "toneladas",
      rotulo: "Toneladas",
      tipo: "numero",
      obrigatorio: false,
      sinonimos: ["toneladas", "peso", "ton", "t", "quantidade", "peso liquido"],
    },
    {
      chave: "km",
      rotulo: "Km",
      tipo: "numero",
      obrigatorio: false,
      sinonimos: ["km", "distancia", "quilometragem", "km rodado"],
    },
    {
      chave: "ticket",
      rotulo: "Ticket / nota",
      tipo: "texto",
      obrigatorio: false,
      sinonimos: ["ticket", "nota", "nf", "romaneio", "documento", "numero"],
      ajuda: "É o que distingue duas viagens do mesmo motorista no mesmo dia.",
    },
    {
      chave: "valorFrete",
      rotulo: "Valor do frete",
      tipo: "numero",
      obrigatorio: false,
      sinonimos: ["valor", "valor frete", "frete", "total", "valor total", "receita"],
    },
    {
      chave: "valorPedagio",
      rotulo: "Pedágio",
      tipo: "numero",
      obrigatorio: false,
      sinonimos: ["pedagio", "vale pedagio", "valor pedagio"],
    },
  ],
};

export const ENTIDADE_POR_CHAVE = new Map(
  [...ENTIDADES, VIAGENS].map((e) => [e.chave, e]),
);

/** A ordem em que a implantação acontece. Viagem depende de todo o resto. */
export const ORDEM_IMPORTACAO = [...ENTIDADES, VIAGENS];
