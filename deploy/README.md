# Deploying s4tools to a web host

Every push to `main` uploads the site to a web host over FTPS: [.github/workflows/deploy.yml](../.github/workflows/deploy.yml). It sends only what the site needs:
- `index.html`, `css/` and `js/`;
- `docs/guide.html` and `docs/GUIDE.md`;
- `LICENSE`;
- [htaccess](htaccess), uploaded as `.htaccess` (for Apache-style hosts);
- `version.json`, the commit, which it also writes into `index.html`. It goes up last; a page left open checks it every few minutes and asks for a reload when the site has a newer version.

The `.htaccess` makes the site https only (Web MIDI needs it) and makes browsers pick up new versions straight away.

The upload mirrors the folder: files the site no longer has are removed. Files a host keeps in a site's folder are left alone: `.well-known`, `cgi-bin` and `.ftpquota`.

Before uploading, the workflow lists the target folder, and stops if anything there would be deleted. That's anything other than the site's own files and those host files (`.well-known`, `cgi-bin`, `.ftpquota`, `error_log`). The error names what it found. So a wrong setting can't empty your home folder, a website's root or another site, and a file you put in the s4tools folder by hand stops the deploy instead of disappearing.

## One-time setup

### 1. On the web host

1. **https:** the domain needs an SSL certificate; the site must load over https.
2. **The folder:** create a folder for the site inside the domain's web root, e.g. `s4tools`. The site will be at `https://yourdomain.com/s4tools/`.
3. **An FTP account for the deploy,** with a long random password, whose home is that folder. It then sees only that folder, so the deploy can't reach anything else.
4. **The server's name:** the FTPS certificate belongs to the server, and the upload checks it, so use the host name the certificate is issued for. Your host lists the FTP server's name; if a deploy reports a certificate mismatch, the error names the right one.

### 2. In GitHub

In the repository, go to **Settings › Secrets and variables › Actions**. Under **Repository secrets** add:

| Secret | Value |
|---|---|
| `FTP_HOST` | the server's name from step 4 |
| `FTP_USER` | the FTP account's login |
| `FTP_PASSWORD` | its password |

Only if the FTP account's home is **not** the site's folder: add a repository **variable** (not a secret) `FTP_DIR` with the site's folder as that account sees it, e.g. `/www/s4tools`. The safety check stops the upload if that folder holds anything that isn't part of s4tools.

### 3. Run it

Push to `main`, or open **Actions › Deploy to the website › Run workflow**. Until the three secrets exist, the workflow skips the upload with a notice.

## When something fails

- **Certificate errors** (`certificate verification failed`, `hostname mismatch`): `FTP_HOST` isn't a name the server's certificate covers. The error lists the names it does cover; set `FTP_HOST` to one of them. It's the same machine, with the same FTP account and password.
- **Login failed:** check `FTP_USER` (some hosts want the full `name@domain` form) and the password.
- **"holds files that aren't part of s4tools":** the safety check stopped the upload before anything changed. Either the target is the wrong folder (point the FTP account at the site's own folder, or set `FTP_DIR`), or the folder has files you added. Move them out of it.
- **The page shows an old version:** reload once. The `.htaccess` makes browsers check for new files on each visit.
- **A redirect loop** after the first deploy: the domain is behind a proxy that talks plain http to the server. Set the proxy to use https to the server too, or remove the https lines from `htaccess`.
