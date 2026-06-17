FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

ARG VITE_GOOGLE_MAPS_EMBED_API_KEY
ENV VITE_GOOGLE_MAPS_EMBED_API_KEY=$VITE_GOOGLE_MAPS_EMBED_API_KEY

RUN npm run build

FROM oven/bun:1-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/src ./src
EXPOSE 3000
CMD ["bun", "server/index.ts"]
