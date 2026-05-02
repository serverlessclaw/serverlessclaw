# Infrastructure Checklist

## SST Resource Naming
- Use descriptive names for SST resources.
- Ensure all resources have tags if required by the [Security Policy](../../docs/intelligence/SAFETY.md).

## Change Validation
- Before modifying `infra/`, run `make check` to ensure no breaking type changes.
- Always verify resource impacts in [ARCHITECTURE.md](../../ARCHITECTURE.md).
