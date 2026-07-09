# NOTE: no package-lock.json is committed yet (this environment has no Node/npm to
# generate one). Once someone runs `npm install` locally with Node available, commit
# the resulting package-lock.json and switch this to `npm ci` for reproducible builds.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
