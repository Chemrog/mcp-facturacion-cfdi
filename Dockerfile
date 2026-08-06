FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY dist/ ./dist/

EXPOSE 3002

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
