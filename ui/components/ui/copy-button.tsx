"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";

interface CopyButtonProps {
	text: string;
	className?: string;
	title?: string;
}

export function CopyButton({ text, className, title = "Copy" }: CopyButtonProps) {
	const { copy } = useCopyToClipboard();
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		await copy(text);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};

	return (
		<button
			onClick={handleCopy}
			className={`text-muted-foreground hover:text-foreground p-0.5 transition-colors ${className ?? ""}`}
			title={title}
		>
			{copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
		</button>
	);
}