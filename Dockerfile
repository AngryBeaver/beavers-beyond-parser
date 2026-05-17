FROM node:22-alpine
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY proxy-parser/package.json ./proxy-parser/
COPY foundry/package.json ./foundry/
RUN pnpm install --frozen-lockfile --filter beavers-beyond-parser-proxy
COPY proxy-parser/src/ ./proxy-parser/src/
WORKDIR /app/proxy-parser
CMD ["pnpm", "start"]
