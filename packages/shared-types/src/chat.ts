import { z } from "zod";

/**
 * Chat entre motoristas (aba Conversas do app nativo). Escopo enxuto de
 * propósito: 1:1 e um canal de Avisos da operação — sem grupo, sem status,
 * sem chamada.
 *
 * Zod é a fonte da verdade do que entra; os tipos de saída descrevem o que
 * os endpoints devolvem pro app.
 */

export const MAX_TEXTO_MENSAGEM = 2000;

export const TipoConversaEnum = z.enum(["DIRETA", "AVISOS"]);
export type TipoConversa = z.infer<typeof TipoConversaEnum>;

export const TipoMensagemChatEnum = z.enum(["TEXTO", "AUDIO"]);
export type TipoMensagemChat = z.infer<typeof TipoMensagemChatEnum>;

/** Motivos de denúncia. Lista fixa — vira botão na UI, não campo livre. */
export const MOTIVOS_DENUNCIA = [
  "OFENSIVO",
  "SPAM",
  "ASSEDIO",
  "GOLPE",
  "OUTRO",
] as const;
export const MotivoDenunciaEnum = z.enum(MOTIVOS_DENUNCIA);
export type MotivoDenuncia = z.infer<typeof MotivoDenunciaEnum>;

export const MOTIVO_DENUNCIA_LABEL: Record<MotivoDenuncia, string> = {
  OFENSIVO: "Conteúdo ofensivo",
  SPAM: "Propaganda / spam",
  ASSEDIO: "Perseguição ou ameaça",
  GOLPE: "Tentativa de golpe",
  OUTRO: "Outro motivo",
};

// ── Entradas ────────────────────────────────────────────────────────────────

/** Abre (ou recupera) a conversa 1:1 com outro motorista. Idempotente. */
export const AbrirConversaInput = z.object({
  motoristaId: z.string().uuid(),
});
export type AbrirConversaInput = z.infer<typeof AbrirConversaInput>;

/**
 * Mensagem de texto. O `clientId` vem do celular e é a idempotência do outbox:
 * reenviar depois de um timeout devolve a mensagem que já entrou, em vez de
 * duplicar a bolha na conversa.
 */
export const EnviarMensagemChatInput = z.object({
  clientId: z.string().uuid(),
  texto: z.string().trim().min(1).max(MAX_TEXTO_MENSAGEM),
});
export type EnviarMensagemChatInput = z.infer<typeof EnviarMensagemChatInput>;

export const DenunciarMensagemInput = z.object({
  motivo: MotivoDenunciaEnum,
  detalhe: z.string().trim().max(500).optional(),
});
export type DenunciarMensagemInput = z.infer<typeof DenunciarMensagemInput>;

export const BloquearMotoristaInput = z.object({
  motoristaId: z.string().uuid(),
});
export type BloquearMotoristaInput = z.infer<typeof BloquearMotoristaInput>;

/** Aviso da operação pro canal (dashboard). */
export const PublicarAvisoInput = z.object({
  texto: z.string().trim().min(1).max(MAX_TEXTO_MENSAGEM),
});
export type PublicarAvisoInput = z.infer<typeof PublicarAvisoInput>;

export const ResolverDenunciaInput = z.object({
  /** ARQUIVADA = sem violação; REMOVIDA = apaga a mensagem pros dois lados. */
  status: z.enum(["ARQUIVADA", "REMOVIDA"]),
});
export type ResolverDenunciaInput = z.infer<typeof ResolverDenunciaInput>;

// ── Saídas ──────────────────────────────────────────────────────────────────

/** Contato disponível pra conversar. Sem telefone: motorista é parceiro
 *  autônomo, o contato dele não é da conta dos outros. */
export interface ContatoChat {
  motoristaId: string;
  nome: string;
  /** Iniciais pro avatar (o app não baixa foto de perfil hoje). */
  iniciais: string;
  /** Conversa já existente com esse contato, se houver. */
  conversaId: string | null;
}

export interface MensagemChatItem {
  id: string;
  clientId: string;
  conversaId: string;
  autor: "ADMIN" | "MOTORISTA";
  /** null quando o autor foi excluído — `autorNome` é o snapshot. */
  motoristaId: string | null;
  autorNome: string;
  /** true se fui eu que escrevi (a bolha vai pra direita). */
  meu: boolean;
  tipo: TipoMensagemChat;
  /** null quando apagada, ou quando é áudio sem transcrição ainda. */
  texto: string | null;
  audioSegundos: number | null;
  transcricao: string | null;
  criadoEm: string; // ISO
  apagada: boolean;
  /** true quando a operação removeu por denúncia (texto diferente na bolha). */
  removidaPelaOperacao: boolean;
}

export interface ConversaResumo {
  id: string;
  tipo: TipoConversa;
  /** Nome do outro lado (ou "Avisos da Schaba" no canal). */
  titulo: string;
  iniciais: string;
  /** null no canal de Avisos. */
  outroMotoristaId: string | null;
  ultimaMensagemTexto: string | null;
  ultimaMensagemEm: string | null; // ISO
  naoLidas: number;
  silenciado: boolean;
}

export interface ListaConversasResponse {
  conversas: ConversaResumo[];
  /** Soma de não lidas — alimenta o badge da aba. */
  totalNaoLidas: number;
}

export interface MensagensChatResponse {
  conversa: ConversaResumo;
  mensagens: MensagemChatItem[];
  /** Cursor pra página anterior (mensagens mais antigas). null = acabou. */
  cursorAnterior: string | null;
  /** true quando o motorista só lê (canal de Avisos). */
  somenteLeitura: boolean;
}

/** Resposta do poll: só o que mudou desde `desde`. Barata de propósito. */
export interface NovidadesChatResponse {
  /** ISO do servidor — o app manda de volta no próximo poll. */
  agora: string;
  totalNaoLidas: number;
  /** Mensagens novas da conversa consultada (quando `conversaId` foi passado). */
  mensagens: MensagemChatItem[];
  /** Conversas com mensagem nova desde `desde` — pra repintar a lista. */
  conversasAtualizadas: string[];
}

export interface DenunciaChatAdmin {
  id: string;
  motivo: MotivoDenuncia;
  detalhe: string | null;
  status: "ABERTA" | "ARQUIVADA" | "REMOVIDA";
  criadoEm: string; // ISO
  denunciante: { id: string; nome: string };
  autor: { id: string | null; nome: string };
  /** Texto da mensagem denunciada + as vizinhas, pra dar contexto. */
  mensagem: { id: string; texto: string | null; criadoEm: string; apagada: boolean };
  contexto: { autorNome: string; texto: string | null; criadoEm: string }[];
}
