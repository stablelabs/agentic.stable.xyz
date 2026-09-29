FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && mkdir -p /app/data && chown -R node:node /app
ENV NODE_ENV=production PORT=8787 DATABASE_PATH=/app/data/site.sqlite
USER node
EXPOSE 8787
CMD ["npm", "start"]
