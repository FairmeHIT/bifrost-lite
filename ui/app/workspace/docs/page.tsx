import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import GradientHeader from "@/components/ui/gradientHeader";
import { useI18n } from "@/lib/i18n/context";
import { BookOpen, Code, ExternalLink, FileText, GitBranch, Play, Shield, Users, Zap } from "lucide-react";

export default function DocsPage() {
	const { t } = useI18n();

	const docSections = [
		{
			slug: "quick-start",
			title: t("docs.quickStart.title"),
			description: t("docs.quickStart.description"),
			icon: Play,
			url: "https://github.com/maximhq/bifrost/tree/main/docs/quickstart",
			badge: t("docs.quickStart.badge"),
			items: [t("docs.quickStart.item1"), t("docs.quickStart.item2"), t("docs.quickStart.item3")],
		},
		{
			slug: "architecture",
			title: t("docs.architecture.title"),
			description: t("docs.architecture.description"),
			icon: GitBranch,
			url: "https://github.com/maximhq/bifrost/tree/main/docs/architecture",
			items: [t("docs.architecture.item1"), t("docs.architecture.item2"), t("docs.architecture.item3"), t("docs.architecture.item4")],
		},
		{
			slug: "usage-guides",
			title: t("docs.usage.title"),
			description: t("docs.usage.description"),
			icon: BookOpen,
			url: "https://github.com/maximhq/bifrost/tree/main/docs/usage",
			badge: t("docs.usage.badge"),
			items: [t("docs.usage.item1"), t("docs.usage.item2"), t("docs.usage.item3"), t("docs.usage.item4")],
		},
		{
			slug: "contributing",
			title: t("docs.contributing.title"),
			description: t("docs.contributing.description"),
			icon: Users,
			url: "https://github.com/maximhq/bifrost/tree/main/docs/contributing",
			items: [t("docs.contributing.item1"), t("docs.contributing.item2"), t("docs.contributing.item3"), t("docs.contributing.item4")],
		},
		{
			slug: "integration-examples",
			title: t("docs.integration.title"),
			description: t("docs.integration.description"),
			icon: Code,
			url: "https://github.com/maximhq/bifrost/tree/main/docs/usage/http-transport/integrations",
			items: [t("docs.integration.item1"), t("docs.integration.item2"), t("docs.integration.item3"), t("docs.integration.item4")],
		},
		{
			slug: "benchmarks",
			title: t("docs.benchmarks.title"),
			description: t("docs.benchmarks.description"),
			icon: Zap,
			url: "https://github.com/maximhq/bifrost/blob/main/docs/benchmarks.md",
			items: [t("docs.benchmarks.item1"), t("docs.benchmarks.item2"), t("docs.benchmarks.item3"), t("docs.benchmarks.item4")],
		},
	];

	const featuredDocs = [
		{
			slug: "mcp-documentation",
			title: t("docs.featuredMcp.title"),
			description: t("docs.featuredMcp.description"),
			content: t("docs.featuredMcp.content"),
			href: "https://github.com/maximhq/bifrost/blob/main/docs/mcp.md",
			icon: FileText,
			buttonText: t("docs.featuredMcp.buttonText"),
			borderColor: "border-primary/20",
			backgroundColor: "bg-primary/5",
			iconColor: "text-primary",
		},
		{
			slug: "governance-plugin",
			title: t("docs.featuredGovernance.title"),
			description: t("docs.featuredGovernance.description"),
			content: t("docs.featuredGovernance.content"),
			href: "https://github.com/maximhq/bifrost/blob/main/docs/governance.md",
			icon: Shield,
			buttonText: t("docs.featuredGovernance.buttonText"),
			borderColor: "border-green-200 dark:border-green-800",
			backgroundColor: "bg-green-50 dark:bg-green-950/20",
			iconColor: "text-green-600",
		},
	];

	return (
		<div className="dark:bg-card bg-white">
			<div className="mx-auto max-w-7xl">
				<div className="space-y-8">
					{/* Header */}
					<div className="space-y-4 text-center">
						<div className="bg-primary/10 text-primary inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm">
							<BookOpen className="h-4 w-4" />
							<span className="font-semibold">{t("docs.title")}</span>
						</div>
						<GradientHeader title={t("docs.header")} />
						<p className="text-muted-foreground mx-auto max-w-2xl text-lg">{t("docs.subtitle")}</p>
						<div className="flex justify-center gap-4">
							<Button asChild>
								<a
									href="https://github.com/maximhq/bifrost/tree/main/docs"
									target="_blank"
									rel="noopener noreferrer"
									data-testid="docs-view-full-documentation-link"
								>
									<ExternalLink className="mr-2 h-4 w-4" />
									{t("docs.viewFullDocumentation")}
								</a>
							</Button>
							<Button variant="outline" asChild>
								<a
									href="https://github.com/maximhq/bifrost/tree/main/docs/quickstart"
									target="_blank"
									rel="noopener noreferrer"
									data-testid="docs-quick-start-guide-link"
								>
									<Play className="mr-2 h-4 w-4" />
									{t("docs.quickStartGuide")}
								</a>
							</Button>
						</div>
					</div>

					{/* Documentation Sections */}
					<div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
						{docSections.map((section) => {
							const Icon = section.icon;
							return (
								<Card key={section.slug} className="group transition-all duration-200 hover:shadow-lg">
									<CardHeader>
										<div className="flex items-center justify-between">
											<div className="bg-primary/10 group-hover:bg-primary/20 mb-4 flex h-12 w-12 items-center justify-center rounded-lg transition-colors">
												<Icon className="text-primary h-6 w-6" />
											</div>
											{section.badge && (
												<Badge variant="secondary" className="text-xs">
													{section.badge}
												</Badge>
											)}
										</div>
										<CardTitle className="text-xl">{section.title}</CardTitle>
										<CardDescription className="leading-relaxed">{section.description}</CardDescription>
									</CardHeader>
									<CardContent className="flex h-full flex-col justify-between gap-8">
										<div className="space-y-4">
											<ul className="space-y-2">
												{section.items.map((item, index) => (
													<li key={index} className="text-muted-foreground flex items-center gap-2 text-sm">
														<div className="bg-primary h-1.5 w-1.5 rounded-full" />
														{item}
													</li>
												))}
											</ul>
										</div>
										<Button asChild variant="outline" className="w-full">
											<a
												href={section.url}
												target="_blank"
												rel="noopener noreferrer"
												className="flex items-center justify-center gap-2"
												data-testid={`docs-read-more-${section.slug}`}
											>
												{t("docs.readMore")}
												<ExternalLink className="h-4 w-4" />
											</a>
										</Button>
									</CardContent>
								</Card>
							);
						})}
					</div>

					{/* Featured Documentation */}
					<div className="grid gap-6 pt-8 md:grid-cols-2">
						{featuredDocs.map((doc, index) => (
							<Card className={`${doc.borderColor} ${doc.backgroundColor}`} key={doc.slug}>
								<CardHeader>
									<CardTitle className="flex items-center gap-2">
										<doc.icon className={`h-5 w-5 ${doc.iconColor}`} />
										{doc.title}
									</CardTitle>
									<CardDescription>{doc.description}</CardDescription>
								</CardHeader>
								<CardContent>
									<p className="text-muted-foreground mb-4 text-sm">{doc.content}</p>
									<Button asChild className="w-full">
										<a href={doc.href} target="_blank" rel="noopener noreferrer" data-testid={`docs-featured-${doc.slug}`}>
											<doc.icon className="mr-2 h-4 w-4" />
											{doc.buttonText}
										</a>
									</Button>
								</CardContent>
							</Card>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}