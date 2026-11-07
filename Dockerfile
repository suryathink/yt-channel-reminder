FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
ENV NODE_ENV=production DATABASE_PATH=/data/app.db
VOLUME /data
EXPOSE 3000
CMD ["node", "--no-warnings=ExperimentalWarning", "src/index.js"]
