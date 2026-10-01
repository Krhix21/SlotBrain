# ---- Imagen base ----
FROM node:22-slim

# ---- Carpeta de trabajo ----
WORKDIR /app

# ---- Instalar dependencias de Node primero (aprovecha cache de capas) ----
COPY package*.json ./
RUN npm ci --omit=dev

# ---- Copiar el resto del código ----
COPY . .

# ---- Puerto que usa Express (ajusta si usas otro) ----
EXPOSE 3000

# ---- Comando de arranque ----
CMD ["node", "server.js"]
