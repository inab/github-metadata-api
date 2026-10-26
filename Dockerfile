# syntax=docker/dockerfile:1

FROM node:24.22.1-alpine AS base

WORKDIR /app

COPY ["package.json", "package-lock.json", "./"]

# Runs the test suite on the same Node.js runtime the image ships with:
#   docker build --target test .
# Not part of the default build: the production stage does not depend on it.
FROM base AS test

RUN npm ci

COPY . .

RUN npm test

FROM base AS production

ENV NODE_ENV=production
ENV PORT=8080

RUN npm ci --omit=dev

COPY . .

CMD ["node", "src/index.js"]
