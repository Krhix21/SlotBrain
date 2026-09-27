# ---- Imagen base ----
FROM node:20-slim

# ---- Evitar que Puppeteer descargue su propio Chrome ----
# Vamos a usar el Chromium que instalamos vía apt-get más abajo.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# ---- Dependencias del sistema necesarias para Chromium headless ----
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    ca-certificates \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libgtk-3-0 \
    wget \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# ---- Carpeta de trabajo ----
WORKDIR /app

# ---- Instalar dependencias de Node primero (aprovecha cache de capas) ----
COPY package*.json ./
RUN npm install --omit=dev

# ---- Copiar el resto del código ----
COPY . .

# ---- Puerto que usa Express (ajusta si usas otro) ----
EXPOSE 3000

# ---- Comando de arranque ----
CMD ["node", "server.js"]
