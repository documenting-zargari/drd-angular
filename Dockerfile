# Stage 1: Build the Angular app
FROM node:18 AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install
# Copy the entire repository to the container
COPY . .

# Introduce env vars from Github
RUN --mount=type=secret,id=secrets_env,dst=/secrets_env \
    --mount=type=cache,target=/tmp/cache \
    if [ -f /secrets_env ]; then . /secrets_env; fi; \
    npm run build -- --configuration production
    
# Stage 2: Serve the app with Nginx
FROM nginx:alpine
COPY --chown=101:101 --from=build /app/dist/roma-client/browser /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
RUN mkdir -p /usr/share/nginx/html/media/mp3 && chown -R 101:101 /usr/share/nginx/html/media/mp3
EXPOSE 80 
CMD ["nginx", "-g", "daemon off;"]
