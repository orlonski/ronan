"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, ClipboardList, LogOut, Receipt, Truck } from "lucide-react";
import type { PortalObraResumo, SessaoPortalObra } from "@ronan/shared-types";
import { API_URL, chamar, ErroPortal, gravarAtiva, gravarSessoes, lerAtiva, lerSessoes } from "./api";
import { Entrar } from "./entrar";
import { AbaResumo } from "./aba-resumo";
import { AbaProgramacao } from "./aba-programacao";
import { AbaTickets } from "./aba-tickets";
import { AbaPedir } from "./aba-pedir";
import { Aviso, Carregando } from "./ui";

type Aba = "resumo" | "programacao" | "tickets" | "pedir";

/**
 * O portal da obra. Uma tela só, com abas embaixo (é celular): resumo da obra,
 * programação, tickets do dia e pedir caminhão.
 *
 * A marca no topo é a da TRANSPORTADORA (logo e nome da conta) — é com ela que
 * a obra tem relação. A Movatruck assina embaixo, discreta.
 */
export function PortalObra() {
  const [pronto, setPronto] = React.useState(false);
  const [sessoes, setSessoes] = React.useState<SessaoPortalObra[]>([]);
  const [ativa, setAtiva] = React.useState<string | null>(null);
  const [aba, setAba] = React.useState<Aba>("resumo");

  // localStorage só existe no navegador: lê depois de montar, pra não
  // desencontrar do HTML do servidor.
  React.useEffect(() => {
    const lista = lerSessoes();
    setSessoes(lista);
    const guardada = lerAtiva();
    setAtiva(lista.find((s) => s.token === guardada)?.token ?? lista[0]?.token ?? null);
    setPronto(true);
  }, []);

  const sessao = sessoes.find((s) => s.token === ativa) ?? null;

  function entrou(novas: SessaoPortalObra[]) {
    // Junta com as que já estavam (outra obra de outro dia), trocando as da
    // mesma obra pelas novas.
    const chave = (s: SessaoPortalObra) => `${s.empresa.nome}|${s.obra.nome}`;
    const novasChaves = new Set(novas.map(chave));
    const lista = [...novas, ...sessoes.filter((s) => !novasChaves.has(chave(s)))];
    setSessoes(lista);
    gravarSessoes(lista);
    setAtiva(novas[0]?.token ?? null);
    gravarAtiva(novas[0]?.token ?? null);
    setAba("resumo");
  }

  const derrubar = React.useCallback(
    (token: string) => {
      const lista = sessoes.filter((s) => s.token !== token);
      setSessoes(lista);
      gravarSessoes(lista);
      const proxima = lista[0]?.token ?? null;
      setAtiva(proxima);
      gravarAtiva(proxima);
    },
    [sessoes],
  );

  async function sair() {
    if (!sessao) return;
    // Revoga no servidor; se a rede falhar, ao menos esquece no aparelho.
    await chamar("/auth/sair", { method: "POST", token: sessao.token }).catch(() => {});
    derrubar(sessao.token);
  }

  if (!pronto) return <Carregando />;
  if (!sessao) return <Entrar onEntrou={entrou} />;

  return (
    <Conteudo
      key={sessao.token}
      sessao={sessao}
      sessoes={sessoes}
      aba={aba}
      onAba={setAba}
      onTrocarObra={(t) => {
        setAtiva(t);
        gravarAtiva(t);
        setAba("resumo");
      }}
      onSessaoCaiu={() => derrubar(sessao.token)}
      onSair={sair}
    />
  );
}

function Conteudo({
  sessao,
  sessoes,
  aba,
  onAba,
  onTrocarObra,
  onSessaoCaiu,
  onSair,
}: {
  sessao: SessaoPortalObra;
  sessoes: SessaoPortalObra[];
  aba: Aba;
  onAba: (a: Aba) => void;
  onTrocarObra: (token: string) => void;
  onSessaoCaiu: () => void;
  onSair: () => void;
}) {
  const qc = useQueryClient();
  const resumo = useQuery({
    queryKey: ["portal-obra", sessao.token, "resumo"],
    queryFn: () => chamar<PortalObraResumo>("/obra", { token: sessao.token }),
    retry: (n, e) => !(e instanceof ErroPortal && (e.status === 401 || e.status === 403)) && n < 2,
  });

  // Sessão revogada/vencida: volta pra entrada sem tela de erro no meio.
  React.useEffect(() => {
    if (resumo.error instanceof ErroPortal && resumo.error.status === 401) onSessaoCaiu();
  }, [resumo.error, onSessaoCaiu]);

  const marca = resumo.data?.marca ?? sessao.empresa;
  const podePedir = resumo.data?.encarregado.podePedirCaminhao ?? false;

  const abas: { chave: Aba; rotulo: string; Icone: typeof Truck }[] = [
    { chave: "resumo", rotulo: "Obra", Icone: ClipboardList },
    { chave: "programacao", rotulo: "Programação", Icone: CalendarDays },
    { chave: "tickets", rotulo: "Tickets", Icone: Receipt },
    ...(podePedir ? [{ chave: "pedir" as Aba, rotulo: "Pedir", Icone: Truck }] : []),
  ];

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {marca.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`${API_URL}${marca.logoUrl}`} alt={marca.nome} className="h-9 w-auto max-w-[120px] object-contain" />
            ) : (
              <span className="truncate text-sm font-bold text-slate-800">{marca.nome}</span>
            )}
          </div>
          <button
            type="button"
            onClick={onSair}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm text-slate-600 hover:bg-slate-100"
          >
            <LogOut className="h-4 w-4" /> Sair
          </button>
        </div>
        {sessoes.length > 1 ? (
          <select
            aria-label="Obra"
            value={sessao.token}
            onChange={(e) => onTrocarObra(e.target.value)}
            className="mt-2 block min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-base font-semibold text-slate-900"
          >
            {sessoes.map((s) => (
              <option key={s.token} value={s.token}>
                {s.obra.nome} · {s.empresa.nome}
              </option>
            ))}
          </select>
        ) : (
          <h1 className="mt-2 truncate text-lg font-bold text-slate-900">{sessao.obra.nome}</h1>
        )}
      </header>

      <main className="flex-1 space-y-4 px-4 pb-28 pt-4">
        {resumo.isLoading && <Carregando />}
        {resumo.error && !(resumo.error instanceof ErroPortal && resumo.error.status === 401) && (
          <Aviso>{(resumo.error as Error).message}</Aviso>
        )}
        {resumo.data && aba === "resumo" && <AbaResumo resumo={resumo.data} onPedir={() => onAba("pedir")} />}
        {resumo.data && aba === "programacao" && <AbaProgramacao token={sessao.token} />}
        {resumo.data && aba === "tickets" && (
          <AbaTickets token={sessao.token} podeVerValores={resumo.data.encarregado.podeVerValores} />
        )}
        {resumo.data && aba === "pedir" && podePedir && (
          <AbaPedir
            token={sessao.token}
            materiais={resumo.data.materiais}
            onEnviado={() => {
              void qc.invalidateQueries({ queryKey: ["portal-obra", sessao.token, "resumo"] });
              onAba("resumo");
            }}
          />
        )}
        <p className="pt-4 text-center text-xs text-slate-400">Acompanhamento pela Movatruck</p>
      </main>

      <nav
        aria-label="Seções"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]"
      >
        <div className="mx-auto grid max-w-2xl" style={{ gridTemplateColumns: `repeat(${abas.length}, minmax(0, 1fr))` }}>
          {abas.map(({ chave, rotulo, Icone }) => {
            const atual = aba === chave;
            return (
              <button
                key={chave}
                type="button"
                onClick={() => onAba(chave)}
                aria-current={atual ? "page" : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium ${
                  atual ? "text-blue-700" : "text-slate-500"
                }`}
              >
                <Icone className="h-5 w-5" />
                {rotulo}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
