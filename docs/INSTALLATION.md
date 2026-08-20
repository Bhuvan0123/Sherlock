# Installation

```bash
git clone <repo-url> sherlock
cd sherlock
npm install
cp .env.example .env
npm run doctor
npm run build
npm run test
```

On Windows PowerShell, use `Copy-Item .env.example .env`.

If `npm run doctor` reports `Build` as missing, run `npm run build` and retry.
