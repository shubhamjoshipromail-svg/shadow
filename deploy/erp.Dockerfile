# Nordwerk ERP (the demo workplace) as a Node server. Build context: repository root.
# Railway: RAILWAY_DOCKERFILE_PATH=deploy/erp.Dockerfile on the erp service.
FROM oven/bun:1.2 AS build
WORKDIR /app
ARG VITE_SHADOW_API
ENV VITE_SHADOW_API=$VITE_SHADOW_API NITRO_PRESET=node-server
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM node:22-slim
WORKDIR /app
COPY --from=build /app/.output ./.output
ENV NODE_ENV=production HOST=0.0.0.0
CMD ["sh", "-c", "PORT=${PORT:-3000} node .output/server/index.mjs"]
