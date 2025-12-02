FROM oven/bun:1 as base

WORKDIR /app

COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

EXPOSE 3000

CMD ["bun", "start"]

# docker-compose.yml
version: '3.8'

services:
  pr-agent:
    build: .
    ports:
      - "3000:3000"
    environment:
      - GITHUB_TOKEN=${GITHUB_TOKEN}
      - GITHUB_WEBHOOK_SECRET=${GITHUB_WEBHOOK_SECRET}
      - LLM_PROVIDER=${LLM_PROVIDER}
      - OLLAMA_HOST=http://ollama:11434
      - OLLAMA_MODEL=${OLLAMA_MODEL}
    depends_on:
      - ollama

  ollama:
    image: ollama/ollama:latest
    ports:
      - "11434:11434"
    volumes:
      - ollama_data:/root/.ollama

volumes:
  ollama_data:
