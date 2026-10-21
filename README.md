# iacclr
Turns every image into an optimized webp with cache on S3.

## Build
```bash
docker build -t iacclr .
```

## Usage
Set `URL_WHITELIST` to comma-separated URL patterns with literal hostnames. The optimizer matches the entire URL and verifies the parsed hostname and port. Redirects are rejected; include the final image URL in the whitelist. Invalid patterns prevent startup, and an empty list allows no image origins.

```bash
docker run -d \
--read-only \
--restart=always \
-p8080:8080 \
--tmpfs /tmp \
--name iacclr \
-e S3_PUBLIC="https://s3-public-link.tld" \
-e S3="http[s]://user:password@host:port#region/bucket" \
-e URL_WHITELIST="https?://example.com/.+,https?://example2.com/images/.+" \
iacclr
```
