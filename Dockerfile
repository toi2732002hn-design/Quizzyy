FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    QUIZZY_DATA=/data
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
# Dữ liệu nằm ở /data — trên Railway hãy gắn Volume vào đường dẫn này (Settings → Volumes)
EXPOSE 3000
CMD ["node", "--use-system-ca", "server.js"]
