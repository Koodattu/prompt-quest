FROM oven/bun:1.3.9-alpine AS deps
WORKDIR /app/apps/backend
COPY apps/backend/package.json ./
RUN bun install

FROM oven/bun:1.3.9-alpine
WORKDIR /app/apps/backend
COPY --from=deps /app/apps/backend/node_modules ./node_modules
COPY apps/backend ./
EXPOSE 4000
CMD ["bun", "src/index.ts"]
