FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node . .
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-3000}/health" || exit 1
CMD ["sh", "-c", "node scripts/migrate.js && exec node src/server.js"]
