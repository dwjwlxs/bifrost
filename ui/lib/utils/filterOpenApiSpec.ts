/**
 * Filters an OpenAPI spec by path prefixes.
 * Supports both exclusion (remove paths matching prefixes) and inclusion (keep only matching prefixes).
 * Path parameters like /v1/models/{model_id} are normalized for prefix matching.
 */

export interface FilterOptions {
	/** Path prefixes to exclude (comma-separated or array). E.g. "/admin/,/internal/" */
	exclude?: string | string[];
	/** Path prefixes to include (comma-separated or array). E.g. "/v1/models,/v1/providers" */
	include?: string | string[];
}

function normalizePath(path: string): string {
	// Replace {path_params} with * for prefix-matching compatibility
	return path.replace(/\{[^}]+\}/g, "*");
}

function parsePrefixes(input: string | string[] | undefined): string[] {
	if (!input) return [];
	if (Array.isArray(input)) return input.map((p) => p.trim()).filter(Boolean);
	return input.split(",").map((p) => p.trim()).filter(Boolean);
}

function pathMatchesPrefix(path: string, prefix: string): boolean {
	const normalizedPath = normalizePath(path);
	const normalizedPrefix = prefix.trim();

	// Exact match
	if (normalizedPath === normalizedPrefix) return true;

	// Prefix match
	if (normalizedPath.startsWith(normalizedPrefix)) return true;

	// Trailing-slash prefix handles /v1/models/ matching /v1/models/{id}
	if (normalizedPrefix.endsWith("/") && normalizedPath.startsWith(normalizedPrefix.slice(0, -1))) {
		return true;
	}

	return false;
}

/**
 * Returns true if the path should be included based on filter options.
 * Logic:
 *   - If `include` is set: only paths matching at least one include prefix are kept
 *   - If `exclude` is set: paths matching any exclude prefix are removed
 *   - Both can be combined: include first, then exclude from the result
 */
function shouldIncludePath(
	path: string,
	includePrefixes: string[],
	excludePrefixes: string[]
): boolean {
	if (includePrefixes.length > 0) {
		if (!includePrefixes.some((prefix) => pathMatchesPrefix(path, prefix))) {
			return false;
		}
	}

	if (excludePrefixes.length > 0) {
		if (excludePrefixes.some((prefix) => pathMatchesPrefix(path, prefix))) {
			return false;
		}
	}

	return true;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OpenApiSpec = any;

export interface FilterResult {
	spec: OpenApiSpec;
	removedCount: number;
	removedPaths: string[];
}

export function filterOpenApiSpec(
	spec: OpenApiSpec,
	options: FilterOptions
): FilterResult {
	const includePrefixes = parsePrefixes(options.include);
	const excludePrefixes = parsePrefixes(options.exclude);

	if (includePrefixes.length === 0 && excludePrefixes.length === 0) {
		return { spec, removedCount: 0, removedPaths: [] };
	}

	// Deep clone to avoid mutating the original spec
	const specCopy: OpenApiSpec = JSON.parse(JSON.stringify(spec));
	const paths = specCopy.paths;

	if (!paths || typeof paths !== "object") {
		return { spec: specCopy, removedCount: 0, removedPaths: [] };
	}

	const removedPaths: string[] = [];

	for (const [pathKey, methods] of Object.entries(paths)) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const methodsCopy = methods as Record<string, any>;

		for (const [method, methodDetails] of Object.entries(methodsCopy)) {
			// Only process HTTP method keys
			if (!["get", "post", "put", "delete", "patch", "head", "options"].includes(method)) {
				continue;
			}

			if (!shouldIncludePath(pathKey, includePrefixes, excludePrefixes)) {
				delete methodsCopy[method];
				removedPaths.push(`${method.toUpperCase()} ${pathKey}`);
			}
		}

		// Remove path entirely if all methods were filtered out
		if (Object.keys(methodsCopy).length === 0) {
			delete specCopy.paths[pathKey];
		}
	}

	return {
		spec: specCopy,
		removedCount: removedPaths.length,
		removedPaths,
	};
}
