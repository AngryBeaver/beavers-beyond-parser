# The proxy only uses Node's standard library, and Node runs TypeScript directly,
# so the image needs no dependencies and no build step.
FROM node:24-alpine
WORKDIR /app
COPY src/ ./src/
USER node
EXPOSE 3001
# Configuration comes from the container environment (-e / env_file), not from a .env file.
CMD ["node", "src/index.ts"]
