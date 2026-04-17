/**
 * OTLP/HTTP tracing setup. When an endpoint is configured, register a global
 * tracer provider so spans emitted by @nilenso/megasthenes (via
 * @opentelemetry/api) are exported to a collector such as Arize Phoenix,
 * Langfuse, Jaeger, or any OTLP-compatible receiver.
 *
 * The library uses trace.getTracer() lazily on each span creation, so
 * registering the provider before client.connect() is sufficient.
 */

import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

let provider: NodeTracerProvider | undefined;

/**
 * Resolve a user-provided endpoint to the full OTLP/HTTP traces URL. Accepts
 * either a base URL (`http://localhost:6006`) — in which case `/v1/traces` is
 * appended — or a fully-qualified traces URL.
 */
export function resolveTracesUrl(endpoint: string): string {
	const trimmed = endpoint.replace(/\/$/, "");
	return trimmed.endsWith("/v1/traces") ? trimmed : `${trimmed}/v1/traces`;
}

export function setupTracing(endpoint: string): void {
	if (provider !== undefined) return;
	const url = resolveTracesUrl(endpoint);
	provider = new NodeTracerProvider({
		resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: "megasthenes-cli" }),
		spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({ url }))],
	});
	provider.register();
}

export async function shutdownTracing(): Promise<void> {
	if (provider === undefined) return;
	try {
		await provider.shutdown();
	} catch {
		// ignore shutdown errors — best-effort flush
	}
	provider = undefined;
}
