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
    echo "API_URL is set to: $API_URL" && npm run build --prod
    
# Stage 2: Serve the app with Nginx
FROM nginx:alpine
COPY --from=build /app/dist/roma-client/browser /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

