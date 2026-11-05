FROM node:22-alpine
ENV NODE_ENV=production PORT=4000
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY backend/migrations ./migrations
COPY backend/services ./services
COPY backend/scripts ./scripts
COPY backend/server.js ./server.js
COPY shared /app/shared
RUN mkdir -p /app/backend/data && chown -R node:node /app/backend/data
USER node
EXPOSE 4000
CMD ["sh", "-c", "npm run migrate:latest && node server.js"]
