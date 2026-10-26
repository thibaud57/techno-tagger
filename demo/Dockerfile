# Contexte de build : la racine du depot (`docker build -f demo/Dockerfile .`).

# Debian et non alpine : `scriptShell: bash` de pnpm-workspace.yaml exige bash.
FROM node:24.22.1-slim AS build

# Meme valeur que devEngines.packageManager.version, gardee par test_demo_image_coherence.py.
ARG PNPM_VERSION=12.14.0
RUN npm install -g pnpm@${PNPM_VERSION}

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
# Un secret monte et non un ARG : la cle n'entre pas dans l'historique de l'image. Vide si absent (PR).
RUN --mount=type=secret,id=primeng_license_key,required=false \
    PRIMENG_LICENSE_KEY="$(cat /run/secrets/primeng_license_key 2>/dev/null)" pnpm build:demo

FROM nginx/nginx-unprivileged:1.30.6-alpine

COPY --from=build /app/dist/techno-tagger-ui-demo/browser /usr/share/nginx/html
COPY demo/nginx.conf /etc/nginx/nginx.conf
COPY demo/headers.conf /etc/nginx/headers.conf
