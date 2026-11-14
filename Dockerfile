FROM node:22-alpine AS build
WORKDIR /src
COPY . .
RUN npm install --no-save --no-package-lock esbuild@0.25.12
RUN node scripts/build-web.mjs

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist/ /usr/share/nginx/html/
EXPOSE 3000
