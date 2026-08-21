import { ThemeToggle } from "./themeToggle";

export default function Header({ title }: { title: string }) {
	return (
		<div className="bg-background/80 fixed top-0 right-0 left-(--sidebar-width) z-10 border-border border-b backdrop-blur-md">
			<div className="flex items-center justify-between px-4">
				<div className="text-title text-glow p-3 font-semibold tracking-[0.2em]">
					<span className="text-accent-bright/70 mr-2 font-mono text-xs">{"//"}</span>
					{title}
				</div>
				<ThemeToggle />
			</div>
		</div>
	);
}
