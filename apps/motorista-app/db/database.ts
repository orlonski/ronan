// Storage simples key-value via AsyncStorage.
// Volume real é baixo (cache de catálogos + outbox de poucas viagens),
// AsyncStorage é mais robusto e estável que SQLite no Expo Go.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { chaveDoCadastro, storage } from "../lib/storage";

/**
 * Cache e outbox passam pelo `storage`, que carimba a chave com o cadastro
 * ativo. O motorista pode rodar pra mais de uma empresa e nada de uma pode
 * aparecer na outra — nem na tela, nem (pior) na hora de enviar: com a chave
 * global de antes, o pendente de uma subia com o token da outra.
 */
const PREFIX = "ronan.";

const chave = (sufixo: string) => `${PREFIX}${sufixo}`;

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await storage.getItem(chave(`cache.${key}`));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { v: T; t: number };
    return parsed.v;
  } catch {
    return null;
  }
}

export async function cachePut<T>(key: string, value: T): Promise<void> {
  try {
    await storage.setItem(
      chave(`cache.${key}`),
      JSON.stringify({ v: value, t: Date.now() }),
    );
  } catch {
    /* sem espaco / corrupted — ignora silenciosamente */
  }
}

/** Quando o cache dessa chave foi gravado (Date.now do último cachePut). null =
 *  nunca baixado. Usado pra mostrar "dados atualizados há X" no app. */
export async function cacheGetAt(key: string): Promise<number | null> {
  try {
    const raw = await storage.getItem(chave(`cache.${key}`));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { v: unknown; t: number };
    return typeof parsed.t === "number" ? parsed.t : null;
  } catch {
    return null;
  }
}

/**
 * Joga fora TODO o cache de consultas do cadastro ativo — e só ele.
 *
 * É a reação a descobrir dado de outra empresa aqui dentro (ver a conferência do
 * `/m/me` em `lib/queries.ts`): se um valor veio do namespace errado, os vizinhos
 * podem ter vindo junto, e não dá pra escolher no que confiar. Tudo volta da
 * rede, na empresa certa.
 *
 * NÃO toca no outbox: lançamento do motorista não se apaga por desconfiança de
 * cache — ele é o trabalho dele, e sobe pra empresa a que sempre pertenceu.
 */
export async function limparCacheDeConsultas(): Promise<void> {
  try {
    const prefixo = chave("cache.");
    const alvos = (await storage.getAllKeys()).filter((k) => k.startsWith(prefixo));
    if (alvos.length > 0) await storage.multiRemove(alvos);
  } catch {
    /* sem storage: o cache velho segue, mas a rede já corrige na sequência */
  }
}

/**
 * Apaga o que sobrou no aparelho de obra e diária, que saíram do sistema em
 * 22/09/2026: a fila de "dia na obra" e de "encerrar diária" (as rotas não
 * existem mais — reenviar só daria erro) e o cache das telas que sumiram.
 *
 * Varre TODOS os cadastros (AsyncStorage cru, não o `storage` carimbado): o
 * resto pode estar na empresa que não é a ativa agora. Idempotente — depois
 * da primeira vez não acha nada.
 */
export async function limparRestosDeObraEDiaria(): Promise<void> {
  try {
    const alvos = (await AsyncStorage.getAllKeys()).filter(
      (k) =>
        k.endsWith("outbox.presenca-obra") ||
        k.endsWith("outbox.viagem-encerrar-diaria") ||
        k.includes("cache.q:obra-hoje") ||
        k.includes("cache.q:meus-dias-obra:") ||
        k.includes("cache.q:viagens-aguardando-saida"),
    );
    if (alvos.length > 0) await AsyncStorage.multiRemove(alvos);
  } catch {
    /* sem storage: fica o lixo, que nenhuma tela lê mais */
  }
}

export async function cacheDelete(key: string): Promise<void> {
  try {
    await storage.removeItem(chave(`cache.${key}`));
  } catch {
    /* nope */
  }
}

// Outbox helpers: lista única de pending por tipo, persistida como JSON.
// Volume baixo (motorista lança poucas viagens por dia), tudo na memória.

export type ZodIssueSaved = {
  path: string;
  code: string;
  message: string;
};

export type PendingViagem = {
  clientId: string;
  payload: Record<string, unknown>;
  fotoUri?: string;
  fotoMime?: string;
  status: "pending" | "syncing" | "error";
  attempts: number;
  createdAt: number;
  lastTriedAt?: number;
  errorMsg?: string;
  errorStatus?: number;
  errorIssues?: ZodIssueSaved[];
  /** Falha que o PRÓPRIO app sabe que é definitiva (ex: a foto sumiu do
   * aparelho). Sem isso o rescue de boot, que só olha errorStatus, trataria
   * como transitória e ressuscitaria o item pra sempre. */
  errorPermanenteLocal?: boolean;
};

export type PendingPedagio = {
  clientId: string;
  payload: Record<string, unknown>;
  status: "pending" | "syncing" | "error";
  attempts: number;
  createdAt: number;
  lastTriedAt?: number;
  errorMsg?: string;
  errorStatus?: number;
  errorIssues?: ZodIssueSaved[];
  /** Falha que o PRÓPRIO app sabe que é definitiva (ex: a foto sumiu do
   * aparelho). Sem isso o rescue de boot, que só olha errorStatus, trataria
   * como transitória e ressuscitaria o item pra sempre. */
  errorPermanenteLocal?: boolean;
};

/** Uma foto do abastecimento na fila. `fotoKey` preenchida = já subiu. */
export type FotoPendente = {
  tipo: "CUPOM" | "ODOMETRO" | "BOMBA";
  uri: string;
  mime?: string;
  /** Preenchida depois do upload — é a marca de "não subir de novo". */
  fotoKey?: string;
};

export type PendingAbastecimento = {
  clientId: string;
  payload: Record<string, unknown>;
  /**
   * ⚠️ LEGADO — não remover. Itens enfileirados antes das fotos tipadas têm só
   * estes dois campos, e não existe migração de outbox (o readList só faz
   * JSON.parse). Quem lê tem que aceitar os dois formatos:
   *   item.fotos ?? (item.fotoUri ? [{ tipo: "CUPOM", uri, mime }] : [])
   */
  fotoUri?: string;
  fotoMime?: string;
  /** Formato novo: até três comprovantes (cupom, odômetro, bomba). */
  fotos?: FotoPendente[];
  status: "pending" | "syncing" | "error";
  attempts: number;
  createdAt: number;
  lastTriedAt?: number;
  errorMsg?: string;
  errorStatus?: number;
  errorIssues?: ZodIssueSaved[];
  /** Falha que o PRÓPRIO app sabe que é definitiva (ex: a foto sumiu do
   * aparelho). Sem isso o rescue de boot, que só olha errorStatus, trataria
   * como transitória e ressuscitaria o item pra sempre. */
  errorPermanenteLocal?: boolean;
};

/** Foto a anexar em viagem JÁ sincronizada. Motorista esqueceu de anexar
 * no lançamento; abre a tela de detalhe da viagem e adiciona depois.
 * viagemId é o id real do servidor (viagem precisa existir lá). */
export type PendingFoto = {
  /** UUID gerado client-side pra identificar essa pending. */
  clientId: string;
  viagemId: string;
  fotoUri: string;
  fotoMime: string;
  status: "pending" | "syncing" | "error";
  attempts: number;
  createdAt: number;
  lastTriedAt?: number;
  errorMsg?: string;
  errorStatus?: number;
  errorIssues?: ZodIssueSaved[];
  /** Falha que o PRÓPRIO app sabe que é definitiva (ex: a foto sumiu do
   * aparelho). Sem isso o rescue de boot, que só olha errorStatus, trataria
   * como transitória e ressuscitaria o item pra sempre. */
  errorPermanenteLocal?: boolean;
};

/** Story (foto do trecho) aguardando envio. 2-step no processStory: sobe a foto
 * pro MinIO (/m/uploads/story) e cria o story (POST /m/stories). Idempotente
 * por clientId no backend. Fica no outbox pra postar mesmo em zona sem sinal. */
export type PendingStory = {
  /** UUID client-side — vira o clientId do story (idempotência). */
  clientId: string;
  fotoUri: string;
  fotoMime: string;
  legenda?: string;
  lat?: number;
  lng?: number;
  status: "pending" | "syncing" | "error";
  attempts: number;
  createdAt: number;
  lastTriedAt?: number;
  errorMsg?: string;
  errorStatus?: number;
  errorIssues?: ZodIssueSaved[];
  /** Falha que o PRÓPRIO app sabe que é definitiva (ex: a foto sumiu do
   * aparelho). Sem isso o rescue de boot, que só olha errorStatus, trataria
   * como transitória e ressuscitaria o item pra sempre. */
  errorPermanenteLocal?: boolean;
};

/** Completar peso + ticket de uma viagem JÁ sincronizada que está em
 * AGUARDANDO_PESO (romaneio saiu no fim do dia). viagemId é o id real do
 * servidor (POST /m/viagens/:id/completar-peso). Idempotente no backend. */
export type PendingCompletarPeso = {
  /** UUID client-side pra identificar essa pending. */
  clientId: string;
  viagemId: string;
  payload: { toneladas: number; ticket?: string };
  status: "pending" | "syncing" | "error";
  attempts: number;
  createdAt: number;
  lastTriedAt?: number;
  errorMsg?: string;
  errorStatus?: number;
  errorIssues?: ZodIssueSaved[];
  /** Falha que o PRÓPRIO app sabe que é definitiva (ex: a foto sumiu do
   * aparelho). Sem isso o rescue de boot, que só olha errorStatus, trataria
   * como transitória e ressuscitaria o item pra sempre. */
  errorPermanenteLocal?: boolean;
};

/**
 * Uma BATIDA DE PONTO esperando subir.
 *
 * ⚠️ O item mais sensível do outbox inteiro: é prova de jornada de gente
 * registrada. Perder um destes é perder o registro que o trabalhador fez, e
 * isso não se recupera de lugar nenhum.
 *
 * `clientId` é UUID do aparelho, como todo o resto — e NÃO derivado do horário.
 * Derivar teria três defeitos de uma vez: bucket de 60s dá janela real de 0 a
 * 60s; relógio que recua por NTP produz o mesmo id pra dois toques distintos e
 * some com a segunda batida em silêncio; e amarrar ao id do funcionário deixa
 * sem botão quem ainda não baixou o próprio cadastro. Quem deduplica é o
 * servidor, comparando instantes.
 *
 * `marcadoEm` é carimbado no TOQUE, não no envio: o outbox pode drenar horas
 * depois, e é a hora do toque que vale.
 */
/**
 * Um documento de admissão esperando pra subir.
 *
 * ⚠️ O `clientId` é o ID DA EXIGÊNCIA, não um uuid novo. Refazer a foto antes
 * de sincronizar tem que TROCAR o item da fila, não empilhar dois — senão o
 * servidor recebe a foto tremida depois da boa, e a última a chegar é a que
 * fica (a chave é determinística por exigência).
 *
 * O arquivo não viaja no payload: fica uma cópia dele em `documentDirectory`.
 * ⚠️ NUNCA em `Caches/` — o iOS esvazia esse diretório sob pressão de
 * armazenamento, e um documento pode esperar dias por sinal. Perder a foto de
 * um ticket é aborrecimento; perder a da CTPS faz o motorista chegar na obra
 * convencido de que mandou.
 */
export type PendingDocumentoAdmissao = {
  /** = exigenciaId. */
  clientId: string;
  /** Pra tela de Pendentes dizer QUAL papel é, sem ir buscar na rede. */
  titulo: string;
  arquivoUri: string;
  arquivoMime: string;
  arquivoNome: string;
  status: "pending" | "syncing" | "error";
  attempts: number;
  createdAt: number;
  lastTriedAt?: number;
  errorMsg?: string;
  errorStatus?: number;
  errorIssues?: ZodIssueSaved[];
  errorPermanenteLocal?: boolean;
};

/**
 * Aviso de problema no caminhão ("Avisar problema no caminhão"), com até 3
 * fotos. `clientId` é novo a cada aviso: dois avisos são dois problemas.
 */
export type PendingProblemaVeiculo = {
  clientId: string;
  veiculoId: string | null;
  /** Pra tela de Pendentes mostrar a placa sem ir buscar na rede. */
  placa: string | null;
  descricao: string;
  /** "Dá pra continuar rodando?" (item de antes da pergunta não tem). */
  podeRodar?: "SIM" | "COM_CUIDADO" | "NAO";
  /** Onde parou — só quando `podeRodar` é NAO e o GPS respondeu. */
  lat?: number | null;
  lng?: number | null;
  /** Cópias em `documentDirectory` — o iOS esvazia `Caches/` quando quer. */
  fotos: { tipo: "PROBLEMA"; uri: string; mime: string }[];
  /** Quando ele avisou (o envio pode esperar dias por sinal). */
  avisadoEm: string;
  status: "pending" | "syncing" | "error";
  attempts: number;
  createdAt: number;
  lastTriedAt?: number;
  errorMsg?: string;
  errorStatus?: number;
  errorIssues?: ZodIssueSaved[];
  errorPermanenteLocal?: boolean;
};

/**
 * Checklist do caminhão feito no app. Uma resposta por item; o item reprovado
 * pode ter foto (cópia em `documentDirectory`). `clientId` novo a cada
 * checklist.
 */
export type PendingChecklist = {
  clientId: string;
  veiculoId: string | null;
  /** Pra tela de Pendentes mostrar a placa sem ir buscar na rede. */
  placa: string | null;
  modeloId: string | null;
  /** Quando ele terminou (o envio pode esperar dias por sinal). */
  feitoEm: string;
  lat?: number | null;
  lng?: number | null;
  respostas: {
    itemId: string | null;
    texto: string;
    ok: boolean;
    observacao?: string | null;
    fotoUri?: string | null;
    fotoMime?: string | null;
  }[];
  status: "pending" | "syncing" | "error";
  attempts: number;
  createdAt: number;
  lastTriedAt?: number;
  errorMsg?: string;
  errorStatus?: number;
  errorIssues?: ZodIssueSaved[];
  errorPermanenteLocal?: boolean;
};

export type PendingPonto = {
  clientId: string;
  payload: {
    clientId: string;
    /** ISO completo do instante do toque. */
    marcadoEm: string;
    /** "AAAA-MM-DD" em São Paulo, resolvido no toque. */
    dia: string;
    latitude?: number;
    longitude?: number;
    precisao?: number;
  };
  status: "pending" | "syncing" | "error";
  attempts: number;
  createdAt: number;
  lastTriedAt?: number;
  errorMsg?: string;
  errorStatus?: number;
  errorIssues?: ZodIssueSaved[];
  errorPermanenteLocal?: boolean;
};

/** Local de descarga criado offline. clientId vira id real no servidor
 * (POST /m/locais/rapido aceita id pra idempotência). */
export type EnderecoBuscado = {
  placeId?: string;
  logradouro?: string;
  numero?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  cep?: string;
};

export type PendingLocal = {
  clientId: string;
  payload: {
    nome: string;
    lat: number;
    lng: number;
    precisao?: number;
    fonte?: "PRECISA" | "BALANCED" | "CACHE";
    tipo: "CARGA" | "DESCARGA" | "AMBOS";
    clienteIds?: string[];
    /** Endereço achado na busca do mapa (lat/lng é dele, não do GPS). */
    endereco?: EnderecoBuscado;
  };
  status: "pending" | "syncing" | "error";
  attempts: number;
  createdAt: number;
  lastTriedAt?: number;
  errorMsg?: string;
  errorStatus?: number;
  errorIssues?: ZodIssueSaved[];
  /** Falha que o PRÓPRIO app sabe que é definitiva (ex: a foto sumiu do
   * aparelho). Sem isso o rescue de boot, que só olha errorStatus, trataria
   * como transitória e ressuscitaria o item pra sempre. */
  errorPermanenteLocal?: boolean;
};

/** Lifecycle guiado: abertura da viagem (POST /m/viagem/iniciar). */
export type PendingViagemIniciar = {
  clientId: string; // clientId da viagem (idempotência)
  payload: Record<string, unknown>;
  status: "pending" | "syncing" | "error";
  attempts: number;
  createdAt: number;
  lastTriedAt?: number;
  errorMsg?: string;
  errorStatus?: number;
  errorIssues?: ZodIssueSaved[];
  /** Falha que o PRÓPRIO app sabe que é definitiva (ex: a foto sumiu do
   * aparelho). Sem isso o rescue de boot, que só olha errorStatus, trataria
   * como transitória e ressuscitaria o item pra sempre. */
  errorPermanenteLocal?: boolean;
};

/** Lifecycle: um evento (carga/descarga/parada...) numa viagem em andamento. */
export type PendingEventoViagem = {
  clientId: string; // id do evento (idempotência)
  viagemClientId: string; // clientId da viagem-mãe (gate de ordem no drain)
  payload: Record<string, unknown>;
  fotoUri?: string;
  fotoMime?: string;
  status: "pending" | "syncing" | "error";
  attempts: number;
  createdAt: number;
  lastTriedAt?: number;
  errorMsg?: string;
  errorStatus?: number;
  errorIssues?: ZodIssueSaved[];
  /** Falha que o PRÓPRIO app sabe que é definitiva (ex: a foto sumiu do
   * aparelho). Sem isso o rescue de boot, que só olha errorStatus, trataria
   * como transitória e ressuscitaria o item pra sempre. */
  errorPermanenteLocal?: boolean;
};

/** Lifecycle: cancelamento/descarte de uma viagem em andamento. */
export type PendingViagemCancelar = {
  clientId: string; // clientId da viagem-mãe
  status: "pending" | "syncing" | "error";
  attempts: number;
  createdAt: number;
  lastTriedAt?: number;
  errorMsg?: string;
  errorStatus?: number;
  errorIssues?: ZodIssueSaved[];
  /** Falha que o PRÓPRIO app sabe que é definitiva (ex: a foto sumiu do
   * aparelho). Sem isso o rescue de boot, que só olha errorStatus, trataria
   * como transitória e ressuscitaria o item pra sempre. */
  errorPermanenteLocal?: boolean;
};

/** Lifecycle: finalização da viagem (POST /m/viagem/:clientId/finalizar). */
export type PendingViagemFinalizar = {
  clientId: string; // clientId da viagem-mãe
  payload: Record<string, unknown>;
  fotoUri?: string;
  fotoMime?: string;
  status: "pending" | "syncing" | "error";
  attempts: number;
  createdAt: number;
  lastTriedAt?: number;
  errorMsg?: string;
  errorStatus?: number;
  errorIssues?: ZodIssueSaved[];
  /** Falha que o PRÓPRIO app sabe que é definitiva (ex: a foto sumiu do
   * aparelho). Sem isso o rescue de boot, que só olha errorStatus, trataria
   * como transitória e ressuscitaria o item pra sempre. */
  errorPermanenteLocal?: boolean;
};

/**
 * Mensagem de chat aguardando envio. Fica no outbox pra o motorista escrever
 * em zona sem sinal e a mensagem sair sozinha depois — igual WhatsApp.
 *
 * Diferente dos outros pendentes, ESTE tipo não entra na tela de Pendentes nem
 * na contagem de "X com erro": o lugar natural de ver que a mensagem não saiu
 * é a própria bolha na conversa (relógio / "não enviou, toque pra tentar").
 * Jogar isso na tela de lançamentos misturaria conversa com viagem.
 */
export type PendingMensagemChat = {
  /** UUID client-side — vira o clientId da mensagem (idempotência). */
  clientId: string;
  conversaId: string;
  texto: string;
  status: "pending" | "syncing" | "error";
  attempts: number;
  createdAt: number;
  lastTriedAt?: number;
  errorMsg?: string;
  errorStatus?: number;
  errorIssues?: ZodIssueSaved[];
  errorPermanenteLocal?: boolean;
};

/**
 * GASTO DE VIAGEM (módulo `despesas`) esperando subir.
 *
 * Um item só leva o gasto E as fotos dele, no molde do abastecimento: cada foto
 * sobe em `/m/uploads/despesa` e ganha `fotoKey` ANTES do POST, persistida a
 * cada passo — o que já subiu não sobe de novo. As fotos ficam em
 * `documentDirectory` (nunca em `Caches/`, que o iOS esvazia).
 *
 * `payload` é o corpo do POST sem as fotoKeys (quem junta é o drain). O que a
 * tela precisa pra se desenhar offline (nome do tipo, rótulo da viagem) vem em
 * `resumo`, pra a lista e os Pendentes não dependerem do catálogo.
 */
export type FotoDespesaPendente = {
  uri: string;
  mime: string;
  /** Preenchida depois do upload — é a marca de "não subir de novo". */
  fotoKey?: string;
};

export type PendingDespesa = {
  clientId: string;
  payload: Record<string, unknown>;
  fotos: FotoDespesaPendente[];
  resumo: {
    tipoNome: string;
    tipoIcone?: string | null;
    reembolsa: boolean;
    viagemRotulo?: string | null;
    /**
     * A configuração de campos que ele VIU (CamposDoTipo). Serve pra corrigir
     * o pendente mesmo se o tipo sair do catálogo enquanto espera sinal.
     */
    campos?: unknown;
  };
  /** O servidor recusou a FOTO (4xx no upload): a saída é tirar outra. */
  fotoRecusada?: boolean;
  status: "pending" | "syncing" | "error";
  attempts: number;
  createdAt: number;
  lastTriedAt?: number;
  errorMsg?: string;
  errorStatus?: number;
  errorIssues?: ZodIssueSaved[];
  errorPermanenteLocal?: boolean;
};

/**
 * Ligar (ou soltar) um gasto JÁ ENVIADO a uma viagem. Gasto ainda na fila não
 * vira item destes: edita-se o próprio pendente.
 *
 * A viagem pode ser conhecida só pelo `clientId` (ainda no celular): o servidor
 * resolve quando ela subir. Drena DEPOIS das viagens e dos gastos.
 */
export type PendingVinculoGasto = {
  /** UUID da operação (chave da fila). */
  clientId: string;
  /** Gastos JÁ ENVIADOS — id do servidor ou clientId do celular (o servidor aceita os dois). */
  despesas: string[];
  /** VIAGEM / FORA_DE_VIAGEM / DESFAZER (volta a "sem resposta"). */
  acao: "VIAGEM" | "FORA_DE_VIAGEM" | "DESFAZER";
  viagemId?: string | null;
  viagemClientId?: string | null;
  /** Pra tela de Pendentes e pra lista dizerem o que é, sem rede. */
  resumo: { quantos: number; valor: number; viagemRotulo?: string | null };
  status: "pending" | "syncing" | "error";
  attempts: number;
  createdAt: number;
  lastTriedAt?: number;
  errorMsg?: string;
  errorStatus?: number;
  errorIssues?: ZodIssueSaved[];
  errorPermanenteLocal?: boolean;
};

/**
 * ETAPAS DA VIAGEM: uma resposta de formulário (Documentos da carga, da
 * descarga, Acerto do frete) esperando subir.
 *
 * UM item por resposta (`clientId` da resposta), COALESCIDO: cada vez que ele
 * sai da tela o item é substituído pelo estado inteiro de agora — nunca
 * empilha. `createdAt` é o carimbo DESTE envio: é por ele que o drain sabe se
 * o item na fila ainda é o que ele terminou de mandar (molde da admissão).
 *
 * Os arquivos ficam em `documentDirectory` (nunca `Caches/`, que o iOS
 * esvazia) e sobem UM POR VEZ; `storageKey` preenchida = já subiu, não sobe de
 * novo. `arquivoId` = arquivo que já estava no servidor (outro celular).
 *
 * Nunca espera a viagem existir no servidor: vai com `viagemClientId` e o
 * servidor amarra quando ela chegar.
 */
export type ArquivoEtapaPendente = {
  /** id local do arquivo (estável entre envios — é a marca do que já subiu). */
  id: string;
  itemChave: string;
  uri?: string;
  mime: string;
  nome: string;
  tamanho?: number;
  storageKey?: string;
  arquivoId?: string;
};

export type PendingEtapa = {
  /** clientId da RESPOSTA. */
  clientId: string;
  viagemClientId: string;
  modeloId: string;
  /** O corpo do POST sem os arquivos (quem junta é o drain). */
  payload: Record<string, unknown>;
  arquivos: ArquivoEtapaPendente[];
  /** Pra tela de Pendentes dizer o que é, sem rede nem catálogo. */
  resumo: { modeloNome: string; viagemRotulo: string | null; itensRespondidos: number; itensTotal: number };
  /** O servidor recusou ESTE arquivo (4xx no upload): a saída é tirar outro. */
  arquivoRecusado?: { itemChave: string; arquivoId: string } | null;
  /** O POST recusou as chaves (ARQUIVO_INVALIDO) e os arquivos já subiram de novo uma vez. */
  resubiuArquivos?: boolean;
  status: "pending" | "syncing" | "error";
  attempts: number;
  createdAt: number;
  lastTriedAt?: number;
  errorMsg?: string;
  errorStatus?: number;
  errorIssues?: ZodIssueSaved[];
  errorPermanenteLocal?: boolean;
};

/**
 * "Seguir sem isso": o motorista seguiu sem um documento que o escritório
 * precisa, com o motivo. Sobe DEPOIS da resposta do mesmo formulário (gate no
 * drain), mas não depende dela existir: formulário que ele nunca abriu também
 * tem pendência no servidor.
 */
export type PendingEtapaSeguiuSem = {
  clientId: string;
  viagemClientId: string;
  modeloId: string;
  payload: Record<string, unknown>;
  resumo: { itemRotulo: string; motivoLabel: string };
  status: "pending" | "syncing" | "error";
  attempts: number;
  createdAt: number;
  lastTriedAt?: number;
  errorMsg?: string;
  errorStatus?: number;
  errorIssues?: ZodIssueSaved[];
  errorPermanenteLocal?: boolean;
};

// Sufixos (sem o prefixo do cadastro — quem monta a chave completa é `chave`).
const VIAGENS_KEY = "outbox.viagens";
const MENSAGENS_CHAT_KEY = "outbox.mensagens-chat";
const PEDAGIOS_KEY = "outbox.pedagios";
const ABASTECIMENTOS_KEY = "outbox.abastecimentos";
const LOCAIS_KEY = "outbox.locais";
const FOTOS_KEY = "outbox.fotos";
const STORIES_KEY = "outbox.stories";
const VG_INICIAR_KEY = "outbox.viagem-iniciar";
const VG_EVENTOS_KEY = "outbox.viagem-eventos";
const VG_FINALIZAR_KEY = "outbox.viagem-finalizar";
const VG_CANCELAR_KEY = "outbox.viagem-cancelar";
const COMPLETAR_PESO_KEY = "outbox.viagem-completar-peso";
const PONTO_KEY = "outbox.ponto";
const DOCUMENTO_ADMISSAO_KEY = "outbox.documento-admissao";
const PROBLEMAS_VEICULO_KEY = "outbox.problemas-veiculo";
const CHECKLISTS_KEY = "outbox.checklists";
const DESPESAS_KEY = "outbox.despesas";
const VINCULOS_GASTO_KEY = "outbox.vinculos-gasto";
const ETAPAS_KEY = "outbox.etapas";
const ETAPAS_SEGUIU_SEM_KEY = "outbox.etapas-seguiu-sem";

/** Todos os sufixos do outbox — usado pela adoção/limpeza do storage legado. */
const SUFIXOS_OUTBOX = [
  VIAGENS_KEY,
  MENSAGENS_CHAT_KEY,
  PEDAGIOS_KEY,
  ABASTECIMENTOS_KEY,
  LOCAIS_KEY,
  FOTOS_KEY,
  STORIES_KEY,
  VG_INICIAR_KEY,
  VG_EVENTOS_KEY,
  VG_FINALIZAR_KEY,
  VG_CANCELAR_KEY,
  COMPLETAR_PESO_KEY,
  // Tipo novo TEM que entrar nesta lista: o que fica de fora some do contador
  // de "não enviados" e pode não ser adotado numa migração de storage.
  PONTO_KEY,
  DOCUMENTO_ADMISSAO_KEY,
  PROBLEMAS_VEICULO_KEY,
  CHECKLISTS_KEY,
  DESPESAS_KEY,
  VINCULOS_GASTO_KEY,
  ETAPAS_KEY,
  ETAPAS_SEGUIU_SEM_KEY,
];

async function readList<T>(key: string): Promise<T[]> {
  try {
    const raw = await storage.getItem(chave(key));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as T[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeList<T>(key: string, list: T[]): Promise<void> {
  await storage.setItem(chave(key), JSON.stringify(list));
}

/**
 * Quantos itens do outbox estão parados no cadastro de OUTRA empresa.
 *
 * O drain só roda na empresa ativa (é a que tem token em uso), então o pendente
 * da outra espera ela voltar a ser a ativa. Este número é o que impede isso de
 * virar silêncio: o seletor de empresa mostra "3 não enviados" na linha dela, e
 * o motorista sabe que precisa voltar lá. Só conta — nada do conteúdo sai do
 * namespace da outra empresa.
 */
export async function pendentesDoCadastro(motoristaId: string): Promise<number> {
  let total = 0;
  for (const sufixo of SUFIXOS_OUTBOX) {
    try {
      const raw = await AsyncStorage.getItem(chaveDoCadastro(motoristaId, chave(sufixo)));
      if (!raw) continue;
      const lista = JSON.parse(raw) as unknown[];
      if (Array.isArray(lista)) total += lista.length;
    } catch {
      /* chave corrompida não vira erro de tela */
    }
  }
  return total;
}

export async function listPendingViagens(): Promise<PendingViagem[]> {
  return readList<PendingViagem>(VIAGENS_KEY);
}

export async function listPendingPedagios(): Promise<PendingPedagio[]> {
  return readList<PendingPedagio>(PEDAGIOS_KEY);
}

export async function upsertPendingViagem(item: PendingViagem): Promise<void> {
  const list = await listPendingViagens();
  const idx = list.findIndex((x) => x.clientId === item.clientId);
  if (idx >= 0) list[idx] = item;
  else list.unshift(item);
  await writeList(VIAGENS_KEY, list);
}

export async function upsertPendingPedagio(item: PendingPedagio): Promise<void> {
  const list = await listPendingPedagios();
  const idx = list.findIndex((x) => x.clientId === item.clientId);
  if (idx >= 0) list[idx] = item;
  else list.unshift(item);
  await writeList(PEDAGIOS_KEY, list);
}

export async function deletePendingViagem(clientId: string): Promise<void> {
  const list = await listPendingViagens();
  await writeList(
    VIAGENS_KEY,
    list.filter((x) => x.clientId !== clientId),
  );
}

export async function deletePendingPedagio(clientId: string): Promise<void> {
  const list = await listPendingPedagios();
  await writeList(
    PEDAGIOS_KEY,
    list.filter((x) => x.clientId !== clientId),
  );
}

export async function listPendingAbastecimentos(): Promise<PendingAbastecimento[]> {
  return readList<PendingAbastecimento>(ABASTECIMENTOS_KEY);
}

export async function upsertPendingAbastecimento(
  item: PendingAbastecimento,
): Promise<void> {
  const list = await listPendingAbastecimentos();
  const idx = list.findIndex((x) => x.clientId === item.clientId);
  if (idx >= 0) list[idx] = item;
  else list.unshift(item);
  await writeList(ABASTECIMENTOS_KEY, list);
}

export async function deletePendingAbastecimento(clientId: string): Promise<void> {
  const list = await listPendingAbastecimentos();
  await writeList(
    ABASTECIMENTOS_KEY,
    list.filter((x) => x.clientId !== clientId),
  );
}

export async function listPendingLocais(): Promise<PendingLocal[]> {
  return readList<PendingLocal>(LOCAIS_KEY);
}

export async function upsertPendingLocal(item: PendingLocal): Promise<void> {
  const list = await listPendingLocais();
  const idx = list.findIndex((x) => x.clientId === item.clientId);
  if (idx >= 0) list[idx] = item;
  else list.unshift(item);
  await writeList(LOCAIS_KEY, list);
}

export async function deletePendingLocal(clientId: string): Promise<void> {
  const list = await listPendingLocais();
  await writeList(
    LOCAIS_KEY,
    list.filter((x) => x.clientId !== clientId),
  );
}

// ---- Lifecycle: iniciar / eventos / finalizar ----

export async function listPendingViagemIniciar(): Promise<PendingViagemIniciar[]> {
  return readList<PendingViagemIniciar>(VG_INICIAR_KEY);
}
export async function upsertPendingViagemIniciar(item: PendingViagemIniciar): Promise<void> {
  const list = await listPendingViagemIniciar();
  const idx = list.findIndex((x) => x.clientId === item.clientId);
  if (idx >= 0) list[idx] = item;
  else list.unshift(item);
  await writeList(VG_INICIAR_KEY, list);
}
export async function deletePendingViagemIniciar(clientId: string): Promise<void> {
  const list = await listPendingViagemIniciar();
  await writeList(VG_INICIAR_KEY, list.filter((x) => x.clientId !== clientId));
}

export async function listPendingEventosViagem(): Promise<PendingEventoViagem[]> {
  return readList<PendingEventoViagem>(VG_EVENTOS_KEY);
}
export async function upsertPendingEventoViagem(item: PendingEventoViagem): Promise<void> {
  const list = await listPendingEventosViagem();
  const idx = list.findIndex((x) => x.clientId === item.clientId);
  if (idx >= 0) list[idx] = item;
  else list.push(item); // ordem de ocorrência (append)
  await writeList(VG_EVENTOS_KEY, list);
}
export async function deletePendingEventoViagem(clientId: string): Promise<void> {
  const list = await listPendingEventosViagem();
  await writeList(VG_EVENTOS_KEY, list.filter((x) => x.clientId !== clientId));
}

export async function listPendingViagemFinalizar(): Promise<PendingViagemFinalizar[]> {
  return readList<PendingViagemFinalizar>(VG_FINALIZAR_KEY);
}
export async function upsertPendingViagemFinalizar(item: PendingViagemFinalizar): Promise<void> {
  const list = await listPendingViagemFinalizar();
  const idx = list.findIndex((x) => x.clientId === item.clientId);
  if (idx >= 0) list[idx] = item;
  else list.unshift(item);
  await writeList(VG_FINALIZAR_KEY, list);
}
export async function deletePendingViagemFinalizar(clientId: string): Promise<void> {
  const list = await listPendingViagemFinalizar();
  await writeList(VG_FINALIZAR_KEY, list.filter((x) => x.clientId !== clientId));
}

export async function listPendingViagemCancelar(): Promise<PendingViagemCancelar[]> {
  return readList<PendingViagemCancelar>(VG_CANCELAR_KEY);
}
export async function upsertPendingViagemCancelar(item: PendingViagemCancelar): Promise<void> {
  const list = await listPendingViagemCancelar();
  const idx = list.findIndex((x) => x.clientId === item.clientId);
  if (idx >= 0) list[idx] = item;
  else list.unshift(item);
  await writeList(VG_CANCELAR_KEY, list);
}
export async function deletePendingViagemCancelar(clientId: string): Promise<void> {
  const list = await listPendingViagemCancelar();
  await writeList(VG_CANCELAR_KEY, list.filter((x) => x.clientId !== clientId));
}

export async function listPendingCompletarPeso(): Promise<PendingCompletarPeso[]> {
  return readList<PendingCompletarPeso>(COMPLETAR_PESO_KEY);
}

export async function upsertPendingCompletarPeso(item: PendingCompletarPeso): Promise<void> {
  const list = await listPendingCompletarPeso();
  const idx = list.findIndex((x) => x.viagemId === item.viagemId);
  if (idx >= 0) list[idx] = item;
  else list.unshift(item);
  await writeList(COMPLETAR_PESO_KEY, list);
}

export async function deletePendingCompletarPeso(viagemId: string): Promise<void> {
  const list = await listPendingCompletarPeso();
  await writeList(
    COMPLETAR_PESO_KEY,
    list.filter((x) => x.viagemId !== viagemId),
  );
}

export async function listPendingPonto(): Promise<PendingPonto[]> {
  return readList<PendingPonto>(PONTO_KEY);
}

export async function upsertPendingPonto(item: PendingPonto): Promise<void> {
  const list = await listPendingPonto();
  const i = list.findIndex((x) => x.clientId === item.clientId);
  if (i >= 0) list[i] = item;
  else list.push(item);
  await writeList(PONTO_KEY, list);
}

export async function deletePendingPonto(clientId: string): Promise<void> {
  const list = await listPendingPonto();
  await writeList(
    PONTO_KEY,
    list.filter((x) => x.clientId !== clientId),
  );
}

export async function listPendingDocumentosAdmissao(): Promise<PendingDocumentoAdmissao[]> {
  return readList<PendingDocumentoAdmissao>(DOCUMENTO_ADMISSAO_KEY);
}

export async function upsertPendingDocumentoAdmissao(
  item: PendingDocumentoAdmissao,
): Promise<void> {
  const list = await listPendingDocumentosAdmissao();
  const i = list.findIndex((x) => x.clientId === item.clientId);
  if (i >= 0) list[i] = item;
  else list.push(item);
  await writeList(DOCUMENTO_ADMISSAO_KEY, list);
}

export async function deletePendingDocumentoAdmissao(clientId: string): Promise<void> {
  const list = await listPendingDocumentosAdmissao();
  await writeList(
    DOCUMENTO_ADMISSAO_KEY,
    list.filter((x) => x.clientId !== clientId),
  );
}

export async function listPendingProblemasVeiculo(): Promise<PendingProblemaVeiculo[]> {
  return readList<PendingProblemaVeiculo>(PROBLEMAS_VEICULO_KEY);
}

export async function upsertPendingProblemaVeiculo(item: PendingProblemaVeiculo): Promise<void> {
  const list = await listPendingProblemasVeiculo();
  const i = list.findIndex((x) => x.clientId === item.clientId);
  if (i >= 0) list[i] = item;
  else list.push(item);
  await writeList(PROBLEMAS_VEICULO_KEY, list);
}

export async function deletePendingProblemaVeiculo(clientId: string): Promise<void> {
  const list = await listPendingProblemasVeiculo();
  await writeList(
    PROBLEMAS_VEICULO_KEY,
    list.filter((x) => x.clientId !== clientId),
  );
}

export async function listPendingChecklists(): Promise<PendingChecklist[]> {
  return readList<PendingChecklist>(CHECKLISTS_KEY);
}

export async function upsertPendingChecklist(item: PendingChecklist): Promise<void> {
  const list = await listPendingChecklists();
  const i = list.findIndex((x) => x.clientId === item.clientId);
  if (i >= 0) list[i] = item;
  else list.push(item);
  await writeList(CHECKLISTS_KEY, list);
}

export async function deletePendingChecklist(clientId: string): Promise<void> {
  const list = await listPendingChecklists();
  await writeList(
    CHECKLISTS_KEY,
    list.filter((x) => x.clientId !== clientId),
  );
}

export async function listPendingFotos(): Promise<PendingFoto[]> {
  return readList<PendingFoto>(FOTOS_KEY);
}

export async function upsertPendingFoto(item: PendingFoto): Promise<void> {
  const list = await listPendingFotos();
  const idx = list.findIndex((x) => x.clientId === item.clientId);
  if (idx >= 0) list[idx] = item;
  else list.unshift(item);
  await writeList(FOTOS_KEY, list);
}

export async function deletePendingFoto(clientId: string): Promise<void> {
  const list = await listPendingFotos();
  await writeList(
    FOTOS_KEY,
    list.filter((x) => x.clientId !== clientId),
  );
}

export async function listPendingStories(): Promise<PendingStory[]> {
  return readList<PendingStory>(STORIES_KEY);
}

export async function upsertPendingStory(item: PendingStory): Promise<void> {
  const list = await listPendingStories();
  const idx = list.findIndex((x) => x.clientId === item.clientId);
  if (idx >= 0) list[idx] = item;
  else list.unshift(item);
  await writeList(STORIES_KEY, list);
}

export async function deletePendingStory(clientId: string): Promise<void> {
  const list = await listPendingStories();
  await writeList(
    STORIES_KEY,
    list.filter((x) => x.clientId !== clientId),
  );
}

export async function listPendingMensagensChat(): Promise<PendingMensagemChat[]> {
  return readList<PendingMensagemChat>(MENSAGENS_CHAT_KEY);
}

export async function upsertPendingMensagemChat(
  item: PendingMensagemChat,
): Promise<void> {
  const list = await listPendingMensagensChat();
  const idx = list.findIndex((x) => x.clientId === item.clientId);
  if (idx >= 0) list[idx] = item;
  // Append: a ordem da fila é a ordem em que o motorista escreveu, e é assim
  // que as bolhas aparecem na conversa.
  else list.push(item);
  await writeList(MENSAGENS_CHAT_KEY, list);
}

export async function deletePendingMensagemChat(clientId: string): Promise<void> {
  const list = await listPendingMensagensChat();
  await writeList(
    MENSAGENS_CHAT_KEY,
    list.filter((x) => x.clientId !== clientId),
  );
}

// ---- Gasto de viagem (módulo despesas) ----

export async function listPendingDespesas(): Promise<PendingDespesa[]> {
  return readList<PendingDespesa>(DESPESAS_KEY);
}

export async function upsertPendingDespesa(item: PendingDespesa): Promise<void> {
  const list = await listPendingDespesas();
  const i = list.findIndex((x) => x.clientId === item.clientId);
  if (i >= 0) list[i] = item;
  else list.push(item);
  await writeList(DESPESAS_KEY, list);
}

export async function deletePendingDespesa(clientId: string): Promise<void> {
  const list = await listPendingDespesas();
  await writeList(
    DESPESAS_KEY,
    list.filter((x) => x.clientId !== clientId),
  );
}

export async function listPendingVinculosGasto(): Promise<PendingVinculoGasto[]> {
  return readList<PendingVinculoGasto>(VINCULOS_GASTO_KEY);
}

export async function upsertPendingVinculoGasto(item: PendingVinculoGasto): Promise<void> {
  const list = await listPendingVinculosGasto();
  const i = list.findIndex((x) => x.clientId === item.clientId);
  if (i >= 0) list[i] = item;
  // Append: a ordem importa (ligar e depois desfazer têm que subir nessa ordem).
  else list.push(item);
  await writeList(VINCULOS_GASTO_KEY, list);
}

export async function deletePendingVinculoGasto(clientId: string): Promise<void> {
  const list = await listPendingVinculosGasto();
  await writeList(
    VINCULOS_GASTO_KEY,
    list.filter((x) => x.clientId !== clientId),
  );
}

// ---- Etapas da viagem (módulo etapas) ----

export async function listPendingEtapas(): Promise<PendingEtapa[]> {
  return readList<PendingEtapa>(ETAPAS_KEY);
}

/*
 * A fila de respostas de etapa é COALESCIDA: cada formulário tem UM item, que
 * é substituído inteiro a cada envio novo (`createdAt` diz qual versão é). Por
 * isso ela não pode ter duas mãos fazendo ler-mudar-gravar ao mesmo tempo: o
 * drain lia o item da versão 1, o motorista enfileirava a versão 2, e o drain
 * gravava "versão 1 subindo" por cima — a 2 sumia sem subir e o servidor ficava
 * com o texto velho. Toda escrita aqui passa numa fila só, e quem só quer mudar
 * o ESTADO de um envio (subindo, falhou, reabrir) diz qual versão viu: se a
 * fila já tem outra, não mexe.
 */
let filaEscritaEtapas: Promise<unknown> = Promise.resolve();

function naFilaEtapas<T>(fn: () => Promise<T>): Promise<T> {
  const p = filaEscritaEtapas.then(fn);
  filaEscritaEtapas = p.catch(() => {});
  return p;
}

/** Coloca a versão NOVA do formulário (quem monta recebe a anterior, já dentro da trava). */
export async function substituirPendingEtapa(
  clientId: string,
  montar: (anterior: PendingEtapa | undefined) => PendingEtapa,
): Promise<PendingEtapa> {
  return naFilaEtapas(async () => {
    const list = await listPendingEtapas();
    const i = list.findIndex((x) => x.clientId === clientId);
    const novo = montar(i >= 0 ? list[i] : undefined);
    if (i >= 0) list[i] = novo;
    else list.push(novo);
    await writeList(ETAPAS_KEY, list);
    return novo;
  });
}

/**
 * Muda o item SÓ se ele ainda é a versão que quem chama viu (`createdAt`).
 * `mudar` devolvendo `null` = não mexe. Devolve o item gravado, ou `null`
 * (sumiu, foi substituído por versão mais nova, ou `mudar` desistiu).
 */
export async function atualizarPendingEtapaSeMesmoEnvio(
  clientId: string,
  createdAt: number,
  mudar: (atual: PendingEtapa) => PendingEtapa | null,
): Promise<PendingEtapa | null> {
  return naFilaEtapas(async () => {
    const list = await listPendingEtapas();
    const i = list.findIndex((x) => x.clientId === clientId);
    if (i < 0 || list[i]!.createdAt !== createdAt) return null;
    const novo = mudar(list[i]!);
    if (!novo) return null;
    list[i] = { ...novo, createdAt };
    await writeList(ETAPAS_KEY, list);
    return list[i]!;
  });
}

/** Muda o item que estiver na fila AGORA, qualquer que seja a versão. */
export async function mudarPendingEtapa(
  clientId: string,
  mudar: (atual: PendingEtapa) => PendingEtapa,
): Promise<void> {
  await naFilaEtapas(async () => {
    const list = await listPendingEtapas();
    const i = list.findIndex((x) => x.clientId === clientId);
    if (i < 0) return;
    list[i] = mudar(list[i]!);
    await writeList(ETAPAS_KEY, list);
  });
}

/** Tira da fila SÓ se ainda é a versão que subiu. `true` = tirou. */
export async function removerPendingEtapaSeMesmoEnvio(clientId: string, createdAt: number): Promise<boolean> {
  return naFilaEtapas(async () => {
    const list = await listPendingEtapas();
    const atual = list.find((x) => x.clientId === clientId);
    if (!atual || atual.createdAt !== createdAt) return false;
    await writeList(
      ETAPAS_KEY,
      list.filter((x) => x.clientId !== clientId),
    );
    return true;
  });
}

/** Grava o item como está — só pra quem não tem versão a conferir. */
export async function upsertPendingEtapa(item: PendingEtapa): Promise<void> {
  await substituirPendingEtapa(item.clientId, () => item);
}

export async function deletePendingEtapa(clientId: string): Promise<void> {
  await naFilaEtapas(async () => {
    const list = await listPendingEtapas();
    await writeList(
      ETAPAS_KEY,
      list.filter((x) => x.clientId !== clientId),
    );
  });
}

export async function listPendingEtapasSeguiuSem(): Promise<PendingEtapaSeguiuSem[]> {
  return readList<PendingEtapaSeguiuSem>(ETAPAS_SEGUIU_SEM_KEY);
}

export async function upsertPendingEtapaSeguiuSem(item: PendingEtapaSeguiuSem): Promise<void> {
  const list = await listPendingEtapasSeguiuSem();
  const i = list.findIndex((x) => x.clientId === item.clientId);
  if (i >= 0) list[i] = item;
  else list.push(item);
  await writeList(ETAPAS_SEGUIU_SEM_KEY, list);
}

export async function deletePendingEtapaSeguiuSem(clientId: string): Promise<void> {
  const list = await listPendingEtapasSeguiuSem();
  await writeList(
    ETAPAS_SEGUIU_SEM_KEY,
    list.filter((x) => x.clientId !== clientId),
  );
}
