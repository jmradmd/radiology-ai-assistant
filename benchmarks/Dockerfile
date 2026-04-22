# Reproducible benchmark runtime for the Radiology AI Assistant.
#
# This image builds the harness, the statistics module, the SVG visualization
# module, and the report generator. It does NOT bundle an Ollama server or the
# models under test; those must be reachable over the network when the
# container runs (Ollama's HTTP API defaults to port 11434 on the host).
#
# Build:
#   docker build -f benchmarks/Dockerfile -t radiology-assist-bench:latest .
#
# Run (expects Ollama on host.docker.internal:11434):
#   docker run --rm -it \
#     -e OLLAMA_BASE_URL=http://host.docker.internal:11434 \
#     -e DATABASE_URL=postgres://user:pass@host.docker.internal:5432/rad \
#     -e OPENAI_API_KEY=... \
#     -e ENABLE_BENCHMARK_ENDPOINT=1 \
#     -v $(pwd)/benchmarks/results:/app/benchmarks/results \
#     radiology-assist-bench:latest \
#     npx tsx benchmarks/scripts/run-benchmark.ts --models light --runs 3

FROM node:20.19.0-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates python3 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps ./apps
COPY evaluation ./evaluation
COPY scripts ./scripts

RUN npm ci --ignore-scripts

COPY benchmarks ./benchmarks
RUN cd benchmarks && npm install --ignore-scripts

# Expose only the non-sensitive ports; the harness talks to external services.
EXPOSE 3000

ENV NODE_ENV=production
ENV BENCHMARK_BASE_URL=http://localhost:3000
ENV OLLAMA_BASE_URL=http://localhost:11434

CMD ["npx", "tsx", "benchmarks/scripts/validate-setup.ts"]
