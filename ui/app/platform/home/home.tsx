import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowRightIcon, BrainIcon, GlobeIcon, LightningIcon, ShieldIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { PlatformFooter } from "@/app/platform/components/platformLayout";

export default function HomePage() {
	const [email, setEmail] = useState("");

	const features = [
		{
			icon: BrainIcon,
			title: "Unified AI Gateway",
			description: "Access 20+ LLM providers through a single OpenAI-compatible API. No more API key juggling.",
		},
		{
			icon: LightningIcon,
			title: "~11μs Overhead",
			description: "High-performance routing with intelligent load balancing and automatic fallbacks.",
		},
		{
			icon: GlobeIcon,
			title: "Global Deployment",
			description: "Deploy anywhere - cloud, on-premise, or edge. Enterprise-grade reliability included.",
		},
		{
			icon: ShieldIcon,
			title: "Enterprise Security",
			description: "SOC 2 compliant with end-to-end encryption, audit logs, and role-based access control.",
		},
	];

	return (
		<div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
			{/* Header */}

			{/* Hero Section */}
			<section className="px-4 py-24">
				<div className="container mx-auto max-w-4xl text-center">
					<h1 className="mb-6 bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-5xl font-bold text-transparent md:text-6xl">
						The AI Gateway for Modern Teams
					</h1>
					<p className="mx-auto mb-8 max-w-2xl text-xl text-gray-600">
						Unified API access to 20+ AI providers. Built for speed, reliability, and enterprise scale.
					</p>
					<div className="mb-12 flex flex-col justify-center gap-4 sm:flex-row">
						<div className="mx-auto max-w-md flex-1 sm:max-w-none">
							<div className="flex gap-2">
								<Input
									type="email"
									placeholder="Enter your work email"
									value={email}
									onChange={(e) => setEmail(e.target.value)}
									className="flex-1"
								/>
								<Link to="/platform/register">
									<Button size="lg" className="gap-2">
										Start Free <ArrowRightIcon />
									</Button>
								</Link>
							</div>
						</div>
					</div>
					<p className="text-sm text-gray-500">No credit card required. Free tier includes 1M tokens.</p>
				</div>
			</section>

			{/* Features Section */}
			<section className="bg-gray-50 px-4 py-24">
				<div className="container mx-auto">
					<h2 className="mb-16 text-center text-3xl font-bold">Why Bifrost?</h2>
					<div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
						{features.map((feature, index) => (
							<div key={index} className="rounded-xl bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
								<feature.icon className="mb-4 h-12 w-12 text-blue-600" weight="duotone" />
								<h3 className="mb-2 text-lg font-semibold">{feature.title}</h3>
								<p className="text-gray-600">{feature.description}</p>
							</div>
						))}
					</div>
				</div>
			</section>

			{/* Providers Section */}
			<section className="px-4 py-24">
				<div className="container mx-auto text-center">
					<h2 className="mb-8 text-3xl font-bold">Supported Providers</h2>
					<p className="mx-auto mb-12 max-w-2xl text-gray-600">
						OpenAI, Anthropic, Google Gemini, AWS Bedrock, Azure, and 15+ more - all unified under one API.
					</p>
					<div className="flex flex-wrap justify-center gap-8 opacity-60">
						{["OpenAI", "Anthropic", "Google", "AWS", "Azure", "Cohere"].map((provider) => (
							<div key={provider} className="text-2xl font-bold text-gray-400">
								{provider}
							</div>
						))}
					</div>
				</div>
			</section>

			{/* CTA Section */}
			<section className="bg-blue-600 px-4 py-24 text-white">
				<div className="container mx-auto text-center">
					<h2 className="mb-4 text-3xl font-bold">Ready to simplify your AI infrastructure?</h2>
					<p className="mx-auto mb-8 max-w-2xl text-blue-100">Join thousands of teams using Bifrost to build faster with AI.</p>
					<Link to="/platform/register">
						<Button size="lg" variant="secondary" className="gap-2">
							Get Started Free <ArrowRightIcon />
						</Button>
					</Link>
				</div>
			</section>

			{/* Footer */}
			<PlatformFooter />
		</div>
	);
}