import * as FileSystem from "expo-file-system/legacy";
import { Linking, Platform, Share } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { AnexoPedidoMotorista, ViagemProgramada } from "@ronan/shared-types";
import { api, ApiError, request } from "./api";
import { API_URL } from "./api-url";
import { cachePut } from "@/db/database";
import { cacheFirst } from "./queries";
import { motoristaAtivoId, tokensDe } from "./sessoes";
import { hojeISO } from "./datetime";

/**
 * DOCUMENTOS DO PEDIDO no app: croqui de acesso, autorização de entrada, OS do
 * cliente. O papel que vivia no grupo de WhatsApp e não chegava na portaria.
 *
 * ⚠️ Offline é o ponto inteiro. Ele precisa do croqui exatamente onde o sinal
 * acaba — na estrada de terra da obra. Por isso:
 *   - a LISTA vem no cache-first da programação (abre na hora, sem rede);
 *   - o ARQUIVO, depois do primeiro download, fica guardado no aparelho
 *     (`documentDirectory`, que o sistema não limpa sozinho como o cache) e
 *     abre de lá, sem rede nenhuma.
 *
 * ⚠️ Sem módulo nativo novo (tudo aqui chega por OTA): `expo-file-system` já
 * estava no app; foto abre no visualizador do próprio app, PDF abre pelo que o
 * sistema já tem (navegador / menu de compartilhar).
 */

const CACHE_PROGRAMACAO = "q:programacao";
export const QUERY_PROGRAMACAO = ["m", "programacao"] as const;

/** A programação, cache-first: abre na hora com o que estava guardado e revalida. */
export function useMinhaProgramacao(enabled = true) {
  const buscarRede = async (): Promise<ViagemProgramada[]> => {
    const fresh = await api.minhaProgramacao();
    void cachePut(CACHE_PROGRAMACAO, fresh).catch(() => {});
    // Arquivo de documento que saiu da programação (viagem passou, escritório
    // excluiu ou escondeu) não tem por que ocupar o celular dele.
    void limparOrfaos(fresh).catch(() => {});
    return fresh;
  };
  return useQuery({
    queryKey: QUERY_PROGRAMACAO,
    enabled,
    staleTime: 60_000,
    queryFn: () => cacheFirst<ViagemProgramada[]>(QUERY_PROGRAMACAO, CACHE_PROGRAMACAO, buscarRede),
  });
}

/** `anexos` é opcional: cache gravado antes do campo não tem (compat on-read). */
export function anexosDe(p: ViagemProgramada): AnexoPedidoMotorista[] {
  return p.anexos ?? [];
}

export const ehImagem = (mime: string) => mime.startsWith("image/");

export function tamanhoLegivel(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

// ───────────────────────────────────────────────────── arquivo no aparelho

/**
 * Pasta POR CADASTRO: o motorista pode rodar pra mais de uma empresa no mesmo
 * celular, e o papel de uma não pode aparecer pela outra.
 */
async function pasta(): Promise<string | null> {
  const dono = await motoristaAtivoId();
  if (!dono || !FileSystem.documentDirectory) return null;
  return `${FileSystem.documentDirectory}anexos-pedido/${dono}/`;
}

function extensao(mime: string): string {
  if (mime.includes("pdf")) return "pdf";
  if (mime.includes("png")) return "png";
  return "jpg";
}

async function caminhoLocal(a: AnexoPedidoMotorista): Promise<string | null> {
  const dir = await pasta();
  // O id do anexo nunca é reaproveitado: trocar o arquivo no painel é excluir e
  // mandar outro, então o nome aqui nunca aponta pra conteúdo velho.
  return dir ? `${dir}${a.id}.${extensao(a.mime)}` : null;
}

/** Já está no aparelho? Abre sem rede. */
export async function jaGuardado(a: AnexoPedidoMotorista): Promise<string | null> {
  const destino = await caminhoLocal(a);
  if (!destino) return null;
  try {
    const info = await FileSystem.getInfoAsync(destino);
    return info.exists && (info.size ?? 0) > 0 ? destino : null;
  } catch {
    return null;
  }
}

/** Sem sinal e sem cópia guardada: a tela diz isso com todas as letras. */
export class SemSinalError extends Error {
  constructor() {
    super(
      "Sem internet agora, e esse documento ainda não foi aberto neste celular. Assim que pegar sinal, toque de novo — depois disso ele fica guardado e abre até sem sinal.",
    );
  }
}

/** O escritório escondeu ou excluiu o arquivo depois que a lista chegou. */
export class IndisponivelError extends Error {
  constructor() {
    super("Esse documento não está mais disponível. Puxe a lista pra baixo pra atualizar.");
  }
}

function ehFalhaDeRede(e: unknown): boolean {
  // ApiError = o servidor respondeu. Qualquer outra coisa (timeout, sem rede,
  // sessão indisponível) é sinal, não decisão do servidor.
  return !(e instanceof ApiError);
}

/**
 * Pergunta ao servidor se ele ainda pode abrir esse documento e pega o link
 * curto pro leitor do sistema.
 *
 * Passa pelo `request` de propósito: é ele que renova o token vencido (dura
 * 15 min) antes do download, que vai direto pelo `expo-file-system` e não
 * saberia renovar sozinho.
 */
async function pedirLink(a: AnexoPedidoMotorista): Promise<string> {
  try {
    const r = await request<{ caminho: string }>(
      "GET",
      `/m/pedidos/${a.pedidoId}/anexos/${a.id}/link`,
    );
    return `${API_URL}${r.caminho}`;
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) {
      throw new IndisponivelError();
    }
    if (ehFalhaDeRede(e)) throw new SemSinalError();
    throw e;
  }
}

/**
 * Baixa pro aparelho com o token dele (o bucket é privado, o arquivo só sai
 * pela API). Grava num temporário e só move no fim: download cortado pela
 * metade no 4G não pode virar "guardado" e abrir quebrado pra sempre.
 */
async function baixar(a: AnexoPedidoMotorista): Promise<string> {
  const destino = await caminhoLocal(a);
  const dir = await pasta();
  const dono = await motoristaAtivoId();
  const tokens = dono ? await tokensDe(dono).catch(() => null) : null;
  if (!destino || !dir || !tokens?.accessToken) throw new SemSinalError();
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
  const temp = `${destino}.parcial`;
  try {
    const r = await FileSystem.downloadAsync(
      `${API_URL}/m/pedidos/${a.pedidoId}/anexos/${a.id}`,
      temp,
      { headers: { Authorization: `Bearer ${tokens.accessToken}` } },
    );
    if (r.status === 404 || r.status === 403) throw new IndisponivelError();
    if (r.status !== 200) throw new SemSinalError();
    await FileSystem.moveAsync({ from: temp, to: destino });
    return destino;
  } catch (e) {
    await FileSystem.deleteAsync(temp, { idempotent: true }).catch(() => {});
    if (e instanceof IndisponivelError || e instanceof SemSinalError) throw e;
    throw new SemSinalError();
  }
}

/** A foto pro visualizador: do aparelho se já tem, senão baixa (e guarda). */
export async function obterImagem(a: AnexoPedidoMotorista): Promise<string> {
  // Guardado abre JÁ, sem perguntar ao servidor: sem sinal ele precisa do
  // croqui agora. Se o escritório escondeu depois, a cópia sai do aparelho na
  // próxima vez que a programação atualizar (`limparOrfaos`).
  const local = await jaGuardado(a);
  if (local) return local;
  await pedirLink(a); // confere o acesso e deixa o token fresco
  return baixar(a);
}

/**
 * Abre o PDF.
 *
 * Com sinal: pelo link curto, no navegador do celular — que tem leitor de PDF
 * nas duas plataformas — e guarda uma cópia no aparelho em segundo plano.
 *
 * Sem sinal, da cópia guardada:
 *   - iPhone: o menu de compartilhar do sistema, que mostra o PDF e oferece
 *     "Abrir em…"/"Salvar em Arquivos";
 *   - Android: a ponte do React Native não consegue entregar um arquivo do app
 *     a outro app (falta a permissão de leitura no Intent, e consertar isso é
 *     módulo nativo = build novo). Então devolve `"salvar"` e a tela oferece
 *     guardar o PDF numa pasta do celular, de onde qualquer leitor abre.
 */
export async function abrirPdf(a: AnexoPedidoMotorista): Promise<"aberto" | "salvar"> {
  const local = await jaGuardado(a);
  let link: string | null = null;
  try {
    link = await pedirLink(a);
  } catch (e) {
    if (!(e instanceof SemSinalError) || !local) throw e;
  }

  if (link) {
    if (!local) void baixar(a).catch(() => {});
    await Linking.openURL(link);
    return "aberto";
  }

  // Daqui pra baixo: sem sinal, com cópia guardada.
  if (Platform.OS === "ios") {
    await Share.share({ url: local!, title: a.nome });
    return "aberto";
  }
  return "salvar";
}

/**
 * Android sem sinal: copia o PDF guardado pra uma pasta que ELE escolhe
 * (Downloads, por exemplo). O sistema pergunta a pasta; dali o leitor de PDF
 * do celular abre normalmente.
 */
export async function salvarNoCelular(a: AnexoPedidoMotorista): Promise<boolean> {
  const local = await jaGuardado(a);
  if (!local) throw new SemSinalError();
  const saf = FileSystem.StorageAccessFramework;
  const perm = await saf.requestDirectoryPermissionsAsync();
  if (!perm.granted) return false;
  const nome = a.nome.replace(/\.pdf$/i, "");
  const destino = await saf.createFileAsync(perm.directoryUri, nome, a.mime);
  const conteudo = await FileSystem.readAsStringAsync(local, {
    encoding: FileSystem.EncodingType.Base64,
  });
  await FileSystem.writeAsStringAsync(destino, conteudo, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return true;
}

/** Apaga do aparelho o que não está mais em programação nenhuma. */
async function limparOrfaos(programacao: ViagemProgramada[]): Promise<void> {
  const dir = await pasta();
  if (!dir) return;
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) return;
  const vivos = new Set(programacao.flatMap((p) => anexosDe(p).map((a) => a.id)));
  const arquivos = await FileSystem.readDirectoryAsync(dir);
  for (const f of arquivos) {
    const id = f.split(".")[0] ?? "";
    if (!vivos.has(id)) await FileSystem.deleteAsync(`${dir}${f}`, { idempotent: true }).catch(() => {});
  }
}

// ───────────────────────────────────────────── viagem guiada em andamento

/**
 * Qual programação a viagem guiada está cumprindo — pra mostrar os
 * documentos do pedido dela durante a viagem.
 *
 * A viagem guiada não carrega o id da programação (o casamento oficial só
 * acontece no servidor, quando ela termina). Aqui é a mesma ideia, do lado do
 * app e com o cache, pra funcionar sem sinal: mesmo dia, sem contradição de
 * obra nem de local de carga. Conservador como o casamento do servidor:
 * mostrar o croqui do pedido ERRADO manda o caminhão pra portaria errada, então
 * na dúvida entre dois pedidos não mostra nenhum.
 */
export function programacaoDaViagem(
  programacao: ViagemProgramada[],
  viagem: { iniciadoEm: string; clienteId?: string | null; localCargaId?: string | null },
): ViagemProgramada | null {
  const dia = diaBR(viagem.iniciadoEm) ?? hojeISO();
  const candidatas = programacao.filter(
    (p) =>
      p.dataPrevista === dia &&
      ["PUBLICADA", "ACEITA", "EM_EXECUCAO"].includes(p.status) &&
      anexosDe(p).length > 0 &&
      !(p.cliente?.id && viagem.clienteId && p.cliente.id !== viagem.clienteId) &&
      !(p.localCarga?.id && viagem.localCargaId && p.localCarga.id !== viagem.localCargaId),
  );
  // Várias do MESMO pedido (a 1ª e a 2ª viagem do dia) têm os mesmos
  // documentos: isso não é dúvida.
  const pedidos = new Set(candidatas.map((p) => p.pedidoId ?? p.id));
  return pedidos.size === 1 ? candidatas[0]! : null;
}

/** A data de Brasília de um instante ISO (UTC-3 fixo, como `hojeISO`). */
function diaBR(iso: string): string | null {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return new Date(t - 3 * 3_600_000).toISOString().slice(0, 10);
}
