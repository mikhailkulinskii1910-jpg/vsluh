# Сервер лобби «Велокарты» + веб-версия приложения.
# Сборка:  docker build -t velokarta ./velo
# Запуск:  docker run -p 8080:8080 velokarta   → http://localhost:8080, WebSocket /ws
# Для GPS в браузере и wss:// нужен HTTPS — его даёт хостинг или обратный прокси (nginx, Caddy).
FROM node:22-alpine
WORKDIR /app
COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci --omit=dev
COPY index.html style.css manifest.webmanifest icon-192.png icon-512.png ./
COPY vendor vendor
COPY js js
COPY server/server.js server/game.js server/
ENV PORT=8080 NODE_ENV=production
EXPOSE 8080
USER node
CMD ["node", "server/server.js"]
