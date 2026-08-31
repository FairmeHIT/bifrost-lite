import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import { ShieldX } from "lucide-react";

interface NoPermissionViewProps {
	entity: string;
	className?: string;
	align?: "middle" | "top";
}

export function NoPermissionView({ entity, className, align = "middle" }: NoPermissionViewProps) {
	const { t } = useI18n();
	return (
		<div
			className={cn(
				"flex min-h-[calc(100vh-200px)] flex-col items-center  gap-4 text-center",
				align === "middle" ? "justify-center" : "justify-start",
				className,
			)}
		>
			<div className="text-muted-foreground">
				<ShieldX className="h-16 w-16" strokeWidth={1} />
			</div>
			<div className="flex flex-col items-center gap-1">
				<h1 className="text-muted-foreground text-xl font-medium">{t("permission.noAccessEntity", { entity })}</h1>
				<p className="text-muted-foreground mt-2 max-w-[400px] text-sm font-normal">{t("permission.contactAdmin")}</p>
			</div>
		</div>
	);
}