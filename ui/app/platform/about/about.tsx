import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "@tanstack/react-router";
import { PlatformFooter } from "@/app/platform/components/platformLayout";
import {
	ArrowRightIcon,
	BrainIcon,
	LightningIcon,
	ShieldIcon,
	GlobeIcon,
	PlugsConnectedIcon,
	CodeIcon,
	FlowArrowIcon,
	StarIcon,
} from "@phosphor-icons/react";

const stats = [
	{ value: "20+", label: "AI Providers", sublabel: "OpenAI, Anthropic, Gemini & more" },
	{ value: "~11µs", label: "Overhead", sublabel: "At 5,000 RPS" },
	{ value: "5K", label: "Req/Second", sublabel: "Sustained throughput" },
	{ value: "100%", label: "Open Source", sublabel: "MIT licensed on GitHub" },
];

const advantages = [
	{
		icon: PlugsConnectedIcon,
		title: "Provider Isolation",
		description: "Each provider runs in its own worker pool. One provider going down never cascades to others—your requests keep flowing.",
		color: "text-blue-500",
		bg: "bg-blue-50",
	},
	{
		icon: BrainIcon,
		title: "MCP Gateway",
		description:
			"Turn any static chat model into a tool-calling agent. Native Model Context Protocol support transforms models into agentic workers.",
		color: "text-violet-500",
		bg: "bg-violet-50",
	},
	{
		icon: FlowArrowIcon,
		title: "Plugin System",
		description: "Pre/post hooks, rate limiting, semantic caching, telemetry—a composable plugin pipeline with guaranteed symmetry.",
		color: "text-emerald-500",
		bg: "bg-emerald-50",
	},
	{
		icon: LightningIcon,
		title: "Streaming First",
		description:
			"SSE streaming built into the core. Stream chunks flow with per-chunk idle timeouts—no arbitrary read deadlines killing long streams.",
		color: "text-amber-500",
		bg: "bg-amber-50",
	},
	{
		icon: ShieldIcon,
		title: "Enterprise Security",
		description: "Virtual keys, RBAC, budget controls, and audit logs. Full governance stack with team and customer management.",
		color: "text-rose-500",
		bg: "bg-rose-50",
	},
	{
		icon: CodeIcon,
		title: "OpenAI-Compatible",
		description: "Drop-in replacement for OpenAI SDK. Switch providers without changing a single line of application code.",
		color: "text-sky-500",
		bg: "bg-sky-50",
	},
];

const timeline = [
	{ year: "2023", event: "Bifrost open-sourced on GitHub", detail: "Core engine with 5 initial providers" },
	{ year: "2024", event: "20+ providers, MCP gateway", detail: "Plugin system, semantic cache, telemetry" },
	{ year: "2025", event: "Enterprise platform launches", detail: "RBAC, multi-tenant, SLA guarantees" },
	{ year: "Now", event: "~11µs at 5,000 RPS", detail: "Production-hardened at global scale" },
];

export default function AboutPage() {
	return (
		<div className="min-h-screen bg-white">
			{/* Hero */}
			<section className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 px-4 py-28">
				{/* Grid background */}
				<div
					className="absolute inset-0 opacity-10"
					style={{
						backgroundImage:
							"linear-gradient(rgba(99,179,237,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(99,179,237,0.3) 1px, transparent 1px)",
						backgroundSize: "48px 48px",
					}}
				/>
				{/* Glow */}
				<div className="pointer-events-none absolute top-1/2 left-1/2 h-[300px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500/20 blur-3xl" />

				<div className="relative container mx-auto max-w-4xl text-center">
					<Badge variant="secondary" className="mb-6 border-blue-500/30 bg-blue-500/20 text-blue-300 backdrop-blur">
						Open Source · MIT License
					</Badge>
					<h1 className="mb-6 text-5xl leading-tight font-extrabold tracking-tight text-white md:text-7xl">
						The AI Gateway
						<br />
						<span className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">Built to Last</span>
					</h1>
					<p className="mx-auto mb-10 max-w-2xl text-xl leading-relaxed text-slate-300">
						Bifrost unifies 20+ LLM providers behind a single OpenAI-compatible API with ~11µs overhead. High performance. Provider
						isolation. Open source forever.
					</p>
					<div className="flex flex-wrap justify-center gap-4">
						<Link to="/platform/register">
							<Button size="lg" className="gap-2 bg-blue-500 text-white hover:bg-blue-400" data-testid="about-hero-cta">
								Get Started Free <ArrowRightIcon />
							</Button>
						</Link>
						<a href="https://github.com/maximhq/bifrost" target="_blank" rel="noopener noreferrer" data-testid="about-github-link">
							<Button size="lg" variant="outline" className="gap-2 border-slate-600 text-slate-200 hover:bg-slate-800">
								<StarIcon />
								Star on GitHub
							</Button>
						</a>
					</div>
				</div>
			</section>

			{/* Stats */}
			<section className="border-b bg-slate-50 px-4 py-16">
				<div className="container mx-auto">
					<div className="grid grid-cols-2 gap-8 md:grid-cols-4">
						{stats.map((stat, i) => (
							<div key={i} className="text-center" data-testid={`about-stat-${i}`}>
								<div className="mb-1 text-4xl font-black text-blue-600 md:text-5xl">{stat.value}</div>
								<div className="mb-0.5 font-semibold text-slate-800">{stat.label}</div>
								<div className="text-xs text-slate-500">{stat.sublabel}</div>
							</div>
						))}
					</div>
				</div>
			</section>

			{/* What is Bifrost */}
			<section className="px-4 py-24">
				<div className="container mx-auto max-w-5xl">
					<div className="grid items-center gap-16 lg:grid-cols-2">
						<div>
							<Badge variant="secondary" className="mb-4 border-blue-100 bg-blue-50 text-blue-600">
								What is Bifrost?
							</Badge>
							<h2 className="mb-6 text-4xl leading-tight font-bold text-slate-900">
								One API to rule
								<br />
								<span className="text-blue-600">all LLM providers</span>
							</h2>
							<div className="space-y-4 leading-relaxed text-slate-600">
								<p>
									Bifrost is a high-performance AI gateway that sits between your application and every major LLM provider. Instead of
									integrating OpenAI, Anthropic, Google, and 17+ others separately, you talk to Bifrost once.
								</p>
								<p>
									The gateway adds only ~11µs of overhead at 5,000 requests per second—essentially invisible. Automatic fallbacks, load
									balancing, and provider isolation mean one provider outage never brings down your whole system.
								</p>
								<p>
									Beyond inference, Bifrost is also an MCP (Model Context Protocol) gateway—turning static chat models into tool-calling
									agents that can query databases, run code, and interact with external APIs.
								</p>
							</div>
						</div>
						{/* Code block visual */}
						<div className="overflow-hidden rounded-2xl bg-slate-900 p-6 font-mono text-sm shadow-2xl">
							<div className="mb-4 flex gap-1.5">
								<div className="h-3 w-3 rounded-full bg-red-400" />
								<div className="h-3 w-3 rounded-full bg-yellow-400" />
								<div className="h-3 w-3 rounded-full bg-green-400" />
							</div>
							<div className="space-y-1">
								<div className="text-slate-500"># Before: juggling multiple SDKs</div>
								<div className="text-red-400">- import openai, anthropic, google.genai</div>
								<div className="text-red-400">- client = openai.OpenAI(api_key=OPENAI_KEY)</div>
								<div className="mt-3 text-slate-500"># After: one client, every model</div>
								<div className="text-green-400">+ from openai import OpenAI</div>
								<div className="text-green-400">+ client = OpenAI(</div>
								<div className="text-green-400">+ base_url="https://your-bifrost/openai",</div>
								<div className="text-green-400">+ api_key="bf-your-key"</div>
								<div className="text-green-400">+ )</div>
								<div className="mt-3 text-slate-500"># Switch providers with one line:</div>
								<div className="text-cyan-400">
									model = <span className="text-amber-300">"anthropic/claude-3-5-sonnet"</span>
								</div>
								<div className="text-cyan-400">
									model = <span className="text-amber-300">"google/gemini-1.5-pro"</span>
								</div>
								<div className="text-cyan-400">
									model = <span className="text-amber-300">"groq/llama-3-70b"</span>
								</div>
							</div>
						</div>
					</div>
				</div>
			</section>

			{/* Key Advantages */}
			<section className="bg-slate-50 px-4 py-24">
				<div className="container mx-auto max-w-6xl">
					<div className="mb-16 text-center">
						<h2 className="mb-4 text-4xl font-bold text-slate-900">Built different</h2>
						<p className="mx-auto max-w-2xl text-lg text-slate-600">
							Every design decision in Bifrost was made for production reliability—not just demo benchmarks.
						</p>
					</div>
					<div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
						{advantages.map((adv, i) => (
							<div
								key={i}
								className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
								data-testid={`about-advantage-${i}`}
							>
								<div className={`inline-flex rounded-xl p-3 ${adv.bg} mb-4`}>
									<adv.icon className={`h-6 w-6 ${adv.color}`} weight="duotone" />
								</div>
								<h3 className="mb-2 font-bold text-slate-900">{adv.title}</h3>
								<p className="text-sm leading-relaxed text-slate-600">{adv.description}</p>
							</div>
						))}
					</div>
				</div>
			</section>

			{/* Timeline */}
			<section className="px-4 py-24">
				<div className="container mx-auto max-w-3xl">
					<div className="mb-16 text-center">
						<h2 className="mb-4 text-4xl font-bold text-slate-900">Our journey</h2>
						<p className="text-lg text-slate-600">From open-source project to production AI infrastructure</p>
					</div>
					<div className="relative">
						<div className="absolute top-0 bottom-0 left-8 w-0.5 bg-blue-100" />
						<div className="space-y-10">
							{timeline.map((item, i) => (
								<div key={i} className="relative flex items-start gap-8">
									<div className="relative z-10 flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 shadow-lg">
										<span className="text-xs font-bold text-white">{item.year}</span>
									</div>
									<div className="pt-3">
										<div className="text-lg font-bold text-slate-900">{item.event}</div>
										<div className="mt-1 text-sm text-slate-500">{item.detail}</div>
									</div>
								</div>
							))}
						</div>
					</div>
				</div>
			</section>

			{/* Open Source Community */}
			<section className="bg-slate-900 px-4 py-24 text-white">
				<div className="container mx-auto max-w-4xl text-center">
					<div className="mb-8 inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/20 px-4 py-1.5 text-sm font-medium text-amber-400">
						<StarIcon weight="fill" className="h-4 w-4" />
						Open Source Community
					</div>
					<h2 className="mb-6 text-4xl leading-tight font-bold md:text-5xl">
						Built in public.
						<br />
						<span className="text-blue-400">Owned by the community.</span>
					</h2>
					<p className="mx-auto mb-10 max-w-2xl text-lg leading-relaxed text-slate-400">
						Bifrost is MIT-licensed and developed openly on GitHub. Contribute providers, plugins, or improvements—every PR makes the
						gateway better for thousands of teams.
					</p>
					<div className="flex flex-wrap justify-center gap-4">
						<Link to="/platform/register">
							<Button size="lg" className="gap-2 bg-blue-500 hover:bg-blue-400" data-testid="about-community-cta">
								Get Your API Key <ArrowRightIcon />
							</Button>
						</Link>
						<a href="https://github.com/maximhq/bifrost" target="_blank" rel="noopener noreferrer">
							<Button size="lg" variant="outline" className="gap-2 border-slate-700 text-slate-200 hover:bg-slate-800">
								View on GitHub
							</Button>
						</a>
					</div>
				</div>
			</section>

			<PlatformFooter />
		</div>
	);
}