"use client";

import { useState } from "react";
import { MotoristasTab } from "./motoristas-tab";
import { VeiculosTab } from "./veiculos-tab";

type Tab = "motoristas" | "veiculos";

export default function FrotaMotoristasPage() {
  const [tab, setTab] = useState<Tab>("motoristas");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Frota & Motoristas</h1>
        <p className="text-sm text-muted-foreground">
          Motoristas e veículos da transportadora. Cada motorista pode estar vinculado a várias placas
          (revezamento).
        </p>
      </header>

      <div className="flex flex-wrap gap-1 border-b">
        {(
          [
            ["motoristas", "Motoristas"],
            ["veiculos", "Veículos"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm transition-colors ${
              tab === key
                ? "border-blue-600 font-medium text-blue-700"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div>
        {tab === "motoristas" && <MotoristasTab />}
        {tab === "veiculos" && <VeiculosTab />}
      </div>
    </div>
  );
}
