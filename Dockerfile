FROM node:25-slim
# Directorio de la APP en el Contenedor
WORKDIR /usr/src/app
# Copia package y lo ejecuta, instala dependencias del codigo
COPY package*.json ./
RUN npm ci --omit=dev

# Copia solo los directorios necesarios para ejecutar la app.
COPY src ./src
COPY public ./public
COPY views ./views
COPY sql-scripts ./sql-scripts

EXPOSE 3000

CMD ["node", "src/app.js"]

# En raiz del proyecto
#docker build -t milabud .
