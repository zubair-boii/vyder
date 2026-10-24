# Security policy

## Supported versions

Only the latest release and the `main` branch receive security fixes.

## Reporting a vulnerability

Please do **not** open a public issue for a security problem.

Use GitHub's private vulnerability reporting:
<https://github.com/zubair-boii/vyder/security/advisories/new>

Include:

- the affected platform and version;
- a minimal reproduction;
- the impact you believe is possible;
- any suggested fix or mitigation.

You can expect an acknowledgement within a few days. Please give the maintainer time
to ship a fix before disclosing the issue publicly.

## Scope

Vyder delegates media extraction to yt-dlp and FFmpeg. Vulnerabilities in those
upstream projects should also be reported to their maintainers. Reports about Vyder's
own bridge, file handling, Android service, permissions, or update path are in scope.
