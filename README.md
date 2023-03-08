# iacclr
Turns every image into an optimized webp with cache on S3.

## Build
```bash
docker build -t iacclr .
```

## Usage
```bash
docker run -d \
--read-only \
--restart=always \
-p8080:8080 \
--name iacclr \
-e S3_PUBLIC="https://s3-public-link.tld" \
-e S3="http[s]://user:password@host:port/bucket#region" \
-e URL_WHITELIST="https?://example.com/.+,https?://example2.com/images/.+" \
iacclr
```