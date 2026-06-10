FROM node:20-alpine
WORKDIR /app
COPY packages/database/prisma ./prisma
COPY packages/database/package.json ./
RUN npm install prisma@6 @prisma/client@6
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app
CMD ["npx", "prisma", "migrate", "deploy"]
