import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckIcon, XIcon, ArrowRightIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { PlatformFooter } from "@/app/platform/components/platformLayout";
import { useState } from "react";

interface Plan {
	name: string;
	price: number | "custom";
	period?: string;
	badge?: string;
	badgeColor?: string;
	description: string;
	cta: string;
	ctaVariant: "default" | "outline" | "secondary";
	highlight: boolean;
	features: string[];
	limits: {
		requests: string;
		providers: string;
		apiKeys: string;
		support: string;
		analytics: string;
	};
}

const plans: Plan[] = [
	{
		name: "Free",
		price: 0,
		description: "For developers exploring Bifrost",
		cta: "Start for Free",
		ctaVariant: "outline",
		highlight: false,
		features: [
			"1,000 requests / day",
			"3 AI providers",
			"5 virtual API keys",
			"Community support",
			"Basic usage dashboard",
			"OpenAI-compatible API",
			"Streaming support",
		],
		limits: {
			requests: "1,000 / day",
			providers: "3 providers",
			apiKeys: "5 keys",
			support: "Community",
			analytics: "Basic",
		},
	},
	{
		name: "Pro",
		price: 49,
		period: "/month",
		badge: "Most Popular",
		badgeColor: "bg-blue-600",
		description: "For teams shipping production AI",
		cta: "Start Pro Trial",
		ctaVariant: "default",
		highlight: true,
		features: [
			"50,000 requests / day",
			"All 20+ providers",
			"100 virtual API keys",
			"Priority email support",
			"Advanced analytics & logs",
			"Budget controls & alerts",
			"Team management",
			"Rate limit configuration",
			"MCP gateway access",
			"Plugin system",
		],
		limits: {
			requests: "50,000 / day",
			providers: "All 20+",
			apiKeys: "100 keys",
			support: "Priority email",
			analytics: "Advanced + logs",
		},
	},
	{
		name: "Enterprise",
		price: "custom",
		description: "For organizations at scale",
		cta: "Contact Sales",
		ctaVariant: "outline",
		highlight: false,
		features: [
			"Unlimited requests",
			"All providers + custom",
			"Unlimited API keys",
			"Dedicated support & SLA",
			"Full audit logs",
			"SSO & SAML",
			"RBAC & multi-tenant",
			"Custom plugins",
			"On-premise deployment",
			"99.99% uptime SLA",
			"Custom rate limits",
			"Invoice billing",
		],
		limits: {
			requests: "Unlimited",
			providers: "All + custom",
			apiKeys: "Unlimited",
			support: "Dedicated + SLA",
			analytics: "Full audit trail",
		},
	},
];

const comparisonFeatures: Array<{
	category: string;
	items: Array<{ label: string; free: boolean | string; pro: boolean | string; enterprise: boolean | string }>;
}> = [
	{
		category: "Usage",
		items: [
			{ label: "Daily requests", free: "1,000", pro: "50,000", enterprise: "Unlimited" },
			{ label: "AI providers", free: "3", pro: "20+", enterprise: "20+ + custom" },
			{ label: "Virtual API keys", free: "5", pro: "100", enterprise: "Unlimited" },
		],
	},
	{
		category: "Features",
		items: [
			{ label: "OpenAI-compatible API", free: true, pro: true, enterprise: true },
			{ label: "Streaming (SSE)", free: true, pro: true, enterprise: true },
			{ label: "Automatic fallbacks", free: false, pro: true, enterprise: true },
			{ label: "MCP gateway", free: false, pro: true, enterprise: true },
			{ label: "Semantic caching", free: false, pro: true, enterprise: true },
			{ label: "Plugin system", free: false, pro: true, enterprise: true },
		],
	},
	{
		category: "Governance",
		items: [
			{ label: "Budget controls", free: false, pro: true, enterprise: true },
			{ label: "Rate limit config", free: false, pro: true, enterprise: true },
			{ label: "Team management", free: false, pro: true, enterprise: true },
			{ label: "RBAC", free: false, pro: false, enterprise: true },
			{ label: "SSO / SAML", free: false, pro: false, enterprise: true },
			{ label: "Full audit logs", free: false, pro: false, enterprise: true },
		],
	},
	{
		category: "Support",
		items: [
			{ label: "Community support", free: true, pro: true, enterprise: true },
			{ label: "Priority email", free: false, pro: true, enterprise: true },
			{ label: "Dedicated support", free: false, pro: false, enterprise: true },
			{ label: "SLA guarantee", free: false, pro: false, enterprise: true },
			{ label: "On-premise deployment", free: false, pro: false, enterprise: true },
		],
	},
];

const faqs = [
	{
		q: "Do I need a credit card to start?",
		a: "No. The Free plan requires no credit card. You can upgrade to Pro at any time when you need higher limits.",
	},
	{
		q: "What counts as a 'request'?",
		a: "Each call to the Bifrost inference API counts as one request, regardless of the number of tokens or the provider used. Streaming responses count as a single request.",
	},
	{
		q: "Can I bring my own provider API keys?",
		a: "Yes. Bifrost is a routing layer—you configure your own provider API keys (OpenAI, Anthropic, etc.) in your Bifrost instance. We don't bill per-token; providers bill you directly.",
	},
	{
		q: "Can I switch plans or cancel anytime?",
		a: "Absolutely. You can upgrade, downgrade, or cancel at any time from your console. Downgrades take effect at the end of your billing period.",
	},
	{
		q: "What is the MCP gateway?",
		a: "The MCP (Model Context Protocol) gateway turns any chat model into an agent that can call tools—query databases, run code, call APIs—through a standardized protocol. It's included in Pro and Enterprise.",
	},
];

function FeatureCell({ value }: { value: boolean | string }) {
	if (typeof value === "boolean") {
		return value ? <CheckIcon className="mx-auto h-5 w-5 text-green-500" /> : <XIcon className="mx-auto h-5 w-5 text-slate-300" />;
	}
	return <span className="text-sm font-medium text-slate-700">{value}</span>;
}

export default function PricingPage() {
	const [openFaq, setOpenFaq] = useState<number | null>(null);

	return (
		<div className="min-h-screen bg-white">
			{/* Hero */}
			<section className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 px-4 py-24">
				<div
					className="absolute inset-0 opacity-10"
					style={{
						backgroundImage:
							"linear-gradient(rgba(147,197,253,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(147,197,253,0.4) 1px, transparent 1px)",
						backgroundSize: "64px 64px",
					}}
				/>
				<div className="absolute bottom-0 left-1/2 h-[200px] w-[700px] -translate-x-1/2 rounded-full bg-blue-500/15 blur-3xl" />
				<div className="relative container mx-auto max-w-4xl text-center">
					<Badge variant="secondary" className="mb-6 border-blue-500/30 bg-blue-500/20 text-blue-300">
						Simple, Transparent Pricing
					</Badge>
					<h1 className="mb-6 text-5xl leading-tight font-extrabold text-white md:text-7xl">
						Pay for what
						<br />
						<span className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">you actually use</span>
					</h1>
					<p className="mx-auto mb-6 max-w-2xl text-xl text-slate-300">
						No per-token billing. No hidden provider markups. You use your own API keys— Bifrost just routes and manages them.
					</p>
					<p className="text-sm text-slate-400">All plans include the full OpenAI-compatible API · No credit card for Free plan</p>
				</div>
			</section>

			{/* Pricing Cards */}
			<section className="px-4 py-20">
				<div className="container mx-auto max-w-6xl">
					<div className="grid items-stretch gap-6 md:grid-cols-3">
						{plans.map((plan, i) => (
							<div
								key={i}
								className={`relative flex flex-col rounded-2xl border-2 p-8 transition-all ${
									plan.highlight
										? "z-10 scale-105 border-blue-500 bg-white shadow-2xl shadow-blue-500/20"
										: "border-slate-200 bg-white hover:border-slate-300 hover:shadow-md"
								}`}
								data-testid={`pricing-plan-${plan.name.toLowerCase()}`}
							>
								{plan.badge && (
									<div
										className={`absolute -top-3 left-1/2 -translate-x-1/2 ${plan.badgeColor} rounded-full px-4 py-1 text-xs font-bold text-white`}
									>
										{plan.badge}
									</div>
								)}

								<div className="mb-6">
									<h3 className="mb-1 text-xl font-bold text-slate-900">{plan.name}</h3>
									<p className="mb-4 text-sm text-slate-500">{plan.description}</p>
									<div className="flex items-end gap-1">
										{plan.price === "custom" ? (
											<span className="text-4xl font-black text-slate-900">Custom</span>
										) : (
											<>
												<span className="text-4xl font-black text-slate-900">{plan.price === 0 ? "Free" : `$${plan.price}`}</span>
												{plan.period && <span className="mb-1.5 text-sm text-slate-400">{plan.period}</span>}
											</>
										)}
									</div>
								</div>

								<ul className="mb-8 flex-1 space-y-3">
									{plan.features.map((f, fi) => (
										<li key={fi} className="flex items-start gap-2.5 text-sm">
											<CheckIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-500" />
											<span className="text-slate-700">{f}</span>
										</li>
									))}
								</ul>

								<Link to="/platform/register" className="block" data-testid={`pricing-cta-${plan.name.toLowerCase()}`}>
									<Button className="w-full" variant={plan.highlight ? "default" : plan.ctaVariant} size="lg">
										{plan.cta}
									</Button>
								</Link>
							</div>
						))}
					</div>
				</div>
			</section>

			{/* Feature Comparison Table */}
			<section className="bg-slate-50 px-4 py-20">
				<div className="container mx-auto max-w-5xl">
					<h2 className="mb-4 text-center text-3xl font-bold text-slate-900">Full Feature Comparison</h2>
					<p className="mb-12 text-center text-slate-500">Everything you need to choose the right plan</p>

					<div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
						{/* Header */}
						<div className="grid grid-cols-4 bg-slate-900 text-white">
							<div className="p-4 text-sm font-semibold">Feature</div>
							{plans.map((p) => (
								<div key={p.name} className="p-4 text-center text-sm font-bold">
									{p.name}
									{p.highlight && <div className="mt-0.5 text-xs font-normal text-blue-300">Most Popular</div>}
								</div>
							))}
						</div>

						{comparisonFeatures.map((section, si) => (
							<div key={si}>
								<div className="grid grid-cols-4 border-t bg-slate-50">
									<div className="col-span-4 p-3 pl-4 text-xs font-bold tracking-wider text-slate-400 uppercase">{section.category}</div>
								</div>
								{section.items.map((item, ii) => (
									<div
										key={ii}
										className="grid grid-cols-4 border-t transition-colors hover:bg-slate-50/50"
										data-testid={`comparison-row-${item.label.toLowerCase().replace(/ /g, "-")}`}
									>
										<div className="p-3 pl-4 text-sm text-slate-700">{item.label}</div>
										<div className="flex items-center justify-center p-3 text-center">
											<FeatureCell value={item.free} />
										</div>
										<div className={`flex items-center justify-center p-3 text-center ${si === 0 && ii === 0 ? "bg-blue-50/30" : ""}`}>
											<FeatureCell value={item.pro} />
										</div>
										<div className="flex items-center justify-center p-3 text-center">
											<FeatureCell value={item.enterprise} />
										</div>
									</div>
								))}
							</div>
						))}
					</div>
				</div>
			</section>

			{/* FAQ */}
			<section className="px-4 py-20">
				<div className="container mx-auto max-w-3xl">
					<h2 className="mb-4 text-center text-3xl font-bold text-slate-900">Frequently Asked Questions</h2>
					<p className="mb-12 text-center text-slate-500">
						Still have questions?{" "}
						<a href="mailto:support@getbifrost.ai" className="text-blue-600 hover:underline">
							Contact us
						</a>
					</p>

					<div className="space-y-3">
						{faqs.map((faq, i) => (
							<div key={i} className="overflow-hidden rounded-xl border bg-white" data-testid={`faq-item-${i}`}>
								<button
									className="flex w-full items-center justify-between p-5 text-left transition-colors hover:bg-slate-50"
									onClick={() => setOpenFaq(openFaq === i ? null : i)}
									data-testid={`faq-toggle-${i}`}
								>
									<span className="pr-4 font-semibold text-slate-900">{faq.q}</span>
									<span
										className={`flex-shrink-0 text-lg text-slate-400 transition-transform duration-200 ${openFaq === i ? "rotate-45" : ""}`}
									>
										+
									</span>
								</button>
								{openFaq === i && (
									<div className="border-t bg-slate-50/50 px-5 pb-5 text-sm leading-relaxed text-slate-600">
										<p className="pt-4">{faq.a}</p>
									</div>
								)}
							</div>
						))}
					</div>
				</div>
			</section>

			{/* CTA */}
			<section className="bg-blue-600 px-4 py-24 text-white">
				<div className="container mx-auto max-w-3xl text-center">
					<h2 className="mb-4 text-4xl font-bold">Ready to build with AI?</h2>
					<p className="mb-10 text-lg text-blue-100">Start free. Scale when you're ready. No credit card required to begin.</p>
					<div className="flex flex-wrap justify-center gap-4">
						<Link to="/platform/register">
							<Button size="lg" variant="secondary" className="gap-2" data-testid="pricing-final-cta-free">
								Start Free <ArrowRightIcon />
							</Button>
						</Link>
						<a href="mailto:sales@getbifrost.ai">
							<Button
								size="lg"
								variant="outline"
								className="gap-2 border-white/30 text-white hover:bg-white/10"
								data-testid="pricing-final-cta-enterprise"
							>
								Talk to Sales
							</Button>
						</a>
					</div>
				</div>
			</section>

			<PlatformFooter />
		</div>
	);
}