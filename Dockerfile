# Command line version of imaptransfer, e.g. for a NAS or a server that backs up every night.
#   docker run --rm -v /volume1/backups/anna:/backup -e IMAPTRANSFER_PASSWORD=… \
#     ghcr.io/sebastian-scherhans/imaptransfer backup /backup --user anna@gmx.de
FROM node:24-alpine AS build
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/cli/package.json packages/cli/
COPY apps/desktop/package.json apps/desktop/
RUN pnpm install --frozen-lockfile --filter imaptransfer...
COPY packages/core packages/core
COPY packages/cli packages/cli
RUN pnpm --filter imaptransfer... build \
 && pnpm --filter imaptransfer deploy --prod --legacy /app

FROM node:24-alpine
WORKDIR /app
COPY --from=build /app /app
USER node
ENTRYPOINT ["node", "/app/dist/index.js"]
CMD ["--help"]
