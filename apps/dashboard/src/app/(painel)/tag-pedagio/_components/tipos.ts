/** Formatos das respostas de `admin/tag-pedagio/*` (o que a tela usa). */

export type Checagem = { n: number; nome: string; ok: boolean; detalhe: string };

export type Extrato = {
  id: string;
  status: "LIDO" | "LIDO_COM_DIVERGENCIA" | "FALHOU";
  motivo: string | null;
  nomeArquivo: string;
  numeroFatura: string | null;
  periodoDe: string | null;
  periodoAte: string | null;
  importadoEm: string;
  importadoPor: string | null;
  passagens: number;
  nomeFatura: string | null;
  cnpjConfirmado: boolean;
  temArquivo: boolean;
  placas: { placa: string; pedagio: number; cadastrada: boolean }[];
  totalPedagio: number;
  checagens: Checagem[];
  naoLidas: { linha: number; texto: string; motivo: string }[];
};

export type PassagemTela = {
  id: string;
  tipo: "PEDAGIO" | "VALE";
  quando: string;
  hora: string;
  praca: string;
  cidade: string;
  sentido: string;
  categoria: number;
  eixos: number;
  valor: number;
  placa: string;
  vale: { viagem: string | null } | null;
};

export type ViagemRotulo = {
  id: string;
  rotulo: string;
  data: string | null;
  placa: string;
  cliente?: string | null;
  motorista?: string;
  guiada?: boolean;
  empresaId?: string | null;
};

export type Achado = {
  id: string;
  tipo: string;
  caixa: "PODE_SER_SEU" | "PRA_CONTESTAR" | "PRA_CONVERSAR";
  placa: string | null;
  valor: number | null;
  titulo: string;
  explicacao: string;
  explicacoes: string[] | null;
  prazoEm: string | null;
  status: "ABERTO" | "CONFERIDO" | "CONTESTADO" | "DESCARTADO";
  motivo: string | null;
  passagemAncoraId: string | null;
  passagens: PassagemTela[];
  viagem: ViagemRotulo | null;
  resposta: {
    resposta: "CLIENTE" | "CARGA_PROPRIA" | "PAGOU_DE_OUTRO_JEITO" | "NAO_SEI";
    empresa: { id: string; nome: string } | null;
    comprovante: string | null;
    observacao: string | null;
  } | null;
  empresaSugeridaId: string | null;
};

export type RaioX = {
  extrato: Omit<Extrato, "importadoPor" | "placas"> & {
    totalNota: number | null;
    placas: { placa: string; pedagio: number; usos: number; veiculoId: string | null; cadastrada: boolean; terceiro: boolean }[];
  };
  ligacaoAutomatica: boolean;
  podeSerSeu: {
    ate: number;
    viagens: number;
    carregadoSemVale: number;
    valeParcial: number;
    confirmado: number;
    viagensConfirmadas: number;
    itens: Achado[];
  };
  praContestar: { valor: number; prazoAte: string | null; itens: Achado[] };
  praConversar: { valor: number; itens: Achado[] };
  viagensSemPassagem: { viagem: ViagemRotulo | null; pracas: number }[];
  viagensXTag: {
    ligadas: number;
    sugestoes: number;
    ligariamSozinhas: number;
    semViagem: { trechos: number; valor: number };
    vaziosSoltos: { trechos: number; valor: number };
    retornos: { trechos: number; valor: number };
    carregados: number;
  };
};

export type TrechoTela = {
  passagemAncoraId: string;
  estado: "CARREGADO" | "VAZIO";
  ini: string;
  fim: string;
  valorTag: number;
  valorVale: number;
  passagens: (PassagemTela & { ocorridoEm: string })[];
  situacao: string;
  decidida: boolean;
  viagem: ViagemRotulo | null;
  motivo: string;
  razao: string | null;
  ligacao: { tipo: string; autorId: string | null; criadoEm: string } | null;
  candidatas: { viagemId: string; pontos: number; razao: string; janela: string; viagem: ViagemRotulo | null }[];
};

export type Casamento = {
  placa: string;
  dias: { dia: string; trechos: number; pendentes: number }[];
  dia: string | null;
  trechos: TrechoTela[];
  viagensDoDia: ViagemRotulo[];
  pracasSemCobranca: { viagemId: string; praca: string; chave: string }[];
};

export type PracaFila = {
  operadora: string;
  chavePraca: string;
  rodovia: string;
  km: number;
  cidade: string;
  concessionaria: string | null;
  tarifaEixo: number | null;
  passagens: number;
  sede: { lat: number; lng: number } | null;
  motivo: string;
  candidatos: {
    pedagioRodoviaId: string;
    nome: string;
    lat: number;
    lng: number;
    rodovias: string[];
    operadora: string;
    distanciaKm: number;
    tempos: { vizinha: string; observadoMin: number; rotaMin: number | null }[];
  }[];
};

export const brl = (v: number | null | undefined) =>
  (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const dia = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : "—";
export const diaCurto = (iso: string | null | undefined) => dia(iso).slice(0, 5);
export const diaSP = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—";
