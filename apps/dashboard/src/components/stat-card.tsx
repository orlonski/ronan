"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Tone = "default" | "success" | "warning" | "danger" | "info";

const TONES: Record<Tone, { iconBg: string; iconText: string; border: string }> = {
  default: {
    iconBg: "bg-slate-100",
    iconText: "text-slate-700",
    border: "border-l-slate-300",
  },
  success: {
    iconBg: "bg-green-100",
    iconText: "text-green-700",
    border: "border-l-green-500",
  },
  warning: {
    iconBg: "bg-amber-100",
    iconText: "text-amber-700",
    border: "border-l-amber-500",
  },
  danger: {
    iconBg: "bg-red-100",
    iconText: "text-red-700",
    border: "border-l-red-500",
  },
  info: {
    iconBg: "bg-blue-100",
    iconText: "text-blue-700",
    border: "border-l-blue-500",
  },
};

export function StatCard({
  icon: Icon,
  label,
  value,
  subtitle,
  tone = "default",
  href,
  size = "md",
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  subtitle?: string;
  tone?: Tone;
  href?: string;
  size?: "md" | "lg";
}) {
  const t = TONES[tone];
  const valueClass = size === "lg" ? "text-4xl" : "text-3xl";

  const inner = (
    <Card
      className={cn(
        "flex h-full items-start gap-3 border-l-4 p-4 transition-shadow",
        t.border,
        href && "cursor-pointer hover:shadow-md",
      )}
    >
      <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-md", t.iconBg)}>
        <Icon className={cn("h-5 w-5", t.iconText)} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className={cn("font-bold tracking-tight tabular-nums", valueClass)}>{value}</p>
        {subtitle && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p>
        )}
      </div>
    </Card>
  );

  if (href) {
    return (
      <Link href={href as never} className="block h-full">
        {inner}
      </Link>
    );
  }
  return inner;
}
