import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
	"chamfer-sm inline-flex items-center justify-center border px-2 py-0.5 text-xs font-medium tracking-wide w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-[color,box-shadow] overflow-hidden",
	{
		variants: {
			variant: {
				default:
					"border-transparent bg-primary/10 border-primary/50 text-primary [a&]:hover:bg-primary/90 [a&]:hover:text-primary-foreground",
				secondary: "border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
				destructive:
					"border-transparent bg-destructive/10 border-destructive/50 text-black dark:text-destructive-foreground [a&]:hover:bg-destructive/90 [a&]:hover:text-destructive-foreground focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
				outline: "text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
				success: "border-transparent bg-emerald-500/10 border-emerald-500/40 text-emerald-600 dark:text-emerald-300 [a&]:hover:bg-emerald-500/90 [a&]:hover:text-white",
				warning: "border-transparent bg-amber-500/10 border-amber-500/40 text-amber-600 dark:text-amber-300 [a&]:hover:bg-amber-500/90 [a&]:hover:text-white",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);

function Badge({
	className,
	variant,
	asChild = false,
	...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
	const Comp = asChild ? Slot : "span";

	return <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };