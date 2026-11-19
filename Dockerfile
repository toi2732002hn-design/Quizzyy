FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    QUIZZY_DATA=/data
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
# Dữ liệu (tài khoản, học phần, ảnh) nằm ở /data — gắn ổ đĩa bền vững vào đây
VOLUME /data
EXPOSE 3000
CMD ["node", "--use-system-ca", "server.js"]
