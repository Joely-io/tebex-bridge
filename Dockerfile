# ---- Build stage ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* pnpm-lock.yaml* ./
RUN corepack enable && (pnpm install --frozen-lockfile 2>/dev/null || npm install)
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

# ---- Runtime stage ----
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* pnpm-lock.yaml* ./
RUN corepack enable && (pnpm install --frozen-lockfile --prod 2>/dev/null || npm install --omit=dev)
COPY --from=build /app/dist ./dist
EXPOSE 3000
USER node
CMD ["node", "dist/index.js"]
