FROM oven/bun:1.3.9-alpine AS deps
WORKDIR /app/apps/frontend
COPY apps/frontend/package.json ./
RUN bun install

FROM oven/bun:1.3.9-alpine AS build
WORKDIR /app/apps/frontend
ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
COPY --from=deps /app/apps/frontend/node_modules ./node_modules
COPY apps/frontend ./
RUN bun run build

FROM oven/bun:1.3.9-alpine
WORKDIR /app/apps/frontend
ENV NODE_ENV=production
COPY --from=build /app/apps/frontend/.next/standalone ./
COPY --from=build /app/apps/frontend/.next/static ./.next/static
COPY --from=build /app/apps/frontend/public ./public
EXPOSE 3000
CMD ["bun", "server.js"]
