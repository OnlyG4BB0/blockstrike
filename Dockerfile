# BLOCKSTRIKE: server di gioco (Colyseus) che serve anche il client compilato.
#
#   docker build -t blockstrike .
#   docker run -p 2567:2567 blockstrike        → http://localhost:2567
#
# Variabili: PORT (porta, predefinita 2567), CLIENT_DIR (cartella del client; vuota = solo server).
# Argomento di build: VITE_SERVER_URL, se il client verrà ospitato altrove (es. wss://gioco.example.com).

# ---------------------------------------------------------------------------- 1. client statico
FROM node:24-alpine AS client
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY shared/package.json shared/
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci --workspace @blockstrike/client --include-workspace-root
COPY tsconfig.base.json ./
COPY shared shared
COPY content content
COPY client client
ARG VITE_SERVER_URL=
ENV VITE_SERVER_URL=${VITE_SERVER_URL}
RUN npm run build

# ---------------------------------------------------------------------------- 2. server
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json .npmrc ./
COPY shared/package.json shared/
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci --omit=dev --workspace @blockstrike/server && npm cache clean --force
COPY shared/src shared/src
COPY server/src server/src
COPY content content
COPY --from=client /app/client/dist client/dist
ENV PORT=2567 CLIENT_DIR=/app/client/dist
EXPOSE 2567
USER node
# Node 24 esegue TypeScript togliendo i tipi: niente compilazione per il server.
CMD ["node", "--experimental-strip-types", "--disable-warning=ExperimentalWarning", "server/src/index.ts"]
