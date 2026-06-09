FROM node:20-alpine AS deps
WORKDIR /app

# Docker CLI (for `docker cp` and `docker exec` from inside the backend container).
RUN apk add --no-cache docker-cli

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

FROM node:20-alpine AS runner
WORKDIR /app
RUN apk add --no-cache docker-cli

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npx prisma generate

ENV NODE_ENV=production
EXPOSE 4000
CMD ["sh", "-c", "npx prisma migrate deploy && node src/index.js"]
