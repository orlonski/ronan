import { ArrowRight, WifiOff } from "lucide-react";
import { Celular, Tela } from "./ui";
import { PAINEL_URL, WHATSAPP_URL } from "../lib/config";

export function Hero() {
  return (
    <section id="topo" className="relative overflow-hidden pb-16 pt-28 lg:pb-24 lg:pt-36">
      {/* Fundo: listras inclinadas do ícone, bem lavadas, só no topo */}
      <div
        aria-hidden="true"
        className="listra pointer-events-none absolute inset-x-0 top-0 h-[520px] opacity-70"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-gradient-to-b from-transparent via-fundo/60 to-fundo"
      />

      <div className="caixa relative">
        <div className="max-w-[52rem]">
          <span className="etiqueta barras">
            <span>Gestão de viagens · carga a granel</span>
          </span>

          <h1 className="mt-5 text-[2.15rem] leading-[1.06] sm:text-[3rem] lg:text-[3.65rem]">
            O motorista lança na estrada.
            <br className="hidden sm:block" />{" "}
            <span className="text-azul">Você fecha o mês com número conferido.</span>
          </h1>

          <p className="mt-6 max-w-[42rem] text-[1.08rem] leading-relaxed text-tinta-media sm:text-[1.2rem]">
            Movatruck é o app que registra viagem, ticket, pedágio e abastecimento
            mesmo sem sinal — e o painel onde a transportadora confere, corrige com
            registro e fecha o período pra faturar. Feito pra areia, brita e concreto.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noreferrer"
              className="btn-primario w-full sm:w-auto"
            >
              Agendar demonstração
              <ArrowRight size={18} aria-hidden />
            </a>
            <a href="#painel" className="btn-secundario w-full sm:w-auto">
              Ver o painel por dentro
            </a>
          </div>

          <p className="mt-5 flex items-start gap-2 text-[0.92rem] text-tinta-fraca">
            <span
              aria-hidden="true"
              className="mt-[7px] h-1.5 w-1.5 flex-none rounded-full bg-verde"
            />
            Já roda em produção, todo dia, numa transportadora de verdade. Nada aqui
            é protótipo.
          </p>
        </div>

        {/* Composição do produto: painel real + app real, sem maquiagem */}
        <div className="relative mt-14 lg:mt-20">
          <Tela
            src="/telas/01-painel-home.webp"
            alt="Painel do Movatruck: viagens, toneladas e motoristas ativos do dia, tendência de 14 dias e o andamento da conferência de viagens."
            prioridade
            className="revelar"
          />

          <div className="revelar mx-auto mt-6 w-[62%] max-w-[240px] sm:w-[46%] lg:absolute lg:-bottom-14 lg:right-6 lg:mt-0 lg:w-[210px]">
            <Celular
              src="/telas/20-app-home.webp"
              alt="Tela inicial do app do motorista: botão grande de Nova viagem, atalhos de pedágio e abastecimento e o resumo do mês."
              prioridade
            />
          </div>

          <div className="revelar absolute -left-3 top-24 hidden items-center gap-2 rounded-lg border border-borda bg-superficie px-3 py-2 text-[0.8rem] font-medium text-tinta shadow-placa lg:flex">
            <WifiOff size={15} className="text-acao" aria-hidden />
            Sem sinal? Lança do mesmo jeito.
          </div>
        </div>
      </div>
    </section>
  );
}
