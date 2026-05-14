"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type Props = {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  maxItems?: number;
  className?: string;
};

export function TagInput({
  value,
  onChange,
  placeholder = "Digite e tecle Enter ou vírgula",
  maxItems = 20,
  className,
}: Props) {
  const [draft, setDraft] = React.useState("");

  function add(raw: string) {
    const partes = raw
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p.length > 0 && p.length <= 60);
    if (partes.length === 0) return;
    const proximo = [...value];
    for (const p of partes) {
      const norm = p.toLocaleLowerCase("pt-BR");
      const existe = proximo.some((v) => v.toLocaleLowerCase("pt-BR") === norm);
      if (!existe && proximo.length < maxItems) proximo.push(p);
    }
    onChange(proximo);
    setDraft("");
  }

  function remove(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }

  function onKeyDown(ev: React.KeyboardEvent<HTMLInputElement>) {
    if (ev.key === "Enter" || ev.key === ",") {
      ev.preventDefault();
      if (draft.trim()) add(draft);
    } else if (ev.key === "Backspace" && draft === "" && value.length > 0) {
      remove(value.length - 1);
    }
  }

  function onPaste(ev: React.ClipboardEvent<HTMLInputElement>) {
    const t = ev.clipboardData.getData("text");
    if (t.includes(",") || t.includes("\n")) {
      ev.preventDefault();
      add(t.replace(/\n/g, ","));
    }
  }

  return (
    <div
      className={cn(
        "flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5 text-sm focus-within:ring-2 focus-within:ring-ring",
        className,
      )}
    >
      {value.map((tag, i) => (
        <span
          key={`${tag}-${i}`}
          className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"
        >
          {tag}
          <button
            type="button"
            aria-label={`Remover ${tag}`}
            className="text-muted-foreground hover:text-foreground"
            onClick={() => remove(i)}
          >
            ×
          </button>
        </span>
      ))}
      <input
        type="text"
        className="flex-1 min-w-[8rem] bg-transparent outline-none placeholder:text-muted-foreground"
        placeholder={value.length === 0 ? placeholder : ""}
        value={draft}
        maxLength={60}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onBlur={() => draft.trim() && add(draft)}
      />
    </div>
  );
}
