"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Lock, Plus } from "lucide-react";
import {
  CAMPOS_DESPESA,
  CAMPOS_PADRAO,
  CAMPO_DESPESA_LABEL,
  ICONES_TIPO_DESPESA,
  lerConfigCampos,
  nomeReservadoTipoDespesa,
  SLUG_TIPO_OUTRO,
  type CamposDoTipo,
  type CampoDespesa,
  type ModoCampo,
  type ModoFoto,
} from "@ronan/shared-types";
import { AbasDaTela } from "@/components/abas-da-tela";
import { RequerTela } from "@/components/requer-tela";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { LoadingCard } from "@/components/loading";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";
import { usePageTitle } from "@/lib/cabecalho";
import { cn } from "@/lib/utils";
import { emojiDoIcone, type TipoDespesaPainel } from "../_components/comum";
import { PreviaCelular, type TipoNaPrevia } from "../_components/previa-celular";

/**
 * Gastos de viagem › Tipos de gasto (10-telas.md §9).
 *
 * Cada empresa monta a lista e decide, tipo a tipo, o que o celular pede e o
 * que devolve. Com a prévia do celular AO VIVO: quem configura não é quem usa.
 * Tipo nunca se apaga (só desativa): um gasto pode chegar do celular dias
 * depois com o tipo antigo.
 */
export default function TiposDeGastoPage() {
  return (
    <RequerTela chave="tipos-despesa.ver">
      <Tipos />
    </RequerTela>
  );
}

type Rascunho = {
  id: string | null; // null = tipo novo, ainda não salvo
  slug: string;
  nome: string;
  icone: string;
  ativo: boolean;
  devolve: boolean;
  aprovaSozinhoAte: string;
  devolveNoMaximo: string;
  manutencao: boolean;
  podeCobrarCliente: boolean;
  campos: CamposDoTipo;
};

const MODOS_FOTO: { v: ModoFoto; label: string; ajuda: string }[] = [
  { v: "NAO_PEDE", label: "Não pede", ajuda: "O celular nem mostra a câmera." },
  { v: "PEDE", label: "Pede", ajuda: "Ele fotografa se tiver o papel." },
  { v: "EXIGE", label: "Exige", ajuda: "Sem foto, ele precisa contar o que houve." },
];
const MODOS_CAMPO: { v: ModoCampo; label: string }[] = [
  { v: "OCULTO", label: "Não aparece" },
  { v: "OPCIONAL", label: "Opcional" },
  { v: "OBRIGATORIO", label: "Obrigatório" },
];

function deTipo(t: TipoDespesaPainel): Rascunho {
  return {
    id: t.id,
    slug: t.slug,
    nome: t.nome,
    icone: t.icone ?? "outro",
    ativo: t.ativo,
    devolve: t.devolve,
    aprovaSozinhoAte: t.aprovaSozinhoAte ? t.aprovaSozinhoAte.replace(".", ",") : "",
    devolveNoMaximo: t.devolveNoMaximo ? t.devolveNoMaximo.replace(".", ",") : "",
    manutencao: t.manutencao,
    podeCobrarCliente: t.podeCobrarCliente,
    campos: lerConfigCampos(t.campos),
  };
}

const NOVO: Rascunho = {
  id: null,
  slug: "",
  nome: "Novo tipo",
  icone: "outro",
  ativo: true,
  devolve: true,
  aprovaSozinhoAte: "",
  devolveNoMaximo: "",
  manutencao: false,
  podeCobrarCliente: false,
  campos: CAMPOS_PADRAO,
};

const numero = (s: string): number | null => {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
};

function Tipos() {
  usePageTitle("Gastos de viagem");
  const token = useAuthToken();
  const qc = useQueryClient();
  const { temPermissao } = usePermissoes();
  const podeEditar = temPermissao("tipos-despesa.editar");
  const podeCriar = temPermissao("tipos-despesa.criar");
  const tipos = useQuery({
    queryKey: ["tipos-despesa"],
    enabled: !!token,
    queryFn: () => fetchApi<TipoDespesaPainel[]>("/admin/tipos-despesa", { token }),
  });
  const lista = tipos.data ?? [];

  const [selId, setSelId] = React.useState<string | "sistema-pedagio" | "sistema-abastecimento" | "novo" | null>(null);
  const [rascunho, setRascunho] = React.useState<Rascunho | null>(null);
  const [original, setOriginal] = React.useState<string>("");
  const [querTrocarPara, setQuerTrocarPara] = React.useState<string | null>(null);
  const [previa, setPrevia] = React.useState<"formulario" | "lista">("formulario");
  const [erro, setErro] = React.useState<string | null>(null);
  const [salvando, setSalvando] = React.useState(false);

  const sujo = rascunho != null && JSON.stringify(rascunho) !== original;

  const abrir = React.useCallback(
    (id: string) => {
      setErro(null);
      setQuerTrocarPara(null);
      setSelId(id);
      if (id === "novo") {
        setRascunho(NOVO);
        setOriginal(JSON.stringify({ ...NOVO, nome: "" }));
        return;
      }
      const t = lista.find((x) => x.id === id);
      if (!t) {
        setRascunho(null);
        setOriginal("");
        return;
      }
      const r = deTipo(t);
      setRascunho(r);
      setOriginal(JSON.stringify(r));
    },
    [lista],
  );

  React.useEffect(() => {
    if (!selId && lista.length) abrir(lista[0]!.id);
  }, [lista, selId, abrir]);

  function pedirTroca(id: string) {
    if (sujo) setQuerTrocarPara(id);
    else abrir(id);
  }

  function mudar<K extends keyof Rascunho>(k: K, v: Rascunho[K]) {
    setRascunho((r) => (r ? { ...r, [k]: v } : r));
  }
  function mudarCampo(c: CampoDespesa, patch: Partial<CamposDoTipo["campos"][CampoDespesa]>) {
    setRascunho((r) =>
      r ? { ...r, campos: { ...r.campos, campos: { ...r.campos.campos, [c]: { ...r.campos.campos[c], ...patch } } } } : r,
    );
  }

  function ligarManutencao(v: boolean) {
    setRascunho((r) => {
      if (!r) return r;
      const campos = { ...r.campos.campos };
      if (v) {
        // Ligar trava o caminhão em Obrigatório e liga "o que foi feito" (dá pra afrouxar).
        campos.placa = { ...campos.placa, modo: "OBRIGATORIO" };
        campos.descricao = { ...campos.descricao, modo: "OBRIGATORIO" };
      }
      return { ...r, manutencao: v, campos: { ...r.campos, campos } };
    });
  }

  async function salvar() {
    if (!token || !rascunho) return;
    setErro(null);
    const reservado = nomeReservadoTipoDespesa(rascunho.nome);
    if (reservado) {
      setErro("Esse nome não pode virar tipo de gasto: ele já tem caminho próprio no app (ou ficou fora por decisão da empresa).");
      return;
    }
    // Campos limpos: só pergunta/exemplo preenchidos vão (o Zod do servidor é estrito).
    const campos: CamposDoTipo = {
      v: 1,
      foto: rascunho.campos.foto,
      campos: Object.fromEntries(
        CAMPOS_DESPESA.map((c) => {
          const x = rascunho.campos.campos[c];
          return [
            c,
            {
              modo: c === "placa" && rascunho.manutencao ? "OBRIGATORIO" : x.modo,
              ...(x.pergunta?.trim() ? { pergunta: x.pergunta.trim() } : {}),
              ...(x.exemplo?.trim() ? { exemplo: x.exemplo.trim() } : {}),
            },
          ];
        }),
      ) as CamposDoTipo["campos"],
    };
    const body = {
      nome: rascunho.nome.trim(),
      icone: rascunho.icone,
      devolve: rascunho.devolve,
      aprovaSozinhoAte: numero(rascunho.aprovaSozinhoAte),
      devolveNoMaximo: numero(rascunho.devolveNoMaximo),
      manutencao: rascunho.manutencao,
      podeCobrarCliente: rascunho.podeCobrarCliente,
      campos,
      ...(rascunho.id ? { ativo: rascunho.ativo } : {}),
    };
    setSalvando(true);
    try {
      const salvo = await fetchApi<{ id: string }>(
        rascunho.id ? `/admin/tipos-despesa/${rascunho.id}` : "/admin/tipos-despesa",
        { token, method: rascunho.id ? "PATCH" : "POST", body: JSON.stringify(body) },
      );
      toast.success(`${body.nome} salvo. Os celulares recebem na próxima conexão.`);
      await qc.invalidateQueries({ queryKey: ["tipos-despesa"] });
      const atual = await fetchApi<TipoDespesaPainel[]>("/admin/tipos-despesa", { token });
      qc.setQueryData(["tipos-despesa"], atual);
      const t = atual.find((x) => x.id === salvo.id);
      if (t) {
        const r = deTipo(t);
        setSelId(t.id);
        setRascunho(r);
        setOriginal(JSON.stringify(r));
      }
      if (querTrocarPara) abrir(querTrocarPara);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  async function alternarAtivo() {
    if (!token || !rascunho?.id) return;
    try {
      await fetchApi(`/admin/tipos-despesa/${rascunho.id}`, {
        token,
        method: "PATCH",
        body: JSON.stringify({ ativo: !rascunho.ativo }),
      });
      toast.success(rascunho.ativo ? "Tipo desativado. Os gastos já lançados continuam." : "Tipo de volta no celular.");
      const atual = await fetchApi<TipoDespesaPainel[]>("/admin/tipos-despesa", { token });
      qc.setQueryData(["tipos-despesa"], atual);
      const t = atual.find((x) => x.id === rascunho.id);
      if (t) {
        const r = deTipo(t);
        setRascunho(r);
        setOriginal(JSON.stringify(r));
      }
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  async function mover(id: string, passo: -1 | 1) {
    if (!token) return;
    const ids = lista.filter((t) => t.slug !== SLUG_TIPO_OUTRO).map((t) => t.id);
    const i = ids.indexOf(id);
    const j = i + passo;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    const atual = await fetchApi<TipoDespesaPainel[]>("/admin/tipos-despesa/reordenar", {
      token,
      method: "POST",
      body: JSON.stringify({ ids }),
    });
    qc.setQueryData(["tipos-despesa"], atual);
  }

  const ehOutro = rascunho?.slug === SLUG_TIPO_OUTRO;
  const somenteLeitura = rascunho?.id ? !podeEditar : !podeCriar;

  // Prévia: o rascunho no lugar do salvo, pra "Lista de tipos" refletir já.
  const naPrevia: TipoNaPrevia | null = rascunho
    ? {
        id: rascunho.id ?? "novo",
        slug: rascunho.slug,
        nome: rascunho.nome,
        icone: rascunho.icone,
        ativo: rascunho.ativo,
        devolve: rascunho.devolve,
        devolveNoMaximo: numero(rascunho.devolveNoMaximo)?.toFixed(2) ?? null,
        manutencao: rascunho.manutencao,
        campos: rascunho.campos,
      }
    : null;
  const listaPrevia: TipoNaPrevia[] = (() => {
    const base: TipoNaPrevia[] = lista.map((t) => (naPrevia && t.id === naPrevia.id ? naPrevia : t));
    if (naPrevia && naPrevia.id === "novo") {
      const outro = base.findIndex((t) => t.slug === SLUG_TIPO_OUTRO);
      base.splice(outro < 0 ? base.length : outro, 0, naPrevia);
    }
    return base;
  })();

  const ativos = lista.filter((t) => t.ativo);
  const desligados = lista.filter((t) => !t.ativo);
  const sistema = selId === "sistema-pedagio" || selId === "sistema-abastecimento";

  if (tipos.isLoading) return <LoadingCard />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Gastos de viagem</h1>
        <p className="text-sm text-muted-foreground">
          O que o celular pede em cada tipo de gasto e o que a empresa devolve.
        </p>
      </div>
      <AbasDaTela grupo="gastos-viagem" />

      {/* Faixa compacta (até 1535px): a lista vira um Select acima do editor. */}
      <div className="2xl:hidden">
        <Label htmlFor="tipo-select">Tipo</Label>
        <Select id="tipo-select" value={selId ?? ""} onChange={(e) => pedirTroca(e.target.value)}>
          <optgroup label="Já vêm no app">
            <option value="sistema-pedagio">Pedágio</option>
            <option value="sistema-abastecimento">Abastecimento</option>
          </optgroup>
          <optgroup label="Da sua empresa">
            {ativos.map((t) => (
              <option key={t.id} value={t.id}>{t.nome}</option>
            ))}
          </optgroup>
          {desligados.length > 0 && (
            <optgroup label="Desligados">
              {desligados.map((t) => (
                <option key={t.id} value={t.id}>{t.nome}</option>
              ))}
            </optgroup>
          )}
          {selId === "novo" && <option value="novo">Novo tipo</option>}
        </Select>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[300px_minmax(0,1fr)_340px]">
        {/* Lista (só ≥1536px) */}
        <Card className="hidden space-y-4 p-3 2xl:block">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tipos (na ordem do celular)</p>
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Já vêm no app</p>
            {(["sistema-pedagio", "sistema-abastecimento"] as const).map((s) => (
              <button
                key={s}
                className={cn("flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted", selId === s && "bg-muted font-medium")}
                onClick={() => pedirTroca(s)}
              >
                <span aria-hidden>{s === "sistema-pedagio" ? "🛣" : "⛽"}</span>
                {s === "sistema-pedagio" ? "Pedágio" : "Abastecimento"}
                <Lock className="ml-auto h-3 w-3 text-muted-foreground" />
              </button>
            ))}
          </div>
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Da sua empresa</p>
            {ativos.map((t, i) => (
              <div key={t.id} className={cn("flex items-center rounded hover:bg-muted", selId === t.id && "bg-muted")}>
                <button className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-sm" onClick={() => pedirTroca(t.id)}>
                  <span aria-hidden>{emojiDoIcone(t.icone)}</span>
                  <span className={cn("truncate", selId === t.id && "font-medium")}>{t.nome}</span>
                  {!t.devolve && <span className="text-[11px] text-muted-foreground">Por sua conta</span>}
                </button>
                {podeEditar && t.slug !== SLUG_TIPO_OUTRO && (
                  <span className="flex shrink-0">
                    <Button variant="ghost" size="icon" className="h-7 w-7" title="Subir" disabled={i === 0} onClick={() => void mover(t.id, -1)}>
                      <ArrowUp className="h-3 w-3" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" title="Descer" onClick={() => void mover(t.id, 1)}>
                      <ArrowDown className="h-3 w-3" />
                    </Button>
                  </span>
                )}
              </div>
            ))}
          </div>
          {desligados.length > 0 && (
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Desligados</p>
              {desligados.map((t) => (
                <button
                  key={t.id}
                  className={cn("flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted", selId === t.id && "bg-muted")}
                  onClick={() => pedirTroca(t.id)}
                >
                  {t.nome}
                </button>
              ))}
            </div>
          )}
          {podeCriar && (
            <Button className="w-full" onClick={() => pedirTroca("novo")}>
              <Plus className="h-4 w-4" /> Novo tipo de gasto
            </Button>
          )}
        </Card>

        {/* Editor */}
        <Card className="space-y-5 p-4 sm:p-5">
          {querTrocarPara && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              Você mudou {rascunho?.nome ? `a ${rascunho.nome}` : "o tipo"} e não salvou.
              <span className="flex gap-2">
                <Button size="sm" onClick={() => void salvar()} disabled={salvando}>
                  Salvar
                </Button>
                <Button size="sm" variant="destructive" onClick={() => abrir(querTrocarPara)}>
                  Descartar mudanças
                </Button>
              </span>
            </div>
          )}

          {sistema ? (
            <div className="space-y-3 text-sm">
              <h2 className="text-lg font-semibold">{selId === "sistema-pedagio" ? "Pedágio" : "Abastecimento"}</h2>
              <p>
                {selId === "sistema-pedagio"
                  ? "Os campos do pedágio são os de sempre (praça e valor)."
                  : "Os campos do abastecimento são os de sempre (litros, valor, odômetro e as fotos que a modalidade pede)."}{" "}
                Quem decide se devolve é a modalidade de cada motorista.
              </p>
              <p className="flex flex-wrap gap-4">
                <Link href="/modalidades" className="text-primary hover:underline">Abrir modalidades</Link>
                <Link href="/acesso-app" className="text-primary hover:underline">Aparece no app? (Acesso ao app)</Link>
              </p>
              <p className="text-xs text-muted-foreground">
                Ficam sempre em cima no celular e não viram tipo de gasto: têm lançamento próprio, e virar tipo
                pagaria o mesmo dinheiro por dois caminhos.
              </p>
            </div>
          ) : !rascunho ? (
            <p className="text-sm text-muted-foreground">Escolha um tipo.</p>
          ) : (
            <fieldset disabled={somenteLeitura} className="space-y-5">
              {erro && <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">{erro}</div>}

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="nome">Nome</Label>
                  <Input id="nome" value={rascunho.nome} onChange={(e) => mudar("nome", e.target.value)} maxLength={60} />
                </div>
                <div>
                  <Label htmlFor="icone">Ícone</Label>
                  <Select id="icone" value={rascunho.icone} onChange={(e) => mudar("icone", e.target.value)}>
                    {ICONES_TIPO_DESPESA.map((i) => (
                      <option key={i.chave} value={i.chave}>
                        {i.emoji} {i.label}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>

              <section className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">O que o celular pede</p>
                <LinhaCampo label="Foto do comprovante" ajuda={MODOS_FOTO.find((m) => m.v === rascunho.campos.foto)?.ajuda}>
                  <Select
                    value={rascunho.campos.foto}
                    onChange={(e) => setRascunho({ ...rascunho, campos: { ...rascunho.campos, foto: e.target.value as ModoFoto } })}
                  >
                    {MODOS_FOTO.map((m) => (
                      <option key={m.v} value={m.v}>{m.label}</option>
                    ))}
                  </Select>
                </LinhaCampo>
                <LinhaCampo label="Valor">
                  <p className="flex h-10 items-center text-sm text-muted-foreground">Sempre</p>
                </LinhaCampo>
                {CAMPOS_DESPESA.map((c) => {
                  const travado = (c === "placa" && rascunho.manutencao) || (c === "descricao" && ehOutro);
                  const cfg = rascunho.campos.campos[c];
                  return (
                    <div key={c} className="space-y-2">
                      <LinhaCampo
                        label={CAMPO_DESPESA_LABEL[c]}
                        ajuda={
                          c === "placa" && rascunho.manutencao
                            ? "Obrigatório porque é manutenção."
                            : c === "descricao" && ehOutro
                              ? 'No "Outro", ele sempre conta o que pagou.'
                              : c === "onde"
                                ? "O celular preenche pelo GPS; ele pode trocar."
                                : c === "litros" && cfg.modo !== "OCULTO"
                                  ? "Combustível tem lançamento próprio (Abastecimento). Use litros só se o gasto não for diesel/ARLA."
                                  : undefined
                        }
                      >
                        <div className="flex items-center gap-2">
                          <Select
                            value={travado ? "OBRIGATORIO" : cfg.modo}
                            disabled={travado}
                            onChange={(e) => mudarCampo(c, { modo: e.target.value as ModoCampo })}
                          >
                            {MODOS_CAMPO.map((m) => (
                              <option key={m.v} value={m.v}>{m.label}</option>
                            ))}
                          </Select>
                          {travado && <Lock className="h-4 w-4 shrink-0 text-muted-foreground" />}
                        </div>
                      </LinhaCampo>
                      {c === "descricao" && (travado || cfg.modo !== "OCULTO") && (
                        <div className="grid gap-2 pl-0 sm:grid-cols-2 sm:pl-[180px]">
                          <Input
                            placeholder="Pergunta (ex.: O que foi feito?)"
                            value={cfg.pergunta ?? ""}
                            maxLength={80}
                            onChange={(e) => mudarCampo(c, { pergunta: e.target.value })}
                          />
                          <Input
                            placeholder="Exemplo (ex.: remendo no pneu)"
                            value={cfg.exemplo ?? ""}
                            maxLength={120}
                            onChange={(e) => mudarCampo(c, { exemplo: e.target.value })}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
                <p className="text-xs text-muted-foreground">Opcional fica em &ldquo;Mais detalhes&rdquo; no celular.</p>
              </section>

              <section className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Regras</p>
                <Interruptor
                  checked={rascunho.devolve}
                  onChange={(v) => mudar("devolve", v)}
                  label="Devolve ao motorista"
                  ajuda={rascunho.devolve ? undefined : "No celular aparece \"Por sua conta\". Vira só custo do caminhão."}
                />
                <LinhaCampo label="Aprova sozinho até" ajuda='Vazio = o escritório confere todos. Comum: R$ 40 em alimentação.'>
                  <Input inputMode="decimal" placeholder="R$" value={rascunho.aprovaSozinhoAte} onChange={(e) => mudar("aprovaSozinhoAte", e.target.value)} />
                </LinhaCampo>
                <LinhaCampo label="Devolve no máximo" ajuda="Por gasto. Acima disso, chega pra você com o aviso. O motorista vê esse limite no celular.">
                  <Input inputMode="decimal" placeholder="R$" value={rascunho.devolveNoMaximo} onChange={(e) => mudar("devolveNoMaximo", e.target.value)} />
                </LinhaCampo>
                <Interruptor
                  checked={rascunho.manutencao}
                  onChange={ligarManutencao}
                  label="Também é manutenção do caminhão"
                  ajuda="Por enquanto só pede a placa e marca o gasto; virar item no histórico do veículo vem numa próxima etapa."
                />
                <Interruptor
                  checked={rascunho.podeCobrarCliente}
                  onChange={(v) => mudar("podeCobrarCliente", v)}
                  label="Pode ser cobrado do cliente"
                  ajuda='Fica marcado e filtrável em "Todos". Entrar na fatura vem numa próxima etapa.'
                />
              </section>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
                {rascunho.id && !ehOutro && podeEditar ? (
                  <Button type="button" variant={rascunho.ativo ? "warning" : "outline"} onClick={() => void alternarAtivo()}>
                    {rascunho.ativo ? "Desativar tipo" : "Ligar de novo"}
                  </Button>
                ) : (
                  <span />
                )}
                <span className="flex gap-2">
                  <Button type="button" variant="outline" disabled={!sujo} onClick={() => abrir(selId!)}>
                    Cancelar
                  </Button>
                  <Button type="button" disabled={!sujo || salvando || rascunho.nome.trim().length < 2} onClick={() => void salvar()}>
                    Salvar
                  </Button>
                </span>
              </div>
              {rascunho.id && rascunho.ativo && !ehOutro && (
                <p className="text-xs text-muted-foreground">Desativar tira o tipo do celular. Os gastos já lançados continuam.</p>
              )}
            </fieldset>
          )}
        </Card>

        {/* Prévia do celular */}
        <div className="space-y-2 max-lg:order-last">
          <Select value={previa} onChange={(e) => setPrevia(e.target.value as typeof previa)} aria-label="O que mostrar">
            <option value="formulario">Formulário</option>
            <option value="lista">Lista de tipos</option>
          </Select>
          <PreviaCelular
            modo={sistema ? "lista" : previa}
            tipo={naPrevia}
            lista={listaPrevia}
            pendente={sujo}
          />
        </div>
      </div>

      {podeCriar && (
        <div className="2xl:hidden">
          <Button onClick={() => pedirTroca("novo")}>
            <Plus className="h-4 w-4" /> Novo tipo de gasto
          </Button>
        </div>
      )}
    </div>
  );
}

function LinhaCampo({ label, ajuda, children }: { label: string; ajuda?: string; children: React.ReactNode }) {
  return (
    <div className="grid items-start gap-1 sm:grid-cols-[172px_minmax(0,1fr)] sm:gap-2">
      <Label className="pt-2.5">{label}</Label>
      <div>
        {children}
        {ajuda && <p className="mt-1 text-xs text-muted-foreground">{ajuda}</p>}
      </div>
    </div>
  );
}

function Interruptor({
  checked,
  onChange,
  label,
  ajuda,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  ajuda?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input type="checkbox" className="mt-1 h-4 w-4" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="text-sm font-medium">{label}</span>
        {ajuda && <span className="block text-xs text-muted-foreground">{ajuda}</span>}
      </span>
    </label>
  );
}
