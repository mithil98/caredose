FROM node:24-alpine AS build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY DESIGN.md /app/DESIGN.md
COPY frontend/ ./
ARG VITE_ENABLE_SIMULATOR=false
ENV VITE_ENABLE_SIMULATOR=$VITE_ENABLE_SIMULATOR
RUN npx vite build

FROM nginx:1.29-alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY frontend/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
