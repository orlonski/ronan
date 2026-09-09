import { useRef, useState } from "react";
import {
  FileCheck2,
  Inbox,
  MapPin,
  Radio,
  ScanSearch,
  ShieldCheck,
} from "lucide-react";
import { Bloco, Tela, TituloSecao } from "./ui";

const BLOCOS = [
  {
    icone: <Radio size={20} aria-hidden />,
    titulo: "Viagens ao vivo",
    texto:
      "As viagens em andamento aparecem com os eventos chegando: parada, carga, descarga. Você sabe onde a coisa está sem ligar pra ninguém.",
  },
  {
    icone: <ScanSearch size={20} aria-hidden />,
    titulo: "Ticket conferido",
    texto:
      "A IA compara foto e lançamento e separa o que bate do que diverge. Você olha a fila do que precisa de gente, não a pilha inteira.",
  },
  {
    icone: <FileCheck2 size={20} aria-hidden />,
    titulo: "Fecha e vira fatura",
    texto:
      "Fechamento com auditoria: quem conferiu, quando e o que mudou. Relatórios saem exportados no layout de cada cliente.",
  },
  {
    icone: <MapPin size={20} aria-hidden />,
    titulo: "Locais em ordem",
    texto:
      "O que o motorista cadastrou em campo cai numa fila de validação. A aba Mapa acha locais duplicados por proximidade e funde os dois num só.",
  },
  {
    icone: <Inbox size={20} aria-hidden />,
    titulo: "Nada se perde no meio",
    texto:
      "Lançamento que o app não conseguiu enviar aparece em Lançamentos travados, com o conteúdo inteiro, pronto pra recuperar.",
  },
  {
    icone: <ShieldCheck size={20} aria-hidden />,
    titulo: "Cada um vê o seu",
    texto:
      "Papéis e permissões em 110 chaves: quem confere não precisa ver faturamento, quem lança não precisa mexer em cadastro.",
  },
];

const ABAS = [
  {
    id: "andamento",
    rotulo: "Viagens ao vivo",
    src: "/telas/05-viagens-andamento.webp",
    alt: "Painel de viagens em andamento, com cada viagem e os eventos registrados no trajeto.",
    legenda: "Quem está em rota agora, com os eventos chegando do app.",
  },
  {
    id: "conferencia",
    rotulo: "Conferência",
    src: "/telas/06-conciliacao.webp",
    alt: "Tela de conciliação comparando o que foi lançado com o que a leitura do ticket encontrou.",
    legenda: "O que bate passa direto. O que diverge vira fila pra uma pessoa olhar.",
  },
  {
    id: "detalhe",
    rotulo: "Viagem no mapa",
    src: "/telas/04-viagem-detalhe-mapa.webp",
    alt: "Detalhe de uma viagem com o trajeto desenhado no mapa entre carga e descarga.",
    legenda: "Carga, descarga, trajeto e a foto do ticket na mesma tela.",
  },
  {
    id: "frota",
    rotulo: "Mapa",
    src: "/telas/09-mapa-frota.webp",
    alt: "Mapa com motoristas, locais e pedágios da operação.",
    legenda: "Motoristas, locais e pedágios num mapa só.",
  },
  {
    id: "minimos",
    rotulo: "Mínimos",
    src: "/telas/11-regras-minimo.webp",
    alt: "Cadastro de regras de mínimo por empresa, material e faixa de quilometragem.",
    legenda: "O piso do contrato vira regra, não conta de cabeça no fim do mês.",
  },
  {
    id: "permissoes",
    rotulo: "Permissões",
    src: "/telas/08-permissoes.webp",
    alt: "Matriz de permissões do painel, com os acessos de cada papel.",
    legenda: "Você monta o papel de cada pessoa da equipe, sem chamar suporte.",
  },
];

export function Painel() {
  const [ativa, setAtiva] = useState(ABAS[0]!.id);
  const botoes = useRef<(HTMLButtonElement | null)[]>([]);

  // Padrão ARIA de abas: seta esquerda/direita anda entre elas e já seleciona.
  function aoTeclar(e: React.KeyboardEvent, indice: number) {
    const passo = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!passo && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();

    const destino =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? ABAS.length - 1
          : (indice + passo + ABAS.length) % ABAS.length;

    setAtiva(ABAS[destino]!.id);
    botoes.current[destino]?.focus();
  }

  return (
    <section id="painel" className="secao border-t border-borda bg-superficie">
      <div className="caixa">
        <TituloSecao
          etiqueta="Painel"
          titulo="O painel é seu. Ele mostra a operação como ela está, não como alguém digitou."
        />

        <div className="revelar mt-10">
          <div
            role="tablist"
            aria-label="Telas do painel"
            className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-3 sm:mx-0 sm:flex-wrap sm:px-0"
          >
            {ABAS.map((a, i) => {
              const selecionada = a.id === ativa;
              return (
                <button
                  key={a.id}
                  role="tab"
                  type="button"
                  id={`aba-${a.id}`}
                  ref={(el) => {
                    botoes.current[i] = el;
                  }}
                  aria-selected={selecionada}
                  aria-controls={`painel-${a.id}`}
                  tabIndex={selecionada ? 0 : -1}
                  onClick={() => setAtiva(a.id)}
                  onKeyDown={(e) => aoTeclar(e, i)}
                  className={`min-h-[44px] flex-none rounded-lg border px-4 text-[0.92rem] font-medium transition-colors duration-200 ${
                    selecionada
                      ? "border-azul bg-azul text-white"
                      : "border-borda bg-superficie text-tinta-media hover:border-borda-forte hover:text-tinta"
                  }`}
                >
                  {a.rotulo}
                </button>
              );
            })}
          </div>

          {/* Os seis painéis existem sempre no DOM: aria-controls apontando pra
              id inexistente deixa o leitor de tela sem achar o conteúdo. */}
          {ABAS.map((a) => (
            <div
              key={a.id}
              role="tabpanel"
              id={`painel-${a.id}`}
              aria-labelledby={`aba-${a.id}`}
              hidden={a.id !== ativa}
              tabIndex={0}
              className="mt-5"
            >
              <Tela src={a.src} alt={a.alt} />
              <p className="mt-3 text-[0.93rem] text-tinta-media">{a.legenda}</p>
            </div>
          ))}
        </div>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {BLOCOS.map((b, i) => (
            <Bloco key={b.titulo} icone={b.icone} titulo={b.titulo} atraso={i * 55}>
              {b.texto}
            </Bloco>
          ))}
        </div>

        <p className="revelar mt-10 text-[0.98rem] leading-relaxed text-tinta-media">
          <strong className="font-semibold text-tinta">E mais:</strong> motoristas com
          documento e aprovação, veículos, transportadoras terceiras, materiais,
          mínimos por faixa, WhatsApp com o número da sua operação, a sua logo no
          painel e a versão do app instalada em cada motorista.
        </p>
      </div>
    </section>
  );
}
