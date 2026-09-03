# Security Policy

## Supported versions

Goliath is pre-1.0. Fixes land on the latest published version only.

| Version | Supported |
| ------- | --------- |
| 0.0.x   | ✅        |

## Reporting a vulnerability

Please do not open a public issue.

Report privately through GitHub's
[security advisory form](https://github.com/hellohelen-ai/goliath/security/advisories/new), which
opens a channel visible only to the maintainers.

Expect an acknowledgement within a few days. If the report is valid you will get a fix timeline and
credit in the advisory and the changelog, unless you would rather not be named.

## What is in scope

Goliath sits between a language model and your tools, so the interesting failures are about trust
boundaries:

- **Confirmation bypass** — anything that runs a tool marked `writes: true` without the `confirm`
  callback returning approval first.
- **Prompt injection through tool output.** Tool results are framed as data, not instructions, and
  the step log is spotlighted rather than inlined. A way to get text from a tool result treated as
  an instruction by the conductor is a vulnerability, not a quirk.
- **Leaking the transcript to the fallback.** The cloud fallback should receive the ask, the brief,
  and the step log — nothing that was never meant to leave the device.
- **Supply chain.** Anything about how this package is built, signed, or published.

## What is not in scope

- The behaviour of the underlying model. Goliath constrains a small model; it does not make one
  truthful.
- Tools you write. Goliath asks before it calls a tool marked `writes: true`; what that tool then
  does with its arguments is yours to validate.
- A model choosing a bad-but-permitted action within the tools you gave it.

## How releases are signed

Releases are published from GitHub Actions over OIDC trusted publishing. No long-lived npm token
exists for this package. Every version carries a provenance attestation, so you can verify which
commit and which workflow run produced the tarball:

```sh
npm audit signatures
```
