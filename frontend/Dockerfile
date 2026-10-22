FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN --mount=type=secret,id=proxy_ca if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build
CMD ["npm", "start"]
