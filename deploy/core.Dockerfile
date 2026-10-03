# Shadow Core + the notebook, one origin: API, websockets, /capture.js and the console all on one URL.
# Build context: repository root. Railway: set RAILWAY_DOCKERFILE_PATH=deploy/core.Dockerfile on the core service.
FROM node:22-slim AS notebook
WORKDIR /src/console
COPY console/package.json console/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY console/ ./
RUN npm run build

FROM python:3.13-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app/backend
COPY backend/requirements.txt ./
RUN pip install -r requirements.txt
COPY backend/shadow ./shadow
COPY backend/scripts ./scripts
COPY --from=notebook /src/console/dist /app/console/dist
EXPOSE 8000
CMD ["sh", "-c", "uvicorn shadow.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
