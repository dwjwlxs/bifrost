import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import "rapidoc";
import openapiSpec from "../../../../../docs/openapi/openapi.json?url";
import { filterOpenApiSpec } from "../../../../lib/utils/filterOpenApiSpec";

interface RapiDocAttributes {
	"spec-url"?: string;
	"show-info"?: string;
	"nav-bg-color"?: string;
	"nav-text-color"?: string;
	"nav-hover-bg-color"?: string;
	"nav-hover-text-color"?: string;
	"nav-active-bg-color"?: string;
	"nav-active-text-color"?: string;
	theme?: string;
	"allow-server-selection"?: string;
	"allow-authentication"?: string;
	"allow-spec-file-download"?: string;
	"allow-spec-url-load"?: string;
	"allow-search"?: string;
	"allow-advanced-search"?: string;
	"allow-security-schemes"?: string;
	"render-style"?: string;
	"default-api-server"?: string;
	"schema-description-expanded"?: string;
	style?: React.CSSProperties;
}

// RapiDoc is a native web component — use @ts-expect-error to suppress
// JSX intrinsic element type errors (standard React types don't cover custom elements)
const RapiDoc = ({ ...props }: RapiDocAttributes) => {
	// @ts-expect-error — RapiDoc is a native web component, not a React component
	return <rapi-doc {...props} />;
};

// Hardcoded filter: only show paths under /v1/
const API_PREFIX_INCLUDE = "/v1/";

export default function ApiReferencePage() {
	const blobUrlRef = useRef<string | null>(null);
	const [specUrl, setSpecUrl] = useState<string>(openapiSpec);
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		setLoading(true);

		// Clean up previous blob URL
		if (blobUrlRef.current) {
			URL.revokeObjectURL(blobUrlRef.current);
			blobUrlRef.current = null;
		}

		const doFilter = async () => {
			try {
				const raw = await fetch(openapiSpec);
				const spec = await raw.json();

				const { spec: filtered } = filterOpenApiSpec(spec, {
					include: API_PREFIX_INCLUDE,
				});

				const blob = new Blob([JSON.stringify(filtered)], {
					type: "application/json",
				});
				const url = URL.createObjectURL(blob);
				blobUrlRef.current = url;
				setSpecUrl(url);
			} catch (err) {
				console.error("[ApiReferencePage] Failed to filter spec:", err);
				// Fall back to original spec on error
				setSpecUrl(openapiSpec);
			} finally {
				setLoading(false);
			}
		};

		doFilter();

		return () => {
			if (blobUrlRef.current) {
				URL.revokeObjectURL(blobUrlRef.current);
				blobUrlRef.current = null;
			}
		};
	}, []);

	return (
		<div className="relative h-full w-full">
			{loading && (
				<div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80">
					<Loader2 className="text-primary h-8 w-8 animate-spin" />
				</div>
			)}
			<div className={loading ? "opacity-50" : ""}>
				<RapiDoc
					spec-url={specUrl}
					style={{ height: "100%", width: "100%" }}
					show-info="false"
					nav-bg-color="#0C3B43"
					nav-text-color="#e5e7eb"
					nav-hover-bg-color="#1a4f57"
					nav-hover-text-color="#ffffff"
					nav-active-bg-color="#07C983"
					nav-active-text-color="#ffffff"
					theme="light"
					allow-server-selection="false"
					allow-authentication="false"
					allow-spec-file-download="false"
					allow-spec-url-load="false"
					allow-search="true"
					allow-advanced-search="false"
					allow-security-schemes="true"
					render-style="read"
					default-api-server=""
					schema-description-expanded="true"
				/>
			</div>
		</div>
	);
}
