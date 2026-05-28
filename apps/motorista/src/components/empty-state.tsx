import type { LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  iconColor = "#94a3b8",
  bgColor = "bg-muted",
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  iconColor?: string;
  bgColor?: string;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-12">
      <div
        className={`mb-4 flex h-24 w-24 items-center justify-center rounded-full ${bgColor}`}
      >
        <Icon size={48} color={iconColor} strokeWidth={1.5} />
      </div>
      <p className="text-center text-lg font-bold text-foreground">{title}</p>
      {description && (
        <p className="mt-1 text-center text-base text-muted-foreground">
          {description}
        </p>
      )}
    </div>
  );
}
