# Operational Rules & DevOps

## Deployment Safety
- Local development MUST use stage `local`.
- Shared deployment MUST use stage `dev`.
- Do not run `sst dev --stage dev`.

## Make Targets
- Use `make dev` for local startup.
- Use `make check` for quality gates.
- Use `make deploy` for production deployment.

## CI/CD Alignment
- Ensure any changes to build scripts are reflected in [DEVOPS.md](../../docs/governance/DEVOPS.md).
