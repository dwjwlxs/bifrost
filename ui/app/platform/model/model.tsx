import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Link } from "@tanstack/react-router";
import { PlatformFooter } from "@/app/platform/components/platformLayout";
import { ArrowRightIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useState, useMemo } from "react";

type Capability = "Chat" | "Vision" | "Embedding" | "Streaming" | "Function Calling" | "Image Gen" | "TTS" | "Transcription" | "Batch";

interface ProviderModel {
	id: string;
	name: string;
	description: string;
}

interface Provider {
	name: string;
	tag: string;
	color: string;
	bgColor: string;
	initial: string;
	description: string;
	capabilities: Capability[];
	models: ProviderModel[];
	featured?: boolean;
}

const allProviders: Provider[] = [
	{
		name: "OpenAI",
		tag: "openai",
		color: "text-emerald-600",
		bgColor: "bg-emerald-50 border-emerald-100",
		initial: "O",
		description: "GPT-4o, o1, and the full OpenAI model family",
		featured: true,
		capabilities: ["Chat", "Vision", "Embedding", "Streaming", "Function Calling", "Image Gen", "TTS", "Transcription", "Batch"],
		models: [
			{ id: "gpt-4o", name: "GPT-4o", description: "Flagship multimodal model with vision" },
			{ id: "gpt-4o-mini", name: "GPT-4o Mini", description: "Faster, cost-effective version" },
			{ id: "o1", name: "o1", description: "Advanced reasoning model" },
			{ id: "o1-mini", name: "o1 Mini", description: "Smaller reasoning model" },
			{ id: "gpt-4-turbo", name: "GPT-4 Turbo", description: "High-capability with 128K context" },
			{ id: "gpt-3.5-turbo", name: "GPT-3.5 Turbo", description: "Fast and cost-effective" },
		],
	},
	{
		name: "Anthropic",
		tag: "anthropic",
		color: "text-orange-600",
		bgColor: "bg-orange-50 border-orange-100",
		initial: "A",
		description: "Claude 3.5 and Claude 3 model family",
		featured: true,
		capabilities: ["Chat", "Vision", "Streaming", "Function Calling", "Batch"],
		models: [
			{ id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet", description: "Best for coding & analysis" },
			{ id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku", description: "Fast and affordable" },
			{ id: "claude-3-opus-20240229", name: "Claude 3 Opus", description: "Most powerful Claude model" },
			{ id: "claude-3-sonnet-20240229", name: "Claude 3 Sonnet", description: "Balanced performance" },
			{ id: "claude-3-haiku-20240307", name: "Claude 3 Haiku", description: "Lightest Claude model" },
		],
	},
	{
		name: "Google Gemini",
		tag: "gemini",
		color: "text-blue-600",
		bgColor: "bg-blue-50 border-blue-100",
		initial: "G",
		description: "Gemini 1.5 Pro, Flash, and Ultra",
		featured: true,
		capabilities: ["Chat", "Vision", "Embedding", "Streaming", "Function Calling"],
		models: [
			{ id: "gemini-1.5-pro", name: "Gemini 1.5 Pro", description: "2M token context window" },
			{ id: "gemini-1.5-flash", name: "Gemini 1.5 Flash", description: "Speed-optimized multimodal" },
			{ id: "gemini-1.5-flash-8b", name: "Gemini 1.5 Flash 8B", description: "Lightweight & fast" },
			{ id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", description: "Next-gen speed model" },
		],
	},
	{
		name: "AWS Bedrock",
		tag: "bedrock",
		color: "text-yellow-600",
		bgColor: "bg-yellow-50 border-yellow-100",
		initial: "B",
		description: "Claude, Llama, Titan, and more via AWS",
		capabilities: ["Chat", "Vision", "Embedding", "Streaming"],
		models: [
			{ id: "anthropic.claude-3-5-sonnet", name: "Claude 3.5 Sonnet", description: "Via AWS Bedrock" },
			{ id: "meta.llama3-70b-instruct", name: "Llama 3 70B", description: "Meta's flagship open model" },
			{ id: "amazon.titan-text-express", name: "Titan Text Express", description: "AWS native model" },
			{ id: "mistral.mistral-large", name: "Mistral Large", description: "Via AWS Bedrock" },
		],
	},
	{
		name: "Azure OpenAI",
		tag: "azure",
		color: "text-sky-600",
		bgColor: "bg-sky-50 border-sky-100",
		initial: "Az",
		description: "OpenAI models deployed on Azure",
		capabilities: ["Chat", "Vision", "Embedding", "Streaming", "Function Calling"],
		models: [
			{ id: "gpt-4o", name: "GPT-4o (Azure)", description: "Azure-hosted GPT-4o" },
			{ id: "gpt-4-turbo", name: "GPT-4 Turbo (Azure)", description: "Azure-hosted GPT-4 Turbo" },
			{ id: "gpt-35-turbo", name: "GPT-3.5 Turbo (Azure)", description: "Azure-hosted" },
		],
	},
	{
		name: "Groq",
		tag: "groq",
		color: "text-fuchsia-600",
		bgColor: "bg-fuchsia-50 border-fuchsia-100",
		initial: "Gr",
		description: "Ultra-low latency inference at scale",
		capabilities: ["Chat", "Streaming", "Function Calling"],
		models: [
			{ id: "llama-3.1-70b-versatile", name: "Llama 3.1 70B", description: "Ultra-fast inference" },
			{ id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant", description: "Fastest available" },
			{ id: "mixtral-8x7b-32768", name: "Mixtral 8x7B", description: "MoE architecture" },
			{ id: "gemma2-9b-it", name: "Gemma 2 9B", description: "Google's efficient model" },
		],
	},
	{
		name: "Mistral",
		tag: "mistral",
		color: "text-rose-600",
		bgColor: "bg-rose-50 border-rose-100",
		initial: "M",
		description: "European frontier AI models",
		capabilities: ["Chat", "Embedding", "Streaming", "Function Calling"],
		models: [
			{ id: "mistral-large-latest", name: "Mistral Large", description: "Top-tier performance" },
			{ id: "mistral-small-latest", name: "Mistral Small", description: "Affordable and capable" },
			{ id: "codestral-latest", name: "Codestral", description: "Code-specialized model" },
			{ id: "mistral-embed", name: "Mistral Embed", description: "Embedding model" },
		],
	},
	{
		name: "Cohere",
		tag: "cohere",
		color: "text-teal-600",
		bgColor: "bg-teal-50 border-teal-100",
		initial: "Co",
		description: "Command and Embed model family",
		capabilities: ["Chat", "Embedding", "Streaming", "Batch"],
		models: [
			{ id: "command-r-plus", name: "Command R+", description: "Best RAG and tool use" },
			{ id: "command-r", name: "Command R", description: "Optimized for RAG" },
			{ id: "embed-english-v3.0", name: "Embed English v3", description: "High-quality embeddings" },
		],
	},
	{
		name: "Ollama",
		tag: "ollama",
		color: "text-slate-600",
		bgColor: "bg-slate-50 border-slate-100",
		initial: "Ol",
		description: "Run models locally on your hardware",
		capabilities: ["Chat", "Embedding", "Streaming"],
		models: [
			{ id: "llama3.2", name: "Llama 3.2", description: "Meta's latest small model" },
			{ id: "qwen2.5", name: "Qwen 2.5", description: "Alibaba's capable model" },
			{ id: "phi3.5", name: "Phi 3.5", description: "Microsoft's small model" },
			{ id: "mistral", name: "Mistral 7B", description: "Efficient general purpose" },
		],
	},
	{
		name: "Perplexity",
		tag: "perplexity",
		color: "text-indigo-600",
		bgColor: "bg-indigo-50 border-indigo-100",
		initial: "Px",
		description: "Search-augmented language models",
		capabilities: ["Chat", "Streaming"],
		models: [
			{ id: "llama-3.1-sonar-large-128k-online", name: "Sonar Large (Online)", description: "Web-connected reasoning" },
			{ id: "llama-3.1-sonar-small-128k-online", name: "Sonar Small (Online)", description: "Fast web-connected" },
		],
	},
	{
		name: "xAI (Grok)",
		tag: "xai",
		color: "text-zinc-600",
		bgColor: "bg-zinc-50 border-zinc-100",
		initial: "xAI",
		description: "Grok models by xAI",
		capabilities: ["Chat", "Vision", "Streaming", "Function Calling"],
		models: [
			{ id: "grok-2-1212", name: "Grok 2", description: "xAI's flagship model" },
			{ id: "grok-2-vision-1212", name: "Grok 2 Vision", description: "Multimodal Grok" },
		],
	},
	{
		name: "OpenRouter",
		tag: "openrouter",
		color: "text-purple-600",
		bgColor: "bg-purple-50 border-purple-100",
		initial: "OR",
		description: "100+ models through one endpoint",
		capabilities: ["Chat", "Streaming", "Function Calling"],
		models: [
			{ id: "openai/gpt-4o", name: "GPT-4o (via OR)", description: "Via OpenRouter" },
			{ id: "anthropic/claude-3.5-sonnet", name: "Claude 3.5 (via OR)", description: "Via OpenRouter" },
			{ id: "meta-llama/llama-3.1-70b", name: "Llama 3.1 70B (via OR)", description: "Via OpenRouter" },
		],
	},
];

const capabilityColors: Record<Capability, string> = {
	Chat: "bg-blue-100 text-blue-700",
	Vision: "bg-violet-100 text-violet-700",
	Embedding: "bg-teal-100 text-teal-700",
	Streaming: "bg-green-100 text-green-700",
	"Function Calling": "bg-amber-100 text-amber-700",
	"Image Gen": "bg-pink-100 text-pink-700",
	TTS: "bg-orange-100 text-orange-700",
	Transcription: "bg-red-100 text-red-700",
	Batch: "bg-slate-100 text-slate-700",
};

export default function ModelPage() {
	const [search, setSearch] = useState("");
	const [activeFilter, setActiveFilter] = useState<Capability | "All">("All");

	const allCapabilities: Array<"All" | Capability> = [
		"All",
		"Chat",
		"Vision",
		"Embedding",
		"Streaming",
		"Function Calling",
		"Image Gen",
		"TTS",
	];

	const filtered = useMemo(() => {
		return allProviders.filter((p) => {
			const matchSearch =
				search === "" ||
				p.name.toLowerCase().includes(search.toLowerCase()) ||
				p.models.some((m) => m.name.toLowerCase().includes(search.toLowerCase()));
			const matchCap = activeFilter === "All" || p.capabilities.includes(activeFilter as Capability);
			return matchSearch && matchCap;
		});
	}, [search, activeFilter]);

	return (
		<div className="min-h-screen bg-white">
			{/* Hero */}
			<section className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 px-4 py-24">
				<div
					className="absolute inset-0 opacity-10"
					style={{
						backgroundImage: "radial-gradient(circle at 1px 1px, rgba(165,180,252,0.4) 1px, transparent 0)",
						backgroundSize: "32px 32px",
					}}
				/>
				<div className="pointer-events-none absolute top-0 right-0 h-[500px] w-[500px] rounded-full bg-indigo-500/10 blur-3xl" />
				<div className="relative container mx-auto max-w-4xl text-center">
					<Badge variant="secondary" className="mb-6 border-indigo-500/30 bg-indigo-500/20 text-indigo-300">
						20+ Providers · One OpenAI-Compatible API
					</Badge>
					<h1 className="mb-6 text-5xl leading-tight font-extrabold text-white md:text-7xl">
						Supported
						<br />
						<span className="bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">AI Models</span>
					</h1>
					<p className="mx-auto mb-10 max-w-2xl text-xl text-slate-300">
						Access 200+ models from every major provider through one OpenAI-compatible endpoint. Switch providers without changing your
						code.
					</p>
					<Link to="/platform/register">
						<Button size="lg" className="gap-2 bg-indigo-500 hover:bg-indigo-400" data-testid="model-hero-cta">
							Get Your API Key <ArrowRightIcon />
						</Button>
					</Link>
				</div>
			</section>

			{/* Stats bar */}
			<div className="border-b bg-slate-50 px-4 py-4">
				<div className="container mx-auto flex flex-wrap justify-center gap-8 text-sm text-slate-600">
					<span>
						<strong className="text-slate-900">12</strong> Featured Providers
					</span>
					<span>
						<strong className="text-slate-900">200+</strong> Individual Models
					</span>
					<span>
						<strong className="text-slate-900">9</strong> Capability Types
					</span>
					<span>
						<strong className="text-slate-900">Single</strong> OpenAI-compatible API
					</span>
				</div>
			</div>

			{/* Search + Filter */}
			<section className="sticky top-14 z-40 border-b bg-white px-4 py-12 shadow-sm">
				<div className="container mx-auto max-w-5xl">
					<div className="flex flex-col gap-4 sm:flex-row">
						<div className="relative flex-1">
							<MagnifyingGlassIcon className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
							<Input
								placeholder="Search providers or models..."
								value={search}
								onChange={(e) => setSearch(e.target.value)}
								className="pl-9"
								data-testid="model-search-input"
							/>
						</div>
						<div className="flex flex-wrap gap-2">
							{allCapabilities.map((cap) => (
								<button
									key={cap}
									onClick={() => setActiveFilter(cap)}
									data-testid={`model-filter-${cap.toLowerCase().replace(/ /g, "-")}`}
									className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${
										activeFilter === cap
											? "border-indigo-600 bg-indigo-600 text-white"
											: "border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-indigo-600"
									}`}
								>
									{cap}
								</button>
							))}
						</div>
					</div>
				</div>
			</section>

			{/* Provider Grid */}
			<section className="px-4 py-16">
				<div className="container mx-auto max-w-6xl">
					{filtered.length === 0 ? (
						<div className="py-24 text-center text-slate-500">
							<p className="text-lg">No providers match your search.</p>
							<button
								onClick={() => {
									setSearch("");
									setActiveFilter("All");
								}}
								className="mt-4 text-sm text-indigo-600 underline"
							>
								Clear filters
							</button>
						</div>
					) : (
						<div className="space-y-12">
							{filtered.map((provider, idx) => (
								<div
									key={idx}
									className={`overflow-hidden rounded-2xl border-2 ${provider.bgColor}`}
									data-testid={`model-provider-${provider.tag}`}
								>
									{/* Provider header */}
									<div className="border-b border-current/10 p-6">
										<div className="flex flex-wrap items-start justify-between gap-4">
											<div className="flex items-center gap-4">
												<div
													className={`flex h-12 w-12 items-center justify-center rounded-xl bg-white text-sm font-black shadow-sm ${provider.color} border-2 border-current/20`}
												>
													{provider.initial}
												</div>
												<div>
													<div className="flex items-center gap-2">
														<h3 className="text-xl font-bold text-slate-900">{provider.name}</h3>
														{provider.featured && (
															<Badge variant="secondary" className="border-amber-200 bg-amber-100 text-xs text-amber-700">
																Featured
															</Badge>
														)}
													</div>
													<p className="mt-0.5 text-sm text-slate-600">{provider.description}</p>
												</div>
											</div>
											<div className="flex flex-wrap gap-1.5">
												{provider.capabilities.map((cap) => (
													<span key={cap} className={`rounded-full px-2 py-0.5 text-xs font-medium ${capabilityColors[cap]}`}>
														{cap}
													</span>
												))}
											</div>
										</div>
									</div>
									{/* Models grid */}
									<div className="p-6">
										<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
											{provider.models.map((model, mIdx) => (
												<div
													key={mIdx}
													className="rounded-xl border border-white/80 bg-white p-4 shadow-sm transition-all hover:shadow-md"
													data-testid={`model-card-${model.id}`}
												>
													<div className="mb-1 text-sm font-semibold text-slate-900">{model.name}</div>
													<div className="mb-2 text-xs text-slate-500">{model.description}</div>
													<code className={`font-mono text-xs ${provider.color} rounded border border-current/20 bg-white px-1.5 py-0.5`}>
														{model.id}
													</code>
												</div>
											))}
										</div>
									</div>
								</div>
							))}
						</div>
					)}
				</div>
			</section>

			{/* Capability legend */}
			<section className="bg-slate-50 px-4 py-12">
				<div className="container mx-auto max-w-4xl">
					<h2 className="mb-8 text-center text-2xl font-bold text-slate-900">Capability Reference</h2>
					<div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
						{(Object.entries(capabilityColors) as [Capability, string][]).map(([cap, style]) => (
							<div key={cap} className="flex items-center gap-3 rounded-xl border bg-white p-4">
								<span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${style}`}>{cap}</span>
								<span className="text-sm text-slate-600">
									{cap === "Chat" && "Text generation & conversation"}
									{cap === "Vision" && "Image understanding & analysis"}
									{cap === "Embedding" && "Vector embeddings for RAG"}
									{cap === "Streaming" && "SSE token streaming"}
									{cap === "Function Calling" && "Tool/function invocation"}
									{cap === "Image Gen" && "Text-to-image generation"}
									{cap === "TTS" && "Text-to-speech synthesis"}
									{cap === "Transcription" && "Speech-to-text (Whisper etc.)"}
									{cap === "Batch" && "Asynchronous batch processing"}
								</span>
							</div>
						))}
					</div>
				</div>
			</section>

			{/* CTA */}
			<section className="bg-indigo-600 px-4 py-24 text-white">
				<div className="container mx-auto text-center">
					<h2 className="mb-4 text-4xl font-bold">Access every model through one API</h2>
					<p className="mx-auto mb-8 max-w-2xl text-lg text-indigo-200">
						Create your free account and get an API key in seconds. No credit card required.
					</p>
					<Link to="/platform/register">
						<Button size="lg" variant="secondary" className="gap-2" data-testid="model-bottom-cta">
							Get Your API Key <ArrowRightIcon />
						</Button>
					</Link>
				</div>
			</section>

			<PlatformFooter />
		</div>
	);
}