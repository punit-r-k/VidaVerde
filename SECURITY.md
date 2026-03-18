# Security Policy

## Reporting

If you discover a security issue, do not open a public issue.

Report it privately to the maintainers with:
- a clear description of the impact
- affected routes, files, or features
- reproduction steps or proof of concept
- any suggested mitigation

## Triage

Incoming reports should be triaged by severity and exploitability:
- Critical: account takeover, remote code execution, authentication bypass, major data exposure
- High: privilege escalation, protected data disclosure, request smuggling, unsafe production configuration
- Medium: input validation gaps, denial of service risks, incomplete hardening
- Low: defense-in-depth issues with limited exploitability

## Response Targets

- Acknowledge receipt within 3 business days
- Provide an initial severity assessment within 7 business days
- Ship or stage a fix for confirmed Critical and High findings as quickly as possible

## Disclosure

Public disclosure should happen only after a fix is available and affected deployments have had a reasonable upgrade window.
