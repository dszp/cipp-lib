# Changelog

All notable changes to `@dszp/cipp-lib` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] — 2026-10-30

No API changes. This is the first version published by the release workflow through npm trusted
publishing, with provenance.

## [0.1.0] — 2026-10-30

### Added

- `CippReadClient` with `listTenants`, `listLicenses`, `listDirectorySubscriptions` and
  `listSubscribedSkus`.
- `licenseCounts`, which reads a license row's counts as numbers.
- Entra client-credentials token handling: caching, early refresh, one shared request, and one
  retry after a `401`.
- Retry with backoff on `429` (`Retry-After` honoured) and on `502`, `503` and `504`.
