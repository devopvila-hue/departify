# Golden Department gate

This is the smallest reusable production gate for authenticated portal checks.
It never stores credentials in the repository.

1. Run `pnpm e2e:auth`.
2. A visible browser opens at `https://app.departify.app`.
3. Log in normally in that window. Do not paste credentials into the terminal.
4. The script stores the browser session only at `e2e/.auth/production.json`, which is gitignored.
5. Run `pnpm e2e:production` to execute desktop and mobile acceptance checks and write screenshots under `/tmp/departify-golden-screenshots`.

The intended gate is:

`build → test → deploy → pnpm e2e:auth → pnpm e2e:production → visual acceptance`

Delete `e2e/.auth/production.json` locally to require a new login. Never commit it.
