# Security Audit Report

Generated: 2026-04-15T23:23:18.688Z

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High     | 0 |
| Moderate | 6 |
| Low      | 1 |
| **Total** | **7** |

## MODERATE (6)

### hono

- **Title**: Hono missing validation of cookie name on write path in setCookie()
- **Affected Versions**: <4.12.12
- **Fix Available**: Yes
- **More Info**: https://github.com/advisories/GHSA-26pp-8wgv-hjvm

### hono

- **Title**: Hono: Non-breaking space prefix bypass in cookie name handling in getCookie()
- **Affected Versions**: <4.12.12
- **Fix Available**: Yes
- **More Info**: https://github.com/advisories/GHSA-r5rp-j6wh-rvv4

### hono

- **Title**: Hono has incorrect IP matching in ipRestriction() for IPv4-mapped IPv6 addresses
- **Affected Versions**: <4.12.12
- **Fix Available**: Yes
- **More Info**: https://github.com/advisories/GHSA-xpcf-pg52-r92g

### hono

- **Title**: Hono: Path traversal in toSSG() allows writing files outside the output directory
- **Affected Versions**: >=4.0.0 <=4.12.11
- **Fix Available**: Yes
- **More Info**: https://github.com/advisories/GHSA-xf4j-xp2r-rqqx

### hono

- **Title**: Hono: Middleware bypass via repeated slashes in serveStatic
- **Affected Versions**: <4.12.12
- **Fix Available**: Yes
- **More Info**: https://github.com/advisories/GHSA-wmmm-f939-6g9c

### @hono/node-server

- **Title**: @hono/node-server: Middleware bypass via repeated slashes in serveStatic
- **Affected Versions**: <1.19.13
- **Fix Available**: Yes
- **More Info**: https://github.com/advisories/GHSA-92pp-h63x-v22m

## LOW (1)

### cli

- **Title**: Arbitrary File Write in cli
- **Affected Versions**: <1.0.0
- **Fix Available**: Yes
- **More Info**: https://github.com/advisories/GHSA-6cpc-mj5c-m9rq

