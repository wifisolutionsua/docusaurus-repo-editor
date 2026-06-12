FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY index.html vite.config.js ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends git openssh-client ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY server ./server

VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/editor').then(r=>{if(r.status!==401&&!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server/index.mjs"]
