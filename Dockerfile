FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN NODE_ENV=development npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

FROM node:22-alpine AS runtime

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist/ ./dist/

EXPOSE 3002

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
