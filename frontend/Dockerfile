FROM node:20-alpine AS base

WORKDIR /app

# Dependencies
COPY package.json ./
RUN npm install

# Copy source
COPY . .

# Dev mode (hot reload)
ENV NODE_ENV=development
EXPOSE 3000

CMD ["npx", "next", "dev", "--hostname", "0.0.0.0"]
