FROM node:22.14.0-bookworm-slim AS build
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY packages ./packages
COPY apps/backend ./apps/backend
RUN corepack enable && pnpm install --frozen-lockfile
RUN pnpm --filter @ux-copy-sync/backend build

FROM node:22.14.0-bookworm-slim
ENV NODE_ENV=production
ENV HOST=0.0.0.0
WORKDIR /app
COPY --from=build /workspace/package.json /workspace/pnpm-lock.yaml /workspace/pnpm-workspace.yaml ./
COPY --from=build /workspace/packages ./packages
COPY --from=build /workspace/apps/backend/package.json ./apps/backend/package.json
COPY --from=build /workspace/apps/backend/dist ./apps/backend/dist
RUN corepack enable && pnpm install --prod --frozen-lockfile
USER node
CMD ["node", "apps/backend/dist/server.cjs"]
