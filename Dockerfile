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
    printenv

# Print the API_URL to verify it's being passed correctly, eplace the placeholder in the environment file and check content of environment.prod.ts
RUN echo "API_URL is set to: $PUBLIC_API_URL" && \ 
    sed -e "s|__API_URL__|$PUBLIC_API_URL|g" /app/src/environments/environment.prod.ts.template > /app/src/environments/environment.prod.ts && \
    cat  /app/src/environments/environment.prod.ts

RUN npm run build --prod
# Stage 2: Serve the app with Nginx
FROM nginx:alpine
COPY --from=build /app/dist/roma-client/browser /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

