# Stage 1: Build the Angular app
FROM node:18 AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install
# Copy the entire repository to the container
COPY . .

# Print the API_URL to verify it's being passed correctly
RUN echo "API_URL is set to: $API_URL"

# Replace the placeholder in the environment file
RUN sed -e "s|__API_URL__|$API_URL|g" /app/src/environments/environment.prod.ts.template > /app/src/environments/environment.prod.ts
RUN cat  /app/src/environments/environment.prod.ts

RUN npm run build --prod
# Stage 2: Serve the app with Nginx
FROM nginx:alpine
COPY --from=build /app/dist/roma-client/browser /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

