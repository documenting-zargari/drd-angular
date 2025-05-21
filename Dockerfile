# Stage 1: Build the Angular app
FROM node:18 AS build
ARG API_URL
ENV API_URL=${API_URL}

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install
# Copy the entire repository to the container
COPY . .

# Replace the placeholder in the environment file
RUN sed -e "s|__API_URL__|$API_URL|g" /app/src/environments/environment.prod.ts.template > /app/src/environments/environment.prod.ts

RUN npm run build --prod
# Stage 2: Serve the app with Nginx
FROM nginx:alpine
COPY --from=build /app/dist/roma-client/browser /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

