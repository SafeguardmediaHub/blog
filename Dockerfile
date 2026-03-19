# ---- Base ----
FROM node:20-alpine AS base

RUN corepack enable && corepack prepare pnpm@10.13.1 --activate
RUN apk add --no-cache vips-dev build-base python3

WORKDIR /app

# ---- Dependencies ----
FROM base AS deps

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ---- Build ----
FROM base AS build

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN pnpm build

# Remove dev dependencies after build
RUN pnpm prune --prod

# ---- Production ----
FROM node:20-alpine AS production

RUN corepack enable && corepack prepare pnpm@10.13.1 --activate
RUN apk add --no-cache vips

WORKDIR /app

# Copy only what's needed to run
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/public ./public
COPY --from=build /app/config ./config
COPY --from=build /app/src ./src
COPY --from=build /app/tsconfig.json ./
COPY --from=build /app/favicon.png ./

# Create uploads directory
RUN mkdir -p public/uploads

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=1337

EXPOSE 1337

CMD ["pnpm", "start"]
