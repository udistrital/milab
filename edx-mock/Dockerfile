FROM node:25-slim

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src

EXPOSE 4000

CMD ["node", "src/app.js"]
