FROM node:24-bookworm-slim
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev
WORKDIR /app
COPY . .
WORKDIR /app/server
CMD ["node","index.js"]
