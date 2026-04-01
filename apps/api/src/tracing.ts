/**
 * OpenTelemetry instrumentation setup
 * This file MUST be imported before any other application code
 * to ensure all libraries are properly instrumented.
 */
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

const isTracingEnabled = process.env.OTEL_EXPORTER_OTLP_ENDPOINT !== undefined;

let sdk: NodeSDK | null = null;

if (isTracingEnabled) {
  sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter({
      url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318/v1/traces",
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        // Disable fs instrumentation - too noisy
        "@opentelemetry/instrumentation-fs": { enabled: false },
      }),
    ],
    serviceName: process.env.OTEL_SERVICE_NAME ?? "legal-agent-api",
  });

  sdk.start();
  console.log("[tracing] OpenTelemetry SDK started");

  process.on("SIGTERM", () => {
    sdk?.shutdown()
      .then(() => console.log("[tracing] OpenTelemetry SDK shut down"))
      .catch((err: Error) => console.error("[tracing] Error shutting down SDK", err));
  });
} else {
  console.log("[tracing] OpenTelemetry disabled (set OTEL_EXPORTER_OTLP_ENDPOINT to enable)");
}

export { sdk };
