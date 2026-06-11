FROM node:25-slim
# Directorio de la APP en el Contenedor
WORKDIR /usr/src/app
# Copia package y lo ejecuta, instala dependencias del codigo
COPY package*.json ./
RUN npm ci --omit=dev

# Imagen de produccion: solo runtime de la app.
COPY src ./src

EXPOSE 3000

CMD ["node", "src/app.js"]

# En raiz del proyecto
#docker build -t milabud .
