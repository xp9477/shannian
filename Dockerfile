FROM node:22-bookworm-slim AS build

WORKDIR /app

# better-sqlite3 may need a native fallback build when no prebuilt binary exists.
# The toolchain stays in this stage and is never copied into the runtime image.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Copy dependency manifests first so npm's layer remains cacheable. The lockfile
# is mandatory: npm ci must fail rather than silently resolve a different tree.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --no-audit --no-fund

COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/web apps/web
RUN npm run build \
  && npm prune --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    PORT=8787 \
    LISTEN_HOST=0.0.0.0 \
    DATA_DIR=/data \
    WEB_DIST=/app/apps/web/dist \
    COOKIE_SECURE=true

# Preserve the workspace paths: node_modules/@shannian/* are relative symlinks
# into these directories. Only production dependencies and build output cross
# the stage boundary; python, make, g++, TypeScript, and Vite do not.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/web/package.json ./apps/web/package.json
COPY --from=build /app/apps/web/dist ./apps/web/dist

# The official node image defines node as uid/gid 1000. Compose uses the same
# identity by default; bind-mounted data must be prepared with matching ownership.
RUN install -d -o node -g node -m 0750 /data

USER node

EXPOSE 8787
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/api/dist/index.js"]
