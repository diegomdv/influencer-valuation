# Influencer Valuation Tool

Vite + React + Tailwind SPA with PDF export and Docker packaging.

## Local (Mac M1)
```bash
unzip influencer-valuation-tool-full.zip
cd influencer-valuation-tool-full
npm install
npm run dev          # http://localhost:5173
npm run build
npm run preview      # http://localhost:4173
```

## Docker (local / Synology / Portainer)
Build & run:
```bash
docker build -t influencer-valuation:latest .
docker run -d --name influencer-valuation -p 8080:80 influencer-valuation:latest
```

Compose:
```bash
docker compose up -d
```

### Portainer (Stack)
If you get a “pull access denied”, build the image on the *same endpoint* first via **Images → Build a new image** (upload this folder as .tar.gz) with name `influencer-valuation:latest`, then deploy this compose:
```yaml
services:
  influencer-valuation:
    image: influencer-valuation:latest
    pull_policy: if_not_present
    ports:
      - "8080:80"
    restart: unless-stopped
```
