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
  chave: "clientes" | "motoristas" | "veiculos" | "locais" | "materiais";
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
    rotulo: "Clientes",
    descricao:
      "Quem contrata o frete. Sobe só o nome — é por ele que a importação sabe se o cliente já existe, então subir de novo corrige em vez de duplicar.",
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

export const ENTIDADE_POR_CHAVE = new Map(ENTIDADES.map((e) => [e.chave, e]));
