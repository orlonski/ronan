"use client";

import { use, useRef, useState } from "react";
import { Camera, Check, FileWarning } from "lucide-react";

type DocumentoPedido = {
  tipo: string;
  titulo: string;
  obrigatorio: boolean;
  recebido: boolean;
};

type Pagina = {
  motorista: string;
  expiraEm: string;
  documentos: DocumentoPedido[];
  recebidos: number;
  total: number;
};

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

/**
 * A página que o dono do caminhão ou o motorista abre pelo link.
 *
 * Sem login, sem app, sem cadastro: quem recebe o link tira a foto e pronto.
 * É a porta de entrada da admissão, e hoje esse trabalho é alguém caçando foto
 * no WhatsApp, um documento de cada vez.
 *
 * ⚠️ A PRIMEIRA VERSÃO ERROU EM DOIS PONTOS, e os dois vieram de uso real.
 *
 * Escondia o que já tinha sido enviado, "por privacidade": a pessoa mandava
 * sete arquivos sem saber qual entrou e não tinha como trocar uma foto
 * tremida. O argumento nem se sustentava — a página já mostra o NOME do
 * motorista. Agora mostra o ESTADO de cada item; o arquivo, nunca.
 *
 * E forçava a câmera (`capture`), o que no celular esconde a galeria e os
 * arquivos — justamente onde mora o PDF que o contratante mandou por e-mail.
 *
 * O que continua valendo: um assunto por vez, texto curto, botão grande. Pode
 * ser alguém com pouca familiaridade com celular abrindo isso no pátio.
 */
export default function ColetaPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [pagina, setPagina] = useState<Pagina | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  async function carregar() {
    try {
      const r = await fetch(`${API}/p/coleta/${token}`);
      if (!r.ok) throw new Error("Este link não está mais disponível.");
      setPagina((await r.json()) as Pagina);
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui abrir o link.");
    } finally {
      setCarregando(false);
    }
  }

  if (carregando && !pagina && !erro) void carregar();

  if (erro) {
    return (
      <Moldura>
        <FileWarning className="h-16 w-16 text-amber-500" />
        <p className="mt-4 text-xl font-semibold">{erro}</p>
        <p className="mt-2 text-muted-foreground">
          Peça um link novo para quem te mandou este.
        </p>
      </Moldura>
    );
  }

  if (!pagina) {
    return (
      <Moldura>
        <p className="text-muted-foreground">Abrindo…</p>
      </Moldura>
    );
  }

  const faltam = pagina.documentos.filter((d) => !d.recebido).length;

  return (
    <Moldura alinhar="start">
      <h1 className="text-2xl font-bold">Documentos de {pagina.motorista}</h1>
      {faltam === 0 ? (
        <p className="mt-1 flex items-center gap-2 text-lg font-medium text-emerald-700">
          <Check className="h-6 w-6" strokeWidth={3} />
          Recebemos todos os {pagina.total}.
        </p>
      ) : (
        <p className="mt-1 text-lg text-muted-foreground">
          Recebemos {pagina.recebidos} de {pagina.total}. Faltam {faltam}.
        </p>
      )}

      <div className="mt-6 w-full space-y-3">
        {pagina.documentos.map((d) => (
          <ItemDocumento key={d.tipo} token={token} item={d} onEnviado={() => void carregar()} />
        ))}
      </div>

      <p className="mt-8 text-sm text-muted-foreground">
        Pode mandar foto tirada na hora, imagem da galeria ou PDF. Se sair tremida, mande de novo
        que a nova substitui.
      </p>
    </Moldura>
  );
}

function Moldura({
  children,
  alinhar = "center",
}: {
  children: React.ReactNode;
  alinhar?: "center" | "start";
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-4 py-10">
      <div className={`flex w-full flex-col ${alinhar === "center" ? "items-center text-center" : "items-start"}`}>
        {children}
      </div>
    </main>
  );
}

/**
 * Um documento a mandar. O botão É o item — nada de escolher arquivo num
 * seletor separado e depois confirmar.
 */
function ItemDocumento({
  token,
  item,
  onEnviado,
}: {
  token: string;
  item: DocumentoPedido;
  onEnviado: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [estado, setEstado] = useState<"parado" | "enviando" | "erro">("parado");
  const [msg, setMsg] = useState<string | null>(null);

  async function enviar(file: File) {
    setEstado("enviando");
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("arquivo", file);
      fd.append("tipo", item.tipo);
      const r = await fetch(`${API}/p/coleta/${token}`, { method: "POST", body: fd });
      if (!r.ok) {
        const corpo = (await r.json().catch(() => null)) as { message?: string } | null;
        throw new Error(corpo?.message ?? "Não consegui enviar. Tente de novo.");
      }
      onEnviado();
    } catch (e) {
      setEstado("erro");
      setMsg(e instanceof Error ? e.message : "Não consegui enviar.");
    }
  }

  return (
    <div
      className={`w-full rounded-2xl border-2 p-4 ${
        item.recebido ? "border-emerald-600/50 bg-emerald-500/5" : ""
      }`}
    >
      <div className="flex items-start gap-2">
        {item.recebido && <Check className="mt-1 h-6 w-6 shrink-0 text-emerald-600" strokeWidth={3} />}
        <div className="min-w-0 flex-1">
          <p className="text-lg font-semibold">{item.titulo}</p>
          {item.recebido ? (
            <p className="text-sm text-emerald-700">Recebido</p>
          ) : (
            !item.obrigatorio && <p className="text-sm text-muted-foreground">Opcional</p>
          )}
        </div>
      </div>

      {/* Recebido vira botão de contorno, não some: é o "refazer a foto". Some
          faria a pessoa sem saída quando a primeira sai tremida. */}
      <button
        type="button"
        disabled={estado === "enviando"}
        onClick={() => input.current?.click()}
        className={`mt-3 flex h-20 w-full items-center justify-center gap-3 rounded-xl text-xl font-bold disabled:opacity-60 ${
          item.recebido
            ? "border-2 border-border text-foreground"
            : "bg-[#DF7234] text-white"
        }`}
      >
        <Camera className="h-8 w-8" />
        {estado === "enviando" ? "Enviando…" : item.recebido ? "Trocar" : "Enviar"}
      </button>

      {msg && <p className="mt-2 text-sm text-destructive">{msg}</p>}

      {/* SEM `capture`: com ele o celular abre só a câmera e esconde galeria e
          arquivos — e é na galeria e nos arquivos que mora o PDF que o
          contratante mandou por e-mail. Sem ele, o próprio sistema oferece
          câmera, fotos e arquivos, e quem escolhe é quem está usando. */}
      <input
        ref={input}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void enviar(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
