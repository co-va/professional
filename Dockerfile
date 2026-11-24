FROM node:22-alpine AS build
WORKDIR /src
COPY . .
RUN npm install --no-save --no-package-lock esbuild@0.25.12
RUN node scripts/build-web.mjs

FROM nginx:1.27-alpine
# Keep the public trust store current; never disable upstream TLS validation.
RUN apk add --no-cache --upgrade ca-certificates git && update-ca-certificates
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY nginx-api.conf /etc/nginx/professional-api.conf
COPY scripts/refresh-preview.sh /usr/local/bin/professional-preview-refresh
COPY scripts/start-preview.sh /docker-entrypoint.d/40-professional-preview.sh
RUN chmod 755 /usr/local/bin/professional-preview-refresh /docker-entrypoint.d/40-professional-preview.sh
COPY --from=build /src/dist/ /usr/share/nginx/html/
EXPOSE 3000
