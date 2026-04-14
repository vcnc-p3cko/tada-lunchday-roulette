FROM node:20-bookworm-slim AS build

WORKDIR /app
COPY package.json ./
RUN npm install

COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY package.json ./
RUN npm install --omit=dev

COPY --from=build /app/dist ./dist
COPY --from=build /app/config ./config
COPY --from=build /app/server.js ./server.js

EXPOSE 8080

CMD ["npm", "run", "start"]
