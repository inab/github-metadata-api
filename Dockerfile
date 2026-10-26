# syntax=docker/dockerfile:1

FROM node:24.22.1-alpine

ENV NODE_ENV=production
ENV PORT=8080

WORKDIR /app

COPY ["package.json", "package-lock.json*", "./"]

RUN npm install --production

COPY . .

CMD ["node", "src/index.js"]