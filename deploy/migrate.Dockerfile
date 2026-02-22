FROM node:20-alpine
WORKDIR /app
COPY packages/database/prisma ./prisma
COPY packages/database/package.json ./
RUN npm install prisma@6 @prisma/client@6
CMD ["npx", "prisma", "migrate", "deploy"]
