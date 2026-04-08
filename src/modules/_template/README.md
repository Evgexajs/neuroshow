# Template Module

This is a template for creating new modules. Copy this folder and customize.

## Quick Start

```bash
# 1. Copy template
cp -r src/modules/_template src/modules/your-module

# 2. Rename files and classes
# Replace "Template" with "YourModule" everywhere
```

## Files

| File | Purpose |
|------|---------|
| `types.ts` | Interface extending IModule |
| `index.ts` | Module implementation |
| `README.md` | Module documentation |

## Checklist

- [ ] Rename TEMPLATE_MODULE_NAME constant
- [ ] Rename ITemplateModule interface
- [ ] Rename TemplateModule class
- [ ] Add module-specific methods to interface
- [ ] Implement methods in module class
- [ ] Register in orchestrator
- [ ] Add tests
