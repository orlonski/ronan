import type { MudancaAcessoApp, RegraAcessoAppInput } from "@ronan/shared-types";

export type PerfilApp = {
  id: string;
  nome: string;
  descricao: string | null;
  ativo: boolean;
  capacidades: string[];
  pessoas: number;
};

export type RegraApp = RegraAcessoAppInput & { id: string; ordem: number };

export type PainelAcessoApp = {
  fonte: "COLUNAS" | "REGRAS";
  versao: number;
  camadasEmSombra: string[];
  espelho: { em: string | null; divergencias: number | null };
  perfilPadraoMotoristaId: string | null;
  perfilPadraoFuncionarioId: string | null;
  /**
   * As colunas da tabela: uma por modalidade (Motoristas › Modalidades), mais
   * "SEM_MODALIDADE" e "SO_PONTO". `herda` = a modalidade ainda não tem
   * configuração própria e recebe o mesmo que "sem modalidade".
   */
  colunas: ColunaApp[];
  perfis: PerfilApp[];
  regras: RegraApp[];
  pessoas: number;
  excecoes: Record<string, number>;
  /** Exceções abertas com data que vencem nos próximos 7 dias. */
  excecoesVencendo: number;
  sombra: { capacidade: string; pessoas: number }[];
  rolloutsApp: string[];
  /** O que o servidor já barra no `/m/*` desta empresa (F4). */
  capacidadesTravadas: string[];
  opcoes: {
    modalidades: { id: string; nome: string }[];
    transportadoras: { id: string; nome: string }[];
  };
  plataforma: boolean;
};

export type ColunaApp = {
  chave: string;
  nome: string;
  quem: string;
  capacidades: string[];
  herda: boolean;
  pessoas: number;
  /**
   * Por item: quantas pessoas do grupo estão diferentes dele só por causa da
   * ficha antiga (exceção herdada na virada pra tabela).
   */
  herdadas: Record<string, { naoVeem: number; tambemVeem: number }>;
};

/** `herdadas`: quantas diferenças da ficha antiga deixam de valer ao salvar. */
export type Simulacao = { total: number; mudam: MudancaAcessoApp[]; herdadas?: number };

export const CHAVE_PAINEL = ["/admin/acesso-app"];
